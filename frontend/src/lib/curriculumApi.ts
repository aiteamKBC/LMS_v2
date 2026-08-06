export type CurriculumStatus = 'active' | 'draft' | 'archived' | 'published' | 'planned' | 'completed' | string;

interface CurriculumRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  skipCache?: boolean;
}

export interface CurriculumProgramme {
  id: string;
  sourceId: string;
  name: string;
  standard: string;
  level: string;
  modules: number;
  freeComponents?: number;
  weeks: number;
  ksbMapped: number;
  ksbTotal: number;
  learners: number;
  cohorts: number;
  groups?: number;
  lastUpdated: string;
  owner: string;
  color: string;
  description: string;
  structureType?: 'scheduled' | 'free' | string;
  ksbProfileSourceId?: string;
}

export interface CurriculumModule {
  id: string;
  // Temporary compatibility: moduleId may be a canonical ID or legacy delivery ID.
  // Prefer moduleCatalogueId for canonical authoring identity and deliveryRowId for allocation identity.
  moduleId?: string;
  moduleCatalogueId?: string;
  deliveryRowId?: number | string;
  deliveryModuleId?: string;
  legacyModuleId?: string;
  invalidModuleCatalogueId?: string;
  structureId?: string;
  sourceId: number | string;
  catalogueId?: string;
  relatedCatalogueIds?: string[];
  name: string;
  programmeId?: string;
  programme: string;
  cohortId?: string;
  cohort?: string;
  groupId?: string;
  group?: string;
  weeks: number;
  weekStructure?: Array<{
    id: string;
    weekNumber: number;
    title: string;
    displayOrder?: number;
    ksbMappings?: CurriculumComponent['ksbMappings'];
    components?: CurriculumComponent[];
  }>;
  sessionsNumber?: number;
  startDate?: string;
  endDate?: string;
  ksbCount: number;
  ksbProfileSourceId?: string;
  lessons: number;
  quizzes: number;
  assignments: number;
  status: 'published' | 'draft' | 'review' | string;
  authoringStatus?: 'published' | 'draft' | 'review' | string;
  sourceType?: string;
  deliveryStatus?: string;
  author: string;
  tutor?: string;
  coach?: string;
  lastUpdated: string;
  color: string;
  notes: string;
  sessionNames: string[];
  ksbCodes: string[];
  moduleKsbMappings?: CurriculumComponent['ksbMappings'];
}

export interface CurriculumComponent {
  id: string;
  moduleCatalogueId?: string;
  moduleId?: string;
  weekId?: string;
  title: string;
  type: string;
  displayOrder?: number;
  module: string;
  programme: string;
  week: string;
  weekTitle?: string;
  duration: number;
  expectedOtjh?: number;
  reflectionRequired?: boolean;
  workplaceEvidenceRequired?: boolean;
  tutorValidationRequired?: boolean;
  ksbRefs: string[];
  ksbMappings?: Array<{
    id: string;
    ksbId: string;
    code: string;
    description: string;
    sourceType?: string;
    sourceId?: string;
    type: string;
    classification?: string;
    weight: number;
  }>;
  status: 'published' | 'draft' | 'review';
  lastEdited: string;
  contentSections: number;
  quizQuestions?: number | null;
  hasResources: boolean;
  description?: string;
  points?: number;
  settings?: Record<string, unknown>;
}

export interface CurriculumKsbActivity {
  activityType: string;
  weight: number;
}

export interface CurriculumKsbEntry {
  id: string;
  code: string;
  rawCode?: string;
  fullCode?: string;
  parentCode?: string;
  parentId?: string | number | null;
  displayOrder?: number;
  title: string;
  description: string;
  type: 'Knowledge' | 'Skill' | 'Behaviour';
  standard: string;
  activities: CurriculumKsbActivity[];
  modules: string[];
  assessmentMethod: string;
  mappedBy: string;
  status: 'mapped' | 'partial' | 'unmapped';
  lastUpdated: string;
}

export interface CurriculumKsbSet {
  frameworkId?: string;
  profileId?: string | number;
  ksbProfileId?: string;
  programmeId: string;
  programmeIds?: string[];
  cohortIds?: string[];
  groupIds?: string[];
  moduleCatalogueIds?: string[];
  programmeName: string;
  standard: string;
  notes?: string;
  status?: string;
  ksbs: CurriculumKsbEntry[];
}

export interface CurriculumKsbFramework {
  id: string;
  profileId?: string | number;
  ksbProfileId?: string;
  programmeId?: string;
  programmeIds?: string[];
  cohortIds?: string[];
  groupIds?: string[];
  moduleCatalogueIds?: string[];
  name: string;
  standard: string;
  programmeName?: string;
  notes?: string;
  ifateRef: string;
  level: number;
  totalKsbs: number;
  knowledgeCount: number;
  skillCount: number;
  behaviourCount: number;
  modulesCount: number;
  mapped: number;
  status: 'draft' | 'review' | 'published' | 'archived';
  lastModified: string;
  modifiedBy: string;
  version: string;
  programmes: string[];
}

export interface CurriculumStandardKsb {
  id?: string | number;
  code: string;
  type: 'Knowledge' | 'Skill' | 'Behaviour';
  description: string;
}

export interface CurriculumStandard {
  id: string;
  code: string;
  standardRef: string;
  version: string;
  name: string;
  status: string;
  level: string;
  levelValue: string;
  degree: string;
  route: string;
  duration: string;
  minimumHours: string;
  maxFunding: string;
  larsCode: string;
  eqaProvider: string;
  sourceUrl: string;
  approvedForDelivery: string;
  dateUpdated: string;
  lastSynced: string;
  knowledge: number;
  skills: number;
  behaviours: number;
  total: number;
  sampleKsbs?: CurriculumStandardKsb[];
  ksbs?: CurriculumStandardKsb[];
}

export type CurriculumKsbCoverageStatus = 'missing' | 'partial' | 'fully_covered' | 'over_allocated';

export interface CurriculumKsbTraceMapping {
  mapping_id: string;
  mappingId: string;
  programme_id: string;
  programmeId: string;
  programme_name: string;
  programmeName: string;
  module_id: string;
  moduleId: string;
  module_name: string;
  moduleName: string;
  group_id?: string;
  groupId?: string;
  group_name?: string;
  groupName?: string;
  group?: string;
  groups?: string[];
  week_id: string;
  weekId: string;
  week_name: string;
  weekName: string;
  component_id: string;
  componentId: string;
  component_name: string;
  componentName: string;
  component_type: string;
  componentType: string;
  ksb_id: string;
  ksbId: string;
  code: string;
  description: string;
  source_type: string;
  sourceType: string;
  source_id: string;
  sourceId: string;
  source_name?: string;
  sourceName?: string;
  source_label?: string;
  sourceLabel?: string;
  classification: 'main' | 'secondary' | 'possible' | string;
  mapping_level?: 'module' | 'week' | 'component' | string;
  mappingLevel?: 'module' | 'week' | 'component' | string;
  weight: number;
}

export interface CurriculumKsbCoverageItem {
  ksb_id: string;
  ksbId: string;
  coverage_key?: string;
  coverageKey?: string;
  code: string;
  title: string;
  description: string;
  ksb_type: 'knowledge' | 'skill' | 'behaviour' | string;
  ksbType: 'knowledge' | 'skill' | 'behaviour' | string;
  source_type: string;
  sourceType: string;
  source_id: string;
  sourceId: string;
  source_name?: string;
  sourceName?: string;
  source_label?: string;
  sourceLabel?: string;
  raw_total_weight: number;
  rawTotalWeight: number;
  coverage_percentage: number;
  coveragePercentage: number;
  progress_bar_percentage: number;
  progressBarPercentage: number;
  status: CurriculumKsbCoverageStatus;
  occurrence_count: number;
  occurrenceCount: number;
  mapping_count: number;
  mappingCount: number;
  module_count: number;
  moduleCount: number;
  week_count: number;
  weekCount: number;
  component_count: number;
  componentCount: number;
  classification_summary: Record<string, { count: number; weight: number }>;
  classificationSummary: Record<string, { count: number; weight: number }>;
  mappings: CurriculumKsbTraceMapping[];
}

export interface CurriculumKsbCoverageSummaryBucket {
  required: number;
  fully_covered: number;
  partial: number;
  missing: number;
  over_allocated: number;
}

export interface CurriculumKsbCoverageResponse {
  scope: string;
  identifier: string;
  summary: {
    overall: CurriculumKsbCoverageSummaryBucket;
    knowledge: CurriculumKsbCoverageSummaryBucket;
    skills: CurriculumKsbCoverageSummaryBucket;
    behaviours: CurriculumKsbCoverageSummaryBucket;
  };
  items: CurriculumKsbCoverageItem[];
  heatmap: {
    modules: Array<{ module_id: string; moduleId: string; module_name: string; moduleName: string }>;
    rows: Array<{
      ksb_id: string;
      ksbId: string;
      coverage_key?: string;
      coverageKey?: string;
      code: string;
      title: string;
      ksb_type: string;
      ksbType: string;
      source_type?: string;
      sourceType?: string;
      source_id?: string;
      sourceId?: string;
      source_name?: string;
      sourceName?: string;
      source_label?: string;
      sourceLabel?: string;
      status: CurriculumKsbCoverageStatus;
      total: number;
      modules: Array<{ module_id: string; moduleId: string; module_name: string; moduleName: string; weight: number; mappings: CurriculumKsbTraceMapping[] }>;
    }>;
  };
}

export interface CurriculumProgrammeAssignedLearner {
  id: number | string;
  name: string;
  email: string;
  programme: string;
  programmeStatus: string;
  cohort: string;
  group: string;
  lifecycleStatus: string;
  coachName?: string;
  coachEmail?: string;
  completedHours?: number;
  plannedHours?: number;
  targetHours?: number;
  progressHours?: number;
  progressVariance?: string | number | null;
  otjhStatus?: string;
}

export interface CurriculumLearnerKsbConsumptionItem {
  code: string;
  expectedWeight: number;
  consumedWeight: number;
  cappedConsumedWeight: number;
  progressPercentage: number;
  rawProgressPercentage: number;
  status: 'complete' | 'in_progress' | 'not_started' | string;
}

export interface CurriculumLearnerKsbConsumption {
  learnerId: number | string;
  learnerName: string;
  email: string;
  cohort: string;
  group: string;
  consumedWeightTotal: number;
  expectedWeightTotal: number;
  cappedConsumedWeightTotal: number;
  progressPercentage: number;
  ksbs: CurriculumLearnerKsbConsumptionItem[];
}

export interface CurriculumProgrammeLearnerKsbImpactResponse {
  scope: 'programme';
  identifier: string;
  assignedLearnerCount: number;
  assignedLearners: CurriculumProgrammeAssignedLearner[];
  programmeCoverage: CurriculumKsbCoverageResponse;
  learnerKsbConsumption: CurriculumLearnerKsbConsumption[];
  consumptionSources: {
    progress: Array<Record<string, unknown>>;
    learningReflectionSubmissions: Array<Record<string, unknown>>;
  };
}

export interface CurriculumReadinessIssue {
  severity: 'warning' | 'error' | string;
  code: string;
  status: CurriculumKsbCoverageStatus | string;
  raw_weight: number;
  rawWeight: number;
  message: string;
}

export interface CurriculumReadinessResponse {
  ready: boolean;
  canSaveDraft: boolean;
  issues: CurriculumReadinessIssue[];
  summary?: CurriculumKsbCoverageResponse['summary'];
}

export type CurriculumKsbMappingInput = {
  id?: string;
  ksbId?: string;
  code: string;
  description?: string;
  sourceType: 'standard' | 'framework' | string;
  sourceId: string;
  classification: 'main' | 'secondary' | 'possible' | string;
  type?: 'main' | 'secondary' | 'possible' | string;
  weight: number;
};

export interface CurriculumComponentKsbMappingsResponse {
  componentId: string;
  count: number;
  results: CurriculumKsbTraceMapping[];
}

export type CurriculumKsbItemInput = {
  id?: string | number;
  type: 'K' | 'S' | 'B';
  code: string;
  parentCode?: string;
  title: string;
  description?: string;
  displayOrder?: number;
};

export type CurriculumKsbFrameworkInput = {
  name?: string;
  ksbProfileId?: string;
  programmeId?: string;
  programmeIds?: string[];
  cohortIds?: string[];
  groupIds?: string[];
  moduleCatalogueIds?: string[];
  programmeName?: string;
  programme?: string;
  description?: string;
  notes?: string;
  isActive?: boolean;
  ksbItems?: CurriculumKsbItemInput[];
  knowledgeCodes?: string[];
  skillCodes?: string[];
  behaviourCodes?: string[];
};

export interface CurriculumCohort {
  id: string;
  name: string;
  programme: string;
  programmeId: string;
  startDate: string;
  endDate: string;
  durationMonths?: string | number;
  status: 'active' | 'planned' | 'completed' | 'archived' | string;
  learners: number;
  groups: string[];
  modules: string[];
  sessions: number;
  color: string;
  progress: number;
  attendance: number;
  holidayIds?: Array<string | number>;
}

export interface CurriculumGroup {
  id: string;
  name: string;
  cohortId: string;
  cohort: string;
  programme: string;
  programmeId?: string;
  learners: number;
  coach: string;
  tutor: string;
  startDate: string;
  endDate: string;
  status: string;
  schedule: string;
  color?: string;
  mode: string;
  modules: string[];
  sessions: number;
}

export interface CurriculumSession {
  id: string;
  trainingPlanId: number | string;
  programmeId?: string;
  programmeSourceId?: string;
  cohortId?: string;
  groupId?: string;
  moduleId?: string;
  moduleCatalogueId?: string;
  weekId?: string;
  deliveryRowId?: number | string;
  // Temporary compatibility: prefer moduleCatalogueId when present.
  deliveryModuleId?: string;
  legacyModuleId?: string;
  invalidModuleCatalogueId?: string;
  componentId?: string;
  title: string;
  type: string;
  date: string;
  day: string;
  startTime: string;
  endTime: string;
  tutor: string;
  group: string;
  cohort: string;
  programme: string;
  venue: string;
  module: string;
  week: number;
  skippedHolidays?: string[];
  scheduleWarnings?: string[];
  status: 'scheduled' | 'completed' | 'cancelled' | 'pending' | string;
  ksbCodes: string[];
}

export interface CurriculumHoliday {
  id: string | number;
  label: string;
  startDate: string;
  endDate: string;
  type?: string;
  color?: string;
}

export interface CurriculumCohortAuthoringDetail {
  cohortId: string;
  cohortName: string;
  programmeId: string;
  programmeName: string;
  startDate: string;
  endDate: string;
  durationMonths: number;
  color: string;
  status: string;
  moduleCatalogueIds?: string[];
  trainingPlanIds?: string[];
  groupIds: string[];
  moduleNames: string[];
  holidayIds: string[];
  selectedHolidays: CurriculumHoliday[];
  holidaysInRange: CurriculumHoliday[];
  holidaySummary: {
    global?: number;
    inRange?: number;
    selected?: number;
  };
  notes?: string;
  sourceType?: string;
  sourceId?: string;
  updatedAt?: string;
}

export interface CurriculumStaffProfile {
  id?: string | number;
  role?: 'coach' | 'tutor' | string;
  name?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  status?: string;
  specialisms?: string[];
  assignedModuleIds?: string[];
  assignedGroupIds?: string[];
  assignedModules?: Array<Pick<CurriculumModule, 'id' | 'moduleId' | 'moduleCatalogueId' | 'deliveryRowId' | 'name' | 'programmeId' | 'programme' | 'cohortId' | 'cohort' | 'groupId' | 'group' | 'startDate' | 'endDate' | 'status'>>;
  inProgressModules?: Array<Pick<CurriculumModule, 'id' | 'moduleId' | 'moduleCatalogueId' | 'deliveryRowId' | 'name' | 'programmeId' | 'programme' | 'cohortId' | 'cohort' | 'groupId' | 'group' | 'startDate' | 'endDate' | 'status'>>;
  groupCount?: number;
  moduleCount?: number;
  inProgressCount?: number;
  notes?: string;
  [key: string]: unknown;
}

export interface CurriculumOverview {
  schema: string;
  stats: {
    programmes: number;
    activeProgrammes: number;
    cohorts: number;
    groups: number;
    modules: number;
    ksbFrameworks: number;
    sessions: number;
  };
  programmes: CurriculumProgramme[];
  modules: CurriculumModule[];
  ksbFrameworks: CurriculumKsbFramework[];
  ksbSets: CurriculumKsbSet[];
  cohorts: CurriculumCohort[];
  groups: CurriculumGroup[];
  sessions: CurriculumSession[];
  components?: CurriculumComponent[];
  holidays?: CurriculumHoliday[];
  cohortAuthoringDetails?: CurriculumCohortAuthoringDetail[];
  tutors?: CurriculumStaffProfile[];
  coaches?: CurriculumStaffProfile[];
}

export interface FreeProgrammeComponent {
  id: string;
  moduleId?: string;
  displayOrder: number;
  type: string;
  title: string;
  description: string;
  expectedOtjh: number;
  points: number;
  reflectionRequired: boolean;
  workplaceEvidenceRequired: boolean;
  tutorValidationRequired: boolean;
  settings?: Record<string, unknown>;
}

export interface FreeProgrammeModule {
  id: string;
  programmeId: string;
  programmeName: string;
  title: string;
  description: string;
  status: string;
  color?: string;
  displayOrder: number;
  componentCount: number;
  totalOtjh: number;
  components: FreeProgrammeComponent[];
}

export interface CurriculumProgrammeDetail {
  schema: string;
  programme: CurriculumProgramme;
  cohorts: Array<CurriculumCohort & { groups: Array<CurriculumGroup & { modules: CurriculumModule[] }> }>;
  flat: {
    cohorts: CurriculumCohort[];
    groups: CurriculumGroup[];
    groupIds: string[];
    modules: CurriculumModule[];
    sessions: CurriculumSession[];
    components?: CurriculumComponent[];
  };
}

export interface CurriculumSessionPlanPreview {
  sessions: Array<{ sessionNumber: number; date: string; day: string; skippedHolidays: string[] }>;
  skippedHolidays: string[];
  finalEndDate: string;
  warnings: string[];
}

export interface CurriculumCohortEndDatePreview {
  endDate: string;
  autoCalculated: boolean;
  rule: string;
  warnings: string[];
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';

interface CurriculumCollection<T> {
  schema: string;
  count: number;
  results: T[];
}

// Combines several abort signals into one. Prefers the native implementation and
// falls back to a manual relay for older browsers.
function anySignal(signals: AbortSignal[]): AbortSignal {
  const nativeAny = (AbortSignal as unknown as { any?: (list: AbortSignal[]) => AbortSignal }).any;
  if (typeof nativeAny === 'function') return nativeAny.call(AbortSignal, signals);
  const controller = new AbortController();
  const forward = (signal: AbortSignal) => {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  };
  signals.forEach(forward);
  return controller.signal;
}

// Shares an in-flight GET between concurrent callers. GETs are intentionally
// not tied to component cleanup signals: React StrictMode can unmount/remount
// immediately in development, and aborting those requests fills DevTools with
// noisy "(cancelled)" rows even though the next mount needs the same data.
const inFlightGets = new Map<string, Promise<unknown>>();
const completedGets = new Map<string, { value: unknown; expiresAt: number }>();
const GET_CACHE_TTL_MS = 30_000;

export function clearCurriculumGetCache() {
  completedGets.clear();
  inFlightGets.clear();
}

async function fetchJson<T>(path: string, init?: CurriculumRequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    clearCurriculumGetCache();
    return fetchJsonUncached<T>(path, init);
  }

  if (!init?.skipCache) {
    const cached = completedGets.get(path);
    if (cached && cached.expiresAt > Date.now()) {
      return settleWithCallerAbort(Promise.resolve(cached.value as T), init?.signal);
    }
    if (cached) completedGets.delete(path);
  }

  const sharedInit = init?.signal ? { ...init, signal: undefined } : init;
  const existing = inFlightGets.get(path) as Promise<T> | undefined;
  const pending = existing || fetchJsonUncached<T>(path, sharedInit).then(value => {
    if (!init?.skipCache) completedGets.set(path, { value, expiresAt: Date.now() + GET_CACHE_TTL_MS });
    return value;
  });
  if (!existing) {
    inFlightGets.set(path, pending as Promise<unknown>);
    const clearInFlight = () => {
      if (inFlightGets.get(path) === (pending as Promise<unknown>)) inFlightGets.delete(path);
    };
    pending.then(clearInFlight, clearInFlight);
  }
  return settleWithCallerAbort(pending, init?.signal);
}

async function fetchJsonUncached<T>(path: string, init?: CurriculumRequestInit): Promise<T> {
  const timeoutController = init?.timeoutMs ? new AbortController() : null;
  const timeout = timeoutController && init?.timeoutMs
    ? window.setTimeout(() => timeoutController.abort(), init.timeoutMs)
    : null;
  const { timeoutMs: _timeoutMs, signal: callerSignal, skipCache: _skipCache, ...fetchInit } = init || {};
  const signal = callerSignal && timeoutController
    ? anySignal([callerSignal, timeoutController.signal])
    : callerSignal || timeoutController?.signal;
  try {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...fetchInit,
    signal,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      const validation = Array.isArray(payload?.validationErrors)
        ? payload.validationErrors.map((item: { message?: string }) => item.message).filter(Boolean).join('; ')
        : '';
      detail = payload?.error ? `: ${payload.error}${validation ? ` - ${validation}` : ''}` : '';
    } catch {
      detail = '';
    }
    throw new Error(`Curriculum API returned ${response.status} for ${path}${detail}`);
  }
  return response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      // Only a timeout becomes a generic error; a caller-initiated abort must stay
      // an AbortError so effect cleanups can tell cancellation from failure.
      if (timeoutController?.signal.aborted && !callerSignal?.aborted) {
        throw new Error(`Curriculum API timed out for ${path}`);
      }
    }
    throw error;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function settleWithCallerAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function fetchCollection<T>(path: string, init?: CurriculumRequestInit): Promise<T[]> {
  const payload = await fetchJson<CurriculumCollection<T>>(path, init);
  return payload.results;
}

// `compact` drops weekStructure (~94% of this payload) server-side. Only pass it
// from callers that read module identity/metadata alone: anything that reads
// weekStructure, its nested components, or ranks duplicate modules by component
// count must keep the full response. See fetchCurriculumModules callers.
export function fetchCurriculumModules(signal?: AbortSignal, options: { compact?: boolean } = {}): Promise<CurriculumModule[]> {
  return fetchCollection<CurriculumModule>(`/curriculum/modules/${options.compact ? '?compact=true' : ''}`, { signal });
}

export function fetchCurriculumComponents(signal?: AbortSignal, options: { moduleCatalogueIds?: string[] } = {}): Promise<CurriculumComponent[]> {
  const query = new URLSearchParams();
  const moduleCatalogueIds = (options.moduleCatalogueIds || []).filter(Boolean);
  if (moduleCatalogueIds.length) query.set('module_catalogue_ids', moduleCatalogueIds.join(','));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchCollection<CurriculumComponent>(`/curriculum/components/${suffix}`, { signal });
}

export function fetchCurriculumStats(signal?: AbortSignal): Promise<CurriculumOverview['stats']> {
  return fetchJson<CurriculumOverview['stats']>('/curriculum/stats/', { signal });
}

export function fetchCurriculumProgrammes(signal?: AbortSignal): Promise<CurriculumProgramme[]> {
  return fetchCollection<CurriculumProgramme>('/curriculum/programmes/', { signal });
}

export function fetchCurriculumGroups(signal?: AbortSignal): Promise<CurriculumGroup[]> {
  return fetchCollection<CurriculumGroup>('/curriculum/groups/', { signal });
}

export function fetchCurriculumKsbFrameworks(signal?: AbortSignal): Promise<CurriculumKsbFramework[]> {
  return fetchCollection<CurriculumKsbFramework>('/curriculum/ksb-frameworks/', { signal });
}

export function fetchCurriculumKsbSets(signal?: AbortSignal): Promise<CurriculumKsbSet[]> {
  return fetchCollection<CurriculumKsbSet>('/curriculum/ksb-sets/', { signal });
}

export function fetchCurriculumStandards(signal?: AbortSignal): Promise<CurriculumStandard[]> {
  return fetchCollection<CurriculumStandard>('/curriculum/standards/', { signal });
}

export function fetchCurriculumStandardDetail(id: string, signal?: AbortSignal): Promise<CurriculumStandard> {
  return fetchJson<CurriculumStandard>(`/curriculum/standards/${encodeURIComponent(id)}/`, { signal });
}

export function fetchCurriculumKsbCoverage(params: { sourceType?: string; sourceId?: string } = {}, signal?: AbortSignal): Promise<CurriculumKsbCoverageResponse> {
  const query = new URLSearchParams();
  if (params.sourceType) query.set('source_type', params.sourceType);
  if (params.sourceId) query.set('source_id', params.sourceId);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchJson<CurriculumKsbCoverageResponse>(`/curriculum/ksb-coverage/${suffix}`, { signal });
}

export function fetchCurriculumProgrammeKsbCoverage(programmeId: string, params: { sourceType?: string; sourceId?: string; actualMappings?: boolean } = {}, signal?: AbortSignal): Promise<CurriculumKsbCoverageResponse> {
  const query = new URLSearchParams();
  if (params.sourceType) query.set('source_type', params.sourceType);
  if (params.sourceId) query.set('source_id', params.sourceId);
  if (params.actualMappings) query.set('actual_mappings', '1');
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchJson<CurriculumKsbCoverageResponse>(`/curriculum/programmes/${encodeURIComponent(programmeId)}/ksb-coverage/${suffix}`, { signal });
}

export function fetchCurriculumProgrammeLearnerKsbImpact(programmeId: string, params: { sourceType?: string; sourceId?: string; learnerStatus?: string } = {}, signal?: AbortSignal): Promise<CurriculumProgrammeLearnerKsbImpactResponse> {
  const query = new URLSearchParams();
  if (params.sourceType) query.set('source_type', params.sourceType);
  if (params.sourceId) query.set('source_id', params.sourceId);
  if (params.learnerStatus) query.set('learnerStatus', params.learnerStatus);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchJson<CurriculumProgrammeLearnerKsbImpactResponse>(`/curriculum/programmes/${encodeURIComponent(programmeId)}/learner-ksb-impact/${suffix}`, { signal });
}

export function fetchCurriculumModuleKsbCoverage(moduleId: string, params: { sourceType?: string; sourceId?: string } = {}, signal?: AbortSignal): Promise<CurriculumKsbCoverageResponse> {
  const query = new URLSearchParams();
  if (params.sourceType) query.set('source_type', params.sourceType);
  if (params.sourceId) query.set('source_id', params.sourceId);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchJson<CurriculumKsbCoverageResponse>(`/curriculum/modules/${encodeURIComponent(moduleId)}/ksb-coverage/${suffix}`, { signal });
}

export function fetchCurriculumWeekKsbCoverage(weekId: string, params: { sourceType?: string; sourceId?: string } = {}, signal?: AbortSignal): Promise<CurriculumKsbCoverageResponse> {
  const query = new URLSearchParams();
  if (params.sourceType) query.set('source_type', params.sourceType);
  if (params.sourceId) query.set('source_id', params.sourceId);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchJson<CurriculumKsbCoverageResponse>(`/curriculum/weeks/${encodeURIComponent(weekId)}/ksb-coverage/${suffix}`, { signal });
}

export function fetchCurriculumCohortKsbCoverage(cohortId: string, params: { sourceType?: string; sourceId?: string } = {}, signal?: AbortSignal): Promise<CurriculumKsbCoverageResponse> {
  const query = new URLSearchParams();
  if (params.sourceType) query.set('source_type', params.sourceType);
  if (params.sourceId) query.set('source_id', params.sourceId);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchJson<CurriculumKsbCoverageResponse>(`/curriculum/cohorts/${encodeURIComponent(cohortId)}/ksb-coverage/${suffix}`, { signal });
}

export function fetchCurriculumKsbTrace(ksbId: string, params: { sourceType?: string; sourceId?: string } = {}, signal?: AbortSignal): Promise<CurriculumKsbCoverageItem> {
  const query = new URLSearchParams();
  if (params.sourceType) query.set('source_type', params.sourceType);
  if (params.sourceId) query.set('source_id', params.sourceId);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchJson<CurriculumKsbCoverageItem>(`/curriculum/ksb-coverage/trace/${encodeURIComponent(ksbId)}/${suffix}`, { signal });
}

export function fetchCurriculumReadiness(params: { scope?: string; identifier?: string; sourceType?: string; sourceId?: string } = {}, signal?: AbortSignal): Promise<CurriculumReadinessResponse> {
  const query = new URLSearchParams();
  if (params.scope) query.set('scope', params.scope);
  if (params.identifier) query.set('identifier', params.identifier);
  if (params.sourceType) query.set('source_type', params.sourceType);
  if (params.sourceId) query.set('source_id', params.sourceId);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchJson<CurriculumReadinessResponse>(`/curriculum/readiness/ksb-coverage/${suffix}`, { signal });
}

export function fetchComponentKsbMappings(componentId: string, signal?: AbortSignal): Promise<CurriculumComponentKsbMappingsResponse> {
  return fetchJson<CurriculumComponentKsbMappingsResponse>(`/curriculum/components/${encodeURIComponent(componentId)}/ksb-mappings/`, { signal });
}

export function createComponentKsbMapping(componentId: string, input: CurriculumKsbMappingInput | { mappings: CurriculumKsbMappingInput[] }) {
  return postJson<CurriculumComponentKsbMappingsResponse & { created: boolean }>(`/curriculum/components/${encodeURIComponent(componentId)}/ksb-mappings/`, input);
}

export function updateComponentKsbMapping(mappingId: string, input: Partial<CurriculumKsbMappingInput>) {
  return patchJson<{ updated: boolean; mapping: CurriculumKsbTraceMapping }>(`/curriculum/ksb-mappings/${encodeURIComponent(mappingId)}/`, input);
}

export function deleteComponentKsbMapping(mappingId: string) {
  return deleteJson<{ deleted: boolean; id: string }>(`/curriculum/ksb-mappings/${encodeURIComponent(mappingId)}/`);
}

export function createCurriculumKsbFramework(input: CurriculumKsbFrameworkInput) {
  return postJson<{ created: boolean; framework: CurriculumKsbFramework }>('/curriculum/ksb-frameworks/', input);
}

export function updateCurriculumKsbFramework(id: string, input: CurriculumKsbFrameworkInput) {
  return patchJson<{ updated: boolean; id: string }>(`/curriculum/ksb-frameworks/${encodeURIComponent(id)}/`, input);
}

export function deleteCurriculumKsbFramework(id: string) {
  return deleteJson<{ deleted: boolean; id: string }>(`/curriculum/ksb-frameworks/${encodeURIComponent(id)}/`);
}

export function fetchCurriculumSessions(signal?: AbortSignal): Promise<CurriculumSession[]> {
  return fetchCollection<CurriculumSession>('/curriculum/sessions/', { signal });
}

export function fetchCurriculumTutors(signal?: AbortSignal): Promise<CurriculumStaffProfile[]> {
  return fetchCollection<CurriculumStaffProfile>('/curriculum/tutors/', { signal });
}

export function fetchCurriculumCoaches(signal?: AbortSignal): Promise<CurriculumStaffProfile[]> {
  return fetchCollection<CurriculumStaffProfile>('/curriculum/coaches/', { signal });
}

export type CurriculumStaffProfileInput = {
  name?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  status?: string;
  specialisms?: string[];
  assignedModuleIds?: string[];
  assignedGroupIds?: string[];
  notes?: string;
};

export function fetchCurriculumHolidays(signal?: AbortSignal): Promise<CurriculumHoliday[]> {
  return fetchCollection<CurriculumHoliday>('/curriculum/holidays/', { signal });
}

export function fetchCurriculumOverview(signal?: AbortSignal, options: { compact?: boolean } = {}): Promise<CurriculumOverview> {
  return fetchJson<CurriculumOverview>(`/curriculum/overview/${options.compact ? '?compact=true' : ''}`, { signal });
}

export function fetchCurriculumProgrammeDetail(id: string, signal?: AbortSignal): Promise<CurriculumProgrammeDetail> {
  return fetchJson<CurriculumProgrammeDetail>(`/curriculum/programmes/${encodeURIComponent(id)}/detail/`, { signal });
}

export { fetchCurriculumOverview as fetchCurriculumOverviewBundle };

function postJson<T>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

function patchJson<T>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

function deleteJson<T>(path: string): Promise<T> {
  return fetchJson<T>(path, { method: 'DELETE' });
}

export type CurriculumProgrammeInput = Partial<Pick<CurriculumProgramme, 'name' | 'standard' | 'level' | 'owner' | 'color' | 'description' | 'structureType' | 'ksbProfileSourceId'>>;
export type CurriculumModuleInput = Partial<Pick<CurriculumModule, 'name' | 'weeks' | 'color' | 'notes'>> & {
  programmeId?: string;
  programmeName?: string;
  programme?: string;
  ksbProfileSourceId?: string;
  cohortId?: string;
  cohortName?: string;
  cohort?: string;
  groupId?: string;
  groupName?: string;
  group?: string;
  startDate?: string;
  endDate?: string;
  tutor?: string;
  coach?: string;
  weekDays?: string;
  startTime?: string;
  endTime?: string;
  ksbMappings?: unknown[];
};
export type CurriculumComponentInput = Partial<Omit<CurriculumComponent, 'lastEdited'>>;
export type CurriculumCohortInput = { id?: string; cohortId?: string; name?: string; programme?: string; programmeId?: string; startDate?: string; endDate?: string; durationMonths?: number; color?: string; moduleName?: string; sessionsNumber?: number; holidayIds?: Array<string | number> };
export type CurriculumGroupInput = { id?: string; groupId?: string; name?: string; cohortId?: string; programmeId?: string; tutor?: string; coach?: string; color?: string; weekDays?: string; startTime?: string; endTime?: string; startDate?: string; endDate?: string; moduleName?: string; sessionsNumber?: number };
export type CurriculumSessionInput = Partial<Pick<CurriculumSession, 'date' | 'startTime' | 'endTime' | 'tutor'>>;
export type CurriculumStaffingInput = { groupId?: string; tutor?: string; coach?: string };
export type CurriculumHolidayInput = Partial<Pick<CurriculumHoliday, 'label' | 'startDate' | 'endDate' | 'type' | 'color'>>;
export type CurriculumModuleAttachmentInput = {
  moduleName: string;
  programmeId?: string;
  cohortId?: string;
  groupId?: string;
  catalogueId?: string | number;
  color?: string;
  startDate?: string;
  endDate?: string;
  coach?: string;
  tutor?: string;
  weekDays?: string;
  startTime?: string;
  endTime?: string;
  sessionsNumber?: number;
  weeks?: number;
  notes?: string;
  holidays?: unknown[];
  linkedHolidays?: unknown[];
};
export type CurriculumProgrammeTreeInput = {
  programme: CurriculumProgrammeInput & { id?: string; sourceId?: string; programmeId?: string };
  cohorts: Array<CurriculumCohortInput & {
    id: string;
    groups: Array<CurriculumGroupInput & {
      id: string;
      modules: CurriculumModuleAttachmentInput[];
    }>;
  }>;
  removeMissing?: boolean;
  hydrationComplete?: boolean;
};
export type FreeProgrammeComponentInput = Partial<FreeProgrammeComponent> & {
  id: string;
  type: string;
  settings?: Record<string, unknown>;
};
export type FreeProgrammeModuleInput = {
  id?: string;
  title: string;
  description?: string;
  status?: string;
  color?: string;
  components?: FreeProgrammeComponentInput[];
};

export function createCurriculumProgramme(input: CurriculumProgrammeInput) {
  return postJson<{ created: boolean; programme: CurriculumProgramme }>('/curriculum/programmes/', input);
}

export function updateCurriculumProgramme(id: string, input: CurriculumProgrammeInput) {
  return patchJson<{ updated: boolean; programme: CurriculumProgramme }>(`/curriculum/programmes/${encodeURIComponent(id)}/`, input);
}

export function saveCurriculumProgrammeTree(input: CurriculumProgrammeTreeInput) {
  return postJson<{
    saved: boolean;
    programme: CurriculumProgramme;
    cohorts: CurriculumCohort[];
    groups: CurriculumGroup[];
    modules: CurriculumModule[];
    removedModuleIds: string[];
    removedMissing: boolean;
  }>('/curriculum/programmes/tree/', input);
}

export function deleteCurriculumProgramme(id: string) {
  return fetchJson<{ deleted: boolean; permanent: boolean; id: string }>(`/curriculum/programmes/${encodeURIComponent(id)}/`, { method: 'DELETE', timeoutMs: 60000 });
}

export const archiveCurriculumProgramme = deleteCurriculumProgramme;
export const permanentlyDeleteCurriculumProgramme = deleteCurriculumProgramme;

export function createCurriculumCohort(input: CurriculumCohortInput) {
  return postJson<{ created: boolean; cohort: CurriculumCohort }>('/curriculum/cohorts/', input);
}

export function createProgrammeCohort(programmeId: string, input: Omit<CurriculumCohortInput, 'programme'>) {
  return postJson<{ created: boolean; cohort: CurriculumCohort }>(`/curriculum/programmes/${encodeURIComponent(programmeId)}/cohorts/`, input);
}

export function updateCurriculumCohort(id: string, input: CurriculumCohortInput) {
  return patchJson<{ updated: boolean; id: string }>(`/curriculum/cohorts/${encodeURIComponent(id)}/`, input);
}

export function archiveCurriculumCohort(id: string) {
  return deleteJson(`/curriculum/cohorts/${encodeURIComponent(id)}/`);
}

export function createCurriculumGroup(input: CurriculumGroupInput) {
  return postJson<{ created: boolean; group: CurriculumGroup }>('/curriculum/groups/', input);
}

export function createCohortGroup(cohortId: string, input: Omit<CurriculumGroupInput, 'cohortId'>) {
  return postJson<{ created: boolean; group: CurriculumGroup }>(`/curriculum/cohorts/${encodeURIComponent(cohortId)}/groups/`, input);
}

export function updateCurriculumGroup(id: string, input: CurriculumGroupInput) {
  return patchJson<{ updated: boolean; id: string }>(`/curriculum/groups/${encodeURIComponent(id)}/`, input);
}

export function archiveCurriculumGroup(id: string) {
  return deleteJson(`/curriculum/groups/${encodeURIComponent(id)}/`);
}

export function attachCurriculumModulesToGroup(groupId: string, modules: CurriculumModuleAttachmentInput[]) {
  return patchJson(`/curriculum/groups/${encodeURIComponent(groupId)}/modules/`, { modules });
}

export function fetchFreeProgrammeModules(programmeId: string, signal?: AbortSignal): Promise<FreeProgrammeModule[]> {
  return fetchCollection<FreeProgrammeModule>(`/curriculum/free-programmes/${encodeURIComponent(programmeId)}/modules/`, { signal });
}

export function saveFreeProgrammeModules(programmeId: string, input: { programmeName?: string; modules: FreeProgrammeModuleInput[] }) {
  return patchJson<{ saved: boolean; programmeId: string; modules: FreeProgrammeModule[] }>(`/curriculum/free-programmes/${encodeURIComponent(programmeId)}/modules/`, input);
}

export function createGroupModule(groupId: string, input: CurriculumModuleAttachmentInput) {
  return postJson(`/curriculum/groups/${encodeURIComponent(groupId)}/modules/`, input);
}

export function fetchGroupModules(groupId: string, signal?: AbortSignal): Promise<CurriculumModule[]> {
  return fetchCollection<CurriculumModule>(`/curriculum/groups/${encodeURIComponent(groupId)}/modules/`, { signal });
}

export function previewCohortEndDate(input: { startDate?: string; durationMonths?: number }) {
  return postJson<CurriculumCohortEndDatePreview>('/curriculum/preview/cohort-end-date/', input);
}

export function previewModuleSessionPlan(input: { startDate?: string; numberOfSessions?: number; sessionsNumber?: number; weekDays?: string | string[]; deliveryDays?: string | string[]; holidays?: unknown[] }) {
  return postJson<CurriculumSessionPlanPreview>('/curriculum/preview/module-session-plan/', input);
}

export function createCurriculumModule(input: CurriculumModuleInput) {
  return postJson<{ created: boolean; module: CurriculumModule }>('/curriculum/modules/', input);
}

export function updateCurriculumModule(id: string, input: CurriculumModuleInput) {
  return patchJson<{ updated: boolean; module: CurriculumModule }>(`/curriculum/modules/${encodeURIComponent(id)}/`, input);
}

export function archiveCurriculumModule(id: string) {
  return deleteJson<{ archived: boolean; id: string }>(`/curriculum/modules/${encodeURIComponent(id)}/`);
}

export function createCurriculumComponent(input: CurriculumComponentInput) {
  return postJson<{ created: boolean; component: CurriculumComponent }>('/curriculum/components/', input);
}

export function updateCurriculumComponent(id: string, input: CurriculumComponentInput) {
  return patchJson<{ updated: boolean; component: CurriculumComponent }>(`/curriculum/components/${encodeURIComponent(id)}/`, input);
}

export function deleteCurriculumComponent(id: string) {
  return deleteJson<{ deleted: boolean; id: string }>(`/curriculum/components/${encodeURIComponent(id)}/`);
}

export function createCurriculumSession(input: CurriculumSessionInput) {
  return postJson('/curriculum/sessions/', input);
}

export function updateCurriculumSession(id: string, input: CurriculumSessionInput) {
  return patchJson(`/curriculum/sessions/${encodeURIComponent(id)}/`, input);
}

export function archiveCurriculumSession(id: string) {
  return deleteJson(`/curriculum/sessions/${encodeURIComponent(id)}/`);
}

export function createStaffingAssignment(input: CurriculumStaffingInput) {
  return postJson('/curriculum/staffing/', input);
}

export function updateStaffingAssignment(id: string, input: CurriculumStaffingInput) {
  return patchJson(`/curriculum/staffing/${encodeURIComponent(id)}/`, input);
}

export function deleteStaffingAssignment(id: string) {
  return deleteJson(`/curriculum/staffing/${encodeURIComponent(id)}/`);
}

export function createCurriculumCoach(input: CurriculumStaffProfileInput) {
  return postJson<{ created: boolean; profile: CurriculumStaffProfile }>('/curriculum/coaches/', input);
}

export function updateCurriculumCoach(id: string | number, input: CurriculumStaffProfileInput) {
  return patchJson<{ updated: boolean; profile: CurriculumStaffProfile }>(`/curriculum/coaches/${encodeURIComponent(String(id))}/`, input);
}

export function deleteCurriculumCoach(id: string | number) {
  return deleteJson<{ archived: boolean; id: string | number }>(`/curriculum/coaches/${encodeURIComponent(String(id))}/`);
}

export function createCurriculumTutor(input: CurriculumStaffProfileInput) {
  return postJson<{ created: boolean; profile: CurriculumStaffProfile }>('/curriculum/tutors/', input);
}

export function updateCurriculumTutor(id: string | number, input: CurriculumStaffProfileInput) {
  return patchJson<{ updated: boolean; profile: CurriculumStaffProfile }>(`/curriculum/tutors/${encodeURIComponent(String(id))}/`, input);
}

export function deleteCurriculumTutor(id: string | number) {
  return deleteJson<{ archived: boolean; id: string | number }>(`/curriculum/tutors/${encodeURIComponent(String(id))}/`);
}

export function createCurriculumHoliday(input: CurriculumHolidayInput) {
  return postJson('/curriculum/holidays/', input);
}

export function updateCurriculumHoliday(id: string | number, input: CurriculumHolidayInput) {
  return patchJson(`/curriculum/holidays/${encodeURIComponent(String(id))}/`, input);
}

export function archiveCurriculumHoliday(id: string | number) {
  return deleteJson(`/curriculum/holidays/${encodeURIComponent(String(id))}/`);
}
