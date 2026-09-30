import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../constants';
import { MESSAGES } from './index';

function leafPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) out.push(...leafPaths(v, prefix ? `${prefix}.${k}` : k));
  return out;
}

describe('i18n key parity', () => {
  const reference = new Set(leafPaths(MESSAGES.en));

  it('has at least one language and a non-trivial catalogue', () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(3);
    expect(reference.size).toBeGreaterThan(100);
  });

  for (const lang of LANGUAGES) {
    it(`${lang}: every English key exists (missing keys fall back silently, but must not be needed)`, () => {
      const own = new Set(leafPaths(MESSAGES[lang]));
      const missing = [...reference].filter((k) => !own.has(k));
      expect(missing).toEqual([]);
    });
  }

  it('every {placeholder} used in English also appears in the other locales for the same key', () => {
    const placeholdersOf = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const collect = (obj: unknown, prefix = ''): Record<string, string> => {
      let out: Record<string, string> = {};
      if (typeof obj === 'string') return { [prefix]: obj };
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) out = { ...out, ...collect(v, prefix ? `${prefix}.${k}` : k) };
      return out;
    };
    const en = collect(MESSAGES.en);
    for (const lang of LANGUAGES) {
      if (lang === 'en') continue;
      const other = collect(MESSAGES[lang]);
      for (const [key, enText] of Object.entries(en)) {
        const otherText = other[key];
        if (!otherText) continue;
        expect(placeholdersOf(otherText), `${lang}:${key}`).toEqual(placeholdersOf(enText));
      }
    }
  });
});
