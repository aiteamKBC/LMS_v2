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
//
// The list is read from one endpoint, /curriculum/archive/, a page at a time:
// the server builds all four archives from a single set of reads and does the
// filtering, searching and paging, so opening the page no longer waits for the
// whole programme list to be rebuilt. Records a parent's archive took down with
// it are shown under that parent, so "what was archived, and why" reads as one
// entry rather than as rows scattered across the list.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import styles from './ArchivePage.module.css';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  fetchArchivedModuleStructure,
  fetchCurriculumArchivePage,
  fetchCurriculumArchiveRecord,
  fetchProgrammeKsbStats,
  type CurriculumArchiveKind,
  type CurriculumArchiveRecord,
  type CurriculumArchivedCohort,
  type CurriculumArchivedGroup,
  type CurriculumArchivedModule,
  type CurriculumArchivedModuleStructure,
  type CurriculumArchivedModuleWeek,
  type CurriculumArchivedProgramme,
  type ProgrammeKsbStats,
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
import { cleanText, formatDateLabel, formatDateTimeLabel } from '../shared/entities/model';
import {
  DetailRow,
  EntityDrawer,
  EntityEmptyState,
  EntityFilterBar,
  EntityPagination,
  EntityTable,
  InlineError,
  NamedActions,
  ParentBadge,
  WorkspaceTabs,
} from '../shared/entities/ui';

// --------------------------------------------------------------- the row shape

type ArchiveKind = CurriculumArchiveKind;

/**
 * One archived record, whatever kind it is.
 *
 * The endpoint answers with four different shapes, and the columns a reader
 * needs are the same for all of them: what it is called, what kind of thing it
 * is, where in the curriculum it sat, how it came to be archived, what the two
 * buttons would do to it, and when. Flattening to this row once is what lets
 * the page show them as one list.
 *
 * `restoreBlockedBy` and `deleteBlockedBy` hold the reason an action cannot run
 * rather than a bare boolean: both are shown on the row, so the reader is told
 * what to do about it before the click instead of reading a 409 after.
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
  programmeId: string;
  programme: string;
  /**
   * The same figures the confirms name in their own sentences ("its 8
   * components come back with it"), carried rather than parsed back out of a
   * sentence.
   */
  counts: { cohorts: number; groups: number; modules: number; weeks: number; components: number };
  /**
   * The record's own fields, for the details panel. Built here rather than read
   * off a detail endpoint because no workspace page can open an archived record:
   * they all read the overview payload, which excludes archived rows. A field
   * the source left empty is dropped rather than shown as a dash.
   */
  details: Array<{ label: string; value: string }>;
  /** ISO, or '' when no archive stamp was stored. */
  archivedAt: string;
  /** The write handler that archived it, when the list reports one. */
  archivedBy: string;
  /** How it came to be archived, in a sentence: on its own, or with which parent. */
  how: string;
  /** True when a listed parent's archive took this record down with it. */
  viaParent: boolean;
  /** What Restore does to it, or why it cannot. */
  restoreEffect: string;
  /** What Delete does to it, or why it cannot. */
  deleteEffect: string;
  restoreBlockedBy: string;
  deleteBlockedBy: string;
  /** Records this one's own archive took down with it, shown under it. */
  childRows: ArchiveRow[];
  /** Display only: named counts from the archive payload, never an invented generic total. */
  items: string;
  linkedRecords: string;
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

const KIND_ORDER: ArchiveKind[] = ['programme', 'cohort', 'group', 'module'];

const PAGE_SIZE = 25;

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Joins the non-empty parts of a summary; '—' when there is nothing to say. */
function summarise(parts: Array<string | false | 0 | null | undefined>): string {
  const kept = parts.filter((part): part is string => Boolean(part));
  return kept.length ? kept.join(' · ') : '—';
}

/** "2 cohorts, 3 groups and 9 modules" -- '' for nothing. */
function listOf(parts: string[]): string {
  const kept = parts.filter(Boolean);
  if (kept.length <= 1) return kept[0] || '';
  return `${kept.slice(0, -1).join(', ')} and ${kept[kept.length - 1]}`;
}

/** Keep only the detail fields the source actually filled in. */
function detailsOf(fields: Array<[string, unknown]>): Array<{ label: string; value: string }> {
  return fields
    .map(([label, value]) => ({ label, value: cleanText(value) }))
    .filter(field => field.value && field.value !== '—');
}

/**
 * A record that came here with a parent whose own row is no longer listed --
 * the parent was restored or deleted since. The stamp still says how it left.
 */
const VIA_PARENT_LABEL: Record<string, string> = {
  'programme-delete': 'Archived with its programme',
  'cohort-delete': 'Archived with its cohort',
  'group-delete': 'Archived with its group',
};

/** What a record's archive took down with it, counted by type. */
function childSummary(children: ArchiveRow[]): string {
  return listOf(KIND_ORDER.map(kind => {
    const count = children.filter(child => child.kind === kind).length;
    return count ? plural(count, KIND_LABEL[kind].toLowerCase()) : '';
  }));
}

// ------------------------------------------------------------------ the loader

interface ArchiveQuery {
  page: number;
  type: string;
  programme: string;
  q: string;
}

interface ArchiveState {
  rows: ArchiveRow[];
  /** Records per type under the programme filter and search -- the tabs. */
  counts: Record<ArchiveKind, number>;
  /** Records per type in the whole archive -- the hero. */
  totals: Record<ArchiveKind, number>;
  /** Entries on this filter, and the pages they make. */
  total: number;
  pages: number;
  /** The page the server answered with -- it clamps one past the end. */
  page: number;
  /** The page that read asked for, so a clamp is told apart from a stale answer. */
  requestedPage: number;
  programmeOptions: Array<{ value: string; label: string }>;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const EMPTY_COUNTS: Record<ArchiveKind, number> = { programme: 0, cohort: 0, group: 0, module: 0 };

/**
 * Read one page of the archive.
 *
 * The server does the filtering and paging, so a filter change is a new read;
 * the rows already on screen stay there while it runs (the table shows its
 * refresh bar) rather than flashing to a skeleton. One failing read fails the
 * page -- a record missing from this list reads as "it is not archived" rather
 * than "we could not check", and that is the one wrong answer this page must
 * not give.
 *
 * Every restore and delete calls `reload`: the row just acted on has to leave
 * the list, and the endpoint is revalidated for exactly that reason. Only the
 * latest read may write: a slow read finishing after the reload behind a
 * restore would otherwise put the restored record back on screen.
 */
function useCurriculumArchivePage(query: ArchiveQuery): ArchiveState {
  const [state, setState] = useState<Omit<ArchiveState, 'reload' | 'loading' | 'loaded' | 'error'>>({
    rows: [], counts: EMPTY_COUNTS, totals: EMPTY_COUNTS, total: 0, pages: 1, page: 1, requestedPage: 1, programmeOptions: [],
  });
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRunRef = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;

  const run = useCallback(async (signal?: AbortSignal) => {
    const runId = latestRunRef.current + 1;
    latestRunRef.current = runId;
    const current = () => !signal?.aborted && latestRunRef.current === runId;
    const { page, type, programme, q } = queryRef.current;
    setLoading(true);
    try {
      const result = await fetchCurriculumArchivePage({ page, pageSize: PAGE_SIZE, type, programme, q }, signal);
      if (!current()) return;
      setState({
        rows: result.results.map(entry => archiveRow(entry, entry.children || [])),
        counts: { ...EMPTY_COUNTS, ...result.counts },
        totals: { ...EMPTY_COUNTS, ...result.totals },
        total: result.total,
        pages: Math.max(1, result.pages || 1),
        page: result.page || page,
        requestedPage: page,
        programmeOptions: result.programmes || [],
      });
      setError(null);
      setLoaded(true);
      setLoading(false);
    } catch (err) {
      if (!current()) return;
      setError(err instanceof Error ? err.message : 'Unable to read the archive.');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void run(controller.signal);
    return () => controller.abort();
  }, [run, query.page, query.type, query.programme, query.q]);

  const reload = useCallback(() => run(), [run]);

  return { ...state, loading, loaded, error, reload };
}

/**
 * KSBs mapped, for the one programme whose panel is open.
 *
 * Not loaded with the list: it is a read of the programme's whole authoring
 * tree, the list shows it nowhere, and fetching it for every archived programme
 * queued ~25 of those reads behind each visit to this page.
 */
function useProgrammeKsbStats(programmeId: string | null) {
  const [stats, setStats] = useState<ProgrammeKsbStats | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');

  useEffect(() => {
    setStats(null);
    if (!programmeId) { setState('idle'); return undefined; }
    const controller = new AbortController();
    setState('loading');
    fetchProgrammeKsbStats(programmeId, controller.signal, { visibility: 'all' })
      .then(result => {
        if (controller.signal.aborted) return;
        setStats(result);
        setState('ready');
      })
      .catch(() => { if (!controller.signal.aborted) setState('unavailable'); });
    return () => controller.abort();
  }, [programmeId]);

  return { stats, state };
}

// ------------------------------------------------- four shapes into one row

type ArchiveItem = CurriculumArchiveRecord & { archivedWith?: string | null };

/** The parent the server says took this record down, named from the record's own fields. */
function archivedWithLabel(item: ArchiveItem): string {
  const parentKey = cleanText(item.archivedWith);
  if (!parentKey) return '';
  const parentKind = parentKey.split(':')[0] as ArchiveKind;
  const record = item.record as Partial<CurriculumArchivedGroup & CurriculumArchivedModule>;
  const parentName = parentKind === 'programme'
    ? cleanText(record.programme)
    : parentKind === 'cohort' ? cleanText(record.cohort)
      : parentKind === 'group' ? cleanText(record.group) : '';
  const kindWord = KIND_LABEL[parentKind]?.toLowerCase() || 'parent';
  return parentName ? `Archived with the ${kindWord} ${parentName}` : `Archived with its ${kindWord}`;
}

function howArchived(item: ArchiveItem): { how: string; viaParent: boolean } {
  const withParent = archivedWithLabel(item);
  if (withParent) return { how: withParent, viaParent: true };
  const stamp = cleanText(item.record.archivedBy);
  if (VIA_PARENT_LABEL[stamp] && stamp !== `${item.kind}-delete`) return { how: VIA_PARENT_LABEL[stamp], viaParent: true };
  return { how: 'Archived on its own', viaParent: false };
}

function archiveRow(item: ArchiveItem, children: ArchiveItem[] = []): ArchiveRow {
  const childRows = children.map(child => archiveRow(child));
  const base = (() => {
    switch (item.kind) {
      case 'programme': return programmeRow(item.record, childRows);
      case 'cohort': return cohortRow(item.record, childRows);
      case 'group': return groupRow(item.record);
      case 'module':
      default: return moduleRow(item.record as CurriculumArchivedModule);
    }
  })();
  const { how, viaParent } = howArchived(item);
  const row: ArchiveRow = { ...base, ...archiveFacts(item), key: item.key || base.key, how, viaParent, childRows };
  // A cohort that left with its programme cannot come back without it: every
  // cohort list is scoped by programme, and the restore endpoint refuses one
  // whose programme is still archived. Said here rather than after the click.
  if (row.kind === 'cohort' && cleanText(item.archivedWith).startsWith('programme:') && !row.restoreBlockedBy) {
    row.restoreBlockedBy = `Its programme is archived too — restore ${cleanText(row.programme, 'the programme')} instead`;
  }
  row.restoreEffect = row.restoreBlockedBy ? `Can’t restore: ${row.restoreBlockedBy}` : row.restoreEffect;
  row.deleteEffect = row.deleteBlockedBy ? `Can’t delete: ${row.deleteBlockedBy}` : row.deleteEffect;
  return row;
}

type BaseRow = Omit<ArchiveRow, 'how' | 'viaParent' | 'childRows' | 'items' | 'linkedRecords'>;

function recordedCount(value: unknown, label: string): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? plural(value, label) : `${label[0].toUpperCase()}${label.slice(1)} count unavailable`;
}

/** Keep different entity counts named, including the archive's historical ownership. */
function archiveFacts(item: ArchiveItem): Pick<ArchiveRow, 'items' | 'linkedRecords'> {
  switch (item.kind) {
    case 'programme': return {
      items: recordedCount(item.record.modules, 'module'),
      linkedRecords: `${recordedCount(item.record.cohorts, 'cohort')} · ${recordedCount(item.record.groups, 'group')}`,
    };
    case 'cohort': return {
      items: recordedCount(item.record.groups, 'archived group'),
      linkedRecords: `${recordedCount(item.record.learners, 'learner')} still placed here`,
    };
    case 'group': return {
      items: 'Not available',
      linkedRecords: `${recordedCount(item.record.learners, 'learner')} still placed here`,
    };
    case 'module': return {
      items: recordedCount(item.record.components, 'component'),
      linkedRecords: `${recordedCount(item.record.weeks, 'week')} · ${recordedCount(item.record.sessions, 'session')}`,
    };
  }
}

function programmeRow(programme: CurriculumArchivedProgramme, childRows: ArchiveRow[]): BaseRow {
  const id = programme.sourceId || programme.id;
  const beneath = listOf([
    programme.cohorts ? plural(programme.cohorts, 'cohort') : '',
    programme.groups ? plural(programme.groups, 'group') : '',
    programme.modules ? plural(programme.modules, 'module') : '',
  ]);
  const withIt = childSummary(childRows);
  return {
    key: `programme:${id}`,
    kind: 'programme',
    id,
    name: cleanText(programme.name, 'Untitled programme'),
    reference: summarise([cleanText(programme.standard), cleanText(programme.level) && `Level ${programme.level}`]),
    parents: [],
    programmeId: id,
    programme: cleanText(programme.name),
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
      ['Last updated', programme.lastUpdated ? formatDateLabel(programme.lastUpdated) : ''],
      ['Created', programme.createdAt ? formatDateLabel(programme.createdAt) : ''],
      ['Description', programme.description],
    ]),
    archivedAt: cleanText(programme.archivedAt),
    archivedBy: cleanText(programme.archivedBy),
    restoreEffect: withIt
      ? `Brings it back with the ${withIt} archived with it`
      : 'Brings it back to the programme list',
    deleteEffect: beneath
      ? `Removes it and everything beneath it (${beneath}) for good`
      : 'Removes it for good',
    restoreBlockedBy: '',
    // Learner delivery is what refuses a programme delete, and the count is not
    // in this payload — the endpoint's own refusal names it after the click.
    deleteBlockedBy: '',
  };
}

function cohortRow(cohort: CurriculumArchivedCohort, childRows: ArchiveRow[]): BaseRow {
  const groups = cohort.groups ? plural(cohort.groups, 'group') : '';
  return {
    key: `cohort:${cohort.id}`,
    kind: 'cohort',
    id: cohort.id,
    name: cleanText(cohort.name, 'Untitled cohort'),
    reference: cohort.id,
    parents: [cleanText(cohort.programme)].filter(Boolean),
    programmeId: cleanText(cohort.programmeId),
    programme: cleanText(cohort.programme),
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
    restoreEffect: `${groups || childRows.length ? `Brings it back with the ${groups || childSummary(childRows)} archived with it` : 'Brings it back to its programme'}; modules have to be attached again`,
    deleteEffect: `Removes it${groups ? ` and its ${groups}` : ''} for good; module content is kept`,
    restoreBlockedBy: '',
    deleteBlockedBy: cohort.learners
      ? `${plural(cohort.learners, 'learner')} still placed here — move them first`
      : '',
  };
}

function groupRow(group: CurriculumArchivedGroup): BaseRow {
  return {
    key: `group:${group.id}`,
    kind: 'group',
    id: group.id,
    name: cleanText(group.name, 'Untitled group'),
    reference: summarise([cleanText(group.coach) && `Coach ${group.coach}`, cleanText(group.schedule)]),
    parents: [cleanText(group.programme), cleanText(group.cohort)].filter(Boolean),
    programmeId: cleanText(group.programmeId),
    programme: cleanText(group.programme),
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
    restoreEffect: `Brings it back${cleanText(group.cohort) ? ` under ${group.cohort}` : ''}; modules have to be attached again`,
    deleteEffect: 'Removes it for good; module content is kept',
    // The endpoint refuses this, because a group restored under an archived
    // cohort has nothing to come back to. Restoring the cohort brings back every
    // group archived with it, so that is what the row says to do.
    restoreBlockedBy: group.cohortArchived
      ? `Its cohort is archived too — restore ${cleanText(group.cohort, 'the cohort')} instead`
      : '',
    deleteBlockedBy: group.learners
      ? `${plural(group.learners, 'learner')} still placed here — move them first`
      : '',
  };
}

function moduleRow(module: CurriculumArchivedModule): BaseRow {
  const content = listOf([
    module.weeks ? plural(module.weeks, 'week') : '',
    module.components ? plural(module.components, 'component') : '',
  ]);
  return {
    key: `module:${module.id}`,
    kind: 'module',
    id: module.id,
    name: cleanText(module.title, 'Untitled module'),
    reference: summarise([cleanText(module.tutor) && `Tutor ${module.tutor}`, cleanText(module.catalogueId)]),
    parents: [cleanText(module.programme), cleanText(module.cohort), cleanText(module.group)].filter(Boolean),
    programmeId: cleanText(module.programmeId),
    programme: cleanText(module.programme),
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
    restoreEffect: `Brings it back to the catalogue${content ? ` with its ${content}` : ''}; quizzes stay in the Quiz Archive`,
    deleteEffect: `Removes it${content ? ` and its ${content}` : ''} for good`,
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
function ArchivedWeek({ week, open, onToggle, focusComponentId = '' }: {
  week: CurriculumArchivedModuleWeek;
  open: boolean;
  onToggle: () => void;
  /** The component a deep link named, ringed and scrolled to. */
  focusComponentId?: string;
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
              <div
                key={component.id}
                data-focused={focusComponentId === component.id ? 'true' : undefined}
                ref={focusComponentId === component.id ? node => node?.scrollIntoView?.({ block: 'center' }) : undefined}
                className={`rounded-lg border px-3 py-2.5 ${focusComponentId === component.id
                  ? 'border-primary-400 bg-primary-50 ring-2 ring-primary-300'
                  : 'border-background-200 bg-background-100/50'}`}
              >
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

const GRID = styles.grid;

const COLUMNS = [
  { label: 'Record' },
  { label: 'Type' },
  { label: 'Programme' },
  { label: 'Archived' },
  { label: 'Items' },
  { label: 'Linked records' },
  { label: 'Restorable' },
  { label: 'Archived by' },
  { label: 'Actions', align: 'right' as const },
];

/** The two effect lines, with the blocked ones in amber so they read as a reason. */
function EffectCell({ row }: { row: ArchiveRow }) {
  return (
    <div className="min-w-0 space-y-1 text-[11.5px] leading-[1.35rem]">
      <p className={row.restoreBlockedBy ? 'font-semibold text-amber-700' : 'text-foreground-600'}>
        <AppIcon className="ri-arrow-go-back-line mr-1 align-[-2px] text-[12px] text-foreground-400"></AppIcon>
        {row.restoreEffect}
      </p>
      <p className={row.deleteBlockedBy ? 'font-semibold text-amber-700' : 'text-foreground-500'}>
        <AppIcon className="ri-delete-bin-line mr-1 align-[-2px] text-[12px] text-foreground-400"></AppIcon>
        {row.deleteEffect}
      </p>
    </div>
  );
}

/** How a record came to be archived: on its own, or along with a parent. */
function HowBadge({ row }: { row: ArchiveRow }) {
  return (
    <span
      className={`mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${row.viaParent
        ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
        : 'bg-background-100 text-foreground-600 ring-1 ring-background-200'}`}
      title={row.how}
    >
      <AppIcon className={`${row.viaParent ? 'ri-links-line' : 'ri-archive-line'} text-[11px]`}></AppIcon>
      <span className="truncate">{row.how}</span>
    </span>
  );
}

function archivedLabel(row: ArchiveRow) {
  return row.archivedAt ? formatDateTimeLabel(row.archivedAt) : 'Date not recorded';
}

export default function CurriculumArchivePage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // The search, filters and page are in the URL because this page is the only
  // archive there is: "it is in the archive, under Groups, page 2" has to be a
  // link, and the audit trail's "archived" event has to be able to name a
  // record.
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [kindFilter, setKindFilter] = useState(() => {
    const value = searchParams.get('type') || '';
    return (KIND_ORDER as string[]).includes(value) ? value : '';
  });
  const [programmeFilter, setProgrammeFilter] = useState(() => searchParams.get('programme') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));

  // The search is answered by the server, so it waits for the typing to settle
  // rather than reading the archive once per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const archive = useCurriculumArchivePage({
    page, type: kindFilter, programme: programmeFilter, q: debouncedSearch,
  });

  // A filter change starts again at page 1 -- page 4 of a narrower list is
  // usually a page that does not exist.
  const firstFilterRender = useRef(true);
  useEffect(() => {
    if (firstFilterRender.current) { firstFilterRender.current = false; return; }
    setPage(1);
  }, [kindFilter, programmeFilter, debouncedSearch]);

  // The server clamps a page past the end (a restore emptied the last one);
  // follow it so the URL and pager agree. Only for the read that asked for this
  // page -- the previous answer is still on screen while the next one loads.
  useEffect(() => {
    if (archive.loaded && !archive.loading && archive.requestedPage === page && archive.page !== page) {
      setPage(archive.page);
    }
  }, [archive.loaded, archive.loading, archive.requestedPage, archive.page, page]);

  // The row an action is running against, so its button shows the spinner rather
  // than the whole table going quiet while a restore is in flight.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const actionLock = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Entries whose "archived with it" list is open.
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  // The record whose details panel is open. Held by key rather than by value so
  // a reload behind an open panel refreshes what it is showing.
  const [openKey, setOpenKey] = useState<string | null>(null);
  // A record a link named, read on its own: it may sit on any page.
  const [linkedRow, setLinkedRow] = useState<ArchiveRow | null>(null);
  // Which weeks of an open module are expanded. Reset when the panel changes
  // module, so week 3 of the last one does not open week 3 of the next.
  const [openWeekIds, setOpenWeekIds] = useState<string[]>([]);
  const navigate = useNavigate();
  // A link that names one record -- the audit trail's "archived" row -- rather
  // than only filtering the list. Read once: it is a request to arrive
  // somewhere, and the reader closing the panel must not have it reopen.
  const [deepLink] = useState(() => ({
    open: (searchParams.get('open') || '').trim(),
    week: (searchParams.get('week') || '').trim(),
    component: (searchParams.get('component') || '').trim(),
    archived: (searchParams.get('archived') || '').trim(),
    archivedName: (searchParams.get('archivedName') || '').trim(),
    archivedAt: (searchParams.get('archivedAt') || '').trim(),
  }));
  const [deepLinkMissing, setDeepLinkMissing] = useState(false);
  // The week and component to show once the opened module's weeks arrive.
  const [focus, setFocus] = useState<{ key: string; weekId: string; componentId: string } | null>(null);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (search.trim()) next.set('q', search.trim());
    else next.delete('q');
    if (kindFilter) next.set('type', kindFilter);
    else next.delete('type');
    if (programmeFilter) next.set('programme', programmeFilter);
    else next.delete('programme');
    if (page > 1) next.set('page', String(page));
    else next.delete('page');
    if (next.toString() === searchParams.toString()) return;
    setSearchParams(next, { replace: true });
  }, [search, kindFilter, programmeFilter, page, searchParams, setSearchParams]);

  const openRow = useMemo(() => {
    if (!openKey) return null;
    for (const row of archive.rows) {
      if (row.key === openKey) return row;
      const child = row.childRows.find(candidate => candidate.key === openKey);
      if (child) return child;
    }
    return linkedRow && linkedRow.key === openKey ? linkedRow : null;
  }, [archive.rows, linkedRow, openKey]);

  // Only a module has authored content to read; the other three kinds are
  // delivery records, and everything about them is already in the list payload.
  const moduleStructure = useArchivedModuleStructure(
    openRow && openRow.kind === 'module' ? openRow.id : null,
  );
  const programmeKsb = useProgrammeKsbStats(openRow && openRow.kind === 'programme' ? openRow.id : null);

  useEffect(() => { setOpenWeekIds([]); }, [openKey]);

  // Resolved against what is archived NOW, not what was archived when the link
  // was made: a record restored since is not here, and a module whose week or
  // component was archived on its own is still live, so the Module Builder is
  // where that item's place is.
  const linkedModuleId = deepLink.open.startsWith('module:') ? deepLink.open.slice('module:'.length) : '';
  const sendToBuilder = useCallback(() => {
    const params = new URLSearchParams({ module: linkedModuleId });
    if (deepLink.week) params.set('week', deepLink.week);
    if (deepLink.component) {
      params.set('component', deepLink.component);
      params.set('focus', 'component');
    }
    if (deepLink.archived) params.set('archived', deepLink.archived);
    if (deepLink.archivedName) params.set('archivedName', deepLink.archivedName);
    if (deepLink.archivedAt) params.set('archivedAt', deepLink.archivedAt);
    navigate(`/curriculum/module-builder?${params.toString()}`, { replace: true });
  }, [deepLink, linkedModuleId, navigate]);

  // The linked record is read by its key, so it opens whichever page it is on.
  useEffect(() => {
    if (!deepLink.open) return undefined;
    const controller = new AbortController();
    fetchCurriculumArchiveRecord(deepLink.open, controller.signal)
      .then(record => {
        if (controller.signal.aborted) return;
        if (record) {
          const row = archiveRow(record);
          setLinkedRow(row);
          setOpenKey(row.key);
          if (row.kind === 'module' && (deepLink.week || deepLink.component)) {
            setFocus({ key: row.key, weekId: deepLink.week, componentId: deepLink.component });
          }
          return;
        }
        if (linkedModuleId) {
          sendToBuilder();
          return;
        }
        setDeepLinkMissing(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDeepLinkMissing(true);
      });
    return () => controller.abort();
    // Once, for the link the page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Declared after the reset above so, when both fire together, the week the
  // link named is the one left open.
  useEffect(() => {
    const weeks = moduleStructure.structure?.weekStructure;
    if (!focus || focus.key !== openKey || !weeks) return;
    const week = weeks.find(item => item.id === focus.weekId)
      || weeks.find(item => (item.components || []).some(component => component.id === focus.componentId));
    if (week) setOpenWeekIds([week.id]);
  }, [focus, openKey, moduleStructure.structure]);

  const closePanel = () => {
    setOpenKey(null);
    setFocus(null);
    setLinkedRow(null);
    // The record the link named has been seen; a reload should show the list.
    const next = new URLSearchParams(searchParams);
    ['open', 'week', 'component', 'archived', 'archivedName', 'archivedAt'].forEach(key => next.delete(key));
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  };

  // A restore or a permanent delete run from inside the panel takes the record
  // out of the archive, so the panel it was opened from has nothing left to
  // show. Closing on the reload is what the row's own disappearance does for the
  // table.
  useEffect(() => {
    if (openKey && archive.loaded && !archive.loading && !openRow) setOpenKey(null);
  }, [archive.loaded, archive.loading, openKey, openRow]);

  /**
   * Run one of the eight confirms, then re-read.
   *
   * The confirm helpers own the dialog and the API call; what is left here is
   * only what this page has to do around them — mark the row busy, and pull the
   * page again so the record that was just restored or deleted leaves it. A
   * refusal the helper re-raised is shown on the page too, because the dialog
   * that carried it has closed by the time the reader looks for it.
   */
  const runAction = async (row: ArchiveRow, action: () => Promise<boolean>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusyKey(row.key);
    setActionError(null);
    let done = false;
    try {
      done = await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Unable to update ${row.name}.`);
    }
    // A linked record read on its own is not refreshed by the page read; once
    // it has been acted on it is gone, so the panel closes with it.
    if (done && linkedRow?.key === row.key) setLinkedRow(null);
    try {
      await archive.reload();
    } finally {
      actionLock.current = false;
      setBusyKey(null);
    }
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

  const rowActions = (row: ArchiveRow) => (
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
          title: row.restoreBlockedBy || row.restoreEffect,
          disabled: Boolean(row.restoreBlockedBy) || Boolean(busyKey),
          busy: busyKey === row.key,
          onClick: () => void restore(row),
        },
        {
          icon: 'ri-delete-bin-line',
          label: 'Delete',
          title: row.deleteBlockedBy || row.deleteEffect,
          disabled: Boolean(row.deleteBlockedBy) || Boolean(busyKey),
          onClick: () => void deletePermanently(row),
        },
      ]}
    />
  );

  const toggleExpanded = (key: string) => setExpandedKeys(previous => (
    previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key]
  ));

  const renderCells = (row: ArchiveRow) => (
    <>
      <div className={styles.cell}>
        <p className={styles.recordName} title={row.name}>{row.name}</p>
        <p className={styles.reference}>{row.reference}</p>
        <HowBadge row={row} />
        {row.childRows.length > 0 && <button type="button" className={styles.expand} onClick={() => toggleExpanded(row.key)} aria-expanded={expandedKeys.includes(row.key)}>
          <AppIcon name={expandedKeys.includes(row.key) ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
          {`+ ${childSummary(row.childRows)} archived with it`}
        </button>}
      </div>
      <span className={styles.cell}>{KIND_LABEL[row.kind]}</span>
      <span className={styles.cell}>{row.programme || 'No programme recorded'}
        {row.parents.length > 1 && <small>{row.parents.slice(1).join(' › ')}</small>}
        {row.kind === 'programme' && <small>Top of the curriculum</small>}
      </span>
      <span className={styles.cell}>{archivedLabel(row)}</span>
      <span className={styles.cell}>{row.items}</span>
      <span className={styles.cell}>{row.linkedRecords}</span>
      <div className={styles.cell}>
        <span className={row.restoreBlockedBy ? styles.blocked : styles.eligible}>{row.restoreBlockedBy ? 'Blocked' : 'Restore available'}</span>
        {row.restoreBlockedBy && <p className={styles.reason}>{row.restoreBlockedBy}</p>}
        <details className={styles.effects}><summary>Restore / Delete effects</summary><EffectCell row={row} /></details>
      </div>
      <span className={styles.cell} title="The archive source stores the archive cause, not a person">Not recorded</span>
      <div className={styles.rowActions}>{rowActions(row)}</div>
    </>
  );

  const totals = archive.totals;
  const archiveTotal = KIND_ORDER.reduce((sum, kind) => sum + totals[kind], 0);
  const matchingTotal = KIND_ORDER.reduce((sum, kind) => sum + archive.counts[kind], 0);
  // A first read that failed has counted nothing: zeros and "Nothing in the
  // archive" would say the opposite of "we could not check".
  const unread = !archive.loaded && !archive.loading;
  const countOf = (value: number) => (!archive.loaded ? '—' : value);
  const filtered = Boolean(debouncedSearch.trim() || programmeFilter);

  const tabs = [
    { key: '', label: 'All', icon: 'ri-archive-line' },
    ...KIND_ORDER.map(kind => ({ key: kind, label: `${KIND_LABEL[kind]}s`, icon: KIND_ICON[kind] })),
  ].map(tab => ({
    ...tab,
    count: archive.loaded ? (tab.key ? archive.counts[tab.key as ArchiveKind] : matchingTotal) : undefined,
    countLoading: !archive.loaded && archive.loading,
  }));

  const summary = archive.loaded
    ? kindFilter
      ? `${plural(archive.total, `archived ${KIND_LABEL[kind(kindFilter)].toLowerCase()}`)}${filtered ? ' match these filters' : ''}`
      : `${archive.total} ${archive.total === 1 ? 'entry' : 'entries'}${filtered ? ' match these filters' : ''} · records archived together are listed under the record that archived them`
    : undefined;

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
      <div className={styles.page} id="curriculum-archive-page">
        <section className={styles.intro} aria-label="Archive overview">
          <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link to="/workspace/curriculum">Curriculum</Link><AppIcon name="ri-arrow-right-s-line" /><span>Archive</span></nav>
          <h1>Archive</h1>
          <p>Archived programmes, cohorts, groups and modules. Review original ownership and restoration effects before restoring a record.</p>
          <div className={styles.totals} aria-live="polite">
            <span className={styles.totalBadge}>{!archive.loaded && archive.loading ? 'Loading archived records…' : archive.loaded ? plural(archiveTotal, 'archived record') : 'Archived count unavailable'}</span>
            <span>Non-restorable total unavailable</span>
            <span>Across the archive: {KIND_ORDER.map(kind => `${countOf(totals[kind])} ${KIND_LABEL[kind].toLowerCase()}s`).join(' · ')}</span>
          </div>
        </section>

        <div className={styles.messages}>
        {archive.error && <InlineError message={archive.error} onRetry={() => void archive.reload()} />}
        {actionError && <InlineError message={actionError} />}
        {deepLinkMissing && (
          <InlineError message="The record this link points to is no longer in the archive. It may have been restored, or deleted permanently." />
        )}

        </div>
        <section className={styles.notice} aria-label="Restoration consequences">
          <AppIcon name="ri-information-line" />
          <div><strong>Restoration has consequences</strong><p>Restore brings back the record and the records archived with it. Modules detached when a cohort or group was archived must be attached again. Module quizzes stay in the Quiz Archive. Review the record’s effects and existing confirmation before continuing.</p></div>
        </section>

        <section className={styles.filters} aria-label="Archive filters">
        <WorkspaceTabs tabs={tabs} active={kindFilter} onChange={setKindFilter} />

        <EntityFilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search archived records, programmes, cohorts..."
          selects={[
            {
              label: 'Programme',
              value: programmeFilter,
              onChange: setProgrammeFilter,
              options: [{ value: '', label: 'All programmes' }, ...archive.programmeOptions],
              disabled: !archive.programmeOptions.length,
            },
          ]}
          isDirty={Boolean(search || programmeFilter || kindFilter)}
          onReset={() => { setSearch(''); setKindFilter(''); setProgrammeFilter(''); }}
          summary={summary}
          loading={archive.loading && archive.loaded}
        />

        </section>

        <section className={styles.table} aria-label="Archived records">
          <header className={styles.tableHeading}><h2>Archived records</h2><span>{archive.loaded ? `${archive.total} ${archive.total === 1 ? 'entry' : 'entries'}` : archive.loading ? 'Loading…' : 'Count unavailable'}</span></header>
          <EntityTable
            columns={COLUMNS}
            gridClass={GRID}
            rows={archive.rows}
            rowKey={row => row.key}
            loading={archive.loading && !archive.loaded}
            refreshing={archive.loading && archive.loaded}
            isRowExpanded={row => row.childRows.length > 0 && expandedKeys.includes(row.key)}
            renderRowDetail={row => (
              <div className={styles.children}>
                <p>Archived with {row.name} — restoring it brings these back</p>
                {row.childRows.map(child => <div key={child.key} className={GRID}>{renderCells(child)}</div>)}
              </div>
            )}
          empty={unread ? (
            <EntityEmptyState
              icon="ri-error-warning-line"
              title="The archive could not be read"
              message="Nothing is shown because the archive could not be checked, not because it is empty. Use Retry above to read it again."
            />
          ) : (
            <EntityEmptyState
              icon="ri-inbox-line"
              title={archiveTotal ? 'No archived records match these filters' : 'Nothing in the archive'}
              message={archiveTotal
                ? 'Clear a filter, or search for a different record.'
                : 'Anything you archive — a programme, cohort, group or module — is kept here until you restore it or delete it for good.'}
            />
          )}
            renderRow={renderCells}
          />
        </section>

        <EntityPagination
          page={archive.page}
          pages={archive.pages}
          total={archive.total}
          pageSize={PAGE_SIZE}
          noun={kindFilter ? `archived ${KIND_LABEL[kind(kindFilter)].toLowerCase()}s` : 'entries'}
          onPage={next => { setPage(next); setExpandedKeys([]); }}
        />

        <section className={styles.requirements} aria-label="Restoration requirements">
          <h2>Restoration requirements</h2>
          <ul>
            <li><AppIcon name="ri-checkbox-circle-line" />Restore an archived programme before a dependent cohort or module; restore an archived cohort before its groups.</li>
            <li><AppIcon name="ri-checkbox-circle-line" />A parent restore brings back records archived with that parent. Records archived independently stay archived.</li>
            <li><AppIcon name="ri-checkbox-circle-line" />Reattach modules after restoring a cohort or group. Restore module quizzes separately from the Quiz Workspace.</li>
            <li><AppIcon name="ri-checkbox-circle-line" />The current workflow offers the existing Restore action, without a draft or copy mode. Final eligibility is checked when the server processes the restore.</li>
            <li><AppIcon name="ri-checkbox-circle-line" />Archive dates may be missing, and the source does not record the person who archived a record. Permanent deletion cannot be undone.</li>
          </ul>
        </section>

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
          onClose={closePanel}
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
                  ? `${openRow.how} on ${formatDateTimeLabel(openRow.archivedAt)}.`
                  : `${openRow.how} — no date was recorded.`}
              </ArchiveNotice>

              <section className="space-y-1.5 rounded-xl border border-foreground-200/60 bg-background-50 px-4 py-3">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-foreground-400">What the buttons do</h4>
                <EffectCell row={openRow} />
              </section>

              <section className="rounded-xl border border-foreground-200/60 bg-background-50 px-4 py-1">
                <DetailRow label="Record type" value={KIND_LABEL[openRow.kind]} />
                <DetailRow label="Identifier" value={openRow.id} />
                {openRow.details.map(field => (
                  <DetailRow key={field.label} label={field.label} value={field.value} />
                ))}
                {openRow.kind === 'programme' && programmeKsb.state !== 'unavailable' && (
                  <DetailRow
                    label="KSBs mapped"
                    value={programmeKsb.stats
                      ? (programmeKsb.stats.ksbTotal ? `${programmeKsb.stats.ksbMapped} of ${programmeKsb.stats.ksbTotal}` : 'No KSB standard linked')
                      : 'Loading…'}
                  />
                )}
              </section>

              {openRow.childRows.length > 0 && (
                <section className="space-y-2">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-foreground-400">
                    Archived with it ({childSummary(openRow.childRows)})
                  </h4>
                  <ul className="divide-y divide-background-200/70 rounded-xl border border-background-200 bg-background-50">
                    {openRow.childRows.map(child => (
                      <li key={child.key} className="flex items-center gap-2 px-3 py-2">
                        <ParentBadge label={KIND_LABEL[child.kind]} tone={child.kind} />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-foreground-800">{child.name}</span>
                        <button
                          type="button"
                          onClick={() => setOpenKey(child.key)}
                          className="text-[11px] font-bold text-primary-700 hover:text-primary-800"
                        >
                          Details
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

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
                      focusComponentId={focus && focus.key === openRow.key ? focus.componentId : ''}
                      onToggle={() => setOpenWeekIds(previous => (
                        previous.includes(week.id)
                          ? previous.filter(id => id !== week.id)
                          : [...previous, week.id]
                      ))}
                    />
                  ))}
                </section>
              )}
            </div>
          )}
        </EntityDrawer>
      </div>
    </WorkspaceShell>
  );
}

function kind(value: string): ArchiveKind {
  return (KIND_ORDER as string[]).includes(value) ? value as ArchiveKind : 'programme';
}
