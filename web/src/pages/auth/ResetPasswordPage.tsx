import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Check, Eye, EyeOff } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { Field } from '../../components/ui/Field';
import { checkPassword, STRENGTH_LABELS } from '@shared/password';
import { useT } from '../../lib/i18n';
import { api } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';

export default function ResetPasswordPage() {
  const t = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength = password ? checkPassword(password) : null;

  const mutation = useMutation({
    mutationFn: () => api.post('/api/auth/reset-password', { token, password, confirmPassword }),
    onError: (e) => {
      const { key, params: p } = errorToMessageKey(e);
      setError(t(key, p));
    },
  });

  if (!token) {
    return (
      <AuthLayout>
        <div className="text-center">
          <h1>{t('errors.TOKEN_INVALID')}</h1>
          <Link to="/forgot-password" className="btn btn-primary mt-6">{t('auth.forgotTitle')}</Link>
        </div>
      </AuthLayout>
    );
  }

  if (mutation.isSuccess) {
    return (
      <AuthLayout>
        <div className="text-center">
          <Check size={40} color="var(--success)" style={{ margin: '0 auto 16px' }} />
          <h1>{t('auth.resetSuccess')}</h1>
          <button className="btn btn-primary mt-6" onClick={() => nav('/login')}>{t('auth.logIn')}</button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>{t('auth.resetTitle')}</h1>
      <form className="flex-col gap-4 mt-6" onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}>
        {error && <div className="field-error" role="alert">{error}</div>}
        <Field label={t('auth.passwordLabel')} htmlFor="password">
          <div className="input-group">
            <input id="password" className="input" type={showPassword ? 'text' : 'password'} autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <span className="input-group-suffix">
              <button type="button" className="btn btn-icon btn-ghost btn-sm" onClick={() => setShowPassword((s) => !s)} aria-label={t(showPassword ? 'common.hidePassword' : 'common.showPassword')}>
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </div>
          {password && strength && (
            <div className="mt-2">
              <div className="progress-track" style={{ height: 5 }}>
                <div className={`progress-bar ${['danger', 'warning', 'warning', 'success', 'success'][strength.score]}`} style={{ width: `${(STRENGTH_LABELS.indexOf(strength.label) + 1) * 20}%` }} />
              </div>
              <div className="text-sm mt-1" style={{ fontWeight: 600 }}>{t(`auth.strength.${strength.label}`)}</div>
            </div>
          )}
        </Field>
        <Field label={t('auth.confirmPasswordLabel')} htmlFor="confirm" error={confirmPassword && confirmPassword !== password ? t('validation.passwords_mismatch') : undefined}>
          <input id="confirm" className="input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={mutation.isPending || !strength?.ok || password !== confirmPassword}>
          {t('auth.resetTitle')}
        </button>
      </form>
    </AuthLayout>
  );
}
