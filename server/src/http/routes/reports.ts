import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineRoute } from '../route';
import { requireVerified } from '../../auth/guard';
import { getUserPrefs } from '../../domain/prefs';
import { getRatesPerUsd } from '../../domain/rates';
import { buildMonthlyReview, currentReviewPeriod } from '../../domain/review';
import { renderMonthlyReportPdf } from '../../reports/pdf';
import type { InsightCtx } from '../../domain/insights';

const periodParams = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) });

async function buildCtx(db: FastifyInstance['db'], userId: string): Promise<InsightCtx> {
  const prefs = await getUserPrefs(db, userId);
  const rates = await getRatesPerUsd(db);
  return { userId, lang: prefs.language, mainCurrency: prefs.mainCurrency, rates, today: prefs.today, weekStart: prefs.weekStart, timezone: prefs.timezone };
}

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/reports',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireVerified(req);
        const ctx = await buildCtx(db, auth.user.id);
        const saved = await db.query<{ period: string; viewedAt: string | null }>(`SELECT period, viewed_at AS "viewedAt" FROM reports WHERE user_id = $1 AND kind = 'monthly' ORDER BY period DESC`, [auth.user.id]);
        const currentPeriod = currentReviewPeriod(ctx.today);
        const periods = new Set(saved.map((s) => s.period));
        periods.add(currentPeriod);
        return { periods: [...periods].sort().reverse(), currentPeriod };
      },
    }),
  );

  app.get(
    '/api/reports/:period',
    defineRoute({
      params: periodParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const ctx = await buildCtx(db, auth.user.id);
        const review = await buildMonthlyReview(db, ctx, params.period);
        await db.exec(
          `INSERT INTO reports (user_id, kind, period, currency, data) VALUES ($1,'monthly',$2,$3,$4)
           ON CONFLICT (user_id, kind, period) DO UPDATE SET data = $4, viewed_at = now()`,
          [auth.user.id, params.period, ctx.mainCurrency, JSON.stringify(review)],
        );
        return { report: review };
      },
    }),
  );

  app.get(
    '/api/reports/:period/pdf',
    defineRoute({
      params: periodParams,
      handler: async ({ params, req, reply }) => {
        const auth = requireVerified(req);
        const ctx = await buildCtx(db, auth.user.id);
        const review = await buildMonthlyReview(db, ctx, params.period);
        const pdf = await renderMonthlyReportPdf(review, ctx.lang);
        reply.header('Content-Disposition', `attachment; filename="fintrack-report-${params.period}.pdf"`);
        return reply.type('application/pdf').send(pdf);
      },
    }),
  );
}
