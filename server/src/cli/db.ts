import fs from 'node:fs';
import { config } from '../config';
import { openDb } from '../db/index';
import { migrate, migrationStatus } from '../db/migrate';
import { seedReferenceData } from '../db/seed';

const cmd = process.argv[2] ?? 'migrate';

async function main() {
  if (cmd === 'reset') {
    if (config.isProd) throw new Error('Refusing to reset a production database.');
    if (config.databaseUrl) throw new Error('db:reset only works with the embedded development database (unset DATABASE_URL).');
    fs.rmSync(config.pgliteDir, { recursive: true, force: true });
    console.log(`Removed ${config.pgliteDir}`);
  }
  const db = await openDb();
  try {
    if (cmd === 'status') {
      for (const s of await migrationStatus(db)) console.log(`${s.applied ? '✔' : '·'} ${s.name}${s.appliedAt ? `  (${s.appliedAt})` : ''}`);
      return;
    }
    const ran = await migrate(db, (m) => console.log(m));
    await seedReferenceData(db);
    console.log(ran.length ? `Applied ${ran.length} migration(s).` : 'Database is up to date.');
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
