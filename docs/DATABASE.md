# Database Schema

FinTrack's schema lives in one file, [`server/src/db/migrations/0001_initial.sql`](../server/src/db/migrations/0001_initial.sql) — that file is the ground truth (every column, constraint, and index); this document explains *why* it's shaped the way it is and how the 36 tables relate. Run `npm run db:status` to see which migrations have been applied, and `npm run db:migrate` to apply new ones (each migration file runs as one atomic multi-statement transaction).

The same SQL runs against two engines behind one `Db`/`Queryable` abstraction (`server/src/db/index.ts`): **PGlite** (real Postgres compiled to WASM, stored under `./data/pg`) for zero-setup local dev and for tests (in-memory), and real **PostgreSQL 14+** via `pg` in production (`DATABASE_URL`). Rows always come back with camelCase keys, regardless of which engine answered the query.

## Design rules

1. **Money is an integer, never a float.** Every amount column is `bigint … _minor` — minor currency units (cents), matching what `shared/src/money.ts` and every domain function expect. A `$47.99` total is stored as `4799`.
2. **A row can never point at another user's data, even from a bug.** Almost every foreign key is **composite** — it includes `user_id` (and `currency`, where two sides of a relationship must share a currency), e.g. `FOREIGN KEY (account_id, user_id, currency) REFERENCES accounts (id, user_id, currency)`. If application code somehow passed the wrong `user_id` alongside a real `account_id` belonging to *someone else*, the insert fails at the database — cross-tenant access isn't just checked in a `WHERE` clause, it's structurally impossible. This is the second line of defense behind the application-level ownership checks every route already performs.
3. **Enumerations are `text` + `CHECK`, not native Postgres `ENUM` types.** Adding a value is a plain migration (`DROP CONSTRAINT` / `ADD CONSTRAINT`) instead of the more disruptive `ALTER TYPE` dance, at the cost of the check living in the schema rather than the type system.
4. **`timestamptz` for instants, `date` for business dates.** A transaction's `occurred_on` is a calendar date with no timezone attached (it happened "on September 29", not at a specific instant) — `created_at`/`updated_at`/session expiries etc. are `timestamptz`, always stored and compared in UTC.
5. **A split transaction's parts must sum to the whole, checked at COMMIT.** `transaction_splits`' sum constraint is a `DEFERRABLE INITIALLY DEFERRED` constraint trigger, so a transaction and its split rows can be inserted in one round trip in either order within a single DB transaction, and only the final, committed state is validated.

## Identity & security

| Table | Purpose |
|---|---|
| `users` | Core account row: email/username (case-insensitively unique), Argon2id `password_hash`, `role` (`user`/`admin`), `status` (`active`/`suspended`/`pending_deletion`), demo-account flags, ToS/privacy acceptance timestamps. |
| `profiles` | 1:1 with `users` — display name, country, main currency, language/theme/timezone/week-start preferences, and the 12-question onboarding answers (`income_source`, `expense_focus`, `main_goal`, …) plus `onboarding_completed_at`. |
| `user_totp` | The TOTP secret for 2FA, **AES-256-GCM encrypted** (`APP_ENCRYPTION_KEY`) — never stored in plaintext. `last_used_step` blocks replaying the same code twice. |
| `backup_codes` | One-time 2FA recovery codes, stored as HMAC-SHA256 hashes (shown to the user once, at generation time, never again). |
| `email_tokens` | Single-use, hashed (SHA-256) tokens for e-mail verification and password reset, with an expiry. |
| `user_devices` | A recognized browser/device per user (hashed device cookie), used to decide whether a login is a "new device" worth alerting about. |
| `sessions` | A logged-in session: **hashed** session and CSRF tokens (a DB leak doesn't leak live sessions), sliding `expires_at` plus a hard `absolute_expires_at` ceiling, device/IP/geo metadata, and a `revoked_at`/`revoked_reason` pair for "log out this device" / "log out everywhere". |
| `login_challenges` | The gap between "password was correct" and "2FA code confirmed" — a short-lived, hashed, attempt-limited row. |
| `security_events` | Per-user timeline shown in the Security Center (login, password change, 2FA toggle, new-device alert, data export, …) — also what the admin panel's audit view reads. |
| `rate_limits` | Generic atomic-UPSERT counter (`key`, `count`, `window_start`, `blocked_until`) backing every rate-limited endpoint (login, password reset, registration checks, …). |
| `audit_logs` | Append-only (a trigger blocks `UPDATE`/`DELETE`/`TRUNCATE` outright) log of privileged actions — admin actions, account deletion, etc. No foreign key to `users` on purpose: entries must outlive a deleted account, and only ever store the user id, never e-mail or financial data. |

## Money domain

| Table | Purpose |
|---|---|
| `currencies` / `exchange_rates` | The 7 supported currencies (USD/EUR/GBP/UZS/RUB/KZT/TRY) and their rate-per-USD, used to convert everything into a user's main currency for net worth, dashboards, etc. |
| `accounts` | The 8 account types (cash, bank, debit/credit card, savings, investment, crypto, other), an opening balance, and `include_in_net_worth`. Current balance is *derived*, not stored — see the `account_balances` view below. |
| `categories` | A user's category tree (one level of nesting via `parent_id`). A **default** category has `system_key` set and `name` NULL — the UI resolves its label from the key through the active-language catalogue (`categoryNames.*`); a user-renamed or custom category has `name` set instead. `category_templates` is the admin-managed list copied into every new user's own tree at signup — editing a template only affects future signups. |
| `tags` | Free-form per-user labels, many-to-many with transactions via `transaction_tags`. |
| `transactions` | The core ledger row: income, expense, or transfer. A `CHECK` constraint (`transactions_shape`) enforces the two valid shapes — a transfer has a destination account/currency/amount and no category; anything else has a category and no destination. Optional links back to the recurring rule / subscription / debt / import batch that produced it. |
| `transaction_splits` | Splits one transaction's amount across several categories; a constraint trigger (see rule 5 above) keeps the parts summing to the whole. |
| `attachments` | Receipt images/documents attached to a transaction — filename, size, SHA-256, and a `storage_key` (the actual bytes live on disk/object storage, not in the row). |
| `import_batches` | One row per CSV/Excel import, tracking row counts and the column mapping used, so an entire import can be undone as a unit. |
| `recurring_transactions` | A repeating rule (frequency + interval), generating a `next_due_date`; `auto_confirm` opts into posting it automatically on the due date — it never moves money without that explicit, per-rule opt-in. |
| `subscriptions` | Recurring *bills* specifically — price/cycle/next payment date, `last_used_on` (the evidence behind the "possibly unused" audit — never inferred from silence), reminder lead time. |
| `debts` | A loan/credit-card/mortgage/personal balance: original vs. remaining, APR, minimum payment — feeds the snowball/avalanche payoff calculator. |
| `debt_payments` / `goal_contributions` | Ledger of payments against a debt (split into principal vs. interest, `CHECK`-enforced to sum to the payment) and contributions toward a goal. |
| `budgets` / `budget_items` | A budget has a period (weekly/monthly/yearly) and alert thresholds (`notice_pct` < `warning_pct`, enforced); each `budget_item` allocates an amount to one category — spending against a *parent* category budget rolls up its subcategories at query time. |
| `financial_goals` | Target/current amount, optional deadline and planned monthly contribution, used to compute the "required monthly savings" shown in the UI. |

## Notifications, reports, journal

| Table | Purpose |
|---|---|
| `notifications` / `notification_preferences` | In-app notification feed (`dedupe_key` prevents duplicate alerts for the same underlying event) and the per-type × per-channel (in-app/email/push) opt-in matrix shown in Settings. |
| `push_subscriptions` | Web Push subscription endpoints (`web-push` / VAPID), one row per browser that opted in. |
| `reports` | A generated monthly review, cached as `jsonb` so it reads identically whether opened live or a year later; also what the PDF export renders from. |
| `journal_entries` | Private free-text notes — `content_enc` is encrypted at rest with a per-user key derived from `APP_ENCRYPTION_KEY`, so even a full database dump doesn't expose journal contents. |
| `mail_outbox` | Only populated when `MAIL_TRANSPORT=outbox` (dev/test) — every email the app "sent" is captured here instead of going anywhere, and is what `/api/dev/mailbox` and the integration tests read from. |
| `system_settings` | A small `key`/`value jsonb` table for admin-tunable, platform-wide flags (`registration_open`, `maintenance_mode`, `demo_enabled`, `announcement`). |

## Views

- **`transaction_lines`** — one row per "line" of a transaction: a split transaction contributes one row per split part (with that part's own category and amount), everything else contributes exactly one row equal to the transaction itself. Every category-spend query (analytics, budgets, insights) reads this view rather than `transactions` directly, so split amounts land in the right category instead of all being attributed to the parent transaction's own (or absent) category.
- **`account_balances`** — an account's current balance, computed as its opening balance plus every transaction posted against it since (outgoing income/expense, plus incoming transfer credits from other accounts). Balances are never stored redundantly on the account row, so there's nothing to fall out of sync.

## Adding a migration

Add a new numbered file to `server/src/db/migrations/` (e.g. `0002_add_thing.sql`); `migrate()` (`server/src/db/migrate.ts`) applies any file not yet recorded, each as one atomic statement, in filename order. Never edit `0001_initial.sql` once it has shipped to any real environment — add a follow-up migration instead.
