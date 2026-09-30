# Security

This document describes what FinTrack actually does to protect accounts and data — every mechanism named here is implemented in the code paths cited, not aspirational. If you find a discrepancy between this document and the code, the code is right and this file needs a fix.

## Reporting a vulnerability

This is a demo/portfolio project rather than a service with a live security contact — if you're evaluating it as a reference, treat any issue you find as something to fix directly rather than to responsibly disclose.

## Passwords

- Hashed with **Argon2id** (`@node-rs/argon2`), never reversible and never logged. Cost parameters are configurable (`ARGON2_MEMORY_KIB`, default 19 MiB; `ARGON2_TIME_COST`, default 2) and deliberately lowered only for the test suite, never in `development`/`production`.
- Policy (`shared/src/password.ts`): **12–128 characters**, must include uppercase, lowercase, a digit, and a symbol, and is checked against a list of common/breached patterns ("password", "qwerty", "123456", keyboard walks, …) — a password that merely meets the character-class rule but matches a common pattern is still rejected, with the specific reason shown to the user, not a generic "weak password".
- Registration's realtime strength meter and the server's final check run the **same** policy function, so nothing accepted by the UI can be rejected later, or vice versa.
- Changing a password (`POST /api/security/change-password`) requires the current password, re-hashes with fresh Argon2id parameters, and by default revokes every other session — a stolen password is useless the moment the real owner changes it.

## Sessions & cookies

- On login/registration the server issues three cookies, all `httpOnly`, `SameSite=Lax`, and `Secure` whenever `COOKIE_SECURE` (defaults to on in production) is set:
  - `ft_session` — a random 32-byte token; only its **SHA-256 hash** is stored (`sessions.token_hash`), so a database read (backup, replica, leak) cannot be turned into a working session.
  - `ft_csrf` — a random 24-byte token, double-submitted back as the `X-CSRF-Token` header on every state-changing request (see CSRF below); its hash is stored the same way.
  - `ft_device` — a long-lived, low-sensitivity device fingerprint (also hashed at rest) used only to recognize "you've logged in from this browser before" and alert on genuinely new devices.
- **Two expiries, not one** (`server/src/auth/session.ts`): a sliding idle window (12h, or 30d with "remember me") that a request pushes forward, capped by a hard **absolute** ceiling (7d, or 90d with "remember me") that no amount of activity extends — a stolen, still-being-used session still dies on schedule.
- The idle-window refresh is throttled to once per 5 minutes of activity, so every authenticated request isn't also a database write.
- The Security Center lists every active session (browser/OS/device type/IP/country/last-active) and can revoke one device or "log out everywhere except here" (`revokeSessionByToken` / `revokeOtherSessions` / `revokeAllSessions`) — revocation is immediate (`revoked_at` is checked on every session lookup, not just at next expiry).
- A login from a device the fingerprint table hasn't seen in the last 180 days triggers a "new device" security event and email, independent of whether the password was correct.

## CSRF

Two independent layers (`server/src/http/plugins/csrf.ts`), both required for any state-changing (non-GET/HEAD/OPTIONS) request to `/api/*`:

1. **Origin allow-listing.** If the request carries an `Origin` header, it must exactly match `APP_URL` or an entry in `ALLOWED_ORIGINS` — checked before the request reaches any route handler, including pre-login ones like `/api/auth/login`.
2. **Double-submit CSRF token.** Once a session exists, the `X-CSRF-Token` header must match the session's own token (compared by hash). The token cookie is deliberately *not* `httpOnly` — the frontend reads it and echoes it back — but it never leaves the app's own origin, so a cross-site page cannot obtain it to forge a request even if the Origin check somehow didn't apply.

A short, explicit exemption list (registration, login, password reset request/confirm, email verification, demo login) covers the endpoints that legitimately run *before* a session — and therefore a CSRF token — exists; the Origin check still applies to all of them.

## Two-factor authentication (TOTP)

- RFC 6238 TOTP, hand-implemented (`server/src/crypto.ts`) rather than pulled from an unaudited dependency — standard 30-second step, 6 digits.
- The shared secret is encrypted at rest with **AES-256-GCM** under `APP_ENCRYPTION_KEY` (`user_totp.secret_enc`); it is never stored or logged in plaintext, and is only decrypted in-memory to verify a submitted code.
- **Replay protection**: `last_used_step` records the TOTP step of the last code accepted, and that exact step is refused a second time even within its 30-second validity window.
- Setup requires the current password before a QR code is even issued, and again before the setup completes (`confirmTwoFactorSetup`) — a session hijacked *after* login cannot silently turn on/off 2FA.
- **10 single-use backup codes** are generated at setup, shown exactly once, and stored as HMAC-SHA256 hashes (never recoverable, only re-generatable, which invalidates all previous ones).
- Login with 2FA enabled is two steps: password creates a short-lived, attempt-limited `login_challenges` row; only a correct TOTP or backup code against *that specific* challenge completes the login.
- Admin accounts can additionally require a **2FA-verified session** for privileged routes (`requireAdminSecure`, gated by `ADMIN_REQUIRE_2FA`, on by default in production) — being `role = 'admin'` alone isn't sufficient in prod if 2FA hasn't been completed this login.

## Authorization & tenant isolation

- Every route that reads or writes a user's own data resolves the session first (`requireAuth`/`requireVerified`) and scopes every query by that session's `user_id` — there is no endpoint that accepts a bare resource id without also filtering on the caller's own id.
- That's defense layer one (application code). Layer two is **structural**, at the database: almost every foreign key across the schema is a **composite** key that includes `user_id` (e.g. `FOREIGN KEY (account_id, user_id, currency) REFERENCES accounts (id, user_id, currency)` — see [`docs/DATABASE.md`](DATABASE.md)). If a bug ever let a request's own `user_id` reach an `INSERT`/`UPDATE` alongside a resource id belonging to *another* user, the write fails at the database, not just at the application's own logic. Manipulating an id in a request cannot cross the tenant boundary even if the ownership check above it were somehow skipped.
- Admin routes (`/api/admin/*`) are role-gated server-side; the admin UI is hidden client-side for non-admins, but that's a UX nicety — every admin route independently re-checks the role (and, per above, optionally step-up 2FA) on the server.
- Every privileged action (suspend/unsuspend a user, change a role, edit a category template, edit a platform setting) is written to the **append-only** `audit_logs` table — a database trigger rejects `UPDATE`/`DELETE`/`TRUNCATE` on it outright, so a compromised admin session can act, but cannot cover its tracks by editing the log.

## Rate limiting

A single atomic-UPSERT counter table (`rate_limits`) backs every rate-limited endpoint — login attempts, registration availability checks, password-reset requests, TOTP verification — each keyed by its own identifier (IP, account, or both) so one user's activity can't lock out another's. `RATE_LIMIT_DISABLED` exists only for the test suite; it is never set in development or production.

## Secrets & encryption at rest

- `APP_ENCRYPTION_KEY` (32 random bytes, base64) is the one secret the operator supplies; the server derives two independent values from it (`server/src/config.ts`) rather than reusing it directly — cookie-signing and secret-at-rest encryption use different derived keys, so a weakness in one use can't be leveraged against the other.
- Encrypted at rest under that key: **2FA TOTP secrets** and **journal entries** (private free-text notes — encrypted precisely because they're the one place a user might write something they'd never want exposed even in a full database dump).
- In `production`, the app refuses to start without an explicit `APP_ENCRYPTION_KEY` — there is no silent fallback to a guessable or ephemeral key. In `development`, a key is generated once and cached in `data/.dev-key` (0600 permissions, gitignored) purely for convenience.
- No API keys, database credentials, or encryption keys are ever sent to the browser — the `web/` bundle contains no secret values, only the public Vite-time config (API base path, public VAPID key for push, etc.).

## Transport & headers

- `@fastify/helmet` sets the standard hardening header set; `crossOriginResourcePolicy: 'same-site'` restricts who can embed the app's own responses.
- Cookies are `Secure` in production (refused to work over plain HTTP by design — see the startup warning in `config.ts` if `APP_URL` isn't `https://`).
- `trustProxy` is explicit and off by default; enable it only when actually running behind a reverse proxy that sets `X-Forwarded-*` honestly, so IP-based rate limiting and security-event logging see the real client IP rather than trusting a header any client could otherwise forge.

## Input validation

- Every request body/query/params pair is validated with a **Zod** schema (`server/src/http/route.ts`'s `defineRoute` wrapper) before a handler ever sees it — there is no route that trusts unvalidated input.
- The same schemas (`shared/`) run in the browser for live field-level feedback, so the client-side and server-side rules are guaranteed identical by construction, not by two implementations kept manually in sync.
- A validation failure never leaks internals: it returns a structured `{ code, issues }` shape the frontend maps to a localized, field-specific message.

## What FinTrack deliberately never does

- Never stores a password, TOTP secret, or backup code in a recoverable/plaintext form.
- Never asks for or stores a real banking password, card PIN, or card number — the Privacy Center says this explicitly to every user.
- Never moves money (records a transaction, marks a recurring rule "auto-confirm", executes an import) without an explicit action the user took — there is no background job that touches a ledger without a rule the user itself created and can see, edit, or delete.
- Never sends a secret key, database credential, or the AI provider's API key to the browser.
- Never presents an AI-generated forecast, insight, or assistant answer as certain or as investment/financial advice — every such surface carries an explicit disclaimer, and none of them are required for the app's core functionality (see the "no AI, still works" fallback behavior described in the main [README](../README.md)).
