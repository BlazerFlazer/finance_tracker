// Vercel serverless function entry point for every /api/* request. There is no framework here to give
// Vercel a dynamic-route convention (that [...param] bracket syntax is a Next.js file-router feature,
// not a generic Vercel Functions primitive — confirmed the hard way: a bracket-named catch-all file was
// silently never recognized as a function at all, 404ing on every request, while a plainly-named one
// worked). So this is one plainly-named function, and vercel.json's rewrite sends every /api/* path to
// it while preserving the original URL, which is all Fastify's own router needs to take it from here.
//
// The actual app is built by `npm run build` (tsup, see tsup.config.ts's "serverless" entry) into
// server/dist/serverless.js *before* Vercel bundles this file, so this file needs zero path-alias/TS
// resolution of its own: by the time Vercel traces this import, the target is already plain JS.
//
// The import is dynamic (inside the handler, not a static top-level `import`) specifically so a throw
// during that module's own load (server/src/config.ts validates required env vars at import time) can
// actually be caught here — a static import that throws at load time fails this whole module's own
// evaluation uncatchably, which is why earlier failures here showed only Vercel's opaque generic 500.
let modPromise;

export default async function handler(req, res) {
  try {
    modPromise ??= import('../server/dist/serverless.js');
    const mod = await modPromise;
    return mod.default(req, res);
  } catch (err) {
    modPromise = undefined;
    console.error('serverless module load failed:', err); // captured in Vercel's function logs
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our end.' } }));
  }
}
