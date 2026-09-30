import type { Queryable } from '../db/index';

export interface MeDto {
  id: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
  status: string;
  emailVerifiedAt: string | null;
  isDemo: boolean;
  demoExpiresAt: string | null;
  createdAt: string;
  displayName: string | null;
  mainCurrency: string;
  language: 'ru' | 'en' | 'uz';
  timezone: string;
  theme: 'light' | 'dark' | 'system';
  weekStart: 0 | 1;
  onboardingCompletedAt: string | null;
  twoFactorEnabled: boolean;
}

export async function loadMe(db: Queryable, userId: string): Promise<MeDto | null> {
  return db.one<MeDto>(
    `SELECT u.id, u.email, u.username, u.role, u.status, u.email_verified_at AS "emailVerifiedAt", u.is_demo AS "isDemo",
            u.demo_expires_at AS "demoExpiresAt", u.created_at AS "createdAt",
            p.display_name AS "displayName", p.main_currency AS "mainCurrency", p.language, p.timezone, p.theme, p.week_start AS "weekStart",
            p.onboarding_completed_at AS "onboardingCompletedAt",
            EXISTS(SELECT 1 FROM user_totp t WHERE t.user_id = u.id AND t.confirmed_at IS NOT NULL) AS "twoFactorEnabled"
     FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`,
    [userId],
  );
}
