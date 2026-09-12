import { fetchLearnerSummary, peekLearnerSummary, type LearnerKind } from '@/api/learnerDetail';
import { useLiveLearnerRead } from './useLiveLearnerRead';

const readSummary = (kind: LearnerKind, id: string, _signal?: AbortSignal, fresh = false) =>
  fetchLearnerSummary(kind, id, fresh);

/** Dashboard identity has no dependency on lesson content or progress graphs. */
export function useLearnerSummaryParam(kind?: string, id?: string) {
  const isRealMode = kind === 'commercial' || kind === 'apprenticeship';
  const read = useLiveLearnerRead(isRealMode ? kind : null, id, isRealMode, readSummary, peekLearnerSummary);
  return { isRealMode, real: read.data, loading: read.loading, loadError: read.error, refresh: read.refresh };
}
