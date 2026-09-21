import { useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLearnerSummaryParam } from '@/hooks/useLearnerSummaryParam';
import { RouteLoadingSkeleton } from './RouteLoadingSkeleton';
import { LearnerLoadError } from './LearnerLoadError';

// Lesson routes, which load the learner's own summary so a dropped connection
// can be reported rather than silently emptying the page.
const learningRoute = /^\/learner\/(?:my-learning|modules|learning-plan\/modules|training-plan|quizzes|quiz|video|video-watch|component|monthly-submission)(?:\/|$)/;

// ============================================================================
// This used to hold learners out of their own lessons until the cohort start
// date arrived, redirecting every learning route back to the dashboard. That
// restriction is gone: a learner whose start date is still ahead now gets the
// same working account as everybody else, and can open their modules, quizzes
// and training plan as soon as they are assigned.
//
// The component stays because the rest of its job is still worth doing - it
// keeps a verified page mounted and its unsaved work intact through a
// connection failure, rather than replacing it with an error screen.
// ============================================================================

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
  const retained = verifiedIdentity.current === identity && !!real;
  if (loadError && !retained) return <LearnerLoadError error={loadError} onRetry={refresh} />;
  if ((loading || !real) && !retained) return <RouteLoadingSkeleton />;
  if (!loading && !loadError) verifiedIdentity.current = identity;
  return <>
    {loadError && <div role="alert" className="fixed bottom-4 left-4 right-4 z-[100] mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg">
      <span>Connection interrupted. Your learning is still here. Reconnect to continue.</span>
      <button type="button" onClick={refresh} className="rounded-lg border border-amber-400 bg-white px-4 py-2 font-semibold">Try again</button>
    </div>}
    <div inert={!!loadError || loading} aria-busy={loading || undefined}>{children}</div>
  </>;
}
