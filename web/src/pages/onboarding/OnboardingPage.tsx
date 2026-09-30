import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ChevronLeft, Sparkles } from 'lucide-react';
import { Field } from '../../components/ui/Field';
import { AmountInput } from '../../components/ui/AmountInput';
import { INCOME_FREQUENCIES, INCOME_SOURCES, SUPPORTED_COUNTRIES } from '@shared/constants';
import { useT } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { useCurrencies } from '../../hooks/api';
import { api } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';

const EXPENSE_FOCUS_OPTIONS = ['food', 'transport', 'shopping', 'entertainment', 'bills', 'rent', 'travel', 'health', 'education', 'family', 'subscriptions', 'technology'];
const STEPS = 4;

export default function OnboardingPage() {
  const t = useT();
  const nav = useNavigate();
  const { user, refetch } = useAuth();
  const { data: currencies } = useCurrencies();

  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [country, setCountry] = useState('UZ');
  const [mainCurrency, setMainCurrency] = useState(user?.mainCurrency ?? 'USD');
  const [incomeSource, setIncomeSource] = useState<typeof INCOME_SOURCES[number]>('salary');
  const [avgMonthlyIncomeMinor, setAvgMonthlyIncomeMinor] = useState<number | null>(null);
  const [incomeFrequency, setIncomeFrequency] = useState<typeof INCOME_FREQUENCIES[number]>('monthly');
  const [expenseFocus, setExpenseFocus] = useState<string[]>([]);
  const [hasDebts, setHasDebts] = useState<boolean | null>(null);
  const [hasSubscriptions, setHasSubscriptions] = useState<boolean | null>(null);
  const [mainGoal, setMainGoal] = useState('');
  const [desiredSavingsMinor, setDesiredSavingsMinor] = useState<number | null>(null);
  const [goalTimeframeMonths, setGoalTimeframeMonths] = useState<number | null>(12);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/api/profile/onboarding', {
        displayName, country, mainCurrency, incomeSource, avgMonthlyIncomeMinor, incomeFrequency,
        expenseFocus, hasDebts: !!hasDebts, hasSubscriptions: !!hasSubscriptions, mainGoal: mainGoal || undefined,
        desiredSavingsMinor, goalTimeframeMonths,
      }),
    onSuccess: async () => {
      await refetch();
      nav('/app/dashboard', { replace: true });
    },
    onError: (e) => {
      const { key, params } = errorToMessageKey(e);
      setError(t(key, params));
    },
  });

  const canAdvance = [!!displayName.trim() && !!country && !!mainCurrency, true, hasDebts !== null && hasSubscriptions !== null, true][step];

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div className="flex-row gap-2 mb-4">
          <Sparkles size={20} color="var(--accent)" />
          <span className="font-semibold">{t('app.name')}</span>
        </div>
        <div className="auth-step-indicator">
          {Array.from({ length: STEPS }).map((_, i) => <div key={i} className={`auth-step-dot ${i < step ? 'done' : i === step ? 'current' : ''}`} />)}
        </div>

        <div className="card card-pad mt-4">
          {error && <div className="field-error mb-3" role="alert">{error}</div>}

          {step === 0 && (
            <div className="flex-col gap-4">
              <h2>Let's get to know you</h2>
              <Field label={t('common.name')}><input className="input" autoFocus value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
              <Field label="Country">
                <select className="select" value={country} onChange={(e) => setCountry(e.target.value)}>
                  {SUPPORTED_COUNTRIES.map((c) => <option key={c} value={c}>{t(`enums.country.${c}`)}</option>)}
                </select>
              </Field>
              <Field label="Main currency">
                <select className="select" value={mainCurrency} onChange={(e) => setMainCurrency(e.target.value)}>
                  {(currencies ?? []).map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                </select>
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="flex-col gap-4">
              <h2>Your income</h2>
              <Field label="Main income source">
                <select className="select" value={incomeSource} onChange={(e) => setIncomeSource(e.target.value as typeof incomeSource)}>
                  {INCOME_SOURCES.map((s) => <option key={s} value={s}>{t(`enums.incomeSource.${s}`)}</option>)}
                </select>
              </Field>
              <Field label="Average monthly income" optional>
                <AmountInput minor={avgMonthlyIncomeMinor} currency={mainCurrency} onChange={setAvgMonthlyIncomeMinor} />
              </Field>
              <Field label="Income frequency">
                <select className="select" value={incomeFrequency} onChange={(e) => setIncomeFrequency(e.target.value as typeof incomeFrequency)}>
                  {INCOME_FREQUENCIES.map((f) => <option key={f} value={f}>{t(`enums.incomeFrequency.${f}`)}</option>)}
                </select>
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="flex-col gap-4">
              <h2>Your spending</h2>
              <Field label="Main expense categories" optional>
                <div className="flex-row wrap gap-2">
                  {EXPENSE_FOCUS_OPTIONS.map((key) => {
                    const active = expenseFocus.includes(key);
                    return (
                      <button key={key} type="button" className={active ? 'badge badge-brand' : 'badge badge-neutral'} onClick={() => setExpenseFocus((f) => (active ? f.filter((x) => x !== key) : [...f, key]))}>
                        {t(`categoryNames.${key}`)}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="Do you have any debts?">
                <div className="segmented"><button type="button" className={hasDebts === true ? 'active' : ''} onClick={() => setHasDebts(true)}>{t('common.yes')}</button><button type="button" className={hasDebts === false ? 'active' : ''} onClick={() => setHasDebts(false)}>{t('common.no')}</button></div>
              </Field>
              <Field label="Do you have recurring subscriptions?">
                <div className="segmented"><button type="button" className={hasSubscriptions === true ? 'active' : ''} onClick={() => setHasSubscriptions(true)}>{t('common.yes')}</button><button type="button" className={hasSubscriptions === false ? 'active' : ''} onClick={() => setHasSubscriptions(false)}>{t('common.no')}</button></div>
              </Field>
            </div>
          )}

          {step === 3 && (
            <div className="flex-col gap-4">
              <h2>Your main goal</h2>
              <Field label="What are you working towards?" optional>
                <input className="input" value={mainGoal} onChange={(e) => setMainGoal(e.target.value)} placeholder="e.g. Build an emergency fund" />
              </Field>
              <Field label="Desired savings" optional>
                <AmountInput minor={desiredSavingsMinor} currency={mainCurrency} onChange={setDesiredSavingsMinor} />
              </Field>
              <Field label="Timeframe (months)" optional>
                <input className="input" type="number" min={1} max={600} value={goalTimeframeMonths ?? ''} onChange={(e) => setGoalTimeframeMonths(e.target.value ? Number(e.target.value) : null)} />
              </Field>
            </div>
          )}

          <div className="flex-row space-between mt-6">
            {step > 0 ? <button className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}><ChevronLeft size={15} /> {t('common.back')}</button> : <span />}
            <button
              className="btn btn-primary"
              disabled={!canAdvance || mutation.isPending}
              onClick={() => (step === STEPS - 1 ? mutation.mutate() : setStep((s) => s + 1))}
            >
              {step === STEPS - 1 ? t('common.done') : t('common.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
