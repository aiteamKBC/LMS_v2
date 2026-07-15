export const DEFAULT_COACH_EMAIL = 'Med.Maher@kentbusinesscollege.com';

const API_ENDPOINT = `/coach_api/coach/timetable?owner_email=${encodeURIComponent(DEFAULT_COACH_EMAIL)}`;
const SCHEDULE_ENDPOINT = '/coach_api/coach/timetable/events/schedule';
const ACTION_ENDPOINT = '/coach_api/coach/timetable/events/action';

export type CoachCalendarStatus =
  | 'completed'
  | 'scheduled'
  | 'in-progress'
  | 'confirmed'
  | 'pending'
  | 'cancelled'
  | 'not-scheduled';

export interface CoachCalendarEvent {
  id: string;
  eventKey?: string;
  title: string;
  type: 'coaching' | 'review' | string;
  date?: string;
  year?: number;
  month?: number;
  dayOfMonth?: number;
  startHour?: number;
  endHour?: number;
  timeLabel?: string;
  learner?: string;
  email?: string;
  programme?: string;
  cohort?: string;
  priority?: 'normal' | 'urgent' | 'high';
  status: CoachCalendarStatus;
  source?: 'mcr' | 'progress-review' | string;
  sequence?: number;
  notes?: string;
  learnerId?: string;
  ownerEmail?: string;
  ownerName?: string;
  targetDate?: string;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  durationMinutes?: number;
  meetingProvider?: string;
  meetingLink?: string;
  graphWebLink?: string;
  platform?: string;
  location?: string;
  syncWarning?: string;
}

interface CoachTimetableResponse {
  owner?: {
    name?: string;
    email?: string;
  };
  events?: CoachCalendarEvent[];
}

export interface ScheduleFormState {
  date: string;
  time: string;
  durationMinutes: number;
}

export type CalendarAction = 'start' | 'complete' | 'cancel';

async function readJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.detail === 'string' ? data.detail : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export async function fetchCoachCalendarEvents(signal?: AbortSignal) {
  const response = await fetch(API_ENDPOINT, { signal });
  return readJsonResponse<CoachTimetableResponse>(response);
}

export async function scheduleCoachCalendarEvent(event: CoachCalendarEvent, form: ScheduleFormState) {
  if (!event.eventKey || !event.ownerEmail) {
    throw new Error('This event is missing its calendar key.');
  }

  const response = await fetch(SCHEDULE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventKey: event.eventKey,
      ownerEmail: event.ownerEmail,
      scheduledDate: form.date,
      scheduledTime: form.time,
      durationMinutes: form.durationMinutes,
    }),
  });
  const data = await readJsonResponse<{ event: CoachCalendarEvent; warning?: string }>(response);
  return data;
}

export async function runCoachCalendarAction(event: CoachCalendarEvent, action: CalendarAction) {
  if (!event.eventKey || !event.ownerEmail) {
    throw new Error('This event is missing its calendar key.');
  }

  const response = await fetch(ACTION_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventKey: event.eventKey,
      ownerEmail: event.ownerEmail,
      action,
    }),
  });
  const data = await readJsonResponse<{ event: CoachCalendarEvent; warning?: string }>(response);
  return data;
}

export function eventIdentity(event: CoachCalendarEvent) {
  return event.eventKey || event.id;
}

export function parseLocalDate(value?: string | null) {
  if (!value) return null;
  const datePart = value.split('T')[0];
  const parts = datePart.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

export function eventDisplayDate(event: CoachCalendarEvent) {
  return event.scheduledDate || event.date || event.targetDate || '';
}

export function eventTargetDate(event: CoachCalendarEvent) {
  return event.targetDate || event.date || event.scheduledDate || '';
}

export function formatDateLabel(value?: string | null) {
  const date = parseLocalDate(value);
  if (!date) return '--';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatTimeLabel(event: CoachCalendarEvent) {
  if (event.scheduledTime) {
    return `${event.scheduledTime.slice(0, 5)} - ${event.durationMinutes || 60} min`;
  }
  return event.timeLabel && event.timeLabel !== 'Time TBC' ? event.timeLabel : 'Time TBC';
}

export function scheduleDefaults(event: CoachCalendarEvent): ScheduleFormState {
  return {
    date: event.scheduledDate || event.targetDate || event.date || '',
    time: event.scheduledTime ? event.scheduledTime.slice(0, 5) : '09:00',
    durationMinutes: event.durationMinutes || 60,
  };
}

export function sortEvents(events: CoachCalendarEvent[]) {
  return [...events].sort((a, b) => {
    const aDate = parseLocalDate(eventDisplayDate(a))?.getTime() || 0;
    const bDate = parseLocalDate(eventDisplayDate(b))?.getTime() || 0;
    if (aDate !== bDate) return aDate - bDate;
    return (a.startHour || 0) - (b.startHour || 0);
  });
}

export function initialsFor(name?: string) {
  const parts = (name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '--';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function statusLabel(status: CoachCalendarStatus) {
  const labels: Record<CoachCalendarStatus, string> = {
    completed: 'Completed',
    scheduled: 'Scheduled',
    'in-progress': 'In Progress',
    confirmed: 'Confirmed',
    pending: 'Pending',
    cancelled: 'Cancelled',
    'not-scheduled': 'Needs Schedule',
  };
  return labels[status] || status;
}

export function statusPillClass(status: CoachCalendarStatus) {
  if (status === 'completed' || status === 'confirmed') return 'bg-emerald-100 text-emerald-700';
  if (status === 'scheduled') return 'bg-amber-100 text-amber-700';
  if (status === 'in-progress') return 'bg-primary-100 text-primary-700';
  if (status === 'cancelled') return 'bg-red-100 text-red-700';
  return 'bg-orange-100 text-orange-700';
}

export function avatarClass(event: CoachCalendarEvent) {
  if (event.status === 'cancelled') return 'bg-red-100 text-red-700 ring-red-200';
  if (event.priority === 'urgent' || event.priority === 'high') return 'bg-amber-100 text-amber-700 ring-amber-200';
  if (event.status === 'completed' || event.status === 'confirmed') return 'bg-emerald-100 text-emerald-700 ring-emerald-200';
  return 'bg-primary-100 text-primary-700 ring-primary-200';
}

export function isConfirmedEvent(event: CoachCalendarEvent) {
  return ['scheduled', 'in-progress', 'completed', 'confirmed'].includes(event.status);
}

export function needsScheduling(event: CoachCalendarEvent) {
  return ['not-scheduled', 'pending', 'cancelled'].includes(event.status);
}

export function isUrgentEvent(event: CoachCalendarEvent) {
  return event.priority === 'urgent' || event.priority === 'high';
}

export function isCompletedEvent(event: CoachCalendarEvent) {
  return event.status === 'completed' || event.status === 'confirmed';
}

export function isUpcomingEvent(event: CoachCalendarEvent) {
  return !['completed', 'confirmed', 'cancelled'].includes(event.status);
}

export function meetingUrl(event: CoachCalendarEvent) {
  return event.meetingLink || event.graphWebLink || '';
}

export function eventPeriodLabel(event: CoachCalendarEvent) {
  if (!event.sequence) return 'Review';
  return `Review ${event.sequence}`;
}
