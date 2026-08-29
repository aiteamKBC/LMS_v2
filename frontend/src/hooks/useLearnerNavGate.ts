import { useEffect, useState } from 'react';
import type { SidebarNavItem } from '@/components/feature/Sidebar';
import { fetchLearnerDetail } from '@/api/learnerDetail';
import { getRememberedLearner, rememberLearner } from './useMyLearner';
import { navItemsForStatus } from './useOnboardingRedirect';
import { isLearnerFlowAccount } from '@/lib/learnerFlowAccess';

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
const learnerKindKey = (id: string) => `learner_kind:${id}`;

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

/** Mounted gates, so a status correction re-renders the sidebar immediately. */
const listeners = new Set<() => void>();

function rememberStatus(cacheKey: string, status: string): void {
  statusCache.set(cacheKey, status);
  try {
    sessionStorage.setItem(storageKey(cacheKey), status);
  } catch {
    /* storage unavailable — the module cache still covers this session */
  }
}

/**
 * Reconcile the cache with a status the caller has just seen live.
 *
 * The cache is never expired — that is deliberate, since re-requesting the
 * status on every navigation would be wasteful. But it means a status changed
 * by staff would otherwise not reach the learner until they opened a new
 * browser session, and for a learner sitting at 'Fresh user' the whole
 * workspace is one waiting page: a stale entry is not a cosmetic menu problem,
 * it keeps them on that page after their enrolment has actually started.
 *
 * The learner's own overview fetches the real record anyway, so it calls this
 * with what it found. A no-op when nothing changed.
 */
export function syncLearnerStatus(
  kind: string | undefined,
  id: string | undefined,
  status: string | null | undefined,
): void {
  if (!kind || !id || status == null) return;
  const cacheKey = `${kind}:${id}`;
  if (statusCache.get(cacheKey) === status) return;
  rememberStatus(cacheKey, status);
  listeners.forEach((notify) => notify());
}

export function useLearnerNavGate(role: string, navItems: SidebarNavItem[], accountEmail?: string | null): SidebarNavItem[] {
  const learner = role === 'learner' ? getRememberedLearner() : null;
  const cacheKey = learner ? `${learner.kind}:${learner.id}` : '';
  const [status, setStatus] = useState<string | null>(
    cacheKey ? cachedStatus(cacheKey) : null,
  );

  // Re-read the cache whenever syncLearnerStatus corrects it, so a learner
  // whose status changed mid-session gets their menu back without a reload.
  useEffect(() => {
    if (!cacheKey) return;
    const notify = () => setStatus(cachedStatus(cacheKey));
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  }, [cacheKey]);

  useEffect(() => {
    if (!learner || !cacheKey) return;
    const cached = cachedStatus(cacheKey);
    if (cached !== null) {
      setStatus(cached);
      // Status is cached by kind, but older sessions stored every signed-in
      // learner as apprenticeship. Verify the source type once per session so
      // a commercial learner's restricted menu cannot be bypassed by that old
      // browser value.
      try {
        if (sessionStorage.getItem(learnerKindKey(learner.id)) === learner.kind) return;
      } catch {
        // Storage is optional; verify from the API below.
      }
    }
    let cancelled = false;
    fetchLearnerDetail(learner.kind, learner.id)
      .then((detail) => {
        // A learner account used to be remembered as apprenticeship by default.
        // Trust the API's stored learner type and repair that stale browser
        // value, otherwise commercial-only sidebar rules never take effect.
        if (detail.learnerType && detail.learnerType !== learner.kind) {
          rememberLearner(detail.learnerType, learner.id);
        }
        try {
          sessionStorage.setItem(learnerKindKey(learner.id), detail.learnerType || learner.kind);
        } catch {
          /* storage unavailable */
        }
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
  if (role === 'learner' && isLearnerFlowAccount(accountEmail)) {
    return navItems
      .filter((item) => item.id === 'learner-overview')
      .map((item) => ({
        ...item,
        label: 'Materials',
        icon: 'ri-book-open-line',
        href: '/learner/materials',
      }));
  }
  if (!learner) return navItems;
  // First visit of the session, status still in flight. An empty rail for that
  // moment is honest; showing the full menu would be showing the wrong one, and
  // an onboarding learner would see it visibly collapse once the status lands.
  if (status === null) return [];
  return navItemsForStatus(status, navItems, learner.kind);
}
