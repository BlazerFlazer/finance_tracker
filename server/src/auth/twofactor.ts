import type { Db } from '../db/index';
import { decryptSecret, encryptSecret, generateBackupCodes, hmacSha256Hex, normalizeBackupCode, verifyTotp } from '../crypto';

export interface TwoFactorStatus {
  enabled: boolean;
  pendingSetup: boolean;
  backupCodesRemaining: number;
}

export async function getTwoFactorStatus(db: Db, userId: string): Promise<TwoFactorStatus> {
  const row = await db.one<{ confirmedAt: string | null }>(`SELECT confirmed_at AS "confirmedAt" FROM user_totp WHERE user_id = $1`, [userId]);
  const remaining = await db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM backup_codes WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  return { enabled: !!row?.confirmedAt, pendingSetup: !!row && !row.confirmedAt, backupCodesRemaining: remaining?.n ?? 0 };
}

/** Starts (or restarts) setup: stores the secret, unconfirmed, so a half-finished setup never counts as "enabled". */
export async function beginTwoFactorSetup(db: Db, userId: string, secret: string): Promise<void> {
  await db.exec(
    `INSERT INTO user_totp (user_id, secret_enc, confirmed_at, last_used_step) VALUES ($1,$2,NULL,NULL)
     ON CONFLICT (user_id) DO UPDATE SET secret_enc = $2, confirmed_at = NULL, last_used_step = NULL, created_at = now()`,
    [userId, encryptSecret(secret, `totp:${userId}`)],
  );
}

export async function getPendingSecret(db: Db, userId: string): Promise<string | null> {
  const row = await db.one<{ secretEnc: string }>(`SELECT secret_enc AS "secretEnc" FROM user_totp WHERE user_id = $1`, [userId]);
  return row ? decryptSecret(row.secretEnc, `totp:${userId}`) : null;
}

/** Verifies the setup code and flips the account into "2FA enabled", issuing a fresh set of backup codes. */
export async function confirmTwoFactorSetup(db: Db, userId: string, code: string): Promise<{ ok: true; backupCodes: string[] } | { ok: false }> {
  const secret = await getPendingSecret(db, userId);
  if (!secret) return { ok: false };
  const check = verifyTotp(secret, code);
  if (!check.valid) return { ok: false };
  const codes = generateBackupCodes(10);
  await db.tx(async (tx) => {
    await tx.exec(`UPDATE user_totp SET confirmed_at = now(), last_used_step = $2 WHERE user_id = $1`, [userId, check.step!.toString()]);
    await tx.exec(`DELETE FROM backup_codes WHERE user_id = $1`, [userId]);
    for (const code of codes) await tx.exec(`INSERT INTO backup_codes (user_id, code_hash) VALUES ($1,$2)`, [userId, hmacSha256Hex(code)]);
  });
  return { ok: true, backupCodes: codes };
}

export async function disableTwoFactor(db: Db, userId: string): Promise<void> {
  await db.tx(async (tx) => {
    await tx.exec(`DELETE FROM user_totp WHERE user_id = $1`, [userId]);
    await tx.exec(`DELETE FROM backup_codes WHERE user_id = $1`, [userId]);
  });
}

export async function regenerateBackupCodes(db: Db, userId: string): Promise<string[]> {
  const codes = generateBackupCodes(10);
  await db.tx(async (tx) => {
    await tx.exec(`DELETE FROM backup_codes WHERE user_id = $1`, [userId]);
    for (const code of codes) await tx.exec(`INSERT INTO backup_codes (user_id, code_hash) VALUES ($1,$2)`, [userId, hmacSha256Hex(code)]);
  });
  return codes;
}

/** Verifies a confirmed account's login-time code, updating replay protection (`last_used_step`) on success. */
export async function verifyTotpForUser(db: Db, userId: string, code: string): Promise<boolean> {
  const row = await db.one<{ secretEnc: string; lastUsedStep: string | null }>(`SELECT secret_enc AS "secretEnc", last_used_step AS "lastUsedStep" FROM user_totp WHERE user_id = $1 AND confirmed_at IS NOT NULL`, [
    userId,
  ]);
  if (!row) return false;
  const secret = decryptSecret(row.secretEnc, `totp:${userId}`);
  const result = verifyTotp(secret, code, { lastUsedStep: row.lastUsedStep ? BigInt(row.lastUsedStep) : null });
  if (!result.valid) return false;
  await db.exec(`UPDATE user_totp SET last_used_step = $2 WHERE user_id = $1`, [userId, result.step!.toString()]);
  return true;
}

/** Verifies and, on success, burns one backup code. Codes are single-use. */
export async function tryConsumeBackupCode(db: Db, userId: string, code: string): Promise<boolean> {
  const clean = normalizeBackupCode(code);
  if (!clean) return false;
  const hash = hmacSha256Hex(clean);
  const row = await db.one<{ id: string }>(`UPDATE backup_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`, [userId, hash]);
  return !!row;
}

/** Accepts either a 6-digit TOTP code or a backup code — used at login and for sensitive-action reauthentication. */
export async function verifyTwoFactorCode(db: Db, userId: string, code: string): Promise<{ valid: boolean; usedBackupCode: boolean }> {
  const clean = code.trim();
  if (/^\d{6}$/.test(clean)) {
    return { valid: await verifyTotpForUser(db, userId, clean), usedBackupCode: false };
  }
  return { valid: await tryConsumeBackupCode(db, userId, clean), usedBackupCode: true };
}
