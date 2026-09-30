import { todayInTZ } from '@shared/dates';
import type { Db } from '../db/index';

export interface UserPrefs {
  timezone: string;
  weekStart: 0 | 1;
  mainCurrency: string;
  language: 'ru' | 'en' | 'uz';
  today: string;
}

/** The handful of profile fields almost every domain query needs: "today" in the user's own time zone, their week-start, main currency and language. */
export async function getUserPrefs(db: Db, userId: string): Promise<UserPrefs> {
  const row = await db.one<{ timezone: string; weekStart: 0 | 1; mainCurrency: string; language: 'ru' | 'en' | 'uz' }>(
    `SELECT timezone, week_start AS "weekStart", main_currency AS "mainCurrency", language FROM profiles WHERE user_id = $1`,
    [userId],
  );
  const timezone = row?.timezone ?? 'UTC';
  return { timezone, weekStart: row?.weekStart ?? 1, mainCurrency: row?.mainCurrency ?? 'USD', language: row?.language ?? 'en', today: todayInTZ(timezone) };
}
