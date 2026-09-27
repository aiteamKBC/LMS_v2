import { useEffect, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { useDashboardPlan } from '@/pages/workspace/learner/useDashboardPlan';

export function useCaseFileDashboardPlan(
  kind: LearnerKind | null | undefined,
  learnerId: string | null | undefined,
  enabled: boolean,
  requested: boolean,
) {
  const identity = kind && learnerId ? `${kind}:${learnerId}` : null;
  const [activatedIdentity, setActivatedIdentity] = useState<string | null>(null);
  const activated = Boolean(identity && (requested || activatedIdentity === identity));

  useEffect(() => {
    if (requested && identity) setActivatedIdentity(identity);
  }, [identity, requested]);

  return useDashboardPlan(kind, learnerId, enabled && activated);
}
