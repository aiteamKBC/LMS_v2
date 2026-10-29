import { useEffect, useState } from 'react';
import { suggestedMappings } from './componentSuggestions';
import { getTransferReview, type TransferMapping, type TransferReview } from '@/api/progressTransfer';

/**
 * The component matches a pending request needs before approval. Every
 * completed old component without an automatic match must be given one; the
 * service rejects an approval whose review token or matches are out of date.
 */
export function useTransferReview(requestId: string, pending: boolean) {
  const [review, setReview] = useState<TransferReview | null>(null);
  const [error, setError] = useState('');
  const [mappings, setMappings] = useState<TransferMapping[]>([]);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    setReview(null); setError(''); setMappings([]);
    if (!requestId || !pending) return;
    const controller = new AbortController();
    void getTransferReview(requestId, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setReview(value); setMappings(suggestedMappings(value)); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load component matches.'); });
    return () => controller.abort();
  }, [requestId, pending, reloads]);

  const unresolved = review?.modules.reduce((count, module) => count + module.sources.filter(source =>
    !source.automaticTargetId && !mappings.some(mapping => mapping.moduleId === module.moduleId && mapping.sourceActivityRef === source.sourceActivityRef)).length, 0) ?? 0;

  return { review, error, mappings, setMappings, unresolved, reload: () => setReloads(value => value + 1) };
}
