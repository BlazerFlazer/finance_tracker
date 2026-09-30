import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryObserverResult } from '@tanstack/react-query';
import type { Lang, Theme } from '@shared/constants';
import { api, ApiError } from './api';
import { useI18n } from './i18n';
import { useTheme } from './theme';

/** Mirrors the JSON shape returned by GET /api/auth/me (server/src/auth/dto.ts MeDto) — kept in sync by hand since web and server don't share a runtime type package. */
export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
  status: string;
  emailVerifiedAt: string | null;
  isDemo: boolean;
  demoExpiresAt: string | null;
  createdAt: string;
  displayName: string | null;
  mainCurrency: string;
  language: Lang;
  timezone: string;
  theme: Theme;
  weekStart: 0 | 1;
  onboardingCompletedAt: string | null;
  twoFactorEnabled: boolean;
}

export const ME_QUERY_KEY = ['auth', 'me'] as const;

interface AuthCtx {
  user: AuthUser | null;
  isLoading: boolean;
  /** Re-fetches GET /api/auth/me — call after login/logout/registration and await it before navigating, since callers often read `.data` off the result. */
  refetch: () => Promise<QueryObserverResult<AuthUser | null, Error>>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLang } = useI18n();
  const { setTheme } = useTheme();
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      try {
        const res = await api.get<{ user: AuthUser }>('/api/auth/me');
        return res.user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  const user = data ?? null;

  // The server is authoritative for language/theme once signed in — apply them once on login/refresh,
  // without fighting a change the person makes in Settings during the same session.
  useEffect(() => {
    if (user) {
      setLang(user.language);
      setTheme(user.theme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Clear cached data on an actual logout transition (a real user -> null), never on the initial
  // unauthenticated load — and never touch the auth query itself, or it would wipe its own in-flight
  // result and loop forever re-fetching.
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const currentId = user?.id ?? null;
    if (previousUserId.current && !currentId) {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'meta' && q.queryKey[0] !== 'auth' });
    }
    previousUserId.current = currentId;
  }, [user, qc]);

  return <Ctx.Provider value={{ user, isLoading, refetch }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
