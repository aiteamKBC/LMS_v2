import { useCallback, useEffect, useState } from 'react';
import { fetchCurriculumCoaches, fetchCurriculumTutors, type CurriculumStaffProfile } from '@/lib/curriculumApi';

type UseCurriculumStaffProfilesOptions = {
  autoLoad?: boolean;
};

export function useCurriculumStaffProfiles({ autoLoad = true }: UseCurriculumStaffProfilesOptions = {}) {
  const [tutors, setTutors] = useState<CurriculumStaffProfile[]>([]);
  const [coaches, setCoaches] = useState<CurriculumStaffProfile[]>([]);
  const [loading, setLoading] = useState(autoLoad);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((options: { silent?: boolean } = {}) => {
    const controller = new AbortController();
    let mounted = true;

    if (!options.silent) setLoading(true);
    Promise.all([
      fetchCurriculumTutors(controller.signal, { skipCache: true }),
      fetchCurriculumCoaches(controller.signal, { skipCache: true }),
    ])
      .then(([nextTutors, nextCoaches]) => {
        if (!mounted) return;
        setTutors(nextTutors);
        setCoaches(nextCoaches);
        setError(null);
      })
      .catch(err => {
        if (!mounted || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to load staff profiles');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!autoLoad) return;
    return load();
  }, [autoLoad, load]);

  return { tutors, coaches, loading, error, reload: load };
}
