/**
 * Client for the Curriculum-driven Review instance API (see
 * backend/curriculum_api/review_instances.py + coach_api's
 * coach_review_instance_* views). A Review instance is one learner's one
 * occurrence of a Curriculum Review template -- opening it returns the
 * template's sections/fields exactly as Curriculum defines them, so the
 * coach form is never hard-coded per Review type.
 */
import { coachFetch } from '@/lib/coachFetch';
import { saveReviewPdfResponse } from './reviewPdf';

export type ReviewFieldType =
  | 'text'
  | 'boolean'
  | 'numeric'
  | 'date'
  | 'list_item'
  | 'boolean_case_block'
  | 'email'
  | 'phone'
  | 'postcode_address'
  | 'title_description'
  | 'text_multiline'
  | 'action_button';

export interface ReviewFieldDefinition {
  id: string;
  title: string;
  fieldType: ReviewFieldType;
  required: boolean;
  displayOrder: number;
  configuration: Record<string, unknown>;
  parentFieldId?: string | null;
  conditionValue?: 'yes' | 'no' | null;
  answer?: unknown;
  answeredBy?: string | null;
  answeredAt?: string | null;
  yesFields?: ReviewFieldDefinition[];
  noFields?: ReviewFieldDefinition[];
}

export interface ReviewSectionDefinition {
  id: string;
  title: string;
  estimatedMinutes: number;
  displayOrder: number;
  enabled: boolean;
  fields: ReviewFieldDefinition[];
}

export type ReviewParticipantRole = 'advisor' | 'employer' | 'participant' | 'referrer';

export interface ReviewSignatureState {
  required: boolean;
  signed: boolean;
  signedBy?: string | null;
  signedName?: string | null;
  signedAt?: string | null;
  /** The original saved mark, never regenerated from the displayed name. */
  signature?: string | null;
}

/** One metric's frozen actual/expected/variance figures. Percent values are
 *  null when the underlying plan could not supply them -- which reads as "not
 *  recorded", never as 0% on track. */
export interface ReviewProgressMetric {
  actual: number | null;
  expected: number | null;
  planned: number | null;
  actualPercent: number | null;
  expectedPercent: number | null;
  variancePercent: number | null;
  varianceDirection: 'above' | 'below' | '';
}

export interface ReviewKsbProgress {
  available: boolean;
  title?: string | null;
  reason?: string | null;
  actual?: number | null;
  expected?: number | null;
  planned?: number | null;
  actualPercent: number | null;
  expectedPercent: number | null;
  variancePercent?: number | null;
  varianceDirection?: 'above' | 'below' | '';
}

/**
 * What a coach froze the last time they pressed Calculate on a Progress
 * Review. Rendered exactly as stored -- the frontend never recalculates, and
 * never falls back to the learner's current dashboard figures, so a completed
 * review keeps showing the numbers it was signed against.
 *
 * `calculatedFrom` is the individual learner's own programme start date and
 * `calculatedAt` is the backend's own clock; both are produced server-side.
 */
export interface ReviewProgressSnapshot {
  calculationMethod: string;
  schemaVersion?: number;
  formulaVersion?: string;
  /** Source captured for newly calculated snapshots; absent on historical snapshots. */
  actualHoursSource?: 'learner.completed_hours';
  calculatedFrom: string;
  calculatedAt: string;
  calculatedBy: string;
  weeksElapsed: number | null;
  programmeProgress: ReviewProgressMetric;
  offTheJobHours: ReviewProgressMetric;
  /** Additive and optional so signed snapshots from before this contract keep
   * rendering without being reinterpreted. */
  ksbProgress?: ReviewKsbProgress | null;
}

/** One past completed Progress Review and the RAG that review itself
 *  recorded ('' when it captured none). */
export interface ReviewRagHistoryEntry {
  reviewInstanceId: string;
  reviewName: string;
  occurrenceNumber: number | null;
  targetDate: string;
  completedAt: string | null;
  rag: string;
}

export interface ReviewMeetingSummarySource {
  fieldId: string;
  status: 'ready' | 'edited' | 'failed' | 'unavailable' | string;
  summaryText: string;
  generatedAt?: string | null;
  editedAt?: string | null;
  /** Always a safe coach-facing state message, never a raw backend exception. */
  message?: string;
}

export interface ReviewInstanceFormDefinition {
  pdf?: { available: boolean; reason: string } | null;
  /** Progress Review only, and null until a coach calculates it. */
  progressSnapshot?: ReviewProgressSnapshot | null;
  /** Progress Review only -- this learner's completed Progress Reviews,
   *  newest first. */
  ragHistory?: ReviewRagHistoryEntry[];
  /** MCM coach surface only. Omitted for Progress Reviews and unmapped legacy
   * instances. The formal answer is still attached to the field in sections. */
  meetingSummarySource?: ReviewMeetingSummarySource;
  instance: {
    id: string;
    reviewTemplateId: string;
    learnerId: number;
    programmeId: string;
    occurrenceNumber: number;
    targetDate: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
  };
  template: {
    id: string;
    name: string;
    reviewTypeCode?: string;
    signatures: Record<ReviewParticipantRole, boolean>;
    visibleTo: Record<ReviewParticipantRole, boolean>;
    recurrence: { interval: number; unit: string };
    notifications: Record<string, boolean>;
    allowEditingPriorDays: number;
  };
  sections: ReviewSectionDefinition[];
  signatures: Record<ReviewParticipantRole, ReviewSignatureState>;
  /** Set only when this instance was moved to in-progress by an authorised
   *  manual override rather than real Teams attendance -- null for the
   *  overwhelming majority of instances. */
  manualOverride: {
    reasonCode: string;
    note: string;
    changedBy: string;
    changedAt: string | null;
    manualStartedAt: string | null;
  } | null;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.detail === 'string'
      ? data.detail
      : typeof data.error === 'string'
        ? data.error
        : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

const instanceUrl = (instanceId: string) => `/coach_api/coach/reviews/${encodeURIComponent(instanceId)}`;

export async function downloadReviewInstancePdf(instanceId: string): Promise<void> {
  await saveReviewPdfResponse(await coachFetch(`${instanceUrl(instanceId)}/pdf`));
}

/**
 * Calculate and FREEZE a Progress Review's learner-progress snapshot.
 *
 * An explicit coach action: nothing else on this screen recalculates, and
 * opening, reloading or exporting the review never does. The backend owns
 * both ends of the window -- the learner's own programme start date and its
 * own clock -- so no date is sent from here.
 */
export async function calculateReviewInstanceProgress(instanceId: string) {
  const response = await coachFetch(`${instanceUrl(instanceId)}/progress`, { method: 'POST' });
  return readJsonResponse<ReviewInstanceFormDefinition>(response);
}

/**
 * The review instance behind one calendar event, created on first open if the
 * occurrence has not been scheduled yet -- so a coach can fill a review's form
 * from any occurrence on the calendar, not only from a booked one.
 */
export async function openReviewInstanceForEvent(eventKey: string) {
  const response = await coachFetch('/coach_api/coach/reviews/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventKey }),
  });
  return readJsonResponse<{ instanceId: string }>(response);
}

export async function fetchReviewInstanceForm(instanceId: string, signal?: AbortSignal) {
  const response = await coachFetch(instanceUrl(instanceId), { signal });
  return readJsonResponse<ReviewInstanceFormDefinition>(response);
}

export async function saveReviewInstanceAnswers(instanceId: string, answers: Record<string, unknown>) {
  const response = await coachFetch(`${instanceUrl(instanceId)}/answers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  });
  return readJsonResponse<ReviewInstanceFormDefinition>(response);
}

export interface ReviewCompletionError {
  detail: string;
  /** `status` names an invalid lifecycle transition (not yet in-progress, or
   *  already submitted/completed -- see backend.curriculum_api.review_instances
   *  .complete_review_instance); `fields` names unanswered required questions. */
  errors?: { status?: string[]; fields?: string[]; signatures?: ReviewParticipantRole[]; reason?: string[]; note?: string[]; startedAt?: string[] };
}

export async function completeReviewInstance(instanceId: string, answers?: Record<string, unknown>) {
  const response = await coachFetch(`${instanceUrl(instanceId)}/complete`, {
    method: 'POST',
    headers: answers ? { 'Content-Type': 'application/json' } : undefined,
    body: answers ? JSON.stringify({ answers }) : undefined,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as ReviewCompletionError;
    throw Object.assign(new Error(data.detail || 'This review cannot be completed yet.'), { errors: data.errors });
  }
  return readJsonResponse<ReviewInstanceFormDefinition>(response);
}

export async function generateReviewMeetingSummary(instanceId: string) {
  const response = await coachFetch(`${instanceUrl(instanceId)}/meeting-summary`, { method: 'POST' });
  return readJsonResponse<{ meetingSummarySource: ReviewMeetingSummarySource }>(response);
}

export type ManualInProgressReasonCode =
  | 'coach-confirmed-live-start'
  | 'teams-link-issue'
  | 'graph-unavailable'
  | 'attendance-not-detected'
  | 'meeting-held-outside-teams'
  | 'scheduler-delay'
  | 'other';

/**
 * Exception path only -- normal MCM/Progress Review meetings move to
 * in-progress from a real, Graph-confirmed Teams join
 * (see coach_api.views.apply_teams_attendance_status_transition). This is
 * for when that cannot be detected (Teams link problem, Graph outage, a
 * delayed/missing attendance report, the meeting happening over another
 * channel, or the sync scheduler failing) -- only reachable while the
 * review is still `scheduled`, and only by the assigned coach or a
 * super-admin viewing that coach's workspace.
 */
export async function markReviewInstanceInProgressManually(
  instanceId: string,
  params: { reasonCode: ManualInProgressReasonCode; note?: string; startedAt?: string },
) {
  const response = await coachFetch(`${instanceUrl(instanceId)}/mark-in-progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reasonCode: params.reasonCode, note: params.note || '', startedAt: params.startedAt || '' }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as ReviewCompletionError;
    throw Object.assign(new Error(data.detail || 'This review cannot be marked in progress.'), { errors: data.errors });
  }
  return readJsonResponse<ReviewInstanceFormDefinition>(response);
}

export async function signReviewInstance(
  instanceId: string,
  role: ReviewParticipantRole,
  signedName: string,
  signature: string,
) {
  const response = await coachFetch(`${instanceUrl(instanceId)}/signatures`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, signedName, signature }),
  });
  return readJsonResponse<ReviewInstanceFormDefinition>(response);
}

// --------------------------------------------------------- learner additions

/**
 * A single learner-specific additional Review -- a coach adding ONE extra
 * canonical occurrence for ONE learner (see
 * backend/curriculum_api/review_instances.py's
 * create_learner_review_addition / coach_api.views
 * .coach_review_learner_additions_create). Never a standalone calendar row:
 * this always produces a real reviewTemplateId + reviewInstanceId, and the
 * returned eventKey schedules through the SAME
 * /coach/timetable/events/schedule endpoint any other generated Review does.
 */
export interface LearnerAdditionReviewTemplate {
  id: string;
  name: string;
  reviewTypeId: string | null;
  reviewTypeCode: string | null;
  reviewTypeName: string | null;
}

export type LearnerAdditionReasonCode =
  | 'additional-coaching'
  | 'learner-request'
  | 'employer-request'
  | 'performance-concern'
  | 'safeguarding-follow-up'
  | 'other';

export interface LearnerAdditionResult {
  additionId: string;
  eventKey: string;
  reviewInstanceId: string;
  reviewTemplateId: string;
  reviewName: string;
  reviewTypeCode: string | null;
  occurrenceRef: string;
  targetDate: string;
  status: string;
}

/**
 * Enabled Review templates for ONE learner's own programme -- never a list
 * a coach could use to pick a template from a different programme; the
 * backend independently re-validates this on the POST below regardless of
 * what this list returned.
 */
export async function fetchLearnerAdditionReviewTemplates(learnerId: number | string, signal?: AbortSignal) {
  const response = await coachFetch(
    `/coach_api/coach/reviews/learner-additions/templates?learnerId=${encodeURIComponent(String(learnerId))}`,
    { signal },
  );
  return readJsonResponse<{ learnerId: number; programmeId: string | null; templates: LearnerAdditionReviewTemplate[] }>(response);
}

/**
 * Create (or, for a repeated identical request, return the existing) one
 * learner-specific additional Review. Never creates a Teams meeting -- the
 * result's eventKey is scheduled separately, exactly like an official
 * generated occurrence, via the existing coach/timetable/events/schedule
 * endpoint ("Add & Schedule" calls this then that, in sequence).
 */
export async function createLearnerReviewAddition(params: {
  learnerId: number | string;
  reviewTemplateId: string;
  targetDate: string;
  reasonCode?: LearnerAdditionReasonCode | '';
  reason?: string;
}) {
  const response = await coachFetch('/coach_api/coach/reviews/learner-additions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      learnerId: params.learnerId,
      reviewTemplateId: params.reviewTemplateId,
      targetDate: params.targetDate,
      reasonCode: params.reasonCode || '',
      reason: params.reason || '',
    }),
  });
  return readJsonResponse<LearnerAdditionResult>(response);
}

/** Every top-level + conditional-child field, flattened, for validation/progress counts. */
export function flattenReviewFields(sections: ReviewSectionDefinition[]): ReviewFieldDefinition[] {
  const flat: ReviewFieldDefinition[] = [];
  const walk = (fields: ReviewFieldDefinition[] | undefined) => {
    for (const field of fields || []) {
      flat.push(field);
      walk(field.yesFields);
      walk(field.noFields);
    }
  };
  for (const section of sections) walk(section.fields);
  return flat;
}

export const DISPLAY_ONLY_FIELD_TYPES: ReviewFieldType[] = ['title_description', 'action_button'];
