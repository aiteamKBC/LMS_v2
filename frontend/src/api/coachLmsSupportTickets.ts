import { coachFetch } from '@/lib/coachFetch';
import { withCoachViewAs } from '@/lib/coachViewAs';
import type { SupportTicket } from './supportTickets';

const BASE = '/coach_api/coach/lms-support-tickets';
export type CoachLmsTicket = SupportTicket & { learnerId: number; learnerName: string };
export interface CoachLmsTicketsResponse { tickets: CoachLmsTicket[]; readOnly: boolean }

async function parse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.message || data?.error || 'LMS support tickets could not be loaded. Please retry.');
  return data;
}

export async function loadCoachLmsTickets(signal?: AbortSignal): Promise<CoachLmsTicketsResponse> {
  const tickets: CoachLmsTicket[] = [];
  let offset: number | null = 0;
  let readOnly = true;
  while (offset !== null) {
    const data: CoachLmsTicketsResponse & { nextOffset?: number | null } = await parse(await coachFetch(`${BASE}?offset=${offset}`, { signal }));
    tickets.push(...data.tickets);
    readOnly = data.readOnly;
    offset = data.nextOffset ?? null;
  }
  return { tickets, readOnly };
}

export async function replyToCoachLmsTicket(id: string, body: string, requestId: string): Promise<CoachLmsTicket> {
  const data = await parse<{ ticket: CoachLmsTicket }>(await coachFetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, requestId }),
  }));
  if (!data.ticket) throw new Error('The server did not confirm the reply. Please retry.');
  return data.ticket;
}

export const coachLmsAttachmentUrl = (ticketId: string, attachmentId: string) =>
  withCoachViewAs(`${BASE}/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}`);
