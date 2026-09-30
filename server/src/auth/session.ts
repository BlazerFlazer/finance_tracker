import type { Db } from '../db/index';
import { randomToken, sha256Hex } from '../crypto';
import type { UaInfo } from '../ua';

export const SESSION_COOKIE = 'ft_session';
export const CSRF_COOKIE = 'ft_csrf';
export const DEVICE_COOKIE = 'ft_device';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const SESSION_IDLE_MS = 12 * HOUR;
export const SESSION_IDLE_REMEMBER_MS = 30 * DAY;
export const SESSION_ABSOLUTE_MS = 7 * DAY;
export const SESSION_ABSOLUTE_REMEMBER_MS = 90 * DAY;
export const DEVICE_COOKIE_MAX_AGE_S = Math.floor((365 * DAY) / 1000);
/** Sessions active more recently than this are treated as "seen from this device before" (no new-device alert). */
const KNOWN_DEVICE_WINDOW_MS = 180 * DAY;

export interface SessionUser {
  id: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended' | 'pending_deletion';
  emailVerifiedAt: string | null;
  isDemo: boolean;
}

export interface SessionRecord {
  id: string;
  userId: string;
  remember: boolean;
  deviceId: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  ua: UaInfo;
  countryCode?: string | null;
}

export interface NewSession {
  session: SessionRecord;
  token: string;
  csrfToken: string;
}

export async function createSession(db: Db, userId: string, remember: boolean, meta: RequestMeta, deviceId: string | null): Promise<NewSession> {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const idle = remember ? SESSION_IDLE_REMEMBER_MS : SESSION_IDLE_MS;
  const absolute = remember ? SESSION_ABSOLUTE_REMEMBER_MS : SESSION_ABSOLUTE_MS;
  const row = await db.one<SessionRecord>(
    `INSERT INTO sessions (user_id, token_hash, csrf_hash, remember, device_id, ip, user_agent, browser, os, device_type, country_code, expires_at, absolute_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() + ($12 || ' ms')::interval, now() + ($13 || ' ms')::interval)
     RETURNING id, user_id AS "userId", remember, device_id AS "deviceId", created_at AS "createdAt", last_active_at AS "lastActiveAt", expires_at AS "expiresAt"`,
    [userId, sha256Hex(token), sha256Hex(csrfToken), remember, deviceId, meta.ip ?? null, meta.userAgent ?? null, meta.ua.browser, meta.ua.os, meta.ua.deviceType, meta.countryCode ?? null, idle, absolute],
  );
  return { session: row!, token, csrfToken };
}

export interface ResolvedSession {
  session: SessionRecord & { csrfHash: string };
  user: SessionUser;
}

/** Validates a session cookie value; refreshes the idle window (throttled) on success. Returns null for any invalid/expired/revoked token. */
export async function resolveSession(db: Db, token: string): Promise<ResolvedSession | null> {
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const row = await db.one<
    SessionRecord & {
      csrfHash: string;
      remember: boolean;
      userEmail: string;
      username: string;
      role: 'user' | 'admin';
      status: SessionUser['status'];
      emailVerifiedAt: string | null;
      isDemo: boolean;
    }
  >(
    `SELECT s.id, s.user_id AS "userId", s.csrf_hash AS "csrfHash", s.remember, s.device_id AS "deviceId",
            s.created_at AS "createdAt", s.last_active_at AS "lastActiveAt", s.expires_at AS "expiresAt",
            u.email AS "userEmail", u.username, u.role, u.status, u.email_verified_at AS "emailVerifiedAt", u.is_demo AS "isDemo"
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND s.absolute_expires_at > now()`,
    [tokenHash],
  );
  if (!row) return null;
  const idleMs = row.remember ? SESSION_IDLE_REMEMBER_MS : SESSION_IDLE_MS;
  // Throttle the write: only push expires_at out when at least 5 minutes have passed since the last touch.
  if (Date.now() - new Date(row.lastActiveAt).getTime() > 5 * 60_000) {
    await db.exec(`UPDATE sessions SET last_active_at = now(), expires_at = LEAST(now() + ($2 || ' ms')::interval, absolute_expires_at) WHERE id = $1`, [row.id, idleMs]);
  }
  return {
    session: { id: row.id, userId: row.userId, remember: row.remember, deviceId: row.deviceId, createdAt: row.createdAt, lastActiveAt: row.lastActiveAt, expiresAt: row.expiresAt, csrfHash: row.csrfHash },
    user: { id: row.userId, email: row.userEmail, username: row.username, role: row.role, status: row.status, emailVerifiedAt: row.emailVerifiedAt, isDemo: row.isDemo },
  };
}

export const csrfMatches = (session: { csrfHash: string }, headerToken: string | undefined | null): boolean => !!headerToken && sha256Hex(headerToken) === session.csrfHash;

export async function revokeSession(db: Db, sessionId: string, reason: string): Promise<void> {
  await db.exec(`UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL`, [sessionId, reason]);
}

export async function revokeSessionByToken(db: Db, token: string): Promise<string | null> {
  const row = await db.one<{ id: string }>(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id`, [sha256Hex(token)]);
  return row?.id ?? null;
}

export async function revokeOtherSessions(db: Db, userId: string, exceptSessionId: string, reason: string): Promise<number> {
  return db.exec(`UPDATE sessions SET revoked_at = now(), revoked_reason = $3 WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`, [userId, exceptSessionId, reason]);
}

export async function revokeAllSessions(db: Db, userId: string, reason: string): Promise<number> {
  return db.exec(`UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL`, [userId, reason]);
}

export interface ActiveSessionRow {
  id: string;
  browser: string | null;
  os: string | null;
  deviceType: string;
  countryCode: string | null;
  ip: string | null;
  createdAt: string;
  lastActiveAt: string;
  isCurrent: boolean;
}

export async function listActiveSessions(db: Db, userId: string, currentSessionId: string): Promise<ActiveSessionRow[]> {
  const rows = await db.query<ActiveSessionRow>(
    `SELECT id, browser, os, device_type AS "deviceType", country_code AS "countryCode", ip, created_at AS "createdAt", last_active_at AS "lastActiveAt"
     FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_active_at DESC`,
    [userId],
  );
  return rows.map((r) => ({ ...r, isCurrent: r.id === currentSessionId }));
}

// -------------------------------------------------------------------------- devices
export interface TouchDeviceResult {
  deviceId: string;
  isNewDevice: boolean;
  /** set only when no device cookie was presented and a new key had to be minted — the caller must persist it */
  newDeviceKey?: string;
}

/** Looks up (or silently creates) the long-lived device fingerprint used only to tell "new device" logins apart. */
export async function touchDevice(db: Db, userId: string, deviceKey: string | null, meta: RequestMeta): Promise<TouchDeviceResult> {
  const key = deviceKey || randomToken(24);
  const keyHash = sha256Hex(key);
  const existing = await db.one<{ id: string; lastSeenAt: string }>(`SELECT id, last_seen_at AS "lastSeenAt" FROM user_devices WHERE user_id = $1 AND device_key_hash = $2`, [userId, keyHash]);
  if (existing) {
    const isNewDevice = Date.now() - new Date(existing.lastSeenAt).getTime() > KNOWN_DEVICE_WINDOW_MS;
    await db.exec(`UPDATE user_devices SET last_seen_at = now(), last_ip = $2, last_country = $3, browser = $4, os = $5, device_type = $6 WHERE id = $1`, [
      existing.id,
      meta.ip ?? null,
      meta.countryCode ?? null,
      meta.ua.browser,
      meta.ua.os,
      meta.ua.deviceType,
    ]);
    return { deviceId: existing.id, isNewDevice, newDeviceKey: deviceKey ? undefined : key };
  }
  const created = await db.one<{ id: string }>(
    `INSERT INTO user_devices (user_id, device_key_hash, browser, os, device_type, last_ip, last_country) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [userId, keyHash, meta.ua.browser, meta.ua.os, meta.ua.deviceType, meta.ip ?? null, meta.countryCode ?? null],
  );
  // A brand-new device row for an existing cookie value means the cookie was stale (e.g. DB reset) — persist it again either way.
  return { deviceId: created!.id, isNewDevice: true, newDeviceKey: key };
}
