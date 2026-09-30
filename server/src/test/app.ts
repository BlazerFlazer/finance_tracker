import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { createTestDb } from './db';
import type { Db } from '../db/index';

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const db = await createTestDb();
  const app = await buildApp(db);
  await app.ready();
  return {
    app,
    db,
    async close() {
      await app.close();
      await db.close();
    },
  };
}

/** Pulls the CSRF token cookie out of a set-cookie header list. */
export function extractCookie(setCookieHeaders: string[] | undefined, name: string): string | undefined {
  const line = setCookieHeaders?.find((c) => c.startsWith(`${name}=`));
  if (!line) return undefined;
  return decodeURIComponent(line.split(';')[0]!.slice(name.length + 1));
}

export function cookieHeader(setCookieHeaders: string[] | undefined, names: string[]): string {
  return names
    .map((n) => {
      const line = setCookieHeaders?.find((c) => c.startsWith(`${n}=`));
      return line?.split(';')[0];
    })
    .filter(Boolean)
    .join('; ');
}
