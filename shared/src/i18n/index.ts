import en from './locales/en/core.json';
import ru from './locales/ru/core.json';
import uz from './locales/uz/core.json';
import type { Lang } from '../constants';

export const MESSAGES: Record<Lang, typeof en> = { en, ru, uz };

/** Dot path to every leaf string in the `en` catalogue (the reference locale), e.g. "common.save" | "errors.NOT_FOUND". */
type PathsOf<T, Prefix extends string = ''> = T extends string
  ? Prefix
  : { [K in keyof T & string]: PathsOf<T[K], `${Prefix}${Prefix extends '' ? '' : '.'}${K}`> }[keyof T & string];

export type MessageKey = PathsOf<typeof en>;

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const PLURAL_RULES = new Map<Lang, Intl.PluralRules>();
function pluralRule(lang: Lang): Intl.PluralRules {
  let r = PLURAL_RULES.get(lang);
  if (!r) {
    r = new Intl.PluralRules(lang === 'uz' ? 'uz' : lang);
    PLURAL_RULES.set(lang, r);
  }
  return r;
}

export type MessageParams = Record<string, string | number>;

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in params ? String(params[key]) : m));
}

/**
 * Translate `key` for `lang`. Falls back to English, then to the key itself, so a missing string never
 * crashes the UI — it degrades to readable English or a visible placeholder in dev.
 * When `params.count` is present and the resolved value is a plural object ({one, few, other, ...}),
 * the correct CLDR plural form for `lang` is selected first.
 */
export function translate(lang: Lang, key: MessageKey | string, params?: MessageParams): string {
  let value = getPath(MESSAGES[lang], key);
  if (value === undefined) value = getPath(MESSAGES.en, key);
  if (value !== undefined && typeof value === 'object' && params && typeof params.count === 'number') {
    const forms = value as Record<string, string>;
    const category = pluralRule(lang).select(params.count);
    value = forms[category] ?? forms.other ?? Object.values(forms)[0];
  }
  if (typeof value !== 'string') return key;
  return interpolate(value, params);
}

export function hasMessage(lang: Lang, key: string): boolean {
  return getPath(MESSAGES[lang], key) !== undefined;
}
