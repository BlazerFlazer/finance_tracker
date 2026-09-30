import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { GitBranch, Info } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingBlock } from '../../components/ui/States';
import { Money } from '../../components/ui/Money';
import { Field } from '../../components/ui/Field';
import { AmountInput } from '../../components/ui/AmountInput';
import { useT } from '../../lib/i18n';
import { api } from '../../lib/api';

interface Baseline { currency: string; incomeMinor: number; expensesMinor: number; goals: { id: string; name: string; targetMinor: number; currentMinor: number; deadline: string | null }[] }
interface Projection { monthlySavingsMinor: number; yearlySavingsMinor: number; savingsRate: number; monthsToGoal: number | null }
interface CompareResult { currency: string; current: Projection; scenario: Projection; comparison: { monthlyDiffMinor: number; yearlyDiffMinor: number; goalMonthsSooner: number | null } }

export default function SimulatorPage() {
  const t = useT();
  const { data: baseline, isLoading } = useQuery({ queryKey: ['simulator', 'baseline'], queryFn: () => api.get<Baseline>('/api/simulator/baseline') });
  const [income, setIncome] = useState<number | null>(null);
  const [expenses, setExpenses] = useState<number | null>(null);
  const [goalId, setGoalId] = useState('');

  useEffect(() => {
    if (baseline) {
      setIncome(baseline.incomeMinor);
      setExpenses(baseline.expensesMinor);
    }
  }, [baseline]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<CompareResult>('/api/simulator/compare', {
        baseline: { incomeMinor: baseline?.incomeMinor ?? 0, expensesMinor: baseline?.expensesMinor ?? 0 },
        scenario: { incomeMinor: income ?? 0, expensesMinor: expenses ?? 0 },
        goalId: goalId || undefined,
      }),
  });

  useEffect(() => {
    if (baseline && income !== null && expenses !== null) mutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [income, expenses, goalId, baseline?.incomeMinor]);

  const currency = baseline?.currency ?? 'USD';
  const result = mutation.data;

  return (
    <>
      <PageHeader title={t('nav.simulator')} />
      <div className="disclaimer-box mb-4"><Info size={15} /> {t('common.disclaimer')}</div>
      {isLoading || !baseline ? <LoadingBlock height={300} /> : (
        <div className="grid grid-cols-2">
          <div className="card card-pad">
            <div className="card-title mb-4">Scenario</div>
            <div className="flex-col gap-4">
              <Field label={t('common.income')}><AmountInput minor={income} currency={currency} onChange={setIncome} /></Field>
              <Field label={t('common.expenses')}><AmountInput minor={expenses} currency={currency} onChange={setExpenses} /></Field>
              {!!baseline.goals.length && (
                <Field label={t('nav.goals')} optional>
                  <select className="select" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                    <option value="">—</option>
                    {baseline.goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </Field>
              )}
              <p className="text-tertiary text-sm">Baseline (your recent average): <Money minor={baseline.incomeMinor} currency={currency} neutral /> income, <Money minor={baseline.expensesMinor} currency={currency} neutral /> expenses per month.</p>
            </div>
          </div>

          <div className="card card-pad">
            <div className="card-title mb-4"><GitBranch size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Result</div>
            {result && (
              <div className="flex-col gap-4">
                <div className="grid grid-cols-2">
                  <div>
                    <div className="stat-card-label">Monthly, current</div>
                    <div className="stat-card-value" style={{ fontSize: 18 }}><Money minor={result.current.monthlySavingsMinor} currency={currency} /></div>
                  </div>
                  <div>
                    <div className="stat-card-label">Monthly, scenario</div>
                    <div className="stat-card-value" style={{ fontSize: 18 }}><Money minor={result.scenario.monthlySavingsMinor} currency={currency} /></div>
                  </div>
                </div>
                <div className="divider" />
                <div className="flex-row space-between"><span className="text-secondary text-sm">Monthly difference</span><Money minor={result.comparison.monthlyDiffMinor} currency={currency} sign="always" /></div>
                <div className="flex-row space-between"><span className="text-secondary text-sm">Yearly difference</span><Money minor={result.comparison.yearlyDiffMinor} currency={currency} sign="always" /></div>
                {result.comparison.goalMonthsSooner !== null && (
                  <div className="flex-row space-between"><span className="text-secondary text-sm">Goal reached</span><span className="font-semibold">{result.comparison.goalMonthsSooner > 0 ? `${result.comparison.goalMonthsSooner} months sooner` : result.comparison.goalMonthsSooner < 0 ? `${-result.comparison.goalMonthsSooner} months later` : 'Same time'}</span></div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
