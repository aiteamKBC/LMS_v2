import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';

/**
 * The signed-in staff account is the single source of truth for coach-scoped
 * API requests. This prevents coach pages from silently falling back to the
 * legacy demo account.
 */
export function useCoachIdentity() {
  const { auth, isInitialized } = useAuth();
  const hasCoachAccess = auth.account?.access === 'coach';

  return {
    email: hasCoachAccess ? auth.account?.email || '' : '',
    name: auth.account?.displayName || auth.user?.fullName || 'Coach',
    hasCoachAccess,
    isInitialized,
  };
}

export function withCoachOwnerEmail(endpoint: string, ownerEmail: string) {
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}owner_email=${encodeURIComponent(ownerEmail)}`;
}

export function useCoachAssignedLearnerNames() {
  const coach = useCoachIdentity();
  const [assignedLearnerNames, setAssignedLearnerNames] = useState<Set<string>>(new Set());
  const [caseloadLoading, setCaseloadLoading] = useState(true);
  const [caseloadError, setCaseloadError] = useState('');

  useEffect(() => {
    if (!coach.isInitialized) return;
    if (!coach.email) {
      setAssignedLearnerNames(new Set());
      setCaseloadError('Coach access is required to load assigned learners.');
      setCaseloadLoading(false);
      return;
    }

    const controller = new AbortController();
    setCaseloadLoading(true);
    setCaseloadError('');

    fetch(withCoachOwnerEmail('/coach_api/coach/caseload?summary=1', coach.email), {
      signal: controller.signal,
    })
      .then(async response => {
        const payload = await response.json().catch(() => ({})) as {
          detail?: string;
          learners?: Array<{ name?: string }>;
        };
        if (!response.ok) throw new Error(payload.detail || 'Unable to load coach caseload.');
        if (controller.signal.aborted) return;
        setAssignedLearnerNames(new Set(
          (payload.learners || [])
            .map(learner => String(learner.name || '').trim().toLocaleLowerCase())
            .filter(Boolean),
        ));
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setAssignedLearnerNames(new Set());
        setCaseloadError(error instanceof Error ? error.message : 'Unable to load coach caseload.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setCaseloadLoading(false);
      });

    return () => controller.abort();
  }, [coach.email, coach.isInitialized]);

  return { ...coach, assignedLearnerNames, caseloadLoading, caseloadError };
}
