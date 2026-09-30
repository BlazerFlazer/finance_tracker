import 'fastify';
import type { Db } from '../db/index';
import type { ResolvedSession } from '../auth/session';
import type { UaInfo } from '../ua';
import type { Mailer } from '../mail/mailer';

export interface RequestMetaInfo {
  ip?: string;
  userAgent?: string;
  ua: UaInfo;
  countryCode: string | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    mailer: Mailer;
  }
  interface FastifyRequest {
    auth: ResolvedSession | null;
    meta: RequestMetaInfo;
  }
}
