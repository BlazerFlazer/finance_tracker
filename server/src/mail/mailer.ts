import type { Db } from '../db/index';
import { config } from '../config';
import { logger } from '../logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  meta?: Record<string, unknown>;
}

export interface Mailer {
  send(db: Db, msg: MailMessage): Promise<void>;
}

let smtpTransport: import('nodemailer').Transporter | null = null;
async function getSmtpTransport() {
  if (!smtpTransport) {
    const nodemailer = await import('nodemailer');
    smtpTransport = nodemailer.createTransport({
      host: config.mail.smtp.host,
      port: config.mail.smtp.port,
      secure: config.mail.smtp.secure,
      auth: config.mail.smtp.user ? { user: config.mail.smtp.user, pass: config.mail.smtp.pass } : undefined,
    });
  }
  return smtpTransport;
}

/**
 * `MAIL_TRANSPORT` picks how mail leaves the system:
 *   - smtp: a real mail server (production).
 *   - outbox: nothing is sent — messages are stored in `mail_outbox` and readable at GET /api/dev/mailbox.
 *     This is the default outside production, so the whole email-based flow (verification, reset, alerts)
 *     works out of the box with zero setup.
 *   - log: printed to the server log only (used in automated tests).
 */
export function createMailer(): Mailer {
  const transport = config.mail.transport;
  return {
    async send(db, msg) {
      if (transport === 'smtp') {
        const t = await getSmtpTransport();
        await t.sendMail({ from: config.mail.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
        return;
      }
      if (transport === 'log') {
        logger.info({ to: msg.to, subject: msg.subject }, '[mail:log] would send email');
        return;
      }
      await db.exec(`INSERT INTO mail_outbox (to_email, subject, text_body, html_body, meta) VALUES ($1,$2,$3,$4,$5)`, [
        msg.to,
        msg.subject,
        msg.text,
        msg.html ?? null,
        JSON.stringify(msg.meta ?? {}),
      ]);
    },
  };
}

export const mailer = createMailer();
