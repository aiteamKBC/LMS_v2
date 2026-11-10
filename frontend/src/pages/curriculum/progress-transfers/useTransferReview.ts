import { useEffect, useState } from 'react';
import { suggestedMappings } from './componentSuggestions';
import { getTransferReview, type TransferMapping, type TransferReview } from '@/api/progressTransfer';

/**
 * The component matches a pending request needs before approval. Every
 * completed old component without an automatic match must be given one; the
 * service rejects an approval whose review token or matches are out of date.
 */
export function useTransferReview(requestId: string, pending: boolean) {
  const [reloads, setReloads] = useState(0);
  const readKey = `${requestId}:${pending}:${reloads}`;
  const [result, setResult] = useState<{ key: string; review: TransferReview | null; error: string; mappings: TransferMapping[] }>({ key: '', review: null, error: '', mappings: [] });
  // A changed request or explicit reload invalidates the previous response
  // immediately, including the render before the next effect runs.
  const review = result.key === readKey ? result.review : null;
  const error = result.key === readKey ? result.error : '';
  const mappings = result.key === readKey ? result.mappings : [];

  useEffect(() => {
    setResult({ key: readKey, review: null, error: '', mappings: [] });
    if (!requestId || !pending) return;
    const controller = new AbortController();
    void getTransferReview(requestId, controller.signal)
      .then(value => {
        if (controller.signal.aborted) return;
        if (!value.reviewToken || !Array.isArray(value.modules)) throw new Error('Component matches could not be verified. Reload matching before confirming.');
        setResult({ key: readKey, review: value, error: '', mappings: suggestedMappings(value) });
      })
      .catch(reason => { if (!controller.signal.aborted) setResult({ key: readKey, review: null, error: reason instanceof Error ? reason.message : 'Could not load component matches.', mappings: [] }); });
    return () => controller.abort();
  }, [requestId, pending, readKey]);

  const unresolved = review?.modules.reduce((count, module) => count + module.sources.filter(source =>
    !source.automaticTargetId && !mappings.some(mapping => mapping.moduleId === module.moduleId && mapping.sourceActivityRef === source.sourceActivityRef)).length, 0) ?? 0;

  return { review, error, mappings,
    setMappings: (next: TransferMapping[]) => setResult(current => current.key === readKey ? { ...current, mappings: next } : current),
    unresolved, reload: () => setReloads(value => value + 1) };
}
