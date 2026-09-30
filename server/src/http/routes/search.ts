import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addDays, monthRange, previousRange } from '@shared/dates';
import { defineRoute } from '../route';
import { requireVerified } from '../../auth/guard';
import { getUserPrefs } from '../../domain/prefs';

/**
 * A few "smart query" patterns layered on top of plain substring search (section 40): an amount threshold
 * ("over $100" / "больше 100"), or a relative period ("last month" / "прошлый месяц"). Whatever text is left
 * after stripping a recognised pattern is used as the free-text term.
 */
function parseSmartQuery(raw: string, today: string): { term: string; minAmountMinor?: number; from?: string; to?: string } {
  let text = raw;
  let minAmountMinor: number | undefined;
  const amountMatch = /(?:over|above|больше|более|dan\s*ko'p)\s*\$?(\d+(?:[.,]\d+)?)/i.exec(text);
  if (amountMatch) {
    minAmountMinor = Math.round(parseFloat(amountMatch[1]!.replace(',', '.')) * 100);
    text = text.replace(amountMatch[0], ' ');
  }
  let from: string | undefined;
  let to: string | undefined;
  if (/last month|прошл(ый|ом) месяц|o'tgan oy/i.test(text)) {
    const range = previousRange(monthRange(today.slice(0, 7)));
    from = range.from;
    to = range.to;
    text = text.replace(/last month|прошл(ый|ом) месяц|o'tgan oy/gi, ' ');
  } else if (/this month|этот месяц|shu oy/i.test(text)) {
    const range = monthRange(today.slice(0, 7));
    from = range.from;
    to = range.to;
    text = text.replace(/this month|этот месяц|shu oy/gi, ' ');
  } else if (/this week|эт(а|ой) недел|shu hafta/i.test(text)) {
    from = addDays(today, -6);
    to = today;
    text = text.replace(/this week|эт(а|ой) недел[а-я]*|shu hafta/gi, ' ');
  }
  return { term: text.replace(/\s+/g, ' ').trim(), minAmountMinor, from, to };
}

export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/search',
    defineRoute({
      query: z.object({ q: z.string().trim().min(1).max(200), limit: z.coerce.number().int().min(1).max(50).default(8) }),
      handler: async ({ query, req }) => {
        const auth = requireVerified(req);
        const prefs = await getUserPrefs(db, auth.user.id);
        const parsed = parseSmartQuery(query.q, prefs.today);
        const like = `%${parsed.term}%`;
        const hasTerm = parsed.term.length > 0;

        const txWhere: string[] = ['user_id = $1'];
        const txParams: unknown[] = [auth.user.id];
        if (hasTerm) {
          txParams.push(like);
          txWhere.push(`(merchant ILIKE $${txParams.length} OR description ILIKE $${txParams.length})`);
        }
        if (parsed.minAmountMinor !== undefined) {
          txParams.push(parsed.minAmountMinor);
          txWhere.push(`amount_minor >= $${txParams.length}`);
        }
        if (parsed.from) {
          txParams.push(parsed.from);
          txWhere.push(`occurred_on >= $${txParams.length}`);
        }
        if (parsed.to) {
          txParams.push(parsed.to);
          txWhere.push(`occurred_on <= $${txParams.length}`);
        }
        txParams.push(query.limit);

        const [transactions, accounts, categories, goals, subscriptions, debts] = await Promise.all([
          db.query(
            `SELECT id, merchant, description, amount_minor AS "amountMinor", currency, occurred_on AS "occurredOn", type FROM transactions WHERE ${txWhere.join(' AND ')} ORDER BY occurred_on DESC LIMIT $${txParams.length}`,
            txParams,
          ),
          hasTerm ? db.query(`SELECT id, name, type, currency FROM accounts WHERE user_id = $1 AND name ILIKE $2 AND NOT is_archived LIMIT $3`, [auth.user.id, like, query.limit]) : [],
          // A default/template category has name = NULL (only system_key set, e.g. "rent") — its translated
          // label is resolved client-side, so match system_key too or it would be permanently unsearchable.
          hasTerm ? db.query(`SELECT id, name, kind, system_key AS "systemKey" FROM categories WHERE user_id = $1 AND (name ILIKE $2 OR system_key ILIKE $2) LIMIT $3`, [auth.user.id, like, query.limit]) : [],
          hasTerm ? db.query(`SELECT id, name, target_minor AS "targetMinor", currency FROM financial_goals WHERE user_id = $1 AND name ILIKE $2 LIMIT $3`, [auth.user.id, like, query.limit]) : [],
          hasTerm ? db.query(`SELECT id, name, price_minor AS "priceMinor", currency FROM subscriptions WHERE user_id = $1 AND name ILIKE $2 LIMIT $3`, [auth.user.id, like, query.limit]) : [],
          hasTerm ? db.query(`SELECT id, name, remaining_minor AS "remainingMinor", currency FROM debts WHERE user_id = $1 AND name ILIKE $2 LIMIT $3`, [auth.user.id, like, query.limit]) : [],
        ]);

        return { query: query.q, parsed, transactions, accounts, categories, goals, subscriptions, debts };
      },
    }),
  );
}
