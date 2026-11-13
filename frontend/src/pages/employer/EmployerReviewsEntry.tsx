import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { homeRouteFor } from '@/lib/routeAccess';

/** Old review links lead to the same owned portal as employer sign-in. */
export function EmployerReviewsEntry() {
  const { auth, isInitialized } = useAuth();
  if (isInitialized === false) return <p role="status">Loading your account...</p>;
  const account = auth.account;
  if (!account) return <Navigate to="/login" replace />;
  if (account.role === 'employer') {
    if (!account.subjectId) return <p role="alert">Your employer account is not linked to an employer record. Contact your programme team.</p>;
    return <Navigate to={`/employers/${account.subjectId}/reviews`} replace />;
  }
  return <Navigate to={homeRouteFor(account)} replace />;
}
