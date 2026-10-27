export type FeedbackFormStatus = 'draft' | 'published' | 'closed';
export type FeedbackFormType = 'general' | 'post_lecture' | 'post_event' | 'event_rsvp' | 'post_mcm_review' | 'post_progress_review' | 'mid_module' | 'end_module';
export type FeedbackDeliveryScope = 'manual' | 'all_modules' | 'module';
export type FeedbackQuestionType = 'short_text' | 'long_text' | 'yes_no' | 'single_choice' | 'multiple_choice' | 'dropdown' | 'rating' | 'likert' | 'number' | 'date' | 'name' | 'email' | 'photo_upload';
export interface FeedbackNameAnswer { firstName: string; lastName: string }
export interface FeedbackPhotoAnswer { uploadId: string; filename: string }
export type FeedbackAnswerValue = string | number | boolean | string[] | FeedbackNameAnswer | FeedbackPhotoAnswer | null;
export type FeedbackImportance = 'critical' | 'high' | 'medium' | 'low';
export interface FeedbackQuestionAnalyticsSettings {
  importance?: FeedbackImportance;
  scoring?: 'higher' | 'lower' | 'options' | 'none';
  includeInOverall?: boolean;
  optionScores?: Record<string, number>;
  scoreMin?: number;
  scoreMax?: number;
}

export interface FeedbackQuestion {
  id?: number;
  type: FeedbackQuestionType;
  text: string;
  required: boolean;
  helpText: string;
  config: {
    options?: string[];
    min?: number;
    max?: number;
    minLabel?: string;
    maxLabel?: string;
    display?: 'stars' | 'numbers';
    labels?: string[];
    analytics?: FeedbackQuestionAnalyticsSettings;
  };
  sortOrder?: number;
  answer?: FeedbackAnswerValue;
}

export interface FeedbackSection {
  id?: number;
  title: string;
  icon?: string;
  description: string;
  questionsPerDelivery?: number | null;
  sortOrder?: number;
  questions: FeedbackQuestion[];
}

export interface FeedbackForm {
  id: number;
  title: string;
  formType: FeedbackFormType;
  deliveryScope: FeedbackDeliveryScope;
  templateKey: string;
  version: number;
  isCurrent: boolean;
  previousVersionId: number | null;
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
  willCreateVersion: boolean;
  sections?: FeedbackSection[];
  response?: { id: number | null; status: LearnerFeedbackStatus; answers: Record<string, FeedbackAnswerValue>; submittedAt: string | null };
  delivery?: { id: number; occurrenceKey: string; sessionTitle: string; startsAt: string | null; endsAt: string | null } | null;
  reviewDelivery?: { id: number; reviewType: string; reviewName: string; completedAt: string } | null;
}

export interface FeedbackFormVersion {
  id: number;
  title: string;
  version: number;
  isCurrent: boolean;
  previousVersionId: number | null;
  status: FeedbackFormStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  deliveryCount: number;
  assignedCount: number;
  startedCount: number;
  responseCount: number;
}

export interface FeedbackFormInput {
  title: string;
  formType: FeedbackFormType;
  deliveryScope: FeedbackDeliveryScope;
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
  deliveryId: number | null; sessionTitle: string; sessionStartsAt: string | null;
  formType: FeedbackFormType; moduleName: string;
  eventRecipientId?: number | null;
  reviewDeliveryId?: number | null;
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
  ratingAverages: { questionId: number; question: string; average: number; responses: number; min?: number; max?: number }[];
  questionMetrics?: FeedbackQuestionMetric[];
  overallScore?: { score: number | null; scoredQuestions: number; includedQuestions: number };
  lectures?: FeedbackAnalyticsLecture[];
  insights?: FeedbackReportInsights;
}

export interface FeedbackReportInsights {
  classification?: FeedbackClassificationReport;
  stars: { average: number | null; answers: number; distribution: { stars: number; count: number }[] };
  categories: { formId: number; formTitle: string; version: number; category: string; score: number | null; scoredQuestions: number; includedQuestions: number; scoredAnswers: number }[];
  trend: { month: string; score: number | null; scoredQuestions: number; includedQuestions: number; scoredAnswers: number }[];
  undatedScoredAnswers: number;
}

export type FeedbackScoreClass = 'positive' | 'neutral' | 'negative' | 'unscored';
export interface FeedbackClassCounts { positive: number; neutral: number; negative: number; unscored: number }
export interface FeedbackClassificationReport extends FeedbackClassCounts {
  total: number;
  byType: (FeedbackClassCounts & { formType: FeedbackFormType })[];
  trend: (FeedbackClassCounts & { month: string })[];
  responses: { responseId: number; formId: number; formTitle: string; formType: FeedbackFormType; version: number; respondent: string; score: number | null; classification: FeedbackScoreClass; scoredQuestions: number; submittedAt: string | null; contextTitle?: string; groupName?: string }[];
}

export interface FeedbackDashboardReport extends FeedbackQuestionReport {
  groups: { id: string; name: string }[];
  modules?: { id: string; name: string }[];
  coverage: { assigned: number | null; submitted: number; rate: number | null };
}
export interface FeedbackDashboardFilters {
  formType?: FeedbackFormType; groupId?: string; moduleId?: string; classification?: FeedbackScoreClass;
  submittedFrom?: string; submittedTo?: string;
}

export interface FeedbackAnalyticsLecture {
  deliveryId: number; moduleId: string; moduleName: string; sessionTitle: string;
  occurrenceKey: string; startsAt: string; cohortName: string; groupName: string;
  formTitle: string; version: number;
}
export interface FeedbackQuestionReport {
  questionMetrics: FeedbackQuestionMetric[];
  overallScore: NonNullable<FeedbackAnalyticsData['overallScore']>;
  selectionPending?: boolean;
  insights?: FeedbackReportInsights;
}
export interface FeedbackAnalyticsFilters { formId?: number; formType?: FeedbackFormType }

export interface FeedbackQuestionMetric {
  classification?: FeedbackClassCounts;
  questionId: number; question: string; type: FeedbackQuestionType;
  formId: number; formTitle: string; version: number; category: string;
  importance: FeedbackImportance; weight: number; includedInOverall: boolean;
  assignedCount: number | null; answeredCount: number; answerRate: number | null;
  score: number | null; scoredResponses: number;
  status: 'good' | 'watch' | 'needs_attention' | 'no_data' | 'not_scored';
  averageRating: number | null; scaleMax: number | null;
  distribution: { label: string; count: number }[];
}

export interface FeedbackLearnerOption { id: string; name: string; email: string; programme: string; cohort: string }
export interface FeedbackRecipient {
  key: string; learnerId: string; learnerName: string; email: string; programme: string;
  source: 'manual' | 'attendance' | 'module_assignment' | 'event_attendance' | 'completed_review'; deliveryId: number | null; occurrenceKey: string;
  sourceKey: string; sourceType: 'manual' | 'lecture' | 'event' | string;
  sourceLabel: string; sourceTitle: string; sourceSubtitle: string; sourceStartsAt: string | null;
  sessionTitle: string; sessionStartsAt: string | null; moduleName: string;
  assignedAt: string | null; dueDate: string | null;
  responseStatus: LearnerFeedbackStatus; formVersion: number; recipientType?: 'learner' | 'guest';
}
export interface FeedbackAssignmentSource {
  key: string; type: 'manual' | 'lecture' | 'event' | string; label: string;
  title: string; subtitle: string; startsAt: string | null;
  assignedCount: number; responseCount: number;
}
export interface FeedbackLectureOption {
  deliveryId: number; occurrenceKey: string; sessionTitle: string; moduleName: string;
  startsAt: string | null; assignedCount: number; responseCount: number;
}

function learnerPreviewQuery(learnerId?: string | number | null): string {
  return learnerId == null || learnerId === '' ? '' : `?learnerId=${encodeURIComponent(String(learnerId))}`;
}

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
  versions: (id: number) => request<{ versions: FeedbackFormVersion[] }>(`/forms/${id}/versions/`),
  createForm: (input: FeedbackFormInput) => request<{ form: FeedbackForm }>('/forms/', { method: 'POST', body: JSON.stringify(input) }),
  updateForm: (id: number, input: Partial<FeedbackFormInput>) => request<{ form: FeedbackForm }>(`/forms/${id}/`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteForm: (id: number) => request<{ ok: true }>(`/forms/${id}/`, { method: 'DELETE' }),
  setStatus: (id: number, status: FeedbackFormStatus) => request<{ form: FeedbackForm }>(`/forms/${id}/status/`, { method: 'POST', body: JSON.stringify({ status }) }),
  duplicateForm: (id: number) => request<{ form: FeedbackForm }>(`/forms/${id}/duplicate/`, { method: 'POST' }),
  learners: (search = '') => request<{ learners: FeedbackLearnerOption[] }>(`/learners/?search=${encodeURIComponent(search)}`),
  assign: (id: number, targetType: 'all_learners' | 'learner', targetIds: string[], dueDate?: string | null) => request(`/forms/${id}/assignments/`, { method: 'POST', body: JSON.stringify({ targetType, targetIds, dueDate }) }),
  recipients: (id: number, search = '', page = 1, pageSize = 50, sourceKey?: string) => {
    const params = new URLSearchParams({ search, page: String(page), pageSize: String(pageSize) });
    if (sourceKey) params.set('source', sourceKey);
    return request<{ recipients: FeedbackRecipient[]; sources: FeedbackAssignmentSource[]; lectures: FeedbackLectureOption[]; total: number; page: number; pageSize: number }>(`/forms/${id}/recipients/?${params}`);
  },
  responses: (filters?: { formId?: number; status?: string; learner?: string }) => {
    const params = new URLSearchParams();
    if (filters?.formId) params.set('formId', String(filters.formId));
    if (filters?.status) params.set('status', filters.status);
    if (filters?.learner) params.set('learner', filters.learner);
    return request<{ responses: FeedbackResponse[] }>(`/responses/?${params}`);
  },
  response: (id: number) => request<{ response: FeedbackResponse }>(`/responses/${id}/`),
  analytics: (filters?: { formId?: number; formType?: FeedbackFormType }) => {
    const params = new URLSearchParams();
    if (filters?.formId) params.set('formId', String(filters.formId));
    if (filters?.formType) params.set('formType', filters.formType);
    const query = params.toString();
    return request<{ analytics: FeedbackAnalyticsData }>(`/analytics/${query ? `?${query}` : ''}`);
  },
  questionAnalytics: (filters: FeedbackAnalyticsFilters & { moduleId?: string; deliveryId?: number; submittedFrom?: string; submittedTo?: string }) => {
    const params = new URLSearchParams();
    if (filters.formId) params.set('formId', String(filters.formId));
    if (filters.formType) params.set('formType', filters.formType);
    if (filters.moduleId) params.set('moduleId', filters.moduleId);
    if (filters.deliveryId) params.set('deliveryId', String(filters.deliveryId));
    if (filters.submittedFrom) params.set('submittedFrom', filters.submittedFrom);
    if (filters.submittedTo) params.set('submittedTo', filters.submittedTo);
    return request<{ analytics: FeedbackQuestionReport }>(`/analytics/questions/?${params}`);
  },
  insightsDashboard: (filters: FeedbackDashboardFilters) => {
    const params = new URLSearchParams();
    for (const key of ['formType', 'groupId', 'moduleId', 'classification', 'submittedFrom', 'submittedTo'] as const) {
      if (filters[key]) params.set(key, filters[key]);
    }
    return request<{ analytics: FeedbackDashboardReport }>(`/analytics/insights/?${params}`);
  },
  myForms: (learnerId?: string | number | null) => request<{ forms: LearnerFeedbackListItem[] }>(`/my-forms/${learnerPreviewQuery(learnerId)}`),
  myForm: (id: number, learnerId?: string | number | null) => request<{ form: FeedbackForm }>(`/my-forms/${id}/${learnerPreviewQuery(learnerId)}`),
  myDelivery: (id: number, learnerId?: string | number | null) => request<{ form: FeedbackForm }>(`/my-deliveries/${id}/${learnerPreviewQuery(learnerId)}`),
  myReviewDelivery: (id: number, learnerId?: string | number | null) => request<{ form: FeedbackForm }>(`/my-review-deliveries/${id}/${learnerPreviewQuery(learnerId)}`),
  myEventForm: (recipientId: number, formId: number, learnerId?: string | number | null) => request<{ form: FeedbackForm }>(`/my-event-recipients/${recipientId}/forms/${formId}/${learnerPreviewQuery(learnerId)}`),
  saveResponse: (id: number, answers: Record<string, FeedbackAnswerValue>, submit = false) => request<{ response: { id: number; status: string; submittedAt: string | null; updatedAt: string } }>(`/my-forms/${id}/response/`, { method: 'POST', body: JSON.stringify({ answers, submit }) }),
  saveDeliveryResponse: (id: number, answers: Record<string, FeedbackAnswerValue>, submit = false) => request<{ response: { id: number; status: string; submittedAt: string | null; updatedAt: string } }>(`/my-deliveries/${id}/response/`, { method: 'POST', body: JSON.stringify({ answers, submit }) }),
  saveReviewDeliveryResponse: (id: number, answers: Record<string, FeedbackAnswerValue>, submit = false) => request<{ response: { id: number; status: string; submittedAt: string | null; updatedAt: string } }>(`/my-review-deliveries/${id}/response/`, { method: 'POST', body: JSON.stringify({ answers, submit }) }),
  saveEventResponse: (recipientId: number, formId: number, answers: Record<string, FeedbackAnswerValue>, submit = false) => request<{ response: { id: number; status: string; submittedAt: string | null; updatedAt: string } }>(`/my-event-recipients/${recipientId}/forms/${formId}/response/`, { method: 'POST', body: JSON.stringify({ answers, submit }) }),
  uploadPhoto: async (formId: number, questionId: number, file: File, deliveryId?: number, reviewDeliveryId?: number): Promise<FeedbackPhotoAnswer> => {
    const formData = new FormData();
    formData.append('photo', file);
    const path = reviewDeliveryId
      ? `/my-review-deliveries/${reviewDeliveryId}/questions/${questionId}/photo/`
      : deliveryId ? `/my-deliveries/${deliveryId}/questions/${questionId}/photo/` : `/my-forms/${formId}/questions/${questionId}/photo/`;
    const response = await fetch(`${BASE}${path}`, {
      method: 'POST', credentials: 'include', body: formData,
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': await csrfToken() },
    });
    const body = await response.json().catch(() => ({})) as { answer?: FeedbackPhotoAnswer; error?: string };
    if (!response.ok || !body.answer) throw new Error(body.error || `Upload failed (${response.status})`);
    return body.answer;
  },
};

export const feedbackUploadUrl = (uploadId: string) => `${BASE}/uploads/${encodeURIComponent(uploadId)}/`;
