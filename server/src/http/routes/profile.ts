import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { onboardingSchema, profileUpdateSchema } from '@shared/schemas/domain';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { requireAuth, requireVerified } from '../../auth/guard';
import { buildPatch } from '../../db/patch';
import { loadMe } from '../../auth/dto';
import { isValidTimeZone } from '@shared/dates';

const SELECT = `SELECT display_name AS "displayName", country, main_currency AS "mainCurrency", language, timezone, theme, week_start AS "weekStart",
  income_source AS "incomeSource", avg_monthly_income_minor AS "avgMonthlyIncomeMinor", income_frequency AS "incomeFrequency",
  expense_focus AS "expenseFocus", has_debts AS "hasDebts", has_subscriptions AS "hasSubscriptions", main_goal AS "mainGoal",
  desired_savings_minor AS "desiredSavingsMinor", goal_timeframe_months AS "goalTimeframeMonths",
  onboarding_completed_at AS "onboardingCompletedAt", ai_consent AS "aiConsent" FROM profiles WHERE user_id = $1`;

export async function registerProfileRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/profile',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireAuth(req);
        return { profile: await db.one(SELECT, [auth.user.id]) };
      },
    }),
  );

  app.patch(
    '/api/profile',
    defineRoute({
      body: profileUpdateSchema,
      handler: async ({ body, req }) => {
        const auth = requireAuth(req);
        if (body.mainCurrency && !(await db.one(`SELECT 1 FROM currencies WHERE code = $1 AND is_active`, [body.mainCurrency]))) {
          throw AppError.validation([{ path: 'mainCurrency', message: 'validation.currency_invalid' }]);
        }
        if (body.timezone && !isValidTimeZone(body.timezone)) throw AppError.validation([{ path: 'timezone', message: 'validation.invalid_format' }]);
        const patch = buildPatch(body, {
          displayName: 'display_name', country: 'country', mainCurrency: 'main_currency', language: 'language',
          timezone: 'timezone', theme: 'theme', weekStart: 'week_start',
        }, 2);
        if (patch) await db.exec(`UPDATE profiles SET ${patch.setSql} WHERE user_id = $1`, [auth.user.id, ...patch.values]);
        return { profile: await db.one(SELECT, [auth.user.id]) };
      },
    }),
  );

  app.post(
    '/api/profile/onboarding',
    defineRoute({
      body: onboardingSchema,
      handler: async ({ body, req }) => {
        const auth = requireAuth(req);
        if (!(await db.one(`SELECT 1 FROM currencies WHERE code = $1 AND is_active`, [body.mainCurrency]))) {
          throw AppError.validation([{ path: 'mainCurrency', message: 'validation.currency_invalid' }]);
        }
        await db.exec(
          `UPDATE profiles SET display_name = $2, country = $3, main_currency = $4, income_source = $5, avg_monthly_income_minor = $6,
             income_frequency = $7, expense_focus = $8, has_debts = $9, has_subscriptions = $10, main_goal = $11,
             desired_savings_minor = $12, goal_timeframe_months = $13, onboarding_data = $14, onboarding_completed_at = now()
           WHERE user_id = $1`,
          [
            auth.user.id, body.displayName, body.country, body.mainCurrency, body.incomeSource, body.avgMonthlyIncomeMinor ?? null,
            body.incomeFrequency, body.expenseFocus, body.hasDebts, body.hasSubscriptions, body.mainGoal ?? null,
            body.desiredSavingsMinor ?? null, body.goalTimeframeMonths ?? null, JSON.stringify(body),
          ],
        );
        return { user: await loadMe(db, auth.user.id) };
      },
    }),
  );

  app.post(
    '/api/profile/ai-consent',
    defineRoute({
      body: z.object({ enabled: z.boolean() }),
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        await db.exec(`UPDATE profiles SET ai_consent = $2, ai_consent_at = CASE WHEN $2 THEN now() ELSE ai_consent_at END WHERE user_id = $1`, [auth.user.id, body.enabled]);
        return { aiConsent: body.enabled };
      },
    }),
  );
}
