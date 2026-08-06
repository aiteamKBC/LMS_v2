import { useEffect, useState } from 'react';
import type { SidebarNavItem } from '@/components/feature/Sidebar';
import { fetchLearnerDetail } from '@/api/learnerDetail';
import { getRememberedLearner } from './useMyLearner';
import { navItemsForStatus } from './useOnboardingRedirect';

// ============================================================================
// Restricts the learner sidebar to match their programme status.
//
// Onboarding and Delivery are pre-teaching states: there is no running training
// plan, so evidence, attendance, quizzes and progress pages would render as
// empty shells. Rather than gate this in each of the ~40 learner pages, the
// workspace shell applies it once for every one of them.
//
// The status is fetched once per mount and cached for the session, so switching
// pages doesn't re-request it.
// ============================================================================

/** Cached per learner so navigating between pages doesn't refetch. */
const statusCache = new Map<string, string>();

export function useLearnerNavGate(role: string, navItems: SidebarNavItem[]): SidebarNavItem[] {
  const learner = role === 'learner' ? getRememberedLearner() : null;
  const cacheKey = learner ? `${learner.kind}:${learner.id}` : '';
  const [status, setStatus] = useState<string | null>(
    cacheKey ? (statusCache.get(cacheKey) ?? null) : null,
  );

  useEffect(() => {
    if (!learner || !cacheKey) return;
    const cached = statusCache.get(cacheKey);
    if (cached !== undefined) {
      setStatus(cached);
      return;
    }
    let cancelled = false;
    fetchLearnerDetail(learner.kind, learner.id)
      .then((detail) => {
        const value = detail?.programmeStatus || '';
        statusCache.set(cacheKey, value);
        if (!cancelled) setStatus(value);
      })
      .catch(() => {
        // A failed lookup must not lock the learner out of their own workspace,
        // so fall back to the full nav rather than a guess.
        if (!cancelled) setStatus('');
      });
    return () => {
      cancelled = true;
    };
  }, [learner, cacheKey]);

  // Not a learner, or the status isn't known yet — show the nav unchanged. The
  // pages themselves stay reachable either way; this only trims the menu.
  if (!learner || status === null) return navItems;
  return navItemsForStatus(status, navItems);
}
