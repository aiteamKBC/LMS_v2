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
// The status is fetched once per learner and cached for the browser session, so
// neither switching pages nor reloading re-requests it.
// ============================================================================

/** Cached per learner so navigating between pages doesn't refetch. */
const statusCache = new Map<string, string>();

const storageKey = (cacheKey: string) => `learner_status:${cacheKey}`;

/**
 * Last known status for this learner, from the module cache or — after a
 * reload, which empties it — from sessionStorage.
 *
 * Read synchronously into the initial state rather than in an effect: an
 * onboarding learner whose status arrives a frame late is shown the full
 * delivery menu first and watches it collapse to their two items.
 */
function cachedStatus(cacheKey: string): string | null {
  const inMemory = statusCache.get(cacheKey);
  if (inMemory !== undefined) return inMemory;
  try {
    const stored = sessionStorage.getItem(storageKey(cacheKey));
    if (stored !== null) {
      statusCache.set(cacheKey, stored);
      return stored;
    }
  } catch {
    /* storage unavailable — fall back to fetching */
  }
  return null;
}

function rememberStatus(cacheKey: string, status: string): void {
  statusCache.set(cacheKey, status);
  try {
    sessionStorage.setItem(storageKey(cacheKey), status);
  } catch {
    /* storage unavailable — the module cache still covers this session */
  }
}

export function useLearnerNavGate(role: string, navItems: SidebarNavItem[]): SidebarNavItem[] {
  const learner = role === 'learner' ? getRememberedLearner() : null;
  const cacheKey = learner ? `${learner.kind}:${learner.id}` : '';
  const [status, setStatus] = useState<string | null>(
    cacheKey ? cachedStatus(cacheKey) : null,
  );

  useEffect(() => {
    if (!learner || !cacheKey) return;
    const cached = cachedStatus(cacheKey);
    if (cached !== null) {
      setStatus(cached);
      return;
    }
    let cancelled = false;
    fetchLearnerDetail(learner.kind, learner.id)
      .then((detail) => {
        const value = detail?.programmeStatus || '';
        rememberStatus(cacheKey, value);
        if (!cancelled) setStatus(value);
      })
      .catch(() => {
        // A failed lookup must not lock the learner out of their own workspace,
        // so fall back to the full nav rather than a guess. Deliberately NOT
        // cached: a dropped request would otherwise pin the full menu on an
        // onboarding learner for the rest of the session.
        if (!cancelled) setStatus('');
      });
    return () => {
      cancelled = true;
    };
  }, [learner, cacheKey]);

  // Not a learner — the gate doesn't apply.
  if (!learner) return navItems;
  // First visit of the session, status still in flight. An empty rail for that
  // moment is honest; showing the full menu would be showing the wrong one, and
  // an onboarding learner would see it visibly collapse once the status lands.
  if (status === null) return [];
  return navItemsForStatus(status, navItems);
}
