// Compatibility boundary for existing page-local imports.
export {
  fetchLearnerProfileActivity as fetchCaseFileStudentActivity,
  fetchLearnerProfileDetail as fetchCaseFileLearnerDetail,
  fetchLearnerProfileMetrics as fetchCaseFileLearnerMetrics,
  fetchLearnerProfileShell as fetchCaseFileShell,
} from '@/features/coach/learner-profile/api/learnerProfileApi';
export type { LearnerProfileShell as CaseFileShell } from '@/features/coach/learner-profile/api/learnerProfileApi';
