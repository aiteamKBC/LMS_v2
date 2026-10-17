import { dashboardHeader } from '@/api/dashboardHeader';
import { useLiveLearnerRead } from './useLiveLearnerRead';
import { useRefreshOnRemoteWrite } from './useRefreshOnReturn';
import { invalidateLearnerReads } from '@/api/learnerRead';

export function useDashboardHeader(kind?: string, id?: string) {
  const isRealMode = kind === 'commercial' || kind === 'apprenticeship';
  const read = useLiveLearnerRead(isRealMode ? kind : null, id, isRealMode,
    dashboardHeader.read, dashboardHeader.peek);
  // Clear pre-write requests too; a refresh alone can join an older in-flight read.
  useRefreshOnRemoteWrite(invalidateLearnerReads, { enabled: isRealMode && !!id,
    match: path => /\/(modules|weeks|components|groups|cohorts|programmes|[^/]*review[^/]*|[^/]*holiday[^/]*)\//.test(path) });
  return { ...read, isRealMode, real: read.data?.learner ?? null,
    loadError: read.error };
}
