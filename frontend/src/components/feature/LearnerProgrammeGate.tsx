import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLearnerSummaryParam } from '@/hooks/useLearnerSummaryParam';
import { RouteLoadingSkeleton } from './RouteLoadingSkeleton';
import { LearnerLoadError } from './LearnerLoadError';

// Keep programme/profile/plan previews available; lesson routes must wait.
const learningRoute = /^\/learner\/(?:my-learning|modules|learning-plan\/modules|training-plan|quizzes|quiz|video|video-watch|component|monthly-submission)(?:\/|$)/;

export function LearnerProgrammeGate({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const { pathname } = useLocation();
  const account = auth.account;
  const gated = account?.role === 'learner' && learningRoute.test(pathname);
  const { real, loading, loadError, refresh } = useLearnerSummaryParam(
    gated ? account.learnerType || 'apprenticeship' : undefined,
    gated ? String(account.subjectId) : undefined,
  );
  if (!gated) return children;
  if (loadError) return <LearnerLoadError error={loadError} onRetry={refresh} />;
  if (loading || !real) return <RouteLoadingSkeleton />;
  const blocked = real.learningAccess?.blocked
    ?? real.accessGate?.reasons.some(reason => reason === 'start-date-future' || reason === 'start-date-missing');
  if (blocked) return <Navigate to="/workspace/learner" replace />;
  return children;
}
