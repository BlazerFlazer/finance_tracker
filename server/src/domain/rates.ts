import type { RatesPerUsd } from '@shared/money';
import type { Db } from '../db/index';

export async function getRatesPerUsd(db: Db): Promise<RatesPerUsd> {
  const rows = await db.query<{ code: string; rate: number }>(`SELECT currency_code AS "code", rate_per_usd AS "rate" FROM exchange_rates`);
  return Object.fromEntries(rows.map((r) => [r.code, r.rate]));
}
