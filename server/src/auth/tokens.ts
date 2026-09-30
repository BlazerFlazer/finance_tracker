import type { Db, Queryable } from '../db/index';
import { randomToken, sha256Hex } from '../crypto';

export type TokenPurpose = 'verify_email' | 'password_reset';

/** Invalidates older unused tokens of the same purpose, then issues a fresh one. Returns the raw token (only the hash is stored). */
export async function issueEmailToken(db: Db, userId: string, purpose: TokenPurpose, ttlMs: number): Promise<string> {
  const token = randomToken(32);
  await db.tx(async (tx) => {
    await tx.exec(`UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [userId, purpose]);
    await tx.exec(`INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' ms')::interval)`, [userId, purpose, sha256Hex(token), ttlMs]);
  });
  return token;
}

export interface EmailTokenRow {
  id: string;
  userId: string;
  expiresAt: string;
  usedAt: string | null;
}

export async function findEmailToken(db: Queryable, token: string, purpose: TokenPurpose): Promise<EmailTokenRow | null> {
  return db.one<EmailTokenRow>(`SELECT id, user_id AS "userId", expires_at AS "expiresAt", used_at AS "usedAt" FROM email_tokens WHERE token_hash = $1 AND purpose = $2`, [
    sha256Hex(token),
    purpose,
  ]);
}

export async function consumeEmailToken(db: Queryable, id: string): Promise<void> {
  await db.exec(`UPDATE email_tokens SET used_at = now() WHERE id = $1`, [id]);
}

/** How long the caller must wait before another token of this purpose can be requested (throttles resend spam). */
export async function tokenCooldownRemainingMs(db: Db, userId: string, purpose: TokenPurpose, cooldownMs: number): Promise<number> {
  const row = await db.one<{ createdAt: string }>(`SELECT created_at AS "createdAt" FROM email_tokens WHERE user_id = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1`, [userId, purpose]);
  if (!row) return 0;
  const elapsed = Date.now() - new Date(row.createdAt).getTime();
  return Math.max(0, cooldownMs - elapsed);
}
