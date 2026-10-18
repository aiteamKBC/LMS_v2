import { dashboardHeader } from '@/api/dashboardHeader';
import { useLiveLearnerRead } from './useLiveLearnerRead';
import { useCallback, useState } from 'react';
import { LearnerReadError } from '@/api/learnerRead';
import { invalidateLearnerReads } from '@/api/learnerRead';
import { useRefreshOnRemoteWrite } from './useRefreshOnReturn';
import type { LearnerKind } from '@/api/learnerDetail';

/** Canonical Header identity, navigation and cards share one isolated read. */
export function useDashboardHeader(kind?: string, id?: string, enabled = true) {
  const valid = kind === 'commercial' || kind === 'apprenticeship';
  const key = `${kind}:${id}`;
  const [denied, setDenied] = useState<{ key: string; error: string } | null>(null);
  const reader = useCallback(async (requestedKind: LearnerKind, requestedId: string, signal?: AbortSignal, fresh = false) => {
    try {
      const data = await dashboardHeader.read(requestedKind, requestedId, signal, fresh);
      setDenied(null);
      return data;
    } catch (error) {
      // Service/display failures are independent; real authorization or
      // identity failures must also hide previously cached protected content.
      if (error instanceof LearnerReadError && [401, 403, 404, 409].includes(error.status)) {
        setDenied({ key: `${requestedKind}:${requestedId}`, error: error.message });
      }
      throw error;
    }
  }, []);
  const read = useLiveLearnerRead(valid ? kind : null, id, valid && enabled, reader, dashboardHeader.peek);
  useRefreshOnRemoteWrite(invalidateLearnerReads, { enabled: valid && !!id,
    match: path => /\/(modules|weeks|components|groups|cohorts|programmes|[^/]*review[^/]*|[^/]*holiday[^/]*)\//.test(path) });
  return { ...read, isRealMode: valid, real: read.data?.learner ?? null, loadError: read.error, accessFailure: denied?.key === key ? denied.error : '' };
}
