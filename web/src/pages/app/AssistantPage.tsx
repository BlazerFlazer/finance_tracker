import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Bot, Send, Sparkles, User } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { useT } from '../../lib/i18n';
import { api } from '../../lib/api';
import { errorToMessageKey } from '../../lib/errors';

interface Message { role: 'user' | 'assistant'; text: string }

const SUGGESTIONS = ['Where did I spend the most this month?', 'How much did I save this year?', 'What are my biggest recurring expenses?', 'What changed compared with last month?'];

export default function AssistantPage() {
  const t = useT();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const mutation = useMutation({
    mutationFn: (question: string) => api.post<{ answer: string }>('/api/assistant/ask', { question }),
    onSuccess: (res) => {
      setMessages((m) => [...m, { role: 'assistant', text: res.answer }]);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }));
    },
    onError: (e) => {
      const { key, params } = errorToMessageKey(e);
      setMessages((m) => [...m, { role: 'assistant', text: t(key, params) }]);
    },
  });

  const ask = (question: string) => {
    if (!question.trim()) return;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    mutation.mutate(question);
  };

  return (
    <>
      <PageHeader title={t('nav.assistant')} subtitle="Answers are grounded only in your own FinTrack data." />
      <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 220px)', minHeight: 420 }}>
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {messages.length === 0 && (
            <div className="flex-col gap-3">
              <div className="empty-state" style={{ padding: '32px 0' }}>
                <div className="empty-state-icon"><Sparkles size={22} /></div>
                <div className="empty-state-title">Ask about your finances</div>
                <div className="empty-state-desc">{t('common.disclaimer')}</div>
              </div>
              <div className="flex-row wrap gap-2" style={{ justifyContent: 'center' }}>
                {SUGGESTIONS.map((s) => <button key={s} className="badge badge-brand" style={{ height: 'auto', padding: '8px 12px' }} onClick={() => ask(s)}>{s}</button>)}
              </div>
            </div>
          )}
          <div className="flex-col gap-4">
            {messages.map((m, i) => (
              <div key={i} className="flex-row gap-3" style={{ alignItems: 'flex-start' }}>
                <div className="icon-chip" style={{ background: m.role === 'user' ? 'var(--bg-sunken)' : 'var(--accent-soft)', color: m.role === 'user' ? 'var(--text-secondary)' : 'var(--accent)' }}>
                  {m.role === 'user' ? <User size={15} /> : <Bot size={15} />}
                </div>
                <div className="card card-pad" style={{ flex: 1, background: m.role === 'user' ? 'var(--bg-sunken)' : 'var(--bg-elevated)' }}>
                  <p style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{m.text}</p>
                </div>
              </div>
            ))}
            {mutation.isPending && <div className="text-tertiary text-sm">…</div>}
          </div>
        </div>
        <form
          className="flex-row gap-2"
          style={{ padding: 16, borderTop: '1px solid var(--border)' }}
          onSubmit={(e) => { e.preventDefault(); ask(input); }}
        >
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('nav.assistant')} disabled={mutation.isPending} />
          <button type="submit" className="btn btn-primary btn-icon" disabled={mutation.isPending || !input.trim()} aria-label="Send"><Send size={15} /></button>
        </form>
      </div>
    </>
  );
}
