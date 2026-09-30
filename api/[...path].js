// Vercel serverless function entry point — catches every /api/* request. The actual app is built by
// `npm run build` (tsup, see tsup.config.ts's "serverless" entry) into server/dist/serverless.js
// *before* Vercel bundles this file, specifically so this file needs zero path-alias/TS resolution of
// its own: by the time Vercel traces this import, the target is already plain, self-contained JS.
import handler from '../server/dist/serverless.js';
export default handler;
