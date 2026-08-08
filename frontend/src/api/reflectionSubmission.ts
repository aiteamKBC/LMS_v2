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
}

export interface StoredLearningReflectionSubmission extends LearningReflectionSubmissionInput {
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
  let response: Response;
  try {
    response = await fetch(`/learner_api/reflection/submissions/?${params.toString()}`);
  } catch {
    throw new Error('Could not reach the server to load reflection statuses.');
  }

  const data = await response.json().catch(() => null) as {
    statuses?: Array<{ activityType: string; activityId: string; status: string }>;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(data?.error || `Could not load reflection statuses (${response.status}).`);
  }
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
  let response: Response;
  try {
    response = await fetch(`/learner_api/reflection/submissions/?${params.toString()}`);
  } catch {
    throw new Error('Could not reach the server to load this reflection.');
  }

  const text = await response.text();
  let data: { submission?: StoredLearningReflectionSubmission | null; error?: string };
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Unexpected response (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(data.error || `Could not load the reflection (${response.status}).`);
  }
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
  return { id: data.id || '', status: data.status || '' };
}
