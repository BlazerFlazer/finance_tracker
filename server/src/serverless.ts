import type { IncomingMessage, ServerResponse } from 'node:http';
import { logger } from './logger';
import { openDb } from './db/index';
import { migrate } from './db/migrate';
import { seedReferenceData } from './db/seed';
import { buildApp } from './app';

/**
 * Entry point for a serverless deployment (Vercel), as opposed to server/src/index.ts's long-running
 * process. A serverless function has no persistent process to hold a setInterval on, so — unlike the
 * long-running server — this never starts the background scheduler (server/src/jobs/scheduler.ts):
 * recurring-transaction auto-confirm, budget/bill/low-balance notifications, and demo-account purge do
 * not run in this deployment shape. Everything else (auth, every domain route, AI, reports, …) works
 * the same either way, since it all goes through the same `buildApp()`.
 *
 * The app is built once per lambda instance (module-scoped, memoized) and reused across invocations on
 * that instance; a fresh instance boots its own pool, runs any pending migration, and re-seeds reference
 * data (idempotent — see server/src/db/seed.ts) before serving its first request.
 */
let appPromise: ReturnType<typeof boot> | undefined;

async function boot() {
  const db = await openDb();
  logger.info({ engine: db.kind }, 'database connected (serverless)');
  const applied = await migrate(db, (m) => logger.info({ migration: m }, 'applying migration'));
  if (applied.length) logger.info({ count: applied.length }, 'migrations applied');
  await seedReferenceData(db);
  const app = await buildApp(db);
  await app.ready();
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  appPromise ??= boot();
  const app = await appPromise;
  // Fastify wires its router onto the underlying http.Server's 'request' event at construction time
  // (independent of .listen()), so replaying that event with the platform's own req/res routes it
  // through Fastify exactly as a real connection would — the standard way to run Fastify serverless.
  app.server.emit('request', req, res);
}
