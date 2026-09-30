import { config } from './config';
import { logger } from './logger';
import { openDb } from './db/index';
import { migrate } from './db/migrate';
import { seedReferenceData } from './db/seed';
import { buildApp } from './app';

async function main() {
  const db = await openDb();
  logger.info({ engine: db.kind }, 'database connected');

  const applied = await migrate(db, (m) => logger.info({ migration: m }, 'applying migration'));
  if (applied.length) logger.info({ count: applied.length }, 'migrations applied');
  await seedReferenceData(db);

  const app = await buildApp(db);

  let scheduler: { stop: () => void } | undefined;
  if (config.schedulerEnabled) {
    const { startScheduler } = await import('./jobs/scheduler');
    scheduler = startScheduler(db);
  }

  await app.listen({ port: config.port, host: config.host });
  logger.info({ url: `http://${config.host}:${config.port}`, env: config.env }, 'FinTrack API ready');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    scheduler?.stop();
    try {
      await app.close();
      await db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'failed to start FinTrack API');
  process.exit(1);
});
