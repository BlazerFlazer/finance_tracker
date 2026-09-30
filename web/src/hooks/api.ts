import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export interface AccountDto {
  id: string;
  name: string;
  type: string;
  currency: string;
  institution: string | null;
  openingBalanceMinor: number;
  creditLimitMinor: number | null;
  lowBalanceThresholdMinor: number | null;
  color: string;
  icon: string | null;
  includeInNetWorth: boolean;
  isArchived: boolean;
  sortOrder: number;
  notes: string | null;
  createdAt: string;
  balanceMinor: number;
}

export interface CategoryDto {
  id: string;
  parentId: string | null;
  kind: 'expense' | 'income';
  systemKey: string | null;
  name: string | null;
  icon: string;
  color: string;
  sortOrder: number;
  isArchived: boolean;
  transactionCount: number;
}

export interface TagDto {
  id: string;
  name: string;
}

export interface CurrencyDto {
  code: string;
  name: string;
  symbol: string;
  minorUnits: number;
  displayDecimals: number;
}

export interface PublicConfigDto {
  registrationOpen: boolean;
  maintenanceMode: boolean;
  demoEnabled: boolean;
  announcement: string | null;
  aiEnabled: boolean;
  pushEnabled: boolean;
  vapidPublicKey: string | null;
  env: string;
}

export function useAccounts(includeArchived = false) {
  return useQuery({
    queryKey: ['accounts', includeArchived],
    queryFn: () => api.get<{ accounts: AccountDto[] }>('/api/accounts', { includeArchived }).then((r) => r.accounts),
  });
}

export function useCategories(kind?: 'expense' | 'income', includeArchived = false) {
  return useQuery({
    queryKey: ['categories', kind, includeArchived],
    queryFn: () => api.get<{ categories: CategoryDto[] }>('/api/categories', { kind, includeArchived }).then((r) => r.categories),
  });
}

export function useTags() {
  return useQuery({ queryKey: ['tags'], queryFn: () => api.get<{ tags: TagDto[] }>('/api/tags').then((r) => r.tags) });
}

export function useMeta() {
  return useQuery({ queryKey: ['meta', 'config'], queryFn: () => api.get<PublicConfigDto>('/api/meta/config'), staleTime: 5 * 60_000 });
}

export function useCurrencies() {
  return useQuery({ queryKey: ['meta', 'currencies'], queryFn: () => api.get<CurrencyDto[]>('/api/meta/currencies'), staleTime: 5 * 60_000 });
}

/** Category label: a default category's display name is localised via i18n (`categoryNames.<systemKey>`); a custom one just uses its stored name. */
export function categoryLabel(cat: Pick<CategoryDto, 'name' | 'systemKey'>, t: (key: string) => string): string {
  if (cat.name) return cat.name;
  if (cat.systemKey) return t(`categoryNames.${cat.systemKey}`);
  return '—';
}
