import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../../lib/auth';

export function ProtectedRoute() {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!user.onboardingCompletedAt && location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

/** Login/register/forgot-password: bounce an already-authenticated person straight into the app. */
export function PublicOnlyRoute() {
  const { user } = useAuth();
  if (user) return <Navigate to={user.onboardingCompletedAt ? '/app/dashboard' : '/onboarding'} replace />;
  return <Outlet />;
}
