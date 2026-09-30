import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { Check, ChevronLeft, Eye, EyeOff, X } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { Field } from '../../components/ui/Field';
import { checkPassword, STRENGTH_LABELS } from '@shared/password';
import { USERNAME_MAX, USERNAME_MIN } from '@shared/constants';
import { useT } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';

const STEPS = ['stepEmail', 'stepUsername', 'stepPassword', 'stepConfirm', 'stepTerms'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

function useDebouncedAvailability(value: string, valid: boolean, checkFn: (v: string) => Promise<{ available: boolean }>) {
  const [state, setState] = useState<Availability>('idle');
  const seq = useRef(0);
  useEffect(() => {
    if (!value) return setState('idle');
    if (!valid) return setState('invalid');
    setState('checking');
    const mySeq = ++seq.current;
    const id = setTimeout(() => {
      checkFn(value)
        .then((r) => { if (seq.current === mySeq) setState(r.available ? 'available' : 'taken'); })
        .catch(() => { if (seq.current === mySeq) setState('idle'); });
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, valid]);
  return state;
}

export default function RegisterPage() {
  const t = useT();
  const nav = useNavigate();
  const { refetch } = useAuth();

  const [step, setStep] = useState(0);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = EMAIL_RE.test(email);
  const emailAvail = useDebouncedAvailability(email, emailValid, (v) => api.post('/api/auth/register/check-email', { email: v }));
  const usernameValid = username.length >= USERNAME_MIN && username.length <= USERNAME_MAX && USERNAME_RE.test(username);
  const usernameAvail = useDebouncedAvailability(username, usernameValid, (v) => api.post('/api/auth/register/check-username', { username: v }));

  const strength = password ? checkPassword(password, { email, username }) : null;

  const registerMutation = useMutation({
    mutationFn: () =>
      api.post('/api/auth/register', {
        email, username, password, confirmPassword, acceptTerms, acceptPrivacy,
        language: document.documentElement.lang || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    onSuccess: async () => {
      await refetch();
      nav('/onboarding', { replace: true });
    },
    onError: (e) => {
      const { key, params } = errorToMessageKey(e);
      setError(t(key, params));
    },
  });

  const canAdvance = [emailValid && emailAvail === 'available', usernameValid && usernameAvail === 'available', !!strength?.ok, password === confirmPassword && !!password, acceptTerms && acceptPrivacy][step];

  const next = () => {
    setError(null);
    if (step === STEPS.length - 1) registerMutation.mutate();
    else setStep((s) => s + 1);
  };

  return (
    <AuthLayout>
      <div className="flex-row space-between" style={{ marginBottom: 6 }}>
        <h1>{t('auth.registerTitle')}</h1>
        {step > 0 && (
          <button className="btn btn-icon btn-ghost btn-sm" onClick={() => setStep((s) => s - 1)} aria-label={t('common.back')}>
            <ChevronLeft size={17} />
          </button>
        )}
      </div>
      <p className="page-subtitle" style={{ marginBottom: 16 }}>{t('auth.registerSubtitle', { step: step + 1, total: STEPS.length })}</p>
      <div className="auth-step-indicator">
        {STEPS.map((_, i) => (
          <div key={i} className={`auth-step-dot ${i < step ? 'done' : i === step ? 'current' : ''}`} />
        ))}
      </div>

      <form
        className="flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canAdvance) next();
        }}
      >
        {error && <div className="field-error" role="alert">{error}</div>}

        {step === 0 && (
          <Field label={t('auth.emailLabel')} htmlFor="email" error={email && emailAvail === 'taken' ? t('auth.emailTaken') : email && !emailValid ? t('validation.email_invalid') : undefined}>
            <div className="input-group">
              <input id="email" className="input" type="email" autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} />
              <span className="input-group-suffix">
                {emailAvail === 'checking' && <span className="text-tertiary text-sm">{t('auth.checking')}</span>}
                {emailAvail === 'available' && <Check size={16} color="var(--success)" />}
                {emailAvail === 'taken' && <X size={16} color="var(--danger)" />}
              </span>
            </div>
          </Field>
        )}

        {step === 1 && (
          <Field
            label={t('auth.usernameLabel')}
            htmlFor="username"
            hint={t('auth.usernameHint')}
            error={username && usernameAvail === 'taken' ? t('auth.usernameTaken') : undefined}
          >
            <div className="input-group">
              <input id="username" className="input" autoFocus value={username} onChange={(e) => setUsername(e.target.value.trim())} />
              <span className="input-group-suffix">
                {usernameAvail === 'checking' && <span className="text-tertiary text-sm">{t('auth.checking')}</span>}
                {usernameAvail === 'available' && <Check size={16} color="var(--success)" />}
                {usernameAvail === 'taken' && <X size={16} color="var(--danger)" />}
              </span>
            </div>
          </Field>
        )}

        {step === 2 && (
          <Field label={t('auth.passwordLabel')} htmlFor="password" hint={t('auth.passwordHint')}>
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
                  <div
                    className={`progress-bar ${['danger', 'warning', 'warning', 'success', 'success'][strength.score]}`}
                    style={{ width: `${(STRENGTH_LABELS.indexOf(strength.label) + 1) * 20}%` }}
                  />
                </div>
                <div className="text-sm mt-1" style={{ fontWeight: 600 }}>{t(`auth.strength.${strength.label}`)}</div>
                <ul className="mt-2 flex-col gap-1">
                  {(['length', 'upper', 'lower', 'digit', 'special'] as const).map((req) => (
                    <li key={req} className="flex-row gap-2 text-sm" style={{ color: strength.requirements[req] ? 'var(--success)' : 'var(--text-tertiary)' }}>
                      {strength.requirements[req] ? <Check size={13} /> : <X size={13} />} {t(`auth.requirements.${req}`)}
                    </li>
                  ))}
                </ul>
                {strength.issues.includes('banned_word') || strength.issues.includes('too_common') ? (
                  <div className="field-error mt-2">{t('validation.password_banned_word')}</div>
                ) : null}
              </div>
            )}
          </Field>
        )}

        {step === 3 && (
          <Field label={t('auth.confirmPasswordLabel')} htmlFor="confirm" error={confirmPassword && confirmPassword !== password ? t('validation.passwords_mismatch') : undefined}>
            <input id="confirm" className="input" type={showPassword ? 'text' : 'password'} autoFocus autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </Field>
        )}

        {step === 4 && (
          <div className="flex-col gap-3">
            <label className="checkbox-row">
              <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
              <span className="text-sm">{t('auth.acceptTermsPrefix')} <Link to="/terms" target="_blank" className="link">{t('auth.termsOfService')}</Link></span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={acceptPrivacy} onChange={(e) => setAcceptPrivacy(e.target.checked)} />
              <span className="text-sm">{t('auth.acceptTermsPrefix')} <Link to="/privacy-policy" target="_blank" className="link">{t('auth.privacyPolicy')}</Link></span>
            </label>
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!canAdvance || registerMutation.isPending}>
          {step === STEPS.length - 1 ? t('auth.createAccount') : t('common.next')}
        </button>
      </form>

      <p className="text-center text-sm mt-6">
        {t('auth.haveAccount')} <Link to="/login" className="link">{t('auth.logIn')}</Link>
      </p>
    </AuthLayout>
  );
}
