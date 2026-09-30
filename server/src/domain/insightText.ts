import type { Lang } from '@shared/constants';

/**
 * Localised phrasing for the deterministic insight engine (domain/insights.ts). Every function takes only
 * already-computed, already-formatted values (money strings, percentages) — no logic lives here, just text,
 * so a translator can review this file without touching the maths.
 */
export interface InsightText {
  title: string;
  what: string;
  why: string;
  options: string[];
}

type Dict = {
  categoryUp: (cat: string, pct: number, amount: string, avg: string) => InsightText;
  categoryDown: (cat: string, pct: number, amount: string, avg: string) => InsightText;
  savingsUp: (pctPoints: number, rate: number) => InsightText;
  savingsDown: (pctPoints: number, rate: number) => InsightText;
  recurringShare: (pct: number, amount: string) => InsightText;
  budgetAlert: (category: string, pct: number, remaining: string, level: 'notice' | 'warning' | 'exceeded') => InsightText;
  unusualTransaction: (merchant: string, amount: string, category: string, avg: string) => InsightText;
  upcomingLargeBill: (name: string, amount: string, date: string) => InsightText;
  goalBehind: (goal: string, requiredMonthly: string, deadline: string) => InsightText;
  goalCompleted: (goal: string) => InsightText;
  noData: () => InsightText;
};

const en: Dict = {
  categoryUp: (cat, pct, amount, avg) => ({
    title: `${cat} spending is up`,
    what: `You spent ${amount} on ${cat} this period — ${pct}% more than your recent average of ${avg}.`,
    why: `This is worth a look because it's the biggest jump among your spending categories this period.`,
    options: [`Review recent ${cat} transactions`, `Set or adjust a budget for ${cat}`, `No action needed if this was a one-off`],
  }),
  categoryDown: (cat, pct, amount, avg) => ({
    title: `${cat} spending is down`,
    what: `You spent ${amount} on ${cat} this period — ${pct}% less than your recent average of ${avg}.`,
    why: `Lower spending here is helping your overall savings this period.`,
    options: [`Keep it up`, `Move the difference toward a goal`],
  }),
  savingsUp: (pctPoints, rate) => ({
    title: `Your savings rate improved`,
    what: `Your savings rate is ${rate}% this period, up ${pctPoints} percentage points from last period.`,
    why: `A higher share of income saved compounds over time toward your goals.`,
    options: [`Consider directing the extra savings to a goal`, `Review what changed to repeat it next period`],
  }),
  savingsDown: (pctPoints, rate) => ({
    title: `Your savings rate dropped`,
    what: `Your savings rate is ${rate}% this period, down ${pctPoints} percentage points from last period.`,
    why: `A lower savings rate means less progress toward your goals this period.`,
    options: [`Compare this period's categories with last period`, `Review upcoming bills that might explain it`, `No action needed if this was expected`],
  }),
  recurringShare: (pct, amount) => ({
    title: `Recurring expenses are a large share of your income`,
    what: `Recurring expenses (subscriptions and recurring bills) total ${amount} — about ${pct}% of your average monthly income.`,
    why: `A high fixed-cost share leaves less flexibility for saving or unexpected expenses.`,
    options: [`Review your subscriptions for ones you no longer use`, `No action needed if these are essential`],
  }),
  budgetAlert: (category, pct, remaining, level) => ({
    title: level === 'exceeded' ? `${category} budget exceeded` : `${category} budget is ${pct}% used`,
    what: level === 'exceeded' ? `You've gone over your ${category} budget for this period.` : `You've used ${pct}% of your ${category} budget, with ${remaining} remaining.`,
    why: `Tracking this now makes it easier to adjust before the period ends.`,
    options: [`Slow down spending in ${category} for the rest of the period`, `Adjust the ${category} budget if it no longer fits`],
  }),
  unusualTransaction: (merchant, amount, category, avg) => ({
    title: `Larger than usual ${category} transaction`,
    what: `A ${amount} transaction at ${merchant} is notably higher than your typical ${category} transaction (around ${avg}).`,
    why: `Flagging unusually large transactions helps catch mistakes or one-off purchases early.`,
    options: [`Double-check this transaction is correct`, `No action needed if this was intentional`],
  }),
  upcomingLargeBill: (name, amount, date) => ({
    title: `Upcoming bill: ${name}`,
    what: `${name} for ${amount} is due on ${date}.`,
    why: `This is one of your larger upcoming payments relative to your typical monthly spending.`,
    options: [`Make sure the account it's paid from has enough balance`, `No action needed if this is already planned for`],
  }),
  goalBehind: (goal, requiredMonthly, deadline) => ({
    title: `"${goal}" may miss its deadline`,
    what: `At the current pace, "${goal}" is behind schedule for its ${deadline} deadline. Reaching it would need about ${requiredMonthly} per month from now on.`,
    why: `Catching this early leaves more time to adjust contributions or the deadline.`,
    options: [`Increase monthly contributions to this goal`, `Move the deadline further out`, `Leave it as is and reassess later`],
  }),
  goalCompleted: (goal) => ({
    title: `Goal reached: "${goal}"`,
    what: `You've reached your target for "${goal}". Nice work.`,
    why: `Worth celebrating — and maybe worth setting the next goal.`,
    options: [`Set a new goal`, `Redirect these contributions elsewhere`],
  }),
  noData: () => ({
    title: `Not enough data yet`,
    what: `Add a few more transactions to start seeing personalised insights here.`,
    why: `Insights need some spending history to compare against.`,
    options: [`Add a transaction`, `Import past transactions from a CSV file`],
  }),
};

const ru: Dict = {
  categoryUp: (cat, pct, amount, avg) => ({
    title: `Рост расходов: ${cat}`,
    what: `За этот период вы потратили ${amount} на «${cat}» — на ${pct}% больше вашего обычного среднего в ${avg}.`,
    why: `Это самый заметный рост среди ваших категорий расходов за период.`,
    options: [`Посмотреть последние операции по «${cat}»`, `Настроить или изменить бюджет по «${cat}»`, `Не предпринимать ничего, если это разовый случай`],
  }),
  categoryDown: (cat, pct, amount, avg) => ({
    title: `Снижение расходов: ${cat}`,
    what: `За этот период вы потратили ${amount} на «${cat}» — на ${pct}% меньше обычного среднего в ${avg}.`,
    why: `Снижение расходов здесь помогает вашим накоплениям за период.`,
    options: [`Продолжайте в том же духе`, `Направить разницу на цель`],
  }),
  savingsUp: (pctPoints, rate) => ({
    title: `Норма накоплений выросла`,
    what: `Ваша норма накоплений за период — ${rate}%, что на ${pctPoints} п.п. больше, чем в прошлом периоде.`,
    why: `Более высокая доля сохранённого дохода со временем приближает вас к целям.`,
    options: [`Направить дополнительные накопления на цель`, `Посмотреть, что изменилось, чтобы повторить это`],
  }),
  savingsDown: (pctPoints, rate) => ({
    title: `Норма накоплений снизилась`,
    what: `Ваша норма накоплений за период — ${rate}%, что на ${pctPoints} п.п. меньше, чем в прошлом периоде.`,
    why: `Более низкая норма накоплений означает меньший прогресс к целям в этом периоде.`,
    options: [`Сравнить категории этого периода с прошлым`, `Проверить предстоящие платежи`, `Не предпринимать ничего, если это ожидаемо`],
  }),
  recurringShare: (pct, amount) => ({
    title: `Регулярные расходы занимают большую долю дохода`,
    what: `Регулярные расходы (подписки и платежи) составляют ${amount} — около ${pct}% вашего среднего месячного дохода.`,
    why: `Высокая доля постоянных расходов оставляет меньше гибкости для накоплений и непредвиденных трат.`,
    options: [`Проверить подписки, которыми вы больше не пользуетесь`, `Не предпринимать ничего, если эти расходы необходимы`],
  }),
  budgetAlert: (category, pct, remaining, level) => ({
    title: level === 'exceeded' ? `Бюджет «${category}» превышен` : `Бюджет «${category}» использован на ${pct}%`,
    what: level === 'exceeded' ? `Вы превысили бюджет по категории «${category}» за этот период.` : `Вы использовали ${pct}% бюджета «${category}», осталось ${remaining}.`,
    why: `Отслеживание этого сейчас упрощает корректировку до конца периода.`,
    options: [`Сократить расходы по «${category}» до конца периода`, `Скорректировать бюджет «${category}», если он больше не подходит`],
  }),
  unusualTransaction: (merchant, amount, category, avg) => ({
    title: `Необычно крупная операция: ${category}`,
    what: `Операция на ${amount} в «${merchant}» заметно больше вашей типичной операции по категории «${category}» (около ${avg}).`,
    why: `Отметка необычно крупных операций помогает вовремя заметить ошибки или разовые покупки.`,
    options: [`Проверить, что операция верна`, `Не предпринимать ничего, если это было намеренно`],
  }),
  upcomingLargeBill: (name, amount, date) => ({
    title: `Предстоящий платёж: ${name}`,
    what: `Платёж «${name}» на ${amount} должен быть оплачен ${date}.`,
    why: `Это один из ваших более крупных предстоящих платежей относительно обычных месячных трат.`,
    options: [`Убедитесь, что на счёте списания достаточно средств`, `Не предпринимать ничего, если это уже учтено в планах`],
  }),
  goalBehind: (goal, requiredMonthly, deadline) => ({
    title: `Цель «${goal}» может не уложиться в срок`,
    what: `При текущем темпе цель «${goal}» отстаёт от графика для срока ${deadline}. Чтобы успеть, потребуется откладывать примерно ${requiredMonthly} в месяц.`,
    why: `Заметить это заранее — значит иметь больше времени скорректировать взносы или срок.`,
    options: [`Увеличить ежемесячные взносы на эту цель`, `Перенести срок цели`, `Оставить как есть и пересмотреть позже`],
  }),
  goalCompleted: (goal) => ({
    title: `Цель достигнута: «${goal}»`,
    what: `Вы достигли цели «${goal}». Отличная работа!`,
    why: `Стоит отметить — и, возможно, поставить следующую цель.`,
    options: [`Поставить новую цель`, `Направить эти взносы на другое`],
  }),
  noData: () => ({
    title: `Пока недостаточно данных`,
    what: `Добавьте несколько операций, чтобы здесь появились персональные инсайты.`,
    why: `Для инсайтов нужна история трат для сравнения.`,
    options: [`Добавить операцию`, `Импортировать прошлые операции из CSV`],
  }),
};

const uz: Dict = {
  categoryUp: (cat, pct, amount, avg) => ({
    title: `${cat} xarajatlari oshdi`,
    what: `Bu davrda siz «${cat}» uchun ${amount} sarfladingiz — bu odatdagi ${avg} o'rtachadan ${pct}% ko'p.`,
    why: `Bu davrdagi xarajat turkumlaringiz orasida eng katta o'sish shu.`,
    options: [`«${cat}» bo'yicha so'nggi operatsiyalarni ko'rish`, `«${cat}» uchun byudjet sozlash yoki o'zgartirish`, `Agar bu bir martalik holat bo'lsa, hech narsa qilish shart emas`],
  }),
  categoryDown: (cat, pct, amount, avg) => ({
    title: `${cat} xarajatlari kamaydi`,
    what: `Bu davrda siz «${cat}» uchun ${amount} sarfladingiz — bu odatdagi ${avg} o'rtachadan ${pct}% kam.`,
    why: `Bu yerdagi kam xarajat umumiy jamg'armangizga yordam bermoqda.`,
    options: [`Shu tarzda davom eting`, `Farqni maqsadga yo'naltiring`],
  }),
  savingsUp: (pctPoints, rate) => ({
    title: `Jamg'arma darajangiz oshdi`,
    what: `Bu davrda jamg'arma darajangiz ${rate}%, bu o'tgan davrdan ${pctPoints} foiz punktga ko'p.`,
    why: `Daromadning ko'proq qismini jamg'arish vaqt o'tishi bilan maqsadlaringizga yaqinlashtiradi.`,
    options: [`Qo'shimcha jamg'armani maqsadga yo'naltirishni ko'rib chiqing`, `Nima o'zgarganini ko'rib, uni takrorlang`],
  }),
  savingsDown: (pctPoints, rate) => ({
    title: `Jamg'arma darajangiz pasaydi`,
    what: `Bu davrda jamg'arma darajangiz ${rate}%, bu o'tgan davrdan ${pctPoints} foiz punktga kam.`,
    why: `Past jamg'arma darajasi bu davrda maqsadlar sari kamroq taraqqiyot degani.`,
    options: [`Bu davr turkumlarini o'tgan davr bilan solishtiring`, `Buni tushuntirishi mumkin bo'lgan yaqinlashib kelayotgan to'lovlarni ko'rib chiqing`, `Agar bu kutilgan bo'lsa, hech narsa qilish shart emas`],
  }),
  recurringShare: (pct, amount) => ({
    title: `Doimiy xarajatlar daromadning katta qismini egallaydi`,
    what: `Doimiy xarajatlar (obunalar va doimiy to'lovlar) jami ${amount} — bu o'rtacha oylik daromadingizning taxminan ${pct}%.`,
    why: `Doimiy xarajatlarning yuqori ulushi jamg'arish yoki kutilmagan xarajatlar uchun kamroq erkinlik qoldiradi.`,
    options: [`Endi foydalanmayotgan obunalaringizni ko'rib chiqing`, `Agar bular zarur bo'lsa, hech narsa qilish shart emas`],
  }),
  budgetAlert: (category, pct, remaining, level) => ({
    title: level === 'exceeded' ? `«${category}» byudjeti oshib ketdi` : `«${category}» byudjeti ${pct}% ishlatildi`,
    what: level === 'exceeded' ? `Siz bu davr uchun «${category}» byudjetidan oshib ketdingiz.` : `Siz «${category}» byudjetining ${pct}% qismini ishlatdingiz, ${remaining} qoldi.`,
    why: `Buni hozir kuzatib borish davr tugashidan oldin tuzatishni osonlashtiradi.`,
    options: [`Davr oxirigacha «${category}» bo'yicha xarajatlarni kamaytiring`, `Agar mos kelmasa, «${category}» byudjetini o'zgartiring`],
  }),
  unusualTransaction: (merchant, amount, category, avg) => ({
    title: `Odatdagidan katta operatsiya: ${category}`,
    what: `«${merchant}»dagi ${amount} miqdoridagi operatsiya «${category}» bo'yicha odatiy operatsiyangizdan (taxminan ${avg}) sezilarli darajada katta.`,
    why: `Odatdan tashqari katta operatsiyalarni belgilash xatolarni yoki bir martalik xaridlarni o'z vaqtida aniqlashga yordam beradi.`,
    options: [`Bu operatsiya to'g'riligini tekshiring`, `Agar bu ataylab qilingan bo'lsa, hech narsa qilish shart emas`],
  }),
  upcomingLargeBill: (name, amount, date) => ({
    title: `Yaqinlashib kelayotgan to'lov: ${name}`,
    what: `${name} uchun ${amount} to'lovi ${date} sanasida amalga oshirilishi kerak.`,
    why: `Bu odatiy oylik xarajatlaringizga nisbatan yirikroq yaqinlashib kelayotgan to'lovlaringizdan biri.`,
    options: [`To'lov hisobida yetarli mablag' borligiga ishonch hosil qiling`, `Agar bu allaqachon rejalashtirilgan bo'lsa, hech narsa qilish shart emas`],
  }),
  goalBehind: (goal, requiredMonthly, deadline) => ({
    title: `«${goal}» maqsadi muddatga ulgurmasligi mumkin`,
    what: `Hozirgi sur'atda «${goal}» maqsadi ${deadline} muddati uchun jadvaldan orqada qolmoqda. Ulgurish uchun oyiga taxminan ${requiredMonthly} jamg'arish kerak bo'ladi.`,
    why: `Buni erta payqash badallarni yoki muddatni sozlash uchun ko'proq vaqt qoldiradi.`,
    options: [`Bu maqsad uchun oylik badallarni oshiring`, `Maqsad muddatini uzaytiring`, `Hozircha shundayligicha qoldirib, keyinroq qayta ko'rib chiqing`],
  }),
  goalCompleted: (goal) => ({
    title: `Maqsadga erishildi: «${goal}»`,
    what: `Siz «${goal}» maqsadingizga yetdingiz. Ajoyib natija!`,
    why: `Bu nishonlashga arziydi — va ehtimol keyingi maqsadni qo'yish vaqti keldi.`,
    options: [`Yangi maqsad qo'yish`, `Bu badallarni boshqa narsaga yo'naltirish`],
  }),
  noData: () => ({
    title: `Hozircha ma'lumot yetarli emas`,
    what: `Shaxsiy tahlillarni ko'rish uchun yana bir nechta operatsiya qo'shing.`,
    why: `Tahlillar uchun solishtirish uchun xarajatlar tarixi kerak.`,
    options: [`Operatsiya qo'shish`, `CSV fayldan o'tgan operatsiyalarni import qilish`],
  }),
};

const DICTS: Record<Lang, Dict> = { en, ru, uz };
export const insightText = (lang: Lang): Dict => DICTS[lang] ?? en;
