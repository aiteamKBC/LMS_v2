import type { LearnerKind } from '@/api/learnerDetail';
import { useEffect, useState } from 'react';
import { useCaseFileSession } from '@/features/coach/case-file/hooks/CaseFileSession';
import { useDashboardPlan } from '@/pages/workspace/learner/useDashboardPlan';

export function useCaseFileDashboardPlan(
  kind: LearnerKind | null | undefined,
  learnerId: string | null | undefined,
  enabled: boolean,
  requested: boolean,
  section = 'overview',
) {
  const session = useCaseFileSession();
  const identity = kind && learnerId ? `${kind}:${learnerId}` : null;
  const [activatedIdentity, setActivatedIdentity] = useState<string | null>(null);
  useEffect(() => { if (requested && identity) setActivatedIdentity(identity); }, [identity, requested]);
  return useDashboardPlan(kind, learnerId, enabled && (session ? requested : Boolean(identity && (requested || activatedIdentity === identity))), section);
}
