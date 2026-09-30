import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import { toValidationIssues } from '@shared/schemas/common';
import { AppError } from '../errors';

function parseOrThrow<T>(schema: ZodType<T> | undefined, data: unknown): T {
  if (!schema) return data as T;
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw AppError.validation(toValidationIssues(r.error));
  return r.data;
}

export interface RouteCtx<B, Q, P> {
  body: B;
  query: Q;
  params: P;
  req: FastifyRequest;
  reply: FastifyReply;
}

/**
 * Wraps a handler with Zod validation for body/query/params. Every field ends up parsed AND typed —
 * the same schemas the web app uses for live client-side feedback are the server's authoritative check.
 * Returning a value from `handler` sends it as JSON (200); call `reply.code(...).send(...)` yourself for anything else.
 */
export function defineRoute<B = undefined, Q = undefined, P = undefined, R = unknown>(opts: {
  body?: ZodType<B>;
  query?: ZodType<Q>;
  params?: ZodType<P>;
  handler: (ctx: RouteCtx<B, Q, P>) => Promise<R>;
}) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseOrThrow(opts.body, req.body);
    const query = parseOrThrow(opts.query, req.query);
    const params = parseOrThrow(opts.params, req.params);
    const result = await opts.handler({ body, query, params, req, reply });
    if (!reply.sent && result !== undefined) return reply.send(result);
    return undefined;
  };
}
