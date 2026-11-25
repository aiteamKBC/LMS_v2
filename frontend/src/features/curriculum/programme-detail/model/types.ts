import { type CurriculumHoliday, type CurriculumComponent } from '@/lib/curriculumApi';

export interface Module {
  id: string;
  sourceId?: string | number;
  moduleId?: string;
  moduleCatalogueId?: string;
  catalogueId?: string;
  structureId?: string;
  name: string;
  description: string;
  cohortId?: string;
  cohort?: string;
  groupId?: string;
  group?: string;
  coach?: string;
  tutor?: string;
  weeks: number;
  /**
   * The module's own placement dates, as the record holds them — including an end
   * that holidays moved or a tutor set by hand. Kept apart from the week span in
   * `weeksData`, which is where the authored sessions happen to fall: a module
   * whose last week has one session on 5 Oct can still legitimately end on 15 Oct,
   * and printing the week span as the module's dates contradicted its own record.
   */
  startDate?: string;
  endDate?: string;
  otjh: number;
  status: 'published' | 'approved' | 'in-review' | 'draft' | 'archived';
  archived: boolean;
  ksbTags: string[];
  ksbMapping: ModuleKsbMappingSummary[];
  /** Whether the component counts, OTJH and KSB figures can be shown yet. */
  componentFigures: ComponentFiguresState;
  weeksData: Week[];
}

export interface Programme {
  id: string;
  sourceId?: string;
  ksbProfileSourceId?: string;
  structureType?: 'scheduled' | 'free' | string;
  name: string;
  standard: string;
  level: string;
  owner: string;
  color: string;
  description: string;
  duration: string;
  /**
   * The two windows the apprenticeship model distinguishes, read across every
   * cohort on the programme. Both open on the earliest cohort start; the
   * practical period closes on the latest practical end, and the apprenticeship
   * runs on past it by the EPA window.
   */
  practicalWindow: string;
  apprenticeshipWindow: string;
  /** Earliest cohort start date across the programme, ISO 'YYYY-MM-DD'. Blank when no cohort has one. */
  earliestCohortStartDate: string;
  cohorts: Cohort[];
  modules: Module[];
  ksbHeatmap: KsbHeatmapRow[];
  moduleNames: string[];
  /**
   * Off-the-job hours a learner must complete across the whole programme.
   * null means no target has been set, which is not the same as a target of
   * zero: without one there is nothing for authored OTJH to be a share of.
   */
  requiredOtjh: number | null;
  /**
   * What the learners have actually evidenced, from the Component Progress
   * snapshot (`learner_progress_ksbs`) by way of programme_learner_ksb_progress.
   * A different question from the coverage heatmap above, which measures how
   * much of the standard the *design* touches, so the two never share a figure.
   */
  learnerKsbProgressPercentage: number;
  learnerKsbCodesStarted: number;
  learnerKsbCodesComplete: number;
  learnerKsbCodesTotal: number;
  learnerKsbLearnerCount: number;
}

export interface Cohort {
  id: string;
  name: string;
  startDate: string;
  /** End of the practical period. */
  endDate: string;
  /** When the apprenticeship ends: the authored date when there is one, otherwise the practical end date plus the EPA period. Blank when neither is recorded. */
  apprenticeshipEndDate: string;
  /** True when the date above was typed rather than calculated. */
  apprenticeshipEndIsManual: boolean;
  epaMonths: number | null;
  status: 'active' | 'planned' | 'completed' | 'archived';
  archived: boolean;
  learners: number;
  groups: Group[];
  holidayIds?: string[];
  holidays?: CurriculumHoliday[];
}

export interface Group {
  id: string;
  name: string;
  learners: number;
  coach: string;
  tutor: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'planned' | 'completed' | 'archived';
  archived: boolean;
  modules: Module[];
  schedule: string;
  mode: string;
}

// ============================================================
// Types — Full Programme Hierarchy
// ============================================================

export interface Session {
  id: string;
  title: string;
  type: 'Live Session' | 'Workshop' | 'Self-study' | 'Assignment' | 'Quiz' | 'OTJH' | 'Collaboration' | 'Review';
  day: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: number;
  tutor: string;
  venue: string;
  deliveryMode: string;
  ksbRefs: string[];
  skippedHolidays?: string[];
  scheduleWarnings?: string[];
  status: 'scheduled' | 'completed' | 'cancelled' | 'pending';
}

export interface Week {
  id: string;
  number: number;
  title: string;
  startDate: string;
  endDate: string;
  otjh: number;
  components?: ProgrammeWeekComponent[];
  /** From the component summary while the full list is not loaded; read
   *  through weekComponentCount / weekPublishedCount, never directly. */
  componentCount?: number;
  publishedComponentCount?: number;
  sessions: Session[];
}

export type ProgrammeWeekComponent = Partial<CurriculumComponent> & {
  id: string;
  title: string;
  type: string;
  duration: number;
  status: CurriculumComponent['status'];
  contentSections: number;
  quizQuestions?: number | null;
  ksbRefs: string[];
};

export type ModuleKsbMappingSummary = { ksb: string; weight: number; count?: number; evidence?: KsbEvidenceItem[]; source?: 'authoring' | 'fallback'; sourceType?: string; sourceId?: string };

export type KsbEvidenceItem = {
  module: string;
  scope: 'module' | 'week' | 'component' | 'live';
  week?: string;
  component?: string;
  componentType?: string;
  classification?: string;
  groups?: string[];
  weight: number;
};

/**
 * Where the component figures (counts, OTJH, KSBs) stand: still loading,
 * built from the summary or the full list, or unavailable because both reads
 * failed. A figure is printed only once it is `ready`, so a loading or failed
 * read never shows as a real zero.
 */
export type ComponentFiguresState = 'pending' | 'ready' | 'failed';

export type KsbHeatmapRow = {
  id?: string;
  ksb: string;
  title: string;
  description?: string;
  coverage: Record<string, number | null>;
  counts?: Record<string, number>;
  evidence?: Record<string, KsbEvidenceItem[]>;
  totalOccurrences?: number;
  totalWeight?: number;
  sourceType?: string;
  sourceId?: string;
  sourceName?: string;
  sourceLabel?: string;
  missing?: boolean;
};
