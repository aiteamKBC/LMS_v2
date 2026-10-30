import { useCallback, useEffect, useRef, useState } from 'react';
import { listMigratedTemplates } from '@/api/migratedReviewTemplates';
import { fetchBooks } from '@/features/knowledge-base/api';
import { useLiveRefresh } from '@/hooks/useRefreshOnReturn';
import { fetchWeekTemplates } from '../week-builder/weekTemplateData';

// List metadata only: do not load template definitions, book contents or the
// standards endpoint (which embeds the entire KSB catalogue) for these previews.
const loadWeeks = (signal: AbortSignal) => fetchWeekTemplates({}, signal);
const loadReviews = (signal: AbortSignal) => listMigratedTemplates('', signal);
const loadBooks = () => fetchBooks();

export interface LibraryRead<T> {
  value: T | null;
  loading: boolean;
  failed: boolean;
  retry: () => void;
}

function useLibraryRead<T>(loader: (signal: AbortSignal) => Promise<T>): LibraryRead<T> {
  const [state, setState] = useState({ value: null as T | null, loading: true, failed: false });
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const reload = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState(previous => ({ ...previous, loading: true, failed: false }));
    void loader(controller.signal).then(value => {
      if (mounted.current && !controller.signal.aborted) setState({ value, loading: false, failed: false });
    }).catch(() => {
      if (mounted.current && !controller.signal.aborted) setState({ value: null, loading: false, failed: true });
    });
  }, [loader]);
  useEffect(() => {
    mounted.current = true;
    reload();
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, [reload]);
  useLiveRefresh(reload);
  return { ...state, retry: reload };
}

export function useLibraryPreviews() {
  const weeks = useLibraryRead(loadWeeks);
  const reviews = useLibraryRead(loadReviews);
  const books = useLibraryRead(loadBooks);
  return { weeks, reviews, books };
}
