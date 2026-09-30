import { z } from 'zod';
import { CURRENCIES, LANGUAGES, MAX_AMOUNT_MINOR } from '../constants';

/**
 * Every validation message in the schemas is an i18n key ("validation.*"), so the very same schema
 * runs in the browser (instant feedback) and on the server (authoritative), and the UI translates the keys.
 */
z.config({
  customError: (iss) => {
    switch (iss.code) {
      case 'invalid_type':
        return iss.input === undefined || iss.input === null ? 'validation.required' : 'validation.invalid_type';
      case 'too_small':
        if (iss.origin === 'string') return iss.minimum === 1 || iss.minimum === 1n ? 'validation.required' : 'validation.too_short';
        if (iss.origin === 'array' || iss.origin === 'set') return 'validation.too_few_items';
        return 'validation.too_small';
      case 'too_big':
        if (iss.origin === 'string') return 'validation.too_long';
        if (iss.origin === 'array' || iss.origin === 'set') return 'validation.too_many_items';
        return 'validation.too_big';
      case 'invalid_format':
        if (iss.format === 'email') return 'validation.email_invalid';
        if (iss.format === 'uuid' || iss.format === 'guid') return 'validation.invalid_id';
        if (iss.format === 'date') return 'validation.date_invalid';
        return 'validation.invalid_format';
      case 'invalid_value':
        return 'validation.invalid_option';
      case 'unrecognized_keys':
        return 'validation.unknown_field';
      case 'not_multiple_of':
        return 'validation.invalid';
      default:
        return undefined;
    }
  },
});

export const uuidSchema = z.uuid('validation.invalid_id');
export const isoDateSchema = z.iso.date('validation.date_invalid');
export const langSchema = z.enum(LANGUAGES);
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'validation.currency_invalid')
  .refine((c) => CURRENCIES.some((x) => x.code === c) || true); // catalogue is DB-driven; the DB foreign key is authoritative

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'validation.color_invalid');
export const iconNameSchema = z.string().regex(/^[A-Za-z0-9]{1,40}$/, 'validation.invalid_format');

/** Positive integer amount in minor units. */
export const amountMinorSchema = z
  .number('validation.amount_invalid')
  .int('validation.amount_invalid')
  .positive('validation.amount_positive')
  .max(MAX_AMOUNT_MINOR, 'validation.amount_too_large');

/** Zero-or-positive integer amount in minor units. */
export const amountMinorNonNegSchema = z
  .number('validation.amount_invalid')
  .int('validation.amount_invalid')
  .min(0, 'validation.amount_negative')
  .max(MAX_AMOUNT_MINOR, 'validation.amount_too_large');

/** Signed integer amount in minor units (balances may be negative). */
export const amountMinorSignedSchema = z
  .number('validation.amount_invalid')
  .int('validation.amount_invalid')
  .min(-MAX_AMOUNT_MINOR, 'validation.amount_too_large')
  .max(MAX_AMOUNT_MINOR, 'validation.amount_too_large');

export const shortText = (max: number) => z.string().trim().max(max, 'validation.too_long');
export const requiredText = (max: number) => z.string().trim().min(1, 'validation.required').max(max, 'validation.too_long');
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'validation.too_long')
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const idParams = z.object({ id: uuidSchema });

/** Query booleans arrive as strings ("true"/"1"). */
export const queryBool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export type ValidationIssue = { path: string; message: string; params?: Record<string, unknown> };

/** Flatten Zod issues into the wire format used by API errors and the client-side forms. */
export function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => {
    const params: Record<string, unknown> = {};
    if ('minimum' in i && i.minimum !== undefined) params.min = Number(i.minimum);
    if ('maximum' in i && i.maximum !== undefined) params.max = Number(i.maximum);
    return {
      path: i.path.join('.'),
      message: typeof i.message === 'string' ? i.message : 'validation.invalid',
      ...(Object.keys(params).length ? { params } : {}),
    };
  });
}
