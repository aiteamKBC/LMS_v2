import type { FeedbackAnswerValue, FeedbackPhotoAnswer, FeedbackSection } from './feedback';

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
  qrAttendance: Array<{ name: string; email: string; attendeeType: 'learner' | 'guest'; checkedInAt: string }>;
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

export type EventEmailPurpose = 'event_rsvp' | 'post_event';
export interface EventEmailCopy { templateId: number | null; subject: string; body: string; buttonText: string }
export interface EventEmailTemplate extends Omit<EventEmailCopy, 'templateId'> { id: number; name: string; purpose: EventEmailPurpose }

export interface EventRsvpCampaign {
  event: { id: number; title: string };
  form: { id: number; title: string } | null;
  recipients: Array<{
    id: number; name: string; email: string; learnerId: string | null;
    inviteStatus: 'pending' | 'sent' | 'failed';
    rsvpStatus: 'no_response' | 'yes' | 'no' | 'maybe';
    sentAt: string | null; respondedAt: string | null; error: string;
  }>;
}

export interface PublicEventRsvp {
  event: { id: number; title: string; date: string; time: string; location: string };
  recipient: { name: string };
  rsvpStatus: 'no_response' | 'yes' | 'no' | 'maybe';
  form: PublicEventForm;
  expiresAt: string;
}

export const eventFeedbackApi = {
  emailTemplates: async (purpose: EventEmailPurpose) => jsonResponse<{ templates: EventEmailTemplate[] }>(await fetch(`${BASE}/email-templates/?purpose=${purpose}`, { credentials: 'include' })),
  createEmailTemplate: async (input: { name: string; purpose: EventEmailPurpose; subject: string; body: string; buttonText: string }) => jsonResponse<{ template: EventEmailTemplate }>(await fetch(`${BASE}/email-templates/`, {
    method: 'POST', credentials: 'include',
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })),
  emailSetting: async (eventId: string, purpose: EventEmailPurpose) => jsonResponse<{ setting: EventEmailCopy }>(await fetch(`${BASE}/events/${eventId}/email-settings/${purpose}/`, { credentials: 'include' })),
  saveEmailSetting: async (eventId: string, purpose: EventEmailPurpose, setting: EventEmailCopy) => jsonResponse<{ setting: EventEmailCopy }>(await fetch(`${BASE}/events/${eventId}/email-settings/${purpose}/`, {
    method: 'PATCH', credentials: 'include',
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify(setting),
  })),
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
  prepareQrAttendance: async (eventId: string, formIds: number[]) => jsonResponse<{ recipientCount: number; formCount: number }>(await fetch(`${BASE}/events/${eventId}/campaign/`, {
    method: 'POST', credentials: 'include',
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'prepare', formIds }),
  })),
  sendInvitations: async (eventId: string, resendAll = false) => jsonResponse<{ attempted: number; sent: number; failed: number; remaining: number }>(await fetch(`${BASE}/events/${eventId}/campaign/`, {
    method: 'POST', credentials: 'include',
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify({ resendAll }),
  })),
  rsvpCampaign: async (eventId: string) => jsonResponse<EventRsvpCampaign>(await fetch(`${BASE}/events/${eventId}/rsvp/`, { credentials: 'include' })),
  configureRsvp: async (eventId: string, formId: number, learnerIds: string[], guests: Array<{ name: string; email: string }>, retryEmails: string[] = []) => jsonResponse<{ campaignId: number; recipientCount: number }>(await fetch(`${BASE}/events/${eventId}/rsvp/`, {
    method: 'POST', credentials: 'include',
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'configure', formId, learnerIds, guests, retryEmails }),
  })),
  sendRsvp: async (eventId: string, resendAll = false, pendingOnly = false) => jsonResponse<{ attempted: number; sent: number; failed: number; remaining: number }>(await fetch(`${BASE}/events/${eventId}/rsvp/`, {
    method: 'POST', credentials: 'include',
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'send', resendAll, pendingOnly }),
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
  publicRsvp: async (token: string) => jsonResponse<PublicEventRsvp>(await fetch(`${BASE}/public-rsvp/`, {
    method: 'POST', credentials: 'include',
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'read', token }),
  })),
  savePublicRsvp: async (token: string, rsvpStatus: 'yes' | 'no' | 'maybe', answers: Record<string, FeedbackAnswerValue>) => jsonResponse<{ rsvpStatus: 'yes' | 'no' | 'maybe'; response: { id: number; status: string; submittedAt: string | null } }>(await fetch(`${BASE}/public-rsvp/`, {
    method: 'POST', credentials: 'include',
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, rsvpStatus, answers }),
  })),
  uploadPublicRsvpPhoto: async (token: string, questionId: number, file: File): Promise<FeedbackPhotoAnswer> => {
    const formData = new FormData();
    formData.append('token', token);
    formData.append('questionId', String(questionId));
    formData.append('photo', file);
    const response = await fetch(`${BASE}/public-rsvp/photo/`, {
      method: 'POST', credentials: 'include', body: formData,
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': await csrfToken() },
    });
    const body = await response.json().catch(() => ({})) as { answer?: FeedbackPhotoAnswer; error?: string };
    if (!response.ok || !body.answer) throw new Error(body.error || `Upload failed (${response.status})`);
    return body.answer;
  },
  removePublicRsvpPhoto: async (token: string, uploadId: string): Promise<void> => {
    await jsonResponse<{ removed: boolean }>(await fetch(`${BASE}/public-rsvp/photo/remove/`, {
      method: 'POST', credentials: 'include',
      headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, uploadId }),
    }));
  },
  loadPublicRsvpPhoto: async (token: string, uploadId: string): Promise<Blob> => {
    const response = await fetch(`${BASE}/public-rsvp/uploads/${encodeURIComponent(uploadId)}/`, {
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-Event-Response-Token': token },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || `Photo could not be loaded (${response.status})`);
    }
    return response.blob();
  },
};
