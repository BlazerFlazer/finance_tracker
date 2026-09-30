import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import { config } from '../config';

/**
 * One tiny database interface with two engines behind it:
 *   - PostgreSQL through `pg` when DATABASE_URL is set (production),
 *   - PGlite (real PostgreSQL compiled to WASM, stored in ./data/pg) for zero-setup development and tests.
 * Both speak the same SQL. Rows come back with camelCase keys; bigint/numeric become numbers,
 * `date` stays a "YYYY-MM-DD" string and timestamps become ISO strings.
 */

export type Row = Record<string, any>;

export interface Queryable {
  query<T = Row>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  /** returns the number of affected rows */
  exec(sql: string, params?: readonly unknown[]): Promise<number>;
}

export interface Db extends Queryable {
  readonly kind: 'pg' | 'pglite';
  /**
   * Run `fn` in one database transaction. Inside `fn` every call on `db` (or on the handle) automatically
   * joins the transaction, so services never need to pass a transaction object around.
   */
  tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** multi-statement script (migrations) */
  script(sql: string): Promise<void>;
  close(): Promise<void>;
}

// ------------------------------------------------------------------ helpers
const camelCache = new Map<string, string>();
function camel(key: string): string {
  let c = camelCache.get(key);
  if (c === undefined) {
    c = key.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
    camelCache.set(key, c);
  }
  return c;
}

function mapRow<T>(row: Row): T {
  const out: Row = {};
  for (const k in row) out[camel(k)] = row[k];
  return out as T;
}

function normalizeParams(params?: readonly unknown[]): unknown[] {
  return (params ?? []).map((p) => (p === undefined ? null : p));
}

/** "2026-09-28 14:34:23.037+00" → ISO string */
export function pgTimestampToISO(v: string): string {
  let s = v.trim().replace(' ', 'T');
  if (/[+-]\d\d$/.test(s)) s += ':00';
  else if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

const PARSERS: Record<number, (v: string) => unknown> = {
  20: (v) => Number(v), // int8
  1700: (v) => Number(v), // numeric
  1082: (v) => v, // date -> 'YYYY-MM-DD'
  1114: (v) => pgTimestampToISO(v), // timestamp (treated as UTC)
  1184: (v) => pgTimestampToISO(v), // timestamptz
};

export function dbErrorInfo(e: unknown): { code?: string; constraint?: string; table?: string; detail?: string } {
  const err = e as { code?: string; constraint?: string; table?: string; detail?: string } | null;
  return { code: err?.code, constraint: err?.constraint, table: err?.table, detail: err?.detail };
}
export const isUniqueViolation = (e: unknown, constraint?: string): boolean => {
  const i = dbErrorInfo(e);
  return i.code === '23505' && (!constraint || i.constraint === constraint || (i.detail ?? '').includes(constraint));
};
export const isForeignKeyViolation = (e: unknown): boolean => dbErrorInfo(e).code === '23503';
export const isCheckViolation = (e: unknown): boolean => dbErrorInfo(e).code === '23514';

// --------------------------------------------------------------- shared wrapper
interface RawRunner {
  run(sql: string, params: unknown[]): Promise<{ rows: Row[]; affected: number }>;
}

function makeQueryable(raw: RawRunner): Queryable {
  return {
    async query<T>(sql: string, params?: readonly unknown[]) {
      const { rows } = await raw.run(sql, normalizeParams(params));
      return rows.map((r) => mapRow<T>(r));
    },
    async one<T>(sql: string, params?: readonly unknown[]) {
      const { rows } = await raw.run(sql, normalizeParams(params));
      return rows[0] ? mapRow<T>(rows[0]) : null;
    },
    async exec(sql: string, params?: readonly unknown[]) {
      const { affected } = await raw.run(sql, normalizeParams(params));
      return affected;
    },
  };
}

const txStore = new AsyncLocalStorage<{ db: object; q: Queryable }>();

function buildDb(kind: Db['kind'], root: RawRunner, begin: <T>(fn: (raw: RawRunner) => Promise<T>) => Promise<T>, script: (sql: string) => Promise<void>, close: () => Promise<void>): Db {
  const rootQ = makeQueryable(root);
  const self: Db = {
    kind,
    query: (sql, params) => (txStore.getStore()?.db === self ? txStore.getStore()!.q : rootQ).query(sql, params),
    one: (sql, params) => (txStore.getStore()?.db === self ? txStore.getStore()!.q : rootQ).one(sql, params),
    exec: (sql, params) => (txStore.getStore()?.db === self ? txStore.getStore()!.q : rootQ).exec(sql, params),
    async tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const current = txStore.getStore();
      if (current?.db === self) return fn(current.q); // already inside a transaction: join it
      return begin(async (raw) => {
        const q = makeQueryable(raw);
        return txStore.run({ db: self, q }, () => fn(q));
      });
    },
    script,
    close,
  };
  return self;
}

// ------------------------------------------------------------------- PGlite
async function createPglite(dir: string | null): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir) fs.mkdirSync(dir, { recursive: true });
  // NB: pass ONE options object — with (undefined, options) PGlite silently drops the options.
  const pg = new PGlite({ dataDir: dir ?? undefined, parsers: PARSERS as any });
  await pg.waitReady;
  await pg.exec("SET TIME ZONE 'UTC'");
  const toRaw = (runner: { query: (sql: string, params?: any[]) => Promise<any> }): RawRunner => ({
    async run(sql, params) {
      const res = await runner.query(sql, params as any[]);
      return { rows: res.rows as Row[], affected: (res.affectedRows as number | undefined) ?? res.rows.length };
    },
  });
  return buildDb(
    'pglite',
    toRaw(pg),
    (fn) => pg.transaction((tx) => fn(toRaw(tx))),
    async (sql) => {
      await pg.exec(sql);
    },
    async () => {
      await pg.close();
    },
  );
}

// ---------------------------------------------------------------- PostgreSQL
async function createPostgres(url: string): Promise<Db> {
  const pgModule = await import('pg');
  const pg = (pgModule as any).default ?? pgModule;
  for (const [oid, parser] of Object.entries(PARSERS)) pg.types.setTypeParser(Number(oid), parser as (v: string) => unknown);
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    options: '-c timezone=UTC -c statement_timeout=30000',
  });
  const toRaw = (runner: { query: (sql: string, params?: any[]) => Promise<any> }): RawRunner => ({
    async run(sql, params) {
      const res = await runner.query(sql, params as any[]);
      return { rows: res.rows as Row[], affected: (res.rowCount as number | null) ?? 0 };
    },
  });
  return buildDb(
    'pg',
    toRaw(pool),
    async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(toRaw(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async (sql) => {
      await pool.query(sql);
    },
    async () => {
      await pool.end();
    },
  );
}

/** Open the configured database (PostgreSQL via DATABASE_URL, otherwise embedded PGlite). */
export async function openDb(opts: { memory?: boolean } = {}): Promise<Db> {
  if (!opts.memory && config.databaseUrl) return createPostgres(config.databaseUrl);
  return createPglite(opts.memory ? null : config.pgliteDir);
}
