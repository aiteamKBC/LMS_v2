import { useCallback, useEffect, useRef, useState } from 'react';
import { approveTransferRequest, getTransferRequests, type AdminTransfers, type TransferDecisions } from '@/api/progressTransfer';

/** Read every offset before filtering locally; request IDs remain the identity. */
export function useTransferRequests() {
  const [data, setData] = useState<AdminTransfers | null>(null);
  const [reading, setReading] = useState<'refresh' | 'more' | null>('refresh');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const current = useRef<AdminTransfers | null>(null);
  const mounted = useRef(false);
  const reader = useRef<AbortController | null>(null);
  const readingRef = useRef(false);
  const savingRef = useRef(false);

  const update = useCallback((next: AdminTransfers) => {
    current.current = next;
    setData(next);
  }, []);

  const read = useCallback(async (offset: number, append = false) => {
    reader.current?.abort();
    const controller = new AbortController();
    reader.current = controller;
    readingRef.current = true;
    setReading(append ? 'more' : 'refresh');
    setError('');
    try {
      const requests = new Map((append ? current.current?.requests ?? [] : []).map(row => [row.requestId, row]));
      const visited = new Set<number>();
      let cursor: number | null = offset;
      while (cursor !== null) {
        if (!Number.isSafeInteger(cursor) || cursor < 0 || visited.has(cursor)) {
          throw new Error('The remaining requests could not be verified. Refresh to try again.');
        }
        visited.add(cursor);
        const next: AdminTransfers = await getTransferRequests(cursor, controller.signal);
        if (controller.signal.aborted || !mounted.current) return;
        if (!Array.isArray(next.requests) || !(next.nextOffset === null || (Number.isSafeInteger(next.nextOffset) && next.nextOffset > cursor))) {
          throw new Error('The transfer request list could not be verified.');
        }
        next.requests.forEach(row => requests.set(row.requestId, row));
        // Keep the previous complete list during refresh until its replacement
        // is complete. Initial/continued reads can expose their progress.
        if (!current.current || append || current.current.nextOffset !== null || next.nextOffset === null) {
          update({ ...next, requests: [...requests.values()] });
        }
        cursor = next.nextOffset;
      }
      setNeedsRefresh(false);
    } catch (reason) {
      if (!controller.signal.aborted && mounted.current) {
        setNeedsRefresh(true);
        setError(reason instanceof Error ? reason.message : 'Could not load transfer requests.');
      }
    } finally {
      if (!controller.signal.aborted && mounted.current) {
        readingRef.current = false;
        setReading(null);
      }
    }
  }, [update]);

  useEffect(() => {
    mounted.current = true;
    void read(0);
    return () => { mounted.current = false; reader.current?.abort(); };
  }, [read]);

  const refresh = () => {
    if (!readingRef.current && !savingRef.current) void read(0);
  };
  const more = () => {
    const offset = current.current?.nextOffset;
    if (offset != null && !readingRef.current && !savingRef.current) void read(offset, true);
  };

  /** `decisions` and `reviewCsrfToken` come from the component-matching review the admin confirmed. */
  async function approve(requestId: string, decisions: TransferDecisions, reviewCsrfToken = '') {
    const snapshot = current.current;
    const request = snapshot?.requests.find(row => row.requestId === requestId);
    if (!request || request.status !== 'pending' || !snapshot || readingRef.current || savingRef.current || needsRefresh) return false;
    if (!snapshot.csrfToken) { setSaveError('Refresh requests before approving this transfer.'); return false; }
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    setNotice('');
    try {
      const result = await approveTransferRequest(requestId, reviewCsrfToken || snapshot.csrfToken, decisions);
      if (!mounted.current) return false;
      if (result.requestId !== requestId || result.status !== 'approved' || !Array.isArray(result.modules)) {
        setNeedsRefresh(true);
        setSaveError('The service did not confirm this request. Refresh requests before trying again.');
        await read(0);
        return false;
      }
      // The POST is authoritative even if the following list refresh fails.
      // Keep its saved modules/hours, rather than rewriting them from the card.
      const latest = current.current!;
      update({ ...latest, requests: latest.requests.map(row => row.requestId === requestId ? { ...row, ...result } : row) });
      setNeedsRefresh(true);
      setNotice('Transfer approved. The learner can now open the new modules. Progress merged successfully. Completed matches from the old LMS and existing completions in the new LMS now count together, once per component. The old percentage and recorded hours are retained in the transfer record.');
      // Approval changes the service's pending-first order: restart pagination.
      await read(0);
      return true;
    } catch (reason) {
      if (mounted.current) setSaveError(reason instanceof Error ? reason.message : 'Could not approve this request. Please try again.');
      return false;
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return { data, reading, saving, error, saveError, notice, needsRefresh, refresh, more, approve, clearSaveError: () => setSaveError('') };
}
