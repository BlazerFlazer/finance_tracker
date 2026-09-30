import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingBlock } from '../../components/ui/States';
import { useT, useI18n } from '../../lib/i18n';
import { api } from '../../lib/api';
import { addMonths, addDays, daysInMonth, dayOfWeek, monthKeyToStart, startOfMonth, weekdayLabels, monthLabel, formatDate } from '@shared/dates';
import { useAuth } from '../../lib/auth';

interface CalendarEvent { date: string; label: string; amountMinor: number; currency?: string; kind: string }
interface CalendarResponse { recurring: CalendarEvent[]; debts: CalendarEvent[]; goalContributions: CalendarEvent[]; today: string }

export default function CalendarPage() {
  const t = useT();
  const { locale } = useI18n();
  const { user } = useAuth();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const from = monthKeyToStart(month);
  const to = addDays(addMonths(from, 1), -1);
  const { data, isLoading } = useQuery({ queryKey: ['calendar', month], queryFn: () => api.get<CalendarResponse>('/api/calendar', { from, to }) });

  const events = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of [...(data?.recurring ?? []), ...(data?.debts ?? []), ...(data?.goalContributions ?? [])]) {
      map.set(e.date, [...(map.get(e.date) ?? []), e]);
    }
    return map;
  }, [data]);

  const weekStart = user?.weekStart ?? 1;
  const firstDay = startOfMonth(from);
  const leadingBlanks = (dayOfWeek(firstDay) - weekStart + 7) % 7;
  const days = daysInMonth(+from.slice(0, 4), +from.slice(5, 7));
  const cells: (string | null)[] = [...Array(leadingBlanks).fill(null), ...Array.from({ length: days }, (_, i) => addDays(firstDay, i))];

  return (
    <>
      <PageHeader
        title={t('nav.calendar')}
        actions={
          <div className="flex-row gap-2">
            <button className="btn btn-icon btn-secondary btn-sm" onClick={() => setMonth((m) => addMonths(`${m}-01`, -1).slice(0, 7))}><ChevronLeft size={15} /></button>
            <span className="font-semibold" style={{ minWidth: 130, textAlign: 'center' }}>{monthLabel(month, locale, 'long')}</span>
            <button className="btn btn-icon btn-secondary btn-sm" onClick={() => setMonth((m) => addMonths(`${m}-01`, 1).slice(0, 7))}><ChevronRight size={15} /></button>
          </div>
        }
      />
      {isLoading ? <LoadingBlock height={480} /> : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
            {weekdayLabels(locale, weekStart as 0 | 1).map((d) => (
              <div key={d} style={{ padding: '10px 8px', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textAlign: 'center', textTransform: 'uppercase' }}>{d}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {cells.map((date, i) => (
              <div
                key={i}
                role={date ? 'gridcell' : undefined}
                aria-label={date ? `${formatDate(date, locale, 'long')}${date === data?.today ? ` (${t('common.today')})` : ''}` : undefined}
                style={{ minHeight: 96, padding: 6, borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: date === data?.today ? 'var(--accent-soft)' : undefined }}
              >
                {date && (
                  <>
                    <div className="text-sm" style={{ fontWeight: date === data?.today ? 700 : 500, color: date === data?.today ? 'var(--accent)' : 'var(--text-secondary)' }}>{+date.slice(8, 10)}</div>
                    <div className="flex-col gap-1 mt-1">
                      {(events.get(date) ?? []).slice(0, 3).map((e, j) => (
                        <div key={j} className="badge badge-neutral" style={{ width: '100%', justifyContent: 'flex-start', fontSize: 10.5 }} title={e.label}>
                          <span className="truncate">{e.label}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
