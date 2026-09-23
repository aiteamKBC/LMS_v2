export type FeedbackFormStatus = 'draft' | 'published' | 'closed';
export type FeedbackFormType = 'general' | 'post_lecture';
export type FeedbackQuestionType = 'short_text' | 'long_text' | 'yes_no' | 'single_choice' | 'multiple_choice' | 'dropdown' | 'rating' | 'likert' | 'number' | 'date' | 'name' | 'email' | 'photo_upload';
export interface FeedbackNameAnswer { firstName: string; lastName: string }
export interface FeedbackPhotoAnswer { uploadId: string; filename: string }
export type FeedbackAnswerValue = string | number | boolean | string[] | FeedbackNameAnswer | FeedbackPhotoAnswer | null;

export interface FeedbackQuestion {
  id?: number;
  type: FeedbackQuestionType;
  text: string;
  required: boolean;
  helpText: string;
  config: { options?: string[]; min?: number; max?: number; minLabel?: string; maxLabel?: string };
  sortOrder?: number;
  answer?: FeedbackAnswerValue;
}

export interface FeedbackSection {
  id?: number;
  title: string;
  description: string;
  sortOrder?: number;
  questions: FeedbackQuestion[];
}

export interface FeedbackForm {
  id: number;
  title: string;
  formType: FeedbackFormType;
  curriculumScope: FeedbackCurriculumScope;
  description: string;
  instructions: string;
  status: FeedbackFormStatus;
  startDate: string | null;
  dueDate: string | null;
  anonymousResponses: boolean;
  allowSaveContinue: boolean;
  allowEditAfterSubmission: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  assignedCount: number;
  responseCount: number;
  startedCount: number;
  structureLocked: boolean;
  sections?: FeedbackSection[];
  response?: { id: number | null; status: LearnerFeedbackStatus; answers: Record<string, FeedbackAnswerValue>; submittedAt: string | null };
}

export interface FeedbackFormInput {
  title: string;
  formType: FeedbackFormType;
  programmeId: string;
  cohortId: string;
  groupId: string;
  moduleCatalogueId: string;
  description: string;
  instructions: string;
  startDate: string | null;
  dueDate: string | null;
  anonymousResponses: boolean;
  allowSaveContinue: boolean;
  allowEditAfterSubmission: boolean;
  sections: FeedbackSection[];
}

export interface FeedbackCurriculumScope {
  programmeId: string; programmeName: string;
  cohortId: string; cohortName: string;
  groupId: string; groupName: string;
  moduleCatalogueId: string; moduleName: string;
}

export interface FeedbackCurriculumOptions {
  programmes: Array<{ id: string; name: string }>;
  cohorts: Array<{ id: string; name: string; programmeId: string }>;
  groups: Array<{ id: string; name: string; programmeId: string; cohortId: string }>;
  modules: Array<{ id: string; name: string; programmeId: string; cohortId: string; groupId: string }>;
}

export type LearnerFeedbackStatus = 'not_started' | 'in_progress' | 'completed';
export interface LearnerFeedbackListItem {
  id: number; title: string; description: string; assignedAt: string | null;
  dueDate: string | null; status: LearnerFeedbackStatus; responseId: number | null;
}

export interface FeedbackResponse {
  id: number; formId: number; formTitle: string; learnerId: string | null;
  learnerName: string; programme: string; status: 'in_progress' | 'completed';
  startedAt: string; updatedAt: string; submittedAt: string | null;
  sections?: FeedbackSection[];
}

export interface FeedbackAnalyticsData {
  totalAssigned: number; notStarted: number; inProgress: number; completed: number;
  completionRate: number;
  ratingAverages: { questionId: number; question: string; average: number; responses: number }[];
}

export interface FeedbackLearnerOption { id: string; name: string; email: string; programme: string; cohort: string }

const BASE = '/engagement_api/feedback';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
let csrfPromise: Promise<string> | null = null;

async function csrfToken(): Promise<string> {
  if (!csrfPromise) {
    csrfPromise = fetch(`${BASE}/csrf/`, { credentials: 'include' })
      .then(async response => {
        const payload = await response.json().catch(() => ({})) as { csrfToken?: string; error?: string };
        if (!response.ok || !payload.csrfToken) throw new Error(payload.error || 'Unable to initialise request verification.');
        return payload.csrfToken;
      })
      .catch(error => { csrfPromise = null; throw error; });
  }
  return csrfPromise;
}

async function request<T>(path: string, init?: globalThis.RequestInit, timeoutMs?: number): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const csrf = UNSAFE_METHODS.has(method) ? await csrfToken() : null;
  const controller = timeoutMs ? new AbortController() : null;
  const timeout = controller ? globalThis.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`${BASE}${path}`, {
      credentials: 'include', ...init,
      signal: controller?.signal || init?.signal,
      headers: {
        'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest',
        ...(csrf ? { 'X-CSRFToken': csrf } : {}), ...(init?.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body as T;
  } catch (error) {
    if (controller?.signal.aborted) throw new Error('Curriculum options took too long to load. Please try again.');
    throw error;
  } finally {
    if (timeout !== null) globalThis.clearTimeout(timeout);
  }
}

export const feedbackApi = {
  curriculumOptions: () => request<FeedbackCurriculumOptions>('/curriculum-options/', undefined, 15000),
  listForms: () => request<{ forms: FeedbackForm[]; summary: { totalForms: number; publishedForms: number; draftForms: number; totalResponses: number } }>('/forms/'),
  getForm: (id: number) => request<{ form: FeedbackForm }>(`/forms/${id}/`),
  createForm: (input: FeedbackFormInput) => request<{ form: FeedbackForm }>('/forms/', { method: 'POST', body: JSON.stringify(input) }),
  updateForm: (id: number, input: Partial<FeedbackFormInput>) => request<{ form: FeedbackForm }>(`/forms/${id}/`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteForm: (id: number) => request<{ ok: true }>(`/forms/${id}/`, { method: 'DELETE' }),
  setStatus: (id: number, status: FeedbackFormStatus) => request<{ form: FeedbackForm }>(`/forms/${id}/status/`, { method: 'POST', body: JSON.stringify({ status }) }),
  duplicateForm: (id: number) => request<{ form: FeedbackForm }>(`/forms/${id}/duplicate/`, { method: 'POST' }),
  learners: (search = '') => request<{ learners: FeedbackLearnerOption[] }>(`/learners/?search=${encodeURIComponent(search)}`),
  assign: (id: number, targetType: 'all_learners' | 'learner', targetIds: string[], dueDate?: string | null) => request(`/forms/${id}/assignments/`, { method: 'POST', body: JSON.stringify({ targetType, targetIds, dueDate }) }),
  responses: (filters?: { formId?: number; status?: string; learner?: string }) => {
    const params = new URLSearchParams();
    if (filters?.formId) params.set('formId', String(filters.formId));
    if (filters?.status) params.set('status', filters.status);
    if (filters?.learner) params.set('learner', filters.learner);
    return request<{ responses: FeedbackResponse[] }>(`/responses/?${params}`);
  },
  response: (id: number) => request<{ response: FeedbackResponse }>(`/responses/${id}/`),
  analytics: (formId?: number) => request<{ analytics: FeedbackAnalyticsData }>(`/analytics/${formId ? `?formId=${formId}` : ''}`),
  myForms: () => request<{ forms: LearnerFeedbackListItem[] }>('/my-forms/'),
  myForm: (id: number) => request<{ form: FeedbackForm }>(`/my-forms/${id}/`),
  saveResponse: (id: number, answers: Record<string, FeedbackAnswerValue>, submit = false) => request<{ response: { id: number; status: string; submittedAt: string | null; updatedAt: string } }>(`/my-forms/${id}/response/`, { method: 'POST', body: JSON.stringify({ answers, submit }) }),
  uploadPhoto: async (formId: number, questionId: number, file: File): Promise<FeedbackPhotoAnswer> => {
    const formData = new FormData();
    formData.append('photo', file);
    const response = await fetch(`${BASE}/my-forms/${formId}/questions/${questionId}/photo/`, {
      method: 'POST', credentials: 'include', body: formData,
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': await csrfToken() },
    });
    const body = await response.json().catch(() => ({})) as { answer?: FeedbackPhotoAnswer; error?: string };
    if (!response.ok || !body.answer) throw new Error(body.error || `Upload failed (${response.status})`);
    return body.answer;
  },
};

export const feedbackUploadUrl = (uploadId: string) => `${BASE}/uploads/${encodeURIComponent(uploadId)}/`;
