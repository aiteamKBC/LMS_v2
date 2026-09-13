/**
 * Client for the Curriculum-driven Review instance API (see
 * backend/curriculum_api/review_instances.py + coach_api's
 * coach_review_instance_* views). A Review instance is one learner's one
 * occurrence of a Curriculum Review template -- opening it returns the
 * template's sections/fields exactly as Curriculum defines them, so the
 * coach form is never hard-coded per Review type.
 */
import { coachFetch } from '@/lib/coachFetch';

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
}

export interface ReviewInstanceFormDefinition {
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
    signatures: Record<ReviewParticipantRole, boolean>;
    visibleTo: Record<ReviewParticipantRole, boolean>;
    recurrence: { interval: number; unit: string };
    notifications: Record<string, boolean>;
    allowEditingPriorDays: number;
  };
  sections: ReviewSectionDefinition[];
  signatures: Record<ReviewParticipantRole, ReviewSignatureState>;
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
  errors?: { fields?: string[]; signatures?: ReviewParticipantRole[] };
}

export async function completeReviewInstance(instanceId: string) {
  const response = await coachFetch(`${instanceUrl(instanceId)}/complete`, { method: 'POST' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as ReviewCompletionError;
    throw Object.assign(new Error(data.detail || 'This review cannot be completed yet.'), { errors: data.errors });
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
