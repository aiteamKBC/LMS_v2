import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import type { CurriculumCohort, CurriculumModule } from '@/lib/curriculumApi';
import { cleanText, formatDateLabel, matchesSearch, normaliseKey } from '../shared/entities/model';
import {
  EntityEmptyState,
  EntityFilterBar,
  EntityHero,
  EntityTable,
  InlineError,
  PlainCell,
  StackedCell,
} from '../shared/entities/ui';

/**
 * Publication state, read off the records themselves.
 *
 * There is no publishing workflow table: a module is published or not according
 * to the authoring status the Module Builder saves, and it is "in delivery"
 * because a delivery row attaches it to a group inside a cohort. This page
 * crosses those two facts, and the crossing is the whole point of it — a module
 * still being authored while an active cohort is already delivering it is the
 * one combination nobody sees from either record on its own.
 *
 * The unit is the authored module (`moduleCatalogueId`), not the delivery row.
 * One authored module delivered to four groups is one row here with four
 * attachments, because publishing it once publishes it for all four.
 */

type PublicationState = 'live' | 'ready' | 'draft-in-delivery' | 'draft';

interface PublishedRow {
  key: string;
  catalogueId: string;
  name: string;
  programme: string;
  programmeId: string;
  authoringStatus: string;
  state: PublicationState;
  /** Delivery rows pointing at this authored module. */
  attachments: number;
  activeCohorts: string[];
  cohorts: string[];
  groups: string[];
  learners: number;
  weeks: number;
  ksbCount: number;
  lastUpdated: string;
  href: string;
}

const STATE_COPY: Record<PublicationState, { label: string; tone: string; icon: string; detail: string }> = {
  live: {
    label: 'Live',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: 'ri-check-double-line',
    detail: 'Published and delivered by an active cohort.',
  },
  ready: {
    label: 'Ready',
    tone: 'border-sky-200 bg-sky-50 text-sky-700',
    icon: 'ri-check-line',
    detail: 'Published, but no active cohort is delivering it.',
  },
  'draft-in-delivery': {
    label: 'Draft in delivery',
    tone: 'border-red-200 bg-red-50 text-red-700',
    icon: 'ri-alert-line',
    detail: 'An active cohort is delivering content that is not published.',
  },
  draft: {
    label: 'Draft',
    tone: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: 'ri-draft-line',
    detail: 'Still being authored. Nothing is delivering it.',
  },
};

const STATE_ORDER: PublicationState[] = ['draft-in-delivery', 'live', 'ready', 'draft'];

const SORT_OPTIONS = [
  { value: 'attention', label: 'Needs attention first' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'name', label: 'Module name' },
  { value: 'programme', label: 'Programme' },
];

export default function CurriculumPublished() {
  const { data, loading, error, reload } = useCurriculumData({ compact: true });
  const [search, setSearch] = useState('');
  const [programmeFilter, setProgrammeFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [sort, setSort] = useState('attention');

  const modules = useMemo(() => data?.modules ?? [], [data?.modules]);
  const cohorts = useMemo(() => data?.cohorts ?? [], [data?.cohorts]);
  const groups = useMemo(() => data?.groups ?? [], [data?.groups]);

  const rows = useMemo(() => buildRows(modules, cohorts, groups), [modules, cohorts, groups]);

  const programmeOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const row of rows) {
      const key = normaliseKey(row.programme);
      if (key && !names.has(key)) names.set(key, row.programme);
    }
    return [...names.entries()]
      .sort((left, right) => left[1].localeCompare(right[1]))
      .map(([value, label]) => ({ value, label }));
  }, [rows]);

  const counts = useMemo(() => {
    const tally: Record<PublicationState, number> = { live: 0, ready: 0, 'draft-in-delivery': 0, draft: 0 };
    for (const row of rows) tally[row.state] += 1;
    return tally;
  }, [rows]);

  const visible = useMemo(() => {
    const filtered = rows.filter(row => {
      if (programmeFilter && normaliseKey(row.programme) !== programmeFilter) return false;
      if (stateFilter && row.state !== stateFilter) return false;
      return matchesSearch(search, [row.name, row.programme, row.catalogueId, ...row.cohorts, ...row.groups]);
    });
    return sortRows(filtered, sort);
  }, [rows, programmeFilter, stateFilter, search, sort]);

  const atRisk = counts['draft-in-delivery'];
  const dirty = Boolean(search || programmeFilter || stateFilter) || sort !== 'attention';

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="Published Content"
      pageSubtitle="What is live, what is ready, and what is being delivered before it was finished"
    >
      <div className="min-h-full space-y-4 bg-background-100 p-4 sm:p-5 lg:p-6">
        <EntityHero
          eyebrow="Publication state"
          title="Published Content"
          description="Authoring status crossed with delivery. Every figure is read from the module records and the cohorts delivering them — there is no separate publishing workflow to fall out of step with."
          stats={[
            { icon: 'ri-check-double-line', label: 'Live', value: counts.live, detail: 'Published and delivering' },
            { icon: 'ri-check-line', label: 'Ready', value: counts.ready, detail: 'Published, not delivering' },
            { icon: 'ri-alert-line', label: 'Draft in delivery', value: counts['draft-in-delivery'], detail: 'Unpublished, being taught' },
            { icon: 'ri-draft-line', label: 'Draft', value: counts.draft, detail: 'Still being authored' },
          ]}
          loading={loading}
        />

        {error && <InlineError message={`Live curriculum data could not be loaded: ${error}`} onRetry={() => void reload()} />}

        {!loading && atRisk > 0 && (
          <button
            type="button"
            onClick={() => setStateFilter('draft-in-delivery')}
            className="flex w-full items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-left transition-smooth hover:bg-red-100"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-red-600">
              <AppIcon className="ri-alert-line text-lg"></AppIcon>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-bold text-red-800">
                {atRisk} {atRisk === 1 ? 'module is' : 'modules are'} being delivered before publication
              </span>
              <span className="mt-0.5 block text-[11px] text-red-700">
                An active cohort is running content whose authoring status is not published. Show only those.
              </span>
            </span>
            <AppIcon className="ri-arrow-right-line text-red-600"></AppIcon>
          </button>
        )}

        <EntityFilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search modules, programmes, cohorts or groups..."
          selects={[
            {
              label: 'Programme',
              value: programmeFilter,
              onChange: setProgrammeFilter,
              options: programmeOptions,
            },
            {
              label: 'Publication state',
              value: stateFilter,
              onChange: setStateFilter,
              options: STATE_ORDER.map(state => ({ value: state, label: `${STATE_COPY[state].label} (${counts[state]})` })),
            },
          ]}
          sort={{ value: sort, onChange: setSort, options: SORT_OPTIONS, defaultValue: 'attention', label: 'Order' }}
          onReset={() => { setSearch(''); setProgrammeFilter(''); setStateFilter(''); setSort('attention'); }}
          isDirty={dirty}
          disabled={!loading && !rows.length}
          summary={
            loading
              ? 'Reading module records...'
              : `${visible.length} of ${rows.length} authored ${rows.length === 1 ? 'module' : 'modules'}${
                  rows.length === modules.length ? '' : ` · ${modules.length} delivery rows across them`
                }`
          }
        />

        <EntityTable
          columns={[
            { label: 'Module' },
            { label: 'Programme' },
            { label: 'State' },
            { label: 'Delivery' },
            { label: 'KSBs', align: 'right' },
            { label: 'Weeks', align: 'right' },
            { label: 'Last updated' },
          ]}
          gridClass="grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_70px_70px_minmax(0,1fr)]"
          rows={visible}
          rowKey={row => row.key}
          getRowHref={row => row.href}
          loading={loading}
          renderRow={row => <PublishedRowCells row={row} />}
          empty={
            rows.length ? (
              <EntityEmptyState
                icon="ri-filter-off-line"
                title="No modules match these filters"
                message="Clear the search or the filters above to see the full publication picture."
              />
            ) : (
              <EntityEmptyState
                icon="ri-book-open-line"
                title="No authored modules yet"
                message="Publication state is read from module records. Build a module and it appears here."
              />
            )
          }
        />
      </div>
    </WorkspaceShell>
  );
}

function PublishedRowCells({ row }: { row: PublishedRow }) {
  const state = STATE_COPY[row.state];
  return (
    <>
      <StackedCell primary={row.name} secondary={row.catalogueId || 'No catalogue id'} />
      <PlainCell>{row.programme || 'Unassigned programme'}</PlainCell>
      <PlainCell>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${state.tone}`} title={state.detail}>
          <AppIcon className={`${state.icon} text-[11px]`}></AppIcon>
          {state.label}
        </span>
      </PlainCell>
      <PlainCell>
        {row.attachments ? (
          <span className="block text-[12px] text-foreground-700">
            {row.activeCohorts.length
              ? `${row.activeCohorts.length} active ${row.activeCohorts.length === 1 ? 'cohort' : 'cohorts'}`
              : 'No active cohort'}
            <span className="mt-0.5 block text-[11px] text-foreground-400">
              {row.groups.length} {row.groups.length === 1 ? 'group' : 'groups'} · {row.learners} {row.learners === 1 ? 'learner' : 'learners'}
            </span>
          </span>
        ) : (
          <span className="text-[12px] text-foreground-400">Not attached to delivery</span>
        )}
      </PlainCell>
      <PlainCell align="right">
        <span className={row.ksbCount ? 'text-foreground-800' : 'font-bold text-amber-700'}>
          {row.ksbCount || 'None'}
        </span>
      </PlainCell>
      <PlainCell align="right">{row.weeks || '—'}</PlainCell>
      <PlainCell>{formatDateLabel(row.lastUpdated)}</PlainCell>
    </>
  );
}

// --------------------------------------------------------------- derivation

function buildRows(
  modules: CurriculumModule[],
  cohorts: CurriculumCohort[],
  groups: Array<{ id: string; name: string; learners: number }>,
): PublishedRow[] {
  const cohortById = new Map<string, CurriculumCohort>();
  for (const cohort of cohorts) {
    const key = normaliseKey(cohort.id);
    if (key) cohortById.set(key, cohort);
  }
  const groupById = new Map<string, { id: string; name: string; learners: number }>();
  for (const group of groups) {
    const key = normaliseKey(group.id);
    if (key) groupById.set(key, group);
  }

  const byCatalogue = new Map<string, PublishedRow>();
  for (const module of modules) {
    if (module.isProgrammeDeleted) continue;
    const catalogueId = cleanText(module.moduleCatalogueId || module.catalogueId);
    const key = normaliseKey(catalogueId) || normaliseKey(module.id) || normaliseKey(module.name);
    if (!key) continue;

    let row = byCatalogue.get(key);
    if (!row) {
      row = {
        key,
        catalogueId,
        name: cleanText(module.name, 'Untitled module'),
        programme: cleanText(module.programme),
        programmeId: cleanText(module.programmeId),
        authoringStatus: publicationStatus(module),
        state: 'draft',
        attachments: 0,
        activeCohorts: [],
        cohorts: [],
        groups: [],
        learners: 0,
        weeks: Number(module.weeks || 0),
        ksbCount: Number(module.ksbCount || 0),
        lastUpdated: cleanText(module.lastUpdated),
        href: moduleHref(catalogueId, module),
      };
      byCatalogue.set(key, row);
    }

    // The authored module is one record seen through several delivery rows, so
    // each row can only add to what is known: the highest authoring status
    // wins, and the counts that vary per row (weeks, KSBs) take the largest
    // figure any row reports rather than the last one read.
    row.authoringStatus = strongerStatus(row.authoringStatus, publicationStatus(module));
    row.weeks = Math.max(row.weeks, Number(module.weeks || 0));
    row.ksbCount = Math.max(row.ksbCount, Number(module.ksbCount || 0));
    if (cleanText(module.lastUpdated) > row.lastUpdated) row.lastUpdated = cleanText(module.lastUpdated);
    if (!row.programme) row.programme = cleanText(module.programme);

    const cohortName = cleanText(module.cohort);
    const cohort = cohortById.get(normaliseKey(module.cohortId)) || findCohortByName(cohorts, cohortName);
    const groupName = cleanText(module.group);
    const group = groupById.get(normaliseKey(module.groupId));

    if (cohort || group || cohortName || groupName) {
      row.attachments += 1;
      const resolvedCohort = cleanText(cohort?.name || cohortName);
      const resolvedGroup = cleanText(group?.name || groupName);
      if (resolvedCohort && !row.cohorts.includes(resolvedCohort)) row.cohorts.push(resolvedCohort);
      if (resolvedGroup && !row.groups.includes(resolvedGroup)) {
        row.groups.push(resolvedGroup);
        row.learners += Number(group?.learners || 0);
      }
      if (cohort && normaliseKey(cohort.status) === 'active' && !row.activeCohorts.includes(resolvedCohort)) {
        row.activeCohorts.push(resolvedCohort);
      }
    }
  }

  for (const row of byCatalogue.values()) {
    row.state = publicationState(row);
  }
  return [...byCatalogue.values()];
}

/** Authoring status is the publishing signal; delivery status is not. */
function publicationStatus(module: CurriculumModule): string {
  return normaliseKey(module.authoringStatus || module.status) || 'draft';
}

const STATUS_RANK: Record<string, number> = { draft: 0, review: 1, published: 2 };

function strongerStatus(left: string, right: string): string {
  return (STATUS_RANK[right] ?? 0) > (STATUS_RANK[left] ?? 0) ? right : left;
}

function publicationState(row: PublishedRow): PublicationState {
  const published = row.authoringStatus === 'published';
  const delivering = row.activeCohorts.length > 0;
  if (published) return delivering ? 'live' : 'ready';
  return delivering ? 'draft-in-delivery' : 'draft';
}

function findCohortByName(cohorts: CurriculumCohort[], name: string): CurriculumCohort | undefined {
  const key = normaliseKey(name);
  if (!key) return undefined;
  return cohorts.find(cohort => normaliseKey(cohort.name) === key);
}

function moduleHref(catalogueId: string, module: CurriculumModule): string {
  const identifier = catalogueId || cleanText(module.id);
  return identifier
    ? `/curriculum/module-builder?module=${encodeURIComponent(identifier)}`
    : '/curriculum/module-builder';
}

function sortRows(rows: PublishedRow[], sort: string): PublishedRow[] {
  const ordered = [...rows];
  if (sort === 'name') return ordered.sort((left, right) => left.name.localeCompare(right.name));
  if (sort === 'programme') {
    return ordered.sort((left, right) => left.programme.localeCompare(right.programme) || left.name.localeCompare(right.name));
  }
  if (sort === 'updated') {
    return ordered.sort((left, right) => right.lastUpdated.localeCompare(left.lastUpdated) || left.name.localeCompare(right.name));
  }
  // Attention order: the risky combination first, then live delivery, then the
  // rest — so the top of the list is always what someone has to act on.
  return ordered.sort((left, right) => {
    const rank = STATE_ORDER.indexOf(left.state) - STATE_ORDER.indexOf(right.state);
    if (rank !== 0) return rank;
    return right.lastUpdated.localeCompare(left.lastUpdated) || left.name.localeCompare(right.name);
  });
}
