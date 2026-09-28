import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchFirstLoginDetails } from '@/api/firstLoginDetails';
import { isFreshStatus } from './useOnboardingRedirect';

/** Where a new apprentice gives their details and signature on first sign-in. */
export const FIRST_LOGIN_ROUTE = '/learner/welcome';

/**
 * Learners already confirmed as not needing the first-sign-in screens, so
 * moving between the landing pages does not ask again. Only negative answers
 * are kept: a learner who does need them leaves 'Fresh user' by finishing,
 * which stops the check on its own.
 */
const notRequired = new Set<string>();

/**
 * Send a newly created apprentice to the first-sign-in screens before anything
 * else.
 *
 * Only an apprenticeship learner still at 'Fresh user' is checked — the status
 * every account is created with — and the server has the final say (it also
 * knows whether they have already done it). Returns true while that answer is
 * pending or the redirect is under way, so the caller can hold its content
 * rather than flash the page being left.
 *
 * A failed check lets the learner through: locking somebody out of their own
 * workspace over one dropped request is the worse error, and the next sign-in
 * asks again.
 */
export function useFirstLoginDetailsRedirect(
  kind: string | undefined,
  learnerId: string | undefined,
  programmeStatus: string | undefined,
  enabled = true,
): boolean {
  const navigate = useNavigate();
  const shouldCheck = enabled
    && kind === 'apprenticeship'
    && !!learnerId
    && isFreshStatus(programmeStatus)
    && !notRequired.has(learnerId);
  const [settled, setSettled] = useState<string | null>(null);
  const key = shouldCheck ? learnerId! : null;

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    fetchFirstLoginDetails(key)
      .then((state) => {
        if (cancelled) return;
        if (state.required) {
          navigate(FIRST_LOGIN_ROUTE, { replace: true });
          return;
        }
        notRequired.add(key);
        setSettled(key);
      })
      .catch(() => {
        if (!cancelled) setSettled(key);
      });
    return () => {
      cancelled = true;
    };
  }, [key, navigate]);

  return !!key && settled !== key;
}

/** Forget cached answers — for tests. */
export function resetFirstLoginDetailsRedirect(): void {
  notRequired.clear();
}
