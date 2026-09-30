// Shared constants used by both the API and the web app.

export const APP_NAME = 'FinTrack';
export const APP_TAGLINE = 'Know your money. Control your future.';

export const LANGUAGES = ['ru', 'en', 'uz'] as const;
export type Lang = (typeof LANGUAGES)[number];
export const DEFAULT_LANG: Lang = 'en';
export const LANGUAGE_LABELS: Record<Lang, string> = { ru: 'Русский', en: 'English', uz: "O'zbek" };
export const LOCALE_TAGS: Record<Lang, string> = { ru: 'ru-RU', en: 'en-US', uz: 'uz-Latn-UZ' };

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

// ---------------------------------------------------------------- currencies
export interface CurrencyDef {
  code: string;
  name: string; // English name; UI localises through Intl.DisplayNames
  symbol: string;
  /** number of decimal places stored (amounts are integers in minor units) */
  minorUnits: number;
  /** decimals shown by default (amounts with a fractional part are always shown with decimals) */
  displayDecimals: number;
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', minorUnits: 2, displayDecimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', minorUnits: 2, displayDecimals: 2 },
  { code: 'GBP', name: 'British Pound', symbol: '£', minorUnits: 2, displayDecimals: 2 },
  { code: 'UZS', name: 'Uzbekistani Som', symbol: "so'm", minorUnits: 2, displayDecimals: 0 },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', minorUnits: 2, displayDecimals: 2 },
  { code: 'KZT', name: 'Kazakhstani Tenge', symbol: '₸', minorUnits: 2, displayDecimals: 0 },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', minorUnits: 2, displayDecimals: 2 },
];

/** Approximate reference rates: units of currency per 1 USD. Used only until live rates are fetched. */
export const SEED_RATES_PER_USD: Record<string, number> = {
  USD: 1,
  EUR: 0.86,
  GBP: 0.75,
  UZS: 12100,
  RUB: 82,
  KZT: 530,
  TRY: 41.5,
};

/** Hard cap for any single amount, in minor units (keeps every SUM inside JS safe-integer range). */
export const MAX_AMOUNT_MINOR = 10_000_000_000_000; // 1e13

// ------------------------------------------------------------------ accounts
export const ACCOUNT_TYPES = ['cash', 'bank', 'debit_card', 'credit_card', 'savings', 'investment', 'crypto', 'other'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Net-worth bucket for a positive balance of each account type. */
export const ASSET_BUCKET: Record<AccountType, 'cash' | 'bank' | 'savings' | 'investments' | 'other'> = {
  cash: 'cash',
  bank: 'bank',
  debit_card: 'bank',
  credit_card: 'bank',
  savings: 'savings',
  investment: 'investments',
  crypto: 'investments',
  other: 'other',
};

// -------------------------------------------------------------- transactions
export const TRANSACTION_TYPES = ['income', 'expense', 'transfer'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const CATEGORY_KINDS = ['expense', 'income'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

// ---------------------------------------------------------------- recurrence
export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const BILLING_CYCLES = ['weekly', 'monthly', 'quarterly', 'semiannual', 'yearly'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const BUDGET_PERIODS = ['weekly', 'monthly', 'yearly'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

// --------------------------------------------------------------------- goals
export const GOAL_KINDS = ['emergency_fund', 'vacation', 'education', 'car', 'house', 'laptop', 'other'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export const DEBT_KINDS = ['loan', 'credit_card', 'mortgage', 'personal', 'other'] as const;
export type DebtKind = (typeof DEBT_KINDS)[number];

export const INCOME_FREQUENCIES = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'irregular'] as const;
export type IncomeFrequency = (typeof INCOME_FREQUENCIES)[number];

export const INCOME_SOURCES = ['salary', 'freelance', 'business', 'pension', 'scholarship', 'investments', 'other'] as const;
export type IncomeSource = (typeof INCOME_SOURCES)[number];

// ------------------------------------------------------------- notifications
export const NOTIFICATION_TYPES = [
  'upcoming_bill',
  'subscription_payment',
  'budget_warning',
  'goal_progress',
  'unusual_spending',
  'low_balance',
  'debt_payment',
  'security_alert',
  'monthly_review',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

// ------------------------------------------------------------ security types
export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const USER_STATUSES = ['active', 'suspended', 'pending_deletion'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const SECURITY_EVENT_TYPES = [
  'register',
  'login_success',
  'login_failed',
  'login_locked',
  'login_2fa_failed',
  'logout',
  'email_verified',
  'verification_sent',
  'password_reset_requested',
  'password_reset_completed',
  'password_changed',
  'two_factor_enabled',
  'two_factor_disabled',
  'backup_codes_regenerated',
  'session_revoked',
  'sessions_revoked_all',
  'new_device_login',
  'account_deletion_requested',
  'account_deletion_cancelled',
  'data_exported',
  'admin_action',
  'account_suspended',
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

// ---------------------------------------------------------------- auth rules
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const USERNAME_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
export const RESERVED_USERNAMES = [
  'admin', 'administrator', 'root', 'support', 'help', 'security', 'system', 'fintrack', 'staff', 'moderator',
  'api', 'www', 'mail', 'noreply', 'null', 'undefined', 'me', 'user', 'demo',
];
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

// ------------------------------------------------------------ visual palette
export const COLOR_PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#f59e0b',
  '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#64748b',
] as const;

// ------------------------------------------------- default category templates
export interface CategoryTemplate {
  key: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  parent?: string;
}

/** Default categories copied to every new user. Admins can edit the template list (affects new users only). */
export const DEFAULT_CATEGORY_TEMPLATES: CategoryTemplate[] = [
  { key: 'food', kind: 'expense', icon: 'Utensils', color: '#f97316' },
  { key: 'transport', kind: 'expense', icon: 'Car', color: '#3b82f6' },
  { key: 'shopping', kind: 'expense', icon: 'ShoppingBag', color: '#ec4899' },
  { key: 'entertainment', kind: 'expense', icon: 'Clapperboard', color: '#8b5cf6' },
  { key: 'education', kind: 'expense', icon: 'GraduationCap', color: '#06b6d4' },
  { key: 'health', kind: 'expense', icon: 'HeartPulse', color: '#ef4444' },
  { key: 'bills', kind: 'expense', icon: 'Receipt', color: '#f59e0b' },
  { key: 'rent', kind: 'expense', icon: 'Home', color: '#6366f1' },
  { key: 'travel', kind: 'expense', icon: 'Plane', color: '#14b8a6' },
  { key: 'subscriptions', kind: 'expense', icon: 'Repeat', color: '#a855f7' },
  { key: 'technology', kind: 'expense', icon: 'Laptop', color: '#0ea5e9' },
  { key: 'family', kind: 'expense', icon: 'Users', color: '#22c55e' },
  { key: 'sports', kind: 'expense', icon: 'Dumbbell', color: '#84cc16' },
  { key: 'other', kind: 'expense', icon: 'Tag', color: '#64748b' },
  // subcategories
  { key: 'groceries', kind: 'expense', icon: 'ShoppingCart', color: '#f97316', parent: 'food' },
  { key: 'restaurants', kind: 'expense', icon: 'UtensilsCrossed', color: '#fb923c', parent: 'food' },
  { key: 'coffee', kind: 'expense', icon: 'Coffee', color: '#c2410c', parent: 'food' },
  { key: 'fuel', kind: 'expense', icon: 'Fuel', color: '#3b82f6', parent: 'transport' },
  { key: 'taxi', kind: 'expense', icon: 'Car', color: '#60a5fa', parent: 'transport' },
  { key: 'public_transport', kind: 'expense', icon: 'Bus', color: '#2563eb', parent: 'transport' },
  { key: 'utilities', kind: 'expense', icon: 'Zap', color: '#f59e0b', parent: 'bills' },
  { key: 'internet_phone', kind: 'expense', icon: 'Wifi', color: '#fbbf24', parent: 'bills' },
  // income
  { key: 'salary', kind: 'income', icon: 'Banknote', color: '#22c55e' },
  { key: 'freelance', kind: 'income', icon: 'Laptop', color: '#14b8a6' },
  { key: 'business', kind: 'income', icon: 'Store', color: '#0ea5e9' },
  { key: 'investments', kind: 'income', icon: 'TrendingUp', color: '#6366f1' },
  { key: 'gifts', kind: 'income', icon: 'Gift', color: '#ec4899' },
  { key: 'refunds', kind: 'income', icon: 'RotateCcw', color: '#84cc16' },
  { key: 'other_income', kind: 'income', icon: 'CircleDollarSign', color: '#64748b' },
];

export const SEARCH_ENTITY_TYPES = ['transaction', 'account', 'category', 'goal', 'subscription', 'debt'] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

export const SUPPORTED_COUNTRIES = [
  'UZ', 'RU', 'KZ', 'KG', 'TJ', 'TM', 'AZ', 'AM', 'GE', 'BY', 'UA', 'TR', 'US', 'GB', 'DE', 'FR', 'ES', 'IT',
  'PL', 'NL', 'AE', 'IN', 'CN', 'KR', 'JP', 'CA', 'AU', 'BR', 'OTHER',
] as const;
