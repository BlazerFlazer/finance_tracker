import { Link } from 'react-router';
import {
  ArrowRight, BarChart3, Wallet, Target, ShieldCheck, Sparkles, TrendingUp, PiggyBank,
  Landmark, Wand2, Moon, Sun, Globe,
} from 'lucide-react';
import { useT, useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { LANGUAGES, LANGUAGE_LABELS, type Lang } from '@shared/constants';
import { useAuth } from '../lib/auth';

const FEATURES = [
  { icon: Wallet, titleKey: 'nav.accounts' },
  { icon: BarChart3, titleKey: 'nav.analytics' },
  { icon: PiggyBank, titleKey: 'nav.budgets' },
  { icon: Target, titleKey: 'nav.goals' },
  { icon: Landmark, titleKey: 'nav.debts' },
  { icon: Wand2, titleKey: 'nav.forecast' },
  { icon: TrendingUp, titleKey: 'nav.netWorth' },
  { icon: Sparkles, titleKey: 'nav.insightsPage' },
];

export default function LandingPage() {
  const t = useT();
  const { lang, setLang } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const { user } = useAuth();

  return (
    <div>
      <header className="landing-header">
        <div className="landing-nav">
          <div className="flex-row gap-2" style={{ fontWeight: 700, fontSize: 17 }}>
            <div className="sidebar-brand-mark" style={{ width: 28, height: 28 }}>
              <svg width="15" height="15" viewBox="0 0 32 32" fill="none"><path d="M9 22V10h11" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 16h8" stroke="#fff" strokeWidth="3" strokeLinecap="round"/></svg>
            </div>
            FinTrack
          </div>
          <div className="flex-row gap-2" style={{ marginLeft: 'auto' }}>
            <button className="btn btn-icon btn-ghost btn-sm" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')} aria-label={t('nav.toggleTheme')}>
              {resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <select className="pill-select" value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="Language">
              {LANGUAGES.map((l) => <option key={l} value={l}>{LANGUAGE_LABELS[l]}</option>)}
            </select>
            {user ? (
              <Link to="/app/dashboard" className="btn btn-primary btn-sm">{t('nav.dashboard')}</Link>
            ) : (
              <>
                <Link to="/login" className="btn btn-ghost btn-sm">{t('auth.logIn')}</Link>
                <Link to="/register" className="btn btn-primary btn-sm">{t('auth.signUp')}</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="landing-section text-center" style={{ paddingTop: 96, paddingBottom: 64 }}>
        <span className="badge badge-brand" style={{ marginBottom: 20 }}><Globe size={11} /> {t('app.name')}</span>
        <h1 style={{ fontSize: 46, maxWidth: 780, margin: '0 auto', lineHeight: 1.15, letterSpacing: '-0.03em' }}>{t('auth.tagline')}</h1>
        <p style={{ fontSize: 17, color: 'var(--text-secondary)', maxWidth: 560, margin: '20px auto 0' }}>
          Budgets, goals, net worth, forecasts, and a clear answer to three questions: where is your money, where is it going, and what could your future look like.
        </p>
        <div className="flex-row gap-3" style={{ justifyContent: 'center', marginTop: 32 }}>
          <Link to="/register" className="btn btn-primary btn-lg">{t('auth.signUp')} <ArrowRight size={16} /></Link>
          <Link to="/login" className="btn btn-secondary btn-lg">{t('auth.tryDemo')}</Link>
        </div>
      </section>

      <section className="landing-section">
        <div className="grid grid-cols-4">
          {FEATURES.map((f) => (
            <div className="card card-pad" key={f.titleKey}>
              <div className="icon-chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', marginBottom: 12 }}>
                <f.icon size={18} />
              </div>
              <div className="font-semibold">{t(f.titleKey)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <div className="card card-pad" style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-soft-border)', textAlign: 'center', padding: 48 }}>
          <ShieldCheck size={30} color="var(--accent)" style={{ margin: '0 auto 16px' }} />
          <h2>Built with real security, not a demo login</h2>
          <p style={{ maxWidth: 520, margin: '12px auto 0', color: 'var(--text-secondary)' }}>
            Hashed passwords, two-factor authentication, session management, and full control over your own data — export or delete it whenever you want.
          </p>
        </div>
      </section>

      <footer style={{ borderTop: '1px solid var(--border)', padding: '32px 24px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
        <div className="flex-row gap-4" style={{ justifyContent: 'center' }}>
          <Link to="/terms" className="link">Terms</Link>
          <Link to="/privacy-policy" className="link">Privacy</Link>
        </div>
        <p className="mt-3">© {new Date().getFullYear()} FinTrack. {t('common.disclaimer')}</p>
      </footer>
    </div>
  );
}
