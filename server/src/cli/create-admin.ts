import { checkPassword } from '@shared/password';
import { config } from '../config';
import { openDb } from '../db/index';
import { hashPassword } from '../crypto';
import { createUserWithDefaults } from '../auth/registerUser';

/**
 * Creates (or promotes) an administrator account.
 *   npm run admin:create -- --email you@example.com --username admin --password 'Str0ng! Passw0rd'
 * Or set SEED_ADMIN_EMAIL / SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD and run with no flags.
 */
function readArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = (readArg('email') ?? config.seedAdmin.email)?.trim().toLowerCase();
  const username = (readArg('username') ?? config.seedAdmin.username)?.trim();
  const password = readArg('password') ?? config.seedAdmin.password;

  if (!email || !username || !password) {
    console.error('Usage: npm run admin:create -- --email you@example.com --username admin --password "..."');
    console.error('(or set SEED_ADMIN_EMAIL / SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD)');
    process.exit(1);
  }

  const check = checkPassword(password, { email, username });
  if (!check.ok) {
    console.error('Password does not meet the policy:', check.issues.join(', '));
    process.exit(1);
  }

  const db = await openDb();
  try {
    const existing = await db.one<{ id: string; role: string }>(`SELECT id, role FROM users WHERE lower(email) = lower($1)`, [email]);
    if (existing) {
      if (existing.role === 'admin') {
        console.log(`${email} is already an admin.`);
        return;
      }
      await db.exec(`UPDATE users SET role = 'admin', email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [existing.id]);
      console.log(`Promoted existing user ${email} to admin.`);
      return;
    }
    if (await db.one(`SELECT 1 FROM users WHERE lower(username) = lower($1)`, [username])) {
      console.error(`Username "${username}" is already taken.`);
      process.exit(1);
    }
    const passwordHash = await hashPassword(password);
    const user = await createUserWithDefaults(db, { email, username, passwordHash });
    await db.exec(`UPDATE users SET role = 'admin', email_verified_at = now() WHERE id = $1`, [user.id]);
    await db.exec(`UPDATE profiles SET onboarding_completed_at = now() WHERE user_id = $1`, [user.id]);
    console.log(`Created admin account: ${email} (${username})`);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
