import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './index';

const here = path.dirname(fileURLToPath(import.meta.url));

function findMigrationsDir(): string {
  const candidates = [
    path.join(here, 'migrations'), // running from source (tsx) or a copied dist folder
    path.join(here, '..', 'src', 'db', 'migrations'), // bundled server/dist next to server/src
    path.join(process.cwd(), 'server', 'src', 'db', 'migrations'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(`Migrations folder not found (looked in: ${candidates.join(', ')})`);
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

export interface MigrationStatus {
  name: string;
  applied: boolean;
  appliedAt?: string;
}

export async function migrationStatus(db: Db): Promise<MigrationStatus[]> {
  await db.script(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const dir = findMigrationsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const rows = await db.query<{ name: string; appliedAt: string }>('SELECT name, applied_at FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.name, r.appliedAt]));
  return files.map((name) => ({ name, applied: applied.has(name), appliedAt: applied.get(name) }));
}

/** Apply pending migrations. Each file runs as ONE multi-statement query, i.e. atomically. */
export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<string[]> {
  await db.script(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const dir = findMigrationsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const rows = await db.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));
  const ran: string[] = [];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const checksum = sha256(sql);
    const prev = applied.get(file);
    if (prev) {
      if (prev !== checksum) throw new Error(`Migration ${file} was modified after it was applied. Create a new migration instead.`);
      continue;
    }
    log(`applying ${file}`);
    await db.script(`${sql}\n;\nINSERT INTO schema_migrations (name, checksum) VALUES (${lit(file)}, ${lit(checksum)});`);
    ran.push(file);
  }
  return ran;
}
