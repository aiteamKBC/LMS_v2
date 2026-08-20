// ============================================================================
// Shared derivation rules for the entity-based Curriculum pages.
//
// The canonical hierarchy is Programme -> Cohort -> Group -> Module -> Week ->
// Component, and nothing here changes it. In particular a Module has no direct
// Cohort relationship: its cohort and programme are *derived through its Group*.
// The denormalised `cohortId` / `programmeId` fields the API returns on a module
// are a read cache the backend maintains, so they are used only as a fallback
// for a module that is not attached to a group yet.
//
// Both the global pages (Curriculum -> Cohorts) and the contextual ones
// (Programme -> its Cohorts) call these helpers against the same fetched
// entities, so the two views cannot drift into separate sources of truth.
// ============================================================================

import type {
  CurriculumCohort,
  CurriculumGroup,
  CurriculumModule,
  CurriculumProgramme,
} from '@/lib/curriculumApi';

export function normaliseKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function cleanText(value: unknown, fallback = ''): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

/** Two identifiers refer to the same record. Empty never matches empty. */
export function sameIdentifier(left: unknown, right: unknown): boolean {
  const a = normaliseKey(left);
  const b = normaliseKey(right);
  return Boolean(a) && a === b;
}

/** Any of `values` matches any of `candidates`. */
export function matchesAny(values: unknown[], candidates: unknown[]): boolean {
  const wanted = new Set(candidates.map(normaliseKey).filter(Boolean));
  if (!wanted.size) return false;
  return values.some(value => wanted.has(normaliseKey(value)));
}

export function programmeKeys(programme: Pick<CurriculumProgramme, 'id' | 'sourceId' | 'name'>): string[] {
  return [programme.sourceId, programme.id, programme.name].map(normaliseKey).filter(Boolean);
}

export function programmeIdentity(programme: Pick<CurriculumProgramme, 'id' | 'sourceId'>): string {
  return cleanText(programme.sourceId) || cleanText(programme.id);
}

export function moduleIdentity(module: CurriculumModule): string {
  // moduleCatalogueId is the canonical authoring identity; the others are
  // legacy/delivery aliases kept for records that predate it.
  return (
    cleanText(module.moduleCatalogueId)
    || cleanText(module.catalogueId)
    || cleanText(module.moduleId)
    || cleanText(module.id)
  );
}

export interface EntityIndex {
  programmes: CurriculumProgramme[];
  cohorts: CurriculumCohort[];
  groups: CurriculumGroup[];
  modules: CurriculumModule[];
}

export interface ResolvedContext {
  programme?: CurriculumProgramme;
  cohort?: CurriculumCohort;
  group?: CurriculumGroup;
  programmeId: string;
  programmeName: string;
  cohortId: string;
  cohortName: string;
  groupId: string;
  groupName: string;
  /**
   * False when the parent chain had to fall back to the module's own cached
   * names because it is not attached to a stored group — worth surfacing, since
   * such a module is invisible to the contextual Programme/Cohort views.
   */
  linked: boolean;
}

export function findProgramme(
  programmes: CurriculumProgramme[],
  identifier: unknown,
): CurriculumProgramme | undefined {
  const key = normaliseKey(identifier);
  if (!key) return undefined;
  return programmes.find(programme => programmeKeys(programme).includes(key));
}

export function findCohort(cohorts: CurriculumCohort[], identifier: unknown): CurriculumCohort | undefined {
  const key = normaliseKey(identifier);
  if (!key) return undefined;
  return cohorts.find(cohort => normaliseKey(cohort.id) === key)
    || cohorts.find(cohort => normaliseKey(cohort.name) === key);
}

export function findGroup(groups: CurriculumGroup[], identifier: unknown): CurriculumGroup | undefined {
  const key = normaliseKey(identifier);
  if (!key) return undefined;
  return groups.find(group => normaliseKey(group.id) === key)
    || groups.find(group => normaliseKey(group.name) === key);
}

export function findModule(modules: CurriculumModule[], identifier: unknown): CurriculumModule | undefined {
  const key = normaliseKey(identifier);
  if (!key) return undefined;
  return modules.find(module => [
    module.moduleCatalogueId,
    module.catalogueId,
    module.moduleId,
    module.id,
    module.structureId,
    module.sourceId,
  ].map(normaliseKey).includes(key));
}

/** A cohort's programme, resolved from its stored programme id (then its name). */
export function cohortProgramme(
  cohort: CurriculumCohort,
  programmes: CurriculumProgramme[],
): CurriculumProgramme | undefined {
  return findProgramme(programmes, cohort.programmeId) || findProgramme(programmes, cohort.programme);
}

/** A group's parent chain: Cohort first, and the Programme *through* the cohort. */
export function resolveGroupContext(
  group: CurriculumGroup,
  cohorts: CurriculumCohort[],
  programmes: CurriculumProgramme[],
): ResolvedContext {
  const cohort = findCohort(cohorts, group.cohortId) || findCohort(cohorts, group.cohort);
  const programme = cohort
    ? cohortProgramme(cohort, programmes)
    : findProgramme(programmes, group.programmeId) || findProgramme(programmes, group.programme);
  return {
    programme,
    cohort,
    group,
    programmeId: programmeIdentity(programme || ({} as CurriculumProgramme)) || cleanText(cohort?.programmeId) || cleanText(group.programmeId),
    programmeName: cleanText(programme?.name) || cleanText(cohort?.programme) || cleanText(group.programme, 'Unassigned programme'),
    cohortId: cleanText(cohort?.id) || cleanText(group.cohortId),
    cohortName: cleanText(cohort?.name) || cleanText(group.cohort, 'Unassigned cohort'),
    groupId: cleanText(group.id),
    groupName: cleanText(group.name, 'Unnamed group'),
    linked: Boolean(cohort),
  };
}

/**
 * A module's parent chain. Group is the only real parent — cohort and programme
 * are read off the group, exactly as the persisted model says they should be.
 * A module with no resolvable group falls back to its own cached names and is
 * reported as `linked: false`.
 */
export function resolveModuleContext(
  module: CurriculumModule,
  groups: CurriculumGroup[],
  cohorts: CurriculumCohort[],
  programmes: CurriculumProgramme[],
): ResolvedContext {
  const group = findGroup(groups, module.groupId) || findGroup(groups, module.group);
  if (group) {
    const context = resolveGroupContext(group, cohorts, programmes);
    return { ...context, linked: true };
  }
  const cohort = findCohort(cohorts, module.cohortId) || findCohort(cohorts, module.cohort);
  const programme = cohort
    ? cohortProgramme(cohort, programmes)
    : findProgramme(programmes, module.programmeId) || findProgramme(programmes, module.programme);
  return {
    programme,
    cohort,
    group: undefined,
    programmeId: programmeIdentity(programme || ({} as CurriculumProgramme)) || cleanText(module.programmeId),
    programmeName: cleanText(programme?.name) || cleanText(module.programme, 'Unassigned programme'),
    cohortId: cleanText(cohort?.id) || cleanText(module.cohortId),
    cohortName: cleanText(cohort?.name) || cleanText(module.cohort, 'Unassigned cohort'),
    groupId: cleanText(module.groupId),
    groupName: cleanText(module.group, 'Unassigned group'),
    linked: false,
  };
}

// ---------------------------------------------------------------- cascades

/** Cohorts under one programme. `''` means "every programme". */
export function cohortsForProgramme(
  cohorts: CurriculumCohort[],
  programmes: CurriculumProgramme[],
  programmeId: string,
): CurriculumCohort[] {
  if (!programmeId) return cohorts;
  const programme = findProgramme(programmes, programmeId);
  const keys = programme ? programmeKeys(programme) : [normaliseKey(programmeId)];
  return cohorts.filter(cohort => matchesAny([cohort.programmeId, cohort.programme], keys));
}

/** Groups under one cohort, or under one programme when no cohort is chosen. */
export function groupsForScope(
  groups: CurriculumGroup[],
  cohorts: CurriculumCohort[],
  programmes: CurriculumProgramme[],
  scope: { programmeId?: string; cohortId?: string },
): CurriculumGroup[] {
  const cohortId = cleanText(scope.cohortId);
  if (cohortId) {
    return groups.filter(group => sameIdentifier(group.cohortId, cohortId));
  }
  const programmeId = cleanText(scope.programmeId);
  if (!programmeId) return groups;
  const scoped = new Set(
    cohortsForProgramme(cohorts, programmes, programmeId).map(cohort => normaliseKey(cohort.id)),
  );
  return groups.filter(group => scoped.has(normaliseKey(group.cohortId)));
}

/** Modules under a Programme/Cohort/Group scope, resolved through the group. */
export function modulesForScope(
  modules: CurriculumModule[],
  groups: CurriculumGroup[],
  cohorts: CurriculumCohort[],
  programmes: CurriculumProgramme[],
  scope: { programmeId?: string; cohortId?: string; groupId?: string },
): CurriculumModule[] {
  const groupId = cleanText(scope.groupId);
  if (groupId) return modules.filter(module => sameIdentifier(module.groupId, groupId));

  const inScope = groupsForScope(groups, cohorts, programmes, scope);
  if (inScope.length === groups.length && !scope.cohortId && !scope.programmeId) return modules;
  const groupIds = new Set(inScope.map(group => normaliseKey(group.id)));
  return modules.filter(module => {
    if (groupIds.has(normaliseKey(module.groupId))) return true;
    // A module with no stored group still belongs somewhere: fall back to its
    // cached cohort/programme so it stays findable instead of silently missing.
    if (normaliseKey(module.groupId)) return false;
    if (scope.cohortId) return sameIdentifier(module.cohortId, scope.cohortId);
    const programme = findProgramme(programmes, scope.programmeId);
    const keys = programme ? programmeKeys(programme) : [normaliseKey(scope.programmeId)];
    return matchesAny([module.programmeId, module.programme], keys);
  });
}

// ------------------------------------------------------------------ search

/** Case-insensitive "every word appears somewhere in these fields" search. */
export function matchesSearch(query: string, fields: unknown[]): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = fields.map(field => String(field ?? '')).join(' ').toLowerCase();
  return terms.every(term => haystack.includes(term));
}

// ------------------------------------------------------------------ counts

export function countsForProgramme(
  programme: CurriculumProgramme,
  index: EntityIndex,
): { cohorts: number; groups: number; modules: number; learners: number } {
  const cohorts = cohortsForProgramme(index.cohorts, index.programmes, programmeIdentity(programme));
  const cohortIds = new Set(cohorts.map(cohort => normaliseKey(cohort.id)));
  const groups = index.groups.filter(group => cohortIds.has(normaliseKey(group.cohortId)));
  const groupIds = new Set(groups.map(group => normaliseKey(group.id)));
  const modules = index.modules.filter(module => groupIds.has(normaliseKey(module.groupId)));
  return {
    // The programme's own counters stay authoritative when they are populated;
    // the derived numbers cover a programme the compact payload has not counted.
    cohorts: cohorts.length || programme.cohorts || 0,
    groups: groups.length || programme.groups || 0,
    modules: modules.length || programme.modules || 0,
    learners: programme.learners || 0,
  };
}

// -------------------------------------------------------------- formatting

export function formatDateLabel(value: unknown): string {
  const text = cleanText(value);
  if (!text) return '—';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTimeLabel(value: unknown): string {
  const text = cleanText(value);
  if (!text) return '—';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** The calendar year a cohort belongs to, for the Cohorts page year filter. */
/**
 * How many days of holiday a stored cohort's practical end date was extended by.
 *
 * Zero when nothing moved. Read-only screens use this to explain why a 24 month
 * cohort finishes later than 24 months from its start date -- the duration is
 * the contracted figure and stays put, so without this the two read as a
 * contradiction. `baseEndDate` is the duration rule alone; the stored practical
 * end date already has the holidays folded in.
 */
export function cohortHolidayExtensionDays(
  cohort: Pick<CurriculumCohort, 'baseEndDate' | 'endDate' | 'practicalEndDate'>,
): number {
  const base = cleanText(cohort.baseEndDate);
  const actual = cleanText(cohort.practicalEndDate) || cleanText(cohort.endDate);
  if (!base || !actual) return 0;
  const from = new Date(base);
  const to = new Date(actual);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  return days > 0 ? days : 0;
}

export function cohortYear(cohort: CurriculumCohort): string {
  const match = /(\d{4})/.exec(cleanText(cohort.startDate));
  return match ? match[1] : '';
}

export function scheduleLabel(group: Pick<CurriculumGroup, 'weekDays' | 'startTime' | 'endTime' | 'schedule'>): string {
  const days = cleanText(group.weekDays);
  const start = cleanText(group.startTime);
  const end = cleanText(group.endTime);
  if (days && start) return `${days} · ${start}${end ? `–${end}` : ''}`;
  return cleanText(group.schedule) || '—';
}

export const CURRICULUM_STATUS_TONES: Record<string, string> = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  published: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  planned: 'border-sky-200 bg-sky-50 text-sky-700',
  draft: 'border-amber-200 bg-amber-50 text-amber-700',
  review: 'border-amber-200 bg-amber-50 text-amber-700',
  completed: 'border-foreground-200 bg-background-100 text-foreground-600',
  archived: 'border-foreground-200 bg-background-100 text-foreground-500',
};

export function statusTone(status: unknown): string {
  return CURRICULUM_STATUS_TONES[normaliseKey(status)] || 'border-foreground-200 bg-background-100 text-foreground-600';
}

/**
 * Two form snapshots hold the same answers. Drawers use it to tell an untouched
 * form from one carrying unsaved edits, so closing the second can ask first.
 *
 * Keys are compared one at a time rather than by stringifying the whole object,
 * so a snapshot assembled in a different key order is not read as a change, and
 * null / undefined / '' are treated alike — for a form field they all mean the
 * user has not answered.
 */
export function sameFormValues(
  left: Record<string, unknown> | null | undefined,
  right: Record<string, unknown> | null | undefined,
): boolean {
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  return [...keys].every(key => JSON.stringify(left?.[key] ?? '') === JSON.stringify(right?.[key] ?? ''));
}
