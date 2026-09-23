// ============================================================================
// The Curriculum archive — one page for everything archived anywhere in it.
//
// Archiving already worked per list: the Programmes, Cohorts, Groups and Module
// Builder pages each carry a "View archived" toggle over their own records. What
// none of them can answer is the question a reader actually arrives with — "we
// archived something last month, where is it?" — because answering it meant
// knowing which of the four lists the record had left, and then finding that
// page's toggle.
//
// This is that question's home. The four archives are read together and shown as
// one list, so a record is found by its name rather than by remembering its
// type, and the two things the archive exists for — putting a record back, or
// finishing the delete — are offered on the row.
//
// It is not a fifth implementation of them. Every confirm here is the same
// helper the archive actions call (`../shared/entities/archive`), so the
// wording, the cascade warnings and the API calls are shared; what this page
// adds is only the reading of all four lists at once.
//
// Programmes and the Module Builder no longer carry their own "View archive"
// toggle — they send the reader here, filtered by ?type=, because two places
// showing the same archived record is how the two drift. The Archive action on
// their rows stays where it is: putting a record *into* the archive belongs
// next to the record, and only reading it back belongs here.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  fetchArchivedCurriculumCohorts,
  fetchArchivedCurriculumGroups,
  fetchArchivedCurriculumModules,
  fetchArchivedModuleStructure,
  fetchCurriculumProgrammes,
  type CurriculumArchivedCohort,
  type CurriculumArchivedGroup,
  type CurriculumArchivedModule,
  type CurriculumArchivedModuleStructure,
  type CurriculumArchivedModuleWeek,
  type CurriculumProgramme,
} from '@/lib/curriculumApi';
import { AppIcon } from '@/components/feature/AppIcon';
import { getComponentDefinition } from '../module-builder/componentAuthoringModel';
import {
  permanentlyDeleteCohortWithConfirm,
  permanentlyDeleteGroupWithConfirm,
  permanentlyDeleteModuleWithConfirm,
  permanentlyDeleteProgrammeWithConfirm,
  restoreCohortWithConfirm,
  restoreGroupWithConfirm,
  restoreModuleWithConfirm,
  restoreProgrammeWithConfirm,
} from '../shared/entities/archive';
import { ArchiveNotice } from '../shared/entities/archiveView';
import { cleanText, formatDateLabel, formatDateTimeLabel, matchesSearch } from '../shared/entities/model';
import {
  DetailRow,
  EntityDrawer,
  EntityEmptyState,
  EntityFilterBar,
  EntityHero,
  EntityTable,
  InlineError,
  NamedActions,
  ParentBadge,
  PlainCell,
  StackedCell,
} from '../shared/entities/ui';

// --------------------------------------------------------------- the row shape

type ArchiveKind = 'programme' | 'cohort' | 'group' | 'module';

/**
 * One archived record, whatever kind it is.
 *
 * The four endpoints answer with four different shapes, and the columns a reader
 * needs are the same for all of them: what it is called, what kind of thing it
 * is, where in the curriculum it sat, what is still inside it, and when it was
 * archived. Flattening to this row once — rather than rendering four tables — is
 * what lets the page be searched as a single list.
 *
 * `restoreBlockedBy` and `deleteBlockedBy` hold the reason an action cannot run
 * rather than a bare boolean: both are shown on the button, so the reader is
 * told what to do about it before the click instead of reading a 409 after.
 */
interface ArchiveRow {
  key: string;
  kind: ArchiveKind;
  id: string;
  name: string;
  /** The line under the name: its own identifier, as the source list reports it. */
  reference: string;
  /** Programme › cohort › group, as far up as this kind of record goes. */
  parents: string[];
  /** The programme it belongs to, for the programme filter. */
  programmeId: string;
  programme: string;
  /** What a restore brings back and a permanent delete destroys, already worded. */
  contents: string;
  /**
   * The same figures unworded, as the source list reported them. The confirms
   * name them in their own sentences ("its 8 components come back with it"), so
   * they are carried rather than parsed back out of `contents` — a number that
   * has been through a sentence and back is a number that can be wrong.
   */
  counts: { cohorts: number; groups: number; modules: number; weeks: number; components: number };
  /**
   * The record's own fields, for the details panel — everything the archive
   * endpoint reported that the six columns have no room for.
   *
   * Built here rather than read off a detail endpoint because there is no detail
   * endpoint an archived record survives: every workspace page reads the
   * curriculum overview payload, which excludes archived rows, so opening one
   * there answers "not found". What the archive lists return is what is knowable
   * about a record while it is in the archive, and this is all of it.
   *
   * A field the source left empty is dropped rather than shown as a dash, so the
   * panel is a list of what is known instead of a form with holes in it.
   */
  details: Array<{ label: string; value: string }>;
  /** ISO, or '' for a programme — no archive stamp is stored for one. */
  archivedAt: string;
  /** The write handler that archived it, when the list reports one. */
  archivedBy: string;
  restoreBlockedBy: string;
  deleteBlockedBy: string;
}

const KIND_LABEL: Record<ArchiveKind, string> = {
  programme: 'Programme',
  cohort: 'Cohort',
  group: 'Group',
  module: 'Module',
};

const KIND_ICON: Record<ArchiveKind, string> = {
  programme: 'ri-stack-line',
  cohort: 'ri-calendar-event-line',
  group: 'ri-team-line',
  module: 'ri-book-2-line',
};

// Newest archive first: the archive is read to act on what was just put in it
// far more often than to browse what has been sitting there. A programme has no
// stamp to sort by and sorts to the end of its own date-less group.
const KIND_ORDER: ArchiveKind[] = ['programme', 'cohort', 'group', 'module'];

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Joins the non-empty parts of a contents summary; '—' when there is nothing to say. */
function summarise(parts: Array<string | false | 0 | null | undefined>): string {
  const kept = parts.filter((part): part is string => Boolean(part));
  return kept.length ? kept.join(' · ') : '—';
}

/**
 * Keep only the detail fields the source actually filled in.
 *
 * An archived record is read from whatever the authoring tables still hold, and
 * a blank there means the field was never set — not that it is unknown. Showing
 * it as a dash puts a row in the panel that says nothing; leaving it out says
 * the same thing more honestly and keeps the panel short enough to read.
 */
function detailsOf(fields: Array<[string, unknown]>): Array<{ label: string; value: string }> {
  return fields
    .map(([label, value]) => ({ label, value: cleanText(value) }))
    .filter(field => field.value && field.value !== '—');
}

/**
 * Why the archive stamp matters on the row: a record that came here on a
 * parent's coat-tails is not restored on its own — the parent is what to
 * restore, and the endpoint refuses until it is back.
 */
const VIA_PARENT_LABEL: Record<string, string> = {
  'programme-delete': 'With its programme',
  'cohort-delete': 'With its cohort',
  'group-delete': 'With its group',
};

function programmeIsArchived(programme: CurriculumProgramme) {
  if (typeof programme.isArchived === 'boolean') return programme.isArchived;
  return cleanText(programme.status).toLowerCase() === 'archived';
}

// ------------------------------------------------------------------ the loader

interface ArchiveState {
  rows: ArchiveRow[];
  counts: Record<ArchiveKind, number>;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const EMPTY_COUNTS: Record<ArchiveKind, number> = { programme: 0, cohort: 0, group: 0, module: 0 };

/**
 * Read all four archives together.
 *
 * `Promise.all`, not a sequence: they are four independent endpoints and the
 * page has nothing to show until the last of them lands either way. One failing
 * fails the read — a partial archive is worse than an error, because a record
 * missing from this list reads as "it is not archived" rather than "we could not
 * check", and that is the one wrong answer this page must not give.
 *
 * Every restore and delete calls `reload`: the row just acted on has to leave
 * the list, and the three archive endpoints deliberately bypass the client cache
 * for exactly that reason.
 */
function useCurriculumArchiveIndex(): ArchiveState {
  const [rows, setRows] = useState<ArchiveRow[]>([]);
  const [counts, setCounts] = useState<Record<ArchiveKind, number>>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [programmes, cohorts, groups, modules] = await Promise.all([
        // 'all' is what puts archived programmes in the payload at all; the
        // operational default filters them out.
        fetchCurriculumProgrammes(signal, { visibility: 'all', revalidate: true }),
        fetchArchivedCurriculumCohorts(signal),
        fetchArchivedCurriculumGroups(signal),
        fetchArchivedCurriculumModules(signal),
      ]);
      if (signal?.aborted) return;
      const archivedProgrammes = programmes.filter(programmeIsArchived);
      const next = [
        ...archivedProgrammes.map(programmeRow),
        ...cohorts.map(cohortRow),
        ...groups.map(groupRow),
        ...modules.map(moduleRow),
      ];
      setRows(next);
      setCounts({
        programme: archivedProgrammes.length,
        cohort: cohorts.length,
        group: groups.length,
        module: modules.length,
      });
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
    const controller = new AbortController();
    void run(controller.signal);
    return () => controller.abort();
  }, [run]);

  const reload = useCallback(() => run(), [run]);

  return { rows, counts, loading, loaded, error, reload };
}

// ------------------------------------------------- four shapes into one row

function programmeRow(programme: CurriculumProgramme): ArchiveRow {
  const id = programme.sourceId || programme.id;
  return {
    key: `programme:${id}`,
    kind: 'programme',
    id,
    name: cleanText(programme.name, 'Untitled programme'),
    reference: summarise([cleanText(programme.standard), cleanText(programme.level) && `Level ${programme.level}`]),
    parents: [],
    programmeId: id,
    programme: cleanText(programme.name),
    contents: summarise([
      programme.cohorts ? plural(programme.cohorts, 'cohort') : '',
      programme.groups ? plural(programme.groups, 'group') : '',
      programme.modules ? plural(programme.modules, 'module') : '',
    ]),
    counts: {
      cohorts: programme.cohorts || 0,
      groups: programme.groups || 0,
      modules: programme.modules || 0,
      weeks: 0,
      components: 0,
    },
    details: detailsOf([
      ['Standard', programme.standard],
      ['Level', programme.level],
      ['Owner', programme.owner],
      ['Cohorts', programme.cohorts || ''],
      ['Groups', programme.groups || ''],
      ['Modules', programme.modules || ''],
      ['Weeks', programme.weeks || ''],
      ['Learners', programme.learners || ''],
      ['KSBs mapped', programme.ksbTotal ? `${programme.ksbMapped} of ${programme.ksbTotal}` : ''],
      ['Last updated', programme.lastUpdated ? formatDateLabel(programme.lastUpdated) : ''],
      ['Created', programme.createdAt ? formatDateLabel(programme.createdAt) : ''],
      ['Description', programme.description],
    ]),
    // No authoring table stamps a programme archive, so rather than showing a
    // date that is really "last edited", the column says what it does know.
    archivedAt: '',
    archivedBy: '',
    restoreBlockedBy: '',
    // Learner delivery is what refuses a programme delete, and the count is not
    // in this payload — the endpoint's own refusal names it after the click.
    deleteBlockedBy: '',
  };
}

function cohortRow(cohort: CurriculumArchivedCohort): ArchiveRow {
  return {
    key: `cohort:${cohort.id}`,
    kind: 'cohort',
    id: cohort.id,
    name: cleanText(cohort.name, 'Untitled cohort'),
    reference: cohort.id,
    parents: [cleanText(cohort.programme)].filter(Boolean),
    programmeId: cleanText(cohort.programmeId),
    programme: cleanText(cohort.programme),
    contents: summarise([
      cohort.groups ? plural(cohort.groups, 'group') : '',
      cohort.learners ? plural(cohort.learners, 'learner') : '',
    ]),
    counts: { cohorts: 0, groups: cohort.groups || 0, modules: 0, weeks: 0, components: 0 },
    details: detailsOf([
      ['Programme', cohort.programme],
      ['Start', cohort.startDate && formatDateLabel(cohort.startDate)],
      ['Practical end', cohort.practicalEndDate && formatDateLabel(cohort.practicalEndDate)],
      ['Apprenticeship end', cohort.apprenticeshipEndDate && formatDateLabel(cohort.apprenticeshipEndDate)],
      ['End', cohort.endDate && formatDateLabel(cohort.endDate)],
      ['Duration', cohort.durationMonths ? plural(cohort.durationMonths, 'month') : ''],
      ['EPA window', cohort.epaMonths ? plural(cohort.epaMonths, 'month') : ''],
      ['Groups archived with it', cohort.groups || ''],
      ['Learners still placed here', cohort.learners || ''],
    ]),
    archivedAt: cohort.archivedAt,
    archivedBy: cohort.archivedBy,
    restoreBlockedBy: '',
    deleteBlockedBy: cohort.learners
      ? `${plural(cohort.learners, 'learner')} are still placed here — move them first`
      : '',
  };
}

function groupRow(group: CurriculumArchivedGroup): ArchiveRow {
  return {
    key: `group:${group.id}`,
    kind: 'group',
    id: group.id,
    name: cleanText(group.name, 'Untitled group'),
    reference: summarise([cleanText(group.coach) && `Coach ${group.coach}`, cleanText(group.schedule)]),
    parents: [cleanText(group.programme), cleanText(group.cohort)].filter(Boolean),
    programmeId: cleanText(group.programmeId),
    programme: cleanText(group.programme),
    contents: group.learners ? plural(group.learners, 'learner') : '—',
    counts: { cohorts: 0, groups: 0, modules: 0, weeks: 0, components: 0 },
    details: detailsOf([
      ['Programme', group.programme],
      ['Cohort', group.cohort],
      ['Coach', group.coach],
      ['Delivery days', group.weekDays],
      ['Starts', group.startTime],
      ['Ends', group.endTime],
      ['Schedule', group.schedule],
      ['Learners still placed here', group.learners || ''],
    ]),
    archivedAt: group.archivedAt,
    archivedBy: group.archivedBy,
    // The endpoint refuses this, because a group restored under an archived
    // cohort has nothing to come back to. Restoring the cohort brings back every
    // group archived with it, so that is what the button says to do.
    restoreBlockedBy: group.cohortArchived
      ? `Its cohort is archived too — restore ${cleanText(group.cohort, 'the cohort')} instead`
      : '',
    deleteBlockedBy: group.learners
      ? `${plural(group.learners, 'learner')} are still placed here — move them first`
      : '',
  };
}

function moduleRow(module: CurriculumArchivedModule): ArchiveRow {
  return {
    key: `module:${module.id}`,
    kind: 'module',
    id: module.id,
    name: cleanText(module.title, 'Untitled module'),
    reference: summarise([cleanText(module.tutor) && `Tutor ${module.tutor}`, cleanText(module.catalogueId)]),
    parents: [cleanText(module.programme), cleanText(module.cohort), cleanText(module.group)].filter(Boolean),
    programmeId: cleanText(module.programmeId),
    programme: cleanText(module.programme),
    contents: summarise([
      module.weeks ? plural(module.weeks, 'week') : '',
      module.sessions ? plural(module.sessions, 'session') : '',
      module.components ? plural(module.components, 'component') : '',
    ]),
    counts: {
      cohorts: 0,
      groups: 0,
      modules: 0,
      weeks: module.weeks || 0,
      components: module.components || 0,
    },
    details: detailsOf([
      ['Catalogue ID', module.catalogueId],
      ['Programme', module.programme],
      ['Cohort', module.cohort],
      ['Group', module.group],
      ['Tutor', module.tutor],
      ['Weeks', module.weeks || ''],
      ['Live sessions', module.sessions || ''],
      ['Components', module.components || ''],
    ]),
    archivedAt: module.archivedAt,
    archivedBy: module.archivedBy,
    // Same reason as the group above: every catalogue list is scoped by
    // programme, so a module restored under an archived one returns invisible.
    restoreBlockedBy: module.programmeArchived
      ? `Its programme is archived too — restore ${cleanText(module.programme, 'the programme')} instead`
      : '',
    deleteBlockedBy: '',
  };
}

// ------------------------------------------- an archived module's own content

/**
 * Read the weeks and components inside an archived module, once it is opened.
 *
 * Not loaded with the archive list: the list is 161 rows on a real curriculum
 * and this is a per-module read of every week, component and KSB mapping under
 * one. It belongs to the panel, and it is thrown away when the panel closes.
 */
function useArchivedModuleStructure(moduleId: string | null) {
  const [structure, setStructure] = useState<CurriculumArchivedModuleStructure | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStructure(null);
    setError(null);
    if (!moduleId) return undefined;
    const controller = new AbortController();
    setLoading(true);
    fetchArchivedModuleStructure(moduleId, controller.signal)
      .then(result => { if (!controller.signal.aborted) setStructure(result); })
      .catch(err => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to read the weeks inside this module.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [moduleId]);

  return { structure, loading, error };
}

/** The flags a component carries, said the way the builder's own toggles are labelled. */
function componentFlags(component: CurriculumArchivedModuleWeek['components'][number]): string[] {
  return [
    component.reflectionRequired && 'Reflection',
    component.workplaceEvidenceRequired && 'Workplace evidence',
    component.tutorValidationRequired && 'Tutor validation',
    component.coachValidationRequired && 'Coach validation',
  ].filter((flag): flag is string => Boolean(flag));
}

/**
 * One week of an archived module, open or shut.
 *
 * The same reading the Module Builder's week rail gives -- the week's number and
 * title, when it was planned to run, and every component inside it with its
 * type, hours, points and KSB codes. It is not the builder: nothing here edits,
 * because an archived module is restored or removed, not changed. The component
 * type's label and icon come from `getComponentDefinition`, the builder's own
 * catalogue, so the two cannot end up calling the same component different
 * things.
 */
function ArchivedWeek({ week, open, onToggle }: {
  week: CurriculumArchivedModuleWeek;
  open: boolean;
  onToggle: () => void;
}) {
  const components = week.components || [];
  const otjh = components.reduce((sum, component) => sum + (Number(component.expectedOtjh) || 0), 0);
  return (
    <div className="overflow-hidden rounded-xl border border-foreground-200/60 bg-background-50">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-smooth hover:bg-background-100"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-[11px] font-black text-primary-700">
          {week.weekNumber}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-foreground-900">
            {cleanText(week.title, `Week ${week.weekNumber}`)}
          </span>
          <span className="block truncate text-[11px] text-foreground-400">
            {[
              // Not "no date": an archived module may never have had a schedule,
              // and the two readings are different facts.
              week.sessionDate ? formatDateLabel(week.sessionDate) : 'No date planned',
              components.length ? plural(components.length, 'component') : 'No components',
              otjh ? `${otjh} OTJH` : '',
            ].filter(Boolean).join(' · ')}
          </span>
        </span>
        <AppIcon className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} shrink-0 text-base text-foreground-400`}></AppIcon>
      </button>

      {open && (
        <div className="space-y-2 border-t border-background-200 px-3.5 py-3">
          {cleanText(week.summary) && (
            <p className="text-[12px] leading-5 text-foreground-600">{week.summary}</p>
          )}
          {!components.length && (
            <p className="text-[12px] font-semibold text-foreground-400">Nothing was authored in this week.</p>
          )}
          {components.map(component => {
            const definition = getComponentDefinition(component.type);
            const flags = componentFlags(component);
            const codes = (component.ksbMappings || [])
              .map(mapping => cleanText(mapping.code))
              .filter(Boolean);
            return (
              <div key={component.id} className="rounded-lg border border-background-200 bg-background-100/50 px-3 py-2.5">
                <div className="flex items-start gap-2.5">
                  <AppIcon className={`${definition.icon} mt-0.5 shrink-0 text-sm text-primary-600`}></AppIcon>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-foreground-900">
                      {cleanText(component.title, definition.label)}
                    </p>
                    <p className="text-[11px] text-foreground-400">
                      {[
                        definition.label,
                        component.expectedOtjh ? `${component.expectedOtjh} OTJH` : '',
                        component.points ? `${component.points} pts` : '',
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
                {cleanText(component.description) && (
                  <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-5 text-foreground-600">{component.description}</p>
                )}
                {(flags.length > 0 || codes.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {codes.map(code => (
                      <span key={code} className="rounded-full bg-primary-100 px-1.5 py-0.5 text-[10px] font-bold text-primary-700">
                        {code}
                      </span>
                    ))}
                    {flags.map(flag => (
                      <span key={flag} className="rounded-full bg-background-200 px-1.5 py-0.5 text-[10px] font-semibold text-foreground-600">
                        {flag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- the page

const GRID = 'grid grid-cols-[minmax(200px,1.4fr)_105px_minmax(165px,1.1fr)_minmax(135px,.9fr)_150px_290px]';

const COLUMNS = [
  { label: 'Record' },
  { label: 'Type' },
  { label: 'Where it sat' },
  { label: 'Still inside it' },
  { label: 'Archived' },
  { label: 'Actions', align: 'right' as const },
];

const KIND_OPTIONS = [
  { value: '', label: 'All record types' },
  ...KIND_ORDER.map(kind => ({ value: kind, label: `${KIND_LABEL[kind]}s` })),
];

export default function CurriculumArchivePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const archive = useCurriculumArchiveIndex();

  // The search is in the URL alongside the filters because this page is now the
  // only archive there is: everything that used to deep-link into a per-list
  // archive view — the audit trail's "archived" event, a colleague pasting a
  // link — has to be able to name the one record it means, not just its type.
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  // Both filters are in the URL for the same reason: "it is in the archive,
  // under Groups" has to be a link.
  const [kindFilter, setKindFilter] = useState(() => searchParams.get('type') || '');
  const [programmeFilter, setProgrammeFilter] = useState(() => searchParams.get('programme') || '');
  // The row an action is running against, so its button shows the spinner rather
  // than the whole table going quiet while a restore is in flight.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The record whose details panel is open. Held by key rather than by value so
  // a reload behind an open panel refreshes what it is showing instead of
  // leaving it on a copy of the row as it was before the restore.
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Which weeks of an open module are expanded. Reset when the panel changes
  // module, so week 3 of the last one does not open week 3 of the next.
  const [openWeekIds, setOpenWeekIds] = useState<string[]>([]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (search.trim()) next.set('q', search.trim());
    else next.delete('q');
    if (kindFilter) next.set('type', kindFilter);
    else next.delete('type');
    if (programmeFilter) next.set('programme', programmeFilter);
    else next.delete('programme');
    if (next.toString() === searchParams.toString()) return;
    setSearchParams(next, { replace: true });
  }, [search, kindFilter, programmeFilter, searchParams, setSearchParams]);

  // Built from what is actually in the archive rather than from the live
  // programme list: a programme with nothing archived under it would only be an
  // option that empties the table.
  const programmeOptions = useMemo(() => {
    const byId = new Map<string, string>();
    archive.rows.forEach(row => {
      if (!row.programmeId) return;
      if (!byId.has(row.programmeId)) byId.set(row.programmeId, row.programme || row.programmeId);
    });
    return [...byId.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [archive.rows]);

  const visible = useMemo(() => {
    const filtered = archive.rows.filter(row => {
      if (kindFilter && row.kind !== kindFilter) return false;
      if (programmeFilter && row.programmeId !== programmeFilter) return false;
      return matchesSearch(search, [
        row.name, row.reference, row.id, KIND_LABEL[row.kind], row.programme, ...row.parents,
      ]);
    });
    return filtered.sort((a, b) => {
      // Newest archive first; the date-less programmes fall to the end together
      // rather than jumping to the top on an empty string comparison.
      if (a.archivedAt && b.archivedAt && a.archivedAt !== b.archivedAt) {
        return a.archivedAt < b.archivedAt ? 1 : -1;
      }
      if (Boolean(a.archivedAt) !== Boolean(b.archivedAt)) return a.archivedAt ? -1 : 1;
      const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
      return byKind || a.name.localeCompare(b.name);
    });
  }, [archive.rows, kindFilter, programmeFilter, search]);

  const openRow = useMemo(
    () => archive.rows.find(row => row.key === openKey) || null,
    [archive.rows, openKey],
  );

  // Only a module has authored content to read; the other three kinds are
  // delivery records, and everything about them is already in the list payload.
  const moduleStructure = useArchivedModuleStructure(
    openRow && openRow.kind === 'module' ? openRow.id : null,
  );

  useEffect(() => { setOpenWeekIds([]); }, [openKey]);

  // A restore or a permanent delete run from inside the panel takes the record
  // out of the archive, so the panel it was opened from has nothing left to
  // show. Closing on the reload is what the row's own disappearance does for the
  // table.
  useEffect(() => {
    if (openKey && archive.loaded && !openRow) setOpenKey(null);
  }, [archive.loaded, openKey, openRow]);

  /**
   * Run one of the eight confirms, then re-read.
   *
   * The confirm helpers own the dialog and the API call; what is left here is
   * only what this page has to do around them — mark the row busy, and pull the
   * list again so the record that was just restored or deleted leaves it. A
   * refusal the helper re-raised is shown on the page too, because the dialog
   * that carried it has closed by the time the reader looks for it.
   */
  const runAction = async (row: ArchiveRow, action: () => Promise<boolean>) => {
    if (busyKey) return;
    setBusyKey(row.key);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Unable to update ${row.name}.`);
    } finally {
      setBusyKey(null);
    }
    await archive.reload();
  };

  const restore = (row: ArchiveRow) => {
    const after = () => {};
    switch (row.kind) {
      case 'programme':
        return runAction(row, () => restoreProgrammeWithConfirm({ id: row.id, name: row.name }, after));
      case 'cohort':
        return runAction(row, () => restoreCohortWithConfirm(
          { id: row.id, name: row.name, groups: row.counts.groups },
          after,
        ));
      case 'group':
        return runAction(row, () => restoreGroupWithConfirm(
          { id: row.id, name: row.name, cohort: row.parents[row.parents.length - 1] || '' },
          after,
        ));
      case 'module':
      default:
        return runAction(row, () => restoreModuleWithConfirm(
          {
            id: row.id,
            title: row.name,
            programme: row.programme,
            components: row.counts.components,
          },
          after,
        ));
    }
  };

  const deletePermanently = (row: ArchiveRow) => {
    const after = () => {};
    switch (row.kind) {
      case 'programme':
        return runAction(row, () => permanentlyDeleteProgrammeWithConfirm(
          {
            id: row.id,
            name: row.name,
            cohorts: row.counts.cohorts,
            groups: row.counts.groups,
            modules: row.counts.modules,
          },
          after,
        ));
      case 'cohort':
        return runAction(row, () => permanentlyDeleteCohortWithConfirm(
          { id: row.id, name: row.name, groups: row.counts.groups },
          after,
        ));
      case 'group':
        return runAction(row, () => permanentlyDeleteGroupWithConfirm({ id: row.id, name: row.name }, after));
      case 'module':
      default:
        return runAction(row, () => permanentlyDeleteModuleWithConfirm(
          {
            id: row.id,
            title: row.name,
            weeks: row.counts.weeks,
            components: row.counts.components,
          },
          after,
        ));
    }
  };

  const total = KIND_ORDER.reduce((sum, kind) => sum + archive.counts[kind], 0);

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="Archive"
      pageSubtitle="Everything archived across the curriculum, in one list"
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="min-h-full space-y-4 bg-background-50 p-4 sm:p-5 lg:p-6">
        <EntityHero
          eyebrow="Curriculum Studio"
          title="Archive"
          description="Programmes, cohorts, groups and modules that have been archived anywhere in the curriculum. Restore one to put it back where it was, or delete it for good from here."
          loading={archive.loading && !archive.loaded}
          stats={[
            { icon: 'ri-archive-line', label: 'Archived', value: total },
            { icon: KIND_ICON.programme, label: 'Programmes', value: archive.counts.programme },
            { icon: KIND_ICON.cohort, label: 'Cohorts', value: archive.counts.cohort },
            { icon: KIND_ICON.group, label: 'Groups', value: archive.counts.group },
            { icon: KIND_ICON.module, label: 'Modules', value: archive.counts.module },
          ]}
        />

        {archive.error && <InlineError message={archive.error} onRetry={() => void archive.reload()} />}
        {actionError && <InlineError message={actionError} />}

        <ArchiveNotice>
          Archived records are hidden from planning but still in the database. Restoring one puts it back in its own
          list along with whatever its archive took down with it — modules are detached when a cohort or group is
          archived, so they have to be attached again. Deleting from here is permanent and cannot be undone; learner
          accounts and learner progress are never touched either way.
        </ArchiveNotice>

        <EntityFilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search archived records, programmes, cohorts..."
          selects={[
            { label: 'Record type', value: kindFilter, onChange: setKindFilter, options: KIND_OPTIONS },
            {
              label: 'Programme',
              value: programmeFilter,
              onChange: setProgrammeFilter,
              options: [{ value: '', label: 'All programmes' }, ...programmeOptions],
              disabled: !programmeOptions.length,
            },
          ]}
          onReset={() => { setSearch(''); setKindFilter(''); setProgrammeFilter(''); }}
          summary={archive.loaded ? `Showing ${visible.length} of ${total} archived records` : undefined}
        />

        <EntityTable
          columns={COLUMNS}
          gridClass={GRID}
          rows={visible}
          rowKey={row => row.key}
          loading={archive.loading && !archive.loaded}
          empty={(
            <EntityEmptyState
              icon="ri-inbox-line"
              title={total ? 'No archived records match these filters' : 'Nothing in the archive'}
              message={total
                ? 'Clear a filter, or search for a different record.'
                : 'Anything you archive — a programme, cohort, group or module — is kept here until you restore it or delete it for good.'}
            />
          )}
          renderRow={row => (
            <>
              <StackedCell primary={row.name} secondary={row.reference} />
              <PlainCell>
                <ParentBadge label={KIND_LABEL[row.kind]} tone={row.kind} />
              </PlainCell>
              <PlainCell>
                {row.parents.length
                  ? row.parents.join(' › ')
                  // Not "—": a programme sits at the top of the chain on
                  // purpose, and an orphan says something different.
                  : (row.kind === 'programme' ? 'Top of the curriculum' : 'No parent recorded')}
              </PlainCell>
              <PlainCell>{row.contents}</PlainCell>
              <PlainCell>
                {row.archivedAt ? formatDateTimeLabel(row.archivedAt) : 'Date not recorded'}
                {VIA_PARENT_LABEL[row.archivedBy] && (
                  <span className="mt-0.5 block text-[11px] font-semibold text-amber-700">
                    {VIA_PARENT_LABEL[row.archivedBy]}
                  </span>
                )}
              </PlainCell>
              <NamedActions
                actions={[
                  {
                    icon: 'ri-file-list-3-line',
                    label: 'Details',
                    title: `See everything recorded about this ${KIND_LABEL[row.kind].toLowerCase()}`,
                    onClick: () => setOpenKey(row.key),
                  },
                  {
                    icon: 'ri-arrow-go-back-line',
                    label: 'Restore',
                    title: row.restoreBlockedBy || `Put this ${KIND_LABEL[row.kind].toLowerCase()} back in the active list`,
                    disabled: Boolean(row.restoreBlockedBy) || Boolean(busyKey),
                    busy: busyKey === row.key,
                    onClick: () => void restore(row),
                  },
                  {
                    icon: 'ri-delete-bin-line',
                    label: 'Delete',
                    title: row.deleteBlockedBy || `Remove this ${KIND_LABEL[row.kind].toLowerCase()} from the database for good`,
                    disabled: Boolean(row.deleteBlockedBy) || Boolean(busyKey),
                    onClick: () => void deletePermanently(row),
                  },
                ]}
              />
            </>
          )}
        />

        {/*
          The archived record, read-only.

          A drawer rather than a page: an archived record has no page of its own
          to go to -- every workspace reads the curriculum overview payload,
          which excludes archived rows, so a link out would land on "not found".
          It is also not an editor. Archived records are not edited; they are put
          back or removed, which is why the drawer's two buttons are the same two
          the row carries and there is no save.
        */}
        <EntityDrawer
          open={Boolean(openRow)}
          title={openRow?.name || ''}
          subtitle={openRow
            ? `Archived ${KIND_LABEL[openRow.kind].toLowerCase()}${openRow.parents.length ? ` · ${openRow.parents.join(' › ')}` : ''}`
            : ''}
          onClose={() => setOpenKey(null)}
          onSubmit={() => { if (openRow) void restore(openRow); }}
          submitLabel="Restore"
          submitDisabled={Boolean(openRow?.restoreBlockedBy) || Boolean(busyKey)}
          saving={Boolean(openRow) && busyKey === openRow?.key}
          cancelLabel="Close"
          extraAction={openRow && !openRow.deleteBlockedBy
            ? {
              label: 'Delete permanently',
              icon: 'ri-delete-bin-line',
              onClick: () => { if (openRow) void deletePermanently(openRow); },
            }
            : undefined}
          error={actionError}
          width="w-[640px]"
        >
          {openRow && (
            <div className="space-y-4">
              {/* Said before the fields, because it is the reason the panel is
                  read-only and the reason a button may be off. */}
              <ArchiveNotice>
                {openRow.archivedAt
                  ? `Archived ${formatDateTimeLabel(openRow.archivedAt)}`
                  : 'Archived — no date was recorded'}
                {VIA_PARENT_LABEL[openRow.archivedBy] ? `, ${VIA_PARENT_LABEL[openRow.archivedBy].toLowerCase()}.` : '.'}
                {' '}
                {openRow.restoreBlockedBy
                  ? `${openRow.restoreBlockedBy}.`
                  : `Restoring puts it back in the ${KIND_LABEL[openRow.kind].toLowerCase()} list exactly as it is here.`}
              </ArchiveNotice>

              <section className="rounded-xl border border-foreground-200/60 bg-background-50 px-4 py-1">
                <DetailRow label="Record type" value={KIND_LABEL[openRow.kind]} />
                <DetailRow label="Identifier" value={openRow.id} />
                {openRow.details.map(field => (
                  <DetailRow key={field.label} label={field.label} value={field.value} />
                ))}
              </section>

              {/*
                A module's authored content, the way the Module Builder's week
                rail shows it. Read-only: this is the same structure, not a
                second editor for it. The other three kinds have nothing of the
                sort -- a cohort or a group holds delivery, not authoring, and
                everything it holds is already in the fields above.
              */}
              {openRow.kind === 'module' && (
                <section className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-foreground-400">
                      Course structure
                    </h4>
                    {moduleStructure.structure && (
                      <span className="text-[11px] text-foreground-400">
                        {plural(moduleStructure.structure.weekStructure?.length || 0, 'week')}
                        {' · '}
                        {plural(
                          (moduleStructure.structure.weekStructure || [])
                            .reduce((sum, week) => sum + (week.components?.length || 0), 0),
                          'component',
                        )}
                      </span>
                    )}
                  </div>

                  {moduleStructure.loading && (
                    <p className="flex items-center gap-2 text-[12px] font-semibold text-foreground-500">
                      <AppIcon className="ri-loader-4-line animate-spin text-sm"></AppIcon>
                      Reading this module's weeks...
                    </p>
                  )}
                  {moduleStructure.error && <InlineError message={moduleStructure.error} />}
                  {moduleStructure.structure && !moduleStructure.structure.weekStructure?.length && (
                    <p className="text-[12px] font-semibold text-foreground-400">
                      No weeks were authored in this module.
                    </p>
                  )}

                  {(moduleStructure.structure?.weekStructure || []).map(week => (
                    <ArchivedWeek
                      key={week.id}
                      week={week}
                      open={openWeekIds.includes(week.id)}
                      onToggle={() => setOpenWeekIds(previous => (
                        previous.includes(week.id)
                          ? previous.filter(id => id !== week.id)
                          : [...previous, week.id]
                      ))}
                    />
                  ))}
                </section>
              )}

              {openRow.deleteBlockedBy && (
                <p className="text-[12px] font-semibold leading-5 text-amber-700">
                  Cannot be deleted permanently: {openRow.deleteBlockedBy}.
                </p>
              )}
            </div>
          )}
        </EntityDrawer>
      </div>
    </WorkspaceShell>
  );
}

