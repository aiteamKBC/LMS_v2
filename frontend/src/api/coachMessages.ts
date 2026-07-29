export interface CoachMessageOwner {
  name: string;
  email: string;
}

export interface CoachMessageThread {
  learnerId: string;
  learnerName: string;
  learnerInitials: string;
  learnerEmail: string;
  programme: string;
  cohortName: string;
  group: string;
  coachRag: string;
  otjhStatus: string;
  overallProgress: number;
  otjhCompleted: number;
  otjhTarget: number;
  status: 'at-risk' | 'on-track' | 'high' | 'new-starter';
  riskFlags: string[];
  programStatus: string;
  conversationId: string | null;
  hasConversation: boolean;
  chatCoachId: string;
  lastMessage: string;
  lastMessageAt: string | null;
  lastMessageDateLabel: string;
  lastMessageTimeLabel: string;
  lastSenderType: 'coach' | 'learner' | null;
  unreadCount: number;
  needsReply: boolean;
}

export interface CoachMessage {
  id: string;
  from: 'me' | 'them';
  body: string;
  createdAt: string | null;
  dateLabel: string;
  timeLabel: string;
  editedAt: string | null;
  isDeleted: boolean;
  status: 'sent' | 'delivered' | 'read';
}

export interface CoachMessageThreadsResponse {
  owner: CoachMessageOwner;
  threads: CoachMessageThread[];
}

export interface CoachMessageThreadResponse {
  owner: CoachMessageOwner;
  thread: CoachMessageThread;
  messages: CoachMessage[];
}

export interface CoachSendMessageResponse {
  owner: CoachMessageOwner;
  thread: CoachMessageThread;
  message: CoachMessage;
}

const BASE = '/coach_api/coach/messages';

async function request<T>(url: string, init?: globalThis.RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      ...init,
    });
  } catch {
    throw new Error('Could not reach the messaging service right now.');
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Messaging service returned an unexpected response.');
    }
  }

  if (!response.ok) {
    const detail = typeof data === 'object' && data !== null
      ? String((data as { detail?: string; error?: string }).detail || (data as { error?: string }).error || '')
      : '';
    throw new Error(detail || `Request failed (${response.status})`);
  }

  return data as T;
}

export function fetchCoachMessageThreads(ownerEmail?: string): Promise<CoachMessageThreadsResponse> {
  const search = new URLSearchParams();
  if (ownerEmail) search.set('owner_email', ownerEmail);
  const url = search.toString() ? `${BASE}?${search.toString()}` : BASE;
  return request<CoachMessageThreadsResponse>(url);
}

export function fetchCoachMessageThread(learnerId: string, ownerEmail?: string): Promise<CoachMessageThreadResponse> {
  const search = new URLSearchParams();
  if (ownerEmail) search.set('owner_email', ownerEmail);
  const url = search.toString() ? `${BASE}/${encodeURIComponent(learnerId)}?${search.toString()}` : `${BASE}/${encodeURIComponent(learnerId)}`;
  return request<CoachMessageThreadResponse>(url);
}

export function sendCoachMessage(learnerId: string, body: string, ownerEmail?: string): Promise<CoachSendMessageResponse> {
  const search = new URLSearchParams();
  if (ownerEmail) search.set('owner_email', ownerEmail);
  const url = search.toString() ? `${BASE}/${encodeURIComponent(learnerId)}?${search.toString()}` : `${BASE}/${encodeURIComponent(learnerId)}`;
  return request<CoachSendMessageResponse>(url, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}
