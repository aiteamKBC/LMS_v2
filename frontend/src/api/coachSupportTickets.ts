import { coachFetch } from '@/lib/coachFetch';

const BASE = '/coach_api/coach/support-tickets';

export interface SupportTicketNote {
  id: string;
  type: 'activity' | 'note';
  note: string;
  createdAt: string | null;
  createdBy: string;
}

export interface SupportTicketEvidence {
  id: string;
  fileName: string;
  mimeType: string;
  description: string;
  /** Link into the Inclusion admin site; empty when the file has none. */
  url: string;
  createdAt: string | null;
  createdBy: string;
}

export interface SupportTicket {
  id: number;
  ticketType: string;
  subject: string;
  details: string;
  urgency: string;
  preferredContact: string;
  status: string;
  statusLabel: string;
  assignedOwner: string;
  daysToClose: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  notes: SupportTicketNote[];
  evidence: SupportTicketEvidence[];
  /** Wellbeing tickets only, and never under admin view-as. */
  canChangeStatus: boolean;
  canAddNote: boolean;
}

export interface SupportTicketLearner {
  learnerId: number;
  name: string;
  email: string;
  programme: string;
  cohort: string;
  group: string;
  openTickets: number;
  tickets: SupportTicket[];
}

export interface SupportTicketStatusOption {
  value: string;
  label: string;
}

export interface CoachSupportTicketsResponse {
  learners: SupportTicketLearner[];
  statuses: SupportTicketStatusOption[];
  readOnly: boolean;
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Unexpected response (${response.status}).`);
  }
  if (!response.ok) {
    const body = (data && typeof data === 'object' ? data : {}) as { message?: string; error?: string; fields?: Record<string, string[]> };
    const fieldMessage = body.fields ? Object.values(body.fields).flat()[0] : '';
    throw new Error(body.message || fieldMessage || `Request failed (${response.status}).`);
  }
  return data as T;
}

export async function fetchCoachSupportTickets(signal?: AbortSignal): Promise<CoachSupportTicketsResponse> {
  return parse(await coachFetch(BASE, { signal }));
}

export async function updateSupportTicketStatus(ticketId: number, status: string, expectedStatus: string): Promise<SupportTicket> {
  const response = await coachFetch(`${BASE}/${ticketId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, expectedStatus }),
  });
  return (await parse<{ ticket: SupportTicket }>(response)).ticket;
}

export async function addSupportTicketNote(ticketId: number, note: string): Promise<SupportTicket> {
  const response = await coachFetch(`${BASE}/${ticketId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });
  return (await parse<{ ticket: SupportTicket }>(response)).ticket;
}

export interface WellbeingReportAnswer {
  id: string;
  question: string;
  category: string;
  construct: string;
  learnerAnswer: number | null;
  /** 0–maxScore, higher means more concern (reverse-scored questions already flipped). */
  concernScore: number | null;
  maxScore: number;
  reverseScored: boolean;
  /** 'high' = High concern, 'medium' = Follow-up, null = not flagged. */
  flag: 'high' | 'medium' | null;
  whyFlagged: string;
}

export interface WellbeingReport {
  available: true;
  submittedAt: string | null;
  riskLevel: string;
  triggerCount: number;
  scores: { key: string; label: string; value: number | null }[];
  patterns: string[];
  counts: { riskFlags: number; high: number; medium: number; answers: number };
  answers: WellbeingReportAnswer[];
}

export type WellbeingReportResponse = WellbeingReport | { available: false };

export async function fetchSupportTicketWellbeingReport(ticketId: number, signal?: AbortSignal): Promise<WellbeingReportResponse> {
  const response = await coachFetch(`${BASE}/${ticketId}/wellbeing-report`, { signal });
  return (await parse<{ report: WellbeingReportResponse }>(response)).report;
}
