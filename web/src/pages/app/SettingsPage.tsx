import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/ui/PageHeader';
import { Field } from '../../components/ui/Field';
import { LoadingBlock } from '../../components/ui/States';
import { LANGUAGES, LANGUAGE_LABELS, SUPPORTED_COUNTRIES, THEMES, type Lang, type Theme } from '@shared/constants';
import { useT, useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { useCurrencies } from '../../hooks/api';
import { errorToMessageKey } from '../../lib/errors';

interface Profile { displayName: string | null; country: string | null; mainCurrency: string; language: Lang; timezone: string; theme: Theme; weekStart: 0 | 1; aiConsent: boolean }

export default function SettingsPage() {
  const t = useT();
  const { setLang } = useI18n();
  const { setTheme } = useTheme();
  const { show } = useToast();
  const { refetch } = useAuth();
  const qc = useQueryClient();
  const { data: currencies } = useCurrencies();
  const { data, isLoading } = useQuery({ queryKey: ['profile'], queryFn: () => api.get<{ profile: Profile }>('/api/profile').then((r) => r.profile) });

  const [form, setForm] = useState<Profile | null>(null);
  useEffect(() => { if (data && !form) setForm(data); }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: () => api.patch('/api/profile', form),
    onSuccess: async () => {
      show({ kind: 'success', title: t('common.saved') });
      if (form) { setLang(form.language); setTheme(form.theme); }
      await refetch();
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (e) => { const { key, params } = errorToMessageKey(e); show({ kind: 'error', title: t(key, params) }); },
  });

  const aiMutation = useMutation({
    mutationFn: (enabled: boolean) => api.post('/api/profile/ai-consent', { enabled }),
    onSuccess: (_, enabled) => { setForm((f) => (f ? { ...f, aiConsent: enabled } : f)); show({ kind: 'success', title: t('common.saved') }); },
  });

  if (isLoading || !form) return (<><PageHeader title={t('nav.settings')} /><LoadingBlock height={400} /></>);

  return (
    <>
      <PageHeader title={t('nav.settings')} actions={<button className="btn btn-primary btn-sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>{t('common.saveChanges')}</button>} />
      <div className="flex-col gap-4" style={{ maxWidth: 560 }}>
        <div className="card card-pad">
          <div className="card-title mb-4">Profile</div>
          <div className="flex-col gap-4">
            <Field label={t('common.name')}><input className="input" value={form.displayName ?? ''} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
            <Field label="Country">
              <select className="select" value={form.country ?? ''} onChange={(e) => setForm({ ...form, country: e.target.value })}>
                {SUPPORTED_COUNTRIES.map((c) => <option key={c} value={c}>{t(`enums.country.${c}`)}</option>)}
              </select>
            </Field>
            <Field label="Main currency">
              <select className="select" value={form.mainCurrency} onChange={(e) => setForm({ ...form, mainCurrency: e.target.value })}>
                {(currencies ?? []).map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
              </select>
            </Field>
          </div>
        </div>

        <div className="card card-pad">
          <div className="card-title mb-4">Preferences</div>
          <div className="flex-col gap-4">
            <Field label="Language">
              <select className="select" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as Lang })}>
                {LANGUAGES.map((l) => <option key={l} value={l}>{LANGUAGE_LABELS[l]}</option>)}
              </select>
            </Field>
            <Field label="Theme">
              <div className="segmented">{THEMES.map((th) => <button key={th} className={form.theme === th ? 'active' : ''} onClick={() => setForm({ ...form, theme: th })}>{t(`enums.theme.${th}`)}</button>)}</div>
            </Field>
            <Field label="Week starts on">
              <div className="segmented"><button className={form.weekStart === 1 ? 'active' : ''} onClick={() => setForm({ ...form, weekStart: 1 })}>Monday</button><button className={form.weekStart === 0 ? 'active' : ''} onClick={() => setForm({ ...form, weekStart: 0 })}>Sunday</button></div>
            </Field>
            <Field label="Timezone"><input className="input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></Field>
          </div>
        </div>

        <div className="card card-pad">
          <div className="flex-row space-between">
            <div>
              <div className="card-title">AI-enhanced answers</div>
              <p className="text-secondary text-sm mt-1" style={{ maxWidth: 380 }}>Let AI Insights and the Assistant phrase answers using a summary of your data. {t('common.disclaimer')}</p>
            </div>
            <label className="switch"><input type="checkbox" checked={form.aiConsent} onChange={(e) => aiMutation.mutate(e.target.checked)} /><span className="switch-track" /><span className="switch-thumb" /></label>
          </div>
        </div>
      </div>
    </>
  );
}
