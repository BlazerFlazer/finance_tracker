import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app';
import { generateTotpCode } from '../../crypto';

type InjectResponse = Awaited<ReturnType<TestApp['app']['inject']>>;

let ctx: TestApp;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});

/** Pulls session+csrf cookies from a response that just set them, ready to send on the next request. */
function authFrom(res: InjectResponse) {
  const session = res.cookies.find((c) => c.name === 'ft_session');
  const csrf = res.cookies.find((c) => c.name === 'ft_csrf');
  if (!session || !csrf) throw new Error('Expected session + csrf cookies in response');
  return { cookies: { ft_session: session.value, ft_csrf: csrf.value }, headers: { 'x-csrf-token': csrf.value } };
}

// Every login/register in these tests looks like a brand-new device (no device cookie carried across
// `inject()` calls), so a "new sign-in" alert is mailed alongside the flow's own email — match on subject.
async function latestMailTo(email: string, subjectContains: string): Promise<{ subject: string; textBody: string }> {
  const row = await ctx.db.one<{ subject: string; textBody: string }>(
    `SELECT subject, text_body AS "textBody" FROM mail_outbox WHERE to_email = $1 AND subject ILIKE $2 ORDER BY created_at DESC LIMIT 1`,
    [email, `%${subjectContains}%`],
  );
  if (!row) throw new Error(`No mail matching "${subjectContains}" sent to ${email}`);
  return row;
}

function extractToken(text: string): string {
  const m = /token=([\w-]+)/.exec(text);
  if (!m) throw new Error(`No token found in: ${text}`);
  return m[1]!;
}

describe('auth flow (integration)', () => {
  const email = 'flow@example.com';
  const username = 'flowuser';
  const password = 'Sup3r!Secret-Pass99';

  it('registers a new account, sends a verification email, and logs the user in immediately (unverified)', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, username, password, confirmPassword: password, acceptTerms: true, acceptPrivacy: true } });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe(email);
    expect(body.user.emailVerifiedAt).toBeNull();
    expect(res.cookies.some((c) => c.name === 'ft_session')).toBe(true);
  });

  it('rejects a duplicate email and a duplicate username', async () => {
    const dupEmail = await ctx.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, username: 'someoneelse', password, confirmPassword: password, acceptTerms: true, acceptPrivacy: true } });
    expect(dupEmail.statusCode).toBe(409);
    expect(dupEmail.json().error.code).toBe('EMAIL_TAKEN');

    const dupUser = await ctx.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'another@example.com', username, password, confirmPassword: password, acceptTerms: true, acceptPrivacy: true } });
    expect(dupUser.statusCode).toBe(409);
    expect(dupUser.json().error.code).toBe('USERNAME_TAKEN');
  });

  it('rejects registration with a weak/common password with a clear validation error', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'weak@example.com', username: 'weakuser', password: 'password123', confirmPassword: 'password123', acceptTerms: true, acceptPrivacy: true } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.json().error.issues.some((i: { path: string }) => i.path === 'password')).toBe(true);
  });

  it('blocks a state-changing request with the wrong Origin (CSRF baseline)', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: 'https://evil.example.com' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ORIGIN_INVALID');
  });

  it('verifies the email with the mailed token, and a second use reports "already verified" rather than "invalid"', async () => {
    const mail = await latestMailTo(email, 'Verify');
    const token = extractToken(mail.textBody);

    const first = await ctx.app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token } });
    expect(first.statusCode).toBe(200);
    expect(first.json().alreadyVerified).toBe(false);

    const second = await ctx.app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token } });
    expect(second.statusCode).toBe(200);
    expect(second.json().alreadyVerified).toBe(true);
  });

  it('rejects an invalid verification token', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token: 'not-a-real-token-not-a-real-token' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('TOKEN_INVALID');
  });

  it('logs in with the verified account and can read /api/auth/me', async () => {
    const login = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password, remember: false } });
    expect(login.statusCode).toBe(200);
    expect(login.json().twoFactorRequired).toBe(false);
    const auth = authFrom(login);

    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', cookies: auth.cookies });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe(username);
    expect(me.json().user.emailVerifiedAt).not.toBeNull();
  });

  it('rejects the wrong password without revealing whether the account exists', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: 'totally-wrong-password', remember: false } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');

    const unknown = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: 'nobody-here@example.com', password: 'whatever12345!Aa', remember: false } });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an unauthenticated request to /api/auth/me', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('enables 2FA, requires it on the next login, and accepts a backup code as an alternative to the TOTP code', async () => {
    const login = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password, remember: false } });
    const auth = authFrom(login);

    const setup = await ctx.app.inject({ method: 'POST', url: '/api/security/2fa/setup', payload: { password }, cookies: auth.cookies, headers: auth.headers });
    expect(setup.statusCode, setup.body).toBe(200);
    const { secret } = setup.json();
    expect(typeof secret).toBe('string');

    const badEnable = await ctx.app.inject({ method: 'POST', url: '/api/security/2fa/enable', payload: { code: '000000' }, cookies: auth.cookies, headers: auth.headers });
    expect(badEnable.statusCode).toBe(401);
    expect(badEnable.json().error.code).toBe('TWO_FACTOR_INVALID');

    const enable = await ctx.app.inject({ method: 'POST', url: '/api/security/2fa/enable', payload: { code: generateTotpCode(secret) }, cookies: auth.cookies, headers: auth.headers });
    expect(enable.statusCode, enable.body).toBe(200);
    const backupCodes: string[] = enable.json().backupCodes;
    expect(backupCodes.length).toBeGreaterThanOrEqual(8);

    // logging out and back in must now require the second factor
    await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', cookies: auth.cookies, headers: auth.headers });
    const secondLogin = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password, remember: false } });
    expect(secondLogin.statusCode).toBe(200);
    expect(secondLogin.json().twoFactorRequired).toBe(true);
    const { challengeToken } = secondLogin.json();

    const wrongCode = await ctx.app.inject({ method: 'POST', url: '/api/auth/login/verify-2fa', payload: { challengeToken, code: '000000' } });
    expect(wrongCode.statusCode).toBe(401);

    // a backup code works exactly once
    const backupCode = backupCodes[0]!;
    const viaBackup = await ctx.app.inject({ method: 'POST', url: '/api/auth/login/verify-2fa', payload: { challengeToken, code: backupCode } });
    expect(viaBackup.statusCode, viaBackup.body).toBe(200);

    const reuseChallenge = await ctx.app.inject({ method: 'POST', url: '/api/auth/login/verify-2fa', payload: { challengeToken, code: backupCode } });
    expect(reuseChallenge.statusCode).toBe(400); // the challenge itself was already consumed by the successful login above

    const newAuth = authFrom(viaBackup);
    const disable = await ctx.app.inject({ method: 'POST', url: '/api/security/2fa/disable', payload: { password, code: backupCodes[1] }, cookies: newAuth.cookies, headers: newAuth.headers });
    expect(disable.statusCode, disable.body).toBe(200);
  });

  it('changes the password and revokes other sessions by default', async () => {
    const loginA = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password, remember: false } });
    const authA = authFrom(loginA);
    const loginB = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password, remember: false } });
    const authB = authFrom(loginB);

    const newPassword = 'Ev3n-Str0nger-Pass!';
    const change = await ctx.app.inject({
      method: 'POST',
      url: '/api/security/change-password',
      payload: { currentPassword: password, newPassword, confirmPassword: newPassword, logoutOthers: true },
      cookies: authA.cookies,
      headers: authA.headers,
    });
    expect(change.statusCode, change.body).toBe(200);

    const meA = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', cookies: authA.cookies });
    expect(meA.statusCode).toBe(200); // session A performed the change, stays valid

    const meB = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', cookies: authB.cookies });
    expect(meB.statusCode).toBe(401); // session B was revoked

    const oldPasswordLogin = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password, remember: false } });
    expect(oldPasswordLogin.statusCode).toBe(401);
    const newPasswordLogin = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: newPassword, remember: false } });
    expect(newPasswordLogin.statusCode).toBe(200);
  });

  it('resets a forgotten password end-to-end and invalidates the reset token after use', async () => {
    const currentPassword = 'Ev3n-Str0nger-Pass!';
    const forgot = await ctx.app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email } });
    expect(forgot.statusCode).toBe(200);
    const mail = await latestMailTo(email, 'Reset');
    const token = extractToken(mail.textBody);

    const freshPassword = 'Nq7z-Hollow-8mKr!';
    const reset = await ctx.app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, password: freshPassword, confirmPassword: freshPassword } });
    expect(reset.statusCode, reset.body).toBe(200);

    const reuse = await ctx.app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, password: 'Another-One-99!', confirmPassword: 'Another-One-99!' } });
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json().error.code).toBe('TOKEN_INVALID');

    const loginOld = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: currentPassword, remember: false } });
    expect(loginOld.statusCode).toBe(401);
    const loginNew = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: freshPassword, remember: false } });
    expect(loginNew.statusCode).toBe(200);
  });

  it('requests account deletion with a grace period, then cancels it', async () => {
    const login = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: email, password: 'Nq7z-Hollow-8mKr!', remember: false } });
    const auth = authFrom(login);

    const badConfirm = await ctx.app.inject({
      method: 'POST',
      url: '/api/security/delete-account',
      payload: { password: 'Nq7z-Hollow-8mKr!', confirmText: 'nope', mode: 'grace', acknowledge: true },
      cookies: auth.cookies,
      headers: auth.headers,
    });
    expect(badConfirm.statusCode).toBe(422);

    const del = await ctx.app.inject({
      method: 'POST',
      url: '/api/security/delete-account',
      payload: { password: 'Nq7z-Hollow-8mKr!', confirmText: username, mode: 'grace', acknowledge: true },
      cookies: auth.cookies,
      headers: auth.headers,
    });
    expect(del.statusCode, del.body).toBe(200);
    expect(del.json().deletedImmediately).toBe(false);

    const row = await ctx.db.one<{ status: string }>(`SELECT status FROM users WHERE email = $1`, [email]);
    expect(row?.status).toBe('pending_deletion');

    const cancel = await ctx.app.inject({ method: 'POST', url: '/api/security/delete-account/cancel', cookies: auth.cookies, headers: auth.headers });
    expect(cancel.statusCode, cancel.body).toBe(200);
    const row2 = await ctx.db.one<{ status: string }>(`SELECT status FROM users WHERE email = $1`, [email]);
    expect(row2?.status).toBe('active');
  });
});

describe('demo account', () => {
  it('creates an ephemeral, pre-verified demo session with seeded data', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/demo' });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.user.isDemo).toBe(true);
    expect(body.user.emailVerifiedAt).not.toBeNull();
    const auth = authFrom(res);

    const accounts = await ctx.app.inject({ method: 'GET', url: '/api/accounts', cookies: auth.cookies });
    expect(accounts.statusCode).toBe(200);
    expect(accounts.json().accounts.length).toBeGreaterThan(0);

    const del = await ctx.app.inject({ method: 'POST', url: '/api/security/delete-account', payload: { password: 'x', confirmText: 'x', mode: 'grace', acknowledge: true }, cookies: auth.cookies, headers: auth.headers });
    expect(del.statusCode).toBe(403);
    expect(del.json().error.code).toBe('DEMO_RESTRICTED');
  });
});
