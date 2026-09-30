import { goalMetrics, type GoalMetrics } from '@shared/calc';
import type { Queryable } from '../db/index';

export interface GoalRow {
  id: string;
  name: string;
  kind: string;
  targetMinor: number;
  currentMinor: number;
  currency: string;
  deadline: string | null;
  plannedMonthlyMinor: number | null;
  status: 'active' | 'completed' | 'archived';
  icon: string | null;
  color: string | null;
  notes: string | null;
  createdAt: string;
}

const SELECT = `SELECT id, name, kind, target_minor AS "targetMinor", current_minor AS "currentMinor", currency, deadline,
  planned_monthly_minor AS "plannedMonthlyMinor", status, icon, color, notes, created_at AS "createdAt" FROM financial_goals`;

export async function listGoals(db: Queryable, userId: string, includeArchived = false): Promise<GoalRow[]> {
  const where = includeArchived ? 'user_id = $1' : `user_id = $1 AND status <> 'archived'`;
  return db.query<GoalRow>(`${SELECT} WHERE ${where} ORDER BY (status = 'completed'), deadline NULLS LAST, created_at`, [userId]);
}

/** Average of the last 3 months' net contributions — used as a fallback "pace" when no explicit monthly plan is set. */
async function recentAverageMonthly(db: Queryable, userId: string, goalId: string, today: string): Promise<number | null> {
  const row = await db.one<{ total: number | null }>(
    `SELECT SUM(amount_minor) AS total FROM goal_contributions WHERE user_id = $1 AND goal_id = $2 AND contributed_on > ($3::date - interval '3 months')`,
    [userId, goalId, today],
  );
  if (!row?.total) return null;
  return Math.max(0, Math.round(row.total / 3));
}

export interface GoalWithMetrics {
  goal: GoalRow;
  metrics: GoalMetrics;
}

export async function goalWithMetrics(db: Queryable, userId: string, goal: GoalRow, today: string): Promise<GoalWithMetrics> {
  const monthlyPlanMinor = goal.plannedMonthlyMinor ?? (await recentAverageMonthly(db, userId, goal.id, today));
  return { goal, metrics: goalMetrics({ targetMinor: goal.targetMinor, currentMinor: goal.currentMinor, deadline: goal.deadline, today, monthlyPlanMinor }) };
}

export async function listGoalsWithMetrics(db: Queryable, userId: string, today: string, includeArchived = false): Promise<GoalWithMetrics[]> {
  const goals = await listGoals(db, userId, includeArchived);
  return Promise.all(goals.map((g) => goalWithMetrics(db, userId, g, today)));
}

/** Flips a goal between "active" and "completed" based on current vs. target — call after any contribution change. */
export async function recomputeGoalStatus(db: Queryable, userId: string, goalId: string): Promise<void> {
  await db.exec(
    `UPDATE financial_goals SET
       status = CASE WHEN current_minor >= target_minor THEN 'completed' ELSE 'active' END,
       completed_at = CASE WHEN current_minor >= target_minor THEN COALESCE(completed_at, now()) ELSE NULL END
     WHERE id = $1 AND user_id = $2 AND status <> 'archived'`,
    [goalId, userId],
  );
}
