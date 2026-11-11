import { useEffect, useRef, useState } from 'react';
import type { CurriculumProgramme, ProgrammeKsbStats } from '@/lib/curriculumApi';
import { fetchProgrammeKsbStatsBatch, PROGRAMME_KSB_STATS_BATCH_SIZE } from '@/api/programmeKsbStatsBatch';

/**
 * The KSB numbers a programme card shows, fetched per programme behind the list.
 *
 * They used to travel inside the list itself, and that is what made
 * `/curriculum/overview/`, `/curriculum/modules/` and `/curriculum/programmes/`
 * all take the same ~84s to answer on a cold cache: `ksbMapped` re-reads a
 * programme's whole authoring tree and the learner figures read its learners'
 * progress, so thirty programmes meant sixty extra reads before any of the three
 * could return — including for the Module Builder, which shows neither number.
 *
 * So the list answers first and the bars fill in. A card is readable without its
 * progress bar; it is not readable at all while the page is a skeleton.
 *
 * One request for all of them (split only past the server's cap). It used to be
 * one request per programme, but the curriculum client sends those one at a
 * time, so the last card waited for every card before it: ~60s in the browser
 * for eight cards whose numbers take ~8-11s to build. The server builds the
 * batch in one read scope and still caches each programme on its own, under the
 * key the single-programme endpoint uses.
 */
const REQUEST_TIMEOUT_MS = 120000;

export function useProgrammeKsbStats(
  programmes: Pick<CurriculumProgramme, 'id' | 'sourceId'>[],
  options: { visibility?: 'all' | 'operational'; enabled?: boolean } = {},
) {
  const { visibility, enabled = true } = options;
  const [stats, setStats] = useState<Record<string, ProgrammeKsbStats>>({});
  // Ids already requested in this mount, so a re-render with the same programmes
  // (or one more of them) does not re-fetch what is already on screen.
  const requestedRef = useRef<Set<string>>(new Set());

  const ids = programmes
    .map(programme => String(programme.sourceId || programme.id || '').trim())
    .filter(Boolean);
  // The dependency has to be the ids themselves, not the array identity: the
  // programmes array is rebuilt on every render of the page that owns it.
  const idKey = ids.join('|');

  useEffect(() => {
    if (!enabled) return undefined;
    const wanted = idKey.split('|').filter(id => id && !requestedRef.current.has(id));
    if (!wanted.length) return undefined;
    wanted.forEach(id => requestedRef.current.add(id));

    const controller = new AbortController();
    // A cold build against the remote database can be slow; keep a finite limit.
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let cancelled = false;
    const delivered = new Set<string>();

    const runBatch = async (batch: string[]): Promise<void> => {
      try {
        const result = await fetchProgrammeKsbStatsBatch(batch, controller.signal, { visibility });
        if (cancelled) return;
        const found: Record<string, ProgrammeKsbStats> = {};
        batch.forEach(id => {
          const value = result[id];
          if (value) found[id] = value;
          // Not found: keep the placeholder, and allow a retry on the next mount.
          else requestedRef.current.delete(id);
        });
        Object.keys(found).forEach(id => delivered.add(id));
        setStats(prev => ({ ...prev, ...found }));
      } catch {
        // A cancelled run already released its ids in the cleanup below, and a
        // newer run may have claimed them again since.
        if (cancelled) return;
        // The cards that cannot get their numbers keep the placeholder they
        // already show. Allowed to be retried on the next mount.
        batch.forEach(id => requestedRef.current.delete(id));
      }
    };

    const batches: string[][] = [];
    for (let index = 0; index < wanted.length; index += PROGRAMME_KSB_STATS_BATCH_SIZE) {
      batches.push(wanted.slice(index, index + PROGRAMME_KSB_STATS_BATCH_SIZE));
    }
    void Promise.all(batches.map(runBatch)).finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
      // Released now, not when the aborted request settles: the next run of
      // this effect (StrictMode's remount, or one more programme in the list)
      // happens first, and must ask again for what never arrived.
      wanted.forEach(id => { if (!delivered.has(id)) requestedRef.current.delete(id); });
    };
  }, [idKey, visibility, enabled]);

  return stats;
}

/** A programme row with its fetched KSB numbers merged in, when they have arrived. */
export function withProgrammeKsbStats<T extends Pick<CurriculumProgramme, 'id' | 'sourceId'>>(
  programme: T,
  stats: Record<string, ProgrammeKsbStats>,
): T {
  const found = stats[String(programme.sourceId || programme.id || '').trim()];
  if (!found) return programme;
  // Named field by field rather than spread: the response also carries
  // `programmeId`, which is not part of a programme row and must not be grafted
  // onto one. `ksbTotal` is deliberately absent here — the list builds it from
  // the programme's KSB profile without reading anything extra, so the row
  // already has it right.
  return {
    ...programme,
    ksbMapped: found.ksbMapped,
    learnerKsbProgressPercentage: found.learnerKsbProgressPercentage,
    learnerKsbConsumedWeight: found.learnerKsbConsumedWeight,
    learnerKsbExpectedWeight: found.learnerKsbExpectedWeight,
    learnerKsbLearnerCount: found.learnerKsbLearnerCount,
    learnerKsbCodesStarted: found.learnerKsbCodesStarted,
    learnerKsbCodesComplete: found.learnerKsbCodesComplete,
    learnerKsbCodesTotal: found.learnerKsbCodesTotal,
  };
}
