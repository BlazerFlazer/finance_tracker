import type { Lang } from '@shared/constants';

export interface ReportDict {
  title: string;
  tagline: string;
  generatedOn: string;
  income: string;
  expenses: string;
  savings: string;
  savingsRate: string;
  biggestCategory: string;
  largestExpense: string;
  budgetPerformance: string;
  goalsProgress: string;
  netWorthChange: string;
  vsPreviousMonth: string;
  noData: string;
  disclaimer: string;
  used: string;
  status: { none: string; notice: string; warning: string; exceeded: string };
  goalStatus: { active: string; completed: string; archived: string };
}

const en: ReportDict = {
  title: 'Monthly Financial Report',
  tagline: 'Know your money. Control your future.',
  generatedOn: 'Generated on',
  income: 'Income',
  expenses: 'Expenses',
  savings: 'Savings',
  savingsRate: 'Savings rate',
  biggestCategory: 'Biggest category',
  largestExpense: 'Largest expense',
  budgetPerformance: 'Budget performance',
  goalsProgress: 'Goals progress',
  netWorthChange: 'Net worth change',
  vsPreviousMonth: 'vs. previous month',
  noData: 'No data for this period.',
  disclaimer: 'This report is generated from data you entered in FinTrack. It is provided for personal budgeting purposes only and is not financial, investment, tax or legal advice.',
  used: 'used',
  status: { none: 'On track', notice: 'Notice', warning: 'Warning', exceeded: 'Exceeded' },
  goalStatus: { active: 'In progress', completed: 'Completed', archived: 'Archived' },
};
const ru: ReportDict = {
  title: 'Ежемесячный финансовый отчёт',
  tagline: 'Знай свои деньги. Управляй своим будущим.',
  generatedOn: 'Дата создания',
  income: 'Доход',
  expenses: 'Расходы',
  savings: 'Накопления',
  savingsRate: 'Норма накоплений',
  biggestCategory: 'Крупнейшая категория',
  largestExpense: 'Самая крупная трата',
  budgetPerformance: 'Исполнение бюджетов',
  goalsProgress: 'Прогресс по целям',
  netWorthChange: 'Изменение чистой стоимости',
  vsPreviousMonth: 'по сравнению с прошлым месяцем',
  noData: 'За этот период нет данных.',
  disclaimer: 'Этот отчёт сформирован на основе данных, внесённых вами в FinTrack. Он предназначен только для личного бюджетирования и не является финансовой, инвестиционной, налоговой или юридической консультацией.',
  used: 'использовано',
  status: { none: 'В норме', notice: 'Предупреждение', warning: 'Внимание', exceeded: 'Превышен' },
  goalStatus: { active: 'В процессе', completed: 'Достигнута', archived: 'В архиве' },
};
const uz: ReportDict = {
  title: 'Oylik moliyaviy hisobot',
  tagline: 'Pulingizni biling. Kelajagingizni boshqaring.',
  generatedOn: 'Yaratilgan sana',
  income: 'Daromad',
  expenses: 'Xarajat',
  savings: "Jamg'arma",
  savingsRate: "Jamg'arma darajasi",
  biggestCategory: 'Eng katta turkum',
  largestExpense: 'Eng katta xarajat',
  budgetPerformance: 'Byudjet bajarilishi',
  goalsProgress: 'Maqsadlar bo\'yicha taraqqiyot',
  netWorthChange: "Sof boylik o'zgarishi",
  vsPreviousMonth: "o'tgan oyga nisbatan",
  noData: "Bu davr uchun ma'lumot yo'q.",
  disclaimer: "Bu hisobot siz FinTrackka kiritgan ma'lumotlar asosida yaratilgan. U faqat shaxsiy byudjetlashtirish uchun mo'ljallangan va moliyaviy, investitsion, soliq yoki huquqiy maslahat emas.",
  used: 'ishlatildi',
  status: { none: 'Meʼyorda', notice: 'Ogohlantirish', warning: "E'tibor", exceeded: 'Oshib ketdi' },
  goalStatus: { active: 'Jarayonda', completed: 'Erishildi', archived: 'Arxivda' },
};

const DICTS: Record<Lang, ReportDict> = { en, ru, uz };
export const reportText = (lang: Lang): ReportDict => DICTS[lang] ?? en;
