import type { LearnerKind } from '@/api/learnerDetail';
import type { CoachMeetingArtifactsResponse } from '@/pages/coach/shared/calendarEvents';

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
  learnerSigned?: boolean;
  learnerSignedAt?: string | null;
  /** False when the Microsoft Graph sync failed: saved locally, but no invite sent. */
  invited?: boolean;
  syncError?: string;
  programme?: string;
  cohort?: string;
  group?: string;
  module?: string;
}

export interface LearnerCalendarResponse {
  learner: { kind: LearnerKind; id: number; email?: string };
  events: LearnerCalendarEvent[];
  bookingCalendar?: BookingCalendarRules;
}

export interface BookingCalendarRules {
  division: 'england-and-wales';
  today: string;
  coveredYears: number[];
  bankHolidays: Array<{ date: string; title: string }>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
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

export function fetchLearnerMeetingArtifacts(kind: LearnerKind, learnerId: string, eventKey: string, signal?: AbortSignal): Promise<CoachMeetingArtifactsResponse> {
  return request<CoachMeetingArtifactsResponse>(`${BASE}/${kind}/${learnerId}/events/${encodeURIComponent(eventKey)}/artifacts/`, { signal, credentials: 'include' });
}

export function learnerMeetingArtifactContentUrl(kind: LearnerKind, learnerId: string, eventKey: string, artifactType: string, artifactId: string, options: { preview?: boolean } = {}): string {
  const base = `${BASE}/${kind}/${learnerId}/events/${encodeURIComponent(eventKey)}/artifacts/${encodeURIComponent(artifactType)}/${encodeURIComponent(artifactId)}/content/`;
  return options.preview ? `${base}?preview=1` : base;
}

export async function signLearnerProgressReview(kind: LearnerKind, learnerId: string, eventKey: string, input: { name: string; signature: string }): Promise<{ event: LearnerCalendarEvent }> {
  const response = await fetch(`${BASE}/${kind}/${learnerId}/events/${encodeURIComponent(eventKey)}/sign/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({})) as { event?: LearnerCalendarEvent; error?: string };
  if (!response.ok || !data.event) throw new Error(data.error || `Could not sign the review (${response.status}).`);
  invalidateLearnerCalendarCache(kind, learnerId);
  return { event: data.event };
}

export type BookableSessionType =
  | 'catch-up'
  | 'student-support'
  // Monthly coaching and progress reviews also come from the programme cycle,
  // scheduled coach-side; booking one here adds a meeting of that kind rather
  // than filling a scheduled slot.
  | 'mcr'
  | 'progress-review'
  // The three onboarding reviews, bookable while still Onboarding (they go to
  // the learner's case owner rather than a coach, who doesn't exist yet).
  | OnboardingReviewType;

export type OnboardingReviewType = 'eligibility-review' | 'workspace' | 'training-plan';

export interface OnboardingReview {
  type: OnboardingReviewType;
  label: string;
  booked: boolean;
  event: LearnerCalendarEvent | null;
  /** True when this review has a form to complete after booking. */
  hasForm?: boolean;
  formStarted?: boolean;
  formCompleted?: boolean;
  learnerSigned?: boolean;
  adminSigned?: boolean;
}

export interface OnboardingReviewsResponse {
  caseOwner: { name: string; email: string } | null;
  reviews: OnboardingReview[];
  allBooked: boolean;
}

/** The three onboarding reviews and whether each has been booked. */
export function fetchOnboardingReviews(kind: LearnerKind, id: string): Promise<OnboardingReviewsResponse> {
  return request<OnboardingReviewsResponse>(`${BASE}/${kind}/${id}/onboarding-reviews/`);
}

export interface BookSessionInput {
  sessionType: BookableSessionType;
  /** Required when booking a generated MCM/Progress Review slot. */
  eventKey?: string;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTime: string; // HH:MM
  durationMinutes: number;
  notes?: string;
  timezoneOffsetMinutes?: number;
}

export interface BookSessionResponse {
  event: LearnerCalendarEvent;
  warning?: string;
  approvalRequired?: boolean;
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

export type RescheduleSessionInput = Pick<
  BookSessionInput,
  'scheduledDate' | 'scheduledTime' | 'durationMinutes' | 'timezoneOffsetMinutes'
> & { eventKey: string };

/** Move an existing booking; the backend updates the same Graph/Teams event. */
export async function rescheduleLearnerCalendarSession(
  kind: LearnerKind,
  id: string,
  input: RescheduleSessionInput,
): Promise<BookSessionResponse> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${kind}/${id}/reschedule/`, {
      method: 'PATCH',
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

/** Cancel a session the learner booked; Graph emails the cancellation to both. */
export async function cancelLearnerCalendarSession(
  kind: LearnerKind,
  id: string,
  eventKey: string,
): Promise<BookSessionResponse> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${kind}/${id}/cancel/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventKey }),
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

export type PersonalCalendarProvider = 'google' | 'microsoft' | 'icloud' | 'caldav' | 'ics';

export interface PersonalCalendarConnection {
  provider: PersonalCalendarProvider;
  accountEmail: string;
  status: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
}

export interface CalendarBusySlot {
  start: string;
  end: string;
  provider: PersonalCalendarProvider;
}

async function calendarConnectionRequest<T>(url: string, init?: Parameters<typeof fetch>[1]): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch {
    throw new Error('Could not reach the calendar connection service.');
  }
  const data = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(data?.error || `Calendar request failed (${response.status}).`);
  return data as T;
}

export function fetchCalendarConnections(kind: LearnerKind, id: string): Promise<{ connections: PersonalCalendarConnection[] }> {
  return calendarConnectionRequest(`/learner_api/calendar-connections/${kind}/${id}/`);
}

export async function startCalendarOAuth(kind: LearnerKind, id: string, provider: 'google' | 'microsoft'): Promise<void> {
  const result = await calendarConnectionRequest<{ authorizationUrl: string }>(`/learner_api/calendar-connections/${kind}/${id}/${provider}/oauth/`);
  window.location.assign(result.authorizationUrl);
}

export function connectCredentialCalendar(
  kind: LearnerKind,
  id: string,
  provider: 'icloud' | 'caldav' | 'ics',
  input: { url: string; username?: string; password?: string },
): Promise<{ connection: PersonalCalendarConnection }> {
  return calendarConnectionRequest(`/learner_api/calendar-connections/${kind}/${id}/${provider}/connect/`, {
    method: 'POST', body: JSON.stringify(input),
  });
}

export function disconnectPersonalCalendar(kind: LearnerKind, id: string, provider: PersonalCalendarProvider): Promise<{ disconnected: boolean }> {
  return calendarConnectionRequest(`/learner_api/calendar-connections/${kind}/${id}/${provider}/disconnect/`, { method: 'POST' });
}

export function fetchPersonalCalendarAvailability(kind: LearnerKind, id: string, start: string, end: string): Promise<{ busy: CalendarBusySlot[]; errors: Array<{ provider: string; message: string }>; connectedProviders: PersonalCalendarProvider[] }> {
  const query = new URLSearchParams({ start, end });
  return calendarConnectionRequest(`/learner_api/calendar-connections/${kind}/${id}/availability/?${query}`);
}
