import type { FeedbackAnswerValue, FeedbackSection } from './feedback';

const BASE = '/engagement_api/feedback';
let csrfPromise: Promise<string> | null = null;

async function csrfToken() {
  if (!csrfPromise) {
    csrfPromise = fetch(`${BASE}/public-event/csrf/`, { credentials: 'include' })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as { csrfToken?: string; error?: string };
        if (!response.ok || !body.csrfToken) throw new Error(body.error || 'Unable to initialise request verification.');
        return body.csrfToken;
      })
      .catch(error => { csrfPromise = null; throw error; });
  }
  return csrfPromise;
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

export interface EventAttendancePreview {
  presentCount: number;
  ignoredCount: number;
  errors: Array<{ row: number; error: string }>;
  attendees: Array<{ row: number; name: string; email: string }>;
  attendeePreviewTruncated: boolean;
}

export interface EventFeedbackCampaign {
  event: { id: number; title: string };
  forms: Array<{ id: number; title: string; status: string }>;
  recipients: Array<{ id: number; name: string; email: string; learnerId: string | null; inviteStatus: 'pending' | 'sent' | 'failed'; sentAt: string | null; error: string }>;
}

export interface PublicEventForm {
  id: number;
  title: string;
  description: string;
  instructions: string;
  allowSaveContinue: boolean;
  allowEditAfterSubmission: boolean;
  sections: FeedbackSection[];
  response: { id: number | null; status: 'not_started' | 'in_progress' | 'completed'; answers: Record<string, FeedbackAnswerValue>; submittedAt: string | null };
}

export interface PublicEventFeedback {
  event: { id: number; title: string; date: string; location: string };
  recipient: { name: string };
  forms: PublicEventForm[];
  expiresAt: string;
}

export const eventFeedbackApi = {
  previewAttendance: async (eventId: string, file: File) => {
    const data = new FormData(); data.append('file', file); data.append('preview', 'true');
    return jsonResponse<{ preview: EventAttendancePreview }>(await fetch(`${BASE}/events/${eventId}/attendance-import/`, {
      method: 'POST', credentials: 'include', body: data,
      headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest' },
    }));
  },
  importAttendance: async (eventId: string, file: File, formIds: number[]) => {
    const data = new FormData(); data.append('file', file); data.append('preview', 'false'); data.append('formIds', JSON.stringify(formIds));
    return jsonResponse<{ recipientCount: number; formCount: number }>(await fetch(`${BASE}/events/${eventId}/attendance-import/`, {
      method: 'POST', credentials: 'include', body: data,
      headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest' },
    }));
  },
  campaign: async (eventId: string) => jsonResponse<EventFeedbackCampaign>(await fetch(`${BASE}/events/${eventId}/campaign/`, { credentials: 'include' })),
  sendInvitations: async (eventId: string, resendAll = false) => jsonResponse<{ attempted: number; sent: number; failed: number; remaining: number }>(await fetch(`${BASE}/events/${eventId}/campaign/`, {
    method: 'POST', credentials: 'include',
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify({ resendAll }),
  })),
  publicAccess: async (token: string) => jsonResponse<PublicEventFeedback>(await fetch(`${BASE}/public-event/`, {
    method: 'POST', credentials: 'include',
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'read', token }),
  })),
  savePublicResponse: async (token: string, formId: number, answers: Record<string, FeedbackAnswerValue>, submit: boolean) => jsonResponse<{ response: { id: number; status: string; submittedAt: string | null } }>(await fetch(`${BASE}/public-event/`, {
    method: 'POST', credentials: 'include',
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, formId, answers, submit }),
  })),
};
