import type { Lang } from '@shared/constants';
import { isValidTimeZone } from '@shared/dates';
import type { Db } from '../db/index';

export interface CreateUserInput {
  email: string;
  username: string;
  passwordHash: string | null;
  language?: Lang;
  timezone?: string;
  isDemo?: boolean;
  demoTtlHours?: number;
}

export interface CreatedUser {
  id: string;
  email: string;
  username: string;
}

/**
 * Creates the user row plus everything a brand-new account needs to be immediately usable: an empty
 * financial profile and the user's own copy of the default category tree (so accounts/transactions/budgets
 * can reference categories right away, and later edits never affect the shared template list).
 */
export async function createUserWithDefaults(db: Db, input: CreateUserInput): Promise<CreatedUser> {
  const tz = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : 'UTC';
  const lang = input.language ?? 'en';
  return db.tx(async (tx) => {
    const user = await tx.one<CreatedUser>(
      `INSERT INTO users (email, username, password_hash, is_demo, demo_expires_at, terms_accepted_at, terms_version, privacy_accepted_at)
       VALUES ($1,$2,$3,$4, CASE WHEN $4 THEN now() + ($5 || ' hours')::interval ELSE NULL END, now(), 'v1', now())
       RETURNING id, email, username`,
      [input.email, input.username, input.passwordHash, !!input.isDemo, input.demoTtlHours ?? 24],
    );
    await tx.exec(`INSERT INTO profiles (user_id, language, timezone) VALUES ($1,$2,$3)`, [user!.id, lang, tz]);

    const templates = await tx.query<{ key: string; kind: string; parentKey: string | null; icon: string; color: string; sortOrder: number }>(
      `SELECT key, kind, parent_key AS "parentKey", icon, color, sort_order AS "sortOrder" FROM category_templates WHERE is_active ORDER BY (parent_key IS NOT NULL), sort_order`,
    );
    const idByKey = new Map<string, string>();
    for (const tpl of templates) {
      const row = await tx.one<{ id: string }>(
        `INSERT INTO categories (user_id, parent_id, kind, system_key, icon, color, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [user!.id, tpl.parentKey ? (idByKey.get(tpl.parentKey) ?? null) : null, tpl.kind, tpl.key, tpl.icon, tpl.color, tpl.sortOrder],
      );
      idByKey.set(tpl.key, row!.id);
    }
    for (const type of ['upcoming_bill', 'subscription_payment', 'budget_warning', 'goal_progress', 'unusual_spending', 'low_balance', 'debt_payment', 'security_alert', 'monthly_review']) {
      await tx.exec(`INSERT INTO notification_preferences (user_id, type, in_app, email) VALUES ($1,$2,true,$3)`, [user!.id, type, type === 'security_alert']);
    }
    return user!;
  });
}
