import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'server/src/index.ts', 'cli-db': 'server/src/cli/db.ts', 'cli-create-admin': 'server/src/cli/create-admin.ts' },
  outDir: 'server/dist',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: true,
  tsconfig: 'server/tsconfig.json',
  // Everything listed in package.json "dependencies" stays external; local code and @shared/* is bundled.
});
