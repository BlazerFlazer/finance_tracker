import { CURRENCIES, DEFAULT_CATEGORY_TEMPLATES, SEED_RATES_PER_USD } from '@shared/constants';
import type { Db } from './index';

/**
 * Reference data every installation needs. Idempotent: safe to run on every start.
 * Currencies and exchange rates are only added when missing; category templates are seeded once
 * (afterwards admins own that list, so it is never overwritten).
 */
export async function seedReferenceData(db: Db): Promise<void> {
  await db.tx(async () => {
    let order = 0;
    for (const c of CURRENCIES) {
      order += 10;
      await db.exec(
        `INSERT INTO currencies (code, name, symbol, minor_units, display_decimals, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (code) DO NOTHING`,
        [c.code, c.name, c.symbol, c.minorUnits, c.displayDecimals, order],
      );
      const rate = SEED_RATES_PER_USD[c.code];
      if (rate) {
        await db.exec(
          `INSERT INTO exchange_rates (currency_code, rate_per_usd, source) VALUES ($1, $2, 'seed') ON CONFLICT (currency_code) DO NOTHING`,
          [c.code, rate],
        );
      }
    }

    const count = await db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM category_templates');
    if ((count?.n ?? 0) === 0) {
      let sort = 0;
      // parents first so the self-referencing foreign key is satisfied
      const ordered = [...DEFAULT_CATEGORY_TEMPLATES].sort((a, b) => Number(!!a.parent) - Number(!!b.parent));
      for (const t of ordered) {
        sort += 10;
        await db.exec(
          `INSERT INTO category_templates (key, kind, parent_key, icon, color, sort_order) VALUES ($1, $2, $3, $4, $5, $6)`,
          [t.key, t.kind, t.parent ?? null, t.icon, t.color, sort],
        );
      }
    }
  });
}
