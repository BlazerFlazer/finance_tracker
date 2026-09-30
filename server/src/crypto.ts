import crypto from 'node:crypto';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { config } from './config';

// ============================================================================ passwords
// `Algorithm` in @node-rs/argon2 is an ambient `const enum`, which esbuild (tsx/tsup) cannot inline across
// module boundaries — so the numeric value is used directly. 2 = Argon2id (verified against the package's
// own index.d.ts: Argon2d = 0, Argon2i = 1, Argon2id = 2), the recommended hybrid mode for password hashing.
const ARGON2ID = 2;
const argonOptions = { algorithm: ARGON2ID, memoryCost: config.argon2.memoryCost, timeCost: config.argon2.timeCost, parallelism: 1 };

export const hashPassword = (password: string): Promise<string> => argon2Hash(password, argonOptions);

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify(hash, password);
  } catch {
    return false;
  }
}

// ============================================================================ random tokens
/** URL-safe random token for emails/links (default 32 bytes ≈ 43 chars, ~256 bits of entropy). */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export const sha256Hex = (input: string): string => crypto.createHash('sha256').update(input, 'utf8').digest('hex');

/** Keyed hash for values an admin with DB access should not be able to forge from a public value (backup codes). */
export const hmacSha256Hex = (input: string): string => crypto.createHmac('sha256', config.encryptionKey).update(input, 'utf8').digest('hex');

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // still run a compare of equal length to avoid a length-based timing signal
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// ============================================================================ AES-256-GCM (secrets at rest: TOTP secrets, journal entries)
const GCM_IV_LEN = 12;
const GCM_TAG_LEN = 16;

export function encryptSecret(plaintext: string, aad = 'fintrack'): string {
  const iv = crypto.randomBytes(GCM_IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.encryptionKey, iv);
  cipher.setAAD(Buffer.from(aad));
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(payload: string, aad = 'fintrack'): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, GCM_IV_LEN);
  const tag = buf.subarray(GCM_IV_LEN, GCM_IV_LEN + GCM_TAG_LEN);
  const enc = buf.subarray(GCM_IV_LEN + GCM_TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', config.encryptionKey, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ============================================================================ TOTP (RFC 6238) + backup codes
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(bytes = 20): string {
  const buf = crypto.randomBytes(bytes);
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32ToBuffer(base32: string): Buffer {
  const clean = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of clean) {
    const idx = BASE32_ALPHABET.indexOf(c);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: bigint, digits = 6): string {
  const key = base32ToBuffer(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(counter);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code = ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

/** Generates the current 6-digit code for a secret — used by the automated test suite (a human uses their authenticator app instead). */
export function generateTotpCode(secret: string, at: number = Date.now(), period = 30): string {
  return hotp(secret, BigInt(Math.floor(at / 1000 / period)));
}

export interface TotpCheckResult {
  valid: boolean;
  /** the time-step that matched, so the caller can reject replays of the same code */
  step?: bigint;
}

/** Verifies a 6-digit code, allowing ±1 time step (30s) of clock drift. Rejects the exact step already used. */
export function verifyTotp(secret: string, token: string, opts: { lastUsedStep?: bigint | null; period?: number; window?: number; at?: number } = {}): TotpCheckResult {
  const clean = token.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return { valid: false };
  const period = opts.period ?? 30;
  const window = opts.window ?? 1;
  const step = BigInt(Math.floor((opts.at ?? Date.now()) / 1000 / period));
  for (let i = -window; i <= window; i++) {
    const candidate = step + BigInt(i);
    if (opts.lastUsedStep != null && candidate <= opts.lastUsedStep) continue; // replay protection
    if (timingSafeEqualStr(hotp(secret, candidate), clean)) return { valid: true, step: candidate };
  }
  return { valid: false };
}

export function totpProvisioningUri(secret: string, email: string, issuer = 'FinTrack'): string {
  // Per the otpauth convention, the "issuer:account" colon inside the label is left unescaped —
  // authenticator apps split on it to show the issuer name separately from the account.
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

const BACKUP_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // no 0/1/l/o/i — easy to read aloud
export function generateBackupCode(): string {
  const bytes = crypto.randomBytes(10);
  let s = '';
  for (const b of bytes) s += BACKUP_CODE_ALPHABET[b % BACKUP_CODE_ALPHABET.length];
  return `${s.slice(0, 5)}-${s.slice(5, 10)}`;
}
export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, generateBackupCode);
}
export const normalizeBackupCode = (code: string): string => code.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
