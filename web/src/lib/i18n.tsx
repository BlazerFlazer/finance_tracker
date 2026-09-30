import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { LANGUAGES, LOCALE_TAGS, type Lang } from '@shared/constants';
import { translate, type MessageKey, type MessageParams } from '@shared/i18n/index';

const STORAGE_KEY = 'fintrack-lang';

function detectInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LANGUAGES as readonly string[]).includes(saved)) return saved as Lang;
  } catch {
    /* ignore */
  }
  const nav = navigator.language.slice(0, 2).toLowerCase();
  if (nav === 'ru') return 'ru';
  if (nav === 'uz') return 'uz';
  return 'en';
}

interface I18nCtx {
  lang: Lang;
  locale: string;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey | string, params?: MessageParams) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = next;
  }, []);

  const t = useCallback((key: MessageKey | string, params?: MessageParams) => translate(lang, key, params), [lang]);
  const value = useMemo<I18nCtx>(() => ({ lang, locale: LOCALE_TAGS[lang], setLang, t }), [lang, setLang, t]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

/** Convenience hook when only the translator function is needed. */
export function useT() {
  return useI18n().t;
}
