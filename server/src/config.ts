import { z } from 'zod';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Load .env for local development (Node built-in). Real environments inject variables directly.
try {
  process.loadEnvFile(path.resolve(process.cwd(), '.env'));
} catch {
  /* no .env file — fine */
}

const bool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === true || ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),
  /** Public origin of the app. Used for e-mail links and the CSRF Origin check. */
  APP_URL: z.string().default('http://localhost:5173'),
  /** Extra origins allowed to call the API with cookies (comma separated). Normally empty (same-origin). */
  ALLOWED_ORIGINS: z.string().default(''),
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: bool(false),
  // Each serverless instance opens its own pool — keep this small there (e.g. 3) and point DATABASE_URL at
  // a connection pooler (e.g. Supabase's PgBouncer port), or many concurrent cold starts can exhaust the
  // database's own connection limit. The long-running server (npm run dev / start) is fine at the default.
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  PGLITE_DIR: z.string().default('./data/pg'),
  ALLOW_EMBEDDED_DB: bool(false),
  APP_ENCRYPTION_KEY: z.string().optional(),
  COOKIE_SECURE: z.string().optional(),
  TRUST_PROXY: z.string().default('false'),
  MAIL_TRANSPORT: z.enum(['smtp', 'outbox', 'log']).optional(),
  MAIL_FROM: z.string().default('FinTrack <no-reply@fintrack.local>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: bool(false),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  FX_AUTO_UPDATE: bool(true),
  FX_API_URL: z.string().default('https://open.er-api.com/v6/latest/USD'),
  ADMIN_REQUIRE_2FA: z.string().optional(),
  ACCOUNT_DELETION_GRACE_DAYS: z.coerce.number().int().min(0).max(90).default(14),
  DEMO_ENABLED: bool(true),
  DEMO_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  SCHEDULER_ENABLED: bool(true),
  RATE_LIMIT_DISABLED: bool(false),
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(1024).default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().min(1).default(2),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5'),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@fintrack.local'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SEED_ADMIN_EMAIL: z.string().optional(),
  SEED_ADMIN_USERNAME: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const i of parsed.error.issues) console.error(`  ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}
const env = parsed.data;

const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

/** In development a key is generated once and kept in ./data (never used in production). */
function resolveEncryptionKey(): Buffer {
  const fromEnv = env.APP_ENCRYPTION_KEY?.trim();
  if (fromEnv) {
    const buf = Buffer.from(fromEnv, 'base64');
    if (buf.length !== 32) {
      console.error('APP_ENCRYPTION_KEY must be 32 random bytes, base64-encoded (e.g. `openssl rand -base64 32`).');
      process.exit(1);
    }
    return buf;
  }
  if (isProd) {
    console.error('APP_ENCRYPTION_KEY is required in production.');
    process.exit(1);
  }
  if (isTest) return crypto.createHash('sha256').update('fintrack-test-key').digest();
  const file = path.resolve(process.cwd(), 'data', '.dev-key');
  try {
    return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  } catch {
    const key = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
    return key;
  }
}

const appUrl = env.APP_URL.replace(/\/+$/, '');
const trustProxyRaw = env.TRUST_PROXY.trim().toLowerCase();
const encryptionKey = resolveEncryptionKey();

export const config = {
  env: env.NODE_ENV,
  isProd,
  isTest,
  isDev: !isProd && !isTest,
  port: env.PORT,
  host: env.HOST,
  appUrl,
  allowedOrigins: [appUrl, ...env.ALLOWED_ORIGINS.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)],
  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL,
  dbPoolMax: env.DB_POOL_MAX,
  pgliteDir: path.resolve(process.cwd(), env.PGLITE_DIR),
  allowEmbeddedDb: env.ALLOW_EMBEDDED_DB,
  encryptionKey,
  // Derived, not reused directly: cookie signing and secret-at-rest encryption should not share one raw key.
  cookieSigningSecret: crypto.createHash('sha256').update(Buffer.concat([encryptionKey, Buffer.from('fintrack-cookie-signing')])).digest('base64url'),
  cookieSecure: env.COOKIE_SECURE === undefined ? isProd : ['1', 'true', 'yes'].includes(env.COOKIE_SECURE.toLowerCase()),
  // Fastify's trustProxy accepts true/false/string/string[] — a bare hop-count number is passed through as
  // its string form so it still reaches @fastify/proxy-addr's numeric-hops handling.
  trustProxy: (trustProxyRaw === 'true' ? true : trustProxyRaw === 'false' || trustProxyRaw === '' ? false : env.TRUST_PROXY) as string | boolean,
  mail: {
    transport: env.MAIL_TRANSPORT ?? (isProd ? 'smtp' : isTest ? 'log' : 'outbox'),
    from: env.MAIL_FROM,
    smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, secure: env.SMTP_SECURE },
  },
  uploadDir: path.resolve(process.cwd(), env.UPLOAD_DIR),
  fxAutoUpdate: env.FX_AUTO_UPDATE && !isTest,
  fxApiUrl: env.FX_API_URL,
  adminRequire2fa: env.ADMIN_REQUIRE_2FA === undefined ? isProd : ['1', 'true', 'yes'].includes(env.ADMIN_REQUIRE_2FA.toLowerCase()),
  accountDeletionGraceDays: env.ACCOUNT_DELETION_GRACE_DAYS,
  demoEnabled: env.DEMO_ENABLED,
  demoTtlHours: env.DEMO_TTL_HOURS,
  schedulerEnabled: env.SCHEDULER_ENABLED && !isTest,
  rateLimitDisabled: env.RATE_LIMIT_DISABLED,
  argon2: { memoryCost: isTest ? 1024 : env.ARGON2_MEMORY_KIB, timeCost: isTest ? 1 : env.ARGON2_TIME_COST },
  ai: { apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL },
  vapid: { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT },
  logLevel: isTest ? 'silent' : env.LOG_LEVEL,
  seedAdmin: { email: env.SEED_ADMIN_EMAIL, username: env.SEED_ADMIN_USERNAME, password: env.SEED_ADMIN_PASSWORD },
} as const;

export type Config = typeof config;

if (config.isProd) {
  if (!config.appUrl.startsWith('https://')) console.warn('[config] APP_URL is not https — cookies are marked Secure and will not work over plain http.');
  if (!config.databaseUrl && !config.allowEmbeddedDb) {
    console.error('DATABASE_URL is required in production (set ALLOW_EMBEDDED_DB=true only for single-node demos).');
    process.exit(1);
  }
}
