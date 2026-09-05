import type { CurriculumKsbEntry, CurriculumModule, LibraryComponent } from '@/lib/curriculumApi';
import {
  CurriculumApiError,
  clearCurriculumGetCache,
  fetchCurriculumJson,
  invalidateCurriculumCacheByEntity,
} from '@/lib/curriculumApi';
import {
  assertComponentUploadAllowed,
  uploadComponentFile,
} from '@/pages/curriculum/shared/componentUploadPolicy';
import {
  componentTypeGroups,
  componentTypes,
  getDefaultComponentSettings,
  getComponentDefinition,
  normaliseComponentSettings,
  type ComponentSettings,
  type ComponentSettingValue,
  type KsbMappingType,
  type ModuleComponentType,
  type ModuleStatus,
} from './componentAuthoringModel';

export { componentTypeGroups, componentTypes, getDefaultComponentSettings };
export type { ComponentSettings, KsbMappingType, ModuleComponentType, ModuleStatus };

export type KsbWeightClass = 'hard' | 'soft' | 'possible';

export interface KsbMapping {
  id: string;
  ksbId: string;
  code: string;
  description: string;
  sourceType?: string;
  sourceId?: string;
  type: KsbMappingType;
  classification?: KsbMappingType;
  weight: number;
  weightClass: KsbWeightClass;
  weight_class?: KsbWeightClass;
}

export interface CompletionCriteria {
  quizzesCompletedRequired: boolean;
  checkpointsCompletedRequired: boolean;
  averageScoreRequiredEnabled: boolean;
  averageScoreRequired: number;
  totalScoreRequiredEnabled: boolean;
  totalScoreRequired: number;
  additionalNotes: string;
}

export interface AdvancedModuleDetails {
  intent: string;
  learnerBenefit: string;
  employerBenefit: string;
  sequencePurpose: string;
}

export interface ModuleComponent {
  id: string;
  sourceId?: string;
  /**
   * The component this one was copied from, when it came out of the reuse
   * library. Provenance only - a copy is fully independent of its source.
   * Distinct from `sourceId`, which maps a delivery row back to its catalogue.
   */
  copiedFromId?: string;
  moduleId?: string;
  weekId: string;
  type: ModuleComponentType;
  title: string;
  description: string;
  expectedOtjh: number;
  points: number;
  reflectionRequired: boolean;
  /**
   * What the learner is asked to reflect on. Stored in its own column on
   * `curriculum.components` rather than in `settings`, and only editable while
   * `reflectionRequired` is on — the answer has nowhere to go otherwise.
   */
  reflectionQuestion: string;
  workplaceEvidenceRequired: boolean;
  tutorValidationRequired: boolean;
  ksbMappings: KsbMapping[];
  settings: ComponentSettings;
}

export interface ModuleWeek {
  id: string;
  moduleId: string;
  weekNumber: number;
  title: string;
  summary: string;
  learningOutcomes: string[];
  components: ModuleComponent[];
  ksbMappings: KsbMapping[];
  /**
   * The day this week actually runs, from the module's own dated session plan —
   * holiday shifts included. Served by the structure payload, never authored
   * here: the schedule lives on the module, and the weeks read it.
   */
  sessionDate?: string;
  sessionDay?: string;
  sessionStartTime?: string;
  sessionDurationMinutes?: number;
}

export interface ModuleMonthGroup {
  /** '2026-12', or '' for the weeks whose month is not known yet. */
  key: string;
  label: string;
  weeks: ModuleWeek[];
}

/**
 * The module's weeks, split into the months they run in.
 *
 * A module is authored as a run of weeks but delivered — and reported on — by
 * month, so a six-week module that crosses Christmas is really "one week in
 * December, five in January". Grouping is by each week's own session date, so
 * the split moves with the holiday shifts rather than assuming four weeks make a
 * month.
 *
 * Returns [] when no week has a date: there is no month to name, and a single
 * "Unscheduled" heading over the whole list tells a reader nothing.
 */
export function groupWeeksByMonth(weeks: ModuleWeek[]): ModuleMonthGroup[] {
  if (!weeks.some(week => monthKeyOf(week.sessionDate))) return [];
  const groups: ModuleMonthGroup[] = [];
  weeks.forEach(week => {
    const key = monthKeyOf(week.sessionDate);
    const current = groups[groups.length - 1];
    // Only ever extends the run in progress, so the weeks stay in module order:
    // a heading is a stretch of the timetable, not a bucket to file weeks into.
    // A week with no date of its own is the next week of the run before it.
    if (current && (!key || current.key === key)) {
      current.weeks.push(week);
      return;
    }
    groups.push({ key, label: monthLabelOf(key), weeks: [week] });
  });
  return groups;
}

function monthKeyOf(value?: string) {
  const text = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})/.exec(text);
  return match ? `${match[1]}-${match[2]}` : '';
}

function monthLabelOf(key: string) {
  if (!key) return 'Not scheduled yet';
  const parsed = new Date(`${key}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return key;
  return parsed.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/**
 * The module's dated session plan, as the backend generates it.
 *
 * `skippedHolidays` on a session names the delivery days that were closed on the
 * way to it, so a date that moved can say why it moved.
 */
export interface ModuleWeekSessionPlan {
  sessions: Array<{ sessionNumber: number; date: string; day: string; skippedHolidays: string[] }>;
  skippedHolidays: string[];
  finalEndDate: string;
  warnings: string[];
}

/**
 * The module with every week carrying the day it now runs on.
 *
 * The plan is applied by *position*, because week N is session N: a seventh week
 * added to a six-week module takes the seventh planned date -- the next delivery
 * day the cohort has not closed for a holiday -- and the weeks before it keep
 * the dates they already had.
 *
 * With `followEndDate`, the module's end date follows the plan only when it *was*
 * the plan: an end date that is one of the planned session dates was calculated
 * from a shorter run and moves out to the new last session, while a date set by
 * hand in the module form is left exactly where the person put it. Dating the
 * weeks of a module that was just opened passes it off -- nothing about the run
 * changed there, so nothing about its dates should read as an edit.
 *
 * Returns the module unchanged when nothing moved, so applying a plan the weeks
 * already agree with cannot mark a freshly-loaded module as edited.
 */
export function applyModuleWeekSessionPlan(
  module: ModuleCatalogueItem,
  plan: ModuleWeekSessionPlan,
  options: { followEndDate?: boolean } = {},
): ModuleCatalogueItem {
  const sessions = plan?.sessions || [];
  if (!sessions.length) return module;
  let weeksMoved = false;
  let sessionIndex = 0;
  const weekStructure = module.weekStructure.map(week => {
    const liveComponents = week.components.filter(component => component.type === 'live-session');
    let firstSession: ModuleWeekSessionPlan['sessions'][number] | undefined;
    let components = week.components;
    if (liveComponents.length) {
      const plannedByComponentId = new Map<string, ModuleWeekSessionPlan['sessions'][number] | undefined>();
      liveComponents.forEach(component => {
        const planned = sessions[sessionIndex];
        sessionIndex += 1;
        firstSession ||= planned;
        plannedByComponentId.set(component.id, planned);
      });
      let componentsMoved = false;
      const plannedComponents = week.components.map(component => {
        if (component.type !== 'live-session') return component;
        const planned = plannedByComponentId.get(component.id);
        if (!planned?.date) return component;
        const settings = component.settings || {};
        const trackedOccurrence = Boolean(
          settings.sessionDateTimeUtc
          || (settings.teamsLiveSessionId && Number(settings.teamsSessionNumber || 0) > 0),
        );
        if (settings.sessionDate || trackedOccurrence) return component;
        componentsMoved = true;
        weeksMoved = true;
        return {
          ...component,
          settings: {
            ...settings,
            sessionDate: planned.date,
            sessionDay: planned.day || '',
          },
        };
      });
      if (componentsMoved) components = plannedComponents;
    } else {
      firstSession = sessions[sessionIndex];
      sessionIndex += 1;
    }
    const sessionDate = firstSession?.date || '';
    const sessionDay = firstSession?.day || '';
    if (
      components === week.components
      && (week.sessionDate || '') === sessionDate
      && (week.sessionDay || '') === sessionDay
    ) return week;
    weeksMoved = true;
    return { ...week, components, sessionDate, sessionDay };
  });
  const currentEndDate = String(module.endDate || '').trim();
  const endDateFollowsPlan = options.followEndDate !== false
    && (!currentEndDate || sessions.some(session => session.date === currentEndDate));
  const endDate = endDateFollowsPlan && plan.finalEndDate ? plan.finalEndDate : module.endDate;
  if (!weeksMoved && endDate === module.endDate) return module;
  return { ...module, weekStructure, endDate };
}

/**
 * Every planned session's name, indexed by session number - 1, read from the
 * live-session components the module's weeks hold.
 *
 * A session's name is not a field of its own: it is the title of the live
 * session that runs on that date -- what the Components tab shows and what the
 * Teams series is built from. So the walk here is the one
 * `applyModuleWeekSessionPlan` above and the backend's
 * `apply_module_session_plan_to_weeks` both do: live components consume the flat
 * plan in week-then-display order, and a week with no live session still
 * consumes one date. Reproducing that is what keeps the name against a date the
 * name that date's session carries, rather than an off-by-one from every
 * content-only week above it.
 *
 * `null` marks a date a content-only week consumed, so a caller can say the week
 * holds no live session instead of leaving the row unexplained.
 */
export function liveSessionNamesByNumber(module: ModuleCatalogueItem | null | undefined): Array<string | null> {
  const names: Array<string | null> = [];
  (module?.weekStructure || []).forEach(week => {
    const liveComponents = (week.components || []).filter(component => component.type === 'live-session');
    if (!liveComponents.length) {
      names.push(null);
      return;
    }
    liveComponents.forEach(component => names.push(String(component.title || '').trim()));
  });
  return names;
}

/**
 * The same weeks, with the dates back in calendar order.
 *
 * Dragging a week to a new place moves what is taught, not when the module
 * meets: the timetable is the module's, so session 1 is still the first date
 * whichever week now sits there. Without this the dates travel with the week and
 * the rail reads as a module that runs backwards until the next save re-derives
 * them.
 */
export function resequenceWeekSessionDates(weeks: ModuleWeek[]): ModuleWeek[] {
  // Earliest first, undated weeks last: the plan generates dates in order, so
  // sorting them is enough to put session 1 back at the top of the rail. A week
  // with no date is one the plan has not reached, which is the end of the run.
  const dates = weeks
    .map(week => ({ sessionDate: week.sessionDate, sessionDay: week.sessionDay }))
    .sort((a, b) => (
      a.sessionDate && b.sessionDate
        ? a.sessionDate.localeCompare(b.sessionDate)
        : (a.sessionDate ? 0 : 1) - (b.sessionDate ? 0 : 1)
    ));
  return weeks.map((week, index) => (
    (week.sessionDate || '') === (dates[index].sessionDate || '')
      ? week
      : { ...week, ...dates[index] }
  ));
}

export interface ModuleCatalogueItem {
  id: string;
  catalogueId: string;
  programmeId: string;
  programmeName: string;
  programmeStatus?: 'active' | 'draft' | string;
  cohortId?: string;
  cohort?: string;
  groupId?: string;
  group?: string;
  isProgrammeDeleted?: boolean;
  title: string;
  description: string;
  color?: string;
  status: ModuleStatus;
  authoringStatus?: ModuleStatus;
  sourceType?: string;
  sourceId?: string;
  deliveryStatus?: string;
  deliveryMetadata?: Record<string, ComponentSettingValue>;
  ksbProfileSourceId?: string;
  tutor?: string;
  coach?: string;
  sessionsNumber?: number;
  startDate?: string;
  endDate?: string;
  weeks: number;
  totalOtjh: number;
  declaredTotalOtjh?: number;
  ksbCount: number;
  lessonCount: number;
  quizCount: number;
  qualityScore: number;
  moduleKsbMappings: KsbMapping[];
  completionCriteria: CompletionCriteria;
  advancedDetails: AdvancedModuleDetails;
  background: string;
  epaRequirements: string[];
  qualificationOutcomes: string[];
  weekStructure: ModuleWeek[];
  sourceModule?: CurriculumModule;
}

export interface KsbOption {
  id: string;
  code: string;
  description: string;
  type?: string;
  title?: string;
  sourceType?: string;
  sourceId?: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';

export const emptyCompletionCriteria = (): CompletionCriteria => ({
  quizzesCompletedRequired: false,
  checkpointsCompletedRequired: false,
  averageScoreRequiredEnabled: false,
  averageScoreRequired: 70,
  totalScoreRequiredEnabled: false,
  totalScoreRequired: 100,
  additionalNotes: '',
});

export const emptyAdvancedDetails = (): AdvancedModuleDetails => ({
  intent: '',
  learnerBenefit: '',
  employerBenefit: '',
  sequencePurpose: '',
});

function authoringIdPrefix(prefix: string) {
  const text = String(prefix || '').toUpperCase();
  if (text.startsWith('MOD')) return 'MOD';
  if (text.startsWith('WEEK')) return 'WEEK';
  if (text.startsWith('COMP')) return 'COMP';
  if (text.startsWith('KSB')) return 'KSBMAP';
  return text.replace(/[^A-Z0-9]+/g, '') || 'ID';
}

export function makeAuthoringId(prefix: string) {
  const timestamp = new Date().toISOString().replace(/\D/g, '');
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${authoringIdPrefix(prefix)}-${timestamp}${suffix}`;
}

const makeId = makeAuthoringId;

function isCanonicalModuleCatalogueId(value: unknown) {
  return /^MOD-[A-Z0-9][A-Z0-9_-]*$/i.test(String(value || '').trim());
}

function canonicalModuleCatalogueId(module: CurriculumModule) {
  return [module.moduleCatalogueId, module.catalogueId, module.moduleId, module.structureId]
    .map(value => String(value || '').trim())
    .find(isCanonicalModuleCatalogueId) || '';
}

export function createEmptyComponent(weekId: string, type: ModuleComponentType, index: number): ModuleComponent {
  const definition = getComponentDefinition(type);
  return {
    id: makeId('component'),
    weekId,
    type,
    title: `${definition.label} ${index}`,
    description: '',
    expectedOtjh: definition.defaultOtjh,
    points: definition.defaultPoints,
    reflectionRequired: definition.reflectionDefault,
    reflectionQuestion: String(getDefaultComponentSettings(type).reflectionPrompt || ''),
    workplaceEvidenceRequired: definition.workplaceEvidenceDefault,
    tutorValidationRequired: definition.tutorValidationDefault,
    ksbMappings: [],
    settings: getDefaultComponentSettings(type),
  };
}

export function createEmptyWeek(moduleId: string, weekNumber: number): ModuleWeek {
  return {
    id: makeId('week'),
    moduleId,
    weekNumber,
    title: `Week ${weekNumber}`,
    summary: '',
    learningOutcomes: [],
    components: [],
    ksbMappings: [],
  };
}

function normalisePlaceholderText(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * A week's authored title, or '' when the title only repeats its number.
 *
 * `createEmptyWeek` seeds a week's title as "Week N", so an unedited module
 * carries titles that say exactly what the number beside them says. Printed as
 * `Week ${n} · ${title}` that came out as "Week 1 · Week 1". The number and the
 * title are worth showing together only when the title adds something.
 *
 * The placeholder test is the one `isGeneratedWeekPlaceholderComponent` uses, so
 * "Week 1", "week 1" and "WEEK  1" are all recognised as the generated default.
 */
export function weekAuthoredTitle(week: Pick<ModuleWeek, 'weekNumber' | 'title'>): string {
  const title = String(week.title || '').trim();
  if (!title) return '';
  return normalisePlaceholderText(title) === normalisePlaceholderText(`Week ${week.weekNumber}`) ? '' : title;
}

/**
 * What to print beside a week's number badge: the title the Module Builder
 * holds, exactly as its own rail shows it. Falls back to "Week N" for a week
 * with no title at all, so the row is never nameless.
 */
export function weekHeadingTitle(week: Pick<ModuleWeek, 'weekNumber' | 'title'>): string {
  return String(week.title || '').trim() || `Week ${week.weekNumber}`;
}

/**
 * A week named in running text, where there is no number badge to carry the
 * number — a KSB's placement, for instance. "Week 3", or "Week 3 - <title>"
 * when the title says more than the number does.
 */
export function weekPlacementLabel(week: Pick<ModuleWeek, 'weekNumber' | 'title'>, separator = ' - '): string {
  const title = weekAuthoredTitle(week);
  return title ? `Week ${week.weekNumber}${separator}${title}` : `Week ${week.weekNumber}`;
}

function isGeneratedWeekPlaceholderComponent(component: ModuleComponent, week: Pick<ModuleWeek, 'weekNumber' | 'title'>) {
  const titleKey = normalisePlaceholderText(component.title);
  const weekKeys = [week.title, `Week ${week.weekNumber}`].map(normalisePlaceholderText).filter(Boolean);
  const typeKey = normalisePlaceholderText(component.type);
  const hasKsbMappings = Boolean((component.ksbMappings || []).length);
  return !hasKsbMappings && weekKeys.includes(titleKey) && (typeKey.includes('live') || typeKey.includes('session'));
}

export function createLocalModuleDraft(input: { programme: string; title: string; description: string; weeks: number; status: ModuleStatus; catalogueId?: string; programmeId?: string; programmeStatus?: string; cohortId?: string; cohortName?: string; groupId?: string; groupName?: string; ksbProfileSourceId?: string; sessionsNumber?: number; startDate?: string; endDate?: string }): ModuleCatalogueItem {
  const catalogueId = input.catalogueId || makeAuthoringId('MOD');
  const id = `local-${catalogueId}`;
  const weekCount = Math.max(0, Math.round(Number(input.weeks) || 0));
  const weekStructure = Array.from({ length: weekCount }, (_, index) => createEmptyWeek(id, index + 1));
  return recalculateModule({
    id,
    catalogueId,
    // An unassigned draft carries an EMPTY programmeId, never a placeholder
    // string. 'programme-local' used to be sent here and the backend accepted
    // it as a real identifier, creating junk programme rows. A programme NAME
    // is not an id either, so it is no longer used as a fallback.
    programmeId: input.programmeId || '',
    programmeName: input.programme || 'Unassigned programme',
    programmeStatus: input.programmeStatus || '',
    cohortId: input.cohortId || '',
    cohort: input.cohortName || '',
    groupId: input.groupId || '',
    group: input.groupName || '',
    title: input.title,
    description: input.description,
    status: input.status || 'draft',
    ksbProfileSourceId: input.ksbProfileSourceId || '',
    sessionsNumber: Math.max(0, Math.round(Number(input.sessionsNumber ?? input.weeks) || 0)),
    startDate: input.startDate || '',
    endDate: input.endDate || '',
    weeks: weekStructure.length,
    totalOtjh: 0,
    ksbCount: 0,
    lessonCount: 0,
    quizCount: 0,
    qualityScore: 0,
    moduleKsbMappings: [],
    completionCriteria: emptyCompletionCriteria(),
    advancedDetails: emptyAdvancedDetails(),
    background: '',
    epaRequirements: [],
    qualificationOutcomes: [],
    weekStructure,
    deliveryMetadata: {
      cohortId: input.cohortId || '',
      cohort: input.cohortName || '',
      groupId: input.groupId || '',
      group: input.groupName || '',
    },
  });
}

export async function createNewModule(input: { programme: string; title: string; description: string; weeks: number; status: ModuleStatus; programmeId?: string; programmeStatus?: string; cohortId?: string; cohortName?: string; groupId?: string; groupName?: string; ksbProfileSourceId?: string; sessionsNumber?: number; startDate?: string; endDate?: string }) {
  const draft = createLocalModuleDraft(input);
  try {
    const response = await apiJson<{ created: boolean; moduleCatalogueId?: string; module?: ModuleCatalogueItem }>('/curriculum/modules/', {
      method: 'POST',
      body: JSON.stringify({
        title: draft.title,
        moduleType: 'authoring',
        sourceType: 'authoring',
        description: draft.description,
        programmeId: draft.programmeId,
        programmeStatus: draft.programmeStatus,
        programme: draft.programmeName,
        programmeName: draft.programmeName,
        cohortId: input.cohortId || '',
        cohortName: input.cohortName || '',
        groupId: input.groupId || '',
        groupName: input.groupName || '',
        status: draft.status || 'draft',
        sessionsNumber: draft.sessionsNumber ?? draft.weeks,
        // The authored week count, sent apart from the calendar session count.
        weeksNumber: draft.weeks,
        startDate: draft.startDate || '',
        endDate: draft.endDate || '',
        weekStructure: draft.weekStructure,
        completionCriteria: draft.completionCriteria,
        advancedDetails: draft.advancedDetails,
        moduleKsbMappings: draft.moduleKsbMappings,
        ksbProfileSourceId: draft.ksbProfileSourceId || '',
        background: draft.background,
        epaRequirements: draft.epaRequirements,
        qualificationOutcomes: draft.qualificationOutcomes,
      }),
    });
    return recalculateModule(response.module || { ...draft, catalogueId: response.moduleCatalogueId || draft.catalogueId });
  } catch (err) {
    throw err;
  }
}

export async function duplicateModuleStructure(source: ModuleCatalogueItem) {
  const copyId = `copy-${Date.now().toString(36)}`;
  const cloneMappings = (mappings: KsbMapping[] = [], scope: string) => mappings.map((mapping, index) => ({
    ...mapping,
    id: makeId(`ksb-${scope}-${index + 1}`),
  }));
  const duplicate = recalculateModule({
    ...source,
    id: copyId,
    catalogueId: makeAuthoringId('MOD'),
    title: `${source.title} copy`,
    status: 'draft',
    sourceModule: undefined,
    moduleKsbMappings: cloneMappings(source.moduleKsbMappings, 'module'),
    completionCriteria: { ...source.completionCriteria },
    advancedDetails: { ...source.advancedDetails },
    epaRequirements: [...(source.epaRequirements || [])],
    qualificationOutcomes: [...(source.qualificationOutcomes || [])],
    weekStructure: source.weekStructure.map((week, weekIndex) => {
      const weekId = makeId(`week-copy-${weekIndex + 1}`);
      return {
        ...week,
        id: weekId,
        moduleId: copyId,
        learningOutcomes: [...(week.learningOutcomes || [])],
        ksbMappings: cloneMappings(week.ksbMappings, `week-${weekIndex + 1}`),
        components: week.components.map((component, componentIndex) => ({
          ...component,
          id: makeId(`component-copy-${weekIndex + 1}-${componentIndex + 1}`),
          weekId,
          ksbMappings: cloneMappings(component.ksbMappings, `component-${weekIndex + 1}-${componentIndex + 1}`),
          settings: { ...(component.settings || {}) },
        })),
      };
    }),
  });

  try {
    const created = await createNewModule({
      programme: duplicate.programmeName,
      title: duplicate.title,
      description: duplicate.description,
      weeks: Math.max(1, duplicate.weekStructure.length),
      status: 'draft',
    });
    const payload = recalculateModule({ ...duplicate, catalogueId: created.catalogueId, id: created.id || duplicate.id });
    const saved = await saveModuleStructure(payload.catalogueId, payload);
    return saved;
  } catch (err) {
    throw err;
  }
}

// Keys that describe a component's relationship to *its own* week/module — a
// copy lands in a different one, so carrying these forward is always wrong:
// stale group ids from the source's context, and (worse) placedCopy* pointers
// that would make the clone's "Assigned groups" cascade-delete reach into
// whatever module/week the *source* had placed a copy in, not its own. The
// clone starts with a clean slate; the target's own AssignedGroupsSection
// re-derives its locked group on first render.
const GROUP_ASSIGNMENT_SETTING_KEYS = [
  'selectedGroupKeys',
  'selectedGroupNames',
  'placedCopyGroupKeys',
  'placedCopyModuleCatalogueIds',
  'placedCopyWeekIds',
  'placedCopyComponentIds',
] as const;

function withoutGroupAssignmentSettings(settings: ComponentSettings): ComponentSettings {
  const next = { ...settings };
  GROUP_ASSIGNMENT_SETTING_KEYS.forEach(key => { delete next[key]; });
  return next;
}

/**
 * Copy a component out of the reuse library into a week, as a snapshot.
 *
 * Every id is regenerated so the copy is fully independent: editing or deleting
 * it never touches the source, and vice versa. The one thing deliberately
 * *shared* is `settings.linkedQuizId` - quizzes are standalone rows that carry
 * learner attempts, so duplicating one would fragment reporting.
 *
 * The copy is applied to client state and persisted by the normal
 * full-structure save. A per-component write would not survive it:
 * `save_module_authoring_structure` soft-deletes every component of the module
 * and re-upserts from the payload it is given.
 */
export function copyComponentIntoWeek(
  source: LibraryComponent,
  targetWeekId: string,
  targetModuleId: string,
): ModuleComponent {
  // `componentType` is the authoring type; `type` is a shared human label.
  const type = (source.componentType || 'reading') as ModuleComponentType;
  const definition = getComponentDefinition(type);
  return {
    id: makeAuthoringId('component'),
    copiedFromId: source.id,
    moduleId: targetModuleId,
    weekId: targetWeekId,
    type,
    title: source.title || definition.label,
    description: source.description || '',
    expectedOtjh: Number(source.expectedOtjh ?? definition.defaultOtjh) || 0,
    points: Number(source.points ?? definition.defaultPoints) || 0,
    reflectionRequired: Boolean(source.reflectionRequired ?? definition.reflectionDefault),
    reflectionQuestion: String(
      source.reflectionQuestion
      ?? (source.settings as ComponentSettings | undefined)?.reflectionPrompt
      ?? getDefaultComponentSettings(type).reflectionPrompt
      ?? '',
    ),
    workplaceEvidenceRequired: Boolean(source.workplaceEvidenceRequired ?? definition.workplaceEvidenceDefault),
    tutorValidationRequired: Boolean(source.tutorValidationRequired ?? definition.tutorValidationDefault),
    ksbMappings: (source.ksbMappings || []).map(mapping => {
      const type = (mapping.type || mapping.classification || 'secondary') as KsbMappingType;
      const weightClass = (mapping.weightClass || mapping.weight_class || 'soft') as KsbWeightClass;
      return {
        ...mapping,
        id: makeAuthoringId('ksb'),
        type,
        // The API widens these to string; narrow both spellings together so the
        // copy carries the same classification the source had.
        classification: type,
        weightClass,
        weight_class: weightClass,
      };
    }),
    settings: normaliseComponentSettings(type, withoutGroupAssignmentSettings({
      ...getDefaultComponentSettings(type),
      ...((source.settings || {}) as ComponentSettings),
    })),
  };
}

/**
 * Copy a component that's being edited into a *different* week — possibly in
 * another group's module entirely — as an independent snapshot.
 *
 * Same id-regeneration + `copiedFromId` provenance convention as
 * `copyComponentIntoWeek`: the placed copy never reaches back into the
 * component it came from, and vice versa.
 */
export function copyComponentToWeek(
  source: ModuleComponent,
  targetWeekId: string,
  targetModuleId: string,
): ModuleComponent {
  return {
    ...source,
    id: makeAuthoringId('component'),
    copiedFromId: source.id,
    moduleId: targetModuleId,
    weekId: targetWeekId,
    settings: withoutGroupAssignmentSettings(source.settings),
    ksbMappings: source.ksbMappings.map(mapping => ({ ...mapping, id: makeAuthoringId('ksb') })),
  };
}

export async function deleteModuleStructure(moduleCatalogueId: string) {
  await apiJson<{ deleted?: boolean; archived?: boolean; deletedAuthoring?: boolean; id?: string }>(`/curriculum/modules/${encodeURIComponent(moduleCatalogueId)}/`, {
    method: 'DELETE',
  });
  // As in `saveModuleStructure`: this write bypasses the shared cache, so the
  // cached structure of a module that no longer exists has to be dropped here.
  invalidateCurriculumCacheByEntity('module');
}

/**
 * A module's authored weeks and components.
 *
 * Read through the shared curriculum cache rather than this file's bare
 * `apiJson`, because several places want the same module at the same moment --
 * the Module Builder, the module workspace, the module drawer's session preview,
 * the week builder's place-component drawer -- and StrictMode mounts each of
 * them twice in development. Uncached, that was four to six identical requests
 * for one payload, queued behind each other on the server until their timeout
 * aborted them; shared, it is one request and a two-minute answer.
 */
export async function loadModuleStructure(catalogueId: string): Promise<ModuleCatalogueItem | null> {
  try {
    return recalculateModule(await fetchCurriculumJson<ModuleCatalogueItem>(
      `/curriculum/modules/${encodeURIComponent(catalogueId)}/structure/`,
      { timeoutMs: 30000 },
    ));
  } catch (err) {
    const status = err instanceof ApiError || err instanceof CurriculumApiError ? err.status : 0;
    if (status === 404) return null;
    throw err;
  }
}

/**
 * Where this module's weeks would run if it had `weeks` of them.
 *
 * Adding or removing a week in the builder changes the timetable before anything
 * is saved, and the dates are the backend's to generate -- it is the only place
 * that knows the delivery day, the cohort's ticked holidays and the shifts they
 * cause. Asking for them keeps the rail showing the dates the save will store
 * rather than a second schedule worked out in the browser.
 *
 * Returns null for a module the backend has never stored (a local draft), where
 * there is no schedule to plan from yet.
 */
export async function loadModuleWeekSessionPlan(moduleCatalogueId: string, weeks: number): Promise<ModuleWeekSessionPlan | null> {
  const catalogueId = String(moduleCatalogueId || '').trim();
  const count = Math.max(0, Math.round(Number(weeks) || 0));
  if (!catalogueId || !count) return null;
  try {
    return await apiJson<ModuleWeekSessionPlan>(
      `/curriculum/modules/${encodeURIComponent(catalogueId)}/session-plan/?weeks=${count}`,
    );
  } catch (err) {
    // A module with no stored schedule simply has no dates to show. Failing the
    // add-a-week the person just made would be the worse answer.
    console.warn('No session plan could be generated for this module.', err);
    return null;
  }
}

export interface ModuleStructureResolveRequest {
  requestId: string;
  identifier: string;
  identifiers?: string[];
}

export interface ModuleStructureResolveResult {
  requestId: string;
  identifier: string;
  catalogueId: string;
  found: boolean;
  missing?: boolean;
  // Set when several Module Builder modules share the linked title and no id
  // identified which one. Distinct from `missing`: the content exists but cannot
  // be attributed, so it must never be rendered as an empty module.
  ambiguous?: boolean;
  ambiguousCatalogueIds?: string[];
  componentCount?: number;
  hasComponents?: boolean;
  message?: string;
  module?: ModuleCatalogueItem;
}

export async function loadModuleStructuresBatch(modules: ModuleStructureResolveRequest[]): Promise<ModuleStructureResolveResult[]> {
  const response = await apiJson<{ results: ModuleStructureResolveResult[] }>('/curriculum/modules/resolve-structures/', {
    method: 'POST',
    body: JSON.stringify({ modules }),
    timeoutMs: 8000,
  });
  return response.results.map(result => ({
    ...result,
    module: result.module ? recalculateModule(result.module) : undefined,
  }));
}

export async function updateModuleSettings(moduleCatalogueId: string, payload: Partial<ModuleCatalogueItem>) {
  const response = await apiJson<{ updated: boolean; module: ModuleCatalogueItem }>(`/curriculum/modules/${encodeURIComponent(moduleCatalogueId)}/settings/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  // Same reason as `saveModuleStructure`: an `apiJson` write invalidates nothing.
  invalidateCurriculumCacheByEntity('module');
  return recalculateModule(response.module);
}

export function createLegacyLocalModule(input: { programme: string; title: string; description: string; weeks: number; status: ModuleStatus }): ModuleCatalogueItem {
  const catalogueId = makeAuthoringId('MOD');
  const id = `local-${catalogueId}`;
  const weekStructure = Array.from({ length: Math.max(1, input.weeks || 1) }, (_, index) => createEmptyWeek(id, index + 1));
  return recalculateModule({
    id,
    catalogueId,
    // Never derive an id from the programme NAME, and never persist a
    // placeholder. An unassigned legacy draft has no programme id.
    programmeId: '',
    programmeName: input.programme || 'Unassigned programme',
    title: input.title,
    description: input.description,
    status: input.status || 'draft',
    sessionsNumber: weekStructure.length,
    startDate: '',
    endDate: '',
    weeks: weekStructure.length,
    totalOtjh: 0,
    ksbCount: 0,
    lessonCount: 0,
    quizCount: 0,
    qualityScore: 0,
    moduleKsbMappings: [],
    completionCriteria: emptyCompletionCriteria(),
    advancedDetails: emptyAdvancedDetails(),
    background: '',
    epaRequirements: [],
    qualificationOutcomes: [],
    weekStructure,
  });
}

export function curriculumModuleToCatalogue(module: CurriculumModule): ModuleCatalogueItem {
  const canonicalId = canonicalModuleCatalogueId(module);
  // Temporary legacy fallback: unlinked delivery rows still open through their delivery identifier.
  const catalogueId = canonicalId || String(module.deliveryModuleId || module.id || module.sourceId);
  const id = `module-${catalogueId}`;
  const title = cleanUserFacingText(module.name) || `Module ${catalogueId}`;
  const description = cleanUserFacingText(module.notes || '');
  const tutor = String(module.tutor || '').trim();
  const coach = String(module.coach || '').trim();
  const weekStructure = (module.weekStructure || []).map((week, index): ModuleWeek => {
    const weekId = String(week.id || makeAuthoringId('WEEK'));
    return {
      id: weekId,
      moduleId: catalogueId,
      weekNumber: week.weekNumber || index + 1,
      title: week.title || `Week ${index + 1}`,
      summary: '',
      learningOutcomes: [],
      components: (week.components || []).map((component, componentIndex): ModuleComponent => ({
        id: String(component.id || makeAuthoringId('COMP')),
        sourceId: component.id,
        moduleId: catalogueId,
        weekId,
        type: component.type as ModuleComponentType,
        title: component.title || `Component ${componentIndex + 1}`,
        description: '',
        expectedOtjh: Number(component.expectedOtjh ?? component.duration ?? 0) || 0,
        points: Number(component.points ?? 0) || 0,
        reflectionRequired: Boolean(component.reflectionRequired),
        reflectionQuestion: String(component.reflectionQuestion || ''),
        workplaceEvidenceRequired: Boolean(component.workplaceEvidenceRequired),
        tutorValidationRequired: Boolean(component.tutorValidationRequired),
        ksbMappings: (component.ksbMappings || []) as KsbMapping[],
        settings: normaliseComponentSettings(component.type as ModuleComponentType, (component.settings || {}) as ComponentSettings),
      })),
      ksbMappings: [],
    };
  });
  return recalculateModule({
    id,
    catalogueId,
    programmeId: module.programmeId || module.programme || 'programme',
    programmeName: module.programme || 'Unassigned programme',
    cohortId: module.cohortId || '',
    cohort: module.cohort || '',
    groupId: module.groupId || '',
    group: module.group || '',
    isProgrammeDeleted: Boolean(module.isProgrammeDeleted),
    title,
    description,
    status: module.status || 'draft',
    authoringStatus: module.authoringStatus || module.status || 'draft',
    sourceType: undefined,
    sourceId: undefined,
    deliveryStatus: module.deliveryStatus,
    ksbProfileSourceId: module.ksbProfileSourceId || '',
    tutor,
    coach,
    deliveryMetadata: {
      tutor,
      coach,
      cohortId: module.cohortId || '',
      cohort: module.cohort || '',
      groupId: module.groupId || '',
      group: module.group || '',
    },
    sessionsNumber: module.sessionsNumber || module.weeks || module.sessionNames?.length || 0,
    startDate: module.startDate || '',
    endDate: module.endDate || '',
    // `sessionsNumber` is a last-resort fallback for payloads predating the
    // weeks/sessions split, where the two were the same number. Current
    // responses always carry `weeks`, so it is normally never reached.
    weeks: module.weeks || module.sessionNames?.length || module.sessionsNumber || 1,
    totalOtjh: 0,
    ksbCount: module.ksbCount || module.ksbCodes?.length || 0,
    lessonCount: module.lessons || module.sessionNames?.length || 0,
    quizCount: module.quizzes || 0,
    qualityScore: 0,
    moduleKsbMappings: (module.ksbCodes || []).map((code, index) => ({
      id: makeAuthoringId('KSBMAP'),
      ksbId: code,
      code,
      description: `Mapped KSB ${code}`,
      type: index < 3 ? 'main' : 'secondary',
      weight: index < 3 ? 40 : 20,
      weightClass: index < 3 ? 'hard' : 'soft',
    })),
    completionCriteria: emptyCompletionCriteria(),
    advancedDetails: emptyAdvancedDetails(),
    background: '',
    epaRequirements: [],
    qualificationOutcomes: [],
    weekStructure,
    sourceModule: module,
  });
}

export function getDefaultStructure(module: ModuleCatalogueItem): ModuleCatalogueItem {
  if (module.weekStructure.length) return recalculateModule(module);

  const source = module.sourceModule;
  // Weeks first: this builds the week skeleton, and `sessionsNumber` is the
  // delivery-day-multiplied calendar total, which would over-create weeks for
  // any group running more than one session a week.
  const weekCount = Math.max(1, module.weeks || source?.weeks || source?.sessionNames?.length || module.sessionsNumber || source?.sessionsNumber || 1);
  const weekStructure = Array.from({ length: weekCount }, (_, index) => {
    const week = createEmptyWeek(module.id, index + 1);
    return week;
  });

  return recalculateModule({ ...module, weekStructure });
}

export function recalculateModule(module: ModuleCatalogueItem): ModuleCatalogueItem {
  const moduleId = String(module.catalogueId || module.id);
  const fallbackKsbSource = moduleKsbSourceMetadata(module.ksbProfileSourceId);
  const moduleKsbMappings = normaliseKsbMappings(module.moduleKsbMappings || [], fallbackKsbSource);
  const completionCriteria = {
    ...emptyCompletionCriteria(),
    ...(module.completionCriteria || {}),
  };
  const normalisedWeeks = module.weekStructure.map((week, index) => {
    const weekId = String(week.id || makeAuthoringId('WEEK'));
    return {
      ...week,
      id: weekId,
      moduleId,
      ksbMappings: normaliseKsbMappings(week.ksbMappings || [], fallbackKsbSource),
      weekNumber: index + 1,
      components: (week.components || [])
        .filter(component => !isGeneratedWeekPlaceholderComponent(component, { ...week, weekNumber: index + 1 }))
        .map(component => ({
          ...component,
          moduleId,
          weekId,
          workplaceEvidenceRequired: false,
          ksbMappings: normaliseKsbMappings(component.ksbMappings || [], fallbackKsbSource),
          settings: normaliseComponentSettings(component.type, component.settings || {}),
        })),
    };
  });
  const allComponents = normalisedWeeks.flatMap(week => week.components);
  const hasStructure = module.weekStructure.length > 0;
  const componentKsbCodes = new Set(allComponents.flatMap(component => component.ksbMappings.map(mapping => mapping.code)));
  moduleKsbMappings.forEach(mapping => componentKsbCodes.add(mapping.code));
  normalisedWeeks.forEach(week => week.ksbMappings.forEach(mapping => componentKsbCodes.add(mapping.code)));
  const totalOtjh = allComponents.reduce((total, component) => total + Number(component.expectedOtjh || 0), 0);
  const totalPoints = allComponents.reduce((total, component) => total + Number(component.points || 0), 0);
  const quality = calculateQualityScore({ ...module, completionCriteria, totalOtjh, ksbCount: componentKsbCodes.size, moduleKsbMappings, weekStructure: normalisedWeeks });

  return {
    ...module,
    completionCriteria,
    // The authored week count is derived from the structure -- adding a seventh
    // week makes this a seven-week module, and a save has to carry that rather
    // than the stale stored number.
    weeks: hasStructure ? normalisedWeeks.length : (module.weeks || module.sessionsNumber || 0),
    // NOT re-derived from the weeks. A module delivered twice a week runs two
    // calendar sessions per authored week, so overwriting this with the week
    // count silently halved the session plan and the Teams series. It belongs to
    // the delivery slot, and only the module form (which knows the group's
    // delivery days) recomputes it.
    sessionsNumber: module.sessionsNumber,
    totalOtjh,
    declaredTotalOtjh: module.declaredTotalOtjh,
    ksbCount: hasStructure ? componentKsbCodes.size : module.ksbCount,
    lessonCount: hasStructure ? allComponents.length : module.lessonCount,
    quizCount: hasStructure ? allComponents.filter(component => ['quiz', 'checkpoint', 'monthly-ksb-quiz'].includes(component.type)).length : module.quizCount,
    qualityScore: quality,
    moduleKsbMappings,
    weekStructure: normalisedWeeks,
    description: cleanUserFacingText(module.description || module.sourceModule?.notes || ''),
    background: module.background || '',
    epaRequirements: module.epaRequirements || [],
    qualificationOutcomes: module.qualificationOutcomes || [],
  };
}

function normaliseKsbMappings(mappings: KsbMapping[], fallbackSource?: Pick<KsbMapping, 'sourceType' | 'sourceId'>) {
  return mappings.map(mapping => {
    const type = normaliseKsbMappingType(mapping.type || mapping.classification);
    const classification = normaliseKsbMappingType(mapping.classification || mapping.type);
    const weightClass = normaliseKsbWeightClass(mapping.weightClass || mapping.weight_class, classification);
    const weight = clampKsbWeight(mapping.weight);
    return {
      ...mapping,
      sourceType: mapping.sourceType || fallbackSource?.sourceType,
      sourceId: mapping.sourceId || fallbackSource?.sourceId,
      type,
      classification,
      weightClass,
      weight_class: weightClass,
      weight: weight > 0 ? weight : defaultKsbWeight(classification),
    };
  });
}

function moduleKsbSourceMetadata(sourceId?: string) {
  const id = String(sourceId || '').trim();
  if (!id) return undefined;
  return {
    sourceType: id.startsWith('standard:') ? 'standard' : 'framework',
    sourceId: id,
  };
}

function defaultKsbWeight(type: KsbMappingType) {
  if (type === 'main') return 40;
  if (type === 'secondary') return 20;
  return 10;
}

function clampKsbWeight(value: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed * 100) / 100);
}

function normaliseKsbMappingType(value?: string): KsbMappingType {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'main' || raw === 'secondary' || raw === 'possible') return raw;
  if (raw === 'practice') return 'possible';
  return 'secondary';
}

function normaliseKsbWeightClass(value?: string, fallbackClassification?: KsbMappingType): KsbWeightClass {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'hard' || raw === 'soft' || raw === 'possible') return raw;
  const legacy = normaliseKsbMappingType(fallbackClassification);
  if (legacy === 'main') return 'hard';
  if (legacy === 'possible') return 'possible';
  return 'soft';
}

export function calculateQualityChecklist(module: ModuleCatalogueItem) {
  const allComponents = module.weekStructure.flatMap(week => week.components);
  const liveSessions = allComponents.filter(component => component.type === 'live-session');
  const criteriaConfigured =
    module.completionCriteria.quizzesCompletedRequired ||
    module.completionCriteria.checkpointsCompletedRequired ||
    module.completionCriteria.averageScoreRequiredEnabled ||
    module.completionCriteria.totalScoreRequiredEnabled ||
    Boolean(module.completionCriteria.additionalNotes.trim());
  const expectedTotal = module.weekStructure.reduce(
    (total, week) => total + week.components.reduce((weekTotal, component) => weekTotal + Number(component.expectedOtjh || 0), 0),
    0,
  );
  const declaredTotal = typeof module.declaredTotalOtjh === 'number' && module.declaredTotalOtjh > 0 ? module.declaredTotalOtjh : module.totalOtjh;

  return [
    { label: 'Number of weeks defined', passed: module.weekStructure.length > 0 },
    { label: 'Each week has a title', passed: module.weekStructure.every(week => week.title.trim()) },
    { label: 'Each week has at least one component', passed: module.weekStructure.every(week => week.components.length > 0) },
    { label: 'Teams session placeholder where expected', passed: liveSessions.every(component => component.title.trim()) },
    { label: 'Recording placeholder for live sessions', passed: liveSessions.every(component => typeof component.settings.recordingExpected === 'boolean') },
    { label: 'All components have estimated OTJH greater than 0', passed: allComponents.length > 0 && allComponents.every(component => Number(component.expectedOtjh) > 0) },
    { label: 'All components have at least one KSB mapping', passed: allComponents.length > 0 && allComponents.every(component => component.ksbMappings.length > 0) },
    { label: 'All mapped KSBs have a weight', passed: allMappedKsbs(module).every(mapping => Number(mapping.weight || 0) > 0) },
    { label: 'Every mapped KSB is classified', passed: allMappedKsbs(module).every(mapping => ['main', 'secondary', 'possible'].includes(normaliseKsbMappingType(mapping.type))) },
    { label: 'Completion criteria configured', passed: criteriaConfigured },
    { label: 'Total module OTJH matches component sum', passed: Math.abs(declaredTotal - expectedTotal) < 0.01 },
  ];
}

export function calculateQualityScore(module: ModuleCatalogueItem) {
  const checklist = calculateQualityChecklist(module);
  const passed = checklist.filter(item => item.passed).length;
  return Math.round((passed / checklist.length) * 100);
}

export function allMappedKsbs(module: ModuleCatalogueItem) {
  return [
    ...module.moduleKsbMappings,
    ...module.weekStructure.flatMap(week => week.ksbMappings),
    ...module.weekStructure.flatMap(week => week.components.flatMap(component => component.ksbMappings)),
  ];
}

export function flattenKsbEntries(entries: CurriculumKsbEntry[] = []): KsbOption[] {
  return entries.map(entry => ({
    id: String(entry.id || entry.code),
    code: entry.code || entry.fullCode || entry.rawCode || String(entry.id),
    description: entry.description || entry.title || '',
    type: entry.type,
    title: entry.title,
  }));
}

export async function saveModuleStructure(moduleCatalogueId: string, payload: ModuleCatalogueItem) {
  const recalculated = recalculateModule(payload);
  // `weeksNumber` states the authored week count outright. `weeks` cannot carry
  // it: on this endpoint that name is the legacy alias for the week *list*, and
  // the backend rejects a number there.
  const body = { ...recalculated, weeksNumber: recalculated.weekStructure.length || recalculated.weeks };
  const saved = recalculateModule(await apiJson<ModuleCatalogueItem>(`/curriculum/modules/${encodeURIComponent(moduleCatalogueId)}/structure/`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    timeoutMs: 90000,
  }));
  // `apiJson` writes go straight to the network, so nothing above invalidates
  // the read this save just made stale. `loadModuleStructure` is cached now, and
  // a save that left the previous weeks in the cache would have the builder
  // re-read what it had just replaced.
  invalidateCurriculumCacheByEntity('module');
  return saved;
}

export interface ComponentUploadResult {
  uploaded: boolean;
  savedToComponent: boolean;
  componentId: string;
  moduleCatalogueId: string;
  file: {
    fileName: string;
    storedPath: string;
    url: string;
    size: number;
    contentType: string;
    componentType: string;
  };
}

export async function uploadComponentResource(input: { moduleCatalogueId: string; componentId: string; componentType: 'podcast' | 'powerpoint' | 'reading' | 'assignment'; file: File }) {
  assertComponentUploadAllowed(input.file);
  const form = new FormData();
  form.set('file', input.file);
  form.set('moduleCatalogueId', input.moduleCatalogueId);
  form.set('componentType', input.componentType);
  return uploadComponentFile<ComponentUploadResult>(`${API_BASE_URL}/curriculum/components/${encodeURIComponent(input.componentId)}/upload/`, form);
}

export interface TeamsMeetingInput {
  title: string;
  organizerEmail: string;
  attendees: string[];
  presenters?: string[];
  localStartDateTime: string;
  startDateTimeUtc: string;
  durationMinutes: number;
  repeat: 'none' | 'daily' | 'weekdays' | 'weekly';
  repeatOccurrences: number;
  lobbyBypass: string;
  recording: string;
  spokenLanguage: string;
  meetingType: string;
  details: string;
  requestResponses: boolean;
  allowNewTimeProposals: boolean;
  hideAttendees: boolean;
  transactionId: string;
  moduleDraftId?: string;
  moduleCatalogueId?: string;
  moduleTitle?: string;
  scheduledOccurrences?: Array<{
    sessionNumber: number;
    startDateTimeUtc: string;
    durationMinutes: number;
  }>;
}

export interface TeamsMeetingResult {
  created: boolean;
  meeting: {
    liveSessionId: string;
    eventId: string;
    onlineMeetingId: string;
    joinUrl: string;
    webLink: string;
    meetingOptionsUrl: string;
    organizerEmail: string;
    attendees: string[];
    presenters: string[];
    startDateTimeUtc: string;
    durationMinutes: number;
    repeat: string;
    repeatOccurrences: number;
    trackedOccurrences: number;
    provider: string;
    trackingReady: boolean;
    settingsApplied: boolean;
  };
  warnings: string[];
}

export interface TeamsMeetingConfiguration {
  configured: boolean;
  defaultOrganizer: string;
  /** Legacy compatibility flag. Current backends return false because the
   * configured organizer is a default and users may choose another mailbox. */
  organizerLocked: boolean;
  timeZone: string;
  timeZoneIana: string;
}

// The calendar's own timezone. A session time typed into the wizard means this zone --
// the college's -- and not the zone of whoever happens to be filling the form in, so
// "09:00 Saturday" is the same instant whether the programme is set up from London or
// from Cairo. Viewers are unaffected either way: the event carries one absolute
// instant, and every calendar renders it in its own reader's local time.
let calendarTimeZone = 'Europe/London';

export function getCalendarTimeZone() {
  return calendarTimeZone;
}

function zoneOffsetMs(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).reduce<Record<string, number>>((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = Number(part.value);
    return acc;
  }, {});
  const wallClock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return wallClock - instant.getTime();
}

/**
 * A stored timestamp as an instant, reading an offset-less string as UTC.
 *
 * `new Date('2026-12-12T09:00:00')` is the *reader's own* local time by
 * specification, so an API value that omits its offset lands hours away for
 * everyone outside UTC -- the same calendar reads as in sync in London and two
 * hours out in Cairo. Every Teams instant is parsed here instead, so what the
 * page shows depends only on the reader's zone, never on where the string came
 * from.
 */
export function parseUtcInstant(value: unknown): Date {
  const raw = String(value ?? '').trim();
  if (!raw) return new Date(NaN);
  // `YYYY-MM-DDTHH:mm[:ss[.sss]]` with nothing after it: no zone was named.
  const offsetless = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw);
  return new Date(offsetless ? `${raw.replace(' ', 'T')}Z` : raw);
}

/** Read a naive `YYYY-MM-DDTHH:mm` wall clock as a time in `timeZone`, as UTC ISO. */
export function zonedNaiveToUtcIso(naiveLocal: string, timeZone = calendarTimeZone) {
  const [datePart, timePart = '00:00'] = (naiveLocal || '').split('T');
  const [year, month, day] = (datePart || '').split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  if ([year, month, day, hour, minute].some(value => !Number.isFinite(value))) {
    return new Date(naiveLocal).toISOString();
  }
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  // Guess the instant as if the wall clock were UTC, then subtract the offset the zone
  // actually had there. A second pass settles the hour a DST jump adds or removes.
  let instant = wallClock;
  for (let pass = 0; pass < 2; pass += 1) {
    const corrected = wallClock - zoneOffsetMs(new Date(instant), timeZone);
    if (corrected === instant) break;
    instant = corrected;
  }
  return new Date(instant).toISOString();
}

/**
 * A UTC instant as the Microsoft calendar shows it, not as this reader's PC does.
 *
 * Every Teams date arrives as a UTC instant, and a reader sitting in another zone
 * would otherwise see a session that Teams itself lists an hour earlier. The zone
 * is the one the backend's Graph configuration reports, so it is only right once
 * `loadTeamsMeetingConfiguration` has run -- which every page showing these dates
 * does on mount.
 */
export function formatCalendarDateTime(value: unknown, timeZone = calendarTimeZone): string {
  const instant = parseUtcInstant(value);
  if (Number.isNaN(instant.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant).reduce<Record<string, string>>((accumulator, part) => {
    if (part.type !== 'literal') accumulator[part.type] = part.value;
    return accumulator;
  }, {});
  if (!parts.year || !parts.day) return '—';
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
}

/**
 * A UTC instant split into the calendar-zone date and clock a tutor edits — the
 * inverse of `zonedNaiveToUtcIso`, so `zonedNaiveToUtcIso(`${date}T${time}`)`
 * round-trips back to the same instant. Empty parts when it cannot be parsed.
 */
export function utcIsoToCalendarParts(value: unknown, timeZone = calendarTimeZone): { date: string; time: string } {
  const instant = parseUtcInstant(value);
  if (Number.isNaN(instant.getTime())) return { date: '', time: '' };
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant).reduce<Record<string, string>>((accumulator, part) => {
    if (part.type !== 'literal') accumulator[part.type] = part.value;
    return accumulator;
  }, {});
  if (!parts.year || !parts.day) return { date: '', time: '' };
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
}

function clockIn(instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(instant);
}

function shortZoneName(timeZone: string) {
  return timeZone.split('/').pop()?.replace(/_/g, ' ') || timeZone;
}

/**
 * How a wizard session time reads in the calendar's zone and in the viewer's own.
 * `viewer` is omitted when both zones show the same clock, so the hint stays quiet
 * for the people it would tell nothing new.
 */
/**
 * The reader's own timezone, and how far it sits from the calendar's.
 *
 * Teams renders one instant in each viewer's own zone, so a page that prints the
 * calendar's clock has to say whose clock that is -- otherwise 09:00 here and
 * 11:00 in the reader's Teams look like two different meetings.
 */
export function viewerZoneOffset(instant: Date | null = null) {
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone || calendarTimeZone;
  const at = instant && !Number.isNaN(instant.getTime()) ? instant : new Date();
  const differenceMinutes = Math.round(
    (zoneOffsetMs(at, viewerZone) - zoneOffsetMs(at, calendarTimeZone)) / 60000,
  );
  return {
    viewerZone,
    viewerZoneLabel: shortZoneName(viewerZone),
    calendarZoneLabel: shortZoneName(calendarTimeZone),
    /** Zero when both zones show the same clock, so callers can stay quiet. */
    differenceMinutes,
  };
}

export function describeSessionTime(naiveLocal: string) {
  const iso = zonedNaiveToUtcIso(naiveLocal);
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone || calendarTimeZone;
  const calendarClock = clockIn(instant, calendarTimeZone);
  const viewerClock = clockIn(instant, viewerZone);
  return {
    iso,
    calendarClock,
    calendarZone: shortZoneName(calendarTimeZone),
    viewerClock: viewerClock === calendarClock ? '' : viewerClock,
    viewerZone: shortZoneName(viewerZone),
  };
}

export function loadTeamsMeetingConfiguration() {
  return apiJson<TeamsMeetingConfiguration>('/curriculum/teams-meetings/', { timeoutMs: 15000 })
    .then(configuration => {
      if (configuration.timeZoneIana) calendarTimeZone = configuration.timeZoneIana;
      return configuration;
    });
}

/**
 * Write a module's tracked Teams meeting back onto its live-session components.
 *
 * `createMissingComponents` extends that to the weeks that have no live-session
 * component at all: each one is given its own, on its own session date. It is
 * opt-in because the Module Builder also calls this silently when it opens a
 * module whose join link has gone missing, and a page load must not author
 * anything the person did not ask for.
 */
export function restoreModuleTeamsMeeting(moduleCatalogueId: string, options: { createMissingComponents?: boolean } = {}) {
  return apiJson<{ restored: boolean; updatedComponents: number; createdComponents?: number; meeting: Record<string, unknown>; module: ModuleCatalogueItem }>(`/curriculum/modules/${encodeURIComponent(moduleCatalogueId)}/teams-meetings/restore/`, {
    method: 'POST',
    body: JSON.stringify({ createMissingComponents: Boolean(options.createMissingComponents) }),
    timeoutMs: 30000,
  }).then(result => {
    // Re-attaching rewrites the module's live-session components, so the cached
    // module list and Teams views must not keep serving the pre-restore state.
    clearCurriculumGetCache();
    return { ...result, module: recalculateModule(result.module) };
  });
}

/**
 * How many weeks re-attaching would give a live-session component to.
 *
 * A read-only dry run of the same walk `restoreModuleTeamsMeeting` performs, so
 * the answer can never drift from what pressing re-attach would actually do.
 * Zero means every week already has its session and the action would be a no-op.
 */
export function probeModuleTeamsAttachment(moduleCatalogueId: string) {
  return apiJson<{ pendingComponents?: number }>(
    `/curriculum/modules/${encodeURIComponent(moduleCatalogueId)}/teams-meetings/restore/?probe=1`,
    { timeoutMs: 30000 },
  ).then(result => Math.max(0, Number(result.pendingComponents) || 0));
}

export interface ModuleMeetingInvitees {
  moduleCatalogueId: string;
  presenters: string[];
  attendees: string[];
}

/**
 * Suggested Presenters/Attendees for a module's Teams meeting: the module's own
 * tutor email as presenter, and every learner whose training plan carries this
 * module as attendee. A starting point for the form, not a binding assignment —
 * the caller can still edit the lists freely before saving.
 */
export function fetchModuleMeetingInvitees(moduleCatalogueId: string) {
  return apiJson<ModuleMeetingInvitees>(`/curriculum/modules/${encodeURIComponent(moduleCatalogueId)}/meeting-invitees/`);
}

export function createTeamsMeeting(input: TeamsMeetingInput) {
  return apiJson<TeamsMeetingResult>('/curriculum/teams-meetings/', {
    method: 'POST',
    body: JSON.stringify(input),
    timeoutMs: 45000,
  }).then(result => {
    // This POST goes through this module's own client, so it never triggers the
    // curriculum GET cache's mutation invalidation. Clear it here so the module
    // list, the module-workspace Teams tab and the Teams Meetings page all read
    // the new meeting the next time they load, instead of a pre-create snapshot.
    clearCurriculumGetCache();
    return result;
  });
}

/**
 * Send a module's own session dates to its Teams series. `attendees`/`presenters`
 * are optional: omit them to move dates only, pass them to correct who is invited
 * and who presents without recreating the meeting.
 */
export function updateTeamsMeetingSchedule(liveSessionId: string, input: Pick<TeamsMeetingInput, 'title' | 'organizerEmail' | 'localStartDateTime' | 'startDateTimeUtc' | 'durationMinutes' | 'repeat' | 'repeatOccurrences' | 'scheduledOccurrences'> & { eventId?: string; attendees?: string[]; presenters?: string[] }) {
  return apiJson<{ updated: boolean; meeting: TeamsMeetingResult['meeting']; warnings?: Array<{ code?: string; message: string; detail?: string }> }>(`/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/schedule/`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    timeoutMs: 45000,
  }).then(result => {
    clearCurriculumGetCache();
    return result;
  });
}

export interface TeamsOccurrenceRescheduleResult {
  updated: boolean;
  occurrence: {
    liveSessionId: string;
    sessionNumber: number;
    startDateTimeUtc: string;
    durationMinutes: number;
    joinUrl: string;
    eventId: string;
  };
  warnings?: Array<{ code?: string; message: string; detail?: string }>;
}

/**
 * Move one session of a live-session series to a date/time of its own, leaving
 * every other session — and the module's default time — untouched. The tracked
 * occurrence keeps its own duration unless `durationMinutes` is passed.
 */
export function rescheduleTeamsOccurrence(
  liveSessionId: string,
  sessionNumber: number,
  input: { startDateTimeUtc: string; durationMinutes?: number },
) {
  return apiJson<TeamsOccurrenceRescheduleResult>(
    `/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/occurrences/${sessionNumber}/schedule/`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
      timeoutMs: 45000,
    },
  ).then(result => {
    clearCurriculumGetCache();
    return result;
  });
}

export interface TeamsArtifactSyncResult {
  synced: {
    attendanceReports: number;
    attendanceRecords: number;
    transcripts: number;
    recordings: number;
  };
  errors: string[];
  partial: boolean;
}

export interface TeamsAttendanceRecord {
  id: string;
  email: string;
  display_name: string;
  role: string;
  total_attendance_seconds: number;
  /** Graph reports a row per invitee; `false` means invited but never joined.
   *  Absent on rows written before attendance tracking, which count as present. */
  attended?: boolean;
  intervals?: Array<{
    joinDateTime?: string;
    leaveDateTime?: string;
  }> | string;
}

export interface TeamsMeetingArtifact {
  id: string;
  artifact_type: 'transcript' | 'recording' | string;
  content_url?: string;
  created_datetime?: string;
  end_datetime?: string;
}

export interface TeamsMeetingOccurrence {
  id: string;
  session_number: number;
  scheduled_start: string;
  scheduled_end: string;
  /** Set only for a session that runs on a meeting of its own; else the series' own link. */
  join_url?: string;
  online_meeting_id?: string;
  actual_start?: string;
  actual_end?: string;
  participant_count: number;
  attendance_report_id?: string;
  status: string;
  attendance: TeamsAttendanceRecord[];
  artifacts: TeamsMeetingArtifact[];
}

export interface TeamsMeetingArtifactsResult {
  series: {
    id: string;
    module_title: string;
    organizer_email: string;
    join_url: string;
    online_meeting_id: string;
  };
  occurrences: TeamsMeetingOccurrence[];
}

export function syncTeamsMeetingArtifacts(liveSessionId: string) {
  return apiJson<TeamsArtifactSyncResult>(`/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/artifacts/`, {
    method: 'POST',
    timeoutMs: 45000,
  });
}

export function loadTeamsMeetingArtifacts(liveSessionId: string) {
  return apiJson<TeamsMeetingArtifactsResult>(`/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/artifacts/`, {
    timeoutMs: 30000,
  });
}

export function teamsMeetingArtifactContentUrl(liveSessionId: string, artifactId: string) {
  return `${API_BASE_URL}/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/artifacts/${encodeURIComponent(artifactId)}/content/`;
}

export function teamsMeetingArtifactPreviewUrl(liveSessionId: string, artifactId: string) {
  return `${teamsMeetingArtifactContentUrl(liveSessionId, artifactId)}?preview=1`;
}

export function teamsMeetingRecordingEventsUrl(liveSessionId: string, artifactId: string) {
  return `${API_BASE_URL}/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/artifacts/${encodeURIComponent(artifactId)}/recording-events/`;
}

/** One thing a viewer did to a recording: started it, paused, skipped, finished. */
export interface TeamsRecordingEventInput {
  type: 'play' | 'pause' | 'seeked' | 'ended' | 'heartbeat' | 'open' | 'close';
  videoTimeSeconds: number;
  previousVideoTimeSeconds?: number;
  skipFromSeconds?: number;
  skipToSeconds?: number;
  watchedSecondsDelta?: number;
  durationSeconds?: number;
  playbackRate?: number;
  eventTime?: string;
}

/**
 * Record how a recording was watched. Whoever reviews a session in the LMS is
 * doing so instead of attending it, so who watched what — and what they skipped
 * — is part of the session's record rather than a private matter of the player.
 */
export function saveTeamsRecordingEvents(
  liveSessionId: string,
  artifactId: string,
  payload: {
    previewSessionId?: string;
    viewer?: { id?: string; email?: string; name?: string; role?: string };
    browser?: { sessionId?: string; viewportWidth?: number; viewportHeight?: number; userAgent?: string; pageUrl?: string };
    events: TeamsRecordingEventInput[];
  },
) {
  return apiJson<{ saved: number; previewSessionId: string }>(
    `/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/artifacts/${encodeURIComponent(artifactId)}/recording-events/`,
    { method: 'POST', body: JSON.stringify(payload), timeoutMs: 20000 },
  );
}

class ApiError extends Error {
  status: number;
  detail?: string;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function apiJson<T>(path: string, init?: { method?: string; body?: string; headers?: Record<string, string>; timeoutMs?: number }): Promise<T> {
  const controller = init?.timeoutMs ? new AbortController() : undefined;
  const timeout = controller && init?.timeoutMs
    ? window.setTimeout(() => controller.abort(), init.timeoutMs)
    : undefined;
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller?.signal,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
    });
    if (!response.ok) {
      let message = `Curriculum API returned ${response.status} for ${path}`;
      try {
        const payload = await response.json();
        const validation = Array.isArray(payload?.validationErrors)
          ? payload.validationErrors.map((item: { message?: string }) => item.message).filter(Boolean).join('; ')
          : '';
        const detail = typeof payload?.detail === 'string' ? payload.detail : '';
        if (validation) message = validation;
        else if (payload?.error) message = detail ? `${payload.error} ${detail}` : payload.error;
      } catch {
        // Ignore body parsing failures so the original status remains visible.
      }
      throw new ApiError(response.status, message);
    }
    return response.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('The curriculum request is taking too long. It was stopped so you can retry without waiting indefinitely.');
    }
    throw err;
  } finally {
    if (timeout) window.clearTimeout(timeout);
  }
}

function componentAdvancedDefaults(type: ModuleComponentType): Record<string, string | number | boolean | string[]> {
  const completionRules: Partial<Record<ModuleComponentType, string>> = {
    'live-session': 'Attend or watch recording',
    'recording-placeholder': 'Mark complete after watching',
    video: 'Watch video and mark complete',
    podcast: 'Listen and mark complete',
    reading: 'Read the material and confirm completion',
    powerpoint: 'Review slide deck',
    quiz: 'Submit',
    'monthly-ksb-quiz': 'Submit monthly KSB quiz',
    reflection: 'Submit reflection',
    'workplace-evidence': 'Upload + describe',
    assignment: 'Submit assignment',
    checkpoint: 'Complete checkpoint',
    'coaching-preparation': 'Complete coaching preparation',
  };
  const evidenceRequired: Partial<Record<ModuleComponentType, string>> = {
    'live-session': 'Attendance or recording completion',
    quiz: 'Quiz result',
    'monthly-ksb-quiz': 'Quiz result',
    checkpoint: 'Quiz result',
    reflection: 'Reflection + signature',
    'workplace-evidence': 'File + 100-word description',
    assignment: 'Submission file',
    'coaching-preparation': 'Preparation notes',
  };
  const reflectionPrompt =
    type === 'workplace-evidence'
      ? 'What workplace evidence have you uploaded, and which KSBs does it demonstrate?'
      : ['quiz', 'monthly-ksb-quiz', 'checkpoint'].includes(type)
        ? 'Which questions or topics do you need to revisit after this activity?'
        : 'What did you learn? How will you apply this at work? Which KSBs did this develop?';

  return {
    completionRule: completionRules[type] || 'Mark complete',
    evidenceRequired: evidenceRequired[type] || '-',
    reflectionPrompt,
    contentStatus: 'Draft',
    version: '0.1',
  };
}

// Retained from the pre-registry authoring implementation for reference and
// backwards-compatible migration work. Runtime defaults come from
// componentAuthoringModel.getDefaultComponentSettings above.
export function getLegacyDefaultComponentSettings(type: ModuleComponentType): Record<string, string | number | boolean | string[]> {
  switch (type) {
    case 'live-session':
      return { ...componentAdvancedDefaults(type), sessionPurpose: '', preparationInstructions: '', reflectionQuestions: '', attendanceRequired: true, recordingExpected: true };
    case 'recording-placeholder':
      return { ...componentAdvancedDefaults(type), recordingPurpose: '', source: 'MIS allocation', expectedAvailability: 'After live session' };
    case 'video':
      return { ...componentAdvancedDefaults(type), provider: 'YouTube', videoUrl: '', durationMinutes: 10, learningBrief: '', postWatchTask: '' };
    case 'podcast':
      return { ...componentAdvancedDefaults(type), podcastSource: 'External URL', podcastUrl: '', durationMinutes: 20, listeningFocus: '', podcastReflectionQuestion: '' };
    case 'reading':
      return {
        ...componentAdvancedDefaults(type),
        difficulty: 'Standard',
        requirement: 'Required',
        readingSource: 'Written in LMS',
        resourceUrl: '',
        uploadedFileName: '',
        uploadedFileUrl: '',
        uploadedFileSize: 0,
        uploadedFileContentType: '',
        uploadSource: '',
        readingContent: '',
        mainLearningOutcomes: '',
        ksbEvidenceNotes: '',
        focusSections: '',
        learnerInstruction: '',
        keyPointCount: '0',
        keyPoints: '',
        glossaryTerms: '',
        estimatedReadingTime: 20,
        otjhRationale: '',
        audioEnabled: false,
        audioUrl: '',
        reflectionQuestionCount: '0 qs',
        readingReflectionPrompts: '',
        readingEvidenceRequired: '',
        completionRuleCount: '3 rules',
        completionConfirmationRequired: true,
        linkedActivity: '',
        coachingPrompt: '',
        requiredReading: true,
      };
    case 'powerpoint':
      return { ...componentAdvancedDefaults(type), fileName: '', slideRange: '', speakerNotes: '', downloadAllowed: true };
    case 'quiz':
      return { ...componentAdvancedDefaults(type), buildMode: 'manual', numberOfQuestions: 10, passMarkPercentage: 70, attemptsAllowed: 2, affectsKsbProgression: true, questionsPlaceholder: '', completionFeedback: '' };
    case 'monthly-ksb-quiz':
      return { ...componentAdvancedDefaults(type), buildMode: 'manual', numberOfQuestions: 12, passMarkPercentage: 70, attemptsAllowed: 2, affectsKsbProgression: true, monthFocus: '' };
    case 'reflection':
      return { ...componentAdvancedDefaults(type), minimumWordCount: 250, learnerGuidance: '', tutorReviewGuidance: '' };
    case 'workplace-evidence':
      return { ...componentAdvancedDefaults(type), evidenceInstructions: '', acceptedEvidenceTypes: 'Document, image, video, witness statement', assessmentChecklist: '', minimumDescriptionWords: 100 };
    case 'assignment':
      return { ...componentAdvancedDefaults(type), assignmentBrief: '', submissionInstructions: '', dueTiming: 'End of week', markingRubric: '' };
    case 'checkpoint':
      return { ...componentAdvancedDefaults(type), checkpointTitle: '', checkpointQuestions: '', progressReviewLinked: true, monthlyCoachingReviewLinked: true };
    case 'coaching-preparation':
      return { ...componentAdvancedDefaults(type), preparationPrompt: '', evidenceToBring: '', coachDiscussionPoints: '', coachingReviewLinked: true };
    default:
      return componentAdvancedDefaults(type);
  }
}

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function cleanUserFacingText(value: string) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.replace(/(^|\s)__[a-zA-Z0-9_]+:[\s\S]*?(?=\s__[a-zA-Z0-9_]+:|$)/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}
