import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronLeft, ChevronRight, LogOut, Menu, Moon, Search, Settings as SettingsIcon, ShieldCheck, Sun, User, X } from 'lucide-react';
import { NAV_GROUPS, ADMIN_NAV_ITEM, MOBILE_NAV } from './nav';
import { CommandPalette } from './CommandPalette';
import { QuickAddButton, QuickAddMenuItems, useQuickAddModals } from './QuickAdd';
import { Dropdown } from '../ui/Dropdown';
import { useAuth } from '../../lib/auth';
import { useI18n, useT } from '../../lib/i18n';
import { useTheme } from '../../lib/theme';
import { api } from '../../lib/api';
import { ME_QUERY_KEY } from '../../lib/auth';

export function AppShell() {
  const t = useT();
  const { lang } = useI18n();
  const { user, refetch } = useAuth();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const nav = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('fintrack-sidebar-collapsed') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const quickAdd = useQuickAddModals();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem('fintrack-sidebar-collapsed', c ? '0' : '1');
      return !c;
    });
  };

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<{ unreadCount: number }>('/api/notifications/unread-count').then((r) => r.unreadCount),
    refetchInterval: 60_000,
  });

  const logout = async () => {
    await api.post('/api/auth/logout').catch(() => {});
    qc.setQueryData(ME_QUERY_KEY, null);
    nav('/login');
  };

  const initials = (user?.displayName || user?.username || '?').slice(0, 2).toUpperCase();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{t('common.skipToContent')}</a>

      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`} aria-label={t('nav.primary')}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none"><path d="M9 22V10h11" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 16h8" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"/></svg>
          </div>
          <span className="sidebar-brand-text">FinTrack</span>
          <button className="btn btn-icon btn-ghost btn-sm hide-desktop" style={{ marginLeft: 'auto' }} onClick={() => setMobileOpen(false)} aria-label={t('nav.closeMenu')}>
            <X size={16} />
          </button>
        </div>
        <nav className="sidebar-scroll">
          {NAV_GROUPS.map((group) => (
            <div className="sidebar-group" key={group.labelKey}>
              <div className="sidebar-group-label">{t(group.labelKey)}</div>
              {group.items.map((item) => (
                <NavLink key={item.path} to={item.path} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} title={collapsed ? t(item.key) : undefined}>
                  <item.icon size={17} />
                  <span className="sidebar-link-label">{t(item.key)}</span>
                </NavLink>
              ))}
            </div>
          ))}
          {user?.role === 'admin' && (
            <div className="sidebar-group">
              <div className="sidebar-group-label">{t('nav.admin')}</div>
              <NavLink to={ADMIN_NAV_ITEM.path} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                <ADMIN_NAV_ITEM.icon size={17} />
                <span className="sidebar-link-label">{t(ADMIN_NAV_ITEM.key)}</span>
              </NavLink>
            </div>
          )}
        </nav>
        <div className="sidebar-footer desktop-only">
          <button className="sidebar-collapse-btn" onClick={toggleCollapsed} aria-label={t(collapsed ? 'nav.expand' : 'nav.collapse')}>
            {collapsed ? <ChevronRight size={16} /> : <><ChevronLeft size={16} /><span style={{ marginLeft: 6, fontSize: 12.5 }}>{t('nav.collapse')}</span></>}
          </button>
        </div>
      </aside>

      <div className="main-content">
        <header className="topbar">
          <button className="btn btn-icon btn-ghost hide-desktop" onClick={() => setMobileOpen(true)} aria-label={t('nav.openMenu')}>
            <Menu size={19} />
          </button>
          <button className="topbar-search" onClick={() => setPaletteOpen(true)}>
            <Search size={15} />
            <span className="topbar-search-text">{t('nav.searchPlaceholder')}</span>
            <span className="kbd" style={{ marginLeft: 'auto' }}>Ctrl K</span>
          </button>
          <div className="topbar-actions">
            <div className="desktop-only"><QuickAddButton open={quickAdd.open} /></div>
            <button className="topbar-icon-btn" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')} aria-label={t('nav.toggleTheme')} title={t('nav.toggleTheme')}>
              {resolvedTheme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button className="topbar-icon-btn" onClick={() => nav('/app/notifications')} aria-label={t('nav.notifications')}>
              <Bell size={17} />
              {!!unread && <span className="dot" />}
            </button>
            <Dropdown
              align="end"
              trigger={({ onClick, ref, open }) => (
                <button ref={ref as React.RefObject<HTMLButtonElement>} className="topbar-user" onClick={onClick} aria-expanded={open} aria-label={t('nav.userMenu')}>
                  <span className="avatar" style={{ width: 30, height: 30 }}>{initials}</span>
                </button>
              )}
            >
              <div className="dropdown-label">{user?.displayName || user?.username}</div>
              <div className="dropdown-item" style={{ pointerEvents: 'none', color: 'var(--text-tertiary)' }}>{user?.email}</div>
              <div className="dropdown-sep" />
              <button className="dropdown-item" onClick={() => nav('/app/settings')}><SettingsIcon size={15} /> {t('nav.settings')}</button>
              <button className="dropdown-item" onClick={() => nav('/app/security')}><ShieldCheck size={15} /> {t('nav.security')}</button>
              <div className="dropdown-sep" />
              <button className="dropdown-item danger" onClick={logout}><LogOut size={15} /> {t('nav.logout')}</button>
            </Dropdown>
          </div>
        </header>

        {user?.isDemo && (
          <div className="demo-banner">
            <User size={14} /> {t('common.demo')} — {user.email}
          </div>
        )}
        {user && !user.emailVerifiedAt && <VerifyBanner />}

        <main id="main-content" className="page">
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav" aria-label={t('nav.mobile')}>
        {MOBILE_NAV.slice(0, 2).map((item) => (
          <NavLink key={item.path} to={item.path} className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
            <item.icon size={20} />
            {t(item.key)}
          </NavLink>
        ))}
        <div className="bottom-nav-fab">
          <Dropdown
            trigger={({ onClick, ref }) => (
              <button ref={ref as React.RefObject<HTMLButtonElement>} className="bottom-nav-fab-btn" onClick={onClick} aria-label={t('nav.quickAdd')}>
                <span style={{ fontSize: 26, lineHeight: 1, marginTop: -2 }}>+</span>
              </button>
            )}
          >
            <QuickAddMenuItems onPick={quickAdd.open} />
          </Dropdown>
        </div>
        {MOBILE_NAV.slice(2).map((item) => (
          <NavLink key={item.path} to={item.path} className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
            <item.icon size={20} />
            {t(item.key)}
          </NavLink>
        ))}
      </nav>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onQuickAdd={quickAdd.open} />
      {quickAdd.modals}
      <span className="sr-only" lang={lang}>{lang}</span>
    </div>
  );

  function VerifyBanner() {
    const [sending, setSending] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    useEffect(() => {
      if (cooldown <= 0) return;
      const id = setInterval(() => setCooldown((c) => c - 1), 1000);
      return () => clearInterval(id);
    }, [cooldown]);
    const resend = async () => {
      setSending(true);
      try {
        const res = await api.post<{ cooldownSeconds: number }>('/api/auth/resend-verification');
        setCooldown(res.cooldownSeconds);
      } catch {
        /* surfaced via the generic error banner styling; keep this best-effort */
      } finally {
        setSending(false);
        refetch();
      }
    };
    return (
      <div className="verify-banner">
        <span>{t('errors.EMAIL_NOT_VERIFIED')}</span>
        <button className="btn btn-secondary btn-sm" onClick={resend} disabled={sending || cooldown > 0}>
          {cooldown > 0 ? `${t('common.retry')} (${cooldown}s)` : t('auth.resendVerification')}
        </button>
      </div>
    );
  }
}
