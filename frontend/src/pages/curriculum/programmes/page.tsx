import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { LearnerDirectoryProvider } from '../shared/entities/AssignedLearners';
import { LearnerStatusCounts } from '../shared/entities/LearnerStatusCounts';
import { type CSSProperties, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { CardGridSkeleton } from '@/components/feature/Skeletons';
import { ProgrammeFormDrawer } from '@/pages/curriculum/shared/entities/forms';
import { CurriculumStructureWizard, type StructureWizardCreated, type StructureWizardRecordStep } from '@/pages/curriculum/shared/entities/structureWizard';
import { formatProgrammeLevel, sortEntities, visibleNotes, PROGRAMME_SORT_OPTIONS } from '@/pages/curriculum/shared/entities/model';
import { SelectMenu } from '@/components/feature/SelectField';
import { showCurriculumAlert, showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import { useProgrammeKsbStats, withProgrammeKsbStats } from '@/hooks/useProgrammeKsbStats';
import { curriculumNavItems } from '@/mocks/navigation';
import { formatHoursMinutes } from '@/lib/format';
import {
  CurriculumApiError,
  curriculumErrorMessage,
  deleteCurriculumProgramme,
  fetchCurriculumModules,
  fetchCurriculumProgrammeKsbCoverage,
  fetchCurriculumProgrammeLearnerKsbSummary,
  fetchCurriculumStandards,
  saveCurriculumProgrammeOrder,
  updateCurriculumModule,
  updateCurriculumProgramme,
  type CurriculumKsbCoverageItem,
  type CurriculumLearnerKsbConsumption,
  type CurriculumProgrammeLearnerKsbImpactResponse,
  type CurriculumProgrammeLearnerKsbSummaryResponse,
  type CurriculumKsbEntry,
  type CurriculumKsbDefinition,
  type CurriculumKsbTraceMapping,
  type CurriculumModule,
  type CurriculumProgramme,
  type CurriculumProgrammeDependencyError,
  type CurriculumProgrammeDependencyReport,
  type CurriculumStandard,
} from '@/lib/curriculumApi';

type ProgrammeAppliedKsbSource = {
  value: string;
  kind: 'standard' | 'none';
  title: string;
  subtitle: string;
  detail: string;
  /**
   * KSB codes the source holds. A new programme is given an empty profile of its
   * own, so "applied" no longer means "ready": an empty source has nothing for a
   * module to map against, which is the same dead end as no source at all.
   */
  ksbCount: number;
  /**
   * The underlying standard row, only set when kind is 'standard'. Carries the
   * funding-body facts (compliance hours, max funding, LARS code) that a KSB
   * profile has no equivalent for.
   */
  standard?: CurriculumStandard;
};
type ProgrammeKsbSourceReview = {
  programme: CurriculumProgramme;
  source: ProgrammeAppliedKsbSource;
  standard?: CurriculumStandard;
  loading?: boolean;
  error?: string;
};
type ProgrammeKsbSourceItem = {
  id: string;
  code: string;
  title: string;
  description: string;
  type: string;
  family: 'knowledge' | 'skills' | 'behaviours';
  parentCode?: string;
};
type LearnerKsbAchievement = {
  code: string;
  count: number;
  // Achieved weight, from the Component Progress snapshot only. A reflection's
  // own KSB declaration for the same activity lands in `declaredWeight` and is
  // never added here — see backend curriculum_api ksbAchievementPolicy.
  weight: number;
  declaredWeight: number;
  actualOtjh: number | null;
  actualOtjhSource: string;
  plannedOtjh: number | null;
  plannedOtjhSource: string;
  activities: string[];
  reflections: string[];
};

/** How many "set it now" shortcuts the notice offers before it stops listing. */
const MISSING_KSB_SOURCE_SHORTCUTS = 3;

const PROGRAMMES_PER_PAGE = 6;

/** Tabs the programme workspace owns; mirrors its `?tab=` values. */
type ProgrammeDetailTab = 'overview' | 'design' | 'delivery' | 'coverage' | 'quality';
type ProgrammeDetailView = 'sessions' | 'mapping' | 'achievement';

function showProgrammeSwalToast(title: string, text: string, icon: 'success' | 'error' | 'info' = 'success') {
  return showCurriculumAlert({
    title,
    text,
    icon,
    timer: icon === 'error' ? undefined : 1800,
    confirmButtonText: icon === 'error' ? 'Close' : 'Done',
  });
}

/**
 * Report a failed save from one of the inline editor rows.
 *
 * A tutor assignment can be refused because the person is already teaching
 * elsewhere at that hour; the backend's sentence names the module and date, so
 * it is shown as-is rather than reduced to "could not be saved".
 */
const DEPENDENCY_LABELS: Record<string, string> = {
  cohorts: 'cohorts',
  groups: 'groups',
  modules: 'modules',
  weeks: 'weeks',
  components: 'components',
  ksb_mappings: 'KSB mappings',
  live_sessions: 'live sessions',
  module_details: 'module details',
  module_completion_criteria: 'completion criteria',
  week_templates: 'week templates',
  quizzes: 'quizzes',
  free_programme_components: 'free-course components',
  learners: 'learners',
};

function isProgrammeDeleteRefusal(error: unknown): error is CurriculumApiError & { data: CurriculumProgrammeDependencyError } {
  return (
    error instanceof CurriculumApiError
    && error.status === 409
    && Boolean(error.data)
    && typeof error.data === 'object'
    && typeof (error.data as CurriculumProgrammeDependencyError).reason === 'string'
  );
}

/**
 * A programme the API cannot find. The list is built from a payload the server
 * caches, so a programme deleted elsewhere - another tab, the guided setup, a
 * second worker - can still have a card here after its row has gone. Its buttons
 * then answered 404 and the card stayed put, with no way to clear it short of a
 * browser reload. A 404 is the answer to "remove this", so it is treated as one.
 */
function isMissingProgrammeError(error: unknown): boolean {
  return error instanceof CurriculumApiError && error.status === 404;
}

function isProgrammeDependencyError(error: unknown): error is CurriculumApiError & { data: CurriculumProgrammeDependencyError } {
  return isProgrammeDeleteRefusal(error) && error.data.reason === 'programme-has-dependencies';
}

function programmeDependencySummary(report?: CurriculumProgrammeDependencyReport) {
  const counts = report?.counts || {};
  const parts = Object.entries(counts)
    .filter(([, value]) => Number(value) > 0)
    .map(([key, value]) => `${value} ${DEPENDENCY_LABELS[key] || key.replace(/_/g, ' ')}`);
  return parts.length ? parts.join(', ') : 'linked curriculum data';
}

function programmeStatus(programme: CurriculumProgramme) {
  return String(programme.status || 'active').trim().toLowerCase();
}

function programmeIsDraft(programme: CurriculumProgramme) {
  return programmeStatus(programme) === 'draft';
}

/**
 * The id every list of programmes is keyed by. `sourceId` is what the server
 * writes the order against, so the drag ids and the saved order cannot drift.
 */
function programmeKey(programme: CurriculumProgramme) {
  return String(programme.sourceId || programme.id);
}

/** Which way a card is being sent, in the grid the reader is looking at. */
type ArrangeDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Take the card at `from` out and put it back at `to`, everything between it
 * closing up behind it. This is the whole of what an arrow does.
 */
function moveInList<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Where an arrow sends a card, or null when that arrow has nowhere to go.
 *
 * Left and right are one place along the list. Up and down are a whole row, so
 * they need the column count the grid is actually rendering at -- at one column
 * a "row" is a single card and up/down read the same as left/right, which is
 * exactly right on a phone. Down out of the second-to-last row lands at the end
 * when the last row is short, rather than off the end of the list.
 */
function arrangeTarget(from: number, total: number, columns: number, direction: ArrangeDirection): number | null {
  const lastRowStart = Math.floor((total - 1) / columns) * columns;
  if (direction === 'left') return from > 0 ? from - 1 : null;
  if (direction === 'right') return from < total - 1 ? from + 1 : null;
  if (direction === 'up') return from >= columns ? from - columns : null;
  return from < lastRowStart ? Math.min(from + columns, total - 1) : null;
}

const ARRANGE_ARROWS: Array<{ direction: ArrangeDirection; icon: string; word: string; position: string }> = [
  { direction: 'up', icon: 'ri-arrow-up-line', word: 'up a row', position: 'col-start-2 row-start-1' },
  { direction: 'left', icon: 'ri-arrow-left-line', word: 'left', position: 'col-start-1 row-start-2' },
  { direction: 'right', icon: 'ri-arrow-right-line', word: 'right', position: 'col-start-3 row-start-2' },
  { direction: 'down', icon: 'ri-arrow-down-line', word: 'down a row', position: 'col-start-2 row-start-3' },
];

/**
 * The four arrows, laid out as the compass they describe, over the card they
 * move. Each one says where it sends this programme rather than naming its own
 * icon, because "right" on its own is not the action -- moving this card is.
 *
 * `data-arrange-key` is how the page puts focus back on the same arrow after the
 * grid has re-laid itself out, so a card can be walked several places without
 * reaching for the mouse between each one.
 */
function ArrangeArrows({ id, name, position, total, columns, onMove }: {
  id: string;
  name: string;
  position: number;
  total: number;
  columns: number;
  onMove: (id: string, direction: ArrangeDirection) => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-foreground-950/45 backdrop-blur-[1px]">
      <div className="rounded-2xl border border-white/30 bg-white/95 p-2.5 shadow-xl">
        <p className="mb-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-foreground-500">
          Move &middot; {position + 1} of {total}
        </p>
        <div className="grid grid-cols-3 grid-rows-3 gap-1">
          {ARRANGE_ARROWS.map(arrow => {
            const target = arrangeTarget(position, total, columns, arrow.direction);
            return (
              <button
                key={arrow.direction}
                type="button"
                data-arrange-key={`${id}:${arrow.direction}`}
                disabled={target === null}
                title={target === null ? `${name} cannot move ${arrow.word}` : `Move ${name} ${arrow.word}`}
                aria-label={`Move ${name} ${arrow.word}`}
                onClick={event => { event.stopPropagation(); onMove(id, arrow.direction); }}
                className={`flex h-9 w-9 items-center justify-center rounded-lg border text-base transition-smooth ${arrow.position} ${
                  target === null
                    ? 'cursor-not-allowed border-background-200 bg-background-100 text-foreground-300'
                    : 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400'
                }`}
              >
                <AppIcon className={arrow.icon}></AppIcon>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * How many cards the grid is fitting on a row right now. The grid is
 * `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`, so the arrows have to read the
 * same breakpoints, or "up" would move a card somewhere other than the row above
 * the one the reader is looking at.
 */
function useProgrammeGridColumns() {
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const wide = window.matchMedia('(min-width: 1280px)');
    const medium = window.matchMedia('(min-width: 768px)');
    const read = () => setColumns(wide.matches ? 3 : medium.matches ? 2 : 1);
    read();
    wide.addEventListener('change', read);
    medium.addEventListener('change', read);
    return () => {
      wide.removeEventListener('change', read);
      medium.removeEventListener('change', read);
    };
  }, []);
  return columns;
}

function programmeIsArchived(programme: CurriculumProgramme) {
  if (typeof programme.isArchived === 'boolean') return programme.isArchived;
  return programmeStatus(programme) === 'archived';
}

export default function CurriculumProgrammes() {
  return <LearnerDirectoryProvider><CurriculumProgrammesContent /></LearnerDirectoryProvider>;
}

function CurriculumProgrammesContent() {
  const navigate = useNavigate();
  // What the grid is showing lives in the URL, the same way the Cohorts and
  // Groups pages carry their scope. Opening a programme and coming back is now
  // the ordinary loop rather than a dead end, and local state made that loop
  // lossy: the reader returned to page 1 of an unfiltered active list every
  // time, having to retype the search and re-find the row they had just left.
  // It also makes a filtered view something that can be linked to.
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  // Which order the grid is in. Empty is the order the endpoint returned, which
  // is what the page has always shown.
  const [sort, setSort] = useState('');
  // Hand-picked card order. Off by default: the grid is read far more often than
  // it is arranged, and in this mode a card is a thing to move rather than a
  // thing to open.
  const [reordering, setReordering] = useState(false);
  // The order as it is on screen right now, ahead of the server confirming it.
  // Kept here rather than in the loaded programmes so a failed save can put the
  // cards back exactly where they were.
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [programmePage, setProgrammePage] = useState(() => Math.max(1, Math.floor(Number(searchParams.get('page'))) || 1));
  const [programmeDrawerOpen, setProgrammeDrawerOpen] = useState(false);
  const [programmeDrawerTarget, setProgrammeDrawerTarget] = useState<CurriculumProgramme | null>(null);
  // A just-created programme goes to Delivery as soon as its required KSB
  // source is applied, so its first cohort can be established before modules.
  const [newProgrammeDeliveryTarget, setNewProgrammeDeliveryTarget] = useState<CurriculumProgramme | null>(null);
  // Direct actions from Curriculum Home open the one canonical programme form
  // immediately instead of making the person find the same button on this page.
  useEffect(() => {
    if (searchParams.get('create') !== 'programme') return;
    setProgrammeDrawerTarget(null);
    setProgrammeDrawerOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('create');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  // The guided run. Two ways in, one wizard: the hero button starts at the
  // programme form, for a programme being stood up from nothing; clicking a card
  // starts at the cohort step with that programme already chosen, because the
  // programme it names exists and what it is missing is the structure beneath it.
  const [wizardRun, setWizardRun] = useState<{ from: StructureWizardRecordStep; programmeId?: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingProgrammeId, setDeletingProgrammeId] = useState<string | null>(null);
  const [reviewProgramme, setReviewProgramme] = useState<CurriculumProgramme | null>(null);
  const [applyProgramme, setApplyProgramme] = useState<CurriculumProgramme | null>(null);
  const [applyingKsbSource, setApplyingKsbSource] = useState(false);
  const [reviewItems, setReviewItems] = useState<CurriculumKsbCoverageItem[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [learnerImpactProgramme, setLearnerImpactProgramme] = useState<CurriculumProgramme | null>(null);
  const [learnerImpact, setLearnerImpact] = useState<CurriculumProgrammeLearnerKsbSummaryResponse | null>(null);
  const [learnerImpactLoading, setLearnerImpactLoading] = useState(false);
  const [learnerImpactError, setLearnerImpactError] = useState<string | null>(null);
  const [sourceReview, setSourceReview] = useState<ProgrammeKsbSourceReview | null>(null);
  const reviewRequest = useRef(0);
  const [standards, setStandards] = useState<CurriculumStandard[]>([]);
  const [ksbSourcesLoading, setKsbSourcesLoading] = useState(true);
  const [ksbSourcesError, setKsbSourcesError] = useState<string | null>(null);
  const [programmeSourceOverrides, setProgrammeSourceOverrides] = useState<Map<string, string>>(new Map());
  // revalidate on this page: it *is* the list of programmes, so arriving on it
  // must show what exists now. The 30s collection cache is there to spare other
  // pages a rebuild, and reading it here meant a programme created elsewhere —
  // another tab, the structure wizard, a programme's own page — was missing until
  // the entry aged out or the browser was reloaded by hand.
  //
  // `revalidate` rather than `skipCache` keeps that guarantee — the request still
  // goes to the network every mount, so anything written elsewhere is visible —
  // without sending Cache-Control: no-cache, which made the backend rebuild the
  // payload from Neon and cost this one request ~14s on arrival. Reading back our
  // own writes still works: every curriculum write calls
  // invalidate_curriculum_cache() server-side, so the reload has nothing stale to
  // hit. The explicit skipCache on the reload calls below is left as belt and
  // braces for the multi-worker case, where invalidation needs a shared cache.
  // Only the operational list. Archived programmes are read on the Curriculum
  // archive page, which is the one place they are shown now, so asking for them
  // here would only be a payload nothing renders.
  const { programmes: listedProgrammes, loading, error, reload, removeProgramme, markProgrammeArchived, upsertProgramme } = useCurriculumProgrammes({ visibility: 'operational', revalidate: true });
  // The cards' KSB numbers arrive after the cards do. They are the most
  // expensive thing on this screen by a wide margin -- one read of the whole
  // authoring tree per programme -- and they used to be computed inside the list
  // payload, which is shared with /curriculum/overview/ and /curriculum/modules/
  // and so held up the Module Builder too. See useProgrammeKsbStats.
  const programmeKsbStats = useProgrammeKsbStats(listedProgrammes, { visibility: 'operational' });
  const programmes = useMemo(
    () => listedProgrammes.map(programme => withProgrammeKsbStats(programme, programmeKsbStats)),
    [listedProgrammes, programmeKsbStats],
  );
  // The learner-count chips reload when their refresh key changes. Keyed on the
  // row the server sent, not the merged one above: each arriving KSB stat makes
  // a new merged object, and keying on that re-fetched every card's counts once
  // more per stat, queueing those reads behind the stats on the same pool.
  const listedProgrammeById = useMemo(
    () => new Map(listedProgrammes.map(programme => [programme.id, programme])),
    [listedProgrammes],
  );
  const ksbDescriptions = useMemo(() => buildProgrammeKsbDescriptionLookup(standards), [standards]);

  const loadKsbSources = useCallback(async (signal?: AbortSignal) => {
    setKsbSourcesLoading(true);
    setKsbSourcesError(null);
    // KSBs come from the apprenticeship standards only: curriculum keeps no KSB
    // profiles any more, so there is no second source to load.
    try {
      const nextStandards = await fetchCurriculumStandards(signal);
      if (signal?.aborted) return;
      setStandards(nextStandards);
    } catch (reason) {
      if (signal?.aborted) return;
      setKsbSourcesError(reason instanceof Error ? reason.message : 'Unable to load KSB sources.');
      console.warn('Unable to load KSB standards for programme review.', reason);
    }
    setKsbSourcesLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadKsbSources(controller.signal);
    return () => controller.abort();
  }, [loadKsbSources]);

  const visibleProgrammes = useMemo(
    () => programmes.filter(programme => !programmeIsArchived(programme)),
    [programmes],
  );
  // What the server sent is already the saved order. The override only sits in
  // front of it between a drop and the reload that confirms it.
  const orderedProgrammes = useMemo(() => {
    if (!orderOverride) return visibleProgrammes;
    const rank = new Map(orderOverride.map((id, index) => [id, index]));
    return [...visibleProgrammes].sort(
      (a, b) => (rank.get(programmeKey(a)) ?? Number.MAX_SAFE_INTEGER) - (rank.get(programmeKey(b)) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [visibleProgrammes, orderOverride]);
  const filtered = sortEntities(
    orderedProgrammes.filter(p => {
      const needle = search.toLowerCase();
      if (needle && !p.name.toLowerCase().includes(needle)) return false;
      return true;
    }),
    PROGRAMME_SORT_OPTIONS,
    sort,
  );
  const totalProgrammePages = Math.max(1, Math.ceil(filtered.length / PROGRAMMES_PER_PAGE));
  const paginatedProgrammes = filtered.slice(
    (programmePage - 1) * PROGRAMMES_PER_PAGE,
    programmePage * PROGRAMMES_PER_PAGE,
  );
  // Arranging happens on the whole list at once. A page of six cannot be dragged
  // past its own edge, so paging is lifted for as long as the mode is on.
  const displayedProgrammes = reordering ? filtered : paginatedProgrammes;
  // A search or a chosen sort is showing a subset, or an order this page did not
  // pick. Saving from either would renumber programmes the reader cannot see, so
  // the mode is only offered on the full list in its saved order.
  const canReorder = !search.trim() && !sort;
  const gridColumns = useProgrammeGridColumns();
  // The arrow that was just pressed, so focus can follow the card it moved.
  const arrangeFocus = useRef<string | null>(null);

  const moveProgramme = useCallback((id: string, direction: ArrangeDirection) => {
    const before = filtered.map(programmeKey);
    const from = before.indexOf(id);
    if (from < 0) return;
    const to = arrangeTarget(from, before.length, gridColumns, direction);
    if (to === null) return;
    const next = moveInList(before, from, to);
    setOrderOverride(next);
    setOrderError(null);
    setSavingOrder(true);
    arrangeFocus.current = `${id}:${direction}`;
    // The card moves now and the save follows. If it fails the cards go back
    // where they were, because a card left somewhere the server never accepted
    // is the one outcome worse than not moving it.
    saveCurriculumProgrammeOrder(next)
      .then(() => setSavingOrder(false))
      .catch((err: unknown) => {
        setOrderOverride(before);
        setSavingOrder(false);
        setOrderError(err instanceof Error ? err.message : 'Could not save the new order.');
      });
  }, [filtered, gridColumns]);

  // The moved card is re-rendered in its new place, which drops the focus that
  // was on the arrow. Put it back on the same arrow of the same card, so the
  // same key press keeps sending it the same way.
  useEffect(() => {
    const key = arrangeFocus.current;
    if (!key) return;
    arrangeFocus.current = null;
    const button = document.querySelector<HTMLButtonElement>(`[data-arrange-key="${key}"]`);
    if (button && !button.disabled) button.focus();
  }, [orderOverride]);

  // Leaving the mode by searching or sorting, rather than by the button, would
  // otherwise leave a drag surface over a list it cannot save.
  useEffect(() => {
    if (!canReorder) setReordering(false);
  }, [canReorder]);

  // Changing what is listed sends the reader back to the first page - but only
  // when they change it. On the first render these are the values restored from
  // the URL, and resetting there would throw away the page that was just
  // restored alongside them.
  const gridFiltersMounted = useRef(false);
  useEffect(() => {
    if (!gridFiltersMounted.current) {
      gridFiltersMounted.current = true;
      return;
    }
    setProgrammePage(1);
  }, [search, sort]);

  useEffect(() => {
    // Not while the programmes are still in flight: `filtered` is empty until
    // they land, so totalProgrammePages is 1 and a restored ?page= would be
    // clamped away before the rows it points at exist.
    if (loading) return;
    setProgrammePage(currentPage => Math.min(currentPage, totalProgrammePages));
  }, [loading, totalProgrammePages]);

  // One writer for the whole grid state, so the three values cannot fight over
  // the query string. Defaults are omitted rather than spelled out, leaving a
  // clean /curriculum/programmes for the unfiltered first page.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const carry = (key: string, value: string) => {
      if (value) next.set(key, value);
      else next.delete(key);
    };
    carry('q', search.trim());
    carry('page', programmePage > 1 ? String(programmePage) : '');
    if (next.toString() === searchParams.toString()) return;
    setSearchParams(next, { replace: true });
  }, [search, programmePage, searchParams, setSearchParams]);

  const totalProgrammes = visibleProgrammes.length;
  const totalLearners = visibleProgrammes.reduce((a, b) => a + (b.learners || 0), 0);
  const totalCohorts = visibleProgrammes.reduce((a, b) => a + (b.cohorts || 0), 0);
  const totalModules = visibleProgrammes.reduce((a, b) => a + (b.modules || 0), 0);
  const totalWeeks = visibleProgrammes.reduce((a, b) => a + (b.weeks || 0), 0);
  const programmeKsbSources = useMemo(() => {
    const lookup = new Map<string, ProgrammeAppliedKsbSource>();
    visibleProgrammes.forEach(programme => {
      const key = programme.sourceId || programme.id;
      const override = programmeSourceOverrides.get(key);
      const effectiveProgramme = override === undefined ? programme : { ...programme, ksbProfileSourceId: override };
      lookup.set(key, resolveProgrammeAppliedKsbSource(effectiveProgramme, standards));
    });
    return lookup;
  }, [programmeSourceOverrides, standards, visibleProgrammes]);
  const programmesWithKsb = visibleProgrammes.filter(programme => (
    Boolean(programmeKsbSources.get(programme.sourceId || programme.id)?.value) && programme.ksbTotal > 0
  ));
  const averageKsbCoverage = programmesWithKsb.length
    ? Math.round(programmesWithKsb.reduce((sum, programme) => sum + ((programme.ksbMapped / programme.ksbTotal) * 100), 0) / programmesWithKsb.length)
    : 0;
  // Learner-consumed KSB progress across every visible programme. Weighted by
  // achieved/expected weight rather than averaging percentages, so a programme
  // with 40 learners is not given the same say as one with 1.
  const learnerKsbTotals = visibleProgrammes.reduce(
    (totals, programme) => ({
      consumed: totals.consumed + (programme.learnerKsbConsumedWeight || 0),
      expected: totals.expected + (programme.learnerKsbExpectedWeight || 0),
    }),
    { consumed: 0, expected: 0 },
  );
  const averageLearnerKsbProgress = learnerKsbTotals.expected > 0
    ? Math.min(100, Math.round((learnerKsbTotals.consumed / learnerKsbTotals.expected) * 100))
    : 0;
  const pageSubtitle = `${totalProgrammes} programmes - ${totalCohorts} cohorts - ${totalModules} modules - ${totalLearners} learners`;
  const heroSummary = <><strong>{totalProgrammes} programmes</strong> - {totalCohorts} cohorts - {totalModules} modules</>;

  // Programmes nothing can be mapped against yet. A KSB source is not decoration
  // on a programme: its modules map to that source's codes, its coverage is
  // measured against them, and learner progress rolls up through them. The gap
  // otherwise shows itself much later as an empty KSB mapping page, so it is
  // reported here where programmes are made.
  //
  // Two states, one problem. A programme created without a source is one; a
  // programme holding the empty profile it was created with is the other, and
  // an empty source maps exactly as much as no source does.
  const programmesMissingKsbSource = useMemo(
    () => filtered
      .map(programme => ({ programme, source: programmeKsbSources.get(programme.sourceId || programme.id) }))
      .filter(entry => !entry.source?.value || entry.source.ksbCount < 1),
    [filtered, programmeKsbSources],
  );
  const programmesWithEmptyKsbSource = programmesMissingKsbSource.filter(entry => Boolean(entry.source?.value));

  // Programmes are also created from other places — the structure wizard, a
  // programme's own page, a second tab — and this page has no way to hear about
  // those. That re-read now lives in useCurriculumProgrammes, so every list of
  // programmes gets it, and it asks with `revalidate` rather than `skipCache`:
  // a forced overview rebuild on every tab switch cost seconds for rows the
  // server already had current.

  const refreshProgrammeCards = async () => {
    const [nextStandards] = await Promise.all([
      fetchCurriculumStandards().catch(() => standards),
      // Silent: the drawer has already closed on a successful save, so the cards
      // stay on screen with the previous data instead of collapsing to skeletons
      // while the (slow) uncached programme request comes back.
      reload({ skipCache: true, silent: true }),
    ]);
    setStandards(nextStandards);
  };

  // The programme's own home: /curriculum/programmes/:id, where its cohorts,
  // groups, modules, sessions, KSB coverage and learner achievement are each
  // owned by a tab. This page never re-draws those views; it links into them.
  //
  // `tab` deep-links straight to the one the reader asked for, so the figures on
  // the card are the navigation - a Cohorts count opens Delivery, a Modules
  // count opens Modules - instead of landing everyone on Overview to hunt for
  // the same number twice.
  const openProgramme = (programme: CurriculumProgramme, tab?: ProgrammeDetailTab, view?: ProgrammeDetailView) => {
    const programmeId = programme.sourceId || programme.id;
    const params = new URLSearchParams();
    if (tab && tab !== 'overview') params.set('tab', tab);
    if (view) params.set('view', view);
    const query = params.toString();
    navigate(`/curriculum/programmes/${encodeURIComponent(programmeId)}${query ? `?${query}` : ''}`);
  };

  // Editing programme-level details is a focused form. Structure edits live on
  // the Cohorts / Groups / Module Builder pages and in the programme workspace,
  // each through the one form that record type has.
  const openEdit = (programme: CurriculumProgramme) => {
    setActionError(null);
    setProgrammeDrawerTarget(programme);
    setProgrammeDrawerOpen(true);
  };

  // Archiving is as far as this page goes. It is reversible and removes nothing,
  // so it belongs on the card next to the programme it acts on. Restoring one
  // and deleting one for good are the archive's own two actions and live on the
  // Curriculum archive page, next to the record they would act on there.
  const archiveProgramme = async (programme: CurriculumProgramme) => {
    const programmeId = programme.sourceId || programme.id;
    setActionError(null);
    let outcome: 'archived' | null = null;
    let alreadyGone = false;
    let dependencyReport: CurriculumProgrammeDependencyReport | null = null;
    await showCurriculumConfirm({
      title: 'Archive programme?',
      text: `Archive "${programme.name}"? It leaves the active list but keeps every cohort, group and module, and can be deleted for good from the archive afterwards.`,
      icon: 'warning',
      confirmButtonText: 'Archive',
      cancelButtonText: 'Cancel',
      onConfirm: async () => {
        setDeletingProgrammeId(programmeId);
        try {
          const result = await deleteCurriculumProgramme(programmeId);
          outcome = result.deleted ? 'archived' : null;
          // Flips the row to archived, which this grid filters out - so the card
          // leaves the list and the cached payload still knows where it went.
          markProgrammeArchived(programmeId);
        } catch (err) {
          if (isProgrammeDependencyError(err)) {
            dependencyReport = err.data.dependencyReport || null;
            return;
          }
          if (isMissingProgrammeError(err)) {
            alreadyGone = true;
            removeProgramme(programmeId);
            return;
          }
          setActionError(err instanceof Error ? err.message : 'Unable to archive programme.');
          throw err;
        } finally {
          setDeletingProgrammeId(null);
        }
      },
    });
    // outcome stays null when the user cancels or the request failed.
    if (dependencyReport) {
      await showCurriculumConfirm({
        title: 'Clean up programme first',
        text: `${programme.name} is linked to ${programmeDependencySummary(dependencyReport)}. Remove the linked modules, groups and cohorts before deleting the programme.`,
        icon: 'info',
        confirmButtonText: 'Open its cohorts',
        cancelButtonText: 'Cancel',
        onConfirm: () => {
          navigate(`/curriculum/cohorts?programme=${encodeURIComponent(programmeId)}`);
        },
      });
    } else if (alreadyGone) {
      await showProgrammeSwalToast(
        'Programme already gone',
        `${programme.name} is no longer in the database, so its card has been taken off the list.`,
      );
      await refreshProgrammeCards();
    } else if (outcome === 'archived') {
      await showProgrammeSwalToast(
        'Programme archived',
        `${programme.name} moved to the archive. Restore it or delete it permanently from Curriculum > Archive.`,
      );
    }
  };

  const openProgrammeKsbReview = async (programme: CurriculumProgramme) => {
    const request = ++reviewRequest.current;
    const programmeId = programme.sourceId || programme.id;
    setReviewProgramme(programme);
    setReviewItems([]);
    setReviewError(null);
    setReviewLoading(true);
    try {
      // Descriptions come from the standards (see ksbDescriptions); the
      // curriculum database keeps no KSB profiles to read them from.
      const coverage = await fetchCurriculumProgrammeKsbCoverage(programmeId, { view: 'items' });
      if (request !== reviewRequest.current) return;
      setReviewItems((coverage.items || []).filter(isReadableAppliedKsbCoverageItem));
    } catch (err) {
      if (request !== reviewRequest.current) return;
      setReviewError(err instanceof Error ? err.message : 'Unable to load programme KSB coverage.');
    } finally {
      if (request === reviewRequest.current) setReviewLoading(false);
    }
  };

  const openProgrammeLearnerImpact = async (programme: CurriculumProgramme) => {
    const programmeId = programme.sourceId || programme.id;
    setLearnerImpactProgramme(programme);
    setLearnerImpact(null);
    setLearnerImpactError(null);
    setLearnerImpactLoading(true);
    try {
      const data = await fetchCurriculumProgrammeLearnerKsbSummary(programmeId, { learnerStatus: 'all' });
      setLearnerImpact(data);
    } catch (err) {
      setLearnerImpactError(err instanceof Error ? err.message : 'Unable to load programme learners.');
    } finally {
      setLearnerImpactLoading(false);
    }
  };

  // A programme takes its KSBs from an apprenticeship standard: the curriculum
  // database keeps no KSB profiles, so `standard:<id>` is the only source.
  const applyProgrammeKsbSource = async (programme: CurriculumProgramme, sourceValue: string) => {
    const [, id] = sourceValue.split(':');
    const programmeId = programme.sourceId || programme.id;
    if (!programmeId || !id) return;
    setApplyingKsbSource(true);
    try {
      // Compact is safe: the KSB source cascade below reads only name/colour/notes
      // plus identity fields.
      const modulesForCascade = await fetchCurriculumModules(undefined, { compact: true });
      const standard = standards.find(item => item.id === id);
      if (!standard) throw new Error('Selected standard could not be found.');
      await updateCurriculumProgramme(programmeId, {
        name: programme.name,
        standard: standard.name,
        level: standard.levelValue || standard.level,
        color: programme.color,
        description: programme.description,
        structureType: programme.structureType,
        ksbProfileSourceId: `standard:${standard.id}`,
      });
      setProgrammeSourceOverrides(previous => new Map(previous).set(programmeId, `standard:${standard.id}`));
      await cascadeKsbSourceToProgrammeModules(programme, modulesForCascade, `standard:${standard.id}`);
      // Refresh in parallel and silently: the source override is already applied
      // optimistically above, so the cards should not collapse to skeletons while
      // the uncached programme/tree requests come back.
      const refreshAfterApply = Promise.all([
        reload({ skipCache: true, silent: true }),
        fetchCurriculumStandards().then(setStandards),
      ]).catch(error => {
        // The source is already persisted. A slow cache refresh must not hold
        // the user in the picker or turn a successful save into an error.
        console.warn('Unable to refresh curriculum caches after applying a KSB source.', error);
      });
      const shouldOpenDelivery = Boolean(
        newProgrammeDeliveryTarget
        && normalise(newProgrammeDeliveryTarget.sourceId || newProgrammeDeliveryTarget.id) === normalise(programmeId),
      );
      const appliedToast = showProgrammeSwalToast('KSB Source applied', `${programme.name} will now use the selected standard for coverage.`, 'success');
      setApplyProgramme(null);
      if (shouldOpenDelivery) {
        setNewProgrammeDeliveryTarget(null);
        navigate(`/curriculum/programmes/${encodeURIComponent(programmeId)}?tab=cohorts`);
      }
      await Promise.all([refreshAfterApply, appliedToast]);
    } catch (err) {
      await showProgrammeSwalToast('Unable to apply KSB Source', err instanceof Error ? err.message : 'The programme KSB Source could not be saved.', 'error');
    } finally {
      setApplyingKsbSource(false);
    }
  };

  const unapplyProgrammeKsbSource = async (programme: CurriculumProgramme, source: ProgrammeAppliedKsbSource) => {
    const programmeId = programme.sourceId || programme.id;
    if (!programmeId || !source.value) return;
    const confirmed = await showCurriculumConfirm({
      title: 'Unapply KSB Source?',
      text: `${programme.name} will no longer be measured against ${source.title}. Existing component KSB mappings will not be deleted.`,
      icon: 'warning',
      confirmButtonText: 'Unapply source',
      cancelButtonText: 'Keep source',
      successTitle: 'KSB Source unapplied',
      successText: `${programme.name} no longer has applied KSB Source.`,
      onConfirm: async () => {
        setApplyingKsbSource(true);
        try {
          await updateCurriculumProgramme(programmeId, {
            ksbProfileSourceId: '',
          });
        } catch (err) {
          throw err instanceof Error ? err : new Error('Unable to unapply KSB Source.');
        } finally {
          setApplyingKsbSource(false);
        }
      },
    });
    if (!confirmed) return;
    setProgrammeSourceOverrides(previous => new Map(previous).set(programmeId, ''));
    setApplyProgramme(null);
    setSourceReview(null);
    void (async () => {
      const [nextStandards] = await Promise.all([
        fetchCurriculumStandards().catch(() => standards),
        reload({ silent: true }),
      ]);
      setStandards(nextStandards);
    })().catch(err => console.warn('Unable to refresh KSB Source state after unapply.', err));
  };

  // A new programme has no KSB source, and cannot be mapped or measured without
  // one. So the create hands it straight to the picker rather than leaving the
  // reader to notice the gap on the card later. An edit passes nothing and
  // changes nothing.
  const handleProgrammeSaved = async (result?: { programme: CurriculumProgramme }) => {
    // On the list before the rebuild comes back: the card is the confirmation
    // that the programme exists, and waiting for a multi-table refresh to prove
    // it reads as a save that did not happen.
    if (result?.programme) upsertProgramme(result.programme);
    if (result?.programme) {
      setNewProgrammeDeliveryTarget(result.programme);
      setApplyProgramme(result.programme);
    }
    await refreshProgrammeCards();
  };

  const openAppliedKsbSourceReview = async (programme: CurriculumProgramme, source: ProgrammeAppliedKsbSource) => {
    if (!source.value) {
      setApplyProgramme(programme);
      return;
    }
    const [kind, id] = source.value.split(':');
    if (kind === 'standard') {
      const standard = standards.find(item => normalise(item.id) === normalise(id));
      if (standard) {
        setSourceReview({ programme, source, standard });
        return;
      }
    }
    void showProgrammeSwalToast('KSB Source not found', 'The selected standard could not be loaded yet. Try refreshing the page.', 'error');
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Programmes" pageSubtitle={pageSubtitle} userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="programmes-page min-h-full bg-background-50 p-4 sm:p-5 lg:p-6 space-y-4">
        <section className="curriculum-department-hero overflow-hidden rounded-2xl border border-white/10 bg-primary-950 text-white shadow-xl">
          <div className="curriculum-programme-hero-body relative p-5 sm:p-7">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.18),transparent_34%),linear-gradient(135deg,rgba(109,40,217,0.35),rgba(15,23,42,0))]" />
            <div className="curriculum-programme-hero-content relative z-10 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <span className="curriculum-programme-hero-icon flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30 backdrop-blur-sm">
                <AppIcon className="ri-stack-line text-2xl text-white" />
              </span>
              <div className="curriculum-programme-hero-copy max-w-3xl">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/60">Curriculum Studio</p>
                <h2 className="mt-2 text-2xl font-heading font-bold text-white sm:text-3xl">Programme planning workspace</h2>
                <p className="mt-2 max-w-2xl text-[13px] leading-6 text-white/75">
                  Build programme structures, manage cohorts and groups, and keep module delivery plans connected to live LMS records.
                </p>
                <p className="mt-2 text-[12px] font-semibold text-white/70">{loading ? <LoadingSkeleton label="Loading live LMS programmes..." variant="text" /> : heroSummary}</p>
                <p className="mt-1 max-w-2xl text-[11px] leading-5 text-white/60">
                  The module count includes only modules linked to a programme. Unassigned catalogue modules are managed in Module Builder.
                </p>
              </div>
              <div className="curriculum-programme-hero-actions flex flex-col gap-2 sm:flex-row sm:items-center">
                {/* A programme is independently saveable: this creates one from
                    programme-level details alone. Its cohorts, groups and modules
                    are then added from their own pages, each through the one form
                    that record type has. */}
                <button
                  type="button"
                  onClick={() => { setProgrammeDrawerTarget(null); setProgrammeDrawerOpen(true); }}
                  className="primary-action inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 text-[12px] font-bold text-primary-900 shadow-lg shadow-black/10 transition-smooth hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
                >
                  <AppIcon className="ri-add-line text-base"></AppIcon>
                  Add Programme
                </button>
                {/* The other way in: the same four forms, chained, so a new
                    programme's first cohort, group and module can be set up
                    without closing this drawer and picking the parent again on
                    three more pages. */}
                <button
                  type="button"
                  onClick={() => setWizardRun({ from: 'programme' })}
                  className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white bg-white px-4 text-[12px] font-bold text-foreground-950 shadow-lg shadow-black/10 transition-smooth hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
                >
                  <AppIcon className="ri-route-line text-base"></AppIcon>
                  Guided setup
                </button>
                <button
                  type="button"
                  onClick={() => reload()}
                  className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white bg-white px-4 text-[12px] font-bold text-foreground-950 shadow-lg shadow-black/10 transition-smooth hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
                >
                  <AppIcon className="ri-refresh-line text-base"></AppIcon>
                  Refresh
                </button>
              </div>
            </div>
            <div className="curriculum-programme-hero-stats relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <DashboardStat icon="ri-layout-masonry-line" label="Actual programmes" value={String(totalProgrammes)} detail={`${totalModules} modules connected`} />
              <DashboardStat icon="ri-calendar-event-line" label="Cohorts" value={String(totalCohorts)} detail={`${totalLearners} learners allocated`} />
              <DashboardStat icon="ri-stack-line" label="Programme modules" value={String(totalModules)} detail="Modules linked to a programme" />
              <DashboardStat
                icon="ri-node-tree"
                label="KSB progress"
                value={`${averageLearnerKsbProgress}%`}
                detail={learnerKsbTotals.expected > 0
                  ? `Learner-evidenced · ${averageKsbCoverage}% mapped`
                  : programmesWithKsb.length ? `${averageKsbCoverage}% mapped, no learner progress yet` : 'No mapped KSBs yet'}
              />
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200/60 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            Curriculum API error: {error}. Start the Django backend on port 8000 and refresh.
          </div>
        )}

        {actionError && (
          <div className="rounded-xl border border-red-200/60 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            {actionError}
          </div>
        )}

        <section className="programmes-search-panel rounded-2xl border border-primary-100/70 bg-background-50 p-3 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative flex-1">
              <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by programme..."
                className="h-11 w-full rounded-xl border border-foreground-200/70 bg-background-50 pl-10 pr-10 text-[13px] font-medium text-foreground-900 placeholder:text-foreground-400 outline-none transition-smooth focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-foreground-400 hover:bg-background-100 hover:text-foreground-700" aria-label="Clear search">
                  <AppIcon className="ri-close-line"></AppIcon>
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setReordering(current => !current); setOrderError(null); }}
              disabled={!canReorder}
              title={canReorder
                ? 'Move the cards into the order you want them read in.'
                : 'Clear the search and go back to Default order to arrange the cards.'}
              className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-[12px] font-bold transition-smooth disabled:cursor-not-allowed disabled:opacity-60 ${
                reordering
                  ? 'border-primary-600 bg-primary-600 text-white hover:bg-primary-700'
                  : 'border-primary-200 bg-background-50 text-primary-700 hover:bg-primary-50'
              }`}
            >
              <AppIcon className={reordering ? 'ri-check-line text-sm' : 'ri-drag-move-2-line text-sm'}></AppIcon>
              {reordering ? 'Done arranging' : 'Arrange cards'}
            </button>
            <label className="flex shrink-0 items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-foreground-400">Sort</span>
              <span className="w-48">
                <SelectMenu
                  size="sm"
                  value={sort}
                  onChange={setSort}
                  options={PROGRAMME_SORT_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
                  ariaLabel="Sort programmes"
                  placeholder="Default order"
                />
              </span>
            </label>
          </div>
          {reordering && (
            <p className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-primary-100/70 pt-2.5 text-[11px] font-medium text-foreground-500">
              <AppIcon className="ri-information-line text-sm text-primary-600"></AppIcon>
              Use a card&rsquo;s arrows to send it up, down, left or right. Every programme is on one page while you arrange, and each move is saved for everyone straight away.
              {savingOrder && <span className="font-bold text-primary-700">Saving…</span>}
            </p>
          )}
          {orderError && (
            <p className="mt-2.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700">
              The cards went back to their saved order: {orderError}
            </p>
          )}
        </section>

        {/* Said once for the page, because it is a state to clear rather than a
            fact about one card: a programme with no KSB source is unfinished,
            and the button that finishes it is right here. */}
        {!loading && programmesMissingKsbSource.length > 0 && (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-200 text-amber-700 shadow-sm shadow-amber-900/10">
                <AppIcon className="ri-error-warning-fill text-lg"></AppIcon>
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-amber-900">
                  {programmesMissingKsbSource.length === 1
                    ? `${programmesMissingKsbSource[0].programme.name} has no KSB codes yet`
                    : `${programmesMissingKsbSource.length} programmes have no KSB codes yet`}
                </p>
                <p className="mt-0.5 text-[12px] leading-5 text-amber-800">
                  {programmesWithEmptyKsbSource.length === programmesMissingKsbSource.length
                    ? 'Their applied source holds no KSB codes. Apply each programme’s GOV.UK standard — until then there is nothing for their modules to map to and coverage stays at 0%.'
                    : 'Until a KSB source is applied and filled in there are no codes for their modules to map to, coverage stays at 0% and learner KSB progress cannot be measured.'}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {programmesMissingKsbSource
                .filter(entry => !entry.source?.value)
                .slice(0, MISSING_KSB_SOURCE_SHORTCUTS)
                .map(({ programme }) => (
                  <button
                    key={programme.id}
                    type="button"
                    title={`Apply the GOV.UK standard for ${programme.name}.`}
                    onClick={() => setApplyProgramme(programme)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-2.5 text-[11px] font-bold text-amber-900 transition-smooth hover:bg-amber-100"
                  >
                    <AppIcon className="ri-node-tree text-sm"></AppIcon>
                    Choose a source
                  </button>
                ))}
              {programmesMissingKsbSource.length > MISSING_KSB_SOURCE_SHORTCUTS && (
                <span className="text-[11px] font-bold text-amber-800">
                  +{programmesMissingKsbSource.length - MISSING_KSB_SOURCE_SHORTCUTS} more below
                </span>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <CardGridSkeleton count={6} />
        ) : filtered.length ? (
          <>
          <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
            {displayedProgrammes.map((prog, cardIndex) => {
              const appliedSource = programmeKsbSources.get(prog.sourceId || prog.id) || resolveProgrammeAppliedKsbSource(prog, standards);
              const hasAppliedKsbSource = Boolean(appliedSource.value);
              // Applied but empty is its own state: the source is chosen, so the
              // work left is authoring its codes, not picking a different one.
              const ksbSourceIsEmpty = hasAppliedKsbSource && appliedSource.ksbCount < 1;
              const mappingCoverage = hasAppliedKsbSource && prog.ksbTotal > 0 ? Math.round((prog.ksbMapped / prog.ksbTotal) * 100) : 0;
              // Learner-declared KSB achievement, hydrated from the programme
              // stats response after the card itself has rendered.
              const learnerKsbProgress = Math.max(0, Math.min(100, Math.round(prog.learnerKsbAchievementPercentage ?? prog.learnerKsbProgressPercentage ?? 0)));
              const learnerKsbLearnerCount = prog.learnerKsbLearnerCount || 0;
              const learnerKsbAchievedCount = prog.learnerKsbAchievedCount || 0;
              const learnerKsbTargetCount = prog.learnerKsbTargetCount || ((prog.learnerKsbCodesTotal || 0) * learnerKsbLearnerCount);
              const learnerKsbMappedCount = prog.learnerKsbCodesTotal || 0;
              const learnerKsbStandardCount = prog.ksbTotal || 0;
              const learnerKsbUnmappedCount = Math.max(learnerKsbStandardCount - learnerKsbMappedCount, 0);
              const hasLearnerKsbDenominator = (prog.learnerKsbExpectedWeight || 0) > 0 && learnerKsbLearnerCount > 0;
              const cardColor = normaliseHex(prog.color || '#6941c6');
              const isDraftProgramme = programmeIsDraft(prog);
              // Clicking the card opens the programme it names. It used to start
              // the guided setup instead, which is a different promise: the card
              // shows what the programme already has, so the click that follows
              // from reading it is "show me this", not "add more to this". The
              // guided run keeps its own button in the row below.
              const openCard = () => openProgramme(prog);
              const openWizardForCard = () => setWizardRun({ from: 'cohort', programmeId: prog.sourceId || prog.id });
              // Deep links from the figures on the card into the tab that owns
              // each one. Stops the card click from also firing behind them.
              const openTab = (tab: ProgrammeDetailTab, view?: ProgrammeDetailView) => (event: { stopPropagation: () => void }) => {
                event.stopPropagation();
                openProgramme(prog, tab, view);
              };
              return (
              <div key={prog.id} className="relative h-full">
              {/* While the grid is being arranged the card is a thing to move,
                  not a thing to open, so the arrows sit over it and its own
                  buttons are taken out of the way behind them. */}
              {reordering && (
                <ArrangeArrows
                  id={programmeKey(prog)}
                  name={prog.name}
                  position={cardIndex}
                  total={displayedProgrammes.length}
                  columns={gridColumns}
                  onMove={moveProgramme}
                />
              )}
              <article
                // inert, not aria-hidden: the card keeps buttons of its own, and
                // they have to leave the tab order with it rather than stay
                // reachable inside a subtree screen readers are told to skip.
                inert={reordering}
                className="programmes-card programme-color-card group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-primary-100/70 bg-background-50 p-4 text-white shadow-sm transition-smooth hover:-translate-y-0.5 hover:border-primary-300/80 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                style={{ '--programme-card-color': cardColor } as CSSProperties}
                onClick={reordering ? undefined : openCard}
                onKeyDown={event => {
                  if (reordering) return;
                  if (event.target !== event.currentTarget) return;
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  openCard();
                }}
                tabIndex={reordering ? -1 : 0}
                aria-label={`Open ${prog.name}`}
                title={`Open ${prog.name} — its cohorts, groups, modules, sessions and KSB coverage`}
              >
                <div className="programme-card-accent absolute inset-x-0 top-0 h-1" />
                <div className="mb-2.5 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="programme-card-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: cardColor }}>
                      <AppIcon className="ri-book-2-line text-base"></AppIcon>
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-heading font-bold text-foreground-950">{prog.name}</p>
                      <p className="text-[11px] text-foreground-400">{formatProgrammeLevel(prog.level)}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="programme-type-badge inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary-700 ring-1 ring-primary-100">
                          <AppIcon className="ri-calendar-event-line text-[10px]"></AppIcon>
                          Programme
                        </span>
                        {isDraftProgramme && (
                          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-700 ring-1 ring-amber-200">
                            Draft
                          </span>
                        )}
                        {/* Up beside the name, because a grid of cards is read
                            by its headings: the panel below says the same thing
                            in full, but only once the eye has stopped here. */}
                        {(!hasAppliedKsbSource || ksbSourceIsEmpty) && (
                          <span className="programme-warning-badge inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-800 ring-1 ring-amber-300">
                            <AppIcon className="ri-error-warning-line text-[10px]"></AppIcon>
                            {ksbSourceIsEmpty ? 'Needs KSB codes' : 'Needs KSB source'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* The card is clickable; say so rather than leaving it to be
                      discovered. Dimmed at rest so a grid of six is not six
                      arrows competing with the programme names. */}
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-foreground-300 opacity-0 transition-smooth group-hover:bg-primary-50 group-hover:text-primary-600 group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    <AppIcon className="ri-arrow-right-line text-sm"></AppIcon>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    // An empty source has no KSBs to review. It is a placeholder
                    // to move off rather than a profile to fill in, so the panel
                    // offers the choice of a real source instead.
                    if (ksbSourceIsEmpty) setApplyProgramme(prog);
                    else openAppliedKsbSourceReview(prog, appliedSource);
                  }}
                  className={`programme-source-button mb-2.5 w-full rounded-xl border px-2 py-1.5 text-left transition-smooth focus:outline-none focus:ring-2 focus:ring-primary-200 ${hasAppliedKsbSource && !ksbSourceIsEmpty ? 'programme-source-applied' : 'programme-source-missing'}`}
                  aria-label={!hasAppliedKsbSource
                    ? `Set the KSB source for ${prog.name}`
                    : ksbSourceIsEmpty
                      ? `Choose a real KSB source for ${prog.name}`
                      : `View KSBs for ${appliedSource.title}`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`programme-source-icon mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${hasAppliedKsbSource && !ksbSourceIsEmpty ? 'programme-source-applied' : 'programme-source-missing'}`}>
                      <AppIcon className={hasAppliedKsbSource && !ksbSourceIsEmpty ? 'ri-checkbox-circle-line' : 'ri-error-warning-fill'}></AppIcon>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`programme-source-label text-[9px] font-black uppercase tracking-wide ${hasAppliedKsbSource && !ksbSourceIsEmpty ? 'text-primary-700' : 'text-amber-800'}`}>
                        {!hasAppliedKsbSource ? 'KSB Source required' : ksbSourceIsEmpty ? 'Applied KSB Source · empty' : 'Applied KSB Source'}
                      </p>
                      <p className="mt-0.5 truncate text-[12px] font-heading font-bold text-foreground-950">{appliedSource.title}</p>
                      {/* Reported by what it costs, not by the word "none":
                          "not applied" and "0 K / 0 S / 0 B" both read as a
                          value left at its default rather than as work to do. */}
                      <p className={`mt-0.5 text-[10px] font-semibold ${hasAppliedKsbSource && !ksbSourceIsEmpty ? 'truncate text-foreground-500' : 'text-amber-800'}`}>
                        {!hasAppliedKsbSource
                          ? 'Modules cannot map KSBs and coverage cannot be measured until one is applied.'
                          : ksbSourceIsEmpty
                            ? 'A placeholder with no KSB codes in it. Apply the programme’s real standard to make it mappable.'
                            : appliedSource.detail || appliedSource.subtitle}
                      </p>
                    </div>
                    <span className={`programme-source-cta mt-1 flex h-6 shrink-0 items-center justify-center rounded-lg ${hasAppliedKsbSource && !ksbSourceIsEmpty ? 'w-6 text-primary-600' : 'gap-1 bg-amber-500 px-2 text-[10px] font-bold text-white'}`}>
                      {hasAppliedKsbSource && !ksbSourceIsEmpty ? (
                        <AppIcon className="ri-arrow-right-s-line"></AppIcon>
                      ) : (
                        <>
                          <AppIcon className="ri-add-line text-[12px]"></AppIcon>
                          {ksbSourceIsEmpty ? 'Replace' : 'Set'}
                        </>
                      )}
                    </span>
                  </div>
                </button>
                {appliedSource.standard && (
                  <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                    {appliedSource.standard.minimumHours && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-bold text-cyan-800" title="Minimum hours for funding compliance">
                        <AppIcon className="ri-time-line text-[11px]"></AppIcon>
                        {appliedSource.standard.minimumHours} hrs min
                      </span>
                    )}
                    {appliedSource.standard.maxFunding && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800" title="Maximum government funding">
                        <AppIcon className="ri-price-tag-3-line text-[11px]"></AppIcon>
                        {appliedSource.standard.maxFunding} max funding
                      </span>
                    )}
                    {appliedSource.standard.duration && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-background-200 bg-background-50 px-2 py-0.5 text-[10px] font-bold text-foreground-600" title="Typical duration">
                        <AppIcon className="ri-hourglass-line text-[11px]"></AppIcon>
                        {appliedSource.standard.duration}
                      </span>
                    )}
                    {appliedSource.standard.route && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-background-200 bg-background-50 px-2 py-0.5 text-[10px] font-bold text-foreground-600" title="Route">
                        <AppIcon className="ri-route-line text-[11px]"></AppIcon>
                        {appliedSource.standard.route}
                      </span>
                    )}
                    {appliedSource.standard.degree && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-background-200 bg-background-50 px-2 py-0.5 text-[10px] font-bold text-foreground-600" title="Qualification type">
                        <AppIcon className="ri-graduation-cap-line text-[11px]"></AppIcon>
                        {appliedSource.standard.degree}
                      </span>
                    )}
                    {appliedSource.standard.larsCode && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-background-200 bg-background-50 px-2 py-0.5 text-[10px] font-bold text-foreground-600" title="LARS code">
                        <AppIcon className="ri-barcode-line text-[11px]"></AppIcon>
                        LARS {appliedSource.standard.larsCode}
                      </span>
                    )}
                    {appliedSource.standard.eqaProvider && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-background-200 bg-background-50 px-2 py-0.5 text-[10px] font-bold text-foreground-600" title="External quality assurance provider">
                        <AppIcon className="ri-shield-check-line text-[11px]"></AppIcon>
                        {appliedSource.standard.eqaProvider}
                      </span>
                    )}
                    {appliedSource.standard.approvedForDelivery && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                          /approved/i.test(appliedSource.standard.approvedForDelivery)
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-amber-200 bg-amber-50 text-amber-800'
                        }`}
                        title="Approved for delivery"
                      >
                        <AppIcon className="ri-checkbox-circle-line text-[11px]"></AppIcon>
                        {appliedSource.standard.approvedForDelivery}
                      </span>
                    )}
                  </div>
                )}
                {/* Every figure here is a way in, not a read-out: each opens the
                    tab of the programme workspace that owns it. */}
                <div className="programmes-metrics mb-3 grid grid-cols-2 gap-2.5 rounded-xl border border-primary-100/70 bg-primary-50/65 p-2.5 sm:grid-cols-5">
                  <Metric label="Cohorts" value={String(prog.cohorts)} onOpen={openTab('delivery')} hint={`Open the ${prog.cohorts} cohorts of ${prog.name}`} />
                  <Metric label="Groups" value={String(prog.groups || 0)} onOpen={openTab('delivery')} hint={`Open the groups of ${prog.name}`} />
                  <Metric label="Modules" value={String(prog.modules)} onOpen={openTab('design')} hint={`Open the ${prog.modules} modules of ${prog.name}`} />
                  <Metric label="Weeks" value={`${prog.weeks}`} onOpen={openTab('design')} hint={`Open the module plan of ${prog.name}`} />
                  <div className="col-span-2 py-1 sm:col-span-5"><p className="mb-1 text-[9px] uppercase text-foreground-400">Learners</p><LearnerStatusCounts target={{ scope: 'programme', id: prog.sourceId || prog.id, name: prog.name }} refreshKey={listedProgrammeById.get(prog.id) ?? prog} /></div>
                  <button
                    type="button"
                    onClick={openTab('coverage', 'achievement')}
                    title={`Open learner KSB achievement for ${prog.name}. The applied source contains ${learnerKsbStandardCount} total KSBs; ${learnerKsbMappedCount} are mapped to programme components and ${learnerKsbUnmappedCount} are not mapped.`}
                    className="col-span-2 rounded-lg px-1 py-0.5 text-left transition-smooth hover:bg-primary-100/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:col-span-5"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[9px] text-foreground-400 uppercase">Learner KSB Achievement</p>
                      <div className="text-right text-[9px] font-semibold leading-4 text-foreground-400">
                        <p>{hasLearnerKsbDenominator
                          ? `${learnerKsbAchievedCount} achieved / ${learnerKsbTargetCount} possible`
                          : `Mapping ${hasAppliedKsbSource ? `${mappingCoverage}%` : 'not applied'}`}</p>
                        <p title="The applied KSB source is the full standard; mapped KSBs are the codes connected to programme components and used in learner achievement.">
                          {learnerKsbLearnerCount} learners · {learnerKsbMappedCount} mapped of {learnerKsbStandardCount} total KSBs
                          {learnerKsbUnmappedCount > 0 ? ` · ${learnerKsbUnmappedCount} not mapped` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="flex-1 h-1.5 bg-background-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${!hasLearnerKsbDenominator ? 'bg-background-300' : learnerKsbProgress >= 100 ? 'bg-emerald-500' : learnerKsbProgress >= 70 ? 'bg-primary-500' : learnerKsbProgress > 0 ? 'bg-amber-500' : 'bg-background-300'}`}
                          style={{ width: `${hasLearnerKsbDenominator ? learnerKsbProgress : 0}%` }}
                        ></div>
                      </div>
                      <span
                        className="text-[10px] font-semibold"
                        title={hasLearnerKsbDenominator
                          ? `${learnerKsbProgress}% of learner/KSB targets achieved (${learnerKsbAchievedCount} achieved out of ${learnerKsbTargetCount} possible). Each learner/KSB pair counts once when the learner declares that KSB in a submitted or accepted reflection, or completes a mapped KSB activity.`
                          : 'Each learner/KSB pair counts once when the learner declares that KSB in a submitted or accepted reflection, or completes a mapped KSB activity.'}
                      >
                        {hasLearnerKsbDenominator
                          ? `${learnerKsbProgress}% achieved`
                          : learnerKsbLearnerCount === 0 ? 'No learners' : 'Needs mapping'}
                      </span>
                    </div>
                  </button>
                </div>
                {prog.description && <p className="mb-2.5 line-clamp-2 text-[12px] leading-5 text-foreground-500">{prog.description}</p>}
                {/* Two tiers, because six equal chips gave the reader nothing to
                    aim at. The top row is what a curriculum designer came to the
                    card to do - open the programme, or build the next piece of
                    it. The bottom row is upkeep on the record itself. */}
                <div className="mt-auto space-y-1.5 border-t border-primary-100/70 pt-2.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); openCard(); }}
                      title={`Open ${prog.name} — cohorts, groups, modules, sessions, KSB coverage and achievement`}
                      className="programme-action-button programme-action-open primary-action inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-2 py-1.5 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                    >
                      <AppIcon className="ri-folder-open-line text-sm"></AppIcon>
                      Open programme
                    </button>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); openWizardForCard(); }}
                      title={`Guided setup for ${prog.name} — its next cohort, group and module in one run`}
                      className="programme-action-button programme-action-structure inline-flex items-center justify-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-2 py-1.5 text-[11px] font-bold text-primary-700 transition-smooth hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                    >
                      <AppIcon className="ri-route-line text-sm"></AppIcon>
                      Add structure
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <button className="programme-action-button programme-action-source inline-flex items-center justify-center gap-1 rounded-lg border border-primary-200 bg-primary-50 px-1.5 py-1 text-[10px] font-bold text-primary-700 transition-smooth hover:bg-primary-100" onClick={e => { e.stopPropagation(); setApplyProgramme(prog); }}>
                      <AppIcon className="ri-node-tree text-sm"></AppIcon>KSB Source
                    </button>
                    <button className="programme-action-button programme-action-learners inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-1.5 py-1 text-[10px] font-bold text-emerald-700 transition-smooth hover:bg-emerald-100" onClick={e => { e.stopPropagation(); void openProgrammeLearnerImpact(prog); }}>
                      <AppIcon className="ri-user-follow-line text-sm"></AppIcon>Learners
                    </button>
                    <button className="programme-action-button programme-action-edit inline-flex items-center justify-center gap-1 rounded-lg border border-background-200 bg-background-50 px-1.5 py-1 text-[10px] font-bold text-foreground-700 transition-smooth hover:bg-background-100" onClick={e => { e.stopPropagation(); openEdit(prog); }}>
                      <AppIcon className="ri-pencil-line text-sm"></AppIcon>Edit
                    </button>
                    <button
                      className="programme-action-button programme-action-delete inline-flex items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 px-1.5 py-1 text-[10px] font-bold text-red-600 transition-smooth hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={deletingProgrammeId === (prog.sourceId || prog.id)}
                      onClick={e => { e.stopPropagation(); void archiveProgramme(prog); }}
                      title="Archive this programme; it can be restored or deleted permanently from Curriculum > Archive"
                    >
                      <AppIcon className={deletingProgrammeId === (prog.sourceId || prog.id)
                        ? 'ri-loader-4-line animate-spin text-sm'
                        : 'ri-archive-line text-sm'}></AppIcon>
                      Archive
                    </button>
                  </div>
                </div>
              </article>
              </div>
            );
            })}
          </div>
          {!reordering && totalProgrammePages > 1 && (
            <ProgrammePagination
              currentPage={programmePage}
              totalPages={totalProgrammePages}
              onPageChange={setProgrammePage}
            />
          )}
          </>
        ) : (
          <ProgrammesEmptyState
            hasSearch={Boolean(search.trim())}
            onClear={() => setSearch('')}
            onCreate={() => { setProgrammeDrawerTarget(null); setProgrammeDrawerOpen(true); }}
          />
        )}

        <ProgrammeFormDrawer
          open={programmeDrawerOpen}
          programme={programmeDrawerTarget}
          onClose={() => setProgrammeDrawerOpen(false)}
          onSaved={handleProgrammeSaved}
        />

        {/* The same forms the four pages open, chained. The KSB source picker is
            held back to the end of the run rather than opening over the cohort
            step — a new programme still cannot be mapped without one. */}
        <CurriculumStructureWizard
          open={Boolean(wizardRun)}
          from={wizardRun?.from || 'programme'}
          defaults={wizardRun?.programmeId ? { programmeId: wizardRun.programmeId } : undefined}
          onClose={() => setWizardRun(null)}
          onStepSaved={() => refreshProgrammeCards()}
          // A discarded run's records are already gone (or archived) server-side,
          // so the card comes off the list now rather than after the rebuild the
          // refresh above waits on — the same reason a save paints its card now.
          onRunDiscarded={(discarded: StructureWizardCreated, { deletedForGood }: { deletedForGood: boolean }) => {
            const programmeId = discarded.programme
              ? discarded.programme.sourceId || discarded.programme.id
              : '';
            if (!programmeId) return;
            // Archived is not deleted: the row has to reach the archive rather
            // than vanish, or the reader has no way back to it.
            if (deletedForGood) removeProgramme(String(programmeId));
            else markProgrammeArchived(String(programmeId));
          }}
          onFinished={(created: StructureWizardCreated) => {
            if (created.programme) {
              upsertProgramme(created.programme);
              setApplyProgramme(created.programme);
            }
          }}
        />
        {reviewProgramme && (
          <ProgrammeKsbReviewModal
            programme={reviewProgramme}
            items={reviewItems}
            descriptions={ksbDescriptions}
            loading={reviewLoading}
            error={reviewError}
            onClose={() => {
              reviewRequest.current += 1;
              setReviewProgramme(null);
              setReviewItems([]);
              setReviewError(null);
            }}
          />
        )}
        {learnerImpactProgramme && (
          <ProgrammeLearnerImpactModal
            programme={learnerImpactProgramme}
            data={learnerImpact}
            loading={learnerImpactLoading}
            error={learnerImpactError}
            onClose={() => {
              setLearnerImpactProgramme(null);
              setLearnerImpact(null);
              setLearnerImpactError(null);
            }}
          />
        )}
        {applyProgramme && (
          <ApplyProgrammeKsbSourceModal
            programme={applyProgramme}
            standards={standards}
            sourcesLoading={ksbSourcesLoading}
            sourcesError={ksbSourcesError}
            currentSource={programmeKsbSources.get(applyProgramme.sourceId || applyProgramme.id) || resolveProgrammeAppliedKsbSource(applyProgramme, standards)}
            applying={applyingKsbSource}
            onClose={() => {
              setApplyProgramme(null);
              // Cancelling the required source step is a deliberate pause. Do
              // not immediately claim the programme is ready or push the user
              // into Design/Delivery while the prerequisite is still missing.
              setNewProgrammeDeliveryTarget(null);
            }}
            onApply={sourceValue => applyProgrammeKsbSource(applyProgramme, sourceValue)}
            onUnapply={() => unapplyProgrammeKsbSource(applyProgramme, programmeKsbSources.get(applyProgramme.sourceId || applyProgramme.id) || resolveProgrammeAppliedKsbSource(applyProgramme, standards))}
            onRetry={() => { void loadKsbSources(); }}
          />
        )}
        {sourceReview && (
          <ProgrammeKsbSourceModal
            review={sourceReview}
            onClose={() => setSourceReview(null)}
            onRetry={() => { void openAppliedKsbSourceReview(sourceReview.programme, sourceReview.source); }}
          />
        )}
      </div>
    </WorkspaceShell>
  );
}

function ProgrammeLearnerImpactModal({
  programme,
  data,
  loading,
  error,
  onClose,
}: {
  programme: CurriculumProgramme;
  data: CurriculumProgrammeLearnerKsbSummaryResponse | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const learners = useMemo(() => data?.learnerKsbConsumption || [], [data]);
  const assignedLearners = data?.assignedLearners || [];
  const achievementsByLearner = useMemo(() => learnerAchievementMap(data), [data]);
  const filteredLearners = useMemo(() => {
    const needle = normalise(query);
    if (!needle) return learners;
    return learners.filter(learner => normalise([
      learner.learnerName,
      learner.email,
      learner.cohort,
      learner.group,
      (achievementsByLearner.get(String(learner.learnerId)) || []).map(ksb => ksb.code).join(' '),
    ].join(' ')).includes(needle));
  }, [achievementsByLearner, learners, query]);
  // Both roll-ups now come from the response rather than being re-summed here:
  // the backend computes them from this programme's own components, so the modal
  // and every scope panel elsewhere report the same figure the same way.
  const otjh = data?.otjhAchievement;
  const ksb = data?.ksbAchievement;
  const totalExpected = ksb?.expectedWeightTotal
    ?? learners.reduce((sum, learner) => sum + (learner.expectedWeightTotal || 0), 0);
  const totalConsumed = ksb?.cappedAchievedWeightTotal
    ?? learners.reduce((sum, learner) => sum + (learner.cappedConsumedWeightTotal || 0), 0);
  const averageProgress = ksb?.progressPercentage != null
    ? Math.round(ksb.progressPercentage)
    : (totalExpected ? Math.round((totalConsumed / totalExpected) * 100) : 0);
  // Achieved OTJH is the credited figure for this programme's components, not the
  // whole-learner-record hours: those cover everything a learner has ever logged,
  // which is a different question and used to be shown as if it answered this one.
  const achievedHours = otjh?.achievedTotal ?? 0;
  const plannedHours = otjh?.plannedTotal
    ?? assignedLearners.reduce((sum, learner) => sum + Number(learner.plannedHours || 0), 0);
  const otjhByLearner = useMemo(() => {
    const map = new Map<string, NonNullable<typeof otjh>['learners'][number]>();
    for (const row of otjh?.learners || []) map.set(String(row.learnerId), row);
    return map;
  }, [otjh]);
  const achievedRows = Array.from(achievementsByLearner.values()).flat();
  const achievedKsbCount = new Set(achievedRows.map(item => item.code)).size;
  const achievedRecordCount = achievedRows.reduce((sum, item) => sum + item.count, 0);

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl">
        <div className="flex items-start justify-between gap-4 bg-gradient-to-br from-primary-700 via-primary-900 to-primary-950 px-6 py-5 text-white">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-200">Enrolled Learners</p>
            <h3 className="mt-2 truncate text-xl font-heading font-bold">{programme.name}</h3>
            <p className="mt-1 text-[12px] font-semibold text-white/70">
              {loading ? <LoadingSkeleton label="Loading learner OTJH and KSB progress..." variant="text" /> : `${assignedLearners.length} learner${assignedLearners.length === 1 ? '' : 's'} assigned to this programme.`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white transition-smooth hover:bg-white/15" aria-label="Close learner impact">
            <AppIcon className="ri-close-line text-lg"></AppIcon>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 border-b border-background-200 bg-background-50 p-4 lg:grid-cols-4">
          <ImpactStat icon="ri-user-follow-line" label="Assigned learners" value={String(assignedLearners.length)} detail="Learner + enrolment records" />
          <ImpactStat icon="ri-time-line" label="OTJH achieved" value={formatHoursMinutes(achievedHours)} detail={`of ${formatHoursMinutes(plannedHours)} planned across this programme's components`} />
          <ImpactStat icon="ri-node-tree" label="KSB weight earned" value={`${averageProgress}%`} detail={`${formatMetricNumber(totalConsumed)} of ${formatMetricNumber(totalExpected)} expected weight`} />
          <ImpactStat icon="ri-checkbox-circle-line" label="Achieved KSBs" value={String(achievedKsbCount)} detail={`${achievedRecordCount} learner record${achievedRecordCount === 1 ? '' : 's'}`} />
        </div>

        <div className="border-b border-background-200 bg-background-50 p-4">
          <div className="relative">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400"></AppIcon>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search learner, cohort, group or KSB..."
              className="h-11 w-full rounded-xl border border-foreground-200/70 bg-background-100 pl-10 pr-4 text-[13px] font-medium text-foreground-900 outline-none transition-smooth focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error ? (
            <ProgrammeKsbEmptyState icon="ri-error-warning-line" title="Could not load learners" message={error} />
          ) : loading ? (
            <LoadingSkeleton label="Loading learner impact" variant="rows" />
          ) : filteredLearners.length ? (
            <div className="space-y-3">
              {filteredLearners.map(learner => (
                <ProgrammeLearnerImpactRow
                  key={String(learner.learnerId)}
                  learner={learner}
                  learnerMeta={assignedLearners.find(item => String(item.id) === String(learner.learnerId))}
                  otjhRow={otjhByLearner.get(String(learner.learnerId))}
                  achievements={achievementsByLearner.get(String(learner.learnerId)) || []}
                />
              ))}
            </div>
          ) : (
            <ProgrammeKsbEmptyState icon="ri-user-search-line" title="No learners found" message={query ? 'No assigned learner matches this search.' : 'No learner is currently assigned or enrolled against this programme label.'} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ProgrammeLearnerImpactRow({
  learner,
  learnerMeta,
  otjhRow,
  achievements,
}: {
  learner: CurriculumLearnerKsbConsumption;
  learnerMeta?: CurriculumProgrammeLearnerKsbImpactResponse['assignedLearners'][number];
  /** This learner's OTJH against this programme's components. */
  otjhRow?: CurriculumProgrammeLearnerKsbImpactResponse['otjhAchievement']['learners'][number];
  achievements: LearnerKsbAchievement[];
}) {
  const [expanded, setExpanded] = useState(false);
  const achievedWeight = achievements.reduce((sum, item) => sum + item.weight, 0);
  const achievedCount = achievements.reduce((sum, item) => sum + item.count, 0);
  // The programme's own figure first; the learner's whole-record hours are a
  // different total and are shown as such rather than standing in for it.
  const otjhCompleted = otjhRow ? Number(otjhRow.achievedOtjh || 0) : Number(learnerMeta?.completedHours || 0);
  const otjhPlanned = otjhRow ? Number(otjhRow.plannedOtjh || 0) : Number(learnerMeta?.plannedHours || 0);
  const otjhProgress = otjhPlanned ? Math.min(Math.round((otjhCompleted / otjhPlanned) * 100), 100) : 0;
  return (
    <article className="rounded-2xl border border-foreground-200 bg-background-50 p-4 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-heading font-black text-foreground-950">{learner.learnerName || learner.email || `Learner ${learner.learnerId}`}</h4>
            <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">{learnerMeta?.lifecycleStatus || 'assigned'}</span>
          </div>
          <p className="mt-1 text-[12px] font-semibold text-foreground-500">{learner.email || 'No email'} - {learner.cohort || 'No cohort'} - {learner.group || 'No group'}</p>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4 xl:w-[620px]">
          <LearnerMiniMetric
            label="OTJH here"
            value={formatHoursMinutes(otjhCompleted)}
            detail={otjhRow
              ? `${otjhProgress}% of ${formatHoursMinutes(otjhPlanned)} · ${formatHoursMinutes(learnerMeta?.completedHours || 0)} on record`
              : `${otjhProgress}% of ${formatHoursMinutes(otjhPlanned)}`}
          />
          <LearnerMiniMetric label="KSB weight achieved" value={formatMetricNumber(achievedWeight)} detail="Total consumed weight" />
          <LearnerMiniMetric label="Achieved KSBs" value={String(achievements.length)} detail={`${achievedCount} record${achievedCount === 1 ? '' : 's'}`} />
          <button type="button" onClick={() => setExpanded(value => !value)} className="inline-flex h-full min-h-14 items-center justify-center gap-2 rounded-xl border border-background-200 bg-background-100 px-3 text-[11px] font-black text-foreground-700 transition-smooth hover:bg-background-200">
            <AppIcon className={expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}></AppIcon>
            Details
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <ProgressStrip label="OTJH" value={otjhProgress} tone="emerald" />
        <ProgressStrip label="KSBs" value={Math.min(Math.round(learner.progressPercentage || 0), 100)} tone="primary" />
      </div>
      {expanded && (
        achievements.length ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-background-200">
            <div className="grid grid-cols-[130px_1fr_90px_110px_130px] bg-background-100 px-4 py-2 text-[10px] font-black uppercase tracking-wide text-foreground-500">
              <span>KSB achieved</span>
              <span>Component / reflection</span>
              <span className="text-right">Times</span>
              <span className="text-right">Weight</span>
              <span className="text-right">OTJH</span>
            </div>
            {achievements.map(item => (
              <div key={item.code} className="grid grid-cols-[130px_1fr_90px_110px_130px] items-center gap-3 border-t border-background-200 px-4 py-3 text-[12px] font-semibold text-foreground-800">
                <span className="inline-flex items-center gap-2">
                  <span className="rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700">{item.code}</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-bold text-foreground-900" title={item.activities.join(' | ') || 'Reflection submission'}>
                    {item.activities[0] || 'Reflection submission'}
                  </span>
                  {item.reflections[0] && <span className="mt-0.5 block truncate text-[11px] font-medium text-foreground-500" title={item.reflections[0]}>{item.reflections[0]}</span>}
                </span>
                <span className="text-right font-black">{item.count}</span>
                <span className="text-right font-black">
                  {formatMetricNumber(item.weight)}
                  {item.declaredWeight > 0 && (
                    <span
                      className="block text-[9px] font-bold uppercase text-foreground-400"
                      title="Weight the learner declared in their reflection. Supplementary evidence — not added to achieved weight."
                    >
                      {formatMetricNumber(item.declaredWeight)} declared
                    </span>
                  )}
                </span>
                <span className="text-right font-black">
                  {formatOtjhPair(item.actualOtjh, item.plannedOtjh)}
                  <span className="block text-[9px] font-bold uppercase text-foreground-400">{plannedOtjhSourceLabel(item.plannedOtjhSource)}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-background-300 bg-background-100 p-5 text-center">
            <p className="text-[13px] font-bold text-foreground-800">No achieved KSBs yet</p>
            <p className="mt-1 text-[12px] text-foreground-500">This learner has not consumed any weighted KSB evidence for this programme yet.</p>
          </div>
        )
      )}
    </article>
  );
}

/** Achieved KSB weight per learner, plus the reflection context for each code.
 *
 * Built on the server (backend curriculum_api/learner_impact_summary.py) from
 * `consumptionSources.progress` alone -- the Component Progress snapshot --
 * with reflections annotating, never adding to, the achieved weight: actual
 * OTJH, the reflection text, and the declared weight shown separately. The
 * response names each activity once in `activityLabels`; lines refer to them by
 * position.
 */
function learnerAchievementMap(data: CurriculumProgrammeLearnerKsbSummaryResponse | null) {
  const labels = data?.activityLabels || [];
  return new Map(
    Object.entries(data?.learnerKsbAchievements || {}).map(([learnerId, lines]) => [
      learnerId,
      lines.map((line): LearnerKsbAchievement => ({
        ...line,
        weight: line.weight ?? 0,
        declaredWeight: line.declaredWeight ?? Number.NaN,
        activities: line.activities.map(index => labels[index]).filter((label): label is string => Boolean(label)),
      })).sort((a, b) => ksbCodeSort(a.code, b.code)),
    ]),
  );
}

function ImpactStat({ icon, label, value, detail }: { icon: string; label: string; value: string; detail: string }) {
  return (
    <div className="coach-metric-card" title={`${label}: ${detail}`}>
      <div className="flex items-center gap-2 text-foreground-500">
        <AppIcon className={`${icon} text-sm`}></AppIcon>
        <span className="truncate text-[10px] font-bold uppercase tracking-wide" title={label} aria-label={label}>{label}</span>
      </div>
      <p className="mt-2 text-2xl font-heading font-bold text-foreground-950">{value}</p>
      <p className="mt-0.5 truncate text-[11px] font-semibold text-foreground-500">{detail}</p>
    </div>
  );
}

function LearnerMiniMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="coach-metric-card">
      <p className="text-[9px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
      <p className="mt-1 text-base font-heading font-black text-foreground-950">{value}</p>
      <p className="truncate text-[10px] font-semibold text-foreground-500">{detail}</p>
    </div>
  );
}

function ProgressStrip({ label, value, compact = false }: { label: string; value: number; tone?: 'primary' | 'emerald' | 'amber' | 'red'; compact?: boolean }) {
  const color = value >= 80 ? 'bg-emerald-500' : value >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className={compact ? 'mt-2' : ''}>
      {label && <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-foreground-400"><span>{label}</span><span>{value}%</span></div>}
      <div className={`${compact ? 'h-1.5' : 'h-2'} overflow-hidden rounded-full bg-background-200`}>
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} />
      </div>
    </div>
  );
}

function formatMetricNumber(value: number) {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  return rounded === Math.trunc(rounded) ? String(Math.trunc(rounded)) : rounded.toFixed(1);
}

function formatNullableHours(value: number | null) {
  return value === null ? 'Not returned' : formatHoursMinutes(value);
}

function formatOtjhPair(actual: number | null, planned: number | null) {
  return `${formatNullableHours(actual)} / ${formatNullableHours(planned)}`;
}

function plannedOtjhSourceLabel(source: string) {
  if (source === 'learning_reflection_submissions') return 'Reflection planned';
  if (source === 'curriculum_component') return 'Curriculum component';
  return 'Planned not returned';
}

function ProgrammeKsbReviewModal({
  programme,
  items,
  descriptions,
  loading,
  error,
  onClose,
}: {
  programme: CurriculumProgramme;
  items: CurriculumKsbCoverageItem[];
  descriptions: Map<string, string>;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const filteredItems = useMemo(() => {
    const needle = normalise(query);
    if (!needle) return items;
    return items.filter(item => {
      const searchable = [
        item.code,
        item.title,
        item.description,
        programmeKsbDescription(item, descriptions),
        coverageSourceLabel(item),
        ...(item.mappings || []).flatMap(mapping => [
          mapping.moduleName || mapping.module_name,
          mapping.weekName || mapping.week_name,
          mapping.componentName || mapping.component_name,
          mapping.componentType || mapping.component_type,
        ]),
      ].join(' ');
      return normalise(searchable).includes(needle);
    });
  }, [descriptions, items, query]);

  const groupedItems = useMemo(() => ({
    knowledge: filteredItems.filter(item => ksbFamily(item) === 'knowledge'),
    skills: filteredItems.filter(item => ksbFamily(item) === 'skills'),
    behaviours: filteredItems.filter(item => ksbFamily(item) === 'behaviours'),
  }), [filteredItems]);
  const totalPlacements = filteredItems.reduce((sum, item) => sum + (item.mappingCount || item.mapping_count || item.mappings?.length || 0), 0);

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl">
        <div
          className="flex items-start justify-between gap-4 px-6 py-5 text-white"
          style={{
            background: 'radial-gradient(circle at 18% 0%, rgba(255,255,255,0.18), transparent 36%), linear-gradient(135deg, oklch(var(--primary-800)) 0%, oklch(var(--primary-900)) 46%, oklch(var(--primary-950)) 100%)',
          }}
        >
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-200">Programme KSB Coverage</p>
            <h3 className="mt-2 text-xl font-heading font-bold text-white">{programme.name}</h3>
            <p className="mt-1 text-[12px] font-semibold text-white/70">
              {loading ? <LoadingSkeleton label="Loading applied KSBs..." variant="text" /> : `${filteredItems.length} applied KSB${filteredItems.length === 1 ? '' : 's'} across ${totalPlacements} placement${totalPlacements === 1 ? '' : 's'}.`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white transition-smooth hover:bg-white/15" aria-label="Close KSB review">
            <AppIcon className="ri-close-line text-lg"></AppIcon>
          </button>
        </div>

        <div className="border-b border-background-200 bg-background-50 p-4">
          <div className="relative">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400"></AppIcon>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search code, source, module, week or component..."
              className="h-11 w-full rounded-xl border border-foreground-200/70 bg-background-100 pl-10 pr-4 text-[13px] font-medium text-foreground-900 outline-none transition-smooth focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error ? (
            <ProgrammeKsbEmptyState icon="ri-error-warning-line" title="Could not load programme KSBs" message={error} />
          ) : loading ? (
            <LoadingSkeleton label="Loading applied KSBs" variant="rows" />
          ) : filteredItems.length ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <ProgrammeKsbColumn title="Knowledge" tone="knowledge" items={groupedItems.knowledge} descriptions={descriptions} />
              <ProgrammeKsbColumn title="Skills" tone="skills" items={groupedItems.skills} descriptions={descriptions} />
              <ProgrammeKsbColumn title="Behaviours" tone="behaviours" items={groupedItems.behaviours} descriptions={descriptions} />
            </div>
          ) : (
            <ProgrammeKsbEmptyState
              icon="ri-node-tree"
              title="No applied KSBs in this programme"
              message="Only KSBs with a readable source and real module, week, or component placement are shown here."
            />
          )}
        </div>

        <div className="flex justify-end border-t border-background-200 bg-background-50 px-4 py-3">
          <button type="button" onClick={onClose} className="inline-flex h-10 items-center rounded-lg border border-background-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100">
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ProgrammeKsbSourceModal({ review, onClose, onRetry }: { review: ProgrammeKsbSourceReview; onClose: () => void; onRetry: () => void }) {
  const [query, setQuery] = useState('');
  const items = useMemo(() => programmeKsbSourceItems(review), [review]);
  const filteredItems = useMemo(() => {
    const needle = normalise(query);
    if (!needle) return items;
    return items.filter(item => normalise([item.code, item.title, item.description, item.type, item.parentCode].join(' ')).includes(needle));
  }, [items, query]);
  const groupedItems = useMemo(() => ({
    knowledge: filteredItems.filter(item => item.family === 'knowledge'),
    skills: filteredItems.filter(item => item.family === 'skills'),
    behaviours: filteredItems.filter(item => item.family === 'behaviours'),
  }), [filteredItems]);

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl">
        <div className="flex items-start justify-between gap-4 bg-[#070112] px-6 py-5 text-white">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-200">Applied KSB Profile</p>
            <h3 className="mt-2 truncate text-xl font-heading font-bold">{review.source.title}</h3>
            <p className="mt-1 text-[12px] font-semibold text-white/70">
              {review.programme.name} - {review.loading ? <LoadingSkeleton label="Loading definitions" variant="text" /> : review.error ? 'Definitions unavailable' : `${filteredItems.length} of ${items.length} KSBs shown`} - {review.source.detail}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white transition-smooth hover:bg-white/15" aria-label="Close KSB profile">
            <AppIcon className="ri-close-line text-lg"></AppIcon>
          </button>
        </div>

        <div className="border-b border-background-200 bg-background-50 p-4">
          <div className="relative">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400"></AppIcon>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search KSB code or description..."
              className="h-11 w-full rounded-xl border border-foreground-200/70 bg-background-100 pl-10 pr-4 text-[13px] font-medium text-foreground-900 outline-none transition-smooth focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {review.loading ? <p ><LoadingSkeleton label="Loading KSB definitions..." variant="rows" /></p> : review.error ? (
            <div role="alert">
              <p>{review.error}</p>
              <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-primary-200 px-3 py-2 text-primary-700">Retry</button>
            </div>
          ) : items.length ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <ProgrammeKsbSourceColumn title="Knowledge" count={groupedItems.knowledge.length} items={groupedItems.knowledge} tone="primary" />
              <ProgrammeKsbSourceColumn title="Skills" count={groupedItems.skills.length} items={groupedItems.skills} tone="emerald" />
              <ProgrammeKsbSourceColumn title="Behaviours" count={groupedItems.behaviours.length} items={groupedItems.behaviours} tone="amber" />
            </div>
          ) : (
            <ProgrammeKsbEmptyState icon="ri-folder-warning-line" title="No KSBs in this profile" message="This applied source is linked, but it does not contain readable KSB definitions yet." />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ProgrammeKsbSourceColumn({ title, count, items, tone }: { title: string; count: number; items: ProgrammeKsbSourceItem[]; tone: 'primary' | 'emerald' | 'amber' }) {
  const toneClass = tone === 'emerald'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : tone === 'amber'
      ? 'bg-amber-50 text-amber-700 border-amber-100'
      : 'bg-primary-50 text-primary-700 border-primary-100';
  return (
    <section className="min-w-0 rounded-2xl border border-background-200 bg-background-100/60 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-sm font-heading font-bold text-foreground-950">{title}</h4>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${toneClass}`}>{count}</span>
      </div>
      <div className="space-y-2">
        {items.map(item => (
          <article key={item.id} className="rounded-xl border border-foreground-200 bg-background-50 p-3 shadow-sm">
            <div className="flex items-start gap-2">
              <span className={`shrink-0 rounded-lg border px-2 py-1 text-[11px] font-black ${toneClass}`}>{item.code || '-'}</span>
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-foreground-900">{item.title || item.description || item.code}</p>
                {item.description && item.description !== item.title && (
                  <p className="mt-1 text-[11px] leading-5 text-foreground-500">{item.description}</p>
                )}
                {item.parentCode && <p className="mt-1 text-[10px] font-semibold text-foreground-400">Parent: {item.parentCode}</p>}
              </div>
            </div>
          </article>
        ))}
        {!items.length && <p className="rounded-xl border border-dashed border-background-300 bg-background-50 p-4 text-center text-[12px] font-semibold text-foreground-400">No {title.toLowerCase()} KSBs</p>}
      </div>
    </section>
  );
}

function ApplyProgrammeKsbSourceModal({
  programme,
  standards,
  sourcesLoading,
  sourcesError,
  currentSource,
  applying,
  onClose,
  onApply,
  onUnapply,
  onRetry,
}: {
  programme: CurriculumProgramme;
  standards: CurriculumStandard[];
  sourcesLoading: boolean;
  sourcesError: string | null;
  currentSource: ProgrammeAppliedKsbSource;
  applying: boolean;
  onClose: () => void;
  onApply: (sourceValue: string) => void;
  onUnapply: () => void;
  onRetry: () => void;
}) {
  // KSBs come from the GOV.UK standards only: manual profiles are not offered.
  const options = useMemo(() => standards.map(standard => ({
    value: `standard:${standard.id}`,
    title: standard.name,
    subtitle: `${standard.code || standard.standardRef || 'Standard'} - ${standard.level || 'Level not set'}`,
    detail: `${standard.knowledge || 0} K / ${standard.skills || 0} S / ${standard.behaviours || 0} B`,
  })), [standards]);
  // Only a source that is genuinely applied may start selected. Pre-selecting a
  // name-match guess (or the first option) made programmes with no applied KSB
  // Source open this modal looking like a source had already been chosen, while
  // the programme card next to it still read "No KSB Source selected".
  const appliedSelection = useMemo(() => (
    currentSource.value && options.some(option => option.value === currentSource.value) ? currentSource.value : ''
  ), [currentSource.value, options]);
  const [selectedSource, setSelectedSource] = useState(appliedSelection);
  useEffect(() => {
    setSelectedSource(appliedSelection);
  }, [appliedSelection]);
  const selectedOption = options.find(option => option.value === selectedSource);
  const selectedIsCurrent = Boolean(currentSource.value && selectedSource === currentSource.value);

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl">
        <div
          className="flex items-start justify-between gap-4 px-6 py-5 text-white"
          style={{
            background: 'radial-gradient(circle at 18% 0%, rgba(255,255,255,0.18), transparent 36%), linear-gradient(135deg, oklch(var(--primary-800)) 0%, oklch(var(--primary-900)) 46%, oklch(var(--primary-950)) 100%)',
          }}
        >
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-200">Apply KSB Source</p>
            <h3 className="mt-2 text-xl font-heading font-bold text-white">{programme.name}</h3>
            <p className="mt-1 text-[12px] font-semibold text-white/70">Choose the GOV.UK standard this programme must be measured against.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white transition-smooth hover:bg-white/15" aria-label="Close KSB Source">
            <AppIcon className="ri-close-line text-lg"></AppIcon>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <div className="grid gap-3">
            {options.map(option => {
              const selected = option.value === selectedSource;
              const current = option.value === currentSource.value;
              return (
                <button key={option.value} type="button" onClick={() => setSelectedSource(option.value)} className={`rounded-xl border p-4 text-left transition-smooth ${selected ? 'border-primary-300 bg-primary-50 ring-2 ring-primary-100' : 'border-foreground-200 bg-background-50 hover:bg-background-100'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="text-sm font-heading font-black text-foreground-950">{option.title}</p>
                        {current && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-700">Currently applied</span>}
                      </div>
                      <p className="mt-1 text-[12px] font-semibold text-foreground-500">{option.subtitle}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-black text-foreground-600">{option.detail}</span>
                  </div>
                </button>
              );
            })}
            {sourcesLoading && !options.length && (
              <div className="rounded-xl border border-primary-100 bg-primary-50 p-6 text-center">
                <AppIcon className="ri-loader-4-line mb-2 inline-block animate-spin text-xl text-primary-600"></AppIcon>
                <p className="text-sm font-bold text-foreground-800"><LoadingSkeleton label="Loading KSB sources..." variant="rows" /></p>
                <p className="mt-1 text-[12px] text-foreground-500">Your existing programme assignment is kept while the source details load.</p>
              </div>
            )}
            {!sourcesLoading && sourcesError && !options.length && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
                <p className="text-sm font-bold text-red-800">KSB sources could not be loaded</p>
                <p className="mt-1 text-[12px] text-red-700">The programme assignment has not been removed. Retry loading the source list.</p>
                <button type="button" onClick={onRetry} className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 text-[12px] font-bold text-red-700 hover:bg-red-100">
                  <AppIcon className="ri-refresh-line"></AppIcon>
                  Retry
                </button>
              </div>
            )}
            {!sourcesLoading && !sourcesError && !options.length && (
              <div className="rounded-xl border border-dashed border-foreground-200 bg-background-100 p-6 text-center">
                <p className="text-sm font-bold text-foreground-800">No KSB standards available</p>
                <p className="mt-1 text-[12px] text-foreground-500">Add the source first, then come back to apply it to this programme.</p>
              </div>
            )}
          </div>
          {selectedOption && (
            <div className={`mt-4 rounded-xl border px-4 py-3 text-[12px] font-semibold ${selectedIsCurrent ? 'border-primary-100 bg-primary-50 text-primary-800' : 'border-emerald-100 bg-emerald-50 text-emerald-800'}`}>
              {selectedIsCurrent ? 'This is the active KSB Source selection for this programme: ' : 'Applying this will make programme coverage, missing KSBs, occurrences and component weights roll up against: '}
              <strong>{selectedOption.title}</strong>.
            </div>
          )}
          {!selectedOption && options.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-800">
              {currentSource.value
                ? 'The applied KSB standard is not in this list. Pick a KSB standard to replace it.'
                : 'No KSB Source is applied to this programme yet. Select a KSB standard above to apply one.'}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {currentSource.value && (
              <button type="button" disabled={applying} onClick={onUnapply} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 text-[12px] font-bold text-red-700 transition-smooth hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50">
                <AppIcon className={applying ? 'ri-loader-4-line animate-spin' : 'ri-link-unlink-m'}></AppIcon>
                Unapply source
              </button>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button type="button" onClick={onClose} className="inline-flex h-10 items-center justify-center rounded-lg border border-background-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100">
              Cancel
            </button>
            <button type="button" disabled={!selectedSource || applying || selectedIsCurrent} onClick={() => onApply(selectedSource)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
              <AppIcon className={applying ? 'ri-loader-4-line animate-spin' : selectedIsCurrent ? 'ri-checkbox-circle-line' : 'ri-check-line'}></AppIcon>
              {applying ? 'Applying...' : selectedIsCurrent ? 'Applied' : 'Apply source'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ProgrammeKsbColumn({ title, tone, items, descriptions }: { title: string; tone: 'knowledge' | 'skills' | 'behaviours'; items: CurriculumKsbCoverageItem[]; descriptions: Map<string, string> }) {
  const toneClasses = {
    knowledge: 'border-primary-300 bg-primary-50/50 text-primary-700',
    skills: 'border-amber-300 bg-amber-50/60 text-amber-700',
    behaviours: 'border-emerald-300 bg-emerald-50/60 text-emerald-700',
  }[tone];

  return (
    <section className={`rounded-2xl border p-3 ${toneClasses}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-[12px] font-heading font-bold uppercase tracking-wide">{title}</h4>
        <span className="rounded-full bg-white/70 px-2 py-1 text-[11px] font-bold">{items.length}</span>
      </div>
      <div className="space-y-3">
        {items.length ? items.map(item => (
          <ProgrammeKsbCard key={`${item.coverageKey || item.coverage_key || item.ksbId || item.ksb_id}-${coverageSourceLabel(item)}`} item={item} descriptions={descriptions} />
        )) : (
          <div className="rounded-xl border border-dashed border-current/20 bg-white/55 p-4 text-center text-[12px] font-semibold text-foreground-500">
            No applied {title.toLowerCase()} KSBs
          </div>
        )}
      </div>
    </section>
  );
}

function ProgrammeKsbCard({ item, descriptions }: { item: CurriculumKsbCoverageItem; descriptions: Map<string, string> }) {
  const mappings = (item.mappings || []).filter(mappingHasDetailedPlacement);
  const weight = Math.round(item.coveragePercentage || item.coverage_percentage || item.progressBarPercentage || item.progress_bar_percentage || 0);
  const description = programmeKsbDescription(item, descriptions);
  const title = String(item.title || '').trim();
  return (
    <article className="rounded-xl border border-current/35 bg-background-50 p-3 text-foreground-900 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="rounded-lg border border-current/20 bg-white px-2 py-1 text-[12px] font-bold text-current">{item.code}</span>
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">{mappings.length} place{mappings.length === 1 ? '' : 's'}</span>
        </div>
        <span className="shrink-0 rounded-full bg-background-100 px-2 py-1 text-[11px] font-bold text-current">{weight}%</span>
      </div>
      <p className="mt-3 text-[13px] font-semibold leading-5 text-foreground-900">{title && normalise(title) !== normalise(item.code) ? title : description || item.code}</p>
      {description && (!title || normalise(title) !== normalise(description)) && (
        <p className="mt-1 line-clamp-3 text-[12px] leading-5 text-foreground-600">{description}</p>
      )}
      <div className="mt-3 rounded-lg bg-background-100 px-3 py-2">
        <p className="text-[9px] font-bold uppercase tracking-wide text-foreground-400">Source</p>
        <p className="mt-1 text-[11px] font-bold text-foreground-800">{coverageSourceLabel(item)}</p>
      </div>
      <div className="mt-3 space-y-2">
        <p className="text-[9px] font-bold uppercase tracking-wide text-foreground-400">Used In</p>
        {mappings.slice(0, 5).map(mapping => (
          <div key={mapping.mappingId || mapping.mapping_id} className="rounded-lg bg-background-100 px-3 py-2 text-[11px] font-semibold leading-5 text-foreground-800">
            {programmeKsbPlacementLabel(mapping)}
          </div>
        ))}
        {mappings.length > 5 && (
          <p className="text-[11px] font-bold text-foreground-500">+ {mappings.length - 5} more placement{mappings.length - 5 === 1 ? '' : 's'}</p>
        )}
      </div>
    </article>
  );
}

function ProgrammeKsbEmptyState({ icon, title, message }: { icon: string; title: string; message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-foreground-200 bg-background-100 px-6 py-12 text-center">
      <AppIcon className={`${icon} text-3xl text-foreground-400`}></AppIcon>
      <h4 className="mt-3 text-sm font-heading font-bold text-foreground-950">{title}</h4>
      <p className="mt-2 text-[13px] text-foreground-500">{message}</p>
    </div>
  );
}

function DashboardStat({ icon, label, value, detail }: { icon: string; label: string; value: string; detail: string }) {
  return (
    <div className="coach-metric-card">
      <div className="flex items-center gap-2 text-primary-900/70">
        <AppIcon className={`${icon} text-sm`}></AppIcon>
        <span className="truncate text-[10px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-heading font-bold text-foreground-950">{value}</p>
      <p className="mt-0.5 truncate text-[11px] font-semibold text-foreground-600" title={detail}>{detail}</p>
    </div>
  );
}

function ProgrammePagination({ currentPage, totalPages, onPageChange }: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <nav aria-label="Programme pages" className="flex flex-col gap-3 rounded-2xl border border-foreground-200/70 bg-background-50 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-xs font-semibold text-foreground-500">
        Page {currentPage} of {totalPages}
      </span>
      <div className="flex items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label="Previous page"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-foreground-200 bg-background-50 px-3 text-xs font-bold text-foreground-700 transition-smooth hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <AppIcon className="ri-arrow-left-s-line" />
          Previous
        </button>
        {Array.from({ length: totalPages }, (_, index) => index + 1).map(page => (
          <button
            key={page}
            type="button"
            onClick={() => onPageChange(page)}
            aria-current={page === currentPage ? 'page' : undefined}
            className={page === currentPage
              ? 'inline-flex h-9 min-w-9 items-center justify-center rounded-lg bg-primary-600 px-2.5 text-xs font-bold text-white shadow-sm transition-smooth focus:outline-none focus:ring-2 focus:ring-primary-300'
              : 'inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-foreground-200 bg-background-50 px-2.5 text-xs font-bold text-foreground-700 transition-smooth hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300'}
          >
            {page}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label="Next page"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-foreground-200 bg-background-50 px-3 text-xs font-bold text-foreground-700 transition-smooth hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
          <AppIcon className="ri-arrow-right-s-line" />
        </button>
      </div>
    </nav>
  );
}

function ProgrammesEmptyState({
  hasSearch,
  onClear,
  onCreate,
}: {
  hasSearch: boolean;
  onClear: () => void;
  onCreate: () => void;
}) {
  const title = hasSearch ? 'No programmes match your search' : 'No programmes created yet';
  const message = hasSearch
    ? 'Try a different programme name or standard.'
    : 'Create the first programme structure to add cohorts, groups, modules and weekly components.';

  return (
    <div className="rounded-2xl border border-dashed border-foreground-200 bg-background-50 px-6 py-14 text-center shadow-sm">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 ring-1 ring-primary-100">
        <AppIcon className={`${hasSearch ? 'ri-search-line' : 'ri-stack-line'} text-2xl`}></AppIcon>
      </span>
      <h3 className="mt-4 text-base font-heading font-bold text-foreground-950">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-foreground-500">{message}</p>
      <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
        {hasSearch && (
          <button type="button" onClick={onClear} className="inline-flex h-10 items-center gap-2 rounded-lg border border-background-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100">
            <AppIcon className="ri-filter-off-line"></AppIcon>
            Clear search
          </button>
        )}
        <button type="button" onClick={onCreate} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700">
          <AppIcon className="ri-add-line"></AppIcon>
          Create programme
        </button>
      </div>
    </div>
  );
}

function normaliseHex(value: string, fallback = '#6941c6') {
  const candidate = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(candidate)) return candidate;
  if (/^[0-9a-f]{6}$/i.test(candidate)) return `#${candidate}`;
  return fallback;
}

function normalise(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function ksbCodeSort(a: string, b: string) {
  const parse = (value: string) => {
    const match = value.toUpperCase().match(/^([KSB])(\d+(?:\.\d+)?)$/);
    const familyOrder = { K: 0, S: 1, B: 2 }[match?.[1] as 'K' | 'S' | 'B'] ?? 9;
    const parts = (match?.[2] || value).split('.').map(part => Number(part) || 0);
    return { familyOrder, parts, value };
  };
  const left = parse(a);
  const right = parse(b);
  if (left.familyOrder !== right.familyOrder) return left.familyOrder - right.familyOrder;
  for (let index = 0; index < Math.max(left.parts.length, right.parts.length); index += 1) {
    const diff = (left.parts[index] || 0) - (right.parts[index] || 0);
    if (diff !== 0) return diff;
  }
  return left.value.localeCompare(right.value);
}

function ksbSourceFamily(type: unknown, code: unknown): ProgrammeKsbSourceItem['family'] {
  const family = normalise(type);
  const cleanCode = normalise(code);
  if (family.startsWith('skill') || cleanCode.startsWith('s')) return 'skills';
  if (family.startsWith('behaviour') || family.startsWith('behavior') || cleanCode.startsWith('b')) return 'behaviours';
  return 'knowledge';
}

function programmeKsbSourceItems(review: ProgrammeKsbSourceReview): ProgrammeKsbSourceItem[] {
  const standardKsbs = review.standard?.ksbs || review.standard?.sampleKsbs || [];
  return standardKsbs.map((entry, index) => {
    const code = programmeKsbCode(entry.code);
    return {
      id: String(entry.id || entry.code || `standard-ksb-${index}`),
      code,
      title: code,
      description: String(entry.description || '').trim(),
      type: String(entry.type || '').trim(),
      family: ksbSourceFamily(entry.type, code),
    };
  });
}

function moduleKsbCascadeId(module: CurriculumModule) {
  const candidates = [
    module.moduleCatalogueId,
    module.catalogueId,
    module.structureId,
    module.moduleId,
    ...(module.relatedCatalogueIds || []),
  ].map(value => String(value || '').trim());
  const canonical = candidates.find(value => /^MOD-[A-Z0-9][A-Z0-9_-]*$/i.test(value));
  return canonical || candidates.find(value => value && !value.startsWith('training-module-')) || '';
}

function programmeModulesForKsbCascade(programme: CurriculumProgramme, modules: CurriculumModule[]) {
  const uniqueModules = new Map<string, CurriculumModule>();
  modules.forEach(module => {
    if (!matchesProgramme(programme, module.programmeId) && !matchesProgramme(programme, module.programme)) return;
    const id = moduleKsbCascadeId(module);
    if (!id) return;
    uniqueModules.set(id, module);
  });
  return Array.from(uniqueModules.entries()).map(([id, module]) => ({ id, module }));
}

async function cascadeKsbSourceToProgrammeModules(programme: CurriculumProgramme, modules: CurriculumModule[], ksbProfileSourceId: string) {
  const programmeModules = programmeModulesForKsbCascade(programme, modules);
  if (!programmeModules.length) return 0;
  await Promise.all(programmeModules.map(({ id, module }) => updateCurriculumModule(id, {
    name: module.name,
    programmeId: programme.sourceId || programme.id,
    programmeName: programme.name,
    programme: programme.name,
    color: module.color,
    notes: visibleNotes(module.notes),
    ksbProfileSourceId,
  })));
  return programmeModules.length;
}

function standardCountsLabel(standard: CurriculumStandard) {
  return `${standard.knowledge || 0} K / ${standard.skills || 0} S / ${standard.behaviours || 0} B`;
}

function resolveProgrammeAppliedKsbSource(programme: CurriculumProgramme, standards: CurriculumStandard[]): ProgrammeAppliedKsbSource {
  const explicitSource = String(programme.ksbProfileSourceId || '').trim();
  if (explicitSource) {
    // Only `standard:<id>` exists now; a bare or older-prefixed id is read as a
    // standard id so a real assignment never shows as "No KSB source".
    const explicitId = explicitSource.replace(/^(profile|framework|standard):/i, '');
    const standard = standards.find(item => normalise(item.id) === normalise(explicitId));
    if (standard) {
      return {
        value: `standard:${standard.id}`,
        kind: 'standard',
        title: standard.name || standard.standardRef || 'KSB standard',
        subtitle: `${standard.code || standard.standardRef || 'Standard'} - ${standard.level || standard.levelValue || programme.level || 'Level not set'}`,
        detail: standardCountsLabel(standard),
        ksbCount: (standard.knowledge || 0) + (standard.skills || 0) + (standard.behaviours || 0),
        standard,
      };
    }
    // The programme row is the authority for whether a source is assigned; the
    // standards arrive in a separate request and must not erase it while loading.
    return {
      value: `standard:${explicitId}`,
      kind: 'standard',
      title: programme.standard || 'Assigned KSB standard',
      subtitle: `Source ${explicitId} - details are loading`,
      detail: 'Assigned',
      ksbCount: Math.max(1, Number(programme.ksbTotal || 0)),
    };
  }

  return {
    value: '',
    kind: 'none',
    title: 'Choose a KSB standard',
    subtitle: 'Coverage will not be measured against a selected source yet',
    detail: 'Not applied',
    ksbCount: 0,
  };
}

// A code reads exactly as its source stores it. A standard's K13 is its
// thirteenth knowledge item; showing it as K1.3 invents a sub-item the
// standard does not have.
function programmeKsbCode(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

function programmeKsbSourceType(sourceType?: string, sourceId?: string) {
  const explicit = normalise(sourceType);
  if (explicit) return explicit === 'profile' ? 'framework' : explicit;
  const id = String(sourceId || '').trim().toLowerCase();
  if (id.startsWith('standard:')) return 'standard';
  return id ? 'framework' : '';
}

function programmeKsbSourceId(sourceId?: string) {
  return normalise(String(sourceId || '').replace(/^(profile|framework|standard):/i, ''));
}

function programmeKsbDescriptionKeys(code: string, sourceType?: string, sourceId?: string) {
  const formatted = programmeKsbCode(code);
  const codes = [...new Set([formatted, formatted.replace('.', ''), String(code || '').trim().toUpperCase()].filter(Boolean))];
  const type = programmeKsbSourceType(sourceType, sourceId);
  const source = programmeKsbSourceId(sourceId);
  return codes.flatMap(item => [
    type || source ? `${type}|${source}|${item}` : '',
    `||${item}`,
  ]).filter(Boolean);
}

function addProgrammeKsbDescription(lookup: Map<string, string>, code: string, description: string, sourceType?: string, sourceId?: string) {
  const text = String(description || '').trim();
  if (!code || !text || normalise(text) === normalise(code)) return;
  programmeKsbDescriptionKeys(code, sourceType, sourceId).forEach(key => {
    if (!lookup.has(key)) lookup.set(key, text);
  });
}

function buildProgrammeKsbDescriptionLookup(standards: CurriculumStandard[]) {
  const lookup = new Map<string, string>();
  standards.forEach(standard => {
    const sourceIds = [standard.id, standard.code, standard.standardRef, standard.name].filter(Boolean);
    (standard.ksbs || standard.sampleKsbs || []).forEach(entry => {
      sourceIds.forEach(sourceId => addProgrammeKsbDescription(lookup, entry.code, entry.description, 'standard', sourceId));
      addProgrammeKsbDescription(lookup, entry.code, entry.description);
    });
  });
  return lookup;
}

function programmeKsbDescription(item: CurriculumKsbCoverageItem, descriptions: Map<string, string>) {
  const direct = String(item.description || '').trim();
  if (direct && normalise(direct) !== normalise(item.code)) return direct;
  const sourceType = String(item.sourceType || item.source_type || '').trim();
  const sourceId = String(item.sourceId || item.source_id || '').trim();
  for (const key of programmeKsbDescriptionKeys(item.code, sourceType, sourceId)) {
    const found = descriptions.get(key);
    if (found) return found;
  }
  return '';
}

function ksbFamily(item: CurriculumKsbCoverageItem) {
  const explicit = normalise(item.ksbType || item.ksb_type);
  if (explicit.startsWith('skill')) return 'skills';
  if (explicit.startsWith('behaviour') || explicit.startsWith('behavior')) return 'behaviours';
  if (explicit.startsWith('knowledge')) return 'knowledge';
  const code = normalise(item.code);
  if (code.startsWith('s')) return 'skills';
  if (code.startsWith('b')) return 'behaviours';
  return 'knowledge';
}

function isRawKsbSource(value: unknown) {
  const text = String(value || '').trim();
  return !text
    || /^profile\s*-\s*(ksb-|ksbp-)/i.test(text)
    || /^(ksb-|ksbp-|profile:|standard:)/i.test(text);
}

function coverageSourceLabel(item: CurriculumKsbCoverageItem) {
  return String(item.sourceLabel || item.source_label || item.sourceName || item.source_name || '').trim();
}

function isReadableAppliedKsbCoverageItem(item: CurriculumKsbCoverageItem) {
  const source = coverageSourceLabel(item);
  const mappings = item.mappings || [];
  return mappings.some(mappingHasDetailedPlacement)
    && Boolean(source)
    && !isRawKsbSource(source);
}

function mappingHasDetailedPlacement(mapping: CurriculumKsbTraceMapping) {
  const level = normalise(mapping.mappingLevel || mapping.mapping_level);
  return level !== 'module'
    && Boolean(mapping.componentName || mapping.component_name || mapping.weekName || mapping.week_name);
}

function programmeKsbPlacementLabel(mapping: CurriculumKsbTraceMapping) {
  const moduleName = String(mapping.moduleName || mapping.module_name || 'Module').trim();
  const weekName = String(mapping.weekName || mapping.week_name || '').trim();
  const componentName = String(mapping.componentName || mapping.component_name || '').trim();
  const componentType = String(mapping.componentType || mapping.component_type || '').trim();
  return [moduleName, weekName, componentName || componentType].filter(Boolean).join(' / ');
}

function matchesProgramme(programme: CurriculumProgramme, value: unknown) {
  const key = normalise(value);
  return [programme.id, programme.sourceId, programme.name, programme.standard].some(candidate => normalise(candidate) === key);
}

function Metric({ label, value, onOpen, hint }: { label: string; value: string; onOpen?: (event: { stopPropagation: () => void }) => void; hint?: string }) {
  const body = (
    <>
      <p className="truncate text-[9px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold text-foreground-950">{value}</p>
    </>
  );
  const shell = 'programmes-metric min-w-0 rounded-lg bg-background-50 px-2.5 py-2 ring-1 ring-primary-100/80';
  if (!onOpen) return <div className={shell}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={hint}
      className={`${shell} programmes-metric-link block w-full text-left transition-smooth hover:bg-primary-50 hover:ring-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400`}
    >
      {body}
    </button>
  );
}
