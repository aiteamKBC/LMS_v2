export type {
  AttendanceApiLearner,
  AttendanceApiResponse,
  CaseloadApiLearner,
  CaseloadApiResponse,
  EmbeddedCaseloadLearner,
  EnrollmentStatus,
  FilterOption,
  Learner,
  PerformanceStatus,
  QuickViewTab,
  SortDirection,
  SortKey,
  StatusFilter,
} from '@/pages/coach/caseload/types';

export interface EngagementLearnerStatus {
  id: string;
  overallStatus: string | null;
}
