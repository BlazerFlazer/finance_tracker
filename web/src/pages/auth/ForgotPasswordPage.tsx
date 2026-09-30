import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';
import { MailCheck } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { Field } from '../../components/ui/Field';
import { useT } from '../../lib/i18n';
import { api } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.post('/api/auth/forgot-password', { email }),
    onError: (e) => {
      const { key, params } = errorToMessageKey(e);
      setError(t(key, params));
    },
  });

  if (mutation.isSuccess) {
    return (
      <AuthLayout>
        <div className="text-center">
          <MailCheck size={40} color="var(--success)" style={{ margin: '0 auto 16px' }} />
          <h1>{t('auth.forgotSent')}</h1>
          <Link to="/login" className="btn btn-secondary mt-6">{t('auth.backToLogin')}</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>{t('auth.forgotTitle')}</h1>
      <p className="page-subtitle" style={{ marginBottom: 24 }}>{t('auth.forgotSubtitle')}</p>
      <form className="flex-col gap-4" onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}>
        {error && <div className="field-error" role="alert">{error}</div>}
        <Field label={t('auth.emailLabel')} htmlFor="email">
          <input id="email" className="input" type="email" autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={mutation.isPending}>{t('auth.sendResetLink')}</button>
      </form>
      <p className="text-center text-sm mt-6"><Link to="/login" className="link">{t('auth.backToLogin')}</Link></p>
    </AuthLayout>
  );
}
