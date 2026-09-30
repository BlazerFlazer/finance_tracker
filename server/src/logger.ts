import { pino } from 'pino';
import { config } from './config';

/** Structured app logger. Never log secrets, tokens, passwords or full request bodies — see redact below. */
export const logger = pino({
  level: config.logLevel,
  transport: config.isDev ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } : undefined,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
      '*.confirmPassword',
      '*.token',
      '*.secret',
      '*.code',
    ],
    censor: '[redacted]',
  },
});
