import type { FastifyInstance } from 'fastify';
import { defineRoute } from '../route';
import { requireAuth } from '../../auth/guard';
import { recordSecurityEvent } from '../../security/events';
import { config } from '../../config';
import { decryptSecret } from '../../crypto';

/**
 * Privacy Center (section 44): transparent counts of what's stored, and a one-click export of everything
 * the user owns as a single JSON file. No banking passwords are ever stored (see README/SECURITY.md) —
 * there is nothing of that kind to include or exclude here.
 */
export async function registerPrivacyRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/privacy/overview',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireAuth(req);
        const counts = await db.one<Record<string, number>>(
          `SELECT
             (SELECT COUNT(*) FROM transactions WHERE user_id = $1)::int AS transactions,
             (SELECT COUNT(*) FROM accounts WHERE user_id = $1)::int AS accounts,
             (SELECT COUNT(*) FROM categories WHERE user_id = $1)::int AS categories,
             (SELECT COUNT(*) FROM budgets WHERE user_id = $1)::int AS budgets,
             (SELECT COUNT(*) FROM financial_goals WHERE user_id = $1)::int AS goals,
             (SELECT COUNT(*) FROM subscriptions WHERE user_id = $1)::int AS subscriptions,
             (SELECT COUNT(*) FROM debts WHERE user_id = $1)::int AS debts,
             (SELECT COUNT(*) FROM journal_entries WHERE user_id = $1)::int AS journal_entries,
             (SELECT COUNT(*) FROM attachments WHERE user_id = $1)::int AS attachments,
             (SELECT COUNT(*) FROM security_events WHERE user_id = $1)::int AS security_events`,
          [auth.user.id],
        );
        return {
          user: { id: auth.user.id, email: auth.user.email, createdSince: auth.session.createdAt },
          dataCounts: counts,
          accountDeletionGraceDays: config.accountDeletionGraceDays,
          storesBankPasswords: false,
        };
      },
    }),
  );

  app.get(
    '/api/privacy/export',
    defineRoute({
      handler: async ({ req, reply }) => {
        const auth = requireAuth(req);
        const uid = auth.user.id;
        const [user, profile, accounts, categories, transactions, splits, tags, budgets, budgetItems, goals, goalContributions, subscriptions, debts, debtPayments, recurring, journal, notifications, securityEvents] =
          await Promise.all([
            db.one(`SELECT id, email, username, created_at AS "createdAt" FROM users WHERE id = $1`, [uid]),
            db.one(`SELECT * FROM profiles WHERE user_id = $1`, [uid]),
            db.query(`SELECT * FROM accounts WHERE user_id = $1`, [uid]),
            db.query(`SELECT * FROM categories WHERE user_id = $1`, [uid]),
            db.query(`SELECT * FROM transactions WHERE user_id = $1`, [uid]),
            db.query(`SELECT * FROM transaction_splits WHERE user_id = $1`, [uid]),
            db.query(`SELECT * FROM tags WHERE user_id = $1`, [uid]),
            db.query(`SELECT * FROM budgets WHERE user_id = $1`, [uid]),
            db.query(`SELECT * FROM budget_items WHERE user_id = $1`, [uid]),
            db.query(`SELECT * FROM financial_goals WHERE user_id = $1`, [uid]),
            db.query(`SELECT * FROM goal_contributions WHERE user_id = $1`, [uid]),
            db.query(`SELECT * FROM subscriptions WHERE user_id = $1`, [uid]),
            db.query(`SELECT * FROM debts WHERE user_id = $1`, [uid]),
            db.query(`SELECT * FROM debt_payments WHERE user_id = $1`, [uid]),
            db.query(`SELECT * FROM recurring_transactions WHERE user_id = $1`, [uid]),
            db.query<{ id: string; contentEnc: string; period: string | null; mood: number | null; createdAt: string }>(
              `SELECT id, content_enc AS "contentEnc", period, mood, created_at AS "createdAt" FROM journal_entries WHERE user_id = $1`,
              [uid],
            ),
            db.query(`SELECT type, severity, code, params, created_at AS "createdAt" FROM notifications WHERE user_id = $1`, [uid]),
            db.query(`SELECT type, severity, ip, country_code AS "countryCode", created_at AS "createdAt" FROM security_events WHERE user_id = $1`, [uid]),
          ]);

        const journalDecrypted = journal.map(({ contentEnc, ...rest }) => ({ ...rest, content: decryptSecret(contentEnc, `journal:${uid}`) }));
        await recordSecurityEvent(db, { userId: uid, type: 'data_exported', ip: req.meta.ip });

        const bundle = {
          exportedAt: new Date().toISOString(),
          user,
          profile,
          accounts,
          categories,
          transactions,
          transactionSplits: splits,
          tags,
          budgets,
          budgetItems,
          goals,
          goalContributions,
          subscriptions,
          debts,
          debtPayments,
          recurringTransactions: recurring,
          journalEntries: journalDecrypted,
          notifications,
          securityEvents,
        };
        reply.header('Content-Disposition', `attachment; filename="fintrack-export-${uid}.json"`);
        return reply.type('application/json').send(JSON.stringify(bundle, null, 2));
      },
    }),
  );
}
