import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CheckCircle2, MailWarning, XCircle } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { useT } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';

export default function VerifyEmailPage() {
  const t = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const { user, refetch } = useAuth();
  const [result, setResult] = useState<'pending' | 'success' | 'already' | 'error'>('pending');
  const [errorText, setErrorText] = useState('');

  const mutation = useMutation({
    mutationFn: (tok: string) => api.post<{ alreadyVerified: boolean }>('/api/auth/verify-email', { token: tok }),
    onSuccess: async (res) => {
      setResult(res.alreadyVerified ? 'already' : 'success');
      await refetch();
    },
    onError: (e) => {
      setResult('error');
      const { key, params: p } = errorToMessageKey(e);
      setErrorText(t(key, p));
    },
  });

  useEffect(() => {
    if (token) mutation.mutate(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token) {
    return (
      <AuthLayout>
        <div className="text-center">
          <MailWarning size={40} color="var(--warning)" style={{ margin: '0 auto 16px' }} />
          <h1>{t('auth.verifyEmailTitle')}</h1>
          <p className="page-subtitle mt-2">{user ? t('auth.verifyEmailPending', { email: user.email }) : t('errors.TOKEN_INVALID')}</p>
          <Link to={user ? '/app/dashboard' : '/login'} className="btn btn-primary mt-6">{t(user ? 'auth.goToApp' : 'auth.backToLogin')}</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="text-center">
        {result === 'pending' && <p>{t('common.loading')}</p>}
        {(result === 'success' || result === 'already') && (
          <>
            <CheckCircle2 size={40} color="var(--success)" style={{ margin: '0 auto 16px' }} />
            <h1>{t(result === 'success' ? 'auth.verifyEmailSuccess' : 'auth.verifyEmailAlready')}</h1>
            <button className="btn btn-primary mt-6" onClick={() => nav(user ? '/app/dashboard' : '/login')}>{t(user ? 'auth.goToApp' : 'auth.backToLogin')}</button>
          </>
        )}
        {result === 'error' && (
          <>
            <XCircle size={40} color="var(--danger)" style={{ margin: '0 auto 16px' }} />
            <h1>{t('auth.verifyEmailInvalid')}</h1>
            <p className="page-subtitle mt-2">{errorText}</p>
            <Link to="/login" className="btn btn-secondary mt-6">{t('auth.backToLogin')}</Link>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
