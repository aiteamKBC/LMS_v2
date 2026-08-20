import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchCurriculumCoaches,
  fetchCurriculumHolidays,
  fetchCurriculumOverview,
  fetchCurriculumTeamsMeetingSummaries,
  fetchCurriculumTutors,
  type CurriculumCohort,
  type CurriculumGroup,
  type CurriculumHoliday,
  type CurriculumModule,
  type CurriculumProgramme,
  type CurriculumStaffProfile,
  type CurriculumTeamsMeetingSummary,
} from '@/lib/curriculumApi';

/**
 * The entity pages (Programmes / Cohorts / Groups / Modules) all read the same
 * four collections and derive their parent chains locally, so they share one
 * load instead of each inventing its own. The compact overview carries
 * programmes, cohorts, groups and modules in a single cached request; staff,
 * holidays and Teams state are opt-in because only some pages need them.
 *
 * This deliberately does NOT hold write logic: every page saves through the
 * canonical endpoints in `lib/curriculumApi` and then calls `reload({ silent })`.
 */
export interface CurriculumEntitiesOptions {
  includeStaff?: boolean;
  includeHolidays?: boolean;
  includeTeams?: boolean;
}

export interface CurriculumEntities {
  programmes: CurriculumProgramme[];
  cohorts: CurriculumCohort[];
  groups: CurriculumGroup[];
  modules: CurriculumModule[];
  tutors: CurriculumStaffProfile[];
  coaches: CurriculumStaffProfile[];
  holidays: CurriculumHoliday[];
  teamsMeetings: CurriculumTeamsMeetingSummary[];
}

const EMPTY: CurriculumEntities = {
  programmes: [],
  cohorts: [],
  groups: [],
  modules: [],
  tutors: [],
  coaches: [],
  holidays: [],
  teamsMeetings: [],
};

type LoadOptions = { silent?: boolean; skipCache?: boolean };

export function useCurriculumEntities(options: CurriculumEntitiesOptions = {}) {
  const { includeStaff = false, includeHolidays = false, includeTeams = false } = options;
  const [entities, setEntities] = useState<CurriculumEntities>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal, loadOptions: LoadOptions = {}) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!loadOptions.silent) setLoading(true);
    try {
      const overview = await fetchCurriculumOverview(signal, {
        compact: true,
        skipCache: loadOptions.skipCache,
      });
      if (signal?.aborted || requestId !== requestIdRef.current) return null;

      // Paint the structure first; the optional collections are additive and a
      // failure in any of them must not blank the page that already has its
      // programmes, cohorts, groups and modules.
      const base: CurriculumEntities = {
        ...EMPTY,
        programmes: overview.programmes || [],
        cohorts: overview.cohorts || [],
        groups: overview.groups || [],
        modules: overview.modules || [],
      };
      setEntities(previous => ({
        ...base,
        tutors: previous.tutors,
        coaches: previous.coaches,
        holidays: previous.holidays,
        teamsMeetings: previous.teamsMeetings,
      }));
      setError(null);
      setLoading(false);
      setLoaded(true);

      const [tutors, coaches, holidays, teamsMeetings] = await Promise.all([
        includeStaff ? fetchCurriculumTutors(signal, { skipCache: loadOptions.skipCache }).catch(() => []) : Promise.resolve([]),
        includeStaff ? fetchCurriculumCoaches(signal, { skipCache: loadOptions.skipCache }).catch(() => []) : Promise.resolve([]),
        includeHolidays ? fetchCurriculumHolidays(signal, { skipCache: loadOptions.skipCache }).catch(() => []) : Promise.resolve([]),
        includeTeams ? fetchCurriculumTeamsMeetingSummaries(signal, { skipCache: loadOptions.skipCache }).catch(() => []) : Promise.resolve([]),
      ]);
      if (signal?.aborted || requestId !== requestIdRef.current) return null;

      const next: CurriculumEntities = { ...base, tutors, coaches, holidays, teamsMeetings };
      setEntities(next);
      return next;
    } catch (err) {
      if (signal?.aborted || requestId !== requestIdRef.current) return null;
      setError(err instanceof Error ? err.message : 'Unable to load curriculum data.');
      return null;
    } finally {
      if (!signal?.aborted && requestId === requestIdRef.current) setLoading(false);
    }
  }, [includeHolidays, includeStaff, includeTeams]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return {
    ...entities,
    entities,
    loading,
    /** True once a structure payload has landed — used to tell "empty" from "not here yet". */
    loaded,
    error,
    reload: (loadOptions?: LoadOptions) => load(undefined, { skipCache: true, ...loadOptions }),
  };
}
