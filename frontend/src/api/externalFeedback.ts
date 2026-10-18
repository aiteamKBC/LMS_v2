import type { FeedbackAnswerValue, FeedbackSection } from './feedback';

const BASE = '/engagement_api/feedback';
let csrfPromise: Promise<string> | null = null;

async function csrfToken() {
  if (!csrfPromise) {
    csrfPromise = fetch(`${BASE}/public-session/csrf/`, { credentials: 'include' }).then(async response => {
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

export type ExternalCampaignType = 'information_session' | 'commitment_meeting';
export type ExternalRecipientStatus = 'pending' | 'sent' | 'opened' | 'submitted' | 'failed';
export interface RecipientPreviewRow { row: number; name: string; email: string; missing?: string }
export interface RecipientPreview {
  valid: RecipientPreviewRow[];
  invalidEmails: RecipientPreviewRow[];
  missingRows: RecipientPreviewRow[];
  duplicates: RecipientPreviewRow[];
  counts: { valid: number; invalidEmails: number; missingRows: number; duplicates: number };
  truncated: boolean;
}
export interface ExternalCampaign {
  id: number; campaignType: ExternalCampaignType; name: string; sessionDate: string;
  status: 'draft' | 'open' | 'closed';
  form: { id: number; title: string; version: number; formType: ExternalCampaignType };
  recipientCount: number;
  counts: Record<ExternalRecipientStatus, number>;
  createdBy: string; createdAt: string; updatedAt: string;
  recipients?: Array<{ id: number; name: string; email: string; status: ExternalRecipientStatus; sentAt: string | null; openedAt: string | null; submittedAt: string | null; error: string; responseId: number | null }>;
}
export interface PublicExternalFeedback {
  campaign: { id: number; campaignType: ExternalCampaignType; name: string; sessionDate: string };
  recipient: { name: string };
  form: { id: number; title: string; description: string; instructions: string; sections: FeedbackSection[]; response: { id: number | null; status: 'not_started' | 'completed'; answers: Record<string, FeedbackAnswerValue>; submittedAt: string | null } };
  expiresAt: string;
}

type CampaignInput = { campaignType: ExternalCampaignType; name: string; sessionDate: string; formId: number };
type DeliveryResult = { attempted: number; sent: number; failed: number; remaining: number };

function campaignFormData(input: CampaignInput & { file?: File; manualRecipients?: string; preview: boolean }) {
  const data = new FormData();
  data.append('campaignType', input.campaignType); data.append('name', input.name);
  data.append('sessionDate', input.sessionDate); data.append('formId', String(input.formId));
  if (input.file) data.append('file', input.file);
  if (input.manualRecipients) data.append('manualRecipients', input.manualRecipients);
  data.append('preview', String(input.preview));
  return data;
}

export const externalFeedbackApi = {
  list: async (type?: ExternalCampaignType) => jsonResponse<{ campaigns: ExternalCampaign[] }>(await fetch(`${BASE}/external-campaigns/${type ? `?type=${type}` : ''}`, { credentials: 'include' })),
  detail: async (id: number) => jsonResponse<{ campaign: ExternalCampaign }>(await fetch(`${BASE}/external-campaigns/${id}/`, { credentials: 'include' })),
  preview: async (input: { campaignType: ExternalCampaignType; name: string; sessionDate: string; formId: number; file: File }) => jsonResponse<{ preview: RecipientPreview }>(await fetch(`${BASE}/external-campaigns/`, {
    method: 'POST', credentials: 'include', body: campaignFormData({ ...input, preview: true }),
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest' },
  })),
  create: async (input: { campaignType: ExternalCampaignType; name: string; sessionDate: string; formId: number; file: File }) => jsonResponse<{ campaign: ExternalCampaign; preview: RecipientPreview }>(await fetch(`${BASE}/external-campaigns/`, {
    method: 'POST', credentials: 'include', body: campaignFormData({ ...input, preview: false }),
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest' },
  })),
  createManual: async (input: CampaignInput & { manualRecipients: string }) => jsonResponse<{ campaign: ExternalCampaign; preview: RecipientPreview; delivery: DeliveryResult }>(await fetch(`${BASE}/external-campaigns/`, {
    method: 'POST', credentials: 'include', body: campaignFormData({ ...input, preview: false }),
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest' },
  })),
  send: async (id: number, recipientIds?: number[]) => jsonResponse<DeliveryResult>(await fetch(`${BASE}/external-campaigns/${id}/`, {
    method: 'POST', credentials: 'include',
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'send', recipientIds }),
  })),
  publicAccess: async (token: string) => jsonResponse<PublicExternalFeedback>(await fetch(`${BASE}/public-session/`, {
    method: 'POST', credentials: 'include',
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'read', token }),
  })),
  submit: async (token: string, answers: Record<string, FeedbackAnswerValue>) => jsonResponse<{ response: { id: number; status: string; submittedAt: string } }>(await fetch(`${BASE}/public-session/`, {
    method: 'POST', credentials: 'include',
    headers: { 'X-CSRFToken': await csrfToken(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, answers }),
  })),
};
