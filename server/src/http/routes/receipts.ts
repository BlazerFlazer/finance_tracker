import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { idParams } from '@shared/schemas/common';
import { AppError } from '../../errors';
import { requireVerified } from '../../auth/guard';
import { config } from '../../config';
import { checkRateLimit, RATE_LIMITS } from '../../security/rateLimit';

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * OCR itself runs client-side (tesseract.js in the browser — see the Receipt Scanner page and the
 * `/vendor/tesseract-*` static assets served from app.ts), so the person always reviews and can correct
 * the extracted fields before anything is saved (section 36). This module only stores the resulting
 * receipt image/PDF as an attachment, linkable to a transaction.
 */
export async function registerReceiptRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.post('/api/attachments', async (req, reply) => {
    const auth = requireVerified(req);
    const rl = await checkRateLimit(db, RATE_LIMITS.receiptScan, auth.user.id);
    if (!rl.allowed) throw new AppError('RATE_LIMITED_GENERIC', 'Too many uploads', { params: { retryAfterMs: rl.retryAfterMs } });

    const data = await req.file({ limits: { fileSize: MAX_BYTES } });
    if (!data) throw AppError.validation([{ path: 'file', message: 'validation.required' }]);
    const ext = ALLOWED_MIME[data.mimetype];
    if (!ext) throw new AppError('UNSUPPORTED_MEDIA', `Unsupported file type: ${data.mimetype}`);

    const transactionId = typeof data.fields.transactionId === 'object' && 'value' in data.fields.transactionId ? String(data.fields.transactionId.value) : undefined;
    if (transactionId) {
      if (!z.string().uuid().safeParse(transactionId).success) throw AppError.validation([{ path: 'transactionId', message: 'validation.invalid_id' }]);
      if (!(await db.one(`SELECT 1 FROM transactions WHERE id = $1 AND user_id = $2`, [transactionId, auth.user.id]))) throw AppError.notFound('Transaction');
    }

    const buffer = await data.toBuffer();
    if (buffer.byteLength === 0) throw AppError.validation([{ path: 'file', message: 'validation.required' }]);
    if (buffer.byteLength > MAX_BYTES) throw new AppError('PAYLOAD_TOO_LARGE');

    const storageKey = `${auth.user.id}/${crypto.randomUUID()}.${ext}`;
    const fullPath = path.join(config.uploadDir, storageKey);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    const row = await db.one<{ id: string }>(
      `INSERT INTO attachments (user_id, transaction_id, kind, filename, mime_type, size_bytes, sha256, storage_key)
       VALUES ($1,$2,'receipt',$3,$4,$5,$6,$7) RETURNING id`,
      [auth.user.id, transactionId ?? null, data.filename.slice(0, 255), data.mimetype, buffer.byteLength, sha256, storageKey],
    );
    return reply.code(201).send({ attachment: { id: row!.id, filename: data.filename, mimeType: data.mimetype, sizeBytes: buffer.byteLength, transactionId: transactionId ?? null } });
  });

  app.get('/api/attachments/:id/file', async (req, reply) => {
    const auth = requireVerified(req);
    const { id } = idParams.parse(req.params);
    const row = await db.one<{ storageKey: string; mimeType: string; filename: string }>(`SELECT storage_key AS "storageKey", mime_type AS "mimeType", filename FROM attachments WHERE id = $1 AND user_id = $2`, [
      id,
      auth.user.id,
    ]);
    if (!row) throw AppError.notFound('Attachment');
    const buffer = await fs.readFile(path.join(config.uploadDir, row.storageKey)).catch(() => null);
    if (!buffer) throw AppError.notFound('Attachment');
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(row.filename)}"`);
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.type(row.mimeType).send(buffer);
  });

  app.delete(
    '/api/attachments/:id',
    async (req) => {
      const auth = requireVerified(req);
      const { id } = idParams.parse(req.params);
      const row = await db.one<{ storageKey: string }>(`SELECT storage_key AS "storageKey" FROM attachments WHERE id = $1 AND user_id = $2`, [id, auth.user.id]);
      if (!row) throw AppError.notFound('Attachment');
      await db.exec(`DELETE FROM attachments WHERE id = $1 AND user_id = $2`, [id, auth.user.id]);
      await fs.unlink(path.join(config.uploadDir, row.storageKey)).catch(() => {});
      return { ok: true };
    },
  );

  app.get('/api/transactions/:id/attachments', async (req) => {
    const auth = requireVerified(req);
    const { id } = idParams.parse(req.params);
    return { attachments: await db.query(`SELECT id, filename, mime_type AS "mimeType", size_bytes AS "sizeBytes", created_at AS "createdAt" FROM attachments WHERE transaction_id = $1 AND user_id = $2`, [id, auth.user.id]) };
  });
}
