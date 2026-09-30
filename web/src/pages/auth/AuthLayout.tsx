import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Sparkles } from 'lucide-react';
import { useT } from '../../lib/i18n';

export function AuthLayout({ children, showcaseTitle, showcaseBody }: { children: ReactNode; showcaseTitle?: string; showcaseBody?: string }) {
  const t = useT();
  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <div className="auth-card">
          <Link to="/" className="auth-brand">
            <div className="sidebar-brand-mark">
              <svg width="18" height="18" viewBox="0 0 32 32" fill="none"><path d="M9 22V10h11" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 16h8" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"/></svg>
            </div>
            <span style={{ fontWeight: 700, fontSize: 18 }}>FinTrack</span>
          </Link>
          {children}
        </div>
      </div>
      <div className="auth-showcase">
        <div style={{ maxWidth: 380 }}>
          <Sparkles size={28} style={{ marginBottom: 20, opacity: 0.9 }} />
          <h2 style={{ fontSize: 26, color: '#fff', marginBottom: 12 }}>{showcaseTitle ?? t('auth.tagline')}</h2>
          {showcaseBody && <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14.5, lineHeight: 1.6 }}>{showcaseBody}</p>}
        </div>
      </div>
    </div>
  );
}
