/**
 * Generates docs/API.md by statically scanning server/src/http/routes/*.ts for registered Fastify routes.
 * Run with `npm run docs:api`. This walks the actual source rather than hand-maintaining a list, so the
 * generated reference can never drift out of sync with what the server really exposes — if a route is
 * added, renamed, or removed, re-running this script picks it up automatically.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROUTES_DIR = path.resolve(import.meta.dirname, '../server/src/http/routes');
const OUT_FILE = path.resolve(import.meta.dirname, '../docs/API.md');

interface RouteEntry {
  method: string;
  routePath: string;
  file: string;
  auth: string;
  line: number;
}

/** Auth guards used across routes, in the order most-specific first so `requireAdminSecure` doesn't get missed by a looser check. */
const AUTH_GUARDS: { pattern: RegExp; label: string }[] = [
  { pattern: /requireAdminSecure/, label: 'Admin (step-up 2FA required if configured)' },
  { pattern: /requireAdmin\b/, label: 'Admin' },
  { pattern: /requireVerified/, label: 'Signed in, verified email' },
  { pattern: /requireAuth\b/, label: 'Signed in' },
];

function titleCase(segment: string): string {
  return segment.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "a Account" -> "an Account" — cheap enough to just special-case rather than pull in a real indefinite-article rule. */
function withArticle(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/** Naive plural -> singular for path-derived resource names ("Categories" -> "Category", "Boxes" would need its own rule too but nothing here ends in -x/-ch/-sh). */
function singularize(noun: string): string {
  if (/ies$/.test(noun)) return noun.replace(/ies$/, 'y');
  return noun.replace(/s$/, '');
}

/** Turns a route into readable prose purely from its shape — no per-route hand-written strings to keep in sync. */
function describeRoute(method: string, routePath: string): string {
  const parts = routePath.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const isParam = (s: string | undefined) => !!s && s.startsWith(':');
  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];

  // .../:id/verb (e.g. POST /api/debts/:id/payments, POST /api/security/2fa/setup)
  if (last && !isParam(last) && (isParam(secondLast) || parts.length >= 2)) {
    const resource = titleCase(parts.filter((p) => !isParam(p)).slice(0, -1).join(' ') || parts[0] || '');
    const action = titleCase(last);
    if (method === 'GET') return `${action} for ${withArticle(resource || 'resource')}`;
    if (method === 'POST') return `${action} (${resource})`;
    if (method === 'PUT' || method === 'PATCH') return `Update ${action.toLowerCase()} (${resource})`;
    if (method === 'DELETE') return `Remove ${action.toLowerCase()} (${resource})`;
  }
  const resource = titleCase(parts.filter((p) => !isParam(p)).join(' '));
  const hasId = parts.some(isParam);
  switch (method) {
    case 'GET':
      return hasId ? `Get ${withArticle(singularize(resource))}` : `List ${resource}`;
    case 'POST':
      return `Create ${withArticle(singularize(resource))}`;
    case 'PUT':
    case 'PATCH':
      return `Update ${withArticle(singularize(resource))}`;
    case 'DELETE':
      return `Delete ${withArticle(singularize(resource))}`;
    default:
      return resource;
  }
}

function scanFile(file: string): RouteEntry[] {
  const full = path.join(ROUTES_DIR, file);
  const text = readFileSync(full, 'utf8');
  const entries: RouteEntry[] = [];
  // Matches app.get('/api/x', ...), including the common multi-line form where the path sits on its own line.
  const re = /\bapp\.(get|post|put|patch|delete)\(\s*[\r\n]?\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const method = m[1]!.toUpperCase();
    const routePath = m[2]!;
    const line = text.slice(0, m.index).split('\n').length;
    // Look at the handler body: from this match up to the next route registration (or end of file),
    // capped so an unrelated later route's guard call can't bleed into this one's auth label.
    const nextIdx = text.slice(m.index + 1).search(/\bapp\.(get|post|put|patch|delete)\(/);
    const bodyEnd = nextIdx === -1 ? text.length : m.index + 1 + nextIdx;
    const body = text.slice(m.index, Math.min(bodyEnd, m.index + 4000));
    const auth = AUTH_GUARDS.find((g) => g.pattern.test(body))?.label ?? 'Public (no session required)';
    entries.push({ method, routePath, file, auth, line });
  }
  return entries;
}

function main() {
  const files = readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort();

  const byFile = new Map<string, RouteEntry[]>();
  for (const file of files) {
    const entries = scanFile(file);
    if (entries.length) byFile.set(file, entries.sort((a, b) => a.line - b.line));
  }

  const totalRoutes = [...byFile.values()].reduce((n, list) => n + list.length, 0);
  const lines: string[] = [];
  lines.push('# FinTrack API Reference');
  lines.push('');
  lines.push(`_Generated by \`npm run docs:api\` from the route source in \`server/src/http/routes/\` — ${totalRoutes} endpoints across ${byFile.size} resource files. Do not hand-edit; re-run the script after changing routes._`);
  lines.push('');
  lines.push('## Conventions');
  lines.push('');
  lines.push('- Base URL: `/api` (the dev server proxies this from the Vite origin to `http://127.0.0.1:3001`).');
  lines.push('- All request/response bodies are JSON; money fields are integer **minor units** (cents), never floats.');
  lines.push('- Authenticated requests use an httpOnly session cookie (`ft_session`) set by `/api/auth/login`, `/api/auth/register`, or `/api/auth/demo` — there is no bearer-token mode.');
  lines.push('- Every state-changing request (POST/PUT/PATCH/DELETE) must echo the `ft_csrf` cookie value back as an `X-CSRF-Token` header (double-submit CSRF) and originate from an allow-listed Origin.');
  lines.push('- A validation failure returns `400` with a machine-readable `{ error: { code, issues } }` shape (`shared/schemas/common.ts`), which the web app maps to a localized message per field.');
  lines.push('- "Admin (step-up 2FA required if configured)" means the `ADMIN_REQUIRE_2FA` setting (defaults to on in production) additionally requires the session to have completed 2FA this login.');
  lines.push('');

  for (const [file, entries] of byFile) {
    const title = titleCase(file.replace(/\.ts$/, ''));
    lines.push(`## ${title}`);
    lines.push('');
    lines.push(`_${file}_`);
    lines.push('');
    lines.push('| Method | Path | Auth | Description |');
    lines.push('|---|---|---|---|');
    for (const e of entries) {
      lines.push(`| ${e.method} | \`${e.routePath}\` | ${e.auth} | ${describeRoute(e.method, e.routePath)} |`);
    }
    lines.push('');
  }

  writeFileSync(OUT_FILE, lines.join('\n'), 'utf8');
  console.log(`Wrote ${OUT_FILE} (${totalRoutes} routes across ${byFile.size} files).`);
}

main();
