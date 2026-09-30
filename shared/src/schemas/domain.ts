import { z } from 'zod';
import {
  ACCOUNT_TYPES,
  BILLING_CYCLES,
  BUDGET_PERIODS,
  CATEGORY_KINDS,
  DEBT_KINDS,
  FREQUENCIES,
  GOAL_KINDS,
  INCOME_FREQUENCIES,
  INCOME_SOURCES,
  TRANSACTION_TYPES,
} from '../constants';
import { amountMinorNonNegSchema, amountMinorSchema, amountMinorSignedSchema, currencyCodeSchema, hexColorSchema, iconNameSchema, isoDateSchema, optionalText, requiredText, shortText, uuidSchema } from './common';

// ============================================================================================= categories
export const categoryCreateSchema = z.object({
  kind: z.enum(CATEGORY_KINDS),
  name: requiredText(60),
  icon: iconNameSchema.default('Tag'),
  color: hexColorSchema.default('#64748b'),
  parentId: uuidSchema.optional().nullable(),
});
export const categoryUpdateSchema = z.object({
  name: requiredText(60).optional(),
  icon: iconNameSchema.optional(),
  color: hexColorSchema.optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isArchived: z.boolean().optional(),
});

// ================================================================================================= accounts
export const accountCreateSchema = z.object({
  name: requiredText(80),
  type: z.enum(ACCOUNT_TYPES),
  currency: currencyCodeSchema,
  institution: optionalText(80),
  openingBalanceMinor: amountMinorSignedSchema.default(0),
  creditLimitMinor: amountMinorNonNegSchema.optional().nullable(),
  lowBalanceThresholdMinor: amountMinorNonNegSchema.optional().nullable(),
  color: hexColorSchema.default('#6366f1'),
  icon: iconNameSchema.optional().nullable(),
  includeInNetWorth: z.boolean().default(true),
  notes: optionalText(500),
});
export const accountUpdateSchema = accountCreateSchema.omit({ currency: true }).partial().extend({
  isArchived: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

export const transferSchema = z.object({
  fromAccountId: uuidSchema,
  toAccountId: uuidSchema,
  amountMinor: amountMinorSchema,
  toAmountMinor: amountMinorSchema.optional(), // required only when currencies differ
  occurredOn: isoDateSchema,
  description: optionalText(500),
});

// ========================================================================================== transactions
const splitInput = z.object({ categoryId: uuidSchema, amountMinor: amountMinorSchema, note: optionalText(200) });

export const transactionCreateSchema = z
  .object({
    type: z.enum(['income', 'expense']),
    accountId: uuidSchema,
    currency: currencyCodeSchema,
    amountMinor: amountMinorSchema,
    categoryId: uuidSchema,
    merchant: optionalText(120),
    description: optionalText(500),
    occurredOn: isoDateSchema,
    occurredTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'validation.invalid_format').optional().nullable(),
    tagIds: z.array(uuidSchema).max(20).default([]),
    splits: z.array(splitInput).max(20).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.splits && v.splits.length > 0) {
      const sum = v.splits.reduce((s, p) => s + p.amountMinor, 0);
      if (sum !== v.amountMinor) ctx.addIssue({ code: 'custom', path: ['splits'], message: 'validation.split_mismatch' });
    }
  });
export type TransactionCreateInput = z.infer<typeof transactionCreateSchema>;

export const transactionUpdateSchema = transactionCreateSchema;

export const transactionListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  accountId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  tagId: uuidSchema.optional(),
  merchant: z.string().trim().max(120).optional(),
  minAmountMinor: z.coerce.number().int().min(0).optional(),
  maxAmountMinor: z.coerce.number().int().min(0).optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).default('date_desc'),
});

// ================================================================================================= budgets
export const budgetItemInput = z.object({ categoryId: uuidSchema, amountMinor: amountMinorSchema });
export const budgetCreateSchema = z.object({
  name: requiredText(80),
  period: z.enum(BUDGET_PERIODS),
  currency: currencyCodeSchema,
  noticePct: z.number().int().min(1).max(100).default(75),
  warningPct: z.number().int().min(1).max(100).default(90),
  items: z.array(budgetItemInput).min(1).max(50),
});
export const budgetUpdateSchema = budgetCreateSchema.partial().extend({ isActive: z.boolean().optional() });

// =================================================================================================== goals
export const goalCreateSchema = z.object({
  name: requiredText(100),
  kind: z.enum(GOAL_KINDS).default('other'),
  targetMinor: amountMinorSchema,
  currentMinor: amountMinorNonNegSchema.default(0),
  currency: currencyCodeSchema,
  deadline: isoDateSchema.optional().nullable(),
  plannedMonthlyMinor: amountMinorNonNegSchema.optional().nullable(),
  icon: iconNameSchema.optional().nullable(),
  color: hexColorSchema.optional().nullable(),
  notes: optionalText(500),
});
export const goalUpdateSchema = goalCreateSchema.partial().extend({ status: z.enum(['active', 'completed', 'archived']).optional() });
export const goalContributionSchema = z.object({ amountMinor: z.number().int().refine((n) => n !== 0, 'validation.amount_invalid'), contributedOn: isoDateSchema, note: optionalText(200) });

// ========================================================================================= subscriptions
export const subscriptionCreateSchema = z.object({
  name: requiredText(100),
  priceMinor: amountMinorSchema,
  currency: currencyCodeSchema,
  billingCycle: z.enum(BILLING_CYCLES),
  nextPaymentDate: isoDateSchema,
  startedOn: isoDateSchema.optional().nullable(),
  categoryId: uuidSchema.optional().nullable(),
  accountId: uuidSchema.optional().nullable(),
  autoRecord: z.boolean().default(false),
  reminderDays: z.number().int().min(0).max(30).default(3),
  url: optionalText(300),
  notes: optionalText(500),
});
export const subscriptionUpdateSchema = subscriptionCreateSchema.partial().extend({ status: z.enum(['active', 'paused', 'cancelled']).optional() });

// ================================================================================================== debts
export const debtCreateSchema = z.object({
  name: requiredText(100),
  creditor: optionalText(100),
  kind: z.enum(DEBT_KINDS).default('loan'),
  currency: currencyCodeSchema,
  originalMinor: amountMinorSchema,
  remainingMinor: amountMinorNonNegSchema,
  interestRate: z.number().min(0).max(1000).default(0),
  minPaymentMinor: amountMinorNonNegSchema.default(0),
  dueDay: z.number().int().min(1).max(31).optional().nullable(),
  finalDueDate: isoDateSchema.optional().nullable(),
  startDate: isoDateSchema.optional().nullable(),
  notes: optionalText(500),
});
export const debtUpdateSchema = debtCreateSchema.partial().extend({ status: z.enum(['active', 'paid_off', 'archived']).optional() });
export const debtPaymentSchema = z.object({ amountMinor: amountMinorSchema, principalMinor: amountMinorNonNegSchema, interestMinor: amountMinorNonNegSchema.default(0), paidOn: isoDateSchema, note: optionalText(200) });

export const payoffSimulationSchema = z.object({
  strategy: z.enum(['snowball', 'avalanche', 'custom', 'minimum']),
  extraMonthlyMinor: amountMinorNonNegSchema.default(0),
  customOrder: z.array(uuidSchema).max(50).optional(),
});

// =============================================================================================== recurring
export const recurringCreateSchema = z
  .object({
    name: requiredText(100),
    type: z.enum(TRANSACTION_TYPES),
    accountId: uuidSchema,
    currency: currencyCodeSchema,
    amountMinor: amountMinorSchema,
    toAccountId: uuidSchema.optional().nullable(),
    toCurrency: currencyCodeSchema.optional().nullable(),
    toAmountMinor: amountMinorSchema.optional().nullable(),
    categoryId: uuidSchema.optional().nullable(),
    merchant: optionalText(120),
    description: optionalText(500),
    frequency: z.enum(FREQUENCIES),
    intervalCount: z.number().int().min(1).max(365).default(1),
    startDate: isoDateSchema,
    endDate: isoDateSchema.optional().nullable(),
    autoConfirm: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'transfer') {
      if (!v.toAccountId || !v.toCurrency || !v.toAmountMinor) ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'validation.required' });
      if (v.toAccountId === v.accountId) ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'validation.same_account' });
    } else if (!v.categoryId) ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'validation.category_required' });
    if (v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'validation.date_range' });
  });
export const recurringUpdateSchema = recurringCreateSchema;

// =========================================================================================== onboarding / profile
export const profileUpdateSchema = z.object({
  displayName: optionalText(80),
  country: z.string().trim().max(5).optional().nullable(),
  mainCurrency: currencyCodeSchema.optional(),
  language: z.enum(['ru', 'en', 'uz']).optional(),
  timezone: z.string().max(64).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  weekStart: z.union([z.literal(0), z.literal(1)]).optional(),
});

export const onboardingSchema = z.object({
  displayName: requiredText(80),
  country: z.string().trim().max(5),
  mainCurrency: currencyCodeSchema,
  incomeSource: z.enum(INCOME_SOURCES),
  avgMonthlyIncomeMinor: amountMinorNonNegSchema.optional().nullable(),
  incomeFrequency: z.enum(INCOME_FREQUENCIES),
  expenseFocus: z.array(z.string().max(40)).max(14).default([]),
  hasDebts: z.boolean(),
  hasSubscriptions: z.boolean(),
  mainGoal: shortText(120).optional(),
  desiredSavingsMinor: amountMinorNonNegSchema.optional().nullable(),
  goalTimeframeMonths: z.number().int().min(1).max(600).optional().nullable(),
});

// ============================================================================================ notifications
export const notificationPrefUpdateSchema = z.object({
  items: z
    .array(
      z.object({
        type: z.enum(['upcoming_bill', 'subscription_payment', 'budget_warning', 'goal_progress', 'unusual_spending', 'low_balance', 'debt_payment', 'security_alert', 'monthly_review']),
        inApp: z.boolean(),
        email: z.boolean(),
        push: z.boolean(),
      }),
    )
    .min(1),
});

// =================================================================================================== journal
export const journalCreateSchema = z.object({ content: requiredText(10000), period: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(), promptKey: shortText(60).optional(), mood: z.number().int().min(1).max(5).optional().nullable() });
export const journalUpdateSchema = journalCreateSchema.partial();
