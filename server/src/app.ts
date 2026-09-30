import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import './http/types';
import { config } from './config';
import { logger } from './logger';
import type { Db } from './db/index';
import { mailer } from './mail/mailer';
import contextPlugin from './http/plugins/context';
import csrfPlugin from './http/plugins/csrf';
import rateLimitGlobalPlugin from './http/plugins/rateLimitGlobal';
import { errorHandler, notFoundHandler } from './http/errorHandler';
import { registerRoutes } from './http/routes/index';

const require = createRequire(import.meta.url);

export async function buildApp(db: Db): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // we use our own pino instance (`logger`) so every log line — app and HTTP — shares one format
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024, // 2MB JSON bodies; file uploads go through @fastify/multipart with its own limit
    genReqId: () => crypto.randomUUID(),
  });

  app.decorate('db', db);
  app.decorate('mailer', mailer);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cookie, { secret: config.cookieSigningSecret, parseOptions: {} });
  await app.register(compress, { global: true, threshold: 1024 });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  fs.mkdirSync(config.uploadDir, { recursive: true });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return notFoundHandler(req, reply);
    return serveSpaIndex(reply);
  });

  await app.register(contextPlugin);
  await app.register(csrfPlugin);
  await app.register(rateLimitGlobalPlugin);

  app.get('/api/healthz', async () => ({ status: 'ok', time: new Date().toISOString(), db: db.kind }));

  await registerRoutes(app);

  // Serve OCR worker/core/language assets straight from node_modules — no copy step, no CDN dependency,
  // so receipt images never leave the browser except through our own server.
  await app.register(fastifyStatic, {
    root: path.dirname(require.resolve('tesseract.js/package.json')) + '/dist',
    prefix: '/vendor/tesseract-worker/',
    decorateReply: false,
    setHeaders: (reply) => reply.header('Cache-Control', 'public, max-age=31536000, immutable'),
  });
  await app.register(fastifyStatic, {
    root: path.dirname(require.resolve('tesseract.js-core/package.json')),
    prefix: '/vendor/tesseract-core/',
    decorateReply: false,
    setHeaders: (reply) => reply.header('Cache-Control', 'public, max-age=31536000, immutable'),
  });
  // tesseract.js fetches exactly `${langPath}/${lang}.traineddata.gz` — one shared directory, not
  // per-language subfolders — but each @tesseract.js-data/<lang> package nests its file under a version
  // folder (…/4.0.0/<lang>.traineddata.gz). A tiny route bridges the two without copying files at build time.
  const TESSERACT_LANGS: Record<string, string> = { eng: 'eng', rus: 'rus', uzb: 'uzb' };
  app.get('/vendor/tesseract-lang/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    const match = /^([a-z]+)\.traineddata\.gz$/.exec(file);
    const lang = match?.[1] && TESSERACT_LANGS[match[1]];
    if (!lang) return reply.code(404).send();
    const filePath = path.join(path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)), '4.0.0', `${lang}.traineddata.gz`);
    if (!fs.existsSync(filePath)) return reply.code(404).send();
    reply.header('Cache-Control', 'public, max-age=31536000, immutable').header('Content-Type', 'application/gzip');
    return reply.send(fs.createReadStream(filePath));
  });

  // The built SPA (production / preview). In `npm run dev` the web app is served by Vite instead.
  const webDist = path.resolve(process.cwd(), 'web', 'dist');
  if (fs.existsSync(webDist)) {
    // wildcard (default true): any request path matching a real file is served from it. A path that
    // doesn't (a client-side route like /dashboard) 404s here and falls through to serveSpaIndex below.
    await app.register(fastifyStatic, { root: webDist, prefix: '/', decorateReply: true, index: false });
  }

  function serveSpaIndex(reply: import('fastify').FastifyReply) {
    const indexPath = path.join(webDist, 'index.html');
    if (!fs.existsSync(indexPath)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    return reply.type('text/html').send(fs.readFileSync(indexPath, 'utf8'));
  }

  app.addHook('onResponse', async (req, reply) => {
    logger.info({ method: req.method, url: req.url, status: reply.statusCode, ms: Math.round(reply.elapsedTime) }, 'request');
  });

  return app;
}
