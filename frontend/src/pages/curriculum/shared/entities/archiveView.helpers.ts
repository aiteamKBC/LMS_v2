// ============================================================================
// The archive view, shared by the Cohorts and Groups pages.
//
// Archiving a cohort or a group has always been a soft delete: the row keeps
// its place in the database and only leaves the active list. Nothing in the app
// read that state back, so from the user's side "Archive" was a delete with no
// undo and no way to finish it either. This is the other side of it — the same
// toggle, the same banner and the same load-on-open behaviour on both pages, so
// the archive is one idea rather than two implementations that drift.
//
// What differs between the two pages is only the table: an archived cohort and
// an archived group carry different columns. That stays with each page, next to
// the live table it mirrors. The confirms live in `archive.ts` alongside the
// ones that put a record into the archive in the first place.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';


/**
 * Load an archive list, but only once somebody asks to see it.
 *
 * The archive is a place to go and clear out old records, not something every
 * visit to the Cohorts page needs, so nothing is fetched until `enabled` turns
 * on. `reload` is what every restore and delete calls afterwards: the list has
 * to lose the row that was just dealt with, and the reads behind it deliberately
 * bypass the client cache for exactly that reason.
 */
export function useCurriculumArchive<T>(
  load: (signal?: AbortSignal) => Promise<T[]>,
  enabled: boolean,
) {
  const [records, setRecords] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Held in a ref so a caller can pass an inline function without the effect
  // below re-running on every render of the page.
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const rows = await loadRef.current(signal);
      if (signal?.aborted) return;
      setRecords(rows);
      setError(null);
      setLoaded(true);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : 'Unable to read the archive.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    void run(controller.signal);
    return () => controller.abort();
  }, [enabled, run]);

  const reload = useCallback(() => run(), [run]);

  return { records, loading, loaded, error, reload };
}
