import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(dirname, 'shared/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['server/src/**/*.test.ts', 'shared/src/**/*.test.ts', 'web/src/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      // Route transactional email into the `mail_outbox` table instead of just logging it, so integration
      // tests can pull verification/reset tokens out of a real send instead of reaching into internals.
      MAIL_TRANSPORT: 'outbox',
      // The rate limiter itself is simple, generic, atomic SQL (see security/rateLimit.ts) — disabling it
      // here keeps functional tests deterministic instead of coupled to call counts/order.
      RATE_LIMIT_DISABLED: 'true',
    },
  },
});
