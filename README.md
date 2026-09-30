# FinTrack

**Know your money. Control your future.**

FinTrack is a full personal finance management platform, not a simple expense tracker: income/expense tracking with splits and recurring rules, multi-account and multi-currency support, budgets with rollup-aware alerts, financial goals, subscription and debt management, net worth and forecasting, an AI-optional insights/assistant layer, a receipt scanner, CSV/Excel import-export, PDF reports, and a security posture (real hashed auth, 2FA, sessions, CSRF, tenant-isolated data) built for production, not a demo.

- **Stack:** Fastify 5 (API) + React 19 / Vite 8 (SPA) in one monorepo, PostgreSQL (PGlite for zero-setup dev, real Postgres in production).
- **Languages:** Russian, English, O'zbek — fully localized, switchable in Settings.
- **Currencies:** USD, EUR, GBP, UZS, RUB, KZT, TRY.

## Quick start

Requires Node.js ≥ 22.12. No database server, Docker, or account signup needed for local development — an embedded PostgreSQL (PGlite) is created automatically under `./data/pg`.

```bash
npm install
npm run dev
```

This starts the API on `http://localhost:3001` and the web app on `http://localhost:5173` (which proxies `/api/*` to the API). Open `http://localhost:5173` and either register a real account or click **"Try the demo"** on the login page for an instantly-seeded account with realistic transaction history — no signup, no email verification, expires automatically after `DEMO_TTL_HOURS` (default 24h).

Copy [`.env.example`](.env.example) to `.env` only when you need to go beyond defaults (real email, AI features, a real Postgres instance, production deploy) — every value has a safe development default baked in.

### Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | API + web app together, with hot reload |
| `npm run build` | Production build of both (web app to static assets, API to `server/dist`) |
| `npm start` | Run the production build (`node server/dist/index.js`) |
| `npm test` | Run the full test suite (Vitest: integration, schema, i18n parity) |
| `npm run typecheck` | `tsc --noEmit` across both `server/` and `web/` |
| `npm run db:migrate` / `db:status` / `db:reset` | Apply / inspect / wipe-and-reapply database migrations |
| `npm run admin:create -- --email you@x.com --username admin --password '...'` | Create (or promote) an administrator account |
| `npm run docs:api` | Regenerate [`docs/API.md`](docs/API.md) from the actual route source |

## Project structure

A single npm workspace-free monorepo (`package.json` at the root covers all three):

```
shared/    Pure TypeScript, zero dependencies — money/date helpers, Zod validation schemas, i18n catalogues,
           and every constant/type used by both the server and the browser. If server and web must agree on
           a shape or a rule, it lives here so they cannot drift apart.
server/    Fastify 5 API — auth, every domain module (transactions, budgets, goals, debts, …), the database
           layer (server/src/db), and the SQL migrations (server/src/db/migrations).
web/       React 19 SPA — pages, the component/design-system library, and the client-side data layer
           (TanStack Query + a thin fetch wrapper).
docs/      This project's own documentation (API reference, database schema, security, QA).
scripts/   Small standalone tools, e.g. the API-doc generator.
```

## Documentation

- [`docs/API.md`](docs/API.md) — every HTTP endpoint (auto-generated from the route source via `npm run docs:api`, so it can't drift out of date).
- [`docs/DATABASE.md`](docs/DATABASE.md) — the schema: design rules, what each of the 36 tables is for, and how tenant isolation is enforced at the database level, not just in application code.
- [`docs/SECURITY.md`](docs/SECURITY.md) — passwords, sessions, CSRF, 2FA, encryption at rest, rate limiting: what's actually implemented, with the file/function that implements it.
- [`docs/QA.md`](docs/QA.md) — an honest account of what was tested, what was found and fixed during that testing, and the known, deliberately-scoped gaps that remain.

## What's inside

**Money, day to day** — transactions with splits and attachments, recurring rules, 8 account types with transfers, a category tree with icons/colors and rollup-aware budgets (a "Food" budget counts spending in Groceries/Restaurants/Coffee automatically), tags, a financial calendar, and a spending heatmap.

**Planning ahead** — financial goals with a computed required monthly/weekly contribution, subscription tracking with an evidence-based "possibly unused" audit (never inferred from absence of data alone), debt tracking with snowball/avalanche/minimum-only payoff projections, net worth reconstructed over time (not just snapshotted going forward), and a balance forecast and "money simulator" for what-if scenarios — both explicitly labeled as estimates, never as guarantees.

**Understanding it** — an analytics dashboard, a transparent financial health score (every contributing factor and its weight is shown, not a black-box number), a "where did my money go" flow view, a monthly review, and AI-optional insights and an assistant that explain *what* happened, *why* it might matter, and *what options* exist — never a promised return, never a forecast presented as fact. All of this works fully without an `ANTHROPIC_API_KEY` configured, via a deterministic rule-based engine; a key only adds an LLM-phrased layer on top for users who opt in (`profiles.ai_consent`).

**Getting data in and out** — a receipt scanner (OCR runs entirely in the browser via `tesseract.js`; the image itself is only uploaded once you confirm and save), CSV/Excel import with column-mapping, duplicate detection, and an undoable batch history, CSV/Excel export, and a PDF monthly report.

**Account & security** — a 5-step registration with realtime email/username/password-strength feedback, email verification, TOTP 2FA with backup codes, a Security Center (sessions, devices, login history, security alerts), account deletion with a grace period and a data export offer, and a Privacy Center that shows exactly what's stored and lets you download all of it as JSON.

**For operators** — a role-gated admin panel (user/security/audit views), every privileged action written to an append-only audit log, and platform-wide settings (registration open/closed, maintenance mode, an announcement banner).

## A few honest notes

- This is a from-scratch build without a design reference — the UI is original, not a clone of an existing product.
- AI features degrade gracefully to fully rule-based behavior with no `ANTHROPIC_API_KEY` set; nothing in the app requires one.
- See [`docs/QA.md`](docs/QA.md) for the handful of known, small scope limitations found during testing (e.g. a couple of report/search surfaces that don't yet localize a default category's translated name) — every one of them is a cosmetic gap, not a functional or security one, and every genuine bug found during QA was fixed, not just logged.
