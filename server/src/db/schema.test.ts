import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './index';
import { createTestDb } from '../test/db';

let db: Db;

async function newUser(name: string): Promise<string> {
  const row = await db.one<{ id: string }>(
    `INSERT INTO users (email, username, password_hash) VALUES ($1, $2, 'x') RETURNING id`,
    [`${name}@example.com`, name],
  );
  return row!.id;
}

async function newAccount(userId: string, name: string, currency = 'USD'): Promise<string> {
  const row = await db.one<{ id: string }>(
    `INSERT INTO accounts (user_id, name, type, currency) VALUES ($1, $2, 'bank', $3) RETURNING id`,
    [userId, name, currency],
  );
  return row!.id;
}

async function newCategory(userId: string, name: string, kind = 'expense'): Promise<string> {
  const row = await db.one<{ id: string }>(`INSERT INTO categories (user_id, kind, name) VALUES ($1, $2, $3) RETURNING id`, [userId, kind, name]);
  return row!.id;
}

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

describe('schema', () => {
  it('seeds currencies, rates and category templates', async () => {
    const cur = await db.query<{ code: string }>('SELECT code FROM currencies ORDER BY sort_order');
    expect(cur.map((c) => c.code)).toEqual(['USD', 'EUR', 'GBP', 'UZS', 'RUB', 'KZT', 'TRY']);
    const rates = await db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM exchange_rates');
    expect(rates?.n).toBe(7);
    const tpl = await db.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM category_templates WHERE parent_key IS NULL AND kind = 'expense'");
    expect(tpl?.n).toBe(14);
  });

  it('returns camelCase keys and typed values', async () => {
    const row = await db.one<{ someValue: number; day: string; ts: string; big: number }>(
      `SELECT 5::bigint AS some_value, DATE '2026-09-28' AS day, now() AS ts, 12.5::numeric AS big`,
    );
    expect(row?.someValue).toBe(5);
    expect(row?.day).toBe('2026-09-28');
    expect(row?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(row?.big).toBe(12.5);
  });

  it('enforces unique e-mail/username case-insensitively and validates formats', async () => {
    await newUser('alice');
    await expect(db.exec(`INSERT INTO users (email, username, password_hash) VALUES ('ALICE@example.com', 'alice2', 'x')`)).rejects.toThrow();
    await expect(db.exec(`INSERT INTO users (email, username, password_hash) VALUES ('a2@example.com', 'ALICE', 'x')`)).rejects.toThrow();
    await expect(db.exec(`INSERT INTO users (email, username, password_hash) VALUES ('bad-email', 'bob1', 'x')`)).rejects.toThrow();
    await expect(db.exec(`INSERT INTO users (email, username, password_hash) VALUES ('b@example.com', 'a', 'x')`)).rejects.toThrow();
    await expect(db.exec(`INSERT INTO users (email, username, password_hash) VALUES ('b@example.com', 'bob', NULL)`)).rejects.toThrow();
  });

  it('blocks references to another user\'s account or category (composite foreign keys)', async () => {
    const u1 = await newUser('owner1');
    const u2 = await newUser('owner2');
    const acc1 = await newAccount(u1, 'Main');
    const cat1 = await newCategory(u1, 'Food');
    const cat2 = await newCategory(u2, 'Food');
    // u2 cannot post into u1's account
    await expect(
      db.exec(`INSERT INTO transactions (user_id, type, account_id, currency, amount_minor, category_id, occurred_on) VALUES ($1,'expense',$2,'USD',100,$3,'2026-01-01')`, [u2, acc1, cat2]),
    ).rejects.toThrow(/foreign key/);
    // u1 cannot use u2's category
    await expect(
      db.exec(`INSERT INTO transactions (user_id, type, account_id, currency, amount_minor, category_id, occurred_on) VALUES ($1,'expense',$2,'USD',100,$3,'2026-01-01')`, [u1, acc1, cat2]),
    ).rejects.toThrow(/foreign key/);
    // currency must match the account's currency
    await expect(
      db.exec(`INSERT INTO transactions (user_id, type, account_id, currency, amount_minor, category_id, occurred_on) VALUES ($1,'expense',$2,'EUR',100,$3,'2026-01-01')`, [u1, acc1, cat1]),
    ).rejects.toThrow(/foreign key/);
    // the legitimate insert works
    await db.exec(`INSERT INTO transactions (user_id, type, account_id, currency, amount_minor, category_id, occurred_on) VALUES ($1,'expense',$2,'USD',100,$3,'2026-01-01')`, [u1, acc1, cat1]);
  });

  it('checks transaction shape (amount > 0, transfer rules, category required)', async () => {
    const u = await newUser('shape');
    const a = await newAccount(u, 'A');
    const b = await newAccount(u, 'B');
    const c = await newCategory(u, 'Misc');
    const ins = (cols: string, vals: string) => db.exec(`INSERT INTO transactions (user_id, account_id, currency, occurred_on, ${cols}) VALUES ('${u}','${a}','USD','2026-01-01', ${vals})`);
    await expect(ins('type, amount_minor, category_id', `'expense', 0, '${c}'`)).rejects.toThrow();
    await expect(ins('type, amount_minor, category_id', `'expense', -5, '${c}'`)).rejects.toThrow();
    await expect(ins('type, amount_minor', `'expense', 500`)).rejects.toThrow(); // category required
    await expect(ins('type, amount_minor, category_id, to_account_id, to_currency, to_amount_minor', `'transfer', 100, '${c}', '${b}', 'USD', 100`)).rejects.toThrow(); // transfer has no category
    await expect(ins('type, amount_minor, to_account_id, to_currency, to_amount_minor', `'transfer', 100, '${a}', 'USD', 100`)).rejects.toThrow(); // same account
    await ins('type, amount_minor, to_account_id, to_currency, to_amount_minor', `'transfer', 100, '${b}', 'USD', 100`);
  });

  it('keeps split parts equal to the transaction amount', async () => {
    const u = await newUser('splitter');
    const a = await newAccount(u, 'A');
    const food = await newCategory(u, 'Food');
    const fun = await newCategory(u, 'Fun');
    const tx = (
      await db.one<{ id: string }>(
        `INSERT INTO transactions (user_id, type, account_id, currency, amount_minor, category_id, occurred_on) VALUES ($1,'expense',$2,'USD',20000,$3,'2026-01-01') RETURNING id`,
        [u, a, food],
      )
    )!.id;
    await db.tx(async () => {
      await db.exec(`INSERT INTO transaction_splits (transaction_id, user_id, category_id, amount_minor) VALUES ($1,$2,$3,15000),($1,$2,$4,5000)`, [tx, u, food, fun]);
    });
    await expect(
      db.tx(async () => {
        await db.exec(`INSERT INTO transaction_splits (transaction_id, user_id, category_id, amount_minor) VALUES ($1,$2,$3,1)`, [tx, u, fun]);
      }),
    ).rejects.toThrow(/split amounts/);
    // changing the total without touching the parts is rejected too
    await expect(db.exec(`UPDATE transactions SET amount_minor = 30000 WHERE id = $1`, [tx])).rejects.toThrow(/split amounts/);
    // …but changing both in one transaction works
    await db.tx(async () => {
      await db.exec(`UPDATE transactions SET amount_minor = 30000 WHERE id = $1`, [tx]);
      await db.exec(`UPDATE transaction_splits SET amount_minor = 15000 WHERE transaction_id = $1 AND amount_minor = 5000`, [tx]);
    });
    // the view exposes one line per part
    const lines = await db.query<{ categoryId: string; amountMinor: number }>('SELECT category_id, amount_minor FROM transaction_lines WHERE transaction_id = $1 ORDER BY amount_minor', [tx]);
    expect(lines.map((l) => l.amountMinor)).toEqual([15000, 15000]);
  });

  it('rolls back the whole transaction on error and joins ambient transactions', async () => {
    const u = await newUser('txuser');
    await expect(
      db.tx(async () => {
        await db.exec(`INSERT INTO accounts (user_id, name, type, currency) VALUES ($1, 'T1', 'cash', 'USD')`, [u]);
        await db.tx(async () => {
          await db.exec(`INSERT INTO accounts (user_id, name, type, currency) VALUES ($1, 'T2', 'cash', 'USD')`, [u]);
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const n = await db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM accounts WHERE user_id = $1`, [u]);
    expect(n?.n).toBe(0);
  });

  it('makes audit_logs append-only', async () => {
    await db.exec(`INSERT INTO audit_logs (action) VALUES ('test.action')`);
    await expect(db.exec(`UPDATE audit_logs SET action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(db.exec(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
    await db.tx(async () => {
      await db.exec(`SET LOCAL fintrack.audit_purge = 'on'`);
      await db.exec(`DELETE FROM audit_logs WHERE action = 'test.action'`);
    });
  });

  it('cascades user deletion through every owned table', async () => {
    const u = await newUser('goner');
    const a = await newAccount(u, 'Gone');
    const c = await newCategory(u, 'Gone cat');
    await db.exec(`INSERT INTO transactions (user_id, type, account_id, currency, amount_minor, category_id, occurred_on) VALUES ($1,'expense',$2,'USD',100,$3,'2026-01-01')`, [u, a, c]);
    await db.exec('DELETE FROM users WHERE id = $1', [u]);
    for (const t of ['accounts', 'categories', 'transactions']) {
      const n = await db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${t} WHERE user_id = $1`, [u]);
      expect(n?.n, t).toBe(0);
    }
  });
});
