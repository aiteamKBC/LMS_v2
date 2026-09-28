import { useCallback, useEffect, useRef, useState } from 'react';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachSessionKey, readCoachSessionCache, writeCoachSessionCache } from '@/features/coach/shared/coachSessionCache';
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
  const coach = useCoachIdentity();
  const cacheKey = coachSessionKey('marking', coach.email, request.scope, request.status, request.kind, request.page, request.pageSize);
  const initialCache = readCoachSessionCache<{ items: MarkingSubmission[]; summary: MarkingQueueSummary; pagination: MarkingQueuePagination }>(cacheKey);
  const [items, setItems] = useState<MarkingSubmission[]>(() => initialCache?.items || []);
  const [summary, setSummary] = useState(() => initialCache?.summary || EMPTY_MARKING_SUMMARY);
  const [pagination, setPagination] = useState(() => initialCache?.pagination || EMPTY_MARKING_PAGINATION);
  const [loading, setLoading] = useState(() => !initialCache);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    if (!enabled) return;
    const cached = readCoachSessionCache<{ items: MarkingSubmission[]; summary: MarkingQueueSummary; pagination: MarkingQueuePagination }>(cacheKey);
    if (cached) {
      setItems(cached.items); setSummary(cached.summary); setPagination(cached.pagination); setLoading(false);
    } else setLoading(true);
    setError('');
    try {
      const data = await fetchMarkingQueue(request);
      if (current !== sequence.current) return;
      const next = {
        items: data.items || [],
        summary: data.summary || EMPTY_MARKING_SUMMARY,
        pagination: data.pagination || EMPTY_MARKING_PAGINATION,
      };
      writeCoachSessionCache(cacheKey, next);
      setItems(next.items);
      setSummary(next.summary);
      setPagination(next.pagination);
    } catch (reason) {
      if (current !== sequence.current) return;
      if (cached) return;
      setItems([]);
      setError(reason instanceof Error ? reason.message : 'Unable to load the marking queue.');
    } finally { if (current === sequence.current) setLoading(false); }
  }, [cacheKey, enabled, request.kind, request.page, request.pageSize, request.scope, request.status]);
  useEffect(() => { void load(); return () => { ++sequence.current; }; }, [load]);
  return { items, summary, pagination, loading, error, refresh: load };
}
