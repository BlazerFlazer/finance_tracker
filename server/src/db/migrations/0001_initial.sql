-- FinTrack — initial schema (PostgreSQL 14+; also runs on PGlite/PostgreSQL 17)
--
-- Design rules
--   * Money is stored as integer minor units (bigint) — never floating point.
--   * Every user-owned row carries user_id. Cross-table references are COMPOSITE foreign keys that include user_id
--     (and currency where amounts must match), so a row can never point at another user's account/category,
--     even if application code has a bug.
--   * Enumerations are text + CHECK constraints (easy to evolve). Timestamps are timestamptz (UTC); business dates are `date`.

-- ============================================================================ helpers
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- ============================================================================ reference data
CREATE TABLE currencies (
  code             text PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  name             text NOT NULL,
  symbol           text NOT NULL,
  minor_units      smallint NOT NULL DEFAULT 2 CHECK (minor_units BETWEEN 0 AND 4),
  display_decimals smallint NOT NULL DEFAULT 2 CHECK (display_decimals BETWEEN 0 AND 4),
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 100,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT currencies_decimals CHECK (display_decimals <= minor_units)
);

-- units of <currency> per 1 USD (USD itself = 1)
CREATE TABLE exchange_rates (
  currency_code text PRIMARY KEY REFERENCES currencies (code) ON UPDATE CASCADE ON DELETE CASCADE,
  rate_per_usd  numeric(28, 10) NOT NULL CHECK (rate_per_usd > 0),
  source        text NOT NULL DEFAULT 'seed',
  as_of         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE system_settings (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z0-9_.]{2,60}$'),
  value      jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================ identity
CREATE TABLE users (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  text NOT NULL,
  username               text NOT NULL,
  password_hash          text,
  email_verified_at      timestamptz,
  role                   text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending_deletion')),
  suspended_reason       text,
  is_demo                boolean NOT NULL DEFAULT false,
  demo_expires_at        timestamptz,
  password_changed_at    timestamptz,
  terms_accepted_at      timestamptz,
  terms_version          text,
  privacy_accepted_at    timestamptz,
  last_login_at          timestamptz,
  deletion_requested_at  timestamptz,
  deletion_scheduled_for timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_format CHECK (email = lower(email) AND length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,28}[A-Za-z0-9]$'),
  CONSTRAINT users_password_required CHECK (is_demo OR password_hash IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE UNIQUE INDEX users_username_key ON users (lower(username));
CREATE INDEX users_status_idx ON users (status);
CREATE INDEX users_demo_expiry_idx ON users (demo_expires_at) WHERE is_demo;
CREATE INDEX users_deletion_idx ON users (deletion_scheduled_for) WHERE deletion_scheduled_for IS NOT NULL;
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_totp (
  user_id        uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  secret_enc     text NOT NULL,                 -- AES-256-GCM (APP_ENCRYPTION_KEY); never stored in plaintext
  confirmed_at   timestamptz,                   -- NULL while the setup is still pending
  last_used_step bigint,                        -- replay protection
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE backup_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  text NOT NULL,                     -- HMAC-SHA256 of the code; the code itself is shown only once
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);

CREATE TABLE email_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify_email', 'password_reset')),
  token_hash text NOT NULL UNIQUE,              -- SHA-256 of the emailed token
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user_idx ON email_tokens (user_id, purpose, created_at DESC);

CREATE TABLE user_devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_key_hash text NOT NULL,                -- hash of a random per-browser cookie
  label           text,
  browser         text,
  os              text,
  device_type     text NOT NULL DEFAULT 'unknown' CHECK (device_type IN ('desktop', 'mobile', 'tablet', 'unknown')),
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_ip         text,
  last_country    text,
  UNIQUE (user_id, device_key_hash),
  UNIQUE (id, user_id)
);

CREATE TABLE sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash          text NOT NULL UNIQUE,     -- SHA-256 of the cookie value: a database leak does not leak live sessions
  csrf_hash           text NOT NULL,
  remember            boolean NOT NULL DEFAULT false,
  device_id           uuid,
  ip                  text,
  user_agent          text,
  browser             text,
  os                  text,
  device_type         text NOT NULL DEFAULT 'unknown',
  country_code        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_active_at      timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at          timestamptz,
  revoked_reason      text,
  FOREIGN KEY (device_id, user_id) REFERENCES user_devices (id, user_id) ON DELETE SET NULL (device_id)
);
CREATE INDEX sessions_user_idx ON sessions (user_id, last_active_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

-- pending 2FA logins: password was correct, second factor still required
CREATE TABLE login_challenges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,
  remember        boolean NOT NULL DEFAULT false,
  ip              text,
  user_agent      text,
  device_key_hash text,
  attempts        smallint NOT NULL DEFAULT 0,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_challenges_expiry_idx ON login_challenges (expires_at);

CREATE TABLE security_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES users (id) ON DELETE CASCADE,
  type            text NOT NULL,
  severity        text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  ip              text,
  user_agent      text,
  country_code    text,
  device_label    text,
  identifier_hash text,                         -- failed logins for unknown accounts: hashed identifier, never plaintext
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_user_idx ON security_events (user_id, created_at DESC);
CREATE INDEX security_events_created_idx ON security_events (created_at DESC);
CREATE INDEX security_events_type_idx ON security_events (type, created_at DESC);

CREATE TABLE rate_limits (
  key           text PRIMARY KEY,
  count         integer NOT NULL DEFAULT 0,
  window_start  timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rate_limits_updated_idx ON rate_limits (updated_at);

-- append-only trail of privileged and sensitive actions. No foreign key on purpose: rows outlive deleted accounts
-- (pseudonymous — only the user id, never e-mail or financial data).
CREATE TABLE audit_logs (
  id            bigserial PRIMARY KEY,
  actor_user_id uuid,
  actor_role    text,
  action        text NOT NULL,
  target_type   text,
  target_id     text,
  ip            text,
  user_agent    text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('fintrack.audit_purge', true) = 'on' THEN
    RETURN COALESCE(OLD, NEW);
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only';
END $$;
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

-- ============================================================================ profile
CREATE TABLE profiles (
  user_id                   uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  display_name              text CHECK (display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 80),
  country                   text CHECK (country IS NULL OR country ~ '^[A-Z]{2,5}$'),
  main_currency             text NOT NULL DEFAULT 'USD' REFERENCES currencies (code) ON UPDATE CASCADE,
  language                  text NOT NULL DEFAULT 'en' CHECK (language IN ('ru', 'en', 'uz')),
  timezone                  text NOT NULL DEFAULT 'UTC',
  theme                     text NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  week_start                smallint NOT NULL DEFAULT 1 CHECK (week_start IN (0, 1)),
  income_source             text,
  avg_monthly_income_minor  bigint CHECK (avg_monthly_income_minor IS NULL OR avg_monthly_income_minor BETWEEN 0 AND 10000000000000),
  income_frequency          text CHECK (income_frequency IS NULL OR income_frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly', 'irregular')),
  expense_focus             text[] NOT NULL DEFAULT '{}',
  has_debts                 boolean,
  has_subscriptions         boolean,
  main_goal                 text CHECK (main_goal IS NULL OR length(main_goal) <= 120),
  desired_savings_minor     bigint CHECK (desired_savings_minor IS NULL OR desired_savings_minor BETWEEN 0 AND 10000000000000),
  goal_timeframe_months     smallint CHECK (goal_timeframe_months IS NULL OR goal_timeframe_months BETWEEN 1 AND 600),
  onboarding_data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  onboarding_completed_at   timestamptz,
  seed_applied_at           timestamptz,
  ai_consent                boolean NOT NULL DEFAULT false,
  ai_consent_at             timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================ categories
-- Admin-managed template list copied to every new user's own category tree (affects new users only).
CREATE TABLE category_templates (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{2,40}$'),
  kind       text NOT NULL CHECK (kind IN ('expense', 'income')),
  parent_key text REFERENCES category_templates (key) ON UPDATE CASCADE ON DELETE CASCADE,
  name       text CHECK (name IS NULL OR length(btrim(name)) BETWEEN 1 AND 60),   -- English label for admin-added templates
  icon       text NOT NULL DEFAULT 'Tag',
  color      text NOT NULL DEFAULT '#64748b' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer NOT NULL DEFAULT 100,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  parent_id   uuid,
  kind        text NOT NULL CHECK (kind IN ('expense', 'income')),
  system_key  text,                              -- set for default categories; the UI localises them, `name` overrides
  name        text,
  icon        text NOT NULL DEFAULT 'Tag',
  color       text NOT NULL DEFAULT '#64748b' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order  integer NOT NULL DEFAULT 100,
  is_archived boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  FOREIGN KEY (parent_id, user_id) REFERENCES categories (id, user_id) ON DELETE CASCADE,
  CONSTRAINT categories_label CHECK (name IS NOT NULL OR system_key IS NOT NULL),
  CONSTRAINT categories_name_len CHECK (name IS NULL OR length(btrim(name)) BETWEEN 1 AND 60),
  CONSTRAINT categories_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX categories_user_syskey_key ON categories (user_id, system_key) WHERE system_key IS NOT NULL;
CREATE UNIQUE INDEX categories_user_name_key ON categories (user_id, kind, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) WHERE name IS NOT NULL;
CREATE INDEX categories_user_idx ON categories (user_id, kind, sort_order);
CREATE TRIGGER categories_updated BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================ accounts
CREATE TABLE accounts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name                        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  type                        text NOT NULL CHECK (type IN ('cash', 'bank', 'debit_card', 'credit_card', 'savings', 'investment', 'crypto', 'other')),
  currency                    text NOT NULL REFERENCES currencies (code) ON UPDATE CASCADE,
  institution                 text CHECK (institution IS NULL OR length(institution) <= 80),
  opening_balance_minor       bigint NOT NULL DEFAULT 0 CHECK (opening_balance_minor BETWEEN -10000000000000 AND 10000000000000),
  credit_limit_minor          bigint CHECK (credit_limit_minor IS NULL OR credit_limit_minor >= 0),
  low_balance_threshold_minor bigint CHECK (low_balance_threshold_minor IS NULL OR low_balance_threshold_minor >= 0),
  color                       text NOT NULL DEFAULT '#6366f1' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  icon                        text,
  include_in_net_worth        boolean NOT NULL DEFAULT true,
  is_archived                 boolean NOT NULL DEFAULT false,
  sort_order                  integer NOT NULL DEFAULT 100,
  notes                       text CHECK (notes IS NULL OR length(notes) <= 500),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  UNIQUE (id, user_id, currency)
);
CREATE UNIQUE INDEX accounts_user_name_key ON accounts (user_id, lower(name)) WHERE NOT is_archived;
CREATE INDEX accounts_user_idx ON accounts (user_id, sort_order);
CREATE TRIGGER accounts_updated BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================ tags
CREATE TABLE tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
CREATE UNIQUE INDEX tags_user_name_key ON tags (user_id, lower(name));

-- ============================================================================ imports
CREATE TABLE import_batches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  filename       text CHECK (filename IS NULL OR length(filename) <= 255),
  source         text NOT NULL DEFAULT 'csv',
  total_rows     integer NOT NULL DEFAULT 0,
  imported_rows  integer NOT NULL DEFAULT 0,
  skipped_rows   integer NOT NULL DEFAULT 0,
  mapping        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status         text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'undone')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
CREATE INDEX import_batches_user_idx ON import_batches (user_id, created_at DESC);

-- ============================================================================ recurring, subscriptions, debts
CREATE TABLE recurring_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  type            text NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  account_id      uuid NOT NULL,
  currency        text NOT NULL,
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 10000000000000),
  to_account_id   uuid,
  to_currency     text,
  to_amount_minor bigint CHECK (to_amount_minor IS NULL OR (to_amount_minor > 0 AND to_amount_minor <= 10000000000000)),
  category_id     uuid,
  merchant        text CHECK (merchant IS NULL OR length(merchant) <= 120),
  description     text CHECK (description IS NULL OR length(description) <= 500),
  frequency       text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  interval_count  smallint NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 365),
  start_date      date NOT NULL,
  end_date        date,
  next_due_date   date,                           -- first occurrence not yet confirmed/skipped; NULL when the rule has ended
  auto_confirm    boolean NOT NULL DEFAULT false, -- opt-in: record automatically on the due date (never moves real money)
  is_active       boolean NOT NULL DEFAULT true,
  last_posted_on  date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  CONSTRAINT recurring_end_after_start CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT recurring_shape CHECK (
    (type = 'transfer' AND to_account_id IS NOT NULL AND to_currency IS NOT NULL AND to_amount_minor IS NOT NULL AND to_account_id <> account_id AND category_id IS NULL)
    OR (type <> 'transfer' AND to_account_id IS NULL AND to_currency IS NULL AND to_amount_minor IS NULL AND category_id IS NOT NULL)
  ),
  FOREIGN KEY (account_id, user_id, currency) REFERENCES accounts (id, user_id, currency) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (to_account_id, user_id, to_currency) REFERENCES accounts (id, user_id, currency) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id) ON DELETE RESTRICT
);
CREATE INDEX recurring_due_idx ON recurring_transactions (user_id, next_due_date) WHERE is_active;
CREATE TRIGGER recurring_updated BEFORE UPDATE ON recurring_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE subscriptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name               text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  price_minor        bigint NOT NULL CHECK (price_minor > 0 AND price_minor <= 10000000000000),
  currency           text NOT NULL REFERENCES currencies (code) ON UPDATE CASCADE,
  billing_cycle      text NOT NULL CHECK (billing_cycle IN ('weekly', 'monthly', 'quarterly', 'semiannual', 'yearly')),
  next_payment_date  date NOT NULL,
  started_on         date,
  category_id        uuid,
  account_id         uuid,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  cancelled_on       date,
  auto_record        boolean NOT NULL DEFAULT false,
  reminder_days      smallint NOT NULL DEFAULT 3 CHECK (reminder_days BETWEEN 0 AND 30),
  last_used_on       date,
  url                text CHECK (url IS NULL OR length(url) <= 300),
  notes              text CHECK (notes IS NULL OR length(notes) <= 500),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id) ON DELETE SET NULL (category_id),
  FOREIGN KEY (account_id, user_id) REFERENCES accounts (id, user_id) ON DELETE SET NULL (account_id)
);
CREATE INDEX subscriptions_user_idx ON subscriptions (user_id, status, next_payment_date);
CREATE TRIGGER subscriptions_updated BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE debts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  creditor          text CHECK (creditor IS NULL OR length(creditor) <= 100),
  kind              text NOT NULL DEFAULT 'loan' CHECK (kind IN ('loan', 'credit_card', 'mortgage', 'personal', 'other')),
  currency          text NOT NULL REFERENCES currencies (code) ON UPDATE CASCADE,
  original_minor    bigint NOT NULL CHECK (original_minor > 0 AND original_minor <= 10000000000000),
  remaining_minor   bigint NOT NULL CHECK (remaining_minor >= 0 AND remaining_minor <= 10000000000000),
  interest_rate     numeric(6, 3) NOT NULL DEFAULT 0 CHECK (interest_rate BETWEEN 0 AND 1000),   -- APR in percent
  min_payment_minor bigint NOT NULL DEFAULT 0 CHECK (min_payment_minor >= 0),
  due_day           smallint CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31),             -- payment day of each month
  final_due_date    date,
  start_date        date,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid_off', 'archived')),
  paid_off_at       timestamptz,
  notes             text CHECK (notes IS NULL OR length(notes) <= 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
CREATE INDEX debts_user_idx ON debts (user_id, status);
CREATE TRIGGER debts_updated BEFORE UPDATE ON debts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================ transactions
CREATE TABLE transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  account_id      uuid NOT NULL,
  currency        text NOT NULL,
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 10000000000000),
  to_account_id   uuid,
  to_currency     text,
  to_amount_minor bigint CHECK (to_amount_minor IS NULL OR (to_amount_minor > 0 AND to_amount_minor <= 10000000000000)),
  category_id     uuid,
  merchant        text CHECK (merchant IS NULL OR length(merchant) <= 120),
  description     text CHECK (description IS NULL OR length(description) <= 500),
  occurred_on     date NOT NULL CHECK (occurred_on BETWEEN DATE '1970-01-01' AND DATE '2100-12-31'),
  occurred_time   time,
  is_recurring    boolean NOT NULL DEFAULT false,
  recurring_id    uuid,
  subscription_id uuid,
  debt_id         uuid,
  import_batch_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  CONSTRAINT transactions_shape CHECK (
    (type = 'transfer' AND to_account_id IS NOT NULL AND to_currency IS NOT NULL AND to_amount_minor IS NOT NULL AND to_account_id <> account_id AND category_id IS NULL)
    OR (type <> 'transfer' AND to_account_id IS NULL AND to_currency IS NULL AND to_amount_minor IS NULL AND category_id IS NOT NULL)
  ),
  -- an account can only be deleted once its transactions were moved/handled explicitly (RESTRICT)
  FOREIGN KEY (account_id, user_id, currency) REFERENCES accounts (id, user_id, currency) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (to_account_id, user_id, to_currency) REFERENCES accounts (id, user_id, currency) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (recurring_id, user_id) REFERENCES recurring_transactions (id, user_id) ON DELETE SET NULL (recurring_id),
  FOREIGN KEY (subscription_id, user_id) REFERENCES subscriptions (id, user_id) ON DELETE SET NULL (subscription_id),
  FOREIGN KEY (debt_id, user_id) REFERENCES debts (id, user_id) ON DELETE SET NULL (debt_id),
  FOREIGN KEY (import_batch_id, user_id) REFERENCES import_batches (id, user_id) ON DELETE SET NULL (import_batch_id)
);
CREATE INDEX tx_user_date_idx ON transactions (user_id, occurred_on DESC, occurred_time DESC NULLS LAST, created_at DESC);
CREATE INDEX tx_user_account_idx ON transactions (user_id, account_id, occurred_on DESC);
CREATE INDEX tx_to_account_idx ON transactions (to_account_id) WHERE to_account_id IS NOT NULL;
CREATE INDEX tx_user_category_idx ON transactions (user_id, category_id, occurred_on DESC);
CREATE INDEX tx_user_type_date_idx ON transactions (user_id, type, occurred_on);
CREATE INDEX tx_user_merchant_idx ON transactions (user_id, lower(merchant)) WHERE merchant IS NOT NULL;
CREATE INDEX tx_recurring_idx ON transactions (recurring_id) WHERE recurring_id IS NOT NULL;
CREATE INDEX tx_subscription_idx ON transactions (subscription_id) WHERE subscription_id IS NOT NULL;
CREATE INDEX tx_debt_idx ON transactions (debt_id) WHERE debt_id IS NOT NULL;
CREATE INDEX tx_import_idx ON transactions (import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE TRIGGER transactions_updated BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE transaction_splits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL,
  user_id        uuid NOT NULL,
  category_id    uuid NOT NULL,
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 10000000000000),
  note           text CHECK (note IS NULL OR length(note) <= 200),
  sort_order     smallint NOT NULL DEFAULT 0,
  FOREIGN KEY (transaction_id, user_id) REFERENCES transactions (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id) ON DELETE RESTRICT
);
CREATE INDEX splits_tx_idx ON transaction_splits (transaction_id);
CREATE INDEX splits_category_idx ON transaction_splits (user_id, category_id);

-- The parts of a split transaction must always add up to the whole amount (checked at COMMIT, so a
-- transaction and its parts can be written in any order inside one database transaction).
CREATE OR REPLACE FUNCTION check_transaction_splits() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tid uuid; s bigint; n int; a bigint; ty text;
BEGIN
  IF TG_TABLE_NAME = 'transaction_splits' THEN
    tid := COALESCE(NEW.transaction_id, OLD.transaction_id);
  ELSE
    tid := NEW.id;
  END IF;
  SELECT COALESCE(SUM(amount_minor), 0), COUNT(*) INTO s, n FROM transaction_splits WHERE transaction_id = tid;
  SELECT amount_minor, type INTO a, ty FROM transactions WHERE id = tid;
  IF a IS NULL THEN RETURN NULL; END IF;  -- parent row is gone (cascade delete)
  IF n > 0 AND ty = 'transfer' THEN
    RAISE EXCEPTION 'transfers cannot be split' USING ERRCODE = '23514';
  END IF;
  IF n > 0 AND s <> a THEN
    RAISE EXCEPTION 'split amounts (%) must equal the transaction amount (%)', s, a USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER transaction_splits_sum AFTER INSERT OR UPDATE OR DELETE ON transaction_splits
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_transaction_splits();
CREATE CONSTRAINT TRIGGER transactions_splits_sum AFTER UPDATE OF amount_minor, type ON transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_transaction_splits();

CREATE TABLE transaction_tags (
  transaction_id uuid NOT NULL,
  tag_id         uuid NOT NULL,
  user_id        uuid NOT NULL,
  PRIMARY KEY (transaction_id, tag_id),
  FOREIGN KEY (transaction_id, user_id) REFERENCES transactions (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id, user_id) REFERENCES tags (id, user_id) ON DELETE CASCADE
);
CREATE INDEX transaction_tags_tag_idx ON transaction_tags (tag_id);

CREATE TABLE attachments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  transaction_id uuid,
  kind           text NOT NULL DEFAULT 'receipt' CHECK (kind IN ('receipt', 'document')),
  filename       text NOT NULL CHECK (length(filename) <= 255),
  mime_type      text NOT NULL,
  size_bytes     integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  sha256         text NOT NULL,
  storage_key    text NOT NULL UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (transaction_id, user_id) REFERENCES transactions (id, user_id) ON DELETE CASCADE
);
CREATE INDEX attachments_tx_idx ON attachments (transaction_id);
CREATE INDEX attachments_user_idx ON attachments (user_id);

-- ============================================================================ budgets
CREATE TABLE budgets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  period      text NOT NULL CHECK (period IN ('weekly', 'monthly', 'yearly')),
  currency    text NOT NULL REFERENCES currencies (code) ON UPDATE CASCADE,
  notice_pct  smallint NOT NULL DEFAULT 75 CHECK (notice_pct BETWEEN 1 AND 100),
  warning_pct smallint NOT NULL DEFAULT 90 CHECK (warning_pct BETWEEN 1 AND 100),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  CONSTRAINT budgets_thresholds CHECK (notice_pct < warning_pct)
);
CREATE INDEX budgets_user_idx ON budgets (user_id, is_active);
CREATE TRIGGER budgets_updated BEFORE UPDATE ON budgets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE budget_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id    uuid NOT NULL,
  user_id      uuid NOT NULL,
  category_id  uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 10000000000000),
  UNIQUE (budget_id, category_id),
  FOREIGN KEY (budget_id, user_id) REFERENCES budgets (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id) ON DELETE CASCADE
);
CREATE INDEX budget_items_budget_idx ON budget_items (budget_id);

-- ============================================================================ goals & savings
CREATE TABLE financial_goals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name                  text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  kind                  text NOT NULL DEFAULT 'other' CHECK (kind IN ('emergency_fund', 'vacation', 'education', 'car', 'house', 'laptop', 'other')),
  target_minor          bigint NOT NULL CHECK (target_minor > 0 AND target_minor <= 10000000000000),
  current_minor         bigint NOT NULL DEFAULT 0 CHECK (current_minor >= 0 AND current_minor <= 10000000000000),
  currency              text NOT NULL REFERENCES currencies (code) ON UPDATE CASCADE,
  deadline              date,
  planned_monthly_minor bigint CHECK (planned_monthly_minor IS NULL OR planned_monthly_minor >= 0),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  completed_at          timestamptz,
  icon                  text,
  color                 text CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
  notes                 text CHECK (notes IS NULL OR length(notes) <= 500),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
CREATE INDEX goals_user_idx ON financial_goals (user_id, status);
CREATE TRIGGER goals_updated BEFORE UPDATE ON financial_goals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE goal_contributions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id        uuid NOT NULL,
  user_id        uuid NOT NULL,
  amount_minor   bigint NOT NULL CHECK (amount_minor <> 0 AND amount_minor BETWEEN -10000000000000 AND 10000000000000),
  contributed_on date NOT NULL,
  note           text CHECK (note IS NULL OR length(note) <= 200),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (goal_id, user_id) REFERENCES financial_goals (id, user_id) ON DELETE CASCADE
);
CREATE INDEX goal_contributions_goal_idx ON goal_contributions (goal_id, contributed_on DESC);
CREATE INDEX goal_contributions_user_idx ON goal_contributions (user_id, contributed_on DESC);

CREATE TABLE debt_payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id        uuid NOT NULL,
  user_id        uuid NOT NULL,
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  principal_minor bigint NOT NULL CHECK (principal_minor >= 0),
  interest_minor bigint NOT NULL DEFAULT 0 CHECK (interest_minor >= 0),
  paid_on        date NOT NULL,
  transaction_id uuid,
  note           text CHECK (note IS NULL OR length(note) <= 200),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT debt_payments_split CHECK (principal_minor + interest_minor = amount_minor),
  FOREIGN KEY (debt_id, user_id) REFERENCES debts (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_id, user_id) REFERENCES transactions (id, user_id) ON DELETE SET NULL (transaction_id)
);
CREATE INDEX debt_payments_debt_idx ON debt_payments (debt_id, paid_on DESC);
CREATE INDEX debt_payments_user_idx ON debt_payments (user_id, paid_on DESC);

-- ============================================================================ notifications
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('upcoming_bill', 'subscription_payment', 'budget_warning', 'goal_progress', 'unusual_spending', 'low_balance', 'debt_payment', 'security_alert', 'monthly_review')),
  severity    text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'critical')),
  code        text NOT NULL DEFAULT 'default',       -- variant, used with `type` to pick the localised text
  params      jsonb NOT NULL DEFAULT '{}'::jsonb,    -- values interpolated into the localised text
  entity_type text,
  entity_id   uuid,
  dedupe_key  text NOT NULL,
  read_at     timestamptz,
  emailed_at  timestamptz,
  pushed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE notification_preferences (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type    text NOT NULL CHECK (type IN ('upcoming_bill', 'subscription_payment', 'budget_warning', 'goal_progress', 'unusual_spending', 'low_balance', 'debt_payment', 'security_alert', 'monthly_review')),
  in_app  boolean NOT NULL DEFAULT true,
  email   boolean NOT NULL DEFAULT false,
  push    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, type)
);

CREATE TABLE push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- ============================================================================ reports, journal
CREATE TABLE reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind           text NOT NULL DEFAULT 'monthly' CHECK (kind IN ('monthly')),
  period         text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  currency       text NOT NULL REFERENCES currencies (code) ON UPDATE CASCADE,
  data           jsonb NOT NULL,
  auto_generated boolean NOT NULL DEFAULT false,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  viewed_at      timestamptz,
  UNIQUE (user_id, kind, period)
);

-- Journal entries are private: the text is encrypted at rest with a per-user key derived from APP_ENCRYPTION_KEY.
CREATE TABLE journal_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period      text CHECK (period IS NULL OR period ~ '^[0-9]{4}-[0-9]{2}$'),
  prompt_key  text CHECK (prompt_key IS NULL OR length(prompt_key) <= 60),
  content_enc text NOT NULL,
  mood        smallint CHECK (mood IS NULL OR mood BETWEEN 1 AND 5),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journal_user_idx ON journal_entries (user_id, created_at DESC);
CREATE TRIGGER journal_updated BEFORE UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================ dev mailbox (only used with MAIL_TRANSPORT=outbox)
CREATE TABLE mail_outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email   text NOT NULL,
  subject    text NOT NULL,
  text_body  text NOT NULL,
  html_body  text,
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mail_outbox_created_idx ON mail_outbox (created_at DESC);

-- ============================================================================ views
-- One row per "line" of a transaction: a split transaction contributes one line per part, others exactly one line.
-- Category analytics read this view so splits are counted in the right categories.
CREATE VIEW transaction_lines AS
SELECT t.id AS transaction_id, t.user_id, t.type, t.account_id, t.currency, t.occurred_on, t.occurred_time, t.merchant,
       COALESCE(s.category_id, t.category_id) AS category_id,
       COALESCE(s.amount_minor, t.amount_minor) AS amount_minor
FROM transactions t
LEFT JOIN transaction_splits s ON s.transaction_id = t.id AND s.user_id = t.user_id;

-- Current balance of every account: opening balance, plus/minus everything posted against it since.
-- A transfer debits the source account by amount_minor and credits the destination by to_amount_minor
-- (equal unless the two accounts use different currencies).
CREATE VIEW account_balances AS
SELECT a.id AS account_id, a.user_id,
       a.opening_balance_minor + COALESCE(out_tx.total, 0) + COALESCE(in_tx.total, 0) AS balance_minor
FROM accounts a
LEFT JOIN LATERAL (
  SELECT SUM(CASE WHEN type = 'income' THEN amount_minor ELSE -amount_minor END) AS total
  FROM transactions WHERE account_id = a.id
) out_tx ON true
LEFT JOIN LATERAL (
  SELECT SUM(to_amount_minor) AS total FROM transactions WHERE to_account_id = a.id AND type = 'transfer'
) in_tx ON true;

INSERT INTO system_settings (key, value) VALUES
  ('registration_open', 'true'::jsonb),
  ('maintenance_mode', 'false'::jsonb),
  ('demo_enabled', 'true'::jsonb),
  ('announcement', 'null'::jsonb);
