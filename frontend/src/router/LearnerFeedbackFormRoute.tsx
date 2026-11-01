import type { ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { LEARNER_FEEDBACK_ENABLED } from '@/lib/featureFlags';

/** Release flags limit learner access; staff can still inspect an assigned form.
 * RequireAuth owns session/role admission. The form and API enforce read-only
 * preview and the selected learner's ownership independently of this gate.
 */
export function LearnerFeedbackFormRoute({ children }: { children: ReactElement }) {
  const { auth } = useAuth();
  const { search } = useLocation();
  const role = auth.account?.role;
  const previewLearner = new URLSearchParams(search).get('learnerId')?.trim();
  const staffPreview = (role === 'staff' || role === 'admin') && Boolean(previewLearner);

  return LEARNER_FEEDBACK_ENABLED || staffPreview
    ? children
    : <Navigate to="/workspace/learner" replace />;
}
