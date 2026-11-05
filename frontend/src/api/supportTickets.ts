export interface TicketAttachment {
  id: string; name: string; size: number; contentType: string;
}
export interface TicketReply {
  id: string; sender: string; senderRole: string; body: string; timestamp: string;
  attachments?: TicketAttachment[];
}
export interface SupportTicket {
  id: string; title: string; description: string; category: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  requester: string; submitted: string; lastUpdate: string; assignedTo: string; assignedTeam: string;
  messages: number; timeline: { event: string; timestamp: string; detail?: string }[];
  replies: TicketReply[]; feedback?: { rating: number; comment: string };
  attachments?: TicketAttachment[];
}
export const TICKET_CATEGORIES = ['Technical Issue', 'Learning Support', 'Data / MIS', 'Coaching Query', 'Safeguarding Concern', 'Other'];
type TicketResponse = { tickets?: SupportTicket[]; ticket?: SupportTicket; csrfToken: string; nextOffset?: number | null };
const path = (staff: boolean) => `/learner_api/support/${staff ? 'queue' : 'tickets'}/`;

async function request(url: string, init?: RequestInit): Promise<TicketResponse> {
  const response = await fetch(url, { credentials: 'include', ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || 'Support tickets could not be loaded. Please retry.');
  return data;
}

export async function loadSupportTickets(staff = false): Promise<SupportTicket[]> {
  const tickets: SupportTicket[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const data = await request(`${path(staff)}?offset=${offset}`);
    tickets.push(...(data.tickets || []));
    offset = data.nextOffset ?? null;
  }
  return tickets;
}

async function post(staff: boolean, suffix: string, body: object, files: File[] = []): Promise<SupportTicket> {
  const { csrfToken } = await request(path(staff));
  const headers: Record<string, string> = { 'X-CSRFToken': csrfToken, 'X-Requested-With': 'XMLHttpRequest' };
  let payload: string | FormData = JSON.stringify(body);
  if (files.length) {
    const form = new FormData();
    form.append('payload', JSON.stringify(body));
    files.forEach(file => form.append('attachments', file));
    payload = form;
  } else {
    headers['Content-Type'] = 'application/json';
  }
  const result = await request(path(staff) + suffix, {
    method: 'POST', headers, body: payload,
  });
  if (!result.ticket) throw new Error('The server did not confirm the ticket. Please retry.');
  return result.ticket;
}
export const createSupportTicket = (body: { requestId: string; title: string; description: string; category: string; priority: string }, files: File[] = []) => post(false, '', body, files);
export const updateSupportTicket = (id: string, body: object, staff = false, files: File[] = []) => post(staff, `${encodeURIComponent(id)}/`, body, files);
export const ticketAttachmentUrl = (ticketId: string, attachmentId: string, staff = false) =>
  `${path(staff)}${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}/`;
export const ticketDate = (value: string) => new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
