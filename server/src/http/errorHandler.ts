import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@shared/errors';
import { toValidationIssues } from '@shared/schemas/common';
import { AppError, isAppError } from '../errors';
import { logger } from '../logger';

/** Converts anything thrown in a handler into the wire `ApiErrorBody` shape, and logs 5xx responses. */
export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply): void {
  let body: ApiErrorBody;
  let status: number;

  if (isAppError(err)) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, issues: err.issues, params: err.params, requestId: req.id } };
  } else if (err instanceof ZodError) {
    status = 422;
    body = { error: { code: 'VALIDATION_ERROR', message: 'Validation failed', issues: toValidationIssues(err), requestId: req.id } };
  } else if ((err as FastifyError).code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || (err as FastifyError).code === 'FST_ERR_VALIDATION') {
    status = 400;
    body = { error: { code: 'VALIDATION_ERROR', message: err.message, requestId: req.id } };
  } else if ((err as FastifyError).statusCode === 413 || (err as FastifyError).code === 'FST_REQ_FILE_TOO_LARGE') {
    status = 413;
    body = { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request is too large', requestId: req.id } };
  } else if ((err as FastifyError).statusCode && (err as FastifyError).statusCode! < 500) {
    status = (err as FastifyError).statusCode!;
    body = { error: { code: status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : 'VALIDATION_ERROR', message: err.message, requestId: req.id } };
  } else {
    status = 500;
    body = { error: { code: 'INTERNAL', message: 'Internal server error', requestId: req.id } };
  }

  if (status >= 500) logger.error({ err, reqId: req.id, url: req.url, method: req.method }, 'unhandled error');
  else logger.debug({ code: body.error.code, url: req.url }, 'request error');

  reply.code(status).send(body);
}

export function notFoundHandler(req: FastifyRequest, reply: FastifyReply): void {
  const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found`, requestId: req.id } };
  reply.code(404).send(body);
}
