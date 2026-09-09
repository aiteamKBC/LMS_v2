import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { getSummary, startReview } from './api';

export function useRecordSummary(aptemId?: number, initialize = false) {
  const { auth } = useAuth();
  const client = useQueryClient();
  const key = ['old-otjh', auth.account?.id, 'summary', aptemId ?? 'me'];
  const query = useQuery({ queryKey: key, queryFn: () => getSummary(aptemId), refetchInterval: 15000 });
  const start = useMutation({ mutationFn: () => startReview(aptemId), onSuccess: data => client.setQueryData(key, data) });
  const { mutate, isPending, isError } = start;
  const needsStart = initialize && auth.account?.access !== 'record-monitor' && !query.data?.read_only
    && query.data?.needs_start && (query.data.total_months ?? 0) > 0;
  useEffect(() => {
    if (needsStart && !isPending && !isError) mutate();
  }, [needsStart, isPending, isError, mutate]);
  return { ...query, error: query.error || start.error, starting: isPending,
    retryStart: () => { start.reset(); void query.refetch(); } };
}
