import { useState } from 'react';
import { ArrowLeftRight, MinusCircle, PlusCircle } from 'lucide-react';
import { Dropdown } from '../ui/Dropdown';
import { TransactionFormModal } from '../transactions/TransactionFormModal';
import { TransferFormModal } from '../transactions/TransferFormModal';
import { useT } from '../../lib/i18n';

export function useQuickAddModals() {
  const [mode, setMode] = useState<'expense' | 'income' | 'transfer' | null>(null);
  return {
    open: (m: 'expense' | 'income' | 'transfer') => setMode(m),
    modals: (
      <>
        <TransactionFormModal open={mode === 'expense'} initialType="expense" onClose={() => setMode(null)} />
        <TransactionFormModal open={mode === 'income'} initialType="income" onClose={() => setMode(null)} />
        <TransferFormModal open={mode === 'transfer'} onClose={() => setMode(null)} />
      </>
    ),
  };
}

export function QuickAddMenuItems({ onPick }: { onPick: (m: 'expense' | 'income' | 'transfer') => void }) {
  const t = useT();
  return (
    <>
      <button className="dropdown-item" onClick={() => onPick('expense')}><MinusCircle size={15} /> {t('transactions.addExpense')}</button>
      <button className="dropdown-item" onClick={() => onPick('income')}><PlusCircle size={15} /> {t('transactions.addIncome')}</button>
      <button className="dropdown-item" onClick={() => onPick('transfer')}><ArrowLeftRight size={15} /> {t('common.transfer')}</button>
    </>
  );
}

export function QuickAddButton({ open }: { open: (m: 'expense' | 'income' | 'transfer') => void }) {
  const t = useT();
  return (
    <Dropdown
      align="end"
      trigger={({ onClick, ref, open: isOpen }) => (
        <button ref={ref as React.RefObject<HTMLButtonElement>} className="btn btn-primary btn-sm" onClick={onClick} aria-expanded={isOpen} aria-label={t('nav.quickAdd')}>
          <PlusCircle size={15} /> {t('nav.add')}
        </button>
      )}
    >
      <QuickAddMenuItems onPick={open} />
    </Dropdown>
  );
}
