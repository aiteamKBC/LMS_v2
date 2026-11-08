import { readLearnerJson } from './learnerRead';
import type { ComponentMarking, LearnerComponentEntry, LearnerComponentProgress, LearnerKind, LearnerVideoProgress } from './learnerDetail';
import type { CoverMetadata } from '@/pages/learner/my-learning/learningSummary';

// ============================================================================
// Monthly Submission reads. The page needs its assignments only, not the
// learner-wide learner-detail payload (every component, week, quiz attempt,
// activity-feed row, KSB and hours figure). Statuses, submission counts,
// activity dates and month labels keep their own existing reads.
// ============================================================================

/** One assignment row: what the list groups, filters and shows. */
export type MonthlyAssignmentComponent = Pick<LearnerComponentEntry,
  'componentId' | 'type' | 'component' | 'module' | 'week' | 'sessionDate' | 'expectedOtjh'> & {
  /** The server's hasComponentContent verdict, without sending the brief. */
  contentAvailable?: boolean;
};

/** Fields shaped like LearnerDetail, so the existing month model reads both. */
export interface MonthlySubmissionData {
  learner: { id: string; name: string };
  components: MonthlyAssignmentComponent[];
  componentMarkingStatus: Record<string, ComponentMarking>;
  videoProgress: Pick<LearnerVideoProgress, 'componentId' | 'kind' | 'passed'>[];
  componentProgress: Pick<LearnerComponentProgress, 'componentId' | 'kind' | 'passed'>[];
}

/** The selected assignment's brief, topics, files and KSBs. */
export type MonthlyAssignmentDetail = Pick<LearnerComponentEntry,
  'componentId' | 'assignmentTopics' | 'assignmentBrief' | 'assignmentBriefHtml' | 'description'
  | 'resourceUrl' | 'fileName' | 'downloadAllowed' | 'files' | 'ksbMappings'>;

const base = (kind: LearnerKind, id: string) =>
  `/learner_api/monthly-submission/${kind}/${encodeURIComponent(id)}/`;

export async function fetchMonthlySubmission(kind: LearnerKind, id: string, signal?: AbortSignal): Promise<MonthlySubmissionData> {
  const data = await readLearnerJson<MonthlySubmissionData>(base(kind, id), { signal, revalidate: true });
  if (String(data?.learner?.id) !== String(id) || !Array.isArray(data.components)) {
    throw new Error('The server returned a different learner. Please try again.');
  }
  return data;
}

/** The five schedule fields Monthly Submission reads, for its assignments only. */
export type MonthlyAssignmentDates = Record<string, {
  date: string | null; date_source: string; date_needs_review: boolean; due_timing?: string; week_end: string | null;
}>;

/** Assignment dates scoped to this page, in the shape the month model reads
 * from subject-covers. Shared like subject-covers: 30s, cleared by saves. */
export async function fetchMonthlySubmissionDates(kind: LearnerKind, id: string, options: { signal?: AbortSignal; revalidate?: boolean } = {}): Promise<CoverMetadata> {
  const data = await readLearnerJson<{ activity_dates?: MonthlyAssignmentDates }>(`${base(kind, id)}dates/`,
    { signal: options.signal, revalidate: options.revalidate, ttlMs: 30_000 });
  if (!data || typeof data.activity_dates !== 'object' || data.activity_dates === null) {
    throw new Error('Assignment dates could not be loaded.');
  }
  // model.ts reads only these five fields of each schedule.
  return { covers: {}, activity_dates: data.activity_dates as unknown as CoverMetadata['activity_dates'] };
}

/** Authored brief, topics, files and KSBs only: no marking or statuses. Cached
 * for 30s per learner and assignment; any save, submit or upload clears it. */
export async function fetchMonthlyAssignmentDetail(kind: LearnerKind, id: string, componentId: string, signal?: AbortSignal, revalidate = false): Promise<MonthlyAssignmentDetail> {
  const data = await readLearnerJson<MonthlyAssignmentDetail>(
    `${base(kind, id)}assignments/${encodeURIComponent(componentId)}/`, { signal, revalidate, ttlMs: 30_000 });
  if (data?.componentId !== componentId) throw new Error('The server returned a different assignment. Please try again.');
  return data;
}
