import type { Db } from '../db/index';
import { config } from '../config';

export interface RateLimitRule {
  /** logical bucket name, combined with the caller-supplied key, e.g. "login", "register", "verify_email" */
  name: string;
  max: number;
  windowMs: number;
  /** how long a key stays blocked once it exceeds `max` inside one window */
  blockMs: number;
}

export const RATE_LIMITS = {
  login: { name: 'login', max: 8, windowMs: 10 * 60_000, blockMs: 15 * 60_000 },
  loginIp: { name: 'login_ip', max: 30, windowMs: 10 * 60_000, blockMs: 15 * 60_000 },
  twoFactor: { name: '2fa', max: 6, windowMs: 10 * 60_000, blockMs: 15 * 60_000 },
  register: { name: 'register', max: 6, windowMs: 60 * 60_000, blockMs: 60 * 60_000 },
  registerIp: { name: 'register_ip', max: 20, windowMs: 60 * 60_000, blockMs: 60 * 60_000 },
  demo: { name: 'demo', max: 10, windowMs: 60 * 60_000, blockMs: 60 * 60_000 },
  forgotPassword: { name: 'forgot_password', max: 5, windowMs: 60 * 60_000, blockMs: 30 * 60_000 },
  resendVerification: { name: 'resend_verify', max: 5, windowMs: 60 * 60_000, blockMs: 30 * 60_000 },
  usernameCheck: { name: 'username_check', max: 60, windowMs: 60_000, blockMs: 60_000 },
  apiWrite: { name: 'api_write', max: 240, windowMs: 60_000, blockMs: 2 * 60_000 },
  aiAssistant: { name: 'ai_assistant', max: 30, windowMs: 60_000, blockMs: 60_000 },
  receiptScan: { name: 'receipt_scan', max: 20, windowMs: 60_000, blockMs: 2 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Atomic fixed-window rate limiter backed by the `rate_limits` table (one UPSERT, safe under concurrency,
 * and shared across every server process — unlike an in-memory limiter).
 */
export async function checkRateLimit(db: Db, rule: RateLimitRule, subject: string): Promise<RateLimitResult> {
  if (config.rateLimitDisabled) return { allowed: true, retryAfterMs: 0 };
  const key = `${rule.name}:${subject}`;
  const row = await db.one<{ blockedUntil: string | null }>(
    `INSERT INTO rate_limits (key, count, window_start, blocked_until, updated_at) VALUES ($1, 1, now(), NULL, now())
     ON CONFLICT (key) DO UPDATE SET
       count = CASE
         WHEN rate_limits.blocked_until IS NOT NULL AND rate_limits.blocked_until > now() THEN rate_limits.count
         WHEN rate_limits.window_start < now() - ($2 || ' ms')::interval THEN 1
         ELSE rate_limits.count + 1 END,
       window_start = CASE
         WHEN rate_limits.blocked_until IS NOT NULL AND rate_limits.blocked_until > now() THEN rate_limits.window_start
         WHEN rate_limits.window_start < now() - ($2 || ' ms')::interval THEN now()
         ELSE rate_limits.window_start END,
       blocked_until = CASE
         WHEN rate_limits.blocked_until IS NOT NULL AND rate_limits.blocked_until > now() THEN rate_limits.blocked_until
         WHEN rate_limits.window_start < now() - ($2 || ' ms')::interval THEN NULL
         WHEN rate_limits.count + 1 > $3 THEN now() + ($4 || ' ms')::interval
         ELSE NULL END,
       updated_at = now()
     RETURNING blocked_until AS "blockedUntil"`,
    [key, rule.windowMs, rule.max, rule.blockMs],
  );
  const blockedUntil = row?.blockedUntil ? new Date(row.blockedUntil).getTime() : 0;
  const now = Date.now();
  if (blockedUntil > now) return { allowed: false, retryAfterMs: blockedUntil - now };
  return { allowed: true, retryAfterMs: 0 };
}

/** Removes rows untouched for a week — keeps the table small. Safe to call repeatedly (scheduler). */
export async function pruneRateLimits(db: Db): Promise<number> {
  return db.exec(`DELETE FROM rate_limits WHERE updated_at < now() - interval '7 days'`);
}
