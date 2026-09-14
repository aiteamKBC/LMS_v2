import { useRef, type ReactNode } from 'react';
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
  const verifiedIdentity = useRef<string | null>(null);
  const identity = `${account?.learnerType}:${account?.subjectId}`;
  const gated = account?.role === 'learner' && learningRoute.test(pathname);
  const { real, loading, loadError, refresh } = useLearnerSummaryParam(
    gated ? account.learnerType || 'apprenticeship' : undefined,
    gated ? String(account.subjectId) : undefined,
  );
  if (!gated) return children;
  const blocked = real?.learningAccess?.blocked
    ?? real?.accessGate?.reasons.some(reason => reason === 'start-date-future' || reason === 'start-date-missing');
  const retained = verifiedIdentity.current === identity && !!real && !blocked;
  if (loadError && !retained) return <LearnerLoadError error={loadError} onRetry={refresh} />;
  if ((loading || !real) && !retained) return <RouteLoadingSkeleton />;
  if (blocked) return <Navigate to="/workspace/learner/dashboard" replace />;
  if (!loading && !loadError) verifiedIdentity.current = identity;
  return <>
    {loadError && <div role="alert" className="fixed bottom-4 left-4 right-4 z-[100] mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg">
      <span>Connection interrupted. Your learning is still here. Reconnect to continue.</span>
      <button type="button" onClick={refresh} className="rounded-lg border border-amber-400 bg-white px-4 py-2 font-semibold">Try again</button>
    </div>}
    <div inert={!!loadError || loading} aria-busy={loading || undefined}>{children}</div>
  </>;
}
