import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from './lib/auth';
import { LoadingBlock } from './components/ui/States';
import { AppShell } from './components/layout/AppShell';
import { ProtectedRoute, PublicOnlyRoute } from './components/layout/RouteGuards';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const TermsPage = lazy(() => import('./pages/legal/TermsPage'));
const PrivacyPolicyPage = lazy(() => import('./pages/legal/PrivacyPolicyPage'));

const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage'));
const VerifyEmailPage = lazy(() => import('./pages/auth/VerifyEmailPage'));
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPasswordPage'));

const OnboardingPage = lazy(() => import('./pages/onboarding/OnboardingPage'));

const DashboardPage = lazy(() => import('./pages/app/DashboardPage'));
const TransactionsPage = lazy(() => import('./pages/app/TransactionsPage'));
const AccountsPage = lazy(() => import('./pages/app/AccountsPage'));
const CategoriesPage = lazy(() => import('./pages/app/CategoriesPage'));
const BudgetsPage = lazy(() => import('./pages/app/BudgetsPage'));
const GoalsPage = lazy(() => import('./pages/app/GoalsPage'));
const SubscriptionsPage = lazy(() => import('./pages/app/SubscriptionsPage'));
const DebtsPage = lazy(() => import('./pages/app/DebtsPage'));
const RecurringPage = lazy(() => import('./pages/app/RecurringPage'));
const CalendarPage = lazy(() => import('./pages/app/CalendarPage'));
const AnalyticsPage = lazy(() => import('./pages/app/AnalyticsPage'));
const NetWorthPage = lazy(() => import('./pages/app/NetWorthPage'));
const ForecastPage = lazy(() => import('./pages/app/ForecastPage'));
const SimulatorPage = lazy(() => import('./pages/app/SimulatorPage'));
const MoneyFlowPage = lazy(() => import('./pages/app/MoneyFlowPage'));
const HeatmapPage = lazy(() => import('./pages/app/HeatmapPage'));
const TimelinePage = lazy(() => import('./pages/app/TimelinePage'));
const ReviewPage = lazy(() => import('./pages/app/ReviewPage'));
const InsightsPage = lazy(() => import('./pages/app/InsightsPage'));
const AssistantPage = lazy(() => import('./pages/app/AssistantPage'));
const HealthPage = lazy(() => import('./pages/app/HealthPage'));
const ReceiptsPage = lazy(() => import('./pages/app/ReceiptsPage'));
const ImportExportPage = lazy(() => import('./pages/app/ImportExportPage'));
const ReportsPage = lazy(() => import('./pages/app/ReportsPage'));
const JournalPage = lazy(() => import('./pages/app/JournalPage'));
const NotificationsPage = lazy(() => import('./pages/app/NotificationsPage'));
const SecurityPage = lazy(() => import('./pages/app/SecurityPage'));
const PrivacyCenterPage = lazy(() => import('./pages/app/PrivacyCenterPage'));
const SettingsPage = lazy(() => import('./pages/app/SettingsPage'));
const AdminPage = lazy(() => import('./pages/app/AdminPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function PageFallback() {
  return (
    <div style={{ padding: 32 }}>
      <LoadingBlock height={320} />
    </div>
  );
}

export function App() {
  const { isLoading } = useAuth();
  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh' }}>
        <LoadingBlock height={40} />
      </div>
    );
  }

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />

        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>
        <Route path="/verify-email" element={<VerifyEmailPage />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route element={<AppShell />}>
            <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
            <Route path="/app/dashboard" element={<DashboardPage />} />
            <Route path="/app/transactions" element={<TransactionsPage />} />
            <Route path="/app/accounts" element={<AccountsPage />} />
            <Route path="/app/categories" element={<CategoriesPage />} />
            <Route path="/app/budgets" element={<BudgetsPage />} />
            <Route path="/app/goals" element={<GoalsPage />} />
            <Route path="/app/subscriptions" element={<SubscriptionsPage />} />
            <Route path="/app/debts" element={<DebtsPage />} />
            <Route path="/app/recurring" element={<RecurringPage />} />
            <Route path="/app/calendar" element={<CalendarPage />} />
            <Route path="/app/analytics" element={<AnalyticsPage />} />
            <Route path="/app/net-worth" element={<NetWorthPage />} />
            <Route path="/app/forecast" element={<ForecastPage />} />
            <Route path="/app/simulator" element={<SimulatorPage />} />
            <Route path="/app/money-flow" element={<MoneyFlowPage />} />
            <Route path="/app/heatmap" element={<HeatmapPage />} />
            <Route path="/app/timeline" element={<TimelinePage />} />
            <Route path="/app/review" element={<ReviewPage />} />
            <Route path="/app/insights" element={<InsightsPage />} />
            <Route path="/app/assistant" element={<AssistantPage />} />
            <Route path="/app/health" element={<HealthPage />} />
            <Route path="/app/receipts" element={<ReceiptsPage />} />
            <Route path="/app/import-export" element={<ImportExportPage />} />
            <Route path="/app/reports" element={<ReportsPage />} />
            <Route path="/app/journal" element={<JournalPage />} />
            <Route path="/app/notifications" element={<NotificationsPage />} />
            <Route path="/app/security" element={<SecurityPage />} />
            <Route path="/app/privacy" element={<PrivacyCenterPage />} />
            <Route path="/app/settings" element={<SettingsPage />} />
            <Route path="/app/admin" element={<AdminPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
