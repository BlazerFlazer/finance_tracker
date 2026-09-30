import type { Lang } from '@shared/constants';
import { addMonths, monthRange, startOfYear } from '@shared/dates';
import { formatMoney, formatPercent } from '@shared/money';
import type { Db } from '../db/index';
import { askGrounded } from '../ai/client';
import { amountByCategory, amountByMerchant, incomeExpenseByMonth } from './analytics';
import { goalWithMetrics, listGoals } from './goals';
import type { InsightCtx } from './insights';

const LOCALE: Record<Lang, string> = { en: 'en-US', ru: 'ru-RU', uz: 'uz-Latn-UZ' };

export interface AssistantAnswer {
  answer: string;
  source: 'rules' | 'ai';
  facts?: unknown;
}

const SYSTEM_PROMPT = `You are FinTrack's financial assistant. You answer questions about ONE user's own finances using ONLY the JSON data block you are given — never invent, estimate or recall numbers from anywhere else. If the data doesn't contain what's needed to answer, say so plainly instead of guessing. Keep answers short (2-4 sentences), concrete, and in the same language as the question. Never give investment, tax or legal advice, never promise returns, and never claim a forecast is guaranteed — the app's forecasts are estimates. You cannot take any action (you cannot move money, create transactions, or change settings) — if asked to do something, explain that you can only report information.`;

/** Tries a handful of the spec's example question shapes with a real computed answer; returns null if nothing matched. */
async function tryRuleBasedAnswer(db: Db, ctx: InsightCtx, question: string): Promise<AssistantAnswer | null> {
  const q = question.toLowerCase();
  const locale = LOCALE[ctx.lang];
  const money = (m: number) => formatMoney(m, ctx.mainCurrency, { locale });
  const thisMonth = monthRange(ctx.today.slice(0, 7));
  const thisYear = { from: startOfYear(ctx.today), to: ctx.today };

  const wantsYear = /year|год|yil/.test(q);

  if (/spen(d|t).*most|biggest.*categor|куда.*(потратил|уш)|больше всего.*потрат|qayerga.*ko'p|eng ko'p.*sarf/.test(q)) {
    const cats = await amountByCategory(db, ctx.userId, wantsYear ? thisYear : thisMonth, ctx.mainCurrency, ctx.rates, 'expense');
    if (cats.length === 0) return { answer: ctx.lang === 'ru' ? 'За этот период расходов не найдено.' : ctx.lang === 'uz' ? 'Bu davrda xarajatlar topilmadi.' : 'No expenses found for this period.', source: 'rules' };
    const top = cats[0]!;
    const label = top.name ?? top.systemKey ?? '—';
    const text =
      ctx.lang === 'ru'
        ? `Больше всего вы потратили на «${label}» — ${money(top.amountMinor)} (${top.percent}% расходов за период).`
        : ctx.lang === 'uz'
          ? `Eng ko'p «${label}» uchun sarfladingiz — ${money(top.amountMinor)} (davr xarajatlarining ${top.percent}%).`
          : `You spent the most on ${label}: ${money(top.amountMinor)} (${top.percent}% of this period's expenses).`;
    return { answer: text, source: 'rules', facts: cats.slice(0, 5) };
  }

  if (/how much.*sav|save.*this year|сколько.*сэконом|сколько.*накопил|qancha.*jamg/.test(q)) {
    const flow = await incomeExpenseByMonth(db, ctx.userId, thisYear, ctx.mainCurrency, ctx.rates);
    const total = flow.reduce((s, f) => s + f.netMinor, 0);
    const income = flow.reduce((s, f) => s + f.incomeMinor, 0);
    const rate = income > 0 ? formatPercent(total / income, locale) : '—';
    const text =
      ctx.lang === 'ru'
        ? `В этом году вы сохранили ${money(total)} (норма накоплений ${rate}).`
        : ctx.lang === 'uz'
          ? `Bu yil siz ${money(total)} jamg'ardingiz (jamg'arma darajasi ${rate}).`
          : `You've saved ${money(total)} this year (a ${rate} savings rate).`;
    return { answer: text, source: 'rules', facts: { total, income } };
  }

  if (/recurring|subscript|регуляр|подписк|doimiy|obuna/.test(q)) {
    const subs = await db.query<{ name: string; monthlyCostMinor: number }>(
      `SELECT name, price_minor AS "monthlyCostMinor" FROM subscriptions WHERE user_id = $1 AND status = 'active' ORDER BY price_minor DESC LIMIT 5`,
      [ctx.userId],
    );
    if (subs.length === 0) return { answer: ctx.lang === 'ru' ? 'Активных подписок не найдено.' : ctx.lang === 'uz' ? 'Faol obunalar topilmadi.' : 'No active subscriptions found.', source: 'rules' };
    const list = subs.map((s) => `${s.name} (${money(s.monthlyCostMinor)})`).join(', ');
    const text = ctx.lang === 'ru' ? `Ваши крупнейшие регулярные расходы: ${list}.` : ctx.lang === 'uz' ? `Eng katta doimiy xarajatlaringiz: ${list}.` : `Your biggest recurring expenses are: ${list}.`;
    return { answer: text, source: 'rules', facts: subs };
  }

  const goalMatch = /goal|цел|maqsad/.test(q);
  if (goalMatch && /how much|monthly|сколько|oyiga|qancha/.test(q)) {
    const goals = await listGoals(db, ctx.userId);
    if (goals.length === 0) return { answer: ctx.lang === 'ru' ? 'У вас пока нет финансовых целей.' : ctx.lang === 'uz' ? "Sizda hozircha moliyaviy maqsad yo'q." : "You don't have any financial goals yet.", source: 'rules' };
    const target = goals.find((g) => g.status === 'active') ?? goals[0]!;
    const { metrics } = await goalWithMetrics(db, ctx.userId, target, ctx.today);
    if (!metrics.requiredMonthlyMinor) {
      return { answer: ctx.lang === 'ru' ? `Для цели «${target.name}» не задан срок, поэтому необходимую сумму в месяц рассчитать нельзя.` : ctx.lang === 'uz' ? `«${target.name}» maqsadi uchun muddat belgilanmagan.` : `"${target.name}" has no deadline set, so a required monthly amount can't be calculated.`, source: 'rules' };
    }
    const text =
      ctx.lang === 'ru'
        ? `Чтобы достичь цели «${target.name}» к сроку, нужно откладывать примерно ${money(metrics.requiredMonthlyMinor)} в месяц.`
        : ctx.lang === 'uz'
          ? `«${target.name}» maqsadiga muddatida yetish uchun oyiga taxminan ${money(metrics.requiredMonthlyMinor)} jamg'arish kerak.`
          : `To reach "${target.name}" by its deadline, you'd need to save about ${money(metrics.requiredMonthlyMinor)} per month.`;
    return { answer: text, source: 'rules', facts: metrics };
  }

  if (/last month|change.*compar|прошл.*месяц|измени|o'tgan oy/.test(q)) {
    const flow = (await incomeExpenseByMonth(db, ctx.userId, thisMonth, ctx.mainCurrency, ctx.rates)).slice(-1)[0];
    const prev = (await incomeExpenseByMonth(db, ctx.userId, { from: addMonths(thisMonth.from, -1), to: addMonths(thisMonth.to, -1) }, ctx.mainCurrency, ctx.rates)).slice(-1)[0];
    if (!flow || !prev) return null;
    const diff = flow.netMinor - prev.netMinor;
    const text =
      ctx.lang === 'ru'
        ? `По сравнению с прошлым месяцем ваши накопления ${diff >= 0 ? 'выросли' : 'снизились'} на ${money(Math.abs(diff))} (доход ${money(flow.incomeMinor)}, расходы ${money(flow.expenseMinor)}).`
        : ctx.lang === 'uz'
          ? `O'tgan oyga nisbatan jamg'armangiz ${diff >= 0 ? 'oshdi' : 'kamaydi'} — ${money(Math.abs(diff))} ga (daromad ${money(flow.incomeMinor)}, xarajat ${money(flow.expenseMinor)}).`
          : `Compared with last month, your savings ${diff >= 0 ? 'increased' : 'decreased'} by ${money(Math.abs(diff))} (income ${money(flow.incomeMinor)}, expenses ${money(flow.expenseMinor)}).`;
    return { answer: text, source: 'rules', facts: { flow, prev } };
  }

  const merchants = /netflix|spotify|[A-Za-z][\w.-]{2,}/i.exec(question)?.[0];
  if (merchants && /how much|spent|сколько|qancha/.test(q)) {
    const top = await amountByMerchant(db, ctx.userId, thisYear, ctx.mainCurrency, ctx.rates, 50);
    const hit = top.find((m) => m.merchant.toLowerCase().includes(merchants.toLowerCase()));
    if (hit) {
      const text = ctx.lang === 'ru' ? `В этом году вы потратили ${money(hit.amountMinor)} в «${hit.merchant}» (${hit.count} операций).` : ctx.lang === 'uz' ? `Bu yil siz «${hit.merchant}»da ${money(hit.amountMinor)} sarfladingiz (${hit.count} ta operatsiya).` : `You've spent ${money(hit.amountMinor)} at ${hit.merchant} this year (${hit.count} transactions).`;
      return { answer: text, source: 'rules', facts: hit };
    }
  }

  return null;
}

/** Snapshot of the user's finances handed to the LLM as grounding when no rule matches (see askGrounded). */
async function buildGroundingContext(db: Db, ctx: InsightCtx) {
  const thisMonth = monthRange(ctx.today.slice(0, 7));
  const [flow, categories, goals, netWorth] = await Promise.all([
    incomeExpenseByMonth(db, ctx.userId, thisMonth, ctx.mainCurrency, ctx.rates),
    amountByCategory(db, ctx.userId, thisMonth, ctx.mainCurrency, ctx.rates, 'expense'),
    listGoals(db, ctx.userId),
    db.one(`SELECT COUNT(*)::int AS accounts FROM accounts WHERE user_id = $1 AND NOT is_archived`, [ctx.userId]),
  ]);
  return { currency: ctx.mainCurrency, today: ctx.today, thisMonth: flow[flow.length - 1], spendingByCategory: categories.slice(0, 10), goals, accounts: netWorth };
}

export async function answerQuestion(db: Db, ctx: InsightCtx, question: string): Promise<AssistantAnswer> {
  const ruleAnswer = await tryRuleBasedAnswer(db, ctx, question);
  if (ruleAnswer) return ruleAnswer;
  const context = await buildGroundingContext(db, ctx);
  const aiAnswer = await askGrounded({ system: SYSTEM_PROMPT, question, context, maxTokens: 500 });
  if (aiAnswer) return { answer: aiAnswer, source: 'ai', facts: context };
  const fallback =
    ctx.lang === 'ru'
      ? "Я могу ответить только на основе ваших данных в FinTrack и сейчас не смог найти точный ответ на этот вопрос. Попробуйте спросить конкретнее — например, «где я больше всего трачу в этом месяце?»."
      : ctx.lang === 'uz'
        ? "Men faqat FinTrackdagi ma'lumotlaringiz asosida javob bera olaman va hozir bu savolga aniq javob topa olmadim. Aniqroq so'rab ko'ring — masalan, «bu oyda eng ko'p qayerga sarflayapman?»."
        : "I can only answer using your FinTrack data, and couldn't find a precise answer to that. Try asking something more specific, like \"where am I spending the most this month?\"";
  return { answer: fallback, source: 'rules' };
}
