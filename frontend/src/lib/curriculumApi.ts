export type CurriculumStatus = 'active' | 'draft' | 'archived' | 'published' | 'planned' | 'completed' | string;

/**
 * Determines if an error is retryable.
 * Retries only transient failures; permanent errors fail immediately.
 */
export function isRetryableError(error: unknown): boolean {
  // Check for AbortError first (DOMException)
  if (error instanceof DOMException && error.name === 'AbortError') {
    return false;
  }

  // Check for HTTP status codes embedded in Error messages from fetchJsonUncached
  // Format: "Curriculum API returned NNN for /path"
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    // Extract status code from error message if present
    const statusMatch = error.message.match(/curriculum api returned (\d{3})/i);
    if (statusMatch) {
      const status = parseInt(statusMatch[1], 10);
      // Transient errors (retry)
      if (status === 408 || status === 429 || (status >= 500 && status <= 599)) {
        return true;
      }
      // Permanent errors (don't retry)
      if ((status >= 400 && status <= 499)) {
        return false;
      }
    }

    // Network/timeout errors (no HTTP response)
    if (msg.includes('network') || msg.includes('timeout')) {
      return true; // Network errors are transient and should be retried
    }
  }

  // If it's a Response object (unlikely in production given error handling above)
  if (error instanceof Response) {
    const status = error.status;
    // Transient errors (retry)
    if (status === 408 || status === 429 || (status >= 500 && status <= 599)) {
      return true;
    }
    // Permanent errors (don't retry)
    if ((status >= 400 && status <= 499)) {
      return false;
    }
  }

  // Default: retry unknown errors (network issues with no captured status)
  return true;
}

interface CurriculumRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  skipCache?: boolean;
}

export class CurriculumApiError extends Error {
  status: number;
  path: string;
  data: unknown;

  constructor(message: string, status: number, path: string, data?: unknown) {
    super(message);
    this.name = 'CurriculumApiError';
    this.status = status;
    this.path = path;
    this.data = data;
    Object.setPrototypeOf(this, CurriculumApiError.prototype);
  }
}

/** One module already holding a slot the save tried to book the same tutor into. */
export interface CurriculumTutorConflict {
  moduleCatalogueId: string;
  moduleName: string;
  programme: string;
  cohort: string;
  group: string;
  startTime: string;
  endTime: string;
  /** Every date the two modules overlap on, not just the first. */
  dates: string[];
}

export interface CurriculumTutorConflictPayload {
  error: string;
  tutorConflicts: CurriculumTutorConflict[];
  tutor: string;
  moduleName: string;
}

/**
 * A save refused because it would have put one tutor in two places at once.
 *
 * Raised by every endpoint that assigns a tutor — the module PATCH, the group
 * modules POST/PATCH, the group and staffing PATCHes and the programme tree save
 * — so a caller can recognise it once rather than per screen.
 */
export function isTutorConflictError(error: unknown): error is CurriculumApiError & { data: CurriculumTutorConflictPayload } {
  return (
    error instanceof CurriculumApiError
    && error.status === 409
    && Boolean(error.data)
    && typeof error.data === 'object'
    && Array.isArray((error.data as CurriculumTutorConflictPayload).tutorConflicts)
  );
}

/**
 * The backend's sentence for a clash, or null when the error is something else.
 *
 * `CurriculumApiError.message` wraps it in "Curriculum API returned 409 for
 * /path: …", which is diagnostic rather than something to show a user. Screens
 * that assign a tutor should prefer this and fall back to their own copy.
 */
export function tutorConflictMessage(error: unknown): string | null {
  return isTutorConflictError(error) ? error.data.error : null;
}

export interface CurriculumProgramme {
  id: string;
  sourceId: string;
  name: string;
  standard: string;
  level: string;
  status?: 'active' | 'draft' | 'archived' | string;
  isArchived?: boolean;
  isActive?: boolean;
  modules: number;
  freeComponents?: number;
  weeks: number;
  ksbMapped: number;
  ksbTotal: number;
  // Learner-consumed KSB progress across the whole programme, from the Component
  // Progress snapshot (`learner_progress_ksbs`). This answers "what have the
  // learners evidenced", which is a different question from ksbMapped/ksbTotal
  // above — that pair is how much of the standard the design maps.
  learnerKsbProgressPercentage?: number;
  learnerKsbConsumedWeight?: number;
  learnerKsbExpectedWeight?: number;
  learnerKsbLearnerCount?: number;
  learnerKsbCodesStarted?: number;
  learnerKsbCodesComplete?: number;
  learnerKsbCodesTotal?: number;
  learners: number;
  cohorts: number;
  groups?: number;
  lastUpdated: string;
  owner: string;
  color: string;
  description: string;
  structureType?: 'scheduled' | 'free' | string;
  ksbProfileSourceId?: string;
  // Off-the-job hours a learner must complete for the whole programme. null means no
  // target has been set, which is different from a target of zero.
  requiredOtjh?: number | null;
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
  isProgrammeDeleted?: boolean;
  /**
   * The authored week count — what the week builder holds and what the UI shows
   * as "N weeks". NOT the number of calendar sessions: a group delivering
   * Mon+Thu runs two sessions per week, so `sessionsNumber` is twice this.
   */
  weeks: number;
  weekStructure?: Array<{
    id: string;
    weekNumber: number;
    title: string;
    displayOrder?: number;
    ksbMappings?: CurriculumComponent['ksbMappings'];
    components?: CurriculumComponent[];
  }>;
  /**
   * The calendar session count — `weeks` x the group's delivery days per week.
   * This is what the session dates, the tutor clash check and the Teams series
   * are built from. Kept apart from `weeks` because one field meaning both made
   * every edit round-trip multiply the weeks by the delivery days.
   */
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
  /** What the learner reflects on. Only meaningful while reflection is required. */
  reflectionQuestion?: string;
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
    weightClass: 'hard' | 'soft' | 'possible' | string;
    weight_class?: 'hard' | 'soft' | 'possible' | string;
  }>;
  status: 'published' | 'draft' | 'review';
  lastEdited: string;
  contentSections: number;
  quizQuestions?: number | null;
  hasResources: boolean;
  description?: string;
  points?: number;
  isDeleted?: boolean;
  deletedAt?: string | null;
  deletedViaParent?: string;
  settings?: Record<string, unknown>;
}

/** Where a reusable component currently lives. */
export type LibraryComponentOrigin = 'active' | 'archived' | 'library';

/**
 * A component offered for reuse. Same shape as a normal component plus its
 * provenance, because the parent module may no longer exist: `originModuleTitle`
 * and `originWeekLabel` are stamped on the row at detach time and are the only
 * labels available for detached content.
 */
export interface LibraryComponent extends CurriculumComponent {
  origin: LibraryComponentOrigin;
  /**
   * The authoring type (`live-session`, `reading`, …). Distinct from `type`,
   * which the component endpoints fill with a human label ("Self-study") that
   * several activity types share and which cannot be copied.
   */
  componentType: string;
  originModuleCatalogueId?: string;
  originModuleTitle?: string;
  originWeekId?: string;
  originWeekLabel?: string;
  detachedAt?: string | null;
  copiedFromId?: string;
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
  /** Skills England standard supplying funding/compliance metadata for this profile. */
  standardSourceId?: string;
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
  /** Explicit parent standard; independent from the programmes using the profile. */
  standardSourceId?: string;
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
  // Expected OTJH of the component this mapping sits on. Week/module-level
  // mappings are not attached to a single component and report 0.
  component_otjh?: number;
  componentOtjh?: number;
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
  weight_class?: 'hard' | 'soft' | 'possible' | string;
  weightClass?: 'hard' | 'soft' | 'possible' | string;
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
  // KSBs carrying any weight at all, and the weight summed across the bucket.
  // There is no fully/partially-covered verdict: the weight is the fact.
  mapped: number;
  unmapped: number;
  total_weight: number;
}

/** Where a coverage response read its required-KSB set from. */
export interface CurriculumKsbCoverageSource {
  type: string;
  id: string;
  /**
   * 'programme' (the source stored on the programme row), 'module', 'request',
   * 'programme-name' (matched by name), 'mappings-only', or 'all-profiles' when
   * nothing identified a source and every profile's KSBs stood in.
   */
  origin: 'programme' | 'module' | 'request' | 'programme-name' | 'mappings-only' | 'all-profiles' | string;
  required_count: number;
  requiredCount: number;
  source_name?: string;
  sourceName?: string;
  source_label?: string;
  sourceLabel?: string;
}

export interface CurriculumKsbCoverageResponse {
  scope: string;
  identifier: string;
  source?: CurriculumKsbCoverageSource;
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
      total: number;
      modules: Array<{ module_id: string; moduleId: string; module_name: string; moduleName: string; weight: number; mappings: CurriculumKsbTraceMapping[] }>;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Scope achievement — Programme -> Cohort -> Group -> Module -> Week.
//
// Curriculum plans; learners consume. Every level of the hierarchy answers the
// same two questions about itself and nothing else: who is assigned here, and
// what have they actually achieved here. One response shape, one set of rules,
// so a cohort's number and its programme's number mean the same thing.
// ---------------------------------------------------------------------------

export type CurriculumLearnerScope = 'programme' | 'cohort' | 'group' | 'module' | 'week' | 'component';

/** Where a scope sits in the hierarchy, resolved server-side. */
export interface CurriculumScopeLineage {
  scope: CurriculumLearnerScope | string;
  identifier: string;
  /** Whether the scope record itself exists. An empty scope is not a missing one. */
  found: boolean;
  programmeId: string;
  programmeName: string;
  cohortId: string;
  cohortName: string;
  groupId: string;
  groupName: string;
  moduleCatalogueId: string;
  moduleTitle: string;
  weekId: string;
  weekTitle: string;
  componentId: string;
  componentTitle: string;
  /**
   * Which level's roster this scope reports. A module/week/component has none of
   * its own: the learners who meet it are the ones enrolment placed in the group
   * that delivers it.
   */
  placementBasis: 'programme' | 'cohort' | 'group' | string;
}

/** One learner's OTJH inside one scope. */
export interface CurriculumScopeOtjhLearner {
  learnerId: number | string;
  learnerName: string;
  email: string;
  cohort: string;
  group: string;
  /** What the modules of *this learner's group* add up to in this scope. */
  plannedOtjh: number;
  /**
   * Where `plannedOtjh` came from. 'group' is the normal case. 'none' means no
   * module in this scope is delivered to this learner's group. 'scope' means no
   * placement matched any delivering group, so the whole scope stood in.
   */
  plannedBasis?: 'group' | 'none' | 'scope' | string;
  /** Credited: declared hours where a reflection exists, expected hours otherwise. */
  achievedOtjh: number;
  /** The learner's own declared hours only. */
  declaredOtjh: number;
  completedActivityCount: number;
  reflectionCount: number;
  progressPercentage: number;
  /** Whole-programme figures from `Learner.learners`, never a scope subtotal. */
  programmeCompletedHours?: number | null;
  programmeTargetHours?: number | null;
}

export interface CurriculumScopeOtjhAchievement {
  componentCount: number;
  learnerCount: number;
  /**
   * Everything this scope authored, counted once. Not a per-learner figure: a
   * module belongs to one group, so a cohort running two groups holds two module
   * instances and no learner is assigned both.
   */
  authoredTotal: number;
  /** The average of what its learners are each assigned. */
  plannedPerLearner: number;
  /** The sum of what its learners are each assigned — the real denominator. */
  plannedTotal: number;
  /** The headline: hours actually achieved in this scope, across its learners. */
  achievedTotal: number;
  declaredTotal: number;
  creditedFromExpectedTotal: number;
  achievedPerLearnerAverage: number;
  progressPercentage: number;
  completedActivityCount: number;
  reflectionCount: number;
  learners: CurriculumScopeOtjhLearner[];
  sources: Record<string, string>;
}

/** One KSB's achieved weight inside one scope — a row of the achieved heatmap. */
export interface CurriculumScopeKsbAchievementRow {
  code: string;
  title: string;
  /** The standard's wording, shown under the code in the achievement table. */
  description?: string;
  ksbType: string;
  /**
   * 'K' | 'S' | 'B'. `ksbType` is a word whose spelling varies by import
   * ('Skill'/'Skills'/'skill'), so anything grouping or filtering by family
   * uses this instead.
   */
  ksbTypeCode?: 'K' | 'S' | 'B' | string;
  sourceType: string;
  sourceId: string;
  sourceLabel: string;
  /** Authored weight for this KSB across this scope, counted once. */
  plannedWeight: number;
  /**
   * What this scope's learners are between them assigned: the weight authored in
   * each learner's own group, summed. The honest denominator, and not the same
   * as `plannedWeight × learnerCount` once a scope spans several groups.
   */
  expectedWeightTotal: number;
  achievedWeightTotal: number;
  /** Each learner capped at the planned weight. What a percentage is taken of. */
  cappedAchievedWeightTotal: number;
  declaredReflectionWeightTotal: number;
  /** How many learners this KSB is actually authored for in this scope. */
  learnerCount: number;
  learnersAchievedCount: number;
  learnersCompleteCount: number;
  achievementPercentage: number;
  /**
   * 'unmapped' — required by the KSB source but taught nowhere in this scope (a
   * coverage gap). 'unplanned' — a learner consumed it but the scope never
   * authored it at all. Two different facts.
   */
  status: 'complete' | 'in_progress' | 'not_started' | 'unmapped' | 'unplanned' | string;
}

/**
 * One of Knowledge / Skills / Behaviours, rolled up. The per-KSB table answers
 * "how is S4 going"; this answers the question asked before it — how each
 * family is going, and which of them nothing has touched.
 */
export interface CurriculumScopeKsbTypeSummary {
  type: 'knowledge' | 'skill' | 'behaviour' | string;
  letter: 'K' | 'S' | 'B' | string;
  label: string;
  ksbCount: number;
  /** This scope's own KSBs of this family — excludes 'unplanned'. */
  requiredCount: number;
  mappedCount: number;
  /** Required by the KSB source but taught nowhere here: a curriculum gap. */
  unmappedCount: number;
  /** Earned by a learner but authored nowhere here. */
  unplannedCount: number;
  startedCount: number;
  completeCount: number;
  notStartedCount: number;
  /** Required here, and no learner has earned any of it yet. */
  missingCount: number;
  learnersAchievedTotal: number;
  plannedWeightTotal: number;
  expectedWeightTotal: number;
  achievedWeightTotal: number;
  cappedAchievedWeightTotal: number;
  progressPercentage: number;
}

export interface CurriculumScopeKsbAchievement {
  learnerCount: number;
  requiredCount: number;
  ksbCount: number;
  mappedCount: number;
  unmappedCount: number;
  unplannedCount: number;
  startedCount: number;
  completeCount: number;
  notStartedCount: number;
  /** This scope's own KSBs that no learner has earned any of yet. */
  missingCount: number;
  /** Knowledge / Skills / Behaviours, always all three and always in that order. */
  byType: CurriculumScopeKsbTypeSummary[];
  plannedWeightTotal: number;
  expectedWeightTotal: number;
  achievedWeightTotal: number;
  cappedAchievedWeightTotal: number;
  declaredReflectionWeightTotal: number;
  progressPercentage: number;
  learnersWithAchievement: number;
  rows: CurriculumScopeKsbAchievementRow[];
  sources: Record<string, string>;
}

export interface CurriculumScopeStructureCounts {
  moduleCount: number;
  weekCount: number;
  componentCount: number;
  ksbMappingCount: number;
  /** Above one, the scope's authored totals and its per-learner totals differ. */
  groupCount: number;
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
  // Reflection-declared OTJH, reported as its own fields. They do not replace
  // `completedHours` / `plannedHours`, which cover the whole programme.
  reflectionActualOtjh?: number | null;
  reflectionExpectedOtjh?: number | null;
  reflectionCount?: number;
}

export interface CurriculumLearnerKsbConsumptionItem {
  code: string;
  expectedWeight: number;
  consumedWeight: number;
  cappedConsumedWeight: number;
  // What the learner's reflection declared for the same activity. Supplementary
  // evidence, reported next to `consumedWeight` and never inside it.
  declaredReflectionWeight?: number;
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
  consumedWeightSource?: string;
  declaredReflectionWeightTotal?: number;
  expectedWeightTotal: number;
  cappedConsumedWeightTotal: number;
  progressPercentage: number;
  ksbs: CurriculumLearnerKsbConsumptionItem[];
}

export interface CurriculumLearnerActivityKsb {
  code: string;
  weight: number;
  weightClass?: string;
  countsTowardAchievement: boolean;
}

export interface CurriculumLearnerActivityReflection {
  submissionId: string | null;
  status: string;
  submittedAt: string;
  dateCompleted: string;
  text: string;
  qualityScore: number | null;
  actualOtjh: number | null;
  actualOtjhSource: string;
  declaredPlannedOtjh: number | null;
  progressLinkStatus: 'linked' | 'unlinked' | string;
  learnerResolution: string;
  submissionLearnerId: string;
  ksbRole: string;
  countsTowardAchievement: false;
}

export interface CurriculumLearnerActivityEvidence {
  evidenceId: string;
  fileName: string;
  status: string;
  scanResult: string;
  sectionRef: string;
  componentId: string;
  contentType: string;
  sizeBytes: number | null;
  uploadedAt: string;
}

/** One Progress activity, keyed on `learner_progress_entries.id`.
 *
 * The single identifier Learner, Coach and Curriculum share, so the same
 * activity can be looked up in each layer instead of matched on titles, emails
 * or enrolment source ids. `ksbSnapshot` is the canonical achieved weight;
 * `declaredReflectionKsbs` is what the reflection claimed for the same activity.
 * They are separate lists on purpose — summing both double-counts the activity.
 */
export interface CurriculumLearnerActivity {
  progressId: number;
  learnerId: number | string | null;
  kind: string;
  componentId: string;
  componentTitle: string;
  componentType: string;
  /** Resolved live against the catalogue, not the label stored on the progress row. */
  module: string;
  /**
   * Whether that module is still in the catalogue. 'deleted' means it was
   * removed; 'unknown' means the component no longer resolves to one at all.
   * Empty for an activity with no progress row behind it.
   */
  moduleStatus?: 'live' | 'deleted' | 'unknown' | string;
  moduleCatalogueId?: string;
  week: string;
  /** Whether the activity belongs to the scope being reported on. */
  scopeStatus?: 'in_scope' | 'out_of_scope' | 'unattributed' | string;
  /**
   * How it was placed there. 'component' — it is in this scope's live content.
   * 'lineage' — that component is gone (deleted or re-authored), but the
   * progress row was stamped with this scope when the learner completed it, so
   * the work is still credited here rather than nowhere.
   */
  scopeBasis?: 'component' | 'lineage' | 'unfiltered' | 'none' | string;
  /**
   * Why an in-scope, completed activity still does not count. Currently only
   * 'repeat_completion': the same component was completed before, and its hours
   * and KSB weight were earned once.
   */
  exclusionReason?: 'repeat_completion' | string;
  submittedAt: string;
  progressStatus: 'achieved' | 'failed' | 'incomplete' | string;
  passed: boolean | null;
  countsTowardAchievement: boolean | null;
  expectedOtjh: number | null;
  expectedOtjhSource: string;
  actualOtjh: number | null;
  actualOtjhSource: string;
  ksbSnapshot: CurriculumLearnerActivityKsb[];
  achievedKsbWeightTotal: number;
  declaredReflectionKsbs: CurriculumLearnerActivityKsb[];
  declaredReflectionKsbWeightTotal: number;
  reflection: CurriculumLearnerActivityReflection | null;
  evidence: CurriculumLearnerActivityEvidence[];
  evidenceCount: number;
}

// Learner placements are owned by the enrolment team. Curriculum reads this
// roster to show who is arriving in a cohort/group and never writes to it.
export interface CurriculumScopeLearnerRosterResponse {
  scope: CurriculumLearnerScope | string;
  identifier: string;
  lineage: CurriculumScopeLineage;
  placementBasis: CurriculumScopeLineage['placementBasis'];
  source: string;
  editable: boolean;
  assignedLearnerCount: number;
  assignedLearners: CurriculumProgrammeAssignedLearner[];
  countsByCohort: Record<string, number>;
  countsByGroup: Record<string, number>;
}

/** Retained name: the programme roster is the same read at the top scope. */
export type CurriculumProgrammeLearnerRosterResponse = CurriculumScopeLearnerRosterResponse;

export interface CurriculumScopeLearnerKsbImpactResponse {
  scope: CurriculumLearnerScope | string;
  identifier: string;
  lineage: CurriculumScopeLineage;
  placementBasis: CurriculumScopeLineage['placementBasis'];
  structure: CurriculumScopeStructureCounts;
  assignedLearnerCount: number;
  assignedLearners: CurriculumProgrammeAssignedLearner[];
  /** Retained name; `coverage` is the scope-neutral alias for the same payload. */
  programmeCoverage: CurriculumKsbCoverageResponse;
  coverage: CurriculumKsbCoverageResponse;
  /** Hours actually achieved in this scope — the OTJH roll-up. */
  otjhAchievement: CurriculumScopeOtjhAchievement;
  /** KSB weight actually earned in this scope — the achieved heatmap. */
  ksbAchievement: CurriculumScopeKsbAchievement;
  learnerKsbConsumption: CurriculumLearnerKsbConsumption[];
  learnerActivities?: CurriculumLearnerActivity[];
  learnerActivityCount?: number;
  ksbAchievementPolicy?: {
    achievedWeightSource: string;
    reflectionKsbRole: string;
    reflectionKsbCountsTowardAchievedWeight: boolean;
    reflectionLearnerResolution: string;
    expectedOtjhSource: string;
    actualOtjhSource: string;
    scopeAttribution?: string;
    /** Whether activity with no component reference counted. Programme only. */
    unattributedActivityCounts?: boolean;
    expectedWeightBasis?: string;
    plannedOtjhBasis?: string;
  };
  consumptionSources: {
    // Achieved delivery only. Failed activity and unresolved graded attempts are
    // reported separately below so they stay visible without being summed as
    // achievement — see backend learner_api/progress_rules.py.
    progress: Array<Record<string, unknown>>;
    // Resolved through `progress_entry_id`. Every row carries
    // `countsTowardAchievement: false`: a reflection is evidence about an
    // activity, not a second source of achieved KSB weight.
    learningReflectionSubmissions: Array<Record<string, unknown>>;
    excludedProgress?: Array<Record<string, unknown>>;
    excludedLearningReflectionSubmissions?: Array<Record<string, unknown>>;
    // Reflections on a component in this programme with no progress link, so no
    // learner can be resolved without guessing. Reported as a visible gap.
    unlinkedLearningReflectionSubmissions?: Array<Record<string, unknown>>;
    // Achieved activity belonging to a different scope in the same programme.
    // Reported so the gap between this scope's total and the learner's programme
    // total is inspectable rather than an unexplained shortfall.
    outOfScopeProgress?: Array<Record<string, unknown>>;
    evidenceByProgressEntry?: Record<string, CurriculumLearnerActivityEvidence[]>;
  };
}

/** Retained name: the programme impact is the same read at the top scope. */
export type CurriculumProgrammeLearnerKsbImpactResponse = CurriculumScopeLearnerKsbImpactResponse;

export interface CurriculumReadinessIssue {
  severity: 'warning' | 'error' | string;
  code: string;
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
  weightClass: 'hard' | 'soft' | 'possible' | string;
  weight_class?: 'hard' | 'soft' | 'possible' | string;
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
  standardSourceId?: string;
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
  /** End of the practical period. practicalEndDate is the same date under the name the apprenticeship model uses. */
  endDate: string;
  practicalEndDate?: string;
  /** End Point Assessment window in whole months. null means none recorded, which is not the same as 0. */
  epaMonths?: number | null;
  /** The date the apprenticeship ends: apprenticeshipEndOverride when set, otherwise practical end date plus epaMonths. */
  apprenticeshipEndDate?: string;
  /** Manually authored apprenticeship end date. Empty when the date is calculated. */
  apprenticeshipEndOverride?: string;
  durationMonths?: string | number;
  /**
   * The duration rule alone (start plus duration, less a day), before the
   * holiday extension the practical end date already includes. Compare the two
   * to tell whether holidays moved this cohort's dates.
   */
  baseEndDate?: string;
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
  weekDays?: string;
  startTime?: string;
  endTime?: string;
  schedule: string;
  color?: string;
  mode: string;
  moduleIds?: string[];
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

/**
 * Teams meeting state for one module, from `curriculum.live_sessions`.
 *
 * The meeting is never stored on the module row — it lives in its own table,
 * keyed by module. Listing pages read this instead of pulling every module's
 * full week structure just to inspect a live-session component's settings.
 */
export interface CurriculumTeamsMeetingSummary {
  moduleCatalogueId: string;
  liveSessionId: string;
  status: string;
  moduleTitle?: string;
  joinUrl: string;
  webLink?: string;
  meetingOptionsUrl?: string;
  eventId?: string;
  onlineMeetingId?: string;
  organizerEmail: string;
  presenters?: string[];
  attendees?: string[];
  repeatPattern: string;
  startDateTime: string;
  durationMinutes: number;
  occurrenceCount: number;
  upcomingCount: number;
  syncedCount: number;
  nextOccurrence: string;
  updatedAt: string;
  /** Only present when asked for: the dates Teams currently holds, in order. */
  occurrenceDates?: string[];
}

/** One scheduled instance of a live-session series. `status` is authored by the
 *  Graph artifact-sync service — never derived from a date on the client. */
export interface CurriculumLiveSessionOccurrence {
  occurrenceId: string;
  liveSessionId: string;
  moduleCatalogueId: string;
  sessionNumber: number;
  status: string; // 'scheduled' | 'completed' | 'cancelled' | ...
  scheduledStart: string;
  scheduledEnd: string;
  actualStart: string;
  actualEnd: string;
  participantCount: number;
  joinUrl: string;
  attendanceReportId: string;
  artifactsSyncedAt: string;
}

export interface CurriculumLiveSessionSeries {
  liveSessionId: string;
  moduleCatalogueId: string;
  moduleTitle?: string;
  status: string;
  joinUrl: string;
  provider?: string;
}

export interface CurriculumLiveSessionOccurrencesResponse {
  series: CurriculumLiveSessionSeries[];
  occurrences: CurriculumLiveSessionOccurrence[];
}

/** A completed occurrence's captured artifacts (transcript / recording). */
export interface LiveSessionArtifact {
  id: string;
  occurrence_id: string;
  artifact_type: string; // 'transcript' | 'recording'
  graph_artifact_id?: string;
  content_url?: string;
  created_datetime?: string;
  end_datetime?: string;
  metadata?: Record<string, unknown>;
}

/** One attendee row for a completed occurrence. */
export interface LiveSessionAttendance {
  id: string;
  occurrence_id: string;
  email?: string;
  display_name?: string;
  role?: string;
  total_attendance_seconds?: number;
  intervals?: Array<Record<string, unknown>>;
  raw_data?: Record<string, unknown>;
  expected?: boolean;
  attended?: boolean;
  join_count?: number;
  attendance_report_id?: string;
  attendance_report_start?: string;
  attendance_report_end?: string;
}

/** An occurrence enriched with its attendance + artifacts (from the per-series
 *  artifacts endpoint), loaded lazily when a completed row is expanded. */
export interface LiveSessionArtifactOccurrence {
  id: string;
  live_session_id: string;
  session_number?: number;
  status?: string;
  scheduled_start?: string;
  scheduled_end?: string;
  actual_start?: string;
  actual_end?: string;
  participant_count?: number;
  join_url?: string;
  attendance?: LiveSessionAttendance[];
  artifacts?: LiveSessionArtifact[];
}

export interface LiveSessionArtifactsResponse {
  series: Record<string, unknown>;
  occurrences: LiveSessionArtifactOccurrence[];
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
  practicalEndDate?: string;
  epaMonths?: number | null;
  apprenticeshipEndDate?: string;
  apprenticeshipEndOverride?: string;
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
  weekId?: string;
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
  courseId?: string;
  weekId?: string;
  weekNumber?: number;
  weekTitle?: string;
  programmeId?: string;
  programmeName?: string;
  courseName?: string;
  title: string;
  description: string;
  coverImageUrl?: string;
  weekBuilderWeekIds?: string[];
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
    weekTemplates?: unknown[];
  };
}

export interface CurriculumSessionPlanPreview {
  sessions: Array<{ sessionNumber: number; date: string; day: string; skippedHolidays: string[] }>;
  skippedHolidays: string[];
  finalEndDate: string;
  warnings: string[];
}

/** One holiday's share of a cohort's end-date extension. */
export interface CurriculumHolidayExtension {
  label: string;
  /** The first and last day of this holiday that fell inside the cohort's period. */
  startDate: string;
  endDate: string;
  days: number;
}

export interface CurriculumCohortEndDatePreview {
  endDate: string;
  practicalEndDate?: string;
  /** What the duration rule gives plus the holiday extension, regardless of any practical end date sent in. */
  calculatedEndDate?: string;
  /** The duration rule alone, before holidays. The holiday picker's window. */
  baseEndDate?: string;
  /** Days the selected holidays take out of the cohort's base period. */
  holidayExtensionDays?: number;
  /** Which holiday took which days, for an editor that names them. */
  holidayExtensions?: CurriculumHolidayExtension[];
  /** The contracted duration in months, unchanged by holidays. */
  durationMonths?: number;
  /** How long the cohort actually runs once the holidays are in. */
  effectiveDurationMonths?: number;
  /** True when the practical end date sent in differs from the calculated one. */
  practicalEndIsManual?: boolean;
  epaMonths?: number | null;
  apprenticeshipEndDate?: string;
  apprenticeshipEndOverride?: string;
  autoCalculated: boolean;
  rule: string;
  epaRule?: string;
  apprenticeshipRule?: string;
  warnings: string[];
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';

interface CurriculumCollection<T> {
  schema: string;
  count: number;
  results: T[];
}

// Multi-tier cache: hot cache for recent requests, cold cache for longer TTLs
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  hitCount: number;
  createdAt: number;
  entityType?: string; // 'programme', 'cohort', 'module', etc. for targeted invalidation
  entityId?: string;   // the programme/cohort/module ID for invalidation scoping
}

// Cache tier configuration: TTL and size limits by data category
const CACHE_TIERS = {
  // Reference data: frameworks, standards, component types (rarely change)
  metadata: { ttlMs: 300_000, maxEntries: 200 }, // 5 minutes
  // Programme trees: structure with cohorts/groups/modules (changes with save)
  programmeTree: { ttlMs: 60_000, maxEntries: 50 }, // 1 minute (per programme)
  // Module structures: week/component hierarchies (large, changes with authoring)
  moduleStructure: { ttlMs: 120_000, maxEntries: 100 }, // 2 minutes
  // KSB coverage and impact analysis (computed, medium volatility)
  ksbAnalysis: { ttlMs: 90_000, maxEntries: 50 }, // 1.5 minutes
  // Dynamic lists: tutors, coaches, sessions (may change frequently)
  dynamic: { ttlMs: 45_000, maxEntries: 100 }, // 45 seconds
  // Default tier for other GET requests
  default: { ttlMs: 30_000, maxEntries: 200 }, // 30 seconds
} as const;

// Cache statistics for observability
interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  totalSize: number;
  entries: number;
}

class MultiTierCache {
  private caches = new Map<keyof typeof CACHE_TIERS, Map<string, CacheEntry<unknown>>>();
  private inFlightRequests = new Map<string, Promise<unknown>>();
  private inFlightEpochs = new Map<string, number>();
  private stats = new Map<keyof typeof CACHE_TIERS, CacheStats>();

  constructor() {
    for (const tier of Object.keys(CACHE_TIERS) as Array<keyof typeof CACHE_TIERS>) {
      this.caches.set(tier, new Map());
      this.stats.set(tier, { hits: 0, misses: 0, evictions: 0, totalSize: 0, entries: 0 });
    }
  }

  private getTier(path: string): keyof typeof CACHE_TIERS {
    if (path.includes('/standards/') || path.includes('/frameworks/') || path.includes('/component-types')) {
      return 'metadata';
    }
    if (path.includes('/programmes/') && path.includes('/detail/')) {
      return 'programmeTree';
    }
    if (path.includes('/modules/') && !path.includes('/ksb-') && !path.includes('/coverage')) {
      return 'moduleStructure';
    }
    if (path.includes('/ksb-') || path.includes('/coverage') || path.includes('/impact')) {
      return 'ksbAnalysis';
    }
    if (path.includes('/tutors') || path.includes('/coaches') || path.includes('/holidays') || path.includes('/sessions')) {
      return 'dynamic';
    }
    return 'default';
  }

  private estimateSize(value: unknown): number {
    if (typeof value === 'string') return value.length * 2;
    if (typeof value === 'number') return 8;
    if (typeof value === 'boolean') return 1;
    if (value === null) return 0;
    if (Array.isArray(value)) {
      return 48 + value.reduce((sum, v) => sum + this.estimateSize(v), 0);
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value).length * 2;
      } catch {
        return 1024; // Conservative estimate for unserializable objects
      }
    }
    return 0;
  }

  get<T>(path: string, options?: { skipCache?: boolean }): CacheEntry<T> | null {
    if (options?.skipCache) return null;
    const tier = this.getTier(path);
    const cache = this.caches.get(tier);
    const entry = cache?.get(path) as CacheEntry<T> | undefined;

    if (!entry) {
      const stats = this.stats.get(tier);
      if (stats) stats.misses += 1;
      return null;
    }

    if (entry.expiresAt > Date.now()) {
      entry.hitCount += 1;
      const stats = this.stats.get(tier);
      if (stats) stats.hits += 1;
      return entry;
    }

    // Expired entry
    cache?.delete(path);
    const stats = this.stats.get(tier);
    if (stats) {
      stats.evictions += 1;
      stats.misses += 1;
    }
    return null;
  }

  set<T>(path: string, value: T, entityType?: string, entityId?: string): void {
    const tier = this.getTier(path);
    const cache = this.caches.get(tier);
    if (!cache) return;

    const tierConfig = CACHE_TIERS[tier];
    const size = this.estimateSize(value);

    // Evict LRU if cache full
    if (cache.size >= tierConfig.maxEntries) {
      let oldest: [string, CacheEntry<unknown>] | null = null;
      for (const [key, entry] of cache) {
        if (!oldest || entry.createdAt < oldest[1].createdAt) {
          oldest = [key, entry];
        }
      }
      if (oldest) {
        cache.delete(oldest[0]);
        const stats = this.stats.get(tier);
        if (stats) stats.evictions += 1;
      }
    }

    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + tierConfig.ttlMs,
      hitCount: 0,
      createdAt: Date.now(),
      entityType,
      entityId,
    };

    cache.set(path, entry as CacheEntry<unknown>);
    const stats = this.stats.get(tier);
    if (stats) {
      stats.entries = cache.size;
      stats.totalSize += size;
    }
  }

  // Invalidate cache entries by entity (e.g., save programme A → invalidate only programme A's tree)
  invalidateByEntity(entityType: string, entityId?: string): number {
    let count = 0;
    for (const cache of this.caches.values()) {
      for (const [key, entry] of cache) {
        if (entry.entityType === entityType && (!entityId || entry.entityId === entityId)) {
          cache.delete(key);
          count += 1;
        }
      }
    }
    return count;
  }

  // Invalidate cache entries matching a pattern
  invalidateByPattern(pattern: string | RegExp): number {
    let count = 0;
    for (const cache of this.caches.values()) {
      for (const key of cache.keys()) {
        const matches = typeof pattern === 'string' ? key.includes(pattern) : pattern.test(key);
        if (matches) {
          cache.delete(key);
          count += 1;
        }
      }
    }
    return count;
  }

  clear(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
    this.inFlightRequests.clear();
    this.inFlightEpochs.clear();
    for (const stats of this.stats.values()) {
      stats.hits = 0;
      stats.misses = 0;
      stats.evictions = 0;
      stats.entries = 0;
      stats.totalSize = 0;
    }
  }

  getInFlight(key: string): Promise<unknown> | undefined {
    return this.inFlightRequests.get(key);
  }

  // The mutation epoch a still-running GET was started in. A skipCache caller
  // uses this to tell "already in flight, but started before my write landed"
  // (must not be reused) from "in flight right now, after the write" (safe to
  // share).
  getInFlightEpoch(key: string): number | undefined {
    return this.inFlightEpochs.get(key);
  }

  setInFlight(key: string, promise: Promise<unknown>, epoch: number): void {
    this.inFlightRequests.set(key, promise);
    this.inFlightEpochs.set(key, epoch);
  }

  clearInFlight(key: string): void {
    this.inFlightRequests.delete(key);
    this.inFlightEpochs.delete(key);
  }

  getStats() {
    const result: Record<string, CacheStats> = {};
    for (const [tier, stats] of this.stats) {
      result[tier] = { ...stats };
    }
    return result;
  }
}

const multiTierCache = new MultiTierCache();

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

// Incremented on every mutation. GETs record the epoch they started in so a
// skipCache caller can tell whether an in-flight request already reflects the
// most recent write (see fetchJson).
let mutationEpoch = 0;

// Shares an in-flight GET between concurrent callers. GETs are intentionally
// not tied to component cleanup signals: React StrictMode can unmount/remount
// immediately in development, and aborting those requests fills DevTools with
// noisy "(cancelled)" rows even though the next mount needs the same data.
const inFlightGets = new Map<string, Promise<unknown>>();
const completedGets = new Map<string, { value: unknown; expiresAt: number }>();
const GET_CACHE_TTL_MS = 30_000; // Fallback for legacy code

export function clearCurriculumGetCache() {
  multiTierCache.clear();
  completedGets.clear();
  inFlightGets.clear();
}

export function invalidateCurriculumCacheByEntity(entityType: string, entityId?: string): number {
  return multiTierCache.invalidateByEntity(entityType, entityId);
}

export function getCurriculumCacheStats() {
  return multiTierCache.getStats();
}

async function fetchJson<T>(path: string, init?: CurriculumRequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    // Any GET started before this point predates the write, so skipCache callers
    // must not reuse it.
    mutationEpoch += 1;
    // For mutations, invalidate cache selectively based on the endpoint
    if (path.includes('/programmes/tree/')) {
      // Tree save: invalidate all programme trees and related data
      multiTierCache.invalidateByPattern(/\/overview\//);
      multiTierCache.invalidateByPattern(/\/programmes\/.*\/detail\//);
      multiTierCache.invalidateByEntity('programme');
      multiTierCache.invalidateByEntity('cohort');
      multiTierCache.invalidateByEntity('group');
      multiTierCache.invalidateByEntity('module');
    } else if (path.includes('/programmes/')) {
      multiTierCache.invalidateByPattern(/\/overview\//);
      multiTierCache.invalidateByEntity('programme');
      multiTierCache.invalidateByEntity('cohort');
      multiTierCache.invalidateByEntity('group');
      multiTierCache.invalidateByEntity('module');
    } else if (path.includes('/cohorts/') || path.includes('/groups/') || path.includes('/modules/')) {
      // The overview payload carries programmes, cohorts, groups AND modules in
      // one document, and a programme's detail tree carries the same structure.
      // Neither is tagged with an entity type, so an entity-scoped invalidation
      // left both in place: creating a group refreshed the page you were on (that
      // reload asks for fresh data explicitly) but the next page you opened read
      // the pre-write overview out of cache and showed no new group until a full
      // browser refresh threw the cache away.
      multiTierCache.invalidateByPattern(/\/overview\//);
      multiTierCache.invalidateByPattern(/\/programmes\/.*\/detail\//);
      multiTierCache.invalidateByEntity('cohort');
      multiTierCache.invalidateByEntity('group');
      multiTierCache.invalidateByEntity('module');
    } else if (path.includes('/ksb-')) {
      multiTierCache.invalidateByEntity('ksb');
    } else {
      // Fallback: clear all caches for unknown mutations
      multiTierCache.clear();
    }
    return fetchJsonUncached<T>(path, init);
  }

  // GET: check multi-tier cache
  if (!init?.skipCache) {
    const cached = multiTierCache.get<T>(path, init);
    if (cached) {
      return settleWithCallerAbort(Promise.resolve(cached.value), init?.signal);
    }
  }

  // Check in-flight deduplication. skipCache means "do not read a stale cached
  // value", not "do not share a request that is already going to the network
  // right now": a fresh in-flight GET satisfies the caller's freshness need just
  // as well as a new one. Several independent hooks refresh the same endpoints
  // concurrently after a save (tutors/coaches/programme detail), and giving each
  // its own request produced 5-6 duplicate calls per endpoint.
  //
  // The one case skipCache must still bypass is an in-flight request that was
  // started *before* this caller's mutation landed, since that response predates
  // the write. Requests are therefore tagged with the epoch they began in, and a
  // skipCache caller only joins an in-flight GET from the current epoch.
  const sharedInit = init?.signal ? { ...init, signal: undefined } : init;
  const inFlight = multiTierCache.getInFlight(path) as Promise<T> | undefined;
  const inFlightIsFresh = inFlight !== undefined
    && (!init?.skipCache || multiTierCache.getInFlightEpoch(path) === mutationEpoch);
  const existing = inFlightIsFresh ? inFlight : undefined;

  const pending = existing || fetchJsonUncached<T>(path, sharedInit).then(value => {
    if (!init?.skipCache) {
      // Tag cache entries with entity type for targeted invalidation
      let entityType: string | undefined;
      let entityId: string | undefined;
      if (path.includes('/programmes/') && path.includes('/detail/')) {
        entityType = 'programme';
        const match = path.match(/\/programmes\/([^/]+)\/detail/);
        entityId = match ? decodeURIComponent(match[1]) : undefined;
      } else if (path.includes('/programmes/')) {
        entityType = 'programme';
      } else if (path.includes('/cohorts/')) {
        entityType = 'cohort';
      } else if (path.includes('/groups/')) {
        entityType = 'group';
      } else if (path.includes('/modules/')) {
        entityType = 'module';
      } else if (path.includes('/ksb-') || path.includes('/coverage') || path.includes('/impact')) {
        entityType = 'ksb';
      }
      multiTierCache.set(path, value, entityType, entityId);
    }
    return value;
  });

  // Register even skipCache requests so concurrent refreshes of the same endpoint
  // collapse onto one network call. The cache *write* above still respects
  // skipCache, so nothing stale is stored.
  if (!existing) {
    multiTierCache.setInFlight(path, pending as Promise<unknown>, mutationEpoch);
    const clearInFlight = () => {
      if (multiTierCache.getInFlight(path) === (pending as Promise<unknown>)) {
        multiTierCache.clearInFlight(path);
      }
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
    ...(init?.skipCache ? { cache: 'no-store' as const } : {}),
    signal,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.skipCache ? { 'Cache-Control': 'no-cache' } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    let detail = '';
    let payload: unknown;
    try {
      payload = await response.json();
      const payloadRecord = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const validationErrors = Array.isArray(payloadRecord.validationErrors) ? payloadRecord.validationErrors : [];
      const validation = validationErrors
        .map((item: unknown) => item && typeof item === 'object' ? (item as { message?: string }).message : '')
        .filter(Boolean)
        .join('; ');
      const errorText = typeof payloadRecord.error === 'string' ? payloadRecord.error : '';
      detail = errorText
        ? `: ${errorText}${validation ? ` - ${validation}` : ''}`
        : '';
    } catch {
      detail = '';
    }
    throw new CurriculumApiError(`Curriculum API returned ${response.status} for ${path}${detail}`, response.status, path, payload);
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
export function fetchCurriculumModules(signal?: AbortSignal, options: {
  compact?: boolean;
  programmeId?: string;
  cohortId?: string;
  groupId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  skipCache?: boolean;
} = {}): Promise<CurriculumModule[]> {
  const query = new URLSearchParams();
  if (options.compact) query.set('compact', 'true');
  if (options.programmeId) query.set('programme_id', options.programmeId);
  if (options.cohortId) query.set('cohort_id', options.cohortId);
  if (options.groupId) query.set('group_id', options.groupId);
  if (options.status) query.set('status', options.status);
  if (options.page) query.set('page', String(options.page));
  if (options.pageSize) query.set('page_size', String(options.pageSize));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchCollection<CurriculumModule>(`/curriculum/modules/${suffix}`, { signal, skipCache: options.skipCache });
}

export function fetchCurriculumComponents(signal?: AbortSignal, options: { moduleCatalogueIds?: string[]; page?: number; pageSize?: number; skipCache?: boolean } = {}): Promise<CurriculumComponent[]> {
  const query = new URLSearchParams();
  const moduleCatalogueIds = (options.moduleCatalogueIds || []).filter(Boolean);
  if (moduleCatalogueIds.length) query.set('module_catalogue_ids', moduleCatalogueIds.join(','));
  if (options.page) query.set('page', String(options.page));
  if (options.pageSize) query.set('page_size', String(options.pageSize));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchCollection<CurriculumComponent>(`/curriculum/components/${suffix}`, { signal, skipCache: options.skipCache });
}

/**
 * Search components available for reuse, across all programmes.
 *
 * Returns list rows only: no `settings`, no `ksbMappings`. Those are 24 MB
 * across the components table, the picker does not show them, and fetching
 * them for a whole page would dominate the request. Call
 * `fetchComponentLibraryDetail` for the handful actually being copied.
 *
 * Deliberately not cached: a filtered search changes with every keystroke,
 * unlike the stable snapshot `fetchCurriculumComponents` serves.
 */
export function fetchComponentLibrary(options: {
  search?: string;
  types?: string[];
  programmeIds?: string[];
  origins?: LibraryComponentOrigin[];
  page?: number;
  pageSize?: number;
} = {}, signal?: AbortSignal): Promise<LibraryComponent[]> {
  const query = new URLSearchParams();
  const search = (options.search || '').trim();
  if (search) query.set('search', search);
  const types = (options.types || []).filter(Boolean);
  if (types.length) query.set('types', types.join(','));
  const programmeIds = (options.programmeIds || []).filter(Boolean);
  if (programmeIds.length) query.set('programme_ids', programmeIds.join(','));
  const origins = (options.origins || []).filter(Boolean);
  if (origins.length) query.set('origins', origins.join(','));
  if (options.page) query.set('page', String(options.page));
  if (options.pageSize) query.set('page_size', String(options.pageSize));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchCollection<LibraryComponent>(`/curriculum/components/library/${suffix}`, { signal, skipCache: true });
}

/**
 * Full authoring detail for specific components — `settings` and `ksbMappings`
 * included. Call this with the ids being copied, never with a whole page.
 */
export function fetchComponentLibraryDetail(ids: string[], signal?: AbortSignal): Promise<LibraryComponent[]> {
  const wanted = ids.filter(Boolean);
  if (!wanted.length) return Promise.resolve([]);
  const query = new URLSearchParams({ ids: wanted.join(',') });
  return fetchCollection<LibraryComponent>(`/curriculum/components/library/?${query.toString()}`, { signal, skipCache: true });
}

export function fetchCurriculumStats(signal?: AbortSignal): Promise<CurriculumOverview['stats']> {
  return fetchJson<CurriculumOverview['stats']>('/curriculum/stats/', { signal });
}

export function fetchCurriculumProgrammes(signal?: AbortSignal, options: { skipCache?: boolean; visibility?: 'all' | 'operational' } = {}): Promise<CurriculumProgramme[]> {
  const query = new URLSearchParams();
  if (options.visibility === 'all') query.set('visibility', 'all');
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchCollection<CurriculumProgramme>(`/curriculum/programmes/${suffix}`, { signal, skipCache: options.skipCache });
}

export function fetchCurriculumGroups(signal?: AbortSignal): Promise<CurriculumGroup[]> {
  return fetchCollection<CurriculumGroup>('/curriculum/groups/', { signal });
}

export function fetchCurriculumKsbFrameworks(signal?: AbortSignal): Promise<CurriculumKsbFramework[]> {
  return fetchCollection<CurriculumKsbFramework>('/curriculum/ksb-frameworks/', { signal });
}

export function fetchCurriculumKsbSets(signal?: AbortSignal, options: { all?: boolean } = {}): Promise<CurriculumKsbSet[]> {
  const query = new URLSearchParams();
  if (options.all) query.set('visibility', 'all');
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchCollection<CurriculumKsbSet>(`/curriculum/ksb-sets/${suffix}`, { signal });
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

// Kept as named entry points because the Programme workspace reads them by
// name; both are the scope reads at the top of the hierarchy.
export function fetchCurriculumProgrammeLearnerKsbImpact(programmeId: string, params: { sourceType?: string; sourceId?: string; learnerStatus?: string } = {}, signal?: AbortSignal): Promise<CurriculumProgrammeLearnerKsbImpactResponse> {
  return fetchCurriculumScopeLearnerKsbImpact('programme', programmeId, params, signal);
}

export function fetchCurriculumProgrammeLearnerRoster(programmeId: string, params: { cohort?: string; group?: string; learnerStatus?: string } = {}, signal?: AbortSignal): Promise<CurriculumProgrammeLearnerRosterResponse> {
  return fetchCurriculumScopeLearnerRoster('programme', programmeId, params, signal);
}

// One route per level of Programme -> Cohort -> Group -> Module -> Week, so a
// page asks for its own scope and nothing wider. `component` has no path route
// of its own and goes through the query form.
const SCOPE_ROSTER_PATHS: Record<string, (id: string) => string> = {
  programme: id => `/curriculum/programmes/${encodeURIComponent(id)}/learner-roster/`,
  cohort: id => `/curriculum/cohorts/${encodeURIComponent(id)}/learner-roster/`,
  group: id => `/curriculum/groups/${encodeURIComponent(id)}/learner-roster/`,
  module: id => `/curriculum/modules/${encodeURIComponent(id)}/learner-roster/`,
  week: id => `/curriculum/weeks/${encodeURIComponent(id)}/learner-roster/`,
};

const SCOPE_IMPACT_PATHS: Record<string, (id: string) => string> = {
  programme: id => `/curriculum/programmes/${encodeURIComponent(id)}/learner-ksb-impact/`,
  cohort: id => `/curriculum/cohorts/${encodeURIComponent(id)}/learner-ksb-impact/`,
  group: id => `/curriculum/groups/${encodeURIComponent(id)}/learner-ksb-impact/`,
  module: id => `/curriculum/modules/${encodeURIComponent(id)}/learner-ksb-impact/`,
  week: id => `/curriculum/weeks/${encodeURIComponent(id)}/learner-ksb-impact/`,
};

function scopePath(
  paths: Record<string, (id: string) => string>,
  fallback: string,
  scope: CurriculumLearnerScope,
  identifier: string,
  query: URLSearchParams,
) {
  const builder = paths[scope];
  if (builder) {
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return `${builder(identifier)}${suffix}`;
  }
  query.set('scope', scope);
  query.set('identifier', identifier);
  return `${fallback}?${query.toString()}`;
}

/**
 * The learners enrolment placed inside one curriculum scope.
 *
 * A module/week/component reports the roster of the group that delivers it —
 * `placementBasis` on the response says which level the roster came from.
 */
export function fetchCurriculumScopeLearnerRoster(
  scope: CurriculumLearnerScope,
  identifier: string,
  params: { cohort?: string; group?: string; learnerStatus?: string } = {},
  signal?: AbortSignal,
): Promise<CurriculumScopeLearnerRosterResponse> {
  const query = new URLSearchParams();
  if (params.cohort) query.set('cohort', params.cohort);
  if (params.group) query.set('group', params.group);
  if (params.learnerStatus) query.set('learnerStatus', params.learnerStatus);
  return fetchJson<CurriculumScopeLearnerRosterResponse>(
    scopePath(SCOPE_ROSTER_PATHS, '/curriculum/learner-roster/', scope, identifier, query),
    { signal },
  );
}

/**
 * What the learners in one curriculum scope have actually achieved there.
 *
 * `otjhAchievement` is hours, `ksbAchievement` is the achieved KSB heatmap, and
 * both are computed from the components inside this scope alone — a cohort is
 * never handed the whole programme's consumption.
 */
export function fetchCurriculumScopeLearnerKsbImpact(
  scope: CurriculumLearnerScope,
  identifier: string,
  params: { sourceType?: string; sourceId?: string; learnerStatus?: string } = {},
  signal?: AbortSignal,
): Promise<CurriculumScopeLearnerKsbImpactResponse> {
  const query = new URLSearchParams();
  if (params.sourceType) query.set('source_type', params.sourceType);
  if (params.sourceId) query.set('source_id', params.sourceId);
  if (params.learnerStatus) query.set('learnerStatus', params.learnerStatus);
  return fetchJson<CurriculumScopeLearnerKsbImpactResponse>(
    scopePath(SCOPE_IMPACT_PATHS, '/curriculum/learner-ksb-impact/', scope, identifier, query),
    { signal },
  );
}

export function fetchCurriculumGroupKsbCoverage(groupId: string, params: { sourceType?: string; sourceId?: string } = {}, signal?: AbortSignal): Promise<CurriculumKsbCoverageResponse> {
  const query = new URLSearchParams();
  if (params.sourceType) query.set('source_type', params.sourceType);
  if (params.sourceId) query.set('source_id', params.sourceId);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchJson<CurriculumKsbCoverageResponse>(`/curriculum/groups/${encodeURIComponent(groupId)}/ksb-coverage/${suffix}`, { signal });
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

export function fetchCurriculumTeamsMeetingSummaries(
  signal?: AbortSignal,
  options: { moduleCatalogueIds?: string[]; occurrenceDates?: boolean; skipCache?: boolean } = {},
): Promise<CurriculumTeamsMeetingSummary[]> {
  const ids = (options.moduleCatalogueIds || []).filter(Boolean);
  const query = new URLSearchParams();
  if (ids.length) query.set('module_catalogue_ids', ids.join(','));
  // Opt-in: the occurrence dates are only needed by the page that compares them
  // against the module's stored session plan, and they are the bulk of the payload.
  if (options.occurrenceDates) query.set('occurrence_dates', '1');
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchCollection<CurriculumTeamsMeetingSummary>(
    `/curriculum/teams-meetings/summary/${suffix}`,
    { signal, skipCache: options.skipCache },
  );
}

/** Real per-occurrence live-session state (status/dates/attendance counts) for a
 *  set of modules and/or series. Feeds the Sessions tab's scheduled/completed
 *  badges — the status comes from the sync service, not a client date guess.
 *  Light by design: attendance rows and transcript/recording artifacts are NOT
 *  included here (load them lazily with `fetchLiveSessionArtifacts`). */
export function fetchCurriculumLiveSessionOccurrences(
  options: { moduleCatalogueIds?: string[]; liveSessionIds?: string[]; skipCache?: boolean; signal?: AbortSignal } = {},
): Promise<CurriculumLiveSessionOccurrencesResponse> {
  const moduleIds = (options.moduleCatalogueIds || []).filter(Boolean);
  const sessionIds = (options.liveSessionIds || []).filter(Boolean);
  if (!moduleIds.length && !sessionIds.length) {
    return Promise.resolve({ series: [], occurrences: [] });
  }
  const query = new URLSearchParams();
  if (moduleIds.length) query.set('module_catalogue_ids', moduleIds.join(','));
  if (sessionIds.length) query.set('live_session_ids', sessionIds.join(','));
  return fetchJson<CurriculumLiveSessionOccurrencesResponse>(
    `/curriculum/live-sessions/occurrences/?${query.toString()}`,
    { signal: options.signal, skipCache: options.skipCache },
  );
}

/** A completed live session's captured artifacts: every occurrence with its
 *  attendance list and transcript/recording artifacts. Keyed by the series id
 *  (`teamsLiveSessionId` on the component). Heavier than the occurrences read, so
 *  the Sessions tab only calls this when a completed row is expanded. */
export function fetchLiveSessionArtifacts(
  liveSessionId: string,
  options: { skipCache?: boolean; signal?: AbortSignal } = {},
): Promise<LiveSessionArtifactsResponse> {
  return fetchJson<LiveSessionArtifactsResponse>(
    `/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/artifacts/`,
    { signal: options.signal, skipCache: options.skipCache },
  );
}

/** Absolute URL that streams a transcript/recording artifact's content (proxied
 *  from Graph server-side). Same-origin + cookie auth, so it can be used directly
 *  as an `href` / `download` / media `src`. */
export function liveSessionArtifactContentUrl(liveSessionId: string, artifactId: string): string {
  return `${API_BASE_URL}/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/artifacts/${encodeURIComponent(artifactId)}/content/`;
}

/** Same-origin redirect that records which Week/occurrence launched the shared Teams meeting. */
export function liveSessionJoinUrl(liveSessionId: string, occurrenceId: string): string {
  return `${API_BASE_URL}/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/occurrences/${encodeURIComponent(occurrenceId)}/join/`;
}

/** Inline media/text response. Without this flag the backend deliberately sends
 * Content-Disposition: attachment so the same endpoint is a real download. */
export function liveSessionArtifactPreviewUrl(liveSessionId: string, artifactId: string): string {
  return `${liveSessionArtifactContentUrl(liveSessionId, artifactId)}?preview=1`;
}

export function fetchCurriculumSessions(
  signal?: AbortSignal,
  options: { skipCache?: boolean } = {},
): Promise<CurriculumSession[]> {
  // Sessions live in the 45s "dynamic" cache tier, so a caller that has just
  // scheduled a module (or opens straight after) can otherwise read a stale
  // snapshot that predates its session dates. skipCache lets those callers read
  // the current plan instead of waiting out the TTL.
  return fetchCollection<CurriculumSession>('/curriculum/sessions/', { signal, skipCache: options.skipCache });
}

export function fetchCurriculumTutors(signal?: AbortSignal, options: { skipCache?: boolean } = {}): Promise<CurriculumStaffProfile[]> {
  return fetchCollection<CurriculumStaffProfile>('/curriculum/tutors/', { signal, skipCache: options.skipCache, timeoutMs: 15000 });
}

export function fetchCurriculumCoaches(signal?: AbortSignal, options: { skipCache?: boolean } = {}): Promise<CurriculumStaffProfile[]> {
  return fetchCollection<CurriculumStaffProfile>('/curriculum/coaches/', { signal, skipCache: options.skipCache, timeoutMs: 15000 });
}

export function fetchCurriculumHolidays(signal?: AbortSignal, options: { skipCache?: boolean } = {}): Promise<CurriculumHoliday[]> {
  return fetchCollection<CurriculumHoliday>('/curriculum/holidays/', { signal, skipCache: options.skipCache });
}

export function fetchCurriculumOverview(signal?: AbortSignal, options: { compact?: boolean; skipCache?: boolean; timeoutMs?: number } = {}): Promise<CurriculumOverview> {
  return fetchJson<CurriculumOverview>(`/curriculum/overview/${options.compact ? '?compact=true' : ''}`, { signal, skipCache: options.skipCache, timeoutMs: options.timeoutMs });
}

export function fetchCurriculumProgrammeDetail(id: string, signal?: AbortSignal, options: { visibility?: 'all' | 'operational'; skipCache?: boolean } = {}): Promise<CurriculumProgrammeDetail> {
  const query = new URLSearchParams();
  if (options.visibility === 'all') query.set('visibility', 'all');
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchJson<CurriculumProgrammeDetail>(`/curriculum/programmes/${encodeURIComponent(id)}/detail/${suffix}`, { signal, skipCache: options.skipCache });
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

export type CurriculumProgrammeInput = Partial<Pick<CurriculumProgramme, 'name' | 'standard' | 'level' | 'owner' | 'color' | 'description' | 'structureType' | 'ksbProfileSourceId' | 'status'>> & {
  /**
   * Off-the-job hours target. A string is accepted because form inputs produce
   * one and the backend parses either; null clears a stored target, and omitting
   * the key leaves it untouched.
   */
  requiredOtjh?: number | string | null;
};
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
  // Both are already honoured by PATCH /curriculum/modules/<id>/ — declared here
  // so the module workspace can send them without casting.
  status?: string;
  /** Calendar sessions (weeks x delivery days per week). See `CurriculumModule`. */
  sessionsNumber?: number;
  /** Authored weeks. Sent alongside `sessionsNumber`, never instead of it. */
  weeks?: number;
  /**
   * Book a slot the tutor already holds. Without it the save is refused with a
   * 409 carrying `tutorConflicts` — see `isTutorConflictError`.
   */
  allowTutorConflict?: boolean;
};
export type CurriculumComponentInput = Partial<Omit<CurriculumComponent, 'lastEdited'>>;
export type CurriculumCohortInput = { id?: string; cohortId?: string; name?: string; programme?: string; programmeId?: string; startDate?: string; endDate?: string; durationMonths?: number; epaMonths?: number | null; /** null clears the manual apprenticeship end date and restores the calculated one. */ apprenticeshipEndOverride?: string | null; color?: string; moduleName?: string; sessionsNumber?: number; holidayIds?: Array<string | number> };
export type CurriculumGroupInput = { id?: string; groupId?: string; name?: string; cohortId?: string; programmeId?: string; tutor?: string; coach?: string; color?: string; weekDays?: string; startTime?: string; endTime?: string; startDate?: string; endDate?: string; moduleName?: string; sessionsNumber?: number; /** Honoured by PATCH /curriculum/groups/<id>/ only. */ status?: string; /** See CurriculumModuleInput.allowTutorConflict. */ allowTutorConflict?: boolean };
export type CurriculumSessionInput = Partial<Pick<CurriculumSession, 'date' | 'startTime' | 'endTime' | 'tutor'>>;
export type CurriculumStaffingInput = { groupId?: string; tutor?: string; coach?: string; /** See CurriculumModuleInput.allowTutorConflict. */ allowTutorConflict?: boolean };
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
  /** See CurriculumModuleInput.allowTutorConflict. */
  allowTutorConflict?: boolean;
};
export type FreeProgrammeComponentInput = Partial<FreeProgrammeComponent> & {
  id: string;
  type: string;
  settings?: Record<string, unknown>;
};
export type FreeProgrammeModuleInput = {
  id?: string;
  courseId?: string;
  weekId?: string;
  weekNumber?: number;
  weekTitle?: string;
  courseName?: string;
  title: string;
  description?: string;
  coverImageUrl?: string;
  components?: FreeProgrammeComponentInput[];
};

export function createCurriculumProgramme(input: CurriculumProgrammeInput) {
  return postJson<{ created: boolean; programme: CurriculumProgramme }>('/curriculum/programmes/', input);
}

export function updateCurriculumProgramme(id: string, input: CurriculumProgrammeInput) {
  return patchJson<{ updated: boolean; programme: CurriculumProgramme }>(`/curriculum/programmes/${encodeURIComponent(id)}/`, input);
}

/**
 * What a programme DELETE answers with — an archive, or a permanent removal.
 *
 * `removed` counts the curriculum rows a permanent delete took with it, keyed by
 * kind; `learners` is how many learner plans referenced it and were left alone.
 * See curriculum_api.views.curriculum_programme_detail.
 */
export type CurriculumProgrammeDeleteResult = {
  deleted: boolean;
  permanent: boolean;
  archived?: boolean;
  reason?: string;
  message?: string;
  id: string;
  removed?: Record<string, number>;
  learners?: number;
};

/** What still hangs off a programme, when a permanent delete is refused. */
export type CurriculumProgrammeDependencyReport = {
  blocked: boolean;
  counts: Record<string, number>;
  total: number;
  programme?: {
    id?: string;
    sourceId?: string;
    name?: string;
  };
  cleanupStartStep?: string;
  message?: string;
};

/**
 * A refused delete. `blockers` names what still depends on the programme —
 * learner delivery, which is never deleted with a programme — so the caller can
 * say what has to be cleared first rather than only that it failed.
 */
export type CurriculumProgrammeDependencyError = {
  error?: string;
  reason?: 'programme-has-dependencies' | 'programme-has-learner-delivery' | 'programme-not-archived' | string;
  deleted?: false;
  permanent?: false;
  id?: string;
  blockers?: Record<string, number>;
  dependencyReport?: CurriculumProgrammeDependencyReport;
  message?: string;
};

export function deleteCurriculumProgramme(id: string, options: { permanent?: boolean } = {}) {
  const suffix = options.permanent ? '?permanent=true' : '';
  return fetchJson<CurriculumProgrammeDeleteResult>(
    `/curriculum/programmes/${encodeURIComponent(id)}/${suffix}`,
    { method: 'DELETE', timeoutMs: 60000 },
  );
}

export const archiveCurriculumProgramme = (id: string) => deleteCurriculumProgramme(id);
export const permanentlyDeleteCurriculumProgramme = (id: string) => deleteCurriculumProgramme(id, { permanent: true });

export type CurriculumProgrammeRestoreResult = {
  restored: boolean;
  id: string;
  programme?: CurriculumProgramme | null;
  details?: {
    programmeRestored?: boolean;
    cohorts?: number;
    groups?: number;
    modules?: number;
    weeks?: number;
    components?: number;
    ksbMappings?: number;
  };
  message?: string;
};

export function restoreCurriculumProgramme(id: string) {
  return postJson<CurriculumProgrammeRestoreResult>(
    `/curriculum/programmes/${encodeURIComponent(id)}/restore/`,
    {},
  );
}

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

/**
 * The canonical practical-end / EPA / apprenticeship-end calculation, run by the
 * backend. Editors call this while the user types rather than reimplementing the
 * date rules client-side, so the preview and the saved value cannot disagree.
 */
export function previewCohortEndDate(input: {
  startDate?: string;
  durationMonths?: number;
  /** An authored practical end date. Overrides the duration rule for this preview. */
  practicalEndDate?: string | null;
  epaMonths?: number | null;
  apprenticeshipEndDate?: string;
  apprenticeshipEndOverride?: string | null;
  /**
   * The holidays applied to this cohort. Days these take out of the cohort's own
   * period push the practical end date out, which carries the apprenticeship end
   * date with it via the EPA rule.
   */
  holidays?: { label?: string; startDate: string; endDate: string }[];
}) {
  return postJson<CurriculumCohortEndDatePreview>('/curriculum/preview/cohort-end-date/', input);
}

export function previewModuleSessionPlan(input: { startDate?: string; numberOfSessions?: number; sessionsNumber?: number; weekDays?: string | string[]; deliveryDays?: string | string[]; holidays?: unknown[] }) {
  return postJson<CurriculumSessionPlanPreview>('/curriculum/preview/module-session-plan/', input);
}

/** The slot a tutor is being asked about. Matches the module's own schedule fields. */
export interface CurriculumTutorAvailabilityInput {
  startDate?: string;
  sessionsNumber?: number | string;
  weekDays?: string;
  startTime?: string;
  endTime?: string;
  /** Ask about one person. Omit to get a verdict for every tutor in one call. */
  tutor?: string;
  /** The module being edited, so it is not reported as blocking its own slot. */
  moduleCatalogueId?: string;
  /**
   * The parent cohort, so the slot is dated the way the calendar dates it — its
   * ticked holidays move a session onto the next delivery day, and a clash is
   * about the day the session actually runs on.
   */
  cohortId?: string;
  /**
   * The ticked holidays themselves, for a form previewing a cohort choice that
   * is not saved yet. Sent, they win over what `cohortId` would have read back.
   */
  holidays?: CurriculumHoliday[];
}

export interface CurriculumTutorAvailabilityVerdict {
  tutor: string;
  available: boolean;
  conflicts: CurriculumTutorConflict[];
  /** The same sentence the save would have refused with, or '' when free. */
  message: string;
}

export interface CurriculumTutorAvailabilitySlot {
  sessionDates: string[];
  startTime: string;
  endTime: string;
  /** False when the slot books nothing, so "everyone is free" is not an all-clear. */
  bookable: boolean;
}

export type CurriculumTutorAvailability = CurriculumTutorAvailabilitySlot & CurriculumTutorAvailabilityVerdict;

export type CurriculumTutorAvailabilityRoster = CurriculumTutorAvailabilitySlot & {
  results: CurriculumTutorAvailabilityVerdict[];
  availableCount: number;
  busyCount: number;
};

/**
 * Whether a tutor is already teaching in a proposed slot — asked *before* saving.
 *
 * Runs the same rule the save enforces, so a screen can warn while the tutor is
 * still being chosen instead of letting the person fill in a whole form and
 * discover the clash from a refused save.
 */
export function previewTutorAvailability(input: CurriculumTutorAvailabilityInput & { tutor: string }) {
  return postJson<CurriculumTutorAvailability>('/curriculum/preview/tutor-availability/', input);
}

/** Every tutor's verdict for one slot, for annotating a tutor picker. */
export function previewTutorAvailabilityRoster(input: CurriculumTutorAvailabilityInput) {
  return postJson<CurriculumTutorAvailabilityRoster>('/curriculum/preview/tutor-availability/', input);
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


export function createCurriculumHoliday(input: CurriculumHolidayInput) {
  return postJson('/curriculum/holidays/', input);
}

export function updateCurriculumHoliday(id: string | number, input: CurriculumHolidayInput) {
  return patchJson(`/curriculum/holidays/${encodeURIComponent(String(id))}/`, input);
}

export function archiveCurriculumHoliday(id: string | number) {
  return deleteJson(`/curriculum/holidays/${encodeURIComponent(String(id))}/`);
}
