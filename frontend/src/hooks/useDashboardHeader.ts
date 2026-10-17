import { dashboardHeader } from '@/api/dashboardHeader';
import { useLiveLearnerRead } from './useLiveLearnerRead';

export function useDashboardHeader(kind?: string, id?: string) {
  const isRealMode = kind === 'commercial' || kind === 'apprenticeship';
  const read = useLiveLearnerRead(isRealMode ? kind : null, id, isRealMode,
    dashboardHeader.read, dashboardHeader.peek);
  return { ...read, isRealMode, real: read.data?.learner ?? null,
    loadError: read.error };
}
