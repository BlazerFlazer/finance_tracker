import type { Db } from '../db/index';
import { logger } from '../logger';
import { pruneRateLimits } from '../security/rateLimit';
import { autoConfirmDueRecurring, generateNotificationsForAllUsers, purgeExpiredDemoUsers } from './notifications';

const FIVE_MIN = 5 * 60_000;
const ONE_HOUR = 60 * 60_000;

async function safeRun(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    logger.error({ err: e, job: name }, 'scheduled job failed');
  }
}

/** Lightweight in-process scheduler — fine for a single-node deployment. Multi-node setups should move this to an external cron hitting a protected endpoint, or a job queue. */
export function startScheduler(db: Db): { stop: () => void } {
  const frequent = setInterval(() => {
    void safeRun('autoConfirmDueRecurring', () => autoConfirmDueRecurring(db));
    void safeRun('generateNotifications', () => generateNotificationsForAllUsers(db));
  }, FIVE_MIN);

  const hourly = setInterval(() => {
    void safeRun('purgeExpiredDemoUsers', () => purgeExpiredDemoUsers(db));
    void safeRun('pruneRateLimits', () => pruneRateLimits(db));
  }, ONE_HOUR);

  // run once shortly after boot so a freshly started server doesn't wait a full interval for the first pass
  const initial = setTimeout(() => {
    void safeRun('autoConfirmDueRecurring', () => autoConfirmDueRecurring(db));
    void safeRun('generateNotifications', () => generateNotificationsForAllUsers(db));
    void safeRun('purgeExpiredDemoUsers', () => purgeExpiredDemoUsers(db));
  }, 15_000);

  logger.info('scheduler started');
  return {
    stop() {
      clearInterval(frequent);
      clearInterval(hourly);
      clearTimeout(initial);
      logger.info('scheduler stopped');
    },
  };
}
