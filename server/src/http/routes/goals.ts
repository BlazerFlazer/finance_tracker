import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParams } from '@shared/schemas/common';
import { goalContributionSchema, goalCreateSchema, goalUpdateSchema } from '@shared/schemas/domain';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { requireVerified } from '../../auth/guard';
import { buildPatch } from '../../db/patch';
import { isUniqueViolation } from '../../db/index';
import { getUserPrefs } from '../../domain/prefs';
import { goalWithMetrics, listGoalsWithMetrics, recomputeGoalStatus, type GoalRow } from '../../domain/goals';

const SELECT_ONE = `SELECT id, name, kind, target_minor AS "targetMinor", current_minor AS "currentMinor", currency, deadline,
  planned_monthly_minor AS "plannedMonthlyMinor", status, icon, color, notes, created_at AS "createdAt" FROM financial_goals WHERE id = $1 AND user_id = $2`;

export async function registerGoalRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/goals',
    defineRoute({
      query: z.object({ includeArchived: z.coerce.boolean().default(false) }),
      handler: async ({ query, req }) => {
        const auth = requireVerified(req);
        const prefs = await getUserPrefs(db, auth.user.id);
        return { goals: await listGoalsWithMetrics(db, auth.user.id, prefs.today, query.includeArchived) };
      },
    }),
  );

  app.get(
    '/api/goals/:id',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const goal = await db.one<GoalRow>(SELECT_ONE, [params.id, auth.user.id]);
        if (!goal) throw AppError.notFound('Goal');
        const prefs = await getUserPrefs(db, auth.user.id);
        const contributions = await db.query(
          `SELECT id, amount_minor AS "amountMinor", contributed_on AS "contributedOn", note FROM goal_contributions WHERE goal_id = $1 AND user_id = $2 ORDER BY contributed_on DESC, created_at DESC`,
          [params.id, auth.user.id],
        );
        return { ...(await goalWithMetrics(db, auth.user.id, goal, prefs.today)), contributions };
      },
    }),
  );

  app.post(
    '/api/goals',
    defineRoute({
      body: goalCreateSchema,
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        try {
          const row = await db.one<{ id: string }>(
            `INSERT INTO financial_goals (user_id, name, kind, target_minor, current_minor, currency, deadline, planned_monthly_minor, icon, color, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [auth.user.id, body.name, body.kind, body.targetMinor, body.currentMinor, body.currency, body.deadline ?? null, body.plannedMonthlyMinor ?? null, body.icon ?? null, body.color ?? null, body.notes ?? null],
          );
          await recomputeGoalStatus(db, auth.user.id, row!.id);
          const goal = await db.one<GoalRow>(SELECT_ONE, [row!.id, auth.user.id]);
          const prefs = await getUserPrefs(db, auth.user.id);
          return await goalWithMetrics(db, auth.user.id, goal!, prefs.today);
        } catch (e) {
          if (isUniqueViolation(e)) throw new AppError('CONFLICT', 'A goal with this name already exists.');
          throw e;
        }
      },
    }),
  );

  app.patch(
    '/api/goals/:id',
    defineRoute({
      params: idParams,
      body: goalUpdateSchema,
      handler: async ({ params, body, req }) => {
        const auth = requireVerified(req);
        const existing = await db.one(`SELECT id FROM financial_goals WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (!existing) throw AppError.notFound('Goal');
        const patch = buildPatch(body, {
          name: 'name', kind: 'kind', targetMinor: 'target_minor', currentMinor: 'current_minor', currency: 'currency',
          deadline: 'deadline', plannedMonthlyMinor: 'planned_monthly_minor', icon: 'icon', color: 'color', notes: 'notes', status: 'status',
        });
        if (patch) await db.exec(`UPDATE financial_goals SET ${patch.setSql} WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id, ...patch.values]);
        if (body.currentMinor !== undefined || body.targetMinor !== undefined) await recomputeGoalStatus(db, auth.user.id, params.id);
        const goal = await db.one<GoalRow>(SELECT_ONE, [params.id, auth.user.id]);
        const prefs = await getUserPrefs(db, auth.user.id);
        return await goalWithMetrics(db, auth.user.id, goal!, prefs.today);
      },
    }),
  );

  app.delete(
    '/api/goals/:id',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const result = await db.exec(`DELETE FROM financial_goals WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (result === 0) throw AppError.notFound('Goal');
        return { ok: true };
      },
    }),
  );

  app.post(
    '/api/goals/:id/contributions',
    defineRoute({
      params: idParams,
      body: goalContributionSchema,
      handler: async ({ params, body, req }) => {
        const auth = requireVerified(req);
        const goal = await db.one(`SELECT id FROM financial_goals WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (!goal) throw AppError.notFound('Goal');
        await db.tx(async (tx) => {
          await tx.exec(`INSERT INTO goal_contributions (goal_id, user_id, amount_minor, contributed_on, note) VALUES ($1,$2,$3,$4,$5)`, [
            params.id, auth.user.id, body.amountMinor, body.contributedOn, body.note ?? null,
          ]);
          await tx.exec(`UPDATE financial_goals SET current_minor = GREATEST(0, current_minor + $3) WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id, body.amountMinor]);
          await recomputeGoalStatus(tx, auth.user.id, params.id);
        });
        const updated = await db.one<GoalRow>(SELECT_ONE, [params.id, auth.user.id]);
        const prefs = await getUserPrefs(db, auth.user.id);
        return await goalWithMetrics(db, auth.user.id, updated!, prefs.today);
      },
    }),
  );

  app.delete(
    '/api/goals/:id/contributions/:contributionId',
    defineRoute({
      params: z.object({ id: idParams.shape.id, contributionId: idParams.shape.id }),
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        await db.tx(async (tx) => {
          const contribution = await tx.one<{ amountMinor: number }>(`SELECT amount_minor AS "amountMinor" FROM goal_contributions WHERE id = $1 AND goal_id = $2 AND user_id = $3`, [
            params.contributionId, params.id, auth.user.id,
          ]);
          if (!contribution) throw AppError.notFound('Contribution');
          await tx.exec(`DELETE FROM goal_contributions WHERE id = $1`, [params.contributionId]);
          await tx.exec(`UPDATE financial_goals SET current_minor = GREATEST(0, current_minor - $3) WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id, contribution.amountMinor]);
          await recomputeGoalStatus(tx, auth.user.id, params.id);
        });
        return { ok: true };
      },
    }),
  );
}
