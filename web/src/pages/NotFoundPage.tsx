import { Link } from 'react-router';
import { useT } from '../lib/i18n';
import { useAuth } from '../lib/auth';

export default function NotFoundPage() {
  const t = useT();
  const { user } = useAuth();
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, textAlign: 'center', padding: 24 }}>
      <div style={{ fontSize: 64, fontWeight: 700, color: 'var(--accent)' }}>404</div>
      <h1>{t('errors.NOT_FOUND')}</h1>
      <Link to={user ? '/app/dashboard' : '/'} className="btn btn-primary">{t(user ? 'nav.dashboard' : 'common.back')}</Link>
    </div>
  );
}
