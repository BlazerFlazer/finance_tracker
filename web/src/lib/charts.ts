/**
 * Chart color + shaping helpers shared by every page with a graph. The hex values mirror the categorical
 * tokens in styles/tokens.css (the dataviz skill's validated 8-hue order) — kept here too because Recharts
 * needs literal color strings, not CSS custom properties, inside SVG fill/stroke props.
 */
export const CATEGORICAL_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export const CATEGORICAL_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const OTHER_COLOR_LIGHT = '#94938c';
export const OTHER_COLOR_DARK = '#7a7972';

export function categoricalColors(theme: 'light' | 'dark'): string[] {
  return theme === 'dark' ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
}
export function otherColor(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? OTHER_COLOR_DARK : OTHER_COLOR_LIGHT;
}

export interface NamedAmount {
  name: string;
  amountMinor: number;
  [key: string]: unknown;
}

/**
 * Keeps a chart legible and CVD-safe under an all-pairs read (pie/donut, small multiples): at most
 * `max` distinct categorical colours, the rest summed into one "Other" slice — never a 9th generated hue.
 */
export function foldTopCategories<T extends NamedAmount>(items: T[], max = 7): { name: string; amountMinor: number; original?: T }[] {
  const sorted = [...items].sort((a, b) => b.amountMinor - a.amountMinor);
  if (sorted.length <= max) return sorted.map((item) => ({ name: item.name, amountMinor: item.amountMinor, original: item }));
  const head = sorted.slice(0, max).map((item) => ({ name: item.name, amountMinor: item.amountMinor, original: item }));
  const restTotal = sorted.slice(max).reduce((s, item) => s + item.amountMinor, 0);
  return [...head, { name: 'Other', amountMinor: restTotal }];
}
