import {
  LayoutDashboard, CalendarDays, ArrowLeftRight, Wallet, Tags, Repeat, PiggyBank, Target, CreditCard, Landmark,
  BarChart3, TrendingUp, Wand2, GitBranch, Flame, History, CalendarCheck2, Sparkles, MessagesSquare, HeartPulse,
  ScanLine, FileDown, FileText, BookOpen, Bell, ShieldCheck, LockKeyhole, Settings, ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  key: string;
  path: string;
  icon: LucideIcon;
}
export interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  { labelKey: 'nav.overview', items: [
    { key: 'nav.dashboard', path: '/app/dashboard', icon: LayoutDashboard },
    { key: 'nav.calendar', path: '/app/calendar', icon: CalendarDays },
  ] },
  { labelKey: 'nav.money', items: [
    { key: 'nav.transactions', path: '/app/transactions', icon: ArrowLeftRight },
    { key: 'nav.accounts', path: '/app/accounts', icon: Wallet },
    { key: 'nav.categories', path: '/app/categories', icon: Tags },
    { key: 'nav.recurring', path: '/app/recurring', icon: Repeat },
  ] },
  { labelKey: 'nav.planning', items: [
    { key: 'nav.budgets', path: '/app/budgets', icon: PiggyBank },
    { key: 'nav.goals', path: '/app/goals', icon: Target },
    { key: 'nav.subscriptions', path: '/app/subscriptions', icon: CreditCard },
    { key: 'nav.debts', path: '/app/debts', icon: Landmark },
  ] },
  { labelKey: 'nav.insights', items: [
    { key: 'nav.analytics', path: '/app/analytics', icon: BarChart3 },
    { key: 'nav.netWorth', path: '/app/net-worth', icon: TrendingUp },
    { key: 'nav.forecast', path: '/app/forecast', icon: Wand2 },
    { key: 'nav.simulator', path: '/app/simulator', icon: GitBranch },
    { key: 'nav.moneyFlow', path: '/app/money-flow', icon: ArrowLeftRight },
    { key: 'nav.heatmap', path: '/app/heatmap', icon: Flame },
    { key: 'nav.timeline', path: '/app/timeline', icon: History },
    { key: 'nav.review', path: '/app/review', icon: CalendarCheck2 },
    { key: 'nav.insightsPage', path: '/app/insights', icon: Sparkles },
    { key: 'nav.assistant', path: '/app/assistant', icon: MessagesSquare },
    { key: 'nav.health', path: '/app/health', icon: HeartPulse },
  ] },
  { labelKey: 'nav.tools', items: [
    { key: 'nav.receipts', path: '/app/receipts', icon: ScanLine },
    { key: 'nav.importExport', path: '/app/import-export', icon: FileDown },
    { key: 'nav.reports', path: '/app/reports', icon: FileText },
    { key: 'nav.journal', path: '/app/journal', icon: BookOpen },
  ] },
  { labelKey: 'nav.account', items: [
    { key: 'nav.notifications', path: '/app/notifications', icon: Bell },
    { key: 'nav.security', path: '/app/security', icon: ShieldCheck },
    { key: 'nav.privacy', path: '/app/privacy', icon: LockKeyhole },
    { key: 'nav.settings', path: '/app/settings', icon: Settings },
  ] },
];

export const ADMIN_NAV_ITEM: NavItem = { key: 'nav.admin', path: '/app/admin', icon: ShieldAlert };

export const MOBILE_NAV: NavItem[] = [
  { key: 'nav.home', path: '/app/dashboard', icon: LayoutDashboard },
  { key: 'nav.transactions', path: '/app/transactions', icon: ArrowLeftRight },
  { key: 'nav.analytics', path: '/app/analytics', icon: BarChart3 },
  { key: 'nav.more', path: '/app/settings', icon: Settings },
];
