import type { LearnerKind } from '@/api/learnerDetail';

const BASE = '/learner_api/calendar';
const CACHE_TTL_MS = 30_000;
const calendarCache = new Map<string, { data: LearnerCalendarResponse; expiresAt: number }>();
const calendarRequests = new Map<string, Promise<LearnerCalendarResponse>>();

export interface LearnerCalendarEvent {
  id: string;
  eventKey: string;
  title: string;
  source: 'mcr' | 'progress-review' | string;
  type: 'coaching' | 'review' | string;
  sequence: number;
  status: 'not-scheduled' | 'scheduled' | 'in-progress' | 'completed' | 'cancelled' | string;
  date: string | null;
  targetDate: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  durationMinutes: number;
  coachName: string;
  coachEmail: string;
  meetingProvider: string;
  meetingLink: string;
  notes: string;
  reviewResponses?: Record<string, string>;
  reviewCompletedAt?: string | null;
  programme?: string;
  cohort?: string;
  group?: string;
  module?: string;
}

export interface LearnerCalendarResponse {
  learner: { kind: LearnerKind; id: number; email?: string };
  events: LearnerCalendarEvent[];
}

async function request<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Unexpected response (${res.status}).`);
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error || `Request failed with ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export function invalidateLearnerCalendarCache(kind?: LearnerKind, id?: string): void {
  if (kind && id) {
    calendarCache.delete(`${kind}:${id}`);
    return;
  }
  calendarCache.clear();
}

export function fetchLearnerCalendarEvents(kind: LearnerKind, id: string, options: { force?: boolean } = {}): Promise<LearnerCalendarResponse> {
  const key = `${kind}:${id}`;
  const cached = calendarCache.get(key);
  if (!options.force && cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data);

  const pending = calendarRequests.get(key);
  if (pending) return pending;

  const promise = request<LearnerCalendarResponse>(`${BASE}/${kind}/${id}/`)
    .then((data) => {
      calendarCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      return data;
    })
    .finally(() => calendarRequests.delete(key));
  calendarRequests.set(key, promise);
  return promise;
}

export type BookableSessionType = 'catch-up' | 'student-support';

export interface BookSessionInput {
  sessionType: BookableSessionType;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTime: string; // HH:MM
  durationMinutes: number;
  notes?: string;
}

export interface BookSessionResponse {
  event: LearnerCalendarEvent;
  warning?: string;
}

export async function bookLearnerCalendarSession(
  kind: LearnerKind,
  id: string,
  input: BookSessionInput,
): Promise<BookSessionResponse> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${kind}/${id}/book/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Unexpected response (${res.status}).`);
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error || `Request failed with ${res.status}`;
    throw new Error(message);
  }
  invalidateLearnerCalendarCache(kind, id);
  return data as BookSessionResponse;
}

export function fetchLearnerCoach(id: string): Promise<{ coachName: string; coachEmail: string }> {
  return request<{ coachName: string; coachEmail: string }>(`/learner_api/learners/${id}/coach/`);
}
