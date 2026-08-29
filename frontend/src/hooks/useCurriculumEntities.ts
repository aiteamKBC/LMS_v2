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
 * That refresh is not instant, so two things go with it: `refreshing` says a
 * background load is in flight (the list on screen is real but a beat behind),
 * and `applyLocal` lets a page drop the record the write just returned straight
 * into the collections. Without them a create looked like it had done nothing
 * until the refresh landed seconds later.
 *
 * `applyLocal` alone was not enough, because the reload behind it replaced the
 * collections wholesale. Any payload built before the write -- one answered by a
 * worker that had not seen it, or a request that raced the commit -- then erased
 * the record the user had just been told was saved. What a page applies locally
 * is therefore remembered here and folded back into every payload until the
 * server agrees; see reconcile().
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

/** The collections the overview owns, and the only ones a local write touches. */
type StructuralKey = 'programmes' | 'cohorts' | 'groups' | 'modules';

const STRUCTURAL_KEYS: StructuralKey[] = ['programmes', 'cohorts', 'groups', 'modules'];

/**
 * How many completed reloads a locally-applied record may survive without the
 * server echoing it back. A committed write converges well inside this; the
 * bound is only there so a record the server will never agree with -- someone
 * else editing the same row to different values -- cannot be pinned to the
 * screen indefinitely.
 */
const PENDING_MAX_RELOADS = 3;

interface IdentifiedRecord {
  id: string;
}

interface PendingUpsert {
  record: IdentifiedRecord;
  reloads: number;
}

interface PendingWrites {
  /** id -> the record a save wrote, held until a payload carries it. */
  upserts: Map<string, PendingUpsert>;
  /** id -> reloads seen, held until a payload stops carrying it. */
  removals: Map<string, number>;
}

type PendingMap = Record<StructuralKey, PendingWrites>;

function createPendingMap(): PendingMap {
  return {
    programmes: { upserts: new Map(), removals: new Map() },
    cohorts: { upserts: new Map(), removals: new Map() },
    groups: { upserts: new Map(), removals: new Map() },
    modules: { upserts: new Map(), removals: new Map() },
  };
}

/** Matches normaliseKey in pages/curriculum/shared/entities/model. */
const keyOf = (value: unknown): string => String(value ?? '').trim().toLowerCase();

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }
  return false;
}

/** The server's row already carries everything the local write put in it. */
function hasLanded(server: IdentifiedRecord, local: IdentifiedRecord): boolean {
  const serverFields = server as unknown as Record<string, unknown>;
  const localFields = local as unknown as Record<string, unknown>;
  return Object.keys(localFields).every(field => sameValue(serverFields[field], localFields[field]));
}

/**
 * Note what a local write changed, so a payload that has not caught up cannot
 * silently undo it.
 *
 * Only ever called from applyLocal. A reload replaces every object in the
 * collections, so diffing one of those would mark the entire page pending.
 */
function recordPending(previous: CurriculumEntities, next: CurriculumEntities, pending: PendingMap): void {
  for (const key of STRUCTURAL_KEYS) {
    const before = new Map(
      (previous[key] as IdentifiedRecord[]).map(row => [keyOf(row.id), row] as const),
    );
    const after = new Map(
      (next[key] as IdentifiedRecord[]).map(row => [keyOf(row.id), row] as const),
    );
    const bucket = pending[key];

    // Identity, not equality: upsertById leaves untouched rows as the same
    // objects, so anything that changed reference is what this write produced.
    for (const [id, row] of after) {
      if (!id || before.get(id) === row) continue;
      bucket.upserts.set(id, { record: row, reloads: 0 });
      bucket.removals.delete(id);
    }
    for (const id of before.keys()) {
      if (!id || after.has(id)) continue;
      bucket.removals.set(id, 0);
      bucket.upserts.delete(id);
    }
  }
}

/**
 * Fold the writes this page has already made into a payload that may predate
 * them.
 *
 * A create is appended until the payload carries its id, an edit is merged over
 * the server's row until that row agrees, and an archive keeps the row hidden
 * until the payload drops it. Each pending record is released as soon as the
 * server confirms it, so this is a bridge across the write/refresh gap rather
 * than a second copy of the data.
 */
function reconcile<T extends IdentifiedRecord>(serverRows: T[], pending: PendingWrites): T[] {
  if (!pending.upserts.size && !pending.removals.size) return serverRows;

  const serverById = new Map(serverRows.map(row => [keyOf(row.id), row] as const));
  let rows: T[] = serverRows;

  for (const [id, seen] of [...pending.removals]) {
    if (!serverById.has(id) || seen + 1 >= PENDING_MAX_RELOADS) pending.removals.delete(id);
    else pending.removals.set(id, seen + 1);
  }
  if (pending.removals.size) {
    rows = rows.filter(row => !pending.removals.has(keyOf(row.id)));
  }

  const appended: T[] = [];
  for (const [id, entry] of [...pending.upserts]) {
    const server = serverById.get(id);
    if (server && hasLanded(server, entry.record)) {
      pending.upserts.delete(id);
      continue;
    }
    if (!server) appended.push(entry.record as T);
    entry.reloads += 1;
    if (entry.reloads >= PENDING_MAX_RELOADS) pending.upserts.delete(id);
  }
  if (pending.upserts.size) {
    rows = rows.map(row => {
      const entry = pending.upserts.get(keyOf(row.id));
      return entry ? { ...row, ...entry.record } as T : row;
    });
  }

  return appended.length ? [...rows, ...appended] : rows;
}

export function useCurriculumEntities(options: CurriculumEntitiesOptions = {}) {
  const { includeStaff = false, includeHolidays = false, includeTeams = false } = options;
  const [entities, setEntities] = useState<CurriculumEntities>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  // Mirrors `entities` so applyLocal can diff against what is on screen without
  // running a side effect inside a state updater — StrictMode calls those twice.
  const entitiesRef = useRef<CurriculumEntities>(EMPTY);
  const pendingRef = useRef<PendingMap>(createPendingMap());

  const commit = useCallback((updater: (previous: CurriculumEntities) => CurriculumEntities) => {
    const next = updater(entitiesRef.current);
    entitiesRef.current = next;
    setEntities(next);
    return next;
  }, []);

  const load = useCallback(async (signal?: AbortSignal, loadOptions: LoadOptions = {}) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (loadOptions.silent) setRefreshing(true);
    else setLoading(true);
    try {
      // The additive collections do not depend on the overview, so they go out
      // alongside it instead of after it. The overview is the slow one — a
      // forced rebuild runs for tens of seconds against Neon — and awaiting it
      // first simply added their latency onto the end of it.
      //
      // They also keep the normal cache on a post-write reload. A structural
      // write cannot change the staff directory or the holiday list, and
      // fetchJson already drops these entries for the writes that can, so
      // skipCache here only bought four uncached round trips per save.
      const supplemental = Promise.all([
        includeStaff ? fetchCurriculumTutors(signal).catch(() => []) : Promise.resolve([]),
        includeStaff ? fetchCurriculumCoaches(signal).catch(() => []) : Promise.resolve([]),
        includeHolidays ? fetchCurriculumHolidays(signal).catch(() => []) : Promise.resolve([]),
        includeTeams ? fetchCurriculumTeamsMeetingSummaries(signal).catch(() => []) : Promise.resolve([]),
      ]);

      const overview = await fetchCurriculumOverview(signal, {
        compact: true,
        skipCache: loadOptions.skipCache,
      });
      if (signal?.aborted || requestId !== requestIdRef.current) return null;

      // Paint the structure first; the optional collections are additive and a
      // failure in any of them must not blank the page that already has its
      // programmes, cohorts, groups and modules.
      const pending = pendingRef.current;
      const base: CurriculumEntities = {
        ...EMPTY,
        programmes: reconcile(overview.programmes || [], pending.programmes),
        cohorts: reconcile(overview.cohorts || [], pending.cohorts),
        groups: reconcile(overview.groups || [], pending.groups),
        modules: reconcile(overview.modules || [], pending.modules),
      };
      commit(previous => ({
        ...base,
        tutors: previous.tutors,
        coaches: previous.coaches,
        holidays: previous.holidays,
        teamsMeetings: previous.teamsMeetings,
      }));
      setError(null);
      setLoading(false);
      setLoaded(true);
      // The structure has landed, so the table is already correct; the optional
      // collections below are additive and must not keep the bar running.
      setRefreshing(false);

      const [tutors, coaches, holidays, teamsMeetings] = await supplemental;
      if (signal?.aborted || requestId !== requestIdRef.current) return null;

      // Merged into whatever is current rather than into `base`: a save may have
      // applied a record locally while these were still in flight.
      return commit(previous => ({ ...previous, tutors, coaches, holidays, teamsMeetings }));
    } catch (err) {
      if (signal?.aborted || requestId !== requestIdRef.current) return null;
      setError(err instanceof Error ? err.message : 'Unable to load curriculum data.');
      return null;
    } finally {
      if (!signal?.aborted && requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [commit, includeHolidays, includeStaff, includeTeams]);

  /**
   * Write a record a save has already committed into the collections on screen,
   * ahead of the refresh that will replace them with the server's copy. Only
   * ever called with what an endpoint returned, so the row is real — it is early,
   * not invented, and the reload immediately behind it is the source of truth.
   *
   * What it changes is remembered until a payload comes back carrying it, so a
   * refresh that predates the write cannot undo it.
   */
  const applyLocal = useCallback(
    (updater: (previous: CurriculumEntities) => CurriculumEntities) => {
      const previous = entitiesRef.current;
      const next = updater(previous);
      recordPending(previous, next, pendingRef.current);
      entitiesRef.current = next;
      setEntities(next);
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return {
    ...entities,
    entities,
    loading,
    /** A background refresh is in flight behind a list that is already painted. */
    refreshing,
    applyLocal,
    /** True once a structure payload has landed — used to tell "empty" from "not here yet". */
    loaded,
    error,
    reload: (loadOptions?: LoadOptions) => load(undefined, { skipCache: true, ...loadOptions }),
  };
}
