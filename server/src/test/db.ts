import { openDb, type Db } from '../db/index';
import { migrate } from '../db/migrate';
import { seedReferenceData } from '../db/seed';

/** Fresh in-memory PostgreSQL (PGlite) with the real schema applied. */
export async function createTestDb(): Promise<Db> {
  const db = await openDb({ memory: true });
  await migrate(db);
  await seedReferenceData(db);
  return db;
}
