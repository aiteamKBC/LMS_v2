export type ChatParticipantType = 'coach' | 'learner';

export interface ChatParticipant {
  id: string;
  type: ChatParticipantType;
  name: string;
  avatar: string | null;
}

export interface ChatSender {
  id: string;
  type: ChatParticipantType;
  name?: string;
  avatar?: string | null;
}

export interface ChatMessage {
  id: number;
  conversation: number;
  sender: ChatSender;
  body: string;
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  is_mine: boolean;
  read_at: string | null;
}

export interface ChatConversation {
  id: number;
  participant: ChatParticipant;
  latest_message: Pick<ChatMessage, 'id' | 'body' | 'created_at' | 'edited_at' | 'is_deleted' | 'sender'> | null;
  updated_at: string;
  unread_count: number;
}

interface PaginatedMessages {
  count: number;
  next: string | null;
  previous: string | null;
  results: ChatMessage[];
}

export interface ChatSocketMessage {
  id: number;
  conversation: number;
  sender: ChatSender;
  body: string;
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
}

export class ChatApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ChatApiError';
    this.status = status;
  }
}

const CHAT_BASE = '/api/chat';

function readCookie(name: string): string | null {
  const encodedName = `${encodeURIComponent(name)}=`;
  const cookie = document.cookie.split('; ').find(value => value.startsWith(encodedName));
  return cookie ? decodeURIComponent(cookie.slice(encodedName.length)) : null;
}

async function ensureChatCsrfCookie(): Promise<void> {
  const response = await fetch(`${CHAT_BASE}/session/`, { credentials: 'include' });
  if (!response.ok) throw new ChatApiError('Could not initialise the chat session.', response.status);
}

export async function bootstrapChatSession(email: string): Promise<void> {
  await ensureChatCsrfCookie();
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const csrfToken = readCookie('csrftoken');
  if (csrfToken) headers.set('X-CSRFToken', csrfToken);

  const response = await fetch(`${CHAT_BASE}/session/`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    throw new ChatApiError('Could not initialise the chat session.', response.status);
  }
}

export async function clearChatSession(): Promise<void> {
  try {
    await ensureChatCsrfCookie();
    const headers = new Headers();
    const csrfToken = readCookie('csrftoken');
    if (csrfToken) headers.set('X-CSRFToken', csrfToken);
    await fetch(`${CHAT_BASE}/session/logout/`, {
      method: 'POST',
      headers,
      credentials: 'include',
    });
  } catch {
    // Local frontend logout should still complete if the backend is offline.
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (init.method && init.method !== 'GET') {
    const csrfToken = readCookie('csrftoken');
    if (csrfToken) headers.set('X-CSRFToken', csrfToken);
  }

  let response: Response;
  try {
    response = await fetch(`${CHAT_BASE}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  } catch {
    throw new ChatApiError('Could not reach the chat server.', 0);
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const payload = data as { detail?: string; body?: string[] } | null;
    const message = response.status === 401 || response.status === 403
      ? 'Your web session is not authenticated for chat. Please sign in through Django.'
      : payload?.detail || payload?.body?.[0] || `Chat request failed (${response.status}).`;
    throw new ChatApiError(message, response.status);
  }

  return data as T;
}

export function fetchChatConversations(): Promise<ChatConversation[]> {
  return request<ChatConversation[]>('/conversations/');
}

export function fetchChatMessages(conversationId: number): Promise<PaginatedMessages> {
  return request<PaginatedMessages>(`/conversations/${conversationId}/messages/`);
}

export function createChatMessage(conversationId: number, body: string): Promise<ChatMessage> {
  return request<ChatMessage>(`/conversations/${conversationId}/messages/`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export function markChatMessageRead(messageId: number): Promise<{ message: number; read_at: string }> {
  return request<{ message: number; read_at: string }>(`/messages/${messageId}/read/`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function chatSocketUrl(conversationId: number): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/chat/${conversationId}/`;
}
