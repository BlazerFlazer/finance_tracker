import { createRequire } from 'node:module';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { Lang } from '@shared/constants';
import { formatDate } from '@shared/dates';
import { formatMoney, formatPercent } from '@shared/money';
import type { MonthlyReview } from '../domain/review';
import { reportText } from './pdfText';

const require = createRequire(import.meta.url);
const FONT_DIR = path.dirname(require.resolve('dejavu-fonts-ttf/package.json'));
const REGULAR = path.join(FONT_DIR, 'ttf', 'DejaVuSans.ttf');
const BOLD = path.join(FONT_DIR, 'ttf', 'DejaVuSans-Bold.ttf');

const LOCALE: Record<Lang, string> = { en: 'en-US', ru: 'ru-RU', uz: 'uz-Latn-UZ' };

/**
 * A default category (no custom name) only carries its `system_key` (e.g. "rent"). The PDF has no access
 * to the frontend's per-language `categoryNames.*` catalogue, so it falls back to a capitalized slug
 * rather than the raw key — readable in English at least; see docs/QA.md for this known i18n gap.
 */
function categoryDisplayName(cat: { name: string | null; systemKey: string | null }): string {
  if (cat.name) return cat.name;
  if (cat.systemKey) return cat.systemKey.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return '—';
}
const INK = '#111827';
const MUTED = '#6b7280';
const BRAND = '#4f46e5';
const LINE = '#e5e7eb';

/** Renders the monthly review as a print-ready PDF (section 38). Cyrillic/Uzbek text needs DejaVu Sans — PDFKit's built-in fonts only cover Latin-1. */
export function renderMonthlyReportPdf(review: MonthlyReview, lang: Lang): Promise<Buffer> {
  const t = reportText(lang);
  const locale = LOCALE[lang];
  const money = (m: number) => formatMoney(m, review.currency, { locale });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('body', REGULAR).registerFont('bold', BOLD);
    doc.font('bold').fontSize(20).fillColor(BRAND).text('FinTrack', { continued: false });
    doc.font('body').fontSize(10).fillColor(MUTED).text(t.tagline, { align: 'left' });
    doc.moveDown(0.6);
    doc.font('bold').fontSize(16).fillColor(INK).text(`${t.title} — ${formatDate(`${review.period}-01`, locale, 'monthYear')}`);
    doc.font('body').fontSize(9).fillColor(MUTED).text(`${t.generatedOn}: ${formatDate(new Date().toISOString().slice(0, 10), locale, 'medium')}`);
    doc.moveDown(1);
    line(doc);

    // summary cards (3x1 row)
    doc.moveDown(0.8);
    const cardY = doc.y;
    const cardW = (doc.page.width - 100 - 24) / 3;
    summaryCard(doc, 50, cardY, cardW, t.income, money(review.incomeMinor), '#16a34a');
    summaryCard(doc, 50 + cardW + 12, cardY, cardW, t.expenses, money(review.expensesMinor), '#dc2626');
    summaryCard(doc, 50 + (cardW + 12) * 2, cardY, cardW, t.savings, money(review.savingsMinor), review.savingsMinor >= 0 ? '#16a34a' : '#dc2626');
    doc.y = cardY + 62;

    doc.moveDown(0.6);
    row(doc, t.savingsRate, formatPercent(review.savingsRate / 100, locale));
    if (review.previousMonth) {
      const diff = review.savingsMinor - review.previousMonth.savingsMinor;
      row(doc, `${t.savings} ${t.vsPreviousMonth}`, `${diff >= 0 ? '+' : ''}${money(diff)}`);
    }
    if (review.netWorthChangeMinor !== null) row(doc, t.netWorthChange, `${review.netWorthChangeMinor >= 0 ? '+' : ''}${money(review.netWorthChangeMinor)}`);
    if (review.biggestCategory) row(doc, t.biggestCategory, `${categoryDisplayName(review.biggestCategory)} · ${money(review.biggestCategory.amountMinor)}`);
    if (review.largestExpense) row(doc, t.largestExpense, `${review.largestExpense.merchant ?? '—'} · ${money(review.largestExpense.amountMinor)} · ${formatDate(review.largestExpense.occurredOn, locale, 'short')}`);

    doc.moveDown(1);
    section(doc, t.budgetPerformance);
    if (review.budgetPerformance.length === 0) noData(doc, t.noData);
    for (const b of review.budgetPerformance) row(doc, b.name, `${b.percentUsed}% ${t.used} — ${t.status[b.alertLevel as keyof typeof t.status] ?? b.alertLevel}`);

    doc.moveDown(1);
    section(doc, t.goalsProgress);
    if (review.goalsProgress.length === 0) noData(doc, t.noData);
    for (const g of review.goalsProgress) row(doc, g.name, `${g.progress}% — ${t.goalStatus[g.status as keyof typeof t.goalStatus] ?? g.status}`);

    // footer disclaimer on every page
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font('body').fontSize(8).fillColor(MUTED).text(t.disclaimer, 50, doc.page.height - 60, { width: doc.page.width - 100, align: 'center' });
    }
    doc.end();
  });
}

function line(doc: PDFKit.PDFDocument) {
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(LINE).stroke();
}
function section(doc: PDFKit.PDFDocument, title: string) {
  doc.font('bold').fontSize(13).fillColor(INK).text(title);
  doc.moveDown(0.3);
}
function row(doc: PDFKit.PDFDocument, label: string, value: string) {
  const y = doc.y;
  doc.font('body').fontSize(10).fillColor(MUTED).text(label, 50, y, { width: 260, continued: false });
  doc.font('bold').fontSize(10).fillColor(INK).text(value, 320, y, { width: doc.page.width - 370, align: 'right' });
  doc.moveDown(0.5);
}
function noData(doc: PDFKit.PDFDocument, text: string) {
  doc.font('body').fontSize(10).fillColor(MUTED).text(text);
  doc.moveDown(0.5);
}
function summaryCard(doc: PDFKit.PDFDocument, x: number, y: number, w: number, label: string, value: string, color: string) {
  doc.roundedRect(x, y, w, 54, 6).fillColor('#f9fafb').fill();
  doc.font('body').fontSize(9).fillColor(MUTED).text(label, x + 10, y + 10, { width: w - 20 });
  doc.font('bold').fontSize(14).fillColor(color).text(value, x + 10, y + 26, { width: w - 20 });
}
