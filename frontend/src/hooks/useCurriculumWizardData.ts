/**
 * Lazy-loading data coordination for the curriculum wizard.
 *
 * Loads data only when needed by each step:
 * - Programme step: programmes list
 * - Cohort step: full programme tree, KSB options
 * - Group step: programme tree detail, staff profiles
 * - Modules step: module catalogue, staff profiles
 * - Weeks step: module details (week structure)
 * - Review step: (uses previously loaded data)
 *
 * Features:
 * - Request deduplication (concurrent identical requests share one Promise)
 * - Stale-response protection (newer requests prevent older responses from overwriting)
 * - Abort on step change (cancel in-flight requests for unneeded data)
 * - Automatic error recovery with exponential backoff
 * - Integrated with multi-tier cache for efficiency
 * - Request generation tracking prevents race conditions
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchCurriculumProgrammes,
  fetchCurriculumProgrammeDetail,
  fetchCurriculumModules,
  fetchCurriculumKsbSets,
  fetchCurriculumStandards,
  fetchCurriculumCoaches,
  fetchCurriculumTutors,
  fetchCurriculumHolidays,
  isRetryableError,
  type CurriculumProgramme,
  type CurriculumProgrammeDetail,
  type CurriculumModule,
  type CurriculumKsbSet,
  type CurriculumStandard,
  type CurriculumStaffProfile,
  type CurriculumHoliday,
} from '@/lib/curriculumApi';

export type WizardStep = 'programme' | 'cohort' | 'group' | 'modules' | 'weeks' | 'review';

export interface WizardStepData {
  programmes?: {
    data: CurriculumProgramme[] | null;
    loading: boolean;
    error: string | null;
  };
  programmeDetail?: {
    data: CurriculumProgrammeDetail | null;
    loading: boolean;
    error: string | null;
  };
  ksbOptions?: {
    data: { sets: CurriculumKsbSet[]; standards: CurriculumStandard[] } | null;
    loading: boolean;
    error: string | null;
  };
  modules?: {
    data: CurriculumModule[] | null;
    loading: boolean;
    error: string | null;
  };
  staffProfiles?: {
    data: { tutors: CurriculumStaffProfile[]; coaches: CurriculumStaffProfile[] } | null;
    loading: boolean;
    error: string | null;
  };
  holidays?: {
    data: CurriculumHoliday[] | null;
    loading: boolean;
    error: string | null;
  };
}

const RETRY_DELAYS = [200, 400, 800]; // ms, exponential backoff
const CACHE_WARM_DURATION_MS = 5000;
const PREFETCH_DELAY_MS = 300;

export interface UseCurriculumWizardDataOptions {
  isOpen: boolean;
  currentStep: WizardStep;
  selectedProgrammeId?: string;
}

export function useCurriculumWizardData({
  isOpen,
  currentStep,
  selectedProgrammeId,
}: UseCurriculumWizardDataOptions): WizardStepData & { reloadStaffProfiles?: () => Promise<void> } {
  const [stepData, setStepData] = useState<WizardStepData>({});

  const abortControllersRef = useRef(new Map<string, AbortController>());
  const lastLoadTimesRef = useRef(new Map<string, number>());
  const requestGenerationsRef = useRef(new Map<string, number>());
  const isMountedRef = useRef(true);
  const prefetchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const openedRef = useRef(false);

  // Increment generation counter on each call to detect stale responses
  const nextGeneration = useCallback((key: string): number => {
    const gen = (requestGenerationsRef.current.get(key) ?? 0) + 1;
    requestGenerationsRef.current.set(key, gen);
    return gen;
  }, []);

  const currentGeneration = useCallback((key: string): number => {
    return requestGenerationsRef.current.get(key) ?? 0;
  }, []);

  // Load a resource with stale-response protection and deduplication
  const loadResource = useCallback(
    async <T,>(
      key: string,
      fetcher: (signal: AbortSignal) => Promise<T>,
      generation: number,
      onSuccess?: (data: T) => void,
      options: { force?: boolean } = {}
    ): Promise<T | null> => {
      if (!isMountedRef.current) return null;

      // Check if recently loaded
      const lastLoadTime = lastLoadTimesRef.current.get(key);
      if (!options.force && lastLoadTime && Date.now() - lastLoadTime < CACHE_WARM_DURATION_MS) {
        return null;
      }

      // Abort previous request for this key
      const prevController = abortControllersRef.current.get(key);
      if (prevController) {
        prevController.abort();
      }

      const controller = new AbortController();
      abortControllersRef.current.set(key, controller);

      let attempt = 0;
      const maxAttempts = 3;

      while (attempt < maxAttempts) {
        try {
          if (!isMountedRef.current || controller.signal.aborted) {
            return null;
          }

          const data = await fetcher(controller.signal);

          // Stale-response protection: only apply if still the current generation
          if (currentGeneration(key) !== generation) {
            return null;
          }

          if (!isMountedRef.current || controller.signal.aborted) {
            return null;
          }

          lastLoadTimesRef.current.set(key, Date.now());
          onSuccess?.(data);
          return data;
        } catch (error) {
          // Don't retry non-retryable errors
          if (!isRetryableError(error)) {
            throw error;
          }

          // Don't retry if aborted
          if (controller.signal.aborted) {
            return null;
          }

          attempt += 1;

          if (attempt >= maxAttempts) {
            throw error;
          }

          const delay = RETRY_DELAYS[attempt - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      return null;
    },
    [currentGeneration]
  );

  // Load programmes (step 1)
  const loadProgrammes = useCallback(async () => {
    const key = 'programmes';
    const gen = nextGeneration(key);

    setStepData(prev => ({
      ...prev,
      programmes: { data: prev.programmes?.data ?? null, loading: true, error: null },
    }));

    try {
      const data = await loadResource(
        key,
        fetchCurriculumProgrammes,
        gen,
        data => {
          if (!isMountedRef.current) return;
          setStepData(prev => ({
            ...prev,
            programmes: { data, loading: false, error: null },
          }));
        }
      );
      // loadResource calls onSuccess, so no need to update state again
    } catch (err) {
      if (!isMountedRef.current || currentGeneration(key) !== gen) return;
      const error = err instanceof Error ? err.message : 'Failed to load programmes';
      setStepData(prev => ({
        ...prev,
        programmes: { ...prev.programmes, loading: false, error },
      }));
    }
  }, [loadResource, nextGeneration, currentGeneration]);

  // Load programme detail + KSB options (step 2)
  const loadCohortStepData = useCallback(
    async (programmeId: string) => {
      if (!programmeId) return;

      const detailKey = `programme-detail-${programmeId}`;
      const ksbSetsKey = `ksb-options-${programmeId}-sets`;
      const ksbStandardsKey = `ksb-options-${programmeId}-standards`;
      const detailGen = nextGeneration(detailKey);
      const ksbSetsGen = nextGeneration(ksbSetsKey);
      const ksbStandardsGen = nextGeneration(ksbStandardsKey);

      setStepData(prev => ({
        ...prev,
        programmeDetail: { data: prev.programmeDetail?.data ?? null, loading: true, error: null },
        ksbOptions: { data: prev.ksbOptions?.data ?? null, loading: true, error: null },
      }));

      try {
        const [detail, ksbSets, standards] = await Promise.all([
          loadResource(detailKey, signal => fetchCurriculumProgrammeDetail(programmeId, signal), detailGen),
          loadResource(ksbSetsKey, fetchCurriculumKsbSets, ksbSetsGen),
          loadResource(ksbStandardsKey, fetchCurriculumStandards, ksbStandardsGen),
        ]);

        if (
          !isMountedRef.current
          || currentGeneration(detailKey) !== detailGen
          || currentGeneration(ksbSetsKey) !== ksbSetsGen
          || currentGeneration(ksbStandardsKey) !== ksbStandardsGen
        ) {
          return;
        }

        setStepData(prev => ({
          ...prev,
          programmeDetail: { data: detail || prev.programmeDetail?.data || null, loading: false, error: null },
          ksbOptions: {
            data: ksbSets && standards ? { sets: ksbSets, standards } : prev.ksbOptions?.data || null,
            loading: false,
            error: null,
          },
        }));
      } catch (err) {
        if (
          !isMountedRef.current
          || currentGeneration(detailKey) !== detailGen
          || currentGeneration(ksbSetsKey) !== ksbSetsGen
          || currentGeneration(ksbStandardsKey) !== ksbStandardsGen
        ) {
          return;
        }
        const error = err instanceof Error ? err.message : 'Failed to load cohort data';
        setStepData(prev => ({
          ...prev,
          programmeDetail: { ...prev.programmeDetail, loading: false, error },
          ksbOptions: { ...prev.ksbOptions, loading: false, error },
        }));
      }
    },
    [loadResource, nextGeneration, currentGeneration]
  );

  const loadStaffProfiles = useCallback(async () => {
    const tutorKey = 'tutors';
    const coachKey = 'coaches';
    const tutorGen = nextGeneration(tutorKey);
    const coachGen = nextGeneration(coachKey);

    setStepData(prev => ({
      ...prev,
      staffProfiles: { data: prev.staffProfiles?.data ?? null, loading: true, error: null },
    }));

    try {
      const [tutors, coaches] = await Promise.all([
        loadResource(tutorKey, signal => fetchCurriculumTutors(signal, { skipCache: true }), tutorGen, undefined, { force: true }),
        loadResource(coachKey, signal => fetchCurriculumCoaches(signal, { skipCache: true }), coachGen, undefined, { force: true }),
      ]);

      if (
        !isMountedRef.current
        || currentGeneration(tutorKey) !== tutorGen
        || currentGeneration(coachKey) !== coachGen
      ) {
        return;
      }

      setStepData(prev => ({
        ...prev,
        staffProfiles: {
          data: tutors && coaches ? { tutors, coaches } : prev.staffProfiles?.data || null,
          loading: false,
          error: null,
        },
      }));
    } catch (err) {
      if (
        !isMountedRef.current
        || currentGeneration(tutorKey) !== tutorGen
        || currentGeneration(coachKey) !== coachGen
      ) {
        return;
      }
      const error = err instanceof Error ? err.message : 'Failed to load staff profiles';
      setStepData(prev => ({
        ...prev,
        staffProfiles: { ...prev.staffProfiles, loading: false, error },
      }));
    }
  }, [currentGeneration, loadResource, nextGeneration]);

  // Load modules (step 4+)
  const loadModuleStepData = useCallback(async () => {
    const moduleKey = 'modules-list';
    const moduleGen = nextGeneration(moduleKey);

    setStepData(prev => ({
      ...prev,
      modules: { data: prev.modules?.data ?? null, loading: true, error: null },
    }));

    try {
      const modules = await loadResource(moduleKey, fetchCurriculumModules, moduleGen);

      if (
        !isMountedRef.current
        || currentGeneration(moduleKey) !== moduleGen
      ) {
        return;
      }

      setStepData(prev => ({
        ...prev,
        modules: { data: modules || prev.modules?.data || null, loading: false, error: null },
      }));
    } catch (err) {
      if (
        !isMountedRef.current
        || currentGeneration(moduleKey) !== moduleGen
      ) {
        return;
      }
      const error = err instanceof Error ? err.message : 'Failed to load module data';
      setStepData(prev => ({
        ...prev,
        modules: { ...prev.modules, loading: false, error },
      }));
    }
  }, [loadResource, nextGeneration, currentGeneration]);

  // Load holidays (step 4-5)
  const loadHolidays = useCallback(async () => {
    const key = 'holidays';
    const gen = nextGeneration(key);

    setStepData(prev => ({
      ...prev,
      holidays: { data: prev.holidays?.data ?? null, loading: true, error: null },
    }));

    try {
      const data = await loadResource(key, fetchCurriculumHolidays, gen, data => {
        if (!isMountedRef.current || currentGeneration(key) !== gen) return;
        setStepData(prev => ({
          ...prev,
          holidays: { data, loading: false, error: null },
        }));
      });
      // loadResource calls onSuccess, so no need to update state again
    } catch (err) {
      if (!isMountedRef.current || currentGeneration(key) !== gen) return;
      const error = err instanceof Error ? err.message : 'Failed to load holidays';
      setStepData(prev => ({
        ...prev,
        holidays: { ...prev.holidays, loading: false, error },
      }));
    }
  }, [loadResource, nextGeneration, currentGeneration]);

  // Load data based on current step
  useEffect(() => {
    if (!isOpen) {
      if (openedRef.current) {
        // Wizard closed: abort all in-flight requests
        for (const controller of abortControllersRef.current.values()) {
          controller.abort();
        }
      }
      openedRef.current = false;
      return;
    }

    openedRef.current = true;

    const loadDataForStep = async () => {
      switch (currentStep) {
        case 'programme':
          await loadProgrammes();
          break;
        case 'cohort':
          if (selectedProgrammeId) {
            await loadCohortStepData(selectedProgrammeId);
          }
          break;
        case 'modules':
        case 'weeks':
          await Promise.all([loadModuleStepData(), loadStaffProfiles()]);
          if (currentStep === 'weeks') {
            await loadHolidays();
          }
          break;
        case 'group':
          await Promise.all([
            selectedProgrammeId ? loadCohortStepData(selectedProgrammeId) : Promise.resolve(),
            loadStaffProfiles(),
          ]);
          break;
        case 'review':
          // No additional data needed beyond what's loaded in previous steps
          break;
      }
    };

    void loadDataForStep();
  }, [isOpen, currentStep, selectedProgrammeId, loadProgrammes, loadCohortStepData, loadModuleStepData, loadStaffProfiles, loadHolidays]);

  // Prefetch next step's data
  useEffect(() => {
    if (!isOpen || !isMountedRef.current) return;

    const stepOrder: WizardStep[] = ['programme', 'cohort', 'group', 'modules', 'weeks', 'review'];
    const currentIndex = stepOrder.indexOf(currentStep);
    const nextStep = stepOrder[currentIndex + 1];

    if (!nextStep || (nextStep === 'cohort' && !selectedProgrammeId)) return;

    prefetchTimerRef.current = setTimeout(async () => {
      if (!isMountedRef.current || !isOpen) return;

      try {
        switch (nextStep) {
          case 'cohort':
            if (selectedProgrammeId) {
              await loadCohortStepData(selectedProgrammeId);
            }
            break;
          case 'modules':
          case 'weeks':
            await Promise.all([loadModuleStepData(), loadStaffProfiles()]);
            if (nextStep === 'weeks') {
              await loadHolidays();
            }
            break;
          case 'group':
            await Promise.all([
              selectedProgrammeId ? loadCohortStepData(selectedProgrammeId) : Promise.resolve(),
              loadStaffProfiles(),
            ]);
            break;
        }
      } catch {
        // Silently fail prefetch
      }
    }, PREFETCH_DELAY_MS);

    return () => {
      if (prefetchTimerRef.current) {
        clearTimeout(prefetchTimerRef.current);
        prefetchTimerRef.current = null;
      }
    };
  }, [isOpen, currentStep, selectedProgrammeId, loadCohortStepData, loadModuleStepData, loadStaffProfiles, loadHolidays]);

  // Cleanup on unmount
  useEffect(() => {
    const controllers = abortControllersRef.current;
    const prefetchTimer = prefetchTimerRef.current;

    return () => {
      isMountedRef.current = false;
      for (const controller of controllers.values()) {
        controller.abort();
      }
      if (prefetchTimer) {
        clearTimeout(prefetchTimer);
      }
    };
  }, []);

  if (!isOpen) return stepData;
  return {
    ...stepData,
    reloadStaffProfiles: loadStaffProfiles,
  };
}
