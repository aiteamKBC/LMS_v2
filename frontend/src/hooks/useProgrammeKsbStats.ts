import { useEffect, useRef, useState } from 'react';
import { fetchProgrammeKsbStats, type CurriculumProgramme, type ProgrammeKsbStats } from '@/lib/curriculumApi';

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
 * One request per programme, a few at a time. Not one batched request: each
 * programme is cached separately on the server, so a slow one delays only its
 * own card, and a page that shows ten of thirty programmes pays for ten.
 */
const CONCURRENCY = 4;

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
    let cancelled = false;
    const queue = [...wanted];

    const runOne = async (): Promise<void> => {
      const id = queue.shift();
      if (!id) return;
      try {
        const result = await fetchProgrammeKsbStats(id, controller.signal, { visibility });
        if (!cancelled) setStats(prev => ({ ...prev, [id]: result }));
      } catch {
        // A card that cannot get its numbers keeps the placeholder it already
        // shows. Allowed to be retried on the next mount.
        requestedRef.current.delete(id);
      }
      if (!cancelled) await runOne();
    };

    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, runOne));
    return () => {
      cancelled = true;
      controller.abort();
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
