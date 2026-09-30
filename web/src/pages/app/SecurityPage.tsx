import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { AlertTriangle, Laptop, Monitor, Shield, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Field } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { LoadingBlock } from '../../components/ui/States';
import { useT, useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';
import { formatDate } from '@shared/dates';

interface Overview { emailVerified: boolean; twoFactor: { enabled: boolean; backupCodesRemaining: number }; activeSessions: number; memberSince: string }
interface Session { id: string; browser: string | null; os: string | null; deviceType: string; countryCode: string | null; ip: string | null; lastActiveAt: string; isCurrent: boolean }
interface SecurityEvent { id: string; type: string; severity: string; ip: string | null; countryCode: string | null; createdAt: string }

function TwoFactorSetup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { show } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState<'password' | 'scan' | 'codes'>('password');
  const [password, setPassword] = useState('');
  const [qr, setQr] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState('');

  const setupMutation = useMutation({
    mutationFn: () => api.post<{ secret: string; qrCodeDataUrl: string }>('/api/security/2fa/setup', { password }),
    onSuccess: (res) => { setQr(res); setStep('scan'); setError(''); },
    onError: (e) => { const { key, params } = errorToMessageKey(e); setError(t(key, params)); },
  });
  const enableMutation = useMutation({
    mutationFn: () => api.post<{ backupCodes: string[] }>('/api/security/2fa/enable', { code }),
    onSuccess: (res) => { setBackupCodes(res.backupCodes); setStep('codes'); setError(''); qc.invalidateQueries({ queryKey: ['security', 'overview'] }); },
    onError: (e) => { const { key, params } = errorToMessageKey(e); setError(t(key, params)); },
  });

  const close = () => { setStep('password'); setPassword(''); setQr(null); setCode(''); setBackupCodes([]); setError(''); onClose(); };

  return (
    <Modal open={open} onClose={close} title={t('auth.twoFactorTitle')}>
      {error && <div className="field-error mb-3">{error}</div>}
      {step === 'password' && (
        <div className="flex-col gap-4">
          <Field label={t('auth.password')}><input className="input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <button className="btn btn-primary" disabled={!password || setupMutation.isPending} onClick={() => setupMutation.mutate()}>{t('common.continue')}</button>
        </div>
      )}
      {step === 'scan' && qr && (
        <div className="flex-col gap-4 text-center">
          <p className="text-secondary text-sm">Scan this QR code with your authenticator app, then enter the 6-digit code.</p>
          <img src={qr.qrCodeDataUrl} alt="QR code" style={{ width: 180, margin: '0 auto', borderRadius: 8 }} />
          <p className="text-tertiary text-xs" style={{ wordBreak: 'break-all' }}>{qr.secret}</p>
          <input className="input" style={{ textAlign: 'center', letterSpacing: 4 }} maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" />
          <button className="btn btn-primary" disabled={code.length !== 6 || enableMutation.isPending} onClick={() => enableMutation.mutate()}>{t('auth.verify')}</button>
        </div>
      )}
      {step === 'codes' && (
        <div className="flex-col gap-4">
          <div className="disclaimer-box"><Shield size={15} /> Save these backup codes somewhere safe. Each can be used once if you lose access to your authenticator app.</div>
          <div className="card card-pad" style={{ fontFamily: 'var(--font-mono)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {backupCodes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <button className="btn btn-primary" onClick={close}>{t('common.done')}</button>
        </div>
      )}
    </Modal>
  );
}

function Disable2FAModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { show } = useToast();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post('/api/security/2fa/disable', { password, code }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security', 'overview'] }); show({ kind: 'success', title: t('common.saved') }); close(); },
    onError: (e) => { const { key, params } = errorToMessageKey(e); setError(t(key, params)); },
  });
  const close = () => { setPassword(''); setCode(''); setError(''); onClose(); };

  return (
    <Modal open={open} onClose={close} title="Disable two-factor authentication" footer={<><button className="btn btn-ghost" onClick={close}>{t('common.cancel')}</button><button className="btn btn-danger" disabled={!password || !code || mutation.isPending} onClick={() => mutation.mutate()}>Disable</button></>}>
      <div className="flex-col gap-4">
        {error && <div className="field-error">{error}</div>}
        <Field label={t('auth.password')}><input className="input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label={t('auth.twoFactorCode')}><input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" /></Field>
      </div>
    </Modal>
  );
}

function DeleteAccountModal({ open, onClose, username }: { open: boolean; onClose: () => void; username: string }) {
  const t = useT();
  const nav = useNavigate();
  const { show } = useToast();
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [mode, setMode] = useState<'grace' | 'immediate'>('grace');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post<{ deletedImmediately: boolean; scheduledFor?: string }>('/api/security/delete-account', { password, confirmText, mode, acknowledge: true }),
    onSuccess: (res) => {
      show({ kind: 'success', title: res.deletedImmediately ? 'Account deleted' : `Scheduled for deletion on ${res.scheduledFor?.slice(0, 10)}` });
      onClose();
      if (res.deletedImmediately) { window.location.href = '/'; } else nav('/app/security');
    },
    onError: (e) => { const { key, params } = errorToMessageKey(e); setError(t(key, params)); },
  });

  return (
    <Modal open={open} onClose={onClose} title="Delete account" footer={<><button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn btn-danger" disabled={!password || confirmText.toLowerCase() !== username.toLowerCase() || mutation.isPending} onClick={() => mutation.mutate()}>Delete account</button></>}>
      <div className="flex-col gap-4">
        {error && <div className="field-error">{error}</div>}
        <div className="disclaimer-box" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)' }}><AlertTriangle size={15} color="var(--danger)" /> This will permanently delete all your financial data. This cannot be undone once the grace period ends.</div>
        <Field label="Mode">
          <div className="segmented"><button className={mode === 'grace' ? 'active' : ''} onClick={() => setMode('grace')}>Grace period</button><button className={mode === 'immediate' ? 'active' : ''} onClick={() => setMode('immediate')}>Immediate</button></div>
        </Field>
        <Field label={t('auth.password')}><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label={`Type your username ("${username}") to confirm`}><input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export default function SecurityPage() {
  const t = useT();
  const { locale } = useI18n();
  const { user } = useAuth();
  const { show } = useToast();
  const qc = useQueryClient();
  const [twoFaOpen, setTwoFaOpen] = useState(false);
  const [disable2faOpen, setDisable2faOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const { data: overview, isLoading } = useQuery({ queryKey: ['security', 'overview'], queryFn: () => api.get<Overview>('/api/security/overview') });
  const { data: sessions } = useQuery({ queryKey: ['security', 'sessions'], queryFn: () => api.get<{ sessions: Session[] }>('/api/security/sessions').then((r) => r.sessions) });
  const { data: events } = useQuery({ queryKey: ['security', 'events'], queryFn: () => api.get<{ items: SecurityEvent[] }>('/api/security/events', { pageSize: 10 }).then((r) => r.items) });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const changePasswordMutation = useMutation({
    mutationFn: () => api.post('/api/security/change-password', { currentPassword, newPassword, confirmPassword, logoutOthers: true }),
    onSuccess: () => { show({ kind: 'success', title: t('common.saved') }); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); },
    onError: (e) => { const { key, params } = errorToMessageKey(e); show({ kind: 'error', title: t(key, params) }); },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/security/sessions/${id}/revoke`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security', 'sessions'] }); show({ kind: 'success', title: t('common.done') }); },
  });
  const revokeOthersMutation = useMutation({
    mutationFn: () => api.post('/api/security/sessions/revoke-others'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['security', 'sessions'] }); show({ kind: 'success', title: t('common.done') }); },
  });

  const deviceIcon = (type: string) => (type === 'mobile' ? Smartphone : type === 'tablet' ? Laptop : Monitor);

  return (
    <>
      <PageHeader title={t('nav.security')} />
      {isLoading || !overview ? <LoadingBlock height={400} /> : (
        <div className="flex-col gap-4">
          <div className="grid grid-cols-3">
            <div className="card card-pad flex-row gap-2"><ShieldCheck size={16} color={overview.emailVerified ? 'var(--success)' : 'var(--warning)'} /><span className="text-sm">Email {overview.emailVerified ? 'verified' : 'not verified'}</span></div>
            <div className="card card-pad flex-row gap-2"><Shield size={16} color={overview.twoFactor.enabled ? 'var(--success)' : 'var(--text-tertiary)'} /><span className="text-sm">2FA {overview.twoFactor.enabled ? 'enabled' : 'disabled'}</span></div>
            <div className="card card-pad flex-row gap-2"><Monitor size={16} /><span className="text-sm">{overview.activeSessions} active sessions</span></div>
          </div>

          <div className="card card-pad">
            <div className="card-title mb-4">Password</div>
            <div className="grid grid-cols-3" style={{ gap: 12 }}>
              <Field label="Current password"><input className="input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></Field>
              <Field label="New password"><input className="input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></Field>
              <Field label="Confirm"><input className="input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></Field>
            </div>
            <button className="btn btn-primary mt-4" disabled={!currentPassword || !newPassword || newPassword !== confirmPassword || changePasswordMutation.isPending} onClick={() => changePasswordMutation.mutate()}>{t('common.save')}</button>
          </div>

          <div className="card card-pad">
            <div className="flex-row space-between mb-2">
              <div className="card-title">Two-factor authentication</div>
              {overview.twoFactor.enabled ? (
                <button className="btn btn-secondary btn-sm" onClick={() => setDisable2faOpen(true)}>Disable</button>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={() => setTwoFaOpen(true)}>Enable</button>
              )}
            </div>
            <p className="text-secondary text-sm">{overview.twoFactor.enabled ? `Enabled · ${overview.twoFactor.backupCodesRemaining} backup codes remaining` : 'Add an extra layer of security to your account.'}</p>
          </div>

          <div className="card card-pad">
            <div className="flex-row space-between mb-3"><div className="card-title">Active sessions</div><button className="btn btn-ghost btn-sm" onClick={() => revokeOthersMutation.mutate()}>Log out all other devices</button></div>
            <div className="flex-col gap-2">
              {sessions?.map((s) => {
                const Icon = deviceIcon(s.deviceType);
                return (
                  <div key={s.id} className="flex-row space-between text-sm" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span className="flex-row gap-2"><Icon size={15} />{s.browser} · {s.os} {s.isCurrent && <span className="badge badge-success">This device</span>}</span>
                    <span className="flex-row gap-3">
                      <span className="text-tertiary">{s.countryCode ?? '—'} · {formatDate(s.lastActiveAt.slice(0, 10), locale, 'short')}</span>
                      {!s.isCurrent && <button className="btn btn-icon btn-ghost btn-sm" onClick={() => setRevoking(s.id)}><Trash2 size={13} /></button>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card card-pad">
            <div className="card-title mb-3">Recent security activity</div>
            <div className="flex-col gap-2">
              {events?.map((e) => (
                <div key={e.id} className="flex-row space-between text-sm">
                  <span>{t(`enums.securityEventType.${e.type}`)}</span>
                  <span className="text-tertiary">{e.countryCode ?? e.ip ?? '—'} · {formatDate(e.createdAt.slice(0, 10), locale, 'short')}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card card-pad" style={{ borderColor: 'var(--danger-soft-border)' }}>
            <div className="card-title mb-2 text-danger">Danger zone</div>
            <p className="text-secondary text-sm mb-3">Permanently delete your account and all associated data.</p>
            <button className="btn btn-danger-ghost" onClick={() => setDeleteOpen(true)}>Delete account</button>
          </div>
        </div>
      )}

      <TwoFactorSetup open={twoFaOpen} onClose={() => setTwoFaOpen(false)} />
      <Disable2FAModal open={disable2faOpen} onClose={() => setDisable2faOpen(false)} />
      {user && <DeleteAccountModal open={deleteOpen} onClose={() => setDeleteOpen(false)} username={user.username} />}
      <ConfirmDialog open={!!revoking} onClose={() => setRevoking(null)} onConfirm={() => revoking && revokeMutation.mutate(revoking)} title="Log out device" description="This session will be signed out immediately." confirmLabel="Log out" danger />
    </>
  );
}
