import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { Field } from '../../components/ui/Field';
import { useT } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';

export default function LoginPage() {
  const t = useT();
  const nav = useNavigate();
  const location = useLocation();
  const { refetch } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [challenge, setChallenge] = useState<{ token: string } | null>(null);
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);

  const afterLogin = async () => {
    const { data } = await refetch();
    nav(data?.onboardingCompletedAt ? ((location.state as { from?: string } | null)?.from ?? '/app/dashboard') : '/onboarding', { replace: true });
  };

  const loginMutation = useMutation({
    mutationFn: () => api.post<{ twoFactorRequired: boolean; challengeToken?: string }>('/api/auth/login', { identifier, password, remember }),
    onSuccess: (res) => {
      setError(null);
      if (res.twoFactorRequired && res.challengeToken) setChallenge({ token: res.challengeToken });
      else void afterLogin();
    },
    onError: (e) => {
      const { key, params } = errorToMessageKey(e);
      setError(t(key, params));
    },
  });

  const verify2faMutation = useMutation({
    mutationFn: () => api.post('/api/auth/login/verify-2fa', { challengeToken: challenge!.token, code }),
    onSuccess: () => void afterLogin(),
    onError: (e) => {
      const { key, params } = errorToMessageKey(e);
      setError(t(key, params));
    },
  });

  const demoMutation = useMutation({
    mutationFn: () => api.post('/api/auth/demo'),
    onSuccess: () => void afterLogin(),
    onError: (e) => {
      const { key, params } = errorToMessageKey(e);
      setError(t(key, params));
    },
  });

  if (challenge) {
    return (
      <AuthLayout>
        <h1>{t('auth.twoFactorTitle')}</h1>
        <p className="page-subtitle" style={{ marginBottom: 24 }}>{t('auth.twoFactorSubtitle')}</p>
        <form
          className="flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            verify2faMutation.mutate();
          }}
        >
          {error && <div className="field-error" role="alert">{error}</div>}
          <Field label={t('auth.twoFactorCode')}>
            <input
              className="input"
              autoFocus
              inputMode={useBackup ? 'text' : 'numeric'}
              maxLength={useBackup ? 24 : 6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={useBackup ? 'xxxxx-xxxxx' : '000000'}
            />
          </Field>
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={verify2faMutation.isPending || !code}>
            {t('auth.verify')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setUseBackup((v) => !v); setCode(''); }}>
            {useBackup ? t('auth.useAuthenticatorCode') : t('auth.useBackupCode')}
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>{t('auth.loginTitle')}</h1>
      <p className="page-subtitle" style={{ marginBottom: 24 }}>{t('auth.loginSubtitle')}</p>
      <form
        className="flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          loginMutation.mutate();
        }}
      >
        {error && <div className="field-error" role="alert">{error}</div>}
        <Field label={t('auth.identifier')} htmlFor="identifier">
          <input id="identifier" className="input" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
        </Field>
        <Field label={t('auth.password')} htmlFor="password">
          <div className="input-group">
            <input id="password" className="input" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <span className="input-group-suffix">
              <button type="button" className="btn btn-icon btn-ghost btn-sm" onClick={() => setShowPassword((s) => !s)} aria-label={t(showPassword ? 'common.hidePassword' : 'common.showPassword')}>
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </div>
        </Field>
        <div className="flex-row space-between">
          <label className="checkbox-row"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span className="text-sm">{t('auth.rememberMe')}</span></label>
          <Link to="/forgot-password" className="link text-sm">{t('auth.forgotPassword')}</Link>
        </div>
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={loginMutation.isPending}>{t('auth.logIn')}</button>
      </form>

      <div className="flex-row gap-3" style={{ margin: '20px 0' }}>
        <hr className="divider" style={{ flex: 1 }} /><span className="text-tertiary text-sm">{t('auth.orDivider')}</span><hr className="divider" style={{ flex: 1 }} />
      </div>
      <button className="btn btn-secondary btn-block" onClick={() => demoMutation.mutate()} disabled={demoMutation.isPending}>
        <KeyRound size={15} /> {t('auth.tryDemo')}
      </button>

      <p className="text-center text-sm mt-6">
        {t('auth.noAccount')} <Link to="/register" className="link">{t('auth.signUp')}</Link>
      </p>
    </AuthLayout>
  );
}
