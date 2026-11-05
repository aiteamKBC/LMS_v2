import type { FeedbackAnswerValue, FeedbackPhotoAnswer, FeedbackSection } from './feedback';

const BASE = '/engagement_api/feedback/public-lecture';
let csrfPromise: Promise<string> | null = null;

async function csrfToken(): Promise<string> {
  if (!csrfPromise) {
    csrfPromise = fetch(`${BASE}/csrf/`, { credentials: 'include' })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as { csrfToken?: string; error?: string };
        if (!response.ok || !body.csrfToken) throw new Error(body.error || 'Unable to initialise request verification.');
        return body.csrfToken;
      }).catch(error => { csrfPromise = null; throw error; });
  }
  return csrfPromise;
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

async function post<T>(path: string, data: object): Promise<T> {
  return jsonResponse<T>(await fetch(`${BASE}/${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }));
}

export interface PublicLectureForm {
  id: number; title: string; description: string; instructions: string;
  allowSaveContinue: boolean; allowEditAfterSubmission: boolean;
  sections: FeedbackSection[];
  response: { id: number | null; status: string; answers: Record<string, FeedbackAnswerValue>; submittedAt: string | null };
}

export interface PublicLectureFeedback {
  lecture: { title: string; moduleName: string; startsAt: string | null };
  learner: { name: string };
  form: PublicLectureForm;
}

export const lecturePublicFeedbackApi = {
  discover: (email: string) => post<{ token: string }>('', { action: 'discover', email }),
  read: (token: string, email: string) => post<PublicLectureFeedback>('', { action: 'read', token, email }),
  save: (token: string, email: string, answers: Record<string, FeedbackAnswerValue>, submit: boolean) =>
    post<{ response: { id: number; status: string; submittedAt: string | null } }>('', { action: 'save', token, email, answers, submit }),
  uploadPhoto: async (token: string, email: string, questionId: number, file: File): Promise<FeedbackPhotoAnswer> => {
    const data = new FormData();
    data.append('token', token); data.append('email', email); data.append('questionId', String(questionId)); data.append('photo', file);
    const result = await jsonResponse<{ answer: FeedbackPhotoAnswer }>(await fetch(`${BASE}/photo/`, {
      method: 'POST', credentials: 'include', body: data,
      headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest' },
    }));
    return result.answer;
  },
  removePhoto: (token: string, email: string, uploadId: string) => post<{ removed: boolean }>('photo/remove/', { token, email, uploadId }).then(() => undefined),
  loadPhoto: async (token: string, email: string, uploadId: string): Promise<Blob> => {
    const response = await fetch(`${BASE}/uploads/${encodeURIComponent(uploadId)}/`, {
      credentials: 'include',
      headers: { 'X-Lecture-Feedback-Token': token, 'X-Lecture-Feedback-Email': email, 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || `Photo could not be loaded (${response.status})`);
    }
    return response.blob();
  },
};
