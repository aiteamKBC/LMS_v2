import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCurriculumProgrammes, type CurriculumProgramme } from '@/lib/curriculumApi';

function normaliseProgrammeName(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function programmeCompletenessScore(programme: CurriculumProgramme) {
  const deliveryScore = (programme.cohorts || 0) * 1000 + (programme.groups || 0) * 100 + (programme.modules || 0) * 10 + (programme.weeks || 0);
  const statusScore = programme.status === 'active' ? 3 : programme.status === 'planned' ? 2 : programme.status === 'draft' ? 1 : 0;
  return deliveryScore * 10 + statusScore;
}

function dedupeProgrammes(programmes: CurriculumProgramme[]) {
  const byName = new Map<string, CurriculumProgramme>();
  const orderedKeys: string[] = [];

  for (const programme of programmes) {
    const key = normaliseProgrammeName(programme.name) || String(programme.sourceId || programme.id);
    const current = byName.get(key);
    if (!current) {
      byName.set(key, programme);
      orderedKeys.push(key);
      continue;
    }
    if (programmeCompletenessScore(programme) > programmeCompletenessScore(current)) {
      byName.set(key, programme);
    }
  }

  return orderedKeys.map(key => byName.get(key)).filter(Boolean) as CurriculumProgramme[];
}

export function useCurriculumProgrammes() {
  const [programmes, setProgrammes] = useState<CurriculumProgramme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    try {
      const programmeResult = await fetchCurriculumProgrammes(signal);
      if (signal?.aborted || requestId !== requestIdRef.current) return [];
      setProgrammes(dedupeProgrammes(programmeResult));
      setError(null);
      return programmeResult;
    } catch (err) {
      if (signal?.aborted || requestId !== requestIdRef.current) return [];
      setError(err instanceof Error ? err.message : 'Unable to load curriculum programmes');
      return [];
    } finally {
      if (!signal?.aborted && requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { programmes, loading, error, reload: () => load() };
}
