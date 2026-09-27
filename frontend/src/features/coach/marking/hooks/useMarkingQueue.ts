import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMarkingQueue } from '../api/markingApi';
import type { MarkingQueuePagination, MarkingQueueRequest, MarkingQueueSummary, MarkingSubmission } from '../types/marking.types';

export const EMPTY_MARKING_SUMMARY: MarkingQueueSummary = {
  totalItems: 0, activeLearners: 0, pendingItems: 0, acceptedItems: 0,
  referredItems: 0, overdueItems: 0, assignmentItems: 0, reflectionItems: 0,
};
export const EMPTY_MARKING_PAGINATION: MarkingQueuePagination = {
  page: 1, pageSize: 25, totalItems: 0, totalPages: 0, hasNext: false, hasPrevious: false,
};

export function useMarkingQueue(request: MarkingQueueRequest, enabled: boolean) {
  const [items, setItems] = useState<MarkingSubmission[]>([]);
  const [summary, setSummary] = useState(EMPTY_MARKING_SUMMARY);
  const [pagination, setPagination] = useState(EMPTY_MARKING_PAGINATION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    if (!enabled) return;
    setLoading(true); setError('');
    try {
      const data = await fetchMarkingQueue(request);
      if (current !== sequence.current) return;
      setItems(data.items || []);
      setSummary(data.summary || EMPTY_MARKING_SUMMARY);
      setPagination(data.pagination || EMPTY_MARKING_PAGINATION);
    } catch (reason) {
      if (current !== sequence.current) return;
      setItems([]);
      setError(reason instanceof Error ? reason.message : 'Unable to load the marking queue.');
    } finally { if (current === sequence.current) setLoading(false); }
  }, [enabled, request.kind, request.page, request.pageSize, request.scope, request.status]);
  useEffect(() => { void load(); return () => { ++sequence.current; }; }, [load]);
  return { items, summary, pagination, loading, error, refresh: load };
}
