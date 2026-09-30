import { z } from 'zod';
import { PASSWORD_MAX, PASSWORD_MIN, RESERVED_USERNAMES, USERNAME_MAX, USERNAME_MIN, USERNAME_REGEX } from '../constants';
import { checkPassword, type PasswordContext } from '../password';
import { langSchema } from './common';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'validation.required')
  .max(254, 'validation.email_invalid')
  .pipe(z.email('validation.email_invalid'));

export const usernameSchema = z
  .string()
  .trim()
  .min(USERNAME_MIN, 'validation.username_length')
  .max(USERNAME_MAX, 'validation.username_length')
  .regex(USERNAME_REGEX, 'validation.username_chars')
  .refine((u) => !RESERVED_USERNAMES.includes(u.toLowerCase()), 'validation.username_reserved');

/** Adds "validation.password_<issue>" errors for a password (optionally personalised with email/username). */
export function addPasswordIssues(password: string, ctx: z.RefinementCtx, path: (string | number)[], personal: PasswordContext = {}): void {
  const report = checkPassword(password, personal);
  for (const code of report.issues) {
    ctx.addIssue({ code: 'custom', path, message: `validation.password_${code}`, params: { code } });
  }
}

/** Password with policy rules that do not need personal context. */
export const newPasswordSchema = z
  .string('validation.required')
  .min(1, 'validation.required')
  .max(PASSWORD_MAX, 'validation.password_too_long')
  .superRefine((pw, ctx) => addPasswordIssues(pw, ctx, []));

export const registerEmailCheckSchema = z.object({ email: emailSchema });
export const registerUsernameCheckSchema = z.object({ username: usernameSchema });

export const registerSchema = z
  .object({
    email: emailSchema,
    username: usernameSchema,
    password: z.string('validation.required').min(1, 'validation.required').max(PASSWORD_MAX, 'validation.password_too_long'),
    confirmPassword: z.string('validation.required').min(1, 'validation.required'),
    acceptTerms: z.literal(true, 'validation.terms_required'),
    acceptPrivacy: z.literal(true, 'validation.terms_required'),
    language: langSchema.optional(),
    timezone: z.string().max(64).optional(),
  })
  .superRefine((v, ctx) => {
    addPasswordIssues(v.password, ctx, ['password'], { email: v.email, username: v.username });
    if (v.password !== v.confirmPassword) ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'validation.passwords_mismatch' });
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  identifier: z.string('validation.required').trim().min(1, 'validation.required').max(254, 'validation.too_long'),
  password: z.string('validation.required').min(1, 'validation.required').max(PASSWORD_MAX * 2, 'validation.too_long'),
  remember: z.boolean().optional().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** TOTP code (6 digits) or a backup code (e.g. "abcd-efgh-ij"). */
export const twoFactorCodeSchema = z
  .string('validation.required')
  .trim()
  .min(6, 'validation.code_invalid')
  .max(24, 'validation.code_invalid');

export const login2faSchema = z.object({
  challengeToken: z.string().min(20).max(200),
  code: twoFactorCodeSchema,
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20).max(200),
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, 'validation.required'),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'validation.passwords_mismatch' });

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'validation.required').max(PASSWORD_MAX * 2),
    newPassword: newPasswordSchema,
    confirmPassword: z.string().min(1, 'validation.required'),
    /** keep this session, sign out everywhere else */
    logoutOthers: z.boolean().optional().default(true),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'validation.passwords_mismatch' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'validation.password_same_as_old' });

export const reauthSchema = z.object({ password: z.string().min(1, 'validation.required').max(PASSWORD_MAX * 2) });

export const twoFactorSetupSchema = reauthSchema;
export const twoFactorEnableSchema = z.object({ code: twoFactorCodeSchema });
export const twoFactorDisableSchema = z.object({ password: z.string().min(1, 'validation.required'), code: twoFactorCodeSchema });
export const backupCodesRegenerateSchema = twoFactorDisableSchema;

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'validation.required'),
  code: twoFactorCodeSchema.optional(),
  confirmText: z.string().trim(),
  mode: z.enum(['grace', 'immediate']).default('grace'),
  acknowledge: z.literal(true, 'validation.required'),
});

export const PASSWORD_HINT = { min: PASSWORD_MIN, max: PASSWORD_MAX };
export { USERNAME_MIN, USERNAME_MAX };
