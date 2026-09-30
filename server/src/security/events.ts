import type { SecurityEventType } from '@shared/constants';
import type { Db } from '../db/index';
import { sha256Hex } from '../crypto';
import { logger } from '../logger';

export interface SecurityEventInput {
  userId?: string | null;
  type: SecurityEventType;
  severity?: 'info' | 'warning' | 'critical';
  ip?: string | null;
  userAgent?: string | null;
  countryCode?: string | null;
  deviceLabel?: string | null;
  /** for failed logins against an unknown/unverified identifier — never store the raw value */
  identifier?: string | null;
  metadata?: Record<string, unknown>;
}

const DEFAULT_SEVERITY: Partial<Record<SecurityEventType, 'info' | 'warning' | 'critical'>> = {
  login_failed: 'warning',
  login_locked: 'critical',
  login_2fa_failed: 'warning',
  password_reset_requested: 'info',
  password_changed: 'warning',
  two_factor_disabled: 'warning',
  session_revoked: 'info',
  sessions_revoked_all: 'warning',
  new_device_login: 'warning',
  account_deletion_requested: 'warning',
  account_suspended: 'critical',
};

export async function recordSecurityEvent(db: Db, input: SecurityEventInput): Promise<void> {
  try {
    await db.exec(
      `INSERT INTO security_events (user_id, type, severity, ip, user_agent, country_code, device_label, identifier_hash, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.userId ?? null,
        input.type,
        input.severity ?? DEFAULT_SEVERITY[input.type] ?? 'info',
        input.ip ?? null,
        input.userAgent ?? null,
        input.countryCode ?? null,
        input.deviceLabel ?? null,
        input.identifier ? sha256Hex(input.identifier.toLowerCase()) : null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  } catch (e) {
    // Security logging must never break the request it's attached to.
    logger.error({ err: e, type: input.type }, 'failed to record security event');
  }
}

export interface AuditInput {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/** Append-only trail for privileged/admin actions. Never includes financial values or e-mail addresses. */
export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  try {
    await db.exec(`INSERT INTO audit_logs (actor_user_id, actor_role, action, target_type, target_id, ip, user_agent, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
      input.actorUserId ?? null,
      input.actorRole ?? null,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      input.ip ?? null,
      input.userAgent ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]);
  } catch (e) {
    logger.error({ err: e, action: input.action }, 'failed to record audit log');
  }
}
