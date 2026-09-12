import { readLearnerJson, invalidateLearnerReads } from './learnerRead';
import type { MonthlyAssignment } from './monthlyAssignment';

export interface LearningReflectionSubmissionInput {
  learnerKind: 'commercial' | 'apprenticeship';
  learnerId: string;
  learnerName: string;
  programmeName: string;
  activityType: string;
  activityId: string;
  activityTitle: string;
  moduleTitle: string;
  weekTitle: string;
  plannedOtjh: string;
  learningReflection: string;
  ksbCodes: string[];
  ksbWeights: Record<string, number>;
  ksbExplanations: Record<string, string>;
  confidenceBefore: Record<string, number>;
  confidenceAfter: Record<string, number>;
  applicationType: string;
  applicationText: string;
  evidenceFiles: string[];
  evidenceConsentConfirmed: boolean;
  selectedBenefits: string[];
  benefitExplanation: string;
  actualTimeHours: string;
  completedDuringPaidHours: string;
  dateCompleted: string;
  otjhConfirmed: boolean;
  signedDeclaration: boolean;
  qualityScore: number;
  /** Assignment wizard fields. Other reflection flows omit these. */
  submissionMode?: 'draft' | 'submit';
  assignmentAnswer?: string;
  whatYouLearned?: string;
  businessImpact?: string;
  outsideWorkingHours?: boolean;
  outsideWorkingHoursConfirmed?: boolean;
  monthlyAssignment?: MonthlyAssignment;
  assignmentTimeSource?: 'timer' | 'input';
}

export interface HistoricalAssignmentContent {
  method: string;
  notices: string[];
  cards: Array<{
    title: string;
    emptyMessage: string;
    sections: Array<{ label: string; text: string; source: string; kind: 'original' | 'feedback' | 'record' }>;
  }>;
}

export interface StoredLearningReflectionSubmission extends LearningReflectionSubmissionInput {
  /** Server-owned provenance; learners cannot request the import exemption. */
  submissionOrigin?: 'learner' | 'imported_legacy' | 'classified_legacy';
  legacyAssignment?: {
    content?: HistoricalAssignmentContent;
    aptemLearnerId: number;
    componentId: number;
    evidenceIds: number[];
    sourceStatus: string;
    documents: Array<{ evidenceId: number; part: 'file' | 'report'; name: string }>;
    feedbacks?: Array<{ author?: string; date?: string; message?: string }>;
  };
  id: string;
  status: string;
  coachFeedback: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  submittedAt: string | null;
  locked: boolean;
}

export type LearningReflectionStatusMap = Record<string, string>;

export function learningReflectionStatusKey(activityType: string, activityId: string): string {
  return `${activityType}:${activityId}`;
}

/** Load every reflection status for a learner in one query. Dashboard cards
 * only need the status badge, not each submission's full seven-step payload. */
export async function loadLearningReflectionStatuses(input: {
  learnerKind: 'commercial' | 'apprenticeship';
  learnerId: string;
}): Promise<LearningReflectionStatusMap> {
  const params = new URLSearchParams(input);
  const data = await readLearnerJson<{ statuses?: Array<{ activityType: string; activityId: string; status: string }> }>(
    `/learner_api/reflection/submissions/?${params.toString()}`,
  );
  return Object.fromEntries(
    (data?.statuses || []).map((row) => [
      learningReflectionStatusKey(row.activityType, row.activityId),
      row.status,
    ]),
  );
}

export async function loadLearningReflectionSubmission(input: {
  learnerKind: 'commercial' | 'apprenticeship';
  learnerId: string;
  activityType: string;
  activityId: string;
}): Promise<StoredLearningReflectionSubmission | null> {
  const params = new URLSearchParams(input);
  const data = await readLearnerJson<{ submission?: StoredLearningReflectionSubmission | null }>(
    `/learner_api/reflection/submissions/?${params.toString()}`,
  );
  return data.submission || null;
}

export async function saveLearningReflectionSubmission(
  input: LearningReflectionSubmissionInput,
): Promise<{ id: string; status: string }> {
  let response: Response;
  try {
    response = await fetch('/learner_api/reflection/submissions/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error('Could not reach the server to save this reflection.');
  }

  const text = await response.text();
  let data: { id?: string; status?: string; error?: string };
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Unexpected response (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(data.error || `Could not save the reflection (${response.status}).`);
  }
  invalidateLearnerReads();
  return { id: data.id || '', status: data.status || '' };
}
