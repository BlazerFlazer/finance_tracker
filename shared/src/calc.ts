import { addDays, addMonths, diffDays, type ISODate } from './dates';

// =====================================================================================
// Goals
// =====================================================================================

export interface GoalMetricsInput {
  targetMinor: number;
  currentMinor: number;
  deadline?: ISODate | null;
  today: ISODate;
  /** planned or recently observed monthly contribution, used for the completion estimate */
  monthlyPlanMinor?: number | null;
}

export type GoalStatus = 'completed' | 'overdue' | 'on_track' | 'behind' | 'no_deadline' | 'no_plan';

export interface GoalMetrics {
  progress: number; // 0..1
  remainingMinor: number;
  completed: boolean;
  daysLeft: number | null;
  overdue: boolean;
  requiredMonthlyMinor: number | null;
  requiredWeeklyMinor: number | null;
  monthsToComplete: number | null;
  estimatedCompletion: ISODate | null;
  status: GoalStatus;
}

const DAYS_PER_MONTH = 30.4375;

export function goalMetrics(i: GoalMetricsInput): GoalMetrics {
  const remainingMinor = Math.max(0, i.targetMinor - i.currentMinor);
  const completed = remainingMinor === 0 && i.targetMinor > 0;
  const progress = i.targetMinor > 0 ? Math.min(1, Math.max(0, i.currentMinor / i.targetMinor)) : 0;
  const daysLeft = i.deadline ? diffDays(i.today, i.deadline) : null;
  const overdue = !completed && daysLeft !== null && daysLeft < 0;

  let requiredMonthlyMinor: number | null = null;
  let requiredWeeklyMinor: number | null = null;
  if (!completed && daysLeft !== null && daysLeft >= 0) {
    requiredMonthlyMinor = Math.ceil(remainingMinor / Math.max(1, daysLeft / DAYS_PER_MONTH));
    requiredWeeklyMinor = Math.ceil(remainingMinor / Math.max(1, daysLeft / 7));
  }

  let monthsToComplete: number | null = null;
  let estimatedCompletion: ISODate | null = null;
  if (completed) {
    monthsToComplete = 0;
  } else if (i.monthlyPlanMinor && i.monthlyPlanMinor > 0) {
    monthsToComplete = Math.ceil(remainingMinor / i.monthlyPlanMinor);
    estimatedCompletion = addMonths(i.today, monthsToComplete);
  }

  let status: GoalStatus;
  if (completed) status = 'completed';
  else if (overdue) status = 'overdue';
  else if (!i.deadline) status = 'no_deadline';
  else if (!estimatedCompletion) status = 'no_plan';
  else status = estimatedCompletion <= i.deadline ? 'on_track' : 'behind';

  return { progress, remainingMinor, completed, daysLeft, overdue, requiredMonthlyMinor, requiredWeeklyMinor, monthsToComplete, estimatedCompletion, status };
}

/** "If you save X per month, the goal could be reached in about N months." null when it cannot be computed. */
export function monthsToReach(remainingMinor: number, monthlyMinor: number): number | null {
  if (remainingMinor <= 0) return 0;
  if (monthlyMinor <= 0) return null;
  return Math.ceil(remainingMinor / monthlyMinor);
}

// =====================================================================================
// Debt payoff (snowball / avalanche / custom)
// =====================================================================================

export interface DebtInput {
  id: string;
  name: string;
  balanceMinor: number;
  aprPercent: number;
  minPaymentMinor: number;
}

export type PayoffStrategy = 'snowball' | 'avalanche' | 'custom' | 'minimum';

export interface PayoffOptions {
  strategy: PayoffStrategy;
  /** extra money per month on top of all minimum payments */
  extraMonthlyMinor?: number;
  /** debt ids in priority order (custom strategy) */
  customOrder?: string[];
  startDate: ISODate;
  maxMonths?: number;
}

export interface PayoffDebtResult {
  id: string;
  name: string;
  payoffMonth: number | null;
  payoffDate: ISODate | null;
  interestPaidMinor: number;
}

export interface PayoffPoint {
  month: number;
  date: ISODate;
  balanceMinor: number;
  paidMinor: number;
  interestMinor: number;
}

export interface PayoffResult {
  strategy: PayoffStrategy;
  /** null when the debts cannot be repaid within maxMonths with the given payments */
  months: number | null;
  payoffDate: ISODate | null;
  totalInterestMinor: number;
  totalPaidMinor: number;
  debts: PayoffDebtResult[];
  schedule: PayoffPoint[];
  paysOff: boolean;
}

export function simulateDebtPayoff(input: DebtInput[], opts: PayoffOptions): PayoffResult {
  const maxMonths = opts.maxMonths ?? 600;
  const extra = Math.max(0, opts.extraMonthlyMinor ?? 0);
  const debts = input
    .filter((d) => d.balanceMinor > 0)
    .map((d) => ({ ...d, balance: d.balanceMinor, interest: 0, paidOffMonth: null as number | null }));
  const rollover = opts.strategy !== 'minimum';
  const budget = debts.reduce((s, d) => s + d.minPaymentMinor, 0) + extra;
  const schedule: PayoffPoint[] = [];
  const startTotal = debts.reduce((s, d) => s + d.balance, 0);
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;

  const active = () => debts.filter((d) => d.balance > 0);

  while (active().length > 0 && month < maxMonths) {
    month++;
    let interestThisMonth = 0;
    for (const d of active()) {
      const interest = Math.round((d.balance * d.aprPercent) / 100 / 12);
      d.balance += interest;
      d.interest += interest;
      interestThisMonth += interest;
    }
    let available = rollover ? budget : debts.reduce((s, d) => s + (d.balance > 0 ? d.minPaymentMinor : 0), 0);
    let paidThisMonth = 0;

    // 1) minimum payments on every active debt
    for (const d of active()) {
      const pay = Math.min(d.minPaymentMinor, d.balance, available);
      d.balance -= pay;
      available -= pay;
      paidThisMonth += pay;
    }
    // 2) everything that is left goes to the priority debt(s)
    if (rollover && available > 0) {
      const order = priorityOrder(active(), opts);
      for (const d of order) {
        if (available <= 0) break;
        const pay = Math.min(d.balance, available);
        d.balance -= pay;
        available -= pay;
        paidThisMonth += pay;
      }
    }
    for (const d of debts) if (d.balance <= 0 && d.paidOffMonth === null) d.paidOffMonth = month;

    totalInterest += interestThisMonth;
    totalPaid += paidThisMonth;
    const remaining = debts.reduce((s, d) => s + Math.max(0, d.balance), 0);
    schedule.push({ month, date: addMonths(opts.startDate, month), balanceMinor: remaining, paidMinor: paidThisMonth, interestMinor: interestThisMonth });
    if (paidThisMonth === 0) break; // no progress possible (nothing can be paid)
    if (remaining > startTotal * 20) break; // payments never catch up with interest — stop early
  }

  const paysOff = active().length === 0;
  return {
    strategy: opts.strategy,
    months: paysOff ? month : null,
    payoffDate: paysOff ? addMonths(opts.startDate, month) : null,
    totalInterestMinor: totalInterest,
    totalPaidMinor: totalPaid,
    debts: debts.map((d) => ({
      id: d.id,
      name: d.name,
      payoffMonth: d.paidOffMonth,
      payoffDate: d.paidOffMonth !== null ? addMonths(opts.startDate, d.paidOffMonth) : null,
      interestPaidMinor: d.interest,
    })),
    schedule: thinSchedule(schedule),
    paysOff,
  };
}

function priorityOrder<T extends { id: string; balance: number; aprPercent: number }>(list: T[], opts: PayoffOptions): T[] {
  const copy = [...list];
  if (opts.strategy === 'snowball') return copy.sort((a, b) => a.balance - b.balance || b.aprPercent - a.aprPercent);
  if (opts.strategy === 'avalanche') return copy.sort((a, b) => b.aprPercent - a.aprPercent || a.balance - b.balance);
  const order = opts.customOrder ?? [];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return copy.sort((a, b) => rank(a.id) - rank(b.id));
}

/** Keep charts light: at most ~120 points, always including the last one. */
function thinSchedule(points: PayoffPoint[], max = 120): PayoffPoint[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out = points.filter((_, i) => i % step === 0);
  const last = points[points.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

// =====================================================================================
// Money simulator (what-if)
// =====================================================================================

export interface SimGoal {
  targetMinor: number;
  currentMinor: number;
  deadline?: ISODate | null;
}

export interface SimScenarioInput {
  incomeMinor: number;
  expensesMinor: number;
}

export interface SimProjection {
  monthlySavingsMinor: number;
  yearlySavingsMinor: number;
  savingsRate: number;
  monthsToGoal: number | null;
  goalDate: ISODate | null;
  meetsDeadline: boolean | null;
  requiredMonthlyMinor: number | null;
  /** cumulative savings after 0..horizon months */
  series: number[];
}

export function projectScenario(s: SimScenarioInput, goal: SimGoal | null, today: ISODate, horizonMonths = 24): SimProjection {
  const monthly = s.incomeMinor - s.expensesMinor;
  const series: number[] = [];
  for (let m = 0; m <= horizonMonths; m++) series.push(monthly * m);
  let monthsToGoal: number | null = null;
  let goalDate: ISODate | null = null;
  let meetsDeadline: boolean | null = null;
  let requiredMonthlyMinor: number | null = null;
  if (goal) {
    const remaining = Math.max(0, goal.targetMinor - goal.currentMinor);
    monthsToGoal = monthsToReach(remaining, monthly);
    goalDate = monthsToGoal === null ? null : addMonths(today, monthsToGoal);
    if (goal.deadline) {
      meetsDeadline = goalDate !== null && goalDate <= goal.deadline;
      requiredMonthlyMinor = goalMetrics({ targetMinor: goal.targetMinor, currentMinor: goal.currentMinor, deadline: goal.deadline, today }).requiredMonthlyMinor;
    }
  }
  return {
    monthlySavingsMinor: monthly,
    yearlySavingsMinor: monthly * 12,
    savingsRate: s.incomeMinor > 0 ? monthly / s.incomeMinor : 0,
    monthsToGoal,
    goalDate,
    meetsDeadline,
    requiredMonthlyMinor,
    series,
  };
}

export interface SimComparison {
  monthlyDiffMinor: number;
  yearlyDiffMinor: number;
  /** positive = the goal is reached this many months sooner than in the current scenario */
  goalMonthsSooner: number | null;
}

export function compareProjections(base: SimProjection, alt: SimProjection): SimComparison {
  return {
    monthlyDiffMinor: alt.monthlySavingsMinor - base.monthlySavingsMinor,
    yearlyDiffMinor: alt.yearlySavingsMinor - base.yearlySavingsMinor,
    goalMonthsSooner:
      base.monthsToGoal !== null && alt.monthsToGoal !== null
        ? base.monthsToGoal - alt.monthsToGoal
        : null,
  };
}

/** Deadline-driven variant: what monthly saving is needed to hit `deadline`? */
export function requiredForDeadline(goal: SimGoal, deadline: ISODate, today: ISODate): number | null {
  if (deadline <= today) return null;
  return goalMetrics({ targetMinor: goal.targetMinor, currentMinor: goal.currentMinor, deadline, today }).requiredMonthlyMinor;
}

export const shiftDeadline = (deadline: ISODate, months: number): ISODate => addDays(addMonths(deadline, months), 0);
