import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addDays, addMonths, dayOfWeek, diffDays, eachDay, monthRange, weekdayLabels, type ISODate } from '@shared/dates';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { requireVerified } from '../../auth/guard';
import { getUserPrefs } from '../../domain/prefs';
import { getRatesPerUsd } from '../../domain/rates';
import { computeNetWorth, defaultNetWorthWindow, netWorthOverTime } from '../../domain/networth';
import { amountByCategory, amountByMerchant, dailySpend, incomeExpenseByMonth } from '../../domain/analytics';
import { computeForecast } from '../../domain/forecast';
import { computeFinancialHealth } from '../../domain/health';
import { generateInsights, type InsightCtx } from '../../domain/insights';
import { answerQuestion } from '../../domain/assistant';
import { listUpcomingOccurrences } from '../../domain/recurring';
import { listGoalsWithMetrics } from '../../domain/goals';
import { checkRateLimit, RATE_LIMITS } from '../../security/rateLimit';
import { projectScenario, compareProjections, type SimGoal } from '@shared/calc';

async function buildCtx(db: FastifyInstance['db'], userId: string): Promise<InsightCtx> {
  const prefs = await getUserPrefs(db, userId);
  const rates = await getRatesPerUsd(db);
  return { userId, lang: prefs.language, mainCurrency: prefs.mainCurrency, rates, today: prefs.today, weekStart: prefs.weekStart, timezone: prefs.timezone };
}

export async function registerIntelligenceRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  // ------------------------------------------------------------------------------------------- net worth
  app.get(
    '/api/networth',
    defineRoute({
      query: z.object({ months: z.coerce.number().int().min(1).max(60).default(12) }),
      handler: async ({ query, req }) => {
        const auth = requireVerified(req);
        const ctx = await buildCtx(db, auth.user.id);
        const window = defaultNetWorthWindow(ctx.today, query.months);
        const [current, history] = await Promise.all([computeNetWorth(db, auth.user.id, ctx.mainCurrency, ctx.rates), netWorthOverTime(db, auth.user.id, ctx.mainCurrency, ctx.rates, window.from, window.to)]);
        return { current, history, currency: ctx.mainCurrency };
      },
    }),
  );

  // -------------------------------------------------------------------------------------------- forecast
  app.get(
    '/api/forecast',
    defineRoute({
      query: z.object({ horizonDays: z.coerce.number().int().min(1).max(365).default(90) }),
      handler: async ({ query, req }) => {
        const auth = requireVerified(req);
        const ctx = await buildCtx(db, auth.user.id);
        return { forecast: await computeForecast(db, ctx, query.horizonDays), currency: ctx.mainCurrency };
      },
    }),
  );

  // ------------------------------------------------------------------------------------------- simulator
  app.get(
    '/api/simulator/baseline',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireVerified(req);
        const ctx = await buildCtx(db, auth.user.id);
        const trailing = { from: addDays(ctx.today, -89), to: ctx.today };
        const flows = await incomeExpenseByMonth(db, auth.user.id, trailing, ctx.mainCurrency, ctx.rates);
        const withData = flows.filter((f) => f.incomeMinor > 0 || f.expenseMinor > 0).length || 1;
        const incomeMinor = Math.round(flows.reduce((s, f) => s + f.incomeMinor, 0) / withData);
        const expensesMinor = Math.round(flows.reduce((s, f) => s + f.expenseMinor, 0) / withData);
        const goals = await listGoalsWithMetrics(db, auth.user.id, ctx.today);
        return { currency: ctx.mainCurrency, incomeMinor, expensesMinor, goals: goals.filter((g) => g.goal.status === 'active').map((g) => g.goal) };
      },
    }),
  );

  app.post(
    '/api/simulator/compare',
    defineRoute({
      body: z.object({
        baseline: z.object({ incomeMinor: z.number().int().min(0), expensesMinor: z.number().int().min(0) }),
        scenario: z.object({ incomeMinor: z.number().int().min(0), expensesMinor: z.number().int().min(0) }),
        goalId: z.string().uuid().optional(),
        deadlineShiftMonths: z.number().int().min(-60).max(60).optional(),
        horizonMonths: z.number().int().min(1).max(120).default(24),
      }),
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        const ctx = await buildCtx(db, auth.user.id);
        let goal: SimGoal | null = null;
        if (body.goalId) {
          const row = await db.one<{ targetMinor: number; currentMinor: number; deadline: string | null }>(
            `SELECT target_minor AS "targetMinor", current_minor AS "currentMinor", deadline FROM financial_goals WHERE id = $1 AND user_id = $2`,
            [body.goalId, auth.user.id],
          );
          if (!row) throw AppError.notFound('Goal');
          goal = { targetMinor: row.targetMinor, currentMinor: row.currentMinor, deadline: body.deadlineShiftMonths ? (row.deadline ? addMonths(row.deadline, body.deadlineShiftMonths) : null) : row.deadline };
        }
        const base = projectScenario(body.baseline, goal, ctx.today, body.horizonMonths);
        const alt = projectScenario(body.scenario, goal, ctx.today, body.horizonMonths);
        return { currency: ctx.mainCurrency, current: base, scenario: alt, comparison: compareProjections(base, alt) };
      },
    }),
  );

  // -------------------------------------------------------------------------------------- where did it go
  app.get(
    '/api/money-flow',
    defineRoute({
      query: z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
      handler: async ({ query, req }) => {
        const auth = requireVerified(req);
        const ctx = await buildCtx(db, auth.user.id);
        const range = monthRange(query.period ?? ctx.today.slice(0, 7));
        const [flow, categories, merchants] = await Promise.all([
          incomeExpenseByMonth(db, auth.user.id, range, ctx.mainCurrency, ctx.rates),
          amountByCategory(db, auth.user.id, range, ctx.mainCurrency, ctx.rates, 'expense'),
          amountByMerchant(db, auth.user.id, range, ctx.mainCurrency, ctx.rates, 15),
        ]);
        const totals = flow[0] ?? { incomeMinor: 0, expenseMinor: 0, netMinor: 0 };
        return { currency: ctx.mainCurrency, period: range, income: totals.incomeMinor, expenses: totals.expenseMinor, remaining: totals.netMinor, categories, merchants };
      },
    }),
  );

  // -------------------------------------------------------------------------------------------- heatmap
  app.get(
    '/api/heatmap',
    defineRoute({
      query: z.object({ from: z.string().optional(), to: z.string().optional() }),
      handler: async ({ query, req }) => {
        const auth = requireVerified(req);
        const ctx = await buildCtx(db, auth.user.id);
        const to = query.to ?? ctx.today;
        const from = query.from ?? addDays(to, -364);
        const days = await dailySpend(db, auth.user.id, { from, to }, ctx.mainCurrency, ctx.rates);
        const byDate = new Map(days.map((d) => [d.date, d.amountMinor]));
        const byWeekday = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
        for (const d of eachDay(from, to)) {
          const amt = byDate.get(d) ?? 0;
          const wd = dayOfWeek(d);
          byWeekday[wd]!.total += amt;
          byWeekday[wd]!.count += 1;
        }
        return {
          currency: ctx.mainCurrency,
          days: eachDay(from, to).map((d) => ({ date: d, amountMinor: byDate.get(d) ?? 0 })),
          weekdayAverages: byWeekday.map((w, i) => ({ weekday: i, label: weekdayLabels(ctx.lang === 'uz' ? 'uz-Latn-UZ' : ctx.lang, ctx.weekStart)[(i - ctx.weekStart + 7) % 7], averageMinor: w.count ? Math.round(w.total / w.count) : 0 })),
        };
      },
    }),
  );

  // ------------------------------------------------------------------------------------------- timeline
  app.get(
    '/api/timeline',
    defineRoute({
      query: z.object({ from: z.string().optional(), to: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(60) }),
      handler: async ({ query, req }) => {
        const auth = requireVerified(req);
        const ctx = await buildCtx(db, auth.user.id);
        const to = query.to ?? ctx.today;
        const from = query.from ?? addDays(to, -89);
        const events = await db.query<{ kind: string; date: ISODate; label: string; amountMinor: number | null; currency: string | null }>(
          `SELECT 'transaction' AS kind, occurred_on AS date, COALESCE(merchant, description, type) AS label, amount_minor AS "amountMinor", currency
             FROM transactions WHERE user_id = $1 AND occurred_on BETWEEN $2 AND $3 AND type <> 'transfer' AND amount_minor > 0
           UNION ALL
           SELECT 'goal_contribution', contributed_on, 'Goal contribution', amount_minor, NULL FROM goal_contributions WHERE user_id = $1 AND contributed_on BETWEEN $2 AND $3
           UNION ALL
           SELECT 'debt_payment', paid_on, 'Debt payment', amount_minor, NULL FROM debt_payments WHERE user_id = $1 AND paid_on BETWEEN $2 AND $3
           ORDER BY date DESC LIMIT $4`,
          [auth.user.id, from, to, query.limit],
        );
        return { events };
      },
    }),
  );

  // ------------------------------------------------------------------------------------------- calendar
  app.get(
    '/api/calendar',
    defineRoute({
      query: z.object({ from: z.string(), to: z.string() }),
      handler: async ({ query, req }) => {
        const auth = requireVerified(req);
        const ctx = await buildCtx(db, auth.user.id);
        if (diffDays(query.from, query.to) > 120) throw AppError.validation([{ path: 'to', message: 'validation.too_big' }]);
        const [recurring, debts, goalContributions] = await Promise.all([
          listUpcomingOccurrences(db, auth.user.id, query.from, query.to),
          db.query<{ id: string; name: string; dueDay: number | null; remainingMinor: number; currency: string }>(
            `SELECT id, name, due_day AS "dueDay", remaining_minor AS "remainingMinor", currency FROM debts WHERE user_id = $1 AND status = 'active' AND due_day IS NOT NULL`,
            [auth.user.id],
          ),
          db.query<{ contributedOn: ISODate; amountMinor: number; goalName: string }>(
            `SELECT gc.contributed_on AS "contributedOn", gc.amount_minor AS "amountMinor", g.name AS "goalName"
             FROM goal_contributions gc JOIN financial_goals g ON g.id = gc.goal_id WHERE gc.user_id = $1 AND gc.contributed_on BETWEEN $2 AND $3`,
            [auth.user.id, query.from, query.to],
          ),
        ]);
        const debtEvents = debts.flatMap((d) => {
          const out: { date: ISODate; label: string; amountMinor: number; currency: string; kind: string }[] = [];
          let cursor = query.from.slice(0, 7);
          while (cursor <= query.to.slice(0, 7)) {
            const day = Math.min(d.dueDay!, 28);
            const date = `${cursor}-${String(day).padStart(2, '0')}`;
            if (date >= query.from && date <= query.to) out.push({ date, label: d.name, amountMinor: 0, currency: d.currency, kind: 'debt_due' });
            cursor = addMonths(`${cursor}-01`, 1).slice(0, 7);
          }
          return out;
        });
        return {
          recurring: recurring.map((r) => ({ ...r, kind: 'recurring' })),
          debts: debtEvents,
          goalContributions: goalContributions.map((g) => ({ date: g.contributedOn, label: g.goalName, amountMinor: g.amountMinor, kind: 'goal_contribution' })),
          today: ctx.today,
        };
      },
    }),
  );

  // -------------------------------------------------------------------------------------- monthly review
  app.get(
    '/api/reviews/:period',
    defineRoute({
      params: z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) }),
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const { buildMonthlyReview } = await import('../../domain/review');
        const ctx = await buildCtx(db, auth.user.id);
        return { review: await buildMonthlyReview(db, ctx, params.period) };
      },
    }),
  );

  // -------------------------------------------------------------------------------------- financial health
  app.get(
    '/api/health-score',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireVerified(req);
        const ctx = await buildCtx(db, auth.user.id);
        return computeFinancialHealth(db, ctx);
      },
    }),
  );

  // ------------------------------------------------------------------------------------------- AI insights
  app.get(
    '/api/insights',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireVerified(req);
        const ctx = await buildCtx(db, auth.user.id);
        return { insights: await generateInsights(db, ctx) };
      },
    }),
  );

  app.post(
    '/api/assistant/ask',
    defineRoute({
      body: z.object({ question: z.string().trim().min(1).max(500) }),
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        const rl = await checkRateLimit(db, RATE_LIMITS.aiAssistant, auth.user.id);
        if (!rl.allowed) throw new AppError('RATE_LIMITED_GENERIC', 'Too many questions', { params: { retryAfterMs: rl.retryAfterMs } });
        const ctx = await buildCtx(db, auth.user.id);
        return answerQuestion(db, ctx, body.question);
      },
    }),
  );
}
