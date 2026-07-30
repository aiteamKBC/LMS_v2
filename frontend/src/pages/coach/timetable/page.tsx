import { useState, useMemo, useCallback, useEffect } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ThemedSelect } from '@/components/feature/ThemedSelect';
import { roleNavMap } from '@/mocks/navigation';
import ProgressReviewCompletionModal from '@/pages/coach/shared/ProgressReviewCompletionModal';
import type { ProgressReviewResponses } from '@/pages/shared/progressReviewForm';

const coachNav = roleNavMap.coach;
const API_ENDPOINT = '/coach_api/coach/timetable';
const BOOK_ENDPOINT = '/coach_api/coach/timetable/events/book';
const SCHEDULE_ENDPOINT = '/coach_api/coach/timetable/events/schedule';
const ACTION_ENDPOINT = '/coach_api/coach/timetable/events/action';

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Types
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
interface TimetableEvent {
  id: string;
  eventKey?: string;
  title: string;
  type: 'coaching' | 'live-session' | 'review' | 'employer-meeting' | 'welfare' | 'admin' | 'personal';
  date?: string;
  year: number;
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  dayOfMonth: number;
  month: number;
  startHour: number;
  endHour: number;
  timeLabel?: string;
  isTimeEstimated?: boolean;
  learner?: string;
  email?: string;
  employer?: string;
  managerEmail?: string;
  programme?: string;
  tutor?: string;
  location?: string;
  platform?: string;
  priority: 'normal' | 'urgent' | 'high';
  status: 'completed' | 'scheduled' | 'in-progress' | 'awaiting-signature' | 'confirmed' | 'pending' | 'cancelled' | 'not-scheduled';
  source?: 'mcr' | 'progress-review' | string;
  sourceStatus?: string;
  sequence?: number;
  rawPlanned?: string;
  rawStatus?: string;
  notes?: string;
  cohort?: string;
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
  syncWarning?: string;
  reviewResponses?: Record<string, string>;
  reviewCompletedAt?: string | null;
  managerSignedAt?: string | null;
  managerSignedBy?: string;
  schedulerOnly?: boolean;
}

interface TimetableSummaryMetrics {
  totalEvents: number;
  completedEvents: number;
  scheduledEvents: number;
  inProgressEvents: number;
  needsScheduling: number;
  thisWeekEvents: number;
  overdueEvents: number;
  dueSoonEvents: number;
  cancelledEvents: number;
  completionRate: number;
  coachingEvents: number;
  reviewEvents: number;
  supportEvents: number;
}

interface TimetableSummary extends TimetableSummaryMetrics {
  timeAvailability?: string;
  sourceBreakdown?: {
    mcr: TimetableSummaryMetrics;
    progressReview: TimetableSummaryMetrics;
    catchUp: TimetableSummaryMetrics;
  };
}

interface TimetableResponse {
  owner?: {
    name?: string;
    email?: string;
  };
  summary?: TimetableSummary;
  events?: TimetableEvent[];
  schedulerQueues?: {
    catchUp?: TimetableEvent[];
  };
}

interface ScheduleNavigationIntent {
  source: SchedulableSource;
  learnerId?: string;
  targetDate?: string | null;
  title?: string;
}

type CoachBookableSessionType = 'catch-up' | 'student-support';

const EMPTY_SUMMARY_METRICS: TimetableSummaryMetrics = {
  totalEvents: 0,
  completedEvents: 0,
  scheduledEvents: 0,
  inProgressEvents: 0,
  needsScheduling: 0,
  thisWeekEvents: 0,
  overdueEvents: 0,
  dueSoonEvents: 0,
  cancelledEvents: 0,
  completionRate: 0,
  coachingEvents: 0,
  reviewEvents: 0,
  supportEvents: 0,
};

const EMPTY_SUMMARY: TimetableSummary = {
  ...EMPTY_SUMMARY_METRICS,
  sourceBreakdown: {
    mcr: { ...EMPTY_SUMMARY_METRICS },
    progressReview: { ...EMPTY_SUMMARY_METRICS },
    catchUp: { ...EMPTY_SUMMARY_METRICS },
  },
};

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Data â€” June 2026 (spans 4 weeks)
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 07:00 â€“ 20:00

function typeConfig(type: TimetableEvent['type']) {
  const map: Record<TimetableEvent['type'], { label: string; bg: string; border: string; text: string; icon: string; dot: string; barBg: string }> = {
    coaching: { label: 'Coaching', bg: 'bg-primary-100', border: 'border-primary-300', text: 'text-primary-800', icon: 'ri-chat-smile-2-line', dot: 'bg-primary-500', barBg: 'bg-primary-500' },
    'live-session': { label: 'Live Session', bg: 'bg-sky-50', border: 'border-sky-300', text: 'text-sky-800', icon: 'ri-live-line', dot: 'bg-sky-500', barBg: 'bg-sky-500' },
    review: { label: 'Review', bg: 'bg-secondary-100', border: 'border-secondary-300', text: 'text-secondary-800', icon: 'ri-file-chart-line', dot: 'bg-secondary-500', barBg: 'bg-secondary-500' },
    'employer-meeting': { label: 'Employer', bg: 'bg-amber-100', border: 'border-amber-300', text: 'text-amber-800', icon: 'ri-building-2-line', dot: 'bg-amber-500', barBg: 'bg-amber-500' },
    welfare: { label: 'Welfare', bg: 'bg-red-100', border: 'border-red-300', text: 'text-red-800', icon: 'ri-heart-pulse-line', dot: 'bg-red-500', barBg: 'bg-red-500' },
    admin: { label: 'Admin', bg: 'bg-background-100', border: 'border-background-300', text: 'text-foreground-700', icon: 'ri-settings-3-line', dot: 'bg-foreground-400', barBg: 'bg-foreground-400' },
    personal: { label: 'Personal', bg: 'bg-emerald-100', border: 'border-emerald-300', text: 'text-emerald-800', icon: 'ri-user-line', dot: 'bg-emerald-500', barBg: 'bg-emerald-500' },
  };
  return map[type];
}

function eventConfig(event: TimetableEvent) {
  const isLiveSession = event.source === 'live-session' || event.type === 'live-session';
  const mcrTheme = {
    label: 'MCR',
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    text: 'text-amber-800',
    icon: 'ri-chat-smile-2-line',
    dot: 'bg-amber-500',
    barBg: 'bg-amber-500',
  };
  const progressReviewTheme = {
    label: 'PR',
    bg: 'bg-teal-50',
    border: 'border-teal-300',
    text: 'text-teal-800',
    icon: 'ri-file-chart-line',
    dot: 'bg-teal-500',
    barBg: 'bg-teal-500',
  };
  const supportTheme = {
    label: 'Support',
    bg: 'bg-cyan-50',
    border: 'border-cyan-300',
    text: 'text-cyan-800',
    icon: 'ri-heart-2-line',
    dot: 'bg-cyan-500',
    barBg: 'bg-cyan-500',
  };
  const catchUpTheme = {
    label: 'Catch-up',
    bg: 'bg-rose-50',
    border: 'border-rose-300',
    text: 'text-rose-800',
    icon: 'ri-timer-line',
    dot: 'bg-rose-500',
    barBg: 'bg-rose-500',
  };
  const sourceTheme = event.source === 'mcr'
    ? mcrTheme
    : event.source === 'progress-review'
      ? progressReviewTheme
      : event.source === 'catch-up'
        ? catchUpTheme
        : event.source === 'student-support' || event.type === 'welfare'
          ? supportTheme
          : null;
  const base = sourceTheme || typeConfig(event.type);
  const statusThemeMap: Partial<Record<TimetableEvent['status'], Pick<ReturnType<typeof typeConfig>, 'bg' | 'border' | 'text' | 'dot' | 'barBg'>>> = {
    completed: {
      bg: 'bg-emerald-50',
      border: 'border-emerald-300',
      text: 'text-emerald-800',
      dot: 'bg-emerald-500',
      barBg: 'bg-emerald-500',
    },
    confirmed: {
      bg: 'bg-emerald-50',
      border: 'border-emerald-300',
      text: 'text-emerald-800',
      dot: 'bg-emerald-500',
      barBg: 'bg-emerald-500',
    },
    scheduled: {
      bg: 'bg-amber-50',
      border: 'border-amber-300',
      text: 'text-amber-800',
      dot: 'bg-amber-500',
      barBg: 'bg-amber-500',
    },
    pending: {
      bg: 'bg-amber-50',
      border: 'border-amber-300',
      text: 'text-amber-800',
      dot: 'bg-amber-500',
      barBg: 'bg-amber-500',
    },
    'not-scheduled': {
      bg: 'bg-amber-50',
      border: 'border-amber-300',
      text: 'text-amber-800',
      dot: 'bg-amber-500',
      barBg: 'bg-amber-500',
    },
    'in-progress': {
      bg: 'bg-secondary-50',
      border: 'border-secondary-300',
      text: 'text-secondary-800',
      dot: 'bg-secondary-500',
      barBg: 'bg-secondary-500',
    },
    'awaiting-signature': {
      bg: 'bg-violet-50',
      border: 'border-violet-300',
      text: 'text-violet-800',
      dot: 'bg-violet-500',
      barBg: 'bg-violet-500',
    },
    cancelled: {
      bg: 'bg-red-50',
      border: 'border-red-300',
      text: 'text-red-800',
      dot: 'bg-red-500',
      barBg: 'bg-red-500',
    },
  };

  const statusTheme = statusThemeMap[event.status];
  if (isLiveSession && !['completed', 'confirmed', 'cancelled'].includes(event.status)) {
    return base;
  }
  if (sourceTheme && ['scheduled', 'pending', 'not-scheduled'].includes(event.status)) {
    return base;
  }
  if (statusTheme) {
    return {
      ...base,
      ...statusTheme,
    };
  }
  return base;
}

function priorityBadge(p: TimetableEvent['priority']) {
  if (p === 'urgent') return 'bg-red-100 text-red-700 border-red-200';
  if (p === 'high') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-background-100 text-foreground-500 border-background-200';
}

function formatTime(h: number) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function buildInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '--';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function parseEventDate(event: Pick<TimetableEvent, 'date' | 'year' | 'month' | 'dayOfMonth'>) {
  if (event.date) {
    const parsed = new Date(event.date);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(event.year, event.month, event.dayOfMonth);
}

function parseDateOnly(value?: string | null) {
  if (!value) return null;
  const [datePart] = value.split('T');
  const parts = datePart.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function startOfDay(value = new Date()) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function currentWeekRange(referenceDate = new Date()) {
  const today = startOfDay(referenceDate);
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(today);
  start.setDate(today.getDate() + mondayOffset);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function eventDisplayDateValue(event: TimetableEvent) {
  return event.scheduledDate || event.date || event.targetDate || '';
}

function eventTargetDateValue(event: TimetableEvent) {
  return event.targetDate || event.date || event.scheduledDate || '';
}

function getMetricDate(value: string, fallbackEvent: TimetableEvent) {
  return parseDateOnly(value) || parseEventDate(fallbackEvent);
}

function isCompletedMetricEvent(event: TimetableEvent) {
  return event.status === 'completed' || event.status === 'confirmed';
}

function isScheduledMetricEvent(event: TimetableEvent) {
  return event.status === 'scheduled';
}

function isInProgressMetricEvent(event: TimetableEvent) {
  return event.status === 'in-progress';
}

function needsSchedulingMetricEvent(event: TimetableEvent) {
  return event.status === 'pending' || event.status === 'not-scheduled';
}

function isOverdueMetricEvent(event: TimetableEvent, referenceDate = new Date()) {
  if (!needsSchedulingMetricEvent(event)) return false;
  const targetDate = getMetricDate(eventTargetDateValue(event), event);
  return targetDate.getTime() < startOfDay(referenceDate).getTime();
}

function isDueSoonMetricEvent(event: TimetableEvent, referenceDate = new Date(), daysAhead = 14) {
  if (!needsSchedulingMetricEvent(event) || isOverdueMetricEvent(event, referenceDate)) return false;
  const targetDate = getMetricDate(eventTargetDateValue(event), event);
  const today = startOfDay(referenceDate);
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() + daysAhead);
  return targetDate.getTime() >= today.getTime() && targetDate.getTime() <= cutoff.getTime();
}

function isThisWeekMetricEvent(event: TimetableEvent, referenceDate = new Date()) {
  if (isCompletedMetricEvent(event)) return false;
  const displayDate = getMetricDate(eventDisplayDateValue(event), event);
  const { start, end } = currentWeekRange(referenceDate);
  return displayDate.getTime() >= start.getTime() && displayDate.getTime() <= end.getTime();
}

function formatEventDateLabel(event: TimetableEvent) {
  return `${DAYS_OF_WEEK[event.dayOfWeek]}, ${event.dayOfMonth} ${MONTH_NAMES[event.month]}`;
}

function statusBadge(status: TimetableEvent['status']) {
  if (status === 'completed' || status === 'confirmed') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'scheduled' || status === 'pending' || status === 'not-scheduled') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'in-progress') return 'bg-primary-50 text-primary-700 border-primary-200';
  if (status === 'awaiting-signature') return 'bg-violet-50 text-violet-700 border-violet-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

function statusLabel(status: TimetableEvent['status']) {
  if (status === 'completed') return 'Completed';
  if (status === 'scheduled') return 'Scheduled';
  if (status === 'not-scheduled') return 'Needs Schedule';
  if (status === 'in-progress') return 'In Progress';
  if (status === 'awaiting-signature') return 'Awaiting Signature';
  if (status === 'confirmed') return 'Confirmed';
  if (status === 'pending') return 'Pending';
  return 'Cancelled';
}

function buildSummaryMetrics(events: TimetableEvent[], referenceDate = new Date()): TimetableSummaryMetrics {
  const totalEvents = events.length;
  const completedEvents = events.filter(isCompletedMetricEvent).length;
  const scheduledEvents = events.filter(isScheduledMetricEvent).length;
  const inProgressEvents = events.filter(isInProgressMetricEvent).length;
  const needsScheduling = events.filter(needsSchedulingMetricEvent).length;
  const thisWeekEvents = events.filter(event => isThisWeekMetricEvent(event, referenceDate)).length;
  const overdueEvents = events.filter(event => isOverdueMetricEvent(event, referenceDate)).length;
  const dueSoonEvents = events.filter(event => isDueSoonMetricEvent(event, referenceDate)).length;
  const cancelledEvents = events.filter(event => event.status === 'cancelled').length;

  return {
    totalEvents,
    completedEvents,
    scheduledEvents,
    inProgressEvents,
    needsScheduling,
    thisWeekEvents,
    overdueEvents,
    dueSoonEvents,
    cancelledEvents,
    completionRate: totalEvents > 0 ? Math.round((completedEvents / totalEvents) * 100) : 0,
    coachingEvents: events.filter(event => event.type === 'coaching').length,
    reviewEvents: events.filter(event => event.type === 'review').length,
    supportEvents: events.filter(event => event.type === 'welfare').length,
  };
}

function buildFallbackSummary(events: TimetableEvent[], referenceDate = new Date()): TimetableSummary {
  return {
    ...buildSummaryMetrics(events, referenceDate),
    sourceBreakdown: {
      mcr: buildSummaryMetrics(events.filter(event => event.source === 'mcr'), referenceDate),
      progressReview: buildSummaryMetrics(events.filter(event => event.source === 'progress-review'), referenceDate),
      catchUp: buildSummaryMetrics(events.filter(event => event.source === 'catch-up'), referenceDate),
    },
  };
}

function normalizeSummary(summary: TimetableSummary, events: TimetableEvent[]): TimetableSummary {
  const liveSummary = buildFallbackSummary(events);
  return {
    ...summary,
    ...liveSummary,
    timeAvailability: summary.timeAvailability,
  };
}

/* â”€â”€â”€ Month calendar helpers â”€â”€â”€ */
function getMonthData(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  const mondayOffset = startDow === 0 ? 6 : startDow - 1;
  const totalDays = lastDay.getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < mondayOffset; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  return cells;
}

function getWeekDates(year: number, month: number, selectedDay: number) {
  const date = new Date(year, month, selectedDay);
  const dayOfWeek = date.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(date);
  monday.setDate(date.getDate() - mondayOffset);
  const week: { day: number; month: number; year: number; monthName: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    week.push({ day: d.getDate(), month: d.getMonth(), year: d.getFullYear(), monthName: MONTH_NAMES[d.getMonth()] });
  }
  return week;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function formatDateInputValue(year: number, month: number, day: number) {
  const safeDay = Math.min(day, getDaysInMonth(year, month));
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

/* â”€â”€â”€ Donut Ring â”€â”€â”€ */
type ViewMode = 'month' | 'week' | 'day';
type StatusFilter = 'all' | 'overdue' | 'due-soon' | 'needs-schedule' | 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
type SourceFilter = 'all' | 'live-session' | 'mcr' | 'progress-review' | 'catch-up' | 'student-support';
type SchedulableSource = 'mcr' | 'progress-review' | 'catch-up';

const SOURCE_FILTER_ORDER: SourceFilter[] = ['all', 'live-session', 'mcr', 'progress-review', 'catch-up', 'student-support'];
const STATUS_FILTER_ORDER: StatusFilter[] = ['all', 'overdue', 'due-soon', 'needs-schedule', 'scheduled', 'in-progress', 'completed', 'cancelled'];

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  overdue: 'Overdue',
  'due-soon': 'Due Soon',
  'needs-schedule': 'Needs Schedule',
  scheduled: 'Scheduled',
  'in-progress': 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_FILTER_DOTS: Record<StatusFilter, string> = {
  all: 'bg-foreground-400',
  overdue: 'bg-red-500',
  'due-soon': 'bg-amber-500',
  'needs-schedule': 'bg-orange-500',
  scheduled: 'bg-accent-500',
  'in-progress': 'bg-secondary-500',
  completed: 'bg-emerald-500',
  cancelled: 'bg-red-500',
};

const SOURCE_FILTER_LABELS: Record<SourceFilter, string> = {
  all: 'All Sources',
  'live-session': 'Live Sessions',
  mcr: 'MCR',
  'progress-review': 'Progress Reviews',
  'catch-up': 'Catch-up',
  'student-support': 'Support',
};

const SOURCE_FILTER_CHIP_LABELS: Record<SourceFilter, string> = {
  ...SOURCE_FILTER_LABELS,
  'progress-review': 'PR',
};

const SOURCE_FILTER_DOTS: Record<SourceFilter, string> = {
  all: 'bg-foreground-400',
  'live-session': 'bg-sky-500',
  mcr: 'bg-amber-500',
  'progress-review': 'bg-teal-500',
  'catch-up': 'bg-rose-500',
  'student-support': 'bg-cyan-500',
};

const SCHEDULABLE_SOURCE_ORDER: SchedulableSource[] = ['mcr', 'progress-review', 'catch-up'];
const SCHEDULABLE_SOURCE_META: Record<SchedulableSource, { description: string; icon: string; accent: string; surface: string }> = {
  mcr: {
    description: 'Monthly coaching reviews waiting for a slot.',
    icon: 'ri-chat-1-line',
    accent: 'text-primary-700',
    surface: 'from-primary-500/10 via-primary-400/5 to-transparent',
  },
  'progress-review': {
    description: 'Generated progress reviews that still need a date.',
    icon: 'ri-file-chart-line',
    accent: 'text-teal-700',
    surface: 'from-teal-500/10 via-teal-400/5 to-transparent',
  },
  'catch-up': {
    description: 'Learner catch-up bookings waiting for placement.',
    icon: 'ri-timer-line',
    accent: 'text-rose-700',
    surface: 'from-rose-500/10 via-rose-400/5 to-transparent',
  },
};

function isSchedulableSource(value?: string): value is SchedulableSource {
  return value === 'mcr' || value === 'progress-review' || value === 'catch-up';
}

function parseScheduleNavigationIntent(value: unknown): ScheduleNavigationIntent | null {
  if (!value || typeof value !== 'object') return null;

  const source = typeof (value as { source?: unknown }).source === 'string'
    ? (value as { source?: string }).source
    : undefined;

  if (!isSchedulableSource(source)) return null;

  return {
    source,
    learnerId: typeof (value as { learnerId?: unknown }).learnerId === 'string'
      ? (value as { learnerId?: string }).learnerId
      : undefined,
    targetDate: typeof (value as { targetDate?: unknown }).targetDate === 'string'
      ? (value as { targetDate?: string }).targetDate
      : undefined,
    title: typeof (value as { title?: unknown }).title === 'string'
      ? (value as { title?: string }).title
      : undefined,
  };
}

function eventMatchesSourceFilter(event: TimetableEvent, source: SourceFilter) {
  if (source === 'all') return true;
  if (source === 'live-session') return event.source === 'live-session' || event.type === 'live-session';
  if (source === 'student-support') return event.source === 'student-support' || event.type === 'welfare';
  return event.source === source;
}

function eventIdentity(event: TimetableEvent) {
  return event.eventKey || event.id;
}

function learnerIdentity(event: TimetableEvent) {
  return event.learnerId || event.email || event.learner || eventIdentity(event);
}

function formatCompactDate(value?: string | null) {
  const parsed = parseDateOnly(value);
  if (!parsed) return 'Date TBC';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

function sourceSessionLabel(event: TimetableEvent) {
  if (!isSchedulableSource(event.source)) return event.title;
  const baseLabel = SOURCE_FILTER_LABELS[event.source];
  if (event.source === 'catch-up') return event.schedulerOnly ? 'New Catch-up Session' : baseLabel;
  return event.sequence ? `${baseLabel} ${event.sequence}` : baseLabel;
}

function scheduleSessionOptionLabel(event: TimetableEvent) {
  if (event.source === 'catch-up' && event.schedulerOnly) {
    return `${event.learner || 'Learner'} · New Catch-up Session`;
  }
  return `${event.learner || 'Learner'} · ${sourceSessionLabel(event)} · due ${formatCompactDate(event.targetDate || event.date)}`;
}

function scheduleLearnerOptionLabel(event: TimetableEvent) {
  return event.programme ? `${event.learner || 'Learner'} · ${event.programme}` : (event.learner || 'Learner');
}

function isSelectableScheduleEvent(event: TimetableEvent) {
  if (!isSchedulableSource(event.source)) return false;
  if (event.source === 'catch-up') {
    return !['completed', 'confirmed', 'in-progress'].includes(event.status);
  }
  return needsSchedulingMetricEvent(event);
}

function compareSchedulablePriority(a: TimetableEvent, b: TimetableEvent) {
  const aNeedsBooking = needsSchedulingMetricEvent(a) ? 0 : 1;
  const bNeedsBooking = needsSchedulingMetricEvent(b) ? 0 : 1;
  if (aNeedsBooking !== bNeedsBooking) return aNeedsBooking - bNeedsBooking;

  const aTemplatePenalty = a.schedulerOnly ? 1 : 0;
  const bTemplatePenalty = b.schedulerOnly ? 1 : 0;
  if (aTemplatePenalty !== bTemplatePenalty) return aTemplatePenalty - bTemplatePenalty;

  const aOverdue = isOverdueMetricEvent(a) ? 0 : 1;
  const bOverdue = isOverdueMetricEvent(b) ? 0 : 1;
  if (aOverdue !== bOverdue) return aOverdue - bOverdue;

  const dateDelta = getMetricDate(eventTargetDateValue(a), a).getTime() - getMetricDate(eventTargetDateValue(b), b).getTime();
  if (dateDelta !== 0) return dateDelta;

  const sequenceDelta = (a.sequence || 0) - (b.sequence || 0);
  if (sequenceDelta !== 0) return sequenceDelta;

  const learnerDelta = (a.learner || '').localeCompare(b.learner || '');
  if (learnerDelta !== 0) return learnerDelta;

  return sourceSessionLabel(a).localeCompare(sourceSessionLabel(b));
}

function matchesSearchTerm(event: TimetableEvent, searchTerm: string) {
  if (!searchTerm) return true;
  const normalizedSearch = searchTerm.trim().toLowerCase();
  if (!normalizedSearch) return true;

  const searchableText = [
    event.title,
    event.learner,
    event.email,
    event.learnerId,
    event.employer,
    event.managerEmail,
    event.tutor,
    event.programme,
    event.cohort,
    event.location,
    event.notes,
    event.timeLabel,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return normalizedSearch
    .split(/\s+/)
    .filter(Boolean)
    .every(token => searchableText.includes(token));
}

function EventDetailTile({ icon, label, value, sub }: { icon: string; label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-background-200 bg-background-50 px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-foreground-400">
        <i className={`${icon} text-[11px]`}></i>
        {label}
      </div>
      <div className="truncate text-[12px] font-bold text-foreground-950">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[10px] font-medium text-foreground-500">{sub}</div>}
    </div>
  );
}

function EventDetailLine({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-background-100 bg-white px-3 py-2 text-[11px] font-medium text-foreground-600">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-400">
        <i className={icon}></i>
      </span>
      <div className="min-w-0 flex-1 truncate">{children}</div>
    </div>
  );
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Page
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export default function CoachTimetablePage() {
  const location = useLocation();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStartTime = todayStart.getTime();
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState(now.getDate());
  const [selectedEvent, setSelectedEvent] = useState<TimetableEvent | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [filterSource, setFilterSource] = useState<SourceFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [events, setEvents] = useState<TimetableEvent[]>([]);
  const [schedulerCatchUpEvents, setSchedulerCatchUpEvents] = useState<TimetableEvent[]>([]);
  const [summary, setSummary] = useState<TimetableSummary>(EMPTY_SUMMARY);
  const [createSessionOpen, setCreateSessionOpen] = useState(false);
  const [createSessionType, setCreateSessionType] = useState<CoachBookableSessionType>('catch-up');
  const [createSessionLearnerId, setCreateSessionLearnerId] = useState('');
  const [createSessionLearnerSearch, setCreateSessionLearnerSearch] = useState('');
  const [createSessionLearnerPickerOpen, setCreateSessionLearnerPickerOpen] = useState(false);
  const [createSessionDate, setCreateSessionDate] = useState('');
  const [createSessionTime, setCreateSessionTime] = useState('09:00');
  const [createSessionDuration, setCreateSessionDuration] = useState(60);
  const [createSessionNotes, setCreateSessionNotes] = useState('');
  const [createSessionBusy, setCreateSessionBusy] = useState(false);
  const [createSessionError, setCreateSessionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduleDuration, setScheduleDuration] = useState(60);
  const [eventActionBusy, setEventActionBusy] = useState(false);
  const [eventActionError, setEventActionError] = useState<string | null>(null);
  const [eventActionNotice, setEventActionNotice] = useState<string | null>(null);
  const [progressReviewCompletionEvent, setProgressReviewCompletionEvent] = useState<TimetableEvent | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleModalType, setScheduleModalType] = useState<SchedulableSource>('mcr');
  const [scheduleModalLearnerKey, setScheduleModalLearnerKey] = useState('');
  const [scheduleModalEventKey, setScheduleModalEventKey] = useState('');
  const [scheduleModalDate, setScheduleModalDate] = useState('');
  const [scheduleModalTime, setScheduleModalTime] = useState('09:00');
  const [scheduleModalDuration, setScheduleModalDuration] = useState(60);
  const [scheduleModalBusy, setScheduleModalBusy] = useState(false);
  const [scheduleModalError, setScheduleModalError] = useState<string | null>(null);
  const [scheduleModalNotice, setScheduleModalNotice] = useState<string | null>(null);
  const [pendingScheduleIntent, setPendingScheduleIntent] = useState<ScheduleNavigationIntent | null>(() => (
    parseScheduleNavigationIntent((location.state as { scheduleIntent?: unknown } | null)?.scheduleIntent)
  ));

  const todayDay = now.getDate();
  const todayMonth = now.getMonth();
  const todayYear = now.getFullYear();
  const currentHour = now.getHours();
  const todayWeekdayLabel = DAYS_OF_WEEK[now.getDay() === 0 ? 6 : now.getDay() - 1].toUpperCase();
  const todayMonthLabel = MONTH_NAMES[todayMonth].slice(0, 3).toUpperCase();

  const isToday = useCallback((day: number, month: number, year: number) => {
    return day === todayDay && month === todayMonth && year === todayYear;
  }, [todayDay, todayMonth, todayYear]);

  const applyEventsUpdate = useCallback((nextEvents: TimetableEvent[], nextSelectedEventId?: string | null) => {
    setEvents(nextEvents);
    setSummary(buildFallbackSummary(nextEvents));
    if (nextSelectedEventId) {
      const nextSelectedEvent = nextEvents.find(event => event.id === nextSelectedEventId) || null;
      setSelectedEvent(nextSelectedEvent);
      return nextSelectedEvent;
    }
    return null;
  }, []);

  const updateSingleEvent = useCallback((updatedEvent: TimetableEvent) => {
    const existingIndex = events.findIndex(event => event.id === updatedEvent.id);
    const nextEvents = existingIndex >= 0
      ? events.map(event => event.id === updatedEvent.id ? updatedEvent : event)
      : [...events, updatedEvent];
    nextEvents.sort((a, b) => {
      const dateDelta = parseEventDate(a).getTime() - parseEventDate(b).getTime();
      if (dateDelta !== 0) return dateDelta;
      const timeDelta = a.startHour - b.startHour;
      if (timeDelta !== 0) return timeDelta;
      return (a.learner || '').localeCompare(b.learner || '');
    });

    if (updatedEvent.source === 'catch-up') {
      setSchedulerCatchUpEvents(current => {
        const hasMatch = current.some(event => eventIdentity(event) === eventIdentity(updatedEvent));
        if (hasMatch) {
          return current.map(event => eventIdentity(event) === eventIdentity(updatedEvent) ? updatedEvent : event);
        }
        return [...current, updatedEvent];
      });
    }

    const nextSelectedEvent = applyEventsUpdate(nextEvents, updatedEvent.id);
    return nextSelectedEvent || updatedEvent;
  }, [applyEventsUpdate, events]);

  const loadTimetable = useCallback(async () => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(API_ENDPOINT);
        if (!response.ok) throw new Error(`Request failed with ${response.status}`);

        const data: TimetableResponse = await response.json();
        if (cancelled) return;

        const nextEvents = data.events || [];
        const nextSummary = data.summary ? normalizeSummary(data.summary, nextEvents) : buildFallbackSummary(nextEvents);
        const anchorDate = new Date();

        setEvents(nextEvents);
        setSchedulerCatchUpEvents(data.schedulerQueues?.catchUp || []);
        setSummary(nextSummary);
        setViewYear(anchorDate.getFullYear());
        setViewMonth(anchorDate.getMonth());
        setSelectedDay(anchorDate.getDate());
        setSelectedEvent(currentSelectedEvent => {
          if (!currentSelectedEvent) return null;
          return nextEvents.find(event => event.id === currentSelectedEvent.id) || null;
        });
      } catch (err) {
        if (cancelled) return;

        setError(err instanceof Error ? err.message : 'Unable to load timetable data');
        setEvents([]);
        setSchedulerCatchUpEvents([]);
        setSummary(EMPTY_SUMMARY);
        setSelectedEvent(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    await run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    loadTimetable().then(result => {
      cleanup = result;
    });
    return () => {
      if (cleanup) cleanup();
    };
  }, [loadTimetable]);

  useEffect(() => {
    const nextIntent = parseScheduleNavigationIntent((location.state as { scheduleIntent?: unknown } | null)?.scheduleIntent);
    if (!nextIntent) return;
    setPendingScheduleIntent(nextIntent);
  }, [location.key, location.state]);

  useEffect(() => {
    if (!selectedEvent) {
      setScheduleDate('');
      setScheduleTime('09:00');
      setScheduleDuration(60);
      setEventActionError(null);
      setEventActionNotice(null);
      return;
    }

    setScheduleDate(selectedEvent.scheduledDate || selectedEvent.targetDate || selectedEvent.date || '');
    setScheduleTime(selectedEvent.scheduledTime || '09:00');
    setScheduleDuration(selectedEvent.durationMinutes || 60);
    setEventActionError(null);
    setEventActionNotice(selectedEvent.syncWarning || null);
  }, [selectedEvent]);

  const todayInputValue = formatDateInputValue(todayYear, todayMonth, todayDay);

  const createSessionLearnerOptions = useMemo(() => {
    const learnerMap = new Map<string, { name: string; programme: string; cohort: string; email: string }>();
    const registerLearner = (event: TimetableEvent) => {
      if (!event.learnerId) return;
      if (learnerMap.has(event.learnerId)) return;
      learnerMap.set(event.learnerId, {
        name: event.learner || 'Learner',
        programme: event.programme || '--',
        cohort: event.cohort || '--',
        email: event.email || '--',
      });
    };

    schedulerCatchUpEvents.forEach(registerLearner);
    events.forEach(registerLearner);

    return [...learnerMap.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([value, learner]) => ({
        value,
        name: learner.name,
        programme: learner.programme,
        cohort: learner.cohort,
        email: learner.email,
        label: learner.programme && learner.programme !== '--'
          ? `${learner.name} · ${learner.programme}`
          : learner.name,
      }));
  }, [events, schedulerCatchUpEvents]);

  const selectedCreateSessionLearner = useMemo(
    () => createSessionLearnerOptions.find(option => option.value === createSessionLearnerId) || null,
    [createSessionLearnerId, createSessionLearnerOptions],
  );

  const filteredCreateSessionLearners = useMemo(() => {
    const term = createSessionLearnerSearch.trim().toLowerCase();
    if (!term) return createSessionLearnerOptions;
    return createSessionLearnerOptions.filter(option => (
      `${option.name} ${option.programme} ${option.cohort} ${option.email}`.toLowerCase().includes(term)
    ));
  }, [createSessionLearnerOptions, createSessionLearnerSearch]);

  const getDefaultCreateSessionDate = useCallback(() => {
    const selectedDate = new Date(viewYear, viewMonth, Math.min(selectedDay, getDaysInMonth(viewYear, viewMonth)));
    const selectedDateAtStart = startOfDay(selectedDate);
    if (selectedDateAtStart.getTime() < todayStartTime) return todayInputValue;
    return formatDateInputValue(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
  }, [selectedDay, todayInputValue, todayStartTime, viewMonth, viewYear]);

  const schedulableEvents = useMemo(() => {
    const nonCatchUpEvents = events.filter(event => event.source !== 'catch-up' && isSelectableScheduleEvent(event));
    const catchUpEventMap = new Map<string, TimetableEvent>();

    schedulerCatchUpEvents.forEach(event => {
      catchUpEventMap.set(eventIdentity(event), event);
    });

    events
      .filter(event => event.source === 'catch-up')
      .forEach(event => {
        catchUpEventMap.set(eventIdentity(event), event);
      });

    const catchUpScheduleEvents = [...catchUpEventMap.values()].filter(isSelectableScheduleEvent);
    return [...nonCatchUpEvents, ...catchUpScheduleEvents].sort(compareSchedulablePriority);
  }, [events, schedulerCatchUpEvents]);

  const scheduleSourceCounts = useMemo(() => {
    return SCHEDULABLE_SOURCE_ORDER.reduce((acc, source) => {
      acc[source] = schedulableEvents.filter(event => event.source === source).length;
      return acc;
    }, {} as Record<SchedulableSource, number>);
  }, [schedulableEvents]);

  const scheduleTypeEvents = useMemo(
    () => schedulableEvents.filter(event => event.source === scheduleModalType),
    [schedulableEvents, scheduleModalType],
  );

  const scheduleLearnerOptions = useMemo(() => {
    const uniqueLearners = new Map<string, { value: string; label: string; event: TimetableEvent }>();

    scheduleTypeEvents.forEach(event => {
      const key = learnerIdentity(event);
      const existing = uniqueLearners.get(key);
      if (!existing || compareSchedulablePriority(event, existing.event) < 0) {
        uniqueLearners.set(key, {
          value: key,
          label: scheduleLearnerOptionLabel(event),
          event,
        });
      }
    });

    return [...uniqueLearners.values()]
      .sort((a, b) => {
        const priorityDelta = compareSchedulablePriority(a.event, b.event);
        if (priorityDelta !== 0) return priorityDelta;
        return a.label.localeCompare(b.label);
      })
      .map(({ value, label }) => ({ value, label }));
  }, [scheduleTypeEvents]);

  const scheduleEventOptions = useMemo(
    () => scheduleTypeEvents.filter(event => !scheduleModalLearnerKey || learnerIdentity(event) === scheduleModalLearnerKey),
    [scheduleModalLearnerKey, scheduleTypeEvents],
  );

  const scheduleEventSelectOptions = useMemo(
    () => scheduleEventOptions.map(event => ({
      value: eventIdentity(event),
      label: scheduleSessionOptionLabel(event),
    })),
    [scheduleEventOptions],
  );

  const selectedScheduleEvent = useMemo(() => {
    return scheduleEventOptions.find(event => eventIdentity(event) === scheduleModalEventKey) || scheduleEventOptions[0] || null;
  }, [scheduleEventOptions, scheduleModalEventKey]);

  useEffect(() => {
    if (!scheduleModalOpen) return;
    const currentLearnerStillAvailable = scheduleLearnerOptions.some(option => option.value === scheduleModalLearnerKey);
    if (currentLearnerStillAvailable) return;
    setScheduleModalLearnerKey(scheduleLearnerOptions[0]?.value || '');
  }, [scheduleLearnerOptions, scheduleModalLearnerKey, scheduleModalOpen]);

  useEffect(() => {
    if (!scheduleModalOpen) return;
    const currentEventStillAvailable = scheduleEventOptions.some(event => eventIdentity(event) === scheduleModalEventKey);
    if (currentEventStillAvailable) return;
    setScheduleModalEventKey(scheduleEventOptions[0] ? eventIdentity(scheduleEventOptions[0]) : '');
  }, [scheduleEventOptions, scheduleModalEventKey, scheduleModalOpen]);

  useEffect(() => {
    if (!scheduleModalOpen) return;
    if (!selectedScheduleEvent) {
      setScheduleModalDate('');
      setScheduleModalTime('09:00');
      setScheduleModalDuration(60);
      setScheduleModalError(null);
      setScheduleModalNotice(null);
      return;
    }

    setScheduleModalDate(
      selectedScheduleEvent.scheduledDate
      || selectedScheduleEvent.targetDate
      || selectedScheduleEvent.date
      || formatDateInputValue(viewYear, viewMonth, selectedDay),
    );
    setScheduleModalTime(selectedScheduleEvent.scheduledTime || '09:00');
    setScheduleModalDuration(selectedScheduleEvent.durationMinutes || (selectedScheduleEvent.source === 'catch-up' ? 45 : 60));
    setScheduleModalError(null);
    setScheduleModalNotice(selectedScheduleEvent.syncWarning || null);
  }, [scheduleModalOpen, selectedDay, selectedScheduleEvent, viewMonth, viewYear]);

  useEffect(() => {
    if (!scheduleModalOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !scheduleModalBusy) {
        setScheduleModalOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [scheduleModalBusy, scheduleModalOpen]);

  useEffect(() => {
    if (!createSessionOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !createSessionBusy) {
        setCreateSessionOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [createSessionBusy, createSessionOpen]);

  const monthCells = useMemo(() => getMonthData(viewYear, viewMonth), [viewYear, viewMonth]);
  const weekDates = useMemo(() => getWeekDates(viewYear, viewMonth, selectedDay), [viewYear, viewMonth, selectedDay]);
  const visibleRangeEvents = useMemo(() => {
    if (viewMode === 'day') {
      return events.filter(event => event.dayOfMonth === selectedDay && event.month === viewMonth && event.year === viewYear);
    }

    if (viewMode === 'week') {
      const weekKeys = new Set(weekDates.map(date => `${date.year}-${date.month}-${date.day}`));
      return events.filter(event => weekKeys.has(`${event.year}-${event.month}-${event.dayOfMonth}`));
    }

    return events.filter(event => event.month === viewMonth && event.year === viewYear);
  }, [events, selectedDay, viewMode, viewMonth, viewYear, weekDates]);

  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const searchedVisibleRangeEvents = useMemo(() => {
    return visibleRangeEvents.filter(event => matchesSearchTerm(event, normalizedSearchTerm));
  }, [normalizedSearchTerm, visibleRangeEvents]);

  const sourceFilterOptions = useMemo(() => {
    return SOURCE_FILTER_ORDER.map(source => ({
      value: source,
      label: SOURCE_FILTER_CHIP_LABELS[source],
      dot: SOURCE_FILTER_DOTS[source],
      count: source === 'all'
        ? searchedVisibleRangeEvents.length
        : searchedVisibleRangeEvents.filter(event => eventMatchesSourceFilter(event, source)).length,
    }));
  }, [searchedVisibleRangeEvents]);

  const sourceFilteredVisibleRangeEvents = useMemo(() => {
    if (filterSource === 'all') return searchedVisibleRangeEvents;
    return searchedVisibleRangeEvents.filter(event => eventMatchesSourceFilter(event, filterSource));
  }, [filterSource, searchedVisibleRangeEvents]);

  const filteredEvents = useMemo(() => sourceFilteredVisibleRangeEvents.filter(e => {
    if (filterStatus === 'overdue' && !isOverdueMetricEvent(e)) return false;
    if (filterStatus === 'due-soon' && !isDueSoonMetricEvent(e)) return false;
    if (filterStatus === 'needs-schedule' && !needsSchedulingMetricEvent(e)) return false;
    if (filterStatus === 'scheduled' && !isScheduledMetricEvent(e)) return false;
    if (filterStatus === 'in-progress' && e.status !== 'in-progress') return false;
    if (filterStatus === 'completed' && !isCompletedMetricEvent(e)) return false;
    if (filterStatus === 'cancelled' && e.status !== 'cancelled') return false;
    return true;
  }), [filterStatus, sourceFilteredVisibleRangeEvents]);

  const selectedDayEvents = useMemo(
    () => filteredEvents.filter(ev => ev.dayOfMonth === selectedDay && ev.month === viewMonth && ev.year === viewYear),
    [filteredEvents, selectedDay, viewMonth, viewYear],
  );
  const upcomingEvents = useMemo(() => {
    return events
      .filter(ev => {
        const evDate = parseEventDate(ev);
        return evDate.getTime() >= todayStartTime && ev.status !== 'completed' && ev.status !== 'cancelled';
      })
      .sort((a, b) => {
        const dateDelta = parseEventDate(a).getTime() - parseEventDate(b).getTime();
        if (dateDelta !== 0) return dateDelta;
        return a.startHour - b.startHour;
      })
      .slice(0, 5);
  }, [events, todayStartTime]);
  const statusFilterCounts: Record<StatusFilter, number> = {
    all: sourceFilteredVisibleRangeEvents.length,
    overdue: sourceFilteredVisibleRangeEvents.filter(event => isOverdueMetricEvent(event)).length,
    'due-soon': sourceFilteredVisibleRangeEvents.filter(event => isDueSoonMetricEvent(event)).length,
    'needs-schedule': sourceFilteredVisibleRangeEvents.filter(needsSchedulingMetricEvent).length,
    scheduled: sourceFilteredVisibleRangeEvents.filter(isScheduledMetricEvent).length,
    'in-progress': sourceFilteredVisibleRangeEvents.filter(event => event.status === 'in-progress').length,
    completed: sourceFilteredVisibleRangeEvents.filter(isCompletedMetricEvent).length,
    cancelled: sourceFilteredVisibleRangeEvents.filter(event => event.status === 'cancelled').length,
  };
  const selectedDayLabel = `${DAYS_OF_WEEK[new Date(viewYear, viewMonth, selectedDay).getDay() === 0 ? 6 : new Date(viewYear, viewMonth, selectedDay).getDay() - 1]}, ${selectedDay} ${MONTH_NAMES[viewMonth]}`;
  const activeFilterLabel = filterSource === 'all'
    ? STATUS_FILTER_LABELS[filterStatus]
    : `${SOURCE_FILTER_CHIP_LABELS[filterSource]} / ${STATUS_FILTER_LABELS[filterStatus]}`;

  const datePickerValue = formatDateInputValue(viewYear, viewMonth, selectedDay);

  const setCalendarDate = useCallback((year: number, month: number, day: number) => {
    setViewYear(year);
    setViewMonth(month);
    setSelectedDay(Math.min(day, getDaysInMonth(year, month)));
  }, []);

  const handlePrev = () => {
    if (viewMode === 'month') { if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); } else setViewMonth(viewMonth - 1); }
    else if (viewMode === 'day') { const d = new Date(viewYear, viewMonth, selectedDay); d.setDate(d.getDate() - 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setSelectedDay(d.getDate()); }
    else { const d = new Date(viewYear, viewMonth, selectedDay); d.setDate(d.getDate() - 7); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setSelectedDay(d.getDate()); }
  };
  const handleNext = () => {
    if (viewMode === 'month') { if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); } else setViewMonth(viewMonth + 1); }
    else if (viewMode === 'day') { const d = new Date(viewYear, viewMonth, selectedDay); d.setDate(d.getDate() + 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setSelectedDay(d.getDate()); }
    else { const d = new Date(viewYear, viewMonth, selectedDay); d.setDate(d.getDate() + 7); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setSelectedDay(d.getDate()); }
  };
  const handleToday = () => { setViewYear(todayYear); setViewMonth(todayMonth); setSelectedDay(todayDay); };

  const handleMonthPickerChange = (month: number) => {
    setCalendarDate(viewYear, month, selectedDay);
  };

  const handleYearPickerChange = (year: number) => {
    if (!Number.isFinite(year) || year < 1900 || year > 2200) return;
    setCalendarDate(year, viewMonth, selectedDay);
  };

  const handleDatePickerChange = (value: string) => {
    const parsedDate = parseDateOnly(value);
    if (!parsedDate) return;
    setCalendarDate(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
    setDatePickerOpen(false);
  };

  const handleDayClick = (day: number) => {
    setSelectedDay(day);
  };

  const openCreateSessionModal = useCallback(() => {
    const preferredLearnerId = selectedEvent?.learnerId && createSessionLearnerOptions.some(option => option.value === selectedEvent.learnerId)
      ? selectedEvent.learnerId
      : (createSessionLearnerOptions[0]?.value || '');
    const preferredType: CoachBookableSessionType = selectedEvent?.source === 'student-support' || selectedEvent?.type === 'welfare'
      ? 'student-support'
      : 'catch-up';

    setCreateSessionType(preferredType);
    setCreateSessionLearnerId(preferredLearnerId);
    setCreateSessionDate(getDefaultCreateSessionDate());
    setCreateSessionTime('09:00');
    setCreateSessionDuration(60);
    setCreateSessionNotes('');
    setCreateSessionError(null);
    setCreateSessionLearnerSearch('');
    setCreateSessionLearnerPickerOpen(false);
    setCreateSessionOpen(true);
  }, [createSessionLearnerOptions, getDefaultCreateSessionDate, selectedEvent]);

  const closeCreateSessionModal = useCallback(() => {
    if (createSessionBusy) return;
    setCreateSessionOpen(false);
    setCreateSessionLearnerSearch('');
    setCreateSessionLearnerPickerOpen(false);
    setCreateSessionError(null);
  }, [createSessionBusy]);

  const openScheduleModal = useCallback((presetEvent?: TimetableEvent | null) => {
    setScheduleModalError(null);
    setScheduleModalNotice(null);

    if (presetEvent && isSelectableScheduleEvent(presetEvent)) {
      setScheduleModalType(presetEvent.source as SchedulableSource);
      setScheduleModalLearnerKey(learnerIdentity(presetEvent));
      setScheduleModalEventKey(eventIdentity(presetEvent));
    } else {
      const preferredEvent = schedulableEvents[0];

      if (preferredEvent) {
        setScheduleModalType(preferredEvent.source as SchedulableSource);
        setScheduleModalLearnerKey(learnerIdentity(preferredEvent));
        setScheduleModalEventKey(eventIdentity(preferredEvent));
      } else {
        setScheduleModalLearnerKey('');
        setScheduleModalEventKey('');
      }
    }

    setScheduleModalOpen(true);
  }, [schedulableEvents]);

  const closeScheduleModal = useCallback(() => {
    if (scheduleModalBusy) return;
    setScheduleModalOpen(false);
    setScheduleModalError(null);
    setScheduleModalNotice(null);
  }, [scheduleModalBusy]);

  useEffect(() => {
    if (!pendingScheduleIntent || loading) return;

    setViewMode('month');
    setFilterStatus('needs-schedule');
    setFilterSource(pendingScheduleIntent.source);
    setSearchTerm('');
    setScheduleModalOpen(false);
    setScheduleModalError(null);
    setScheduleModalNotice(null);

    const sourceEvents = schedulableEvents.filter((event) => event.source === pendingScheduleIntent.source);
    const learnerEvents = pendingScheduleIntent.learnerId
      ? sourceEvents.filter((event) => event.learnerId === pendingScheduleIntent.learnerId)
      : sourceEvents;
    const preferredPool = learnerEvents.length ? learnerEvents : sourceEvents;
    const preferredEvent = preferredPool.find((event) => {
      if (!pendingScheduleIntent.targetDate) return false;
      return (
        eventTargetDateValue(event) === pendingScheduleIntent.targetDate
        || event.date === pendingScheduleIntent.targetDate
        || event.scheduledDate === pendingScheduleIntent.targetDate
      );
    }) || preferredPool[0] || null;

    const anchorDate = parseDateOnly(pendingScheduleIntent.targetDate)
      || (preferredEvent ? getMetricDate(eventTargetDateValue(preferredEvent), preferredEvent) : null);

    if (anchorDate) {
      setCalendarDate(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
    }

    if (preferredEvent) {
      setSelectedEvent(preferredEvent);
    } else {
      setSelectedEvent(null);
    }

    setPendingScheduleIntent(null);
  }, [loading, pendingScheduleIntent, schedulableEvents, setCalendarDate]);

  const handleScheduleSave = useCallback(async () => {
    if (!selectedEvent?.eventKey || !selectedEvent.ownerEmail) return;

    setEventActionBusy(true);
    setEventActionError(null);
    setEventActionNotice(null);
    try {
      const response = await fetch(SCHEDULE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventKey: selectedEvent.eventKey,
          ownerEmail: selectedEvent.ownerEmail,
          scheduledDate: scheduleDate,
          scheduledTime: scheduleTime,
          durationMinutes: scheduleDuration,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Request failed with ${response.status}`);
      const updatedEvent = data.event as TimetableEvent;
      updateSingleEvent(updatedEvent);
      if (data.warning) setEventActionNotice(data.warning as string);
    } catch (err) {
      setEventActionError(err instanceof Error ? err.message : 'Unable to schedule event');
    } finally {
      setEventActionBusy(false);
    }
  }, [scheduleDate, scheduleDuration, scheduleTime, selectedEvent, updateSingleEvent]);

  const handleCreateSession = useCallback(async () => {
    if (!createSessionLearnerId || !createSessionDate || !createSessionTime) return;

    setCreateSessionBusy(true);
    setCreateSessionError(null);
    try {
      const response = await fetch(BOOK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learnerId: createSessionLearnerId,
          sessionType: createSessionType,
          scheduledDate: createSessionDate,
          scheduledTime: createSessionTime,
          durationMinutes: createSessionDuration,
          notes: createSessionNotes,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Request failed with ${response.status}`);

      const createdEvent = data.event as TimetableEvent;
      updateSingleEvent(createdEvent);
      if (createdEvent.source === 'catch-up') {
        setSchedulerCatchUpEvents(current => {
          const filtered = current.filter(event => event.learnerId !== createdEvent.learnerId);
          return [...filtered, createdEvent].sort(compareSchedulablePriority);
        });
      }

      setFilterSource('all');
      setFilterStatus('all');
      setCalendarDate(createdEvent.year, createdEvent.month, createdEvent.dayOfMonth);
      setViewMode('day');
      setSelectedEvent(createdEvent);
      setEventActionError(null);
      setEventActionNotice(typeof data.warning === 'string' && data.warning ? data.warning : null);
      setCreateSessionOpen(false);
      setCreateSessionLearnerSearch('');
      setCreateSessionLearnerPickerOpen(false);
    } catch (err) {
      setCreateSessionError(err instanceof Error ? err.message : 'Unable to create session');
    } finally {
      setCreateSessionBusy(false);
    }
  }, [
    createSessionDate,
    createSessionDuration,
    createSessionLearnerId,
    createSessionNotes,
    createSessionTime,
    createSessionType,
    setCalendarDate,
    updateSingleEvent,
  ]);

  const handleModalScheduleSave = useCallback(async () => {
    if (!selectedScheduleEvent?.eventKey || !selectedScheduleEvent.ownerEmail) return;

    setScheduleModalBusy(true);
    setScheduleModalError(null);
    setScheduleModalNotice(null);
    try {
      const response = await fetch(SCHEDULE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventKey: selectedScheduleEvent.eventKey,
          ownerEmail: selectedScheduleEvent.ownerEmail,
          scheduledDate: scheduleModalDate,
          scheduledTime: scheduleModalTime,
          durationMinutes: scheduleModalDuration,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Request failed with ${response.status}`);

      const updatedEvent = data.event as TimetableEvent;
      updateSingleEvent(updatedEvent);
      setCalendarDate(updatedEvent.year, updatedEvent.month, updatedEvent.dayOfMonth);
      setViewMode('day');
      setSelectedEvent(updatedEvent);
      setEventActionError(null);
      setEventActionNotice(typeof data.warning === 'string' && data.warning ? data.warning : null);
      setScheduleModalOpen(false);
    } catch (err) {
      setScheduleModalError(err instanceof Error ? err.message : 'Unable to schedule event');
    } finally {
      setScheduleModalBusy(false);
    }
  }, [
    scheduleModalDate,
    scheduleModalDuration,
    scheduleModalTime,
    selectedScheduleEvent,
    setCalendarDate,
    updateSingleEvent,
  ]);

  const openSelectedProgressReviewForm = useCallback(() => {
    if (!selectedEvent || selectedEvent.source !== 'progress-review') return;
    setEventActionError(null);
    setEventActionNotice(null);
    setProgressReviewCompletionEvent(selectedEvent);
  }, [selectedEvent]);

  const handleProgressReviewSubmit = useCallback(async (responses: ProgressReviewResponses) => {
    if (!progressReviewCompletionEvent?.eventKey || !progressReviewCompletionEvent.ownerEmail) return;

    setEventActionBusy(true);
    setEventActionError(null);
    setEventActionNotice(null);
    try {
      const response = await fetch(ACTION_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventKey: progressReviewCompletionEvent.eventKey,
          ownerEmail: progressReviewCompletionEvent.ownerEmail,
          action: 'complete',
          reviewResponses: responses,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Request failed with ${response.status}`);
      const updatedEvent = data.event as TimetableEvent;
      updateSingleEvent(updatedEvent);
      setProgressReviewCompletionEvent(null);
      if (data.warning) setEventActionNotice(data.warning as string);
    } catch (err) {
      setEventActionError(err instanceof Error ? err.message : 'Unable to submit progress review');
    } finally {
      setEventActionBusy(false);
    }
  }, [progressReviewCompletionEvent, updateSingleEvent]);

  const handleJoinSelectedMeeting = useCallback(() => {
    if (!selectedEvent) return;
    const url = selectedEvent.meetingLink || selectedEvent.graphWebLink;
    if (!url) {
      setEventActionError('This event does not have a meeting link yet. Schedule it again first.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [selectedEvent]);

  const handleEventAction = useCallback(async (action: 'start' | 'complete' | 'sign' | 'cancel') => {
    if (!selectedEvent?.eventKey || !selectedEvent.ownerEmail) return;
    if (action === 'complete' && selectedEvent.source === 'progress-review') {
      setEventActionError(null);
      setEventActionNotice(null);
      setProgressReviewCompletionEvent(selectedEvent);
      return;
    }

    setEventActionBusy(true);
    setEventActionError(null);
    setEventActionNotice(null);
    try {
      const response = await fetch(ACTION_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventKey: selectedEvent.eventKey,
          ownerEmail: selectedEvent.ownerEmail,
          action,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Request failed with ${response.status}`);
      const updatedEvent = data.event as TimetableEvent;
      const nextSelectedEvent = updateSingleEvent(updatedEvent);
      if (data.warning) setEventActionNotice(data.warning as string);
      if (action === 'start' && (nextSelectedEvent.meetingLink || nextSelectedEvent.graphWebLink)) {
        window.open(nextSelectedEvent.meetingLink || nextSelectedEvent.graphWebLink, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setEventActionError(err instanceof Error ? err.message : 'Unable to update event');
    } finally {
      setEventActionBusy(false);
    }
  }, [selectedEvent, updateSingleEvent]);

  const titleLabel = viewMode === 'month'
    ? `${MONTH_NAMES[viewMonth]} ${viewYear}`
    : viewMode === 'week'
      ? `${weekDates[0].monthName} ${weekDates[0].day} - ${weekDates[6].monthName} ${weekDates[6].day}, ${viewYear}`
      : `${selectedDay} ${MONTH_NAMES[viewMonth]} ${viewYear}`;

  return (
    <WorkspaceShell
      role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Calendar" pageSubtitle="Your coaching schedule, sessions, and meetings - all in one place"
      userName="Med Maher" userRole="Progress Coach"
    >
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">

        {/* â•â•â•â•â•â•â•â•â•â•â• HERO BANNER â•â•â•â•â•â•â•â•â•â•â• */}
        <section
          className="relative overflow-hidden rounded-[28px] border border-white/10 shadow-[0_22px_60px_-32px_rgba(27,9,68,0.9)]"
          style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 42%, oklch(var(--primary-800)) 100%)' }}
        >
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div
              className="absolute opacity-25"
              style={{ width: '52%', height: '44%', left: '-5%', top: '-12%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.32) 0%, transparent 70%)', filter: 'blur(60px)' }}
            />
            <div
              className="absolute opacity-20"
              style={{ width: '44%', height: '42%', right: '-6%', top: '4%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.28) 0%, transparent 72%)', filter: 'blur(58px)' }}
            />
          </div>
          <div className="relative flex min-h-[220px] flex-col gap-6 px-5 py-5 md:px-7 md:py-6 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-accent-300/20 bg-accent-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-accent-200">Progress Coach</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/90">{MONTH_NAMES[viewMonth]} {viewYear}</span>
              </div>
              <h1 className="max-w-xl text-[28px] font-heading font-bold tracking-tight text-white md:text-[34px]">My Calendar</h1>
              <p className="mt-3 max-w-xl text-sm font-medium leading-6 text-white/80 md:text-[15px]">
                Plan monthly coaching reviews, progress reviews, catch-up sessions, and learner support from one clean scheduling workspace.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={openCreateSessionModal}
                  className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-primary-800 shadow-lg shadow-foreground-950/20 transition-smooth hover:-translate-y-0.5 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-white/40 cursor-pointer"
                >
                  <i className="ri-add-circle-line text-base"></i>
                  Create Session
                </button>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[12px] text-white/75 backdrop-blur-sm">
                  Create a <span className="font-semibold text-white">catch-up or support session</span> and add it straight to the learner calendar.
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-center lg:w-[380px]">
              <div className="relative">
                <div className="rounded-[28px] border border-white/10 bg-white/10 p-3 shadow-[0_24px_55px_-30px_rgba(9,4,28,0.75)] backdrop-blur-md">
                  <div className="relative w-[150px] overflow-hidden rounded-[24px] bg-white shadow-[0_12px_28px_-20px_rgba(10,10,20,0.55)] md:w-[168px]">
                    <div className="bg-[#ef4444] px-3 pb-3 pt-2.5">
                      <div className="flex items-center justify-between">
                        {[0, 1, 2, 3, 4, 5].map(index => (
                          <span key={index} className="relative flex h-5 w-2.5 items-start justify-center">
                            <span className="absolute top-0 h-3.5 w-1 rounded-full bg-slate-700"></span>
                            <span className="absolute top-1 h-4.5 w-2 rounded-full border border-black/15 bg-white/85 shadow-sm"></span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="px-4 pb-4 pt-3 text-center">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-foreground-500">{todayMonthLabel}</p>
                      <p className="mt-2 text-5xl font-heading font-bold leading-none text-foreground-950 md:text-6xl">
                        {String(todayDay).padStart(2, '0')}
                      </p>
                      <p className="mt-2.5 text-[10px] font-semibold uppercase tracking-[0.34em] text-foreground-500">{todayWeekdayLabel}</p>
                    </div>
                    <div className="pointer-events-none absolute bottom-0 right-0 h-14 w-14 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.94),_rgba(226,232,240,0.82)_42%,_rgba(148,163,184,0.3)_72%,_transparent_74%)] opacity-95"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* â•â•â•â•â•â•â•â•â•â•â• CONTROLS BAR â•â•â•â•â•â•â•â•â•â•â• */}
        {loading && (
          <div className="overflow-hidden rounded-[24px] border border-primary-200/70 bg-gradient-to-r from-primary-50 via-background-50 to-primary-50 shadow-sm">
            <div className="flex flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-500 text-white shadow-md shadow-primary-500/20">
                  <i className="ri-loader-4-line animate-spin text-lg"></i>
                </span>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-500">Syncing timetable</p>
                  <p className="mt-1 text-sm font-heading font-semibold text-foreground-900">Loading your coaching calendar</p>
                  <p className="mt-1 text-[12px] leading-5 text-foreground-500">
                    Preparing sessions, reviews, catch-up, and support events for the current view.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 md:min-w-[240px]">
                <div className="h-14 rounded-2xl border border-primary-100/80 bg-white/70 animate-pulse"></div>
                <div className="h-14 rounded-2xl border border-primary-100/80 bg-white/70 animate-pulse"></div>
                <div className="h-14 rounded-2xl border border-primary-100/80 bg-white/70 animate-pulse"></div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200/70 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-background-200 bg-white p-3 shadow-sm ring-1 ring-black/[0.02]">
          <div className="grid gap-3 xl:grid-cols-[auto_minmax(260px,360px)] xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-xl bg-background-100 p-1">
                {([
                  { key: 'month' as ViewMode, label: 'Month', icon: 'ri-calendar-2-line' },
                  { key: 'week' as ViewMode, label: 'Week', icon: 'ri-calendar-view' },
                  { key: 'day' as ViewMode, label: 'Day', icon: 'ri-calendar-line' },
                ]).map(v => (
                  <button
                    key={v.key}
                    aria-pressed={viewMode === v.key}
                    onClick={() => { setViewMode(v.key); if (v.key === 'month') setSelectedDay(todayDay); }}
                    className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-[11px] font-bold transition-smooth whitespace-nowrap cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200 ${
                      viewMode === v.key
                        ? 'bg-primary-500 text-white shadow-md shadow-primary-500/20'
                        : 'text-foreground-500 hover:bg-white hover:text-foreground-900'
                    }`}
                  >
                    <i className={`${v.icon} text-xs`}></i>{v.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 rounded-xl border border-background-200 bg-background-50 p-1">
                <button
                  onClick={handlePrev}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-500 transition-smooth cursor-pointer hover:bg-white hover:text-primary-700"
                  aria-label="Previous period"
                >
                  <i className="ri-arrow-left-s-line"></i>
                </button>
                <button onClick={handleToday} className="h-8 rounded-lg bg-primary-50 px-3 text-[11px] font-bold text-primary-700 transition-smooth cursor-pointer whitespace-nowrap hover:bg-primary-100">Today</button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setDatePickerOpen(open => !open)}
                    className="h-8 min-w-[150px] rounded-lg px-3 text-center text-[12px] font-heading font-bold text-foreground-950 transition-smooth cursor-pointer hover:bg-white hover:text-primary-700 whitespace-nowrap"
                    title="Change calendar date"
                  >
                    {titleLabel}
                    <i className={`ri-arrow-down-s-line ml-1 text-xs transition-transform ${datePickerOpen ? 'rotate-180' : ''}`}></i>
                  </button>
                  {datePickerOpen && (
                    <div className="absolute left-1/2 top-full z-30 mt-2 w-72 -translate-x-1/2 rounded-2xl border border-background-200 bg-background-50 p-3 shadow-xl shadow-foreground-900/10">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-heading font-bold text-foreground-900">Jump to date</p>
                          <p className="text-[10px] text-foreground-400">
                            {viewMode === 'month' ? 'Choose month and year' : 'Choose a specific day'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDatePickerOpen(false)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-400 transition-smooth hover:bg-background-100 hover:text-foreground-700"
                          aria-label="Close date picker"
                        >
                          <i className="ri-close-line"></i>
                        </button>
                      </div>
                      {viewMode === 'month' ? (
                        <div className="grid grid-cols-[1fr_96px] gap-2">
                          <label className="block">
                            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Month</span>
                            <select
                              value={viewMonth}
                              onChange={(event) => handleMonthPickerChange(Number(event.target.value))}
                              className="w-full rounded-xl border border-background-200 bg-background-50 px-3 py-2 text-xs font-semibold text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-200"
                            >
                              {MONTH_NAMES.map((monthName, index) => (
                                <option key={monthName} value={index}>{monthName}</option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Year</span>
                            <input
                              type="number"
                              value={viewYear}
                              min={1900}
                              max={2200}
                              onChange={(event) => handleYearPickerChange(Number(event.target.value))}
                              className="w-full rounded-xl border border-background-200 bg-background-50 px-3 py-2 text-xs font-semibold text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-200"
                            />
                          </label>
                        </div>
                      ) : (
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Date</span>
                          <input
                            type="date"
                            value={datePickerValue}
                            onChange={(event) => handleDatePickerChange(event.target.value)}
                            className="w-full rounded-xl border border-background-200 bg-background-50 px-3 py-2 text-xs font-semibold text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-200"
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={handleNext}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-500 transition-smooth cursor-pointer hover:bg-white hover:text-primary-700"
                  aria-label="Next period"
                >
                  <i className="ri-arrow-right-s-line"></i>
                </button>
              </div>
            </div>
            <div className="relative w-full">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-xs"></i>
              <input
                type="text" placeholder="Search events or learner names..." value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10 w-full rounded-xl border border-background-200 bg-background-50 pl-9 pr-3 text-xs font-medium text-foreground-900 placeholder:text-foreground-400 transition-all focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-start gap-x-8 gap-y-4 border-t border-background-100 pt-4">
            <div className="min-w-[360px] flex-1 rounded-xl bg-background-50 px-3 py-2.5">
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">Source</p>
                <span className="text-[10px] font-bold text-foreground-400">{sourceFilteredVisibleRangeEvents.length} events</span>
              </div>
              <div className="flex flex-wrap gap-x-2.5 gap-y-2">
                {sourceFilterOptions.map(option => {
                  const isActive = filterSource === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setFilterSource(isActive ? 'all' : option.value)}
                      title={`${option.label} (${option.count})`}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-bold transition-smooth cursor-pointer whitespace-nowrap ${
                        isActive
                          ? 'border-primary-300 bg-primary-500 text-white shadow-md shadow-primary-500/20'
                          : 'border-background-200 bg-background-50 text-foreground-600 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-white' : option.dot}`}></span>
                      {option.label}
                      <span className={isActive ? 'opacity-90' : 'text-foreground-400'}>{option.count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="min-w-[480px] flex-[1.4] rounded-xl bg-background-50 px-3 py-2.5">
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">Status</p>
                <span className="truncate text-[10px] font-bold text-foreground-400">{activeFilterLabel}</span>
              </div>
              <div className="flex flex-wrap gap-x-2.5 gap-y-2">
                {STATUS_FILTER_ORDER.map(status => {
                  const isActive = filterStatus === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setFilterStatus(isActive ? 'all' : status)}
                      title={`${STATUS_FILTER_LABELS[status]} (${statusFilterCounts[status]})`}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-bold transition-smooth cursor-pointer whitespace-nowrap ${
                        isActive
                          ? 'border-primary-300 bg-primary-500 text-white shadow-md shadow-primary-500/20'
                          : 'border-background-200 bg-background-50 text-foreground-600 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-white' : STATUS_FILTER_DOTS[status]}`}></span>
                      {STATUS_FILTER_LABELS[status]}
                      <span className={isActive ? 'opacity-90' : 'text-foreground-400'}>{statusFilterCounts[status]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* â•â•â•â•â•â•â•â•â•â•â• MAIN CONTENT â•â•â•â•â•â•â•â•â•â•â• */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(380px,1fr)]">
          {/* â”€â”€ Calendar Area (2/3) â”€â”€ */}
          <div className="space-y-4">

            {/* MONTH VIEW */}
            {viewMode === 'month' && (
              <div className="overflow-hidden rounded-2xl border border-background-200 bg-white shadow-sm ring-1 ring-black/[0.02]">
                <div className="grid grid-cols-7 border-b border-background-200 bg-background-100/70">
                  {DAYS_OF_WEEK.map(d => (
                    <div key={d} className="px-2 py-3 text-center">
                      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-500">{d}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {monthCells.map((day, idx) => {
                    if (day === null) {
                      return (
                        <div
                          key={`empty-${idx}`}
                          className="min-h-[118px] border-b border-r border-background-200 bg-background-100/35 xl:min-h-[132px]"
                        />
                      );
                    }
                    const eventsForDay = filteredEvents.filter(e => e.dayOfMonth === day && e.month === viewMonth && e.year === viewYear);
                    const isSel = day === selectedDay;
                    const isTdy = isToday(day, viewMonth, viewYear);
                    const dateValue = new Date(viewYear, viewMonth, day).getTime();
                    const isPast = dateValue < todayStart.getTime();
                    const isWeekend = [0, 6].includes(new Date(viewYear, viewMonth, day).getDay());
                    const hasEvents = eventsForDay.length > 0;
                    return (
                      <button
                        key={`d-${day}`}
                        onClick={() => handleDayClick(day)}
                        className={`group relative flex min-h-[118px] flex-col border-b border-r p-2.5 text-left transition-all duration-200 ease-out xl:min-h-[132px] ${
                          isSel
                            ? 'z-10 border-primary-300 bg-primary-50/60 shadow-[inset_0_0_0_1px_rgba(124,58,237,0.28)]'
                            : isWeekend
                              ? 'border-background-200 bg-background-100/20 hover:bg-primary-50/20'
                              : 'border-background-200 bg-white hover:bg-primary-50/15'
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-bold transition-all duration-200 ${
                            isTdy
                              ? 'bg-primary-500 text-white shadow-md shadow-primary-500/20'
                              : isSel
                                ? 'bg-primary-100 text-primary-800'
                                : isPast
                                  ? 'text-foreground-400'
                                  : 'text-foreground-800'
                          }`}>
                            {day}
                          </span>
                          {hasEvents && (
                            <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-semibold text-foreground-500">
                              {eventsForDay.length}
                            </span>
                          )}
                        </div>
                        <div className="flex w-full flex-1 flex-col gap-1.5 overflow-hidden">
                          {eventsForDay.slice(0, 3).map(ev => {
                            const tc = eventConfig(ev);
                            return (
                              <div
                                key={ev.id}
                                onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev); }}
                                className={`w-full rounded-lg border ${tc.border} ${tc.bg} px-2 py-1.5 text-[11px] font-semibold ${tc.text} shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md`}
                                title={ev.title}
                              >
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span className={`h-2 w-2 shrink-0 rounded-full ${tc.dot}`}></span>
                                  <span className="shrink-0 tabular-nums">{formatTime(ev.startHour)}</span>
                                  <span className="truncate leading-tight">{ev.title}</span>
                                </div>
                                {(ev.learner || ev.programme) && (
                                  <p className="mt-0.5 truncate text-[10px] font-medium opacity-75">
                                    {ev.learner || ev.programme}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                          {eventsForDay.length > 3 && (
                            <span className="rounded-md bg-background-100 px-2 py-1 text-[10px] font-semibold text-foreground-500">
                              +{eventsForDay.length - 3} more
                            </span>
                          )}
                        </div>
                        {!hasEvents && (
                          <span className="pointer-events-none mt-auto h-1 w-8 rounded-full bg-background-100 opacity-0 transition-opacity group-hover:opacity-100"></span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* WEEK VIEW */}
            {viewMode === 'week' && (
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="grid grid-cols-8 border-b border-foreground-200/60">
                  <div className="px-2 py-2.5 bg-background-100/50"></div>
                  {weekDates.map(wd => {
                    const isTdy = isToday(wd.day, wd.month, wd.year);
                    const isSel = wd.day === selectedDay && wd.month === viewMonth && wd.year === viewYear;
                    const weekdayIdx = new Date(wd.year, wd.month, wd.day).getDay();
                    const mappedDow = weekdayIdx === 0 ? 6 : weekdayIdx - 1;
                    return (
                      <button
                        key={`wh-${wd.day}-${wd.month}`}
                        onClick={() => { setSelectedDay(wd.day); setViewMonth(wd.month); setViewYear(wd.year); }}
                        className={`px-2 py-2.5 text-center cursor-pointer transition-smooth ${isSel ? 'bg-primary-50/60' : 'hover:bg-background-100/50'}`}
                      >
                        <span className="text-xs font-semibold text-foreground-400 block">{DAYS_OF_WEEK[mappedDow]}</span>
                        <span className={`text-sm font-bold inline-flex items-center justify-center w-7 h-7 rounded-full mt-0.5 ${isTdy ? 'bg-primary-500 text-white' : isSel ? 'text-primary-700' : 'text-foreground-700'}`}>
                          {wd.day}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="overflow-y-auto max-h-[600px]">
                  {HOURS.map(hour => {
                    const isCurrentRow = currentHour === hour && weekDates.some(wd => isToday(wd.day, wd.month, wd.year));
                    return (
                      <div key={`h-${hour}`} className={`grid grid-cols-8 border-b border-background-100/50 min-h-[56px] ${isCurrentRow ? 'bg-primary-50/20' : ''}`}>
                        <div className="px-3 py-2 text-right border-r border-background-100/50">
                          <span className="text-[11px] font-semibold text-foreground-400">{hour.toString().padStart(2, '0')}:00</span>
                        </div>
                        {weekDates.map(wd => {
                          const eventsInSlot = filteredEvents.filter(ev => {
                            if (ev.dayOfMonth !== wd.day || ev.month !== wd.month || ev.year !== wd.year) return false;
                            const startH = ev.startHour;
                            return startH >= hour && startH < hour + 1;
                          });
                          const isSel = wd.day === selectedDay && wd.month === viewMonth && wd.year === viewYear;
                          return (
                            <div
                              key={`ws-${wd.day}-${wd.month}-${hour}`}
                              className={`p-1 border-r border-background-100/50 cursor-pointer transition-smooth hover:bg-primary-50/15 ${isSel ? 'bg-primary-50/30' : ''}`}
                              onClick={() => { setSelectedDay(wd.day); setViewMonth(wd.month); setViewYear(wd.year); }}
                            >
                              {eventsInSlot.map(ev => {
                                const tc = eventConfig(ev);
                                const duration = ev.endHour - ev.startHour;
                                const heightPx = Math.max(24, duration * 48);
                                return (
                                  <div
                                    key={ev.id}
                                    onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev); }}
                                    className={`${tc.bg} ${tc.border} border rounded-md px-1.5 py-1 mb-0.5 cursor-pointer transition-all duration-150 hover:brightness-95`}
                                    style={{ minHeight: `${heightPx}px` }}
                                  >
                                    <p className={`text-[9px] font-semibold leading-tight truncate ${tc.text}`}>{ev.title}</p>
                                    <p className="text-[8px] text-foreground-400 truncate">{formatTime(ev.startHour)} - {formatTime(ev.endHour)}</p>
                                    {ev.learner && <p className="text-[8px] text-foreground-400 truncate font-medium">{ev.learner}</p>}
                                    {ev.priority !== 'normal' && (
                                      <span className={`text-[7px] px-1 py-0.5 rounded-full border font-semibold ${priorityBadge(ev.priority)}`}>
                                        {ev.priority === 'urgent' ? '!' : 'High'}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* DAY VIEW */}
            {viewMode === 'day' && (
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="px-4 py-3 border-b border-foreground-200/60 flex items-center gap-3">
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${isToday(selectedDay, viewMonth, viewYear) ? 'bg-primary-500 text-white' : 'bg-primary-100 text-primary-700'}`}>
                    {selectedDay}
                  </span>
                  <div>
                    <p className="text-sm font-heading font-bold text-foreground-900">
                      {DAYS_OF_WEEK[new Date(viewYear, viewMonth, selectedDay).getDay() === 0 ? 6 : new Date(viewYear, viewMonth, selectedDay).getDay() - 1]}, {MONTH_NAMES[viewMonth]} {selectedDay}
                    </p>
                    <p className="text-[11px] text-foreground-400">{selectedDayEvents.length} events</p>
                  </div>
                </div>
                <div className="overflow-y-auto max-h-[600px]">
                  {HOURS.map(hour => {
                    const eventsInSlot = selectedDayEvents.filter(ev => {
                      const startH = ev.startHour;
                      return startH >= hour && startH < hour + 1;
                    });
                    const isCurrentRow = currentHour === hour && isToday(selectedDay, viewMonth, viewYear);
                    return (
                      <div key={`dh-${hour}`} className={`flex items-start border-b border-background-100/50 min-h-[64px] ${isCurrentRow ? 'bg-primary-50/20' : ''}`}>
                        <div className="w-16 shrink-0 px-3 py-3 text-right border-r border-background-100/50">
                          <span className="text-[11px] font-semibold text-foreground-400">{hour.toString().padStart(2, '0')}:00</span>
                        </div>
                        <div className="flex-1 py-2 px-3 relative">
                          {isCurrentRow && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary-400 rounded-full" />}
                          <div className="space-y-1.5">
                            {eventsInSlot.map(ev => {
                              const tc = eventConfig(ev);
                              return (
                                <div
                                  key={ev.id}
                                  onClick={() => setSelectedEvent(ev)}
                                  className={`p-3 rounded-lg border-l-[3px] cursor-pointer transition-smooth hover:shadow-sm hover:brightness-95 ${tc.bg} ${tc.border} ${selectedEvent?.id === ev.id ? 'ring-2 ring-primary-400 ring-offset-1' : ''}`}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <span className={`text-sm font-semibold ${tc.text}`}>{ev.title}</span>
                                    <div className="flex items-center gap-1.5">
                                      {ev.priority !== 'normal' && (
                                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${priorityBadge(ev.priority)}`}>
                                          {ev.priority === 'urgent' ? 'Urgent' : 'High'}
                                        </span>
                                      )}
                                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${statusBadge(ev.status)}`}>
                                        {statusLabel(ev.status)}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-500">
                                    <span><i className="ri-time-line mr-0.5"></i>{formatTime(ev.startHour)} - {formatTime(ev.endHour)}</span>
                                    {ev.platform && <span><i className="ri-video-line mr-0.5"></i>{ev.platform}</span>}
                                    {ev.location && <span><i className="ri-map-pin-line mr-0.5"></i>{ev.location}</span>}
                                    {ev.learner && <span className="font-medium text-foreground-600">{ev.learner}</span>}
                                    {ev.employer && <span className="font-medium text-foreground-600">{ev.employer}</span>}
                                    {ev.cohort && <span className="text-foreground-400">{ev.cohort}</span>}
                                  </div>
                                </div>
                              );
                            })}
                            {eventsInSlot.length === 0 && isCurrentRow && (
                              <div className="py-1 px-2">
                                <span className="text-[10px] text-primary-500 font-medium">Now</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* â”€â”€ Day events list when in month view â”€â”€ */}
            {viewMode === 'month' && selectedDayEvents.length === 0 && (
              <div className="flex flex-col gap-3 rounded-2xl border border-background-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-background-100 text-foreground-400">
                    <i className="ri-calendar-2-line"></i>
                  </span>
                  <div>
                    <p className="text-sm font-heading font-bold text-foreground-950">{selectedDayLabel}</p>
                    <p className="text-[11px] font-medium text-foreground-400">No events scheduled</p>
                  </div>
                </div>
                <button onClick={() => setViewMode('day')} className="text-[11px] font-bold text-primary-600 transition-smooth hover:text-primary-700 cursor-pointer whitespace-nowrap">
                  Day view <i className="ri-arrow-right-line ml-0.5"></i>
                </button>
              </div>
            )}

            {viewMode === 'month' && selectedDayEvents.length > 0 && (
              <div className="rounded-2xl border border-background-200 bg-white p-4 shadow-sm md:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-heading font-bold text-foreground-950">
                    {selectedDayLabel}
                  </h3>
                  <button onClick={() => setViewMode('day')} className="text-[11px] font-bold text-primary-600 transition-smooth hover:text-primary-700 cursor-pointer whitespace-nowrap">
                    Day view <i className="ri-arrow-right-line ml-0.5"></i>
                  </button>
                </div>
                <div className="space-y-2">
                  {selectedDayEvents.sort((a, b) => a.startHour - b.startHour).map(ev => {
                    const tc = eventConfig(ev);
                    return (
                      <div
                        key={ev.id}
                        onClick={() => setSelectedEvent(ev)}
                        className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition-smooth hover:-translate-y-0.5 hover:shadow-sm ${tc.bg} ${tc.border} ${selectedEvent?.id === ev.id ? 'ring-2 ring-primary-400 ring-offset-1' : ''}`}
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-white/70 ${tc.text}`}>
                          <i className={tc.icon}></i>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-bold ${tc.text}`}>{ev.title}</p>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-foreground-500">
                            <span>{formatTime(ev.startHour)} - {formatTime(ev.endHour)}</span>
                            {ev.learner && <span className="truncate text-foreground-400">· {ev.learner}</span>}
                            {ev.employer && <span className="truncate text-foreground-400">· {ev.employer}</span>}
                          </div>
                        </div>
                        <span className={`w-2 h-2 rounded-full ${tc.dot}`}></span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* â”€â”€ Sidebar (1/3) â”€â”€ */}
          <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            {/* Event Detail */}
            <div className="overflow-hidden rounded-2xl border border-background-200 bg-white shadow-sm ring-1 ring-black/[0.02]">
              {selectedEvent ? (
                <div className="p-4 md:p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-sm font-heading font-bold text-foreground-950">
                      <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${eventConfig(selectedEvent).bg} ${eventConfig(selectedEvent).text}`}>
                        <i className={eventConfig(selectedEvent).icon}></i>
                      </span>
                      Event Details
                    </h3>
                    <button onClick={() => setSelectedEvent(null)} className="flex h-8 w-8 items-center justify-center rounded-xl text-foreground-400 transition-smooth hover:bg-background-100 hover:text-foreground-700 cursor-pointer" aria-label="Clear selected event">
                      <i className="ri-close-line"></i>
                    </button>
                  </div>
                  <div className={`mb-4 overflow-hidden rounded-2xl border ${eventConfig(selectedEvent).border} bg-white`}>
                    <div className={`${eventConfig(selectedEvent).bg} px-4 py-4`}>
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className={`inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-bold ${eventConfig(selectedEvent).text}`}>
                              <i className={eventConfig(selectedEvent).icon}></i>
                              {eventConfig(selectedEvent).label}
                            </span>
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusBadge(selectedEvent.status)}`}>
                              {statusLabel(selectedEvent.status)}
                            </span>
                          </div>
                          <h4 className={`text-lg font-heading font-bold leading-snug ${eventConfig(selectedEvent).text}`}>{selectedEvent.title}</h4>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-bold ${priorityBadge(selectedEvent.priority)}`}>
                          {selectedEvent.priority === 'urgent' ? 'Urgent' : selectedEvent.priority === 'high' ? 'High' : 'Normal'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <EventDetailTile icon="ri-calendar-line" label="Date" value={formatEventDateLabel(selectedEvent)} />
                        <EventDetailTile
                          icon="ri-time-line"
                          label="Time"
                          value={`${formatTime(selectedEvent.startHour)} - ${formatTime(selectedEvent.endHour)}`}
                          sub={`${selectedEvent.endHour - selectedEvent.startHour}h duration`}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {selectedEvent.targetDate && (
                      <EventDetailLine icon="ri-flag-line">
                        Target date: <span className="font-bold text-foreground-900">{formatCompactDate(selectedEvent.targetDate)}</span>
                      </EventDetailLine>
                    )}
                    {selectedEvent.scheduledDate && selectedEvent.scheduledTime && (
                      <EventDetailLine icon="ri-calendar-schedule-line">
                        Scheduled: <span className="font-bold text-foreground-900">{formatCompactDate(selectedEvent.scheduledDate)} at {selectedEvent.scheduledTime.slice(0, 5)}</span>
                      </EventDetailLine>
                    )}
                    {selectedEvent.learner && (
                      <EventDetailLine icon="ri-user-line">
                        <span className="font-bold text-foreground-900">{selectedEvent.learner}</span>
                        {selectedEvent.programme && <span className="text-foreground-400"> · {selectedEvent.programme}</span>}
                      </EventDetailLine>
                    )}
                    {selectedEvent.employer && (
                      <EventDetailLine icon="ri-building-2-line">
                        <span className="font-bold text-foreground-900">{selectedEvent.employer}</span>
                      </EventDetailLine>
                    )}
                    {selectedEvent.tutor && (
                      <EventDetailLine icon="ri-user-settings-line">
                        Tutor: <span className="font-bold text-foreground-900">{selectedEvent.tutor}</span>
                      </EventDetailLine>
                    )}
                    {selectedEvent.platform && selectedEvent.platform !== '--' && (
                      <EventDetailLine icon="ri-video-line">
                        <span className="font-bold text-foreground-900">{selectedEvent.platform}</span>
                        {selectedEvent.location && selectedEvent.location !== '--' && <span className="text-foreground-400"> · {selectedEvent.location}</span>}
                      </EventDetailLine>
                    )}
                    {selectedEvent.cohort && (
                      <EventDetailLine icon="ri-group-line">
                        <span className="font-bold text-foreground-900">{selectedEvent.cohort}</span>
                      </EventDetailLine>
                    )}
                    {selectedEvent.meetingLink && (
                      <EventDetailLine icon="ri-links-line">
                        <a
                          href={selectedEvent.meetingLink}
                          target="_blank"
                          rel="noreferrer"
                          className="font-bold text-primary-600 hover:text-primary-700 hover:underline"
                        >
                          Open meeting link
                        </a>
                      </EventDetailLine>
                    )}
                    {selectedEvent.notes && (
                      <div className="rounded-xl border border-background-100 bg-background-50 p-3">
                        <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-foreground-400">
                          <i className="ri-sticky-note-line"></i>
                          Notes
                        </p>
                        <p className="text-[11px] leading-5 text-foreground-700">{selectedEvent.notes}</p>
                      </div>
                    )}
                  </div>
                  {(eventActionError || eventActionNotice) && (
                    <div className={`mt-4 rounded-lg border px-3 py-2 text-[11px] ${eventActionError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                      {eventActionError || eventActionNotice}
                    </div>
                  )}
                  {!['completed', 'awaiting-signature'].includes(selectedEvent.status) && (
                    <div className="mt-4 rounded-2xl border border-background-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h4 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-foreground-700">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                            <i className="ri-calendar-schedule-line"></i>
                          </span>
                          Schedule Meeting
                        </h4>
                        {selectedEvent.status === 'not-scheduled' && (
                          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">Needs scheduling</span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Date</span>
                          <input
                            type="date"
                            value={scheduleDate}
                            onChange={(e) => setScheduleDate(e.target.value)}
                            className="w-full rounded-xl border border-background-200 bg-background-50 px-3 py-2.5 text-[11px] font-semibold text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-300"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Time</span>
                          <input
                            type="time"
                            value={scheduleTime}
                            onChange={(e) => setScheduleTime(e.target.value)}
                            className="w-full rounded-xl border border-background-200 bg-background-50 px-3 py-2.5 text-[11px] font-semibold text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-300"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Duration</span>
                          <select
                            value={scheduleDuration}
                            onChange={(e) => setScheduleDuration(Number(e.target.value))}
                            className="w-full rounded-xl border border-background-200 bg-background-50 px-3 py-2.5 text-[11px] font-semibold text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-300"
                          >
                            {[30, 45, 60, 90].map(minutes => (
                              <option key={minutes} value={minutes}>{minutes} min</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-background-100 pt-3">
                        <button
                          onClick={handleScheduleSave}
                          disabled={eventActionBusy}
                          className="rounded-xl bg-primary-500 px-3.5 py-2.5 text-[11px] font-bold text-white shadow-sm shadow-primary-500/20 transition-smooth hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer whitespace-nowrap"
                        >
                          <i className="ri-calendar-check-line mr-1"></i>
                          {selectedEvent.status === 'cancelled' ? 'Schedule Again' : selectedEvent.status === 'scheduled' || selectedEvent.status === 'in-progress' ? 'Reschedule' : 'Schedule'}
                        </button>
                        {selectedEvent.status === 'scheduled' && (
                        <button
                          onClick={() => handleEventAction('start')}
                          disabled={eventActionBusy || (selectedEvent.source !== 'catch-up' && !(selectedEvent.meetingLink || selectedEvent.graphWebLink))}
                          className="rounded-xl bg-emerald-500 px-3.5 py-2.5 text-[11px] font-bold text-white shadow-sm shadow-emerald-500/20 transition-smooth hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer whitespace-nowrap"
                        >
                          <i className="ri-play-circle-line mr-1"></i>Start
                          </button>
                        )}
                        {selectedEvent.status === 'in-progress' && (selectedEvent.meetingLink || selectedEvent.graphWebLink) && (
                          <button
                            onClick={handleJoinSelectedMeeting}
                            disabled={eventActionBusy}
                            className="rounded-xl bg-emerald-500 px-3.5 py-2.5 text-[11px] font-bold text-white shadow-sm shadow-emerald-500/20 transition-smooth hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer whitespace-nowrap"
                          >
                            <i className="ri-video-on-line mr-1"></i>Join
                          </button>
                        )}
                        {selectedEvent.status === 'in-progress' && (
                          <button
                            onClick={selectedEvent.source === 'progress-review' ? openSelectedProgressReviewForm : () => handleEventAction('complete')}
                            disabled={eventActionBusy}
                            className="rounded-xl bg-secondary-500 px-3.5 py-2.5 text-[11px] font-bold text-white shadow-sm shadow-secondary-500/20 transition-smooth hover:bg-secondary-600 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer whitespace-nowrap"
                          >
                            <i className={`${selectedEvent.source === 'progress-review' ? 'ri-file-edit-line' : 'ri-check-double-line'} mr-1`}></i>
                            {selectedEvent.source === 'progress-review' ? 'Open review form' : 'Complete'}
                          </button>
                        )}
                        {(selectedEvent.status === 'scheduled' || selectedEvent.status === 'in-progress') && (
                          <button
                            onClick={() => handleEventAction('cancel')}
                            disabled={eventActionBusy}
                            className="rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-[11px] font-bold text-red-700 transition-smooth hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer whitespace-nowrap"
                          >
                            <i className="ri-close-circle-line mr-1"></i>Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {selectedEvent.status === 'awaiting-signature' && selectedEvent.source === 'progress-review' && (
                    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4 sm:flex-row sm:items-center">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                        <i className="ri-pen-nib-line"></i>
                      </span>
                      <div className="flex-1">
                        <p className="text-xs font-bold text-violet-900">Waiting for line manager signature</p>
                        <p className="mt-1 text-[11px] text-violet-700">The review form has been submitted. Confirm the manager signature to complete this PR.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleEventAction('sign')}
                        disabled={eventActionBusy}
                        className="whitespace-nowrap rounded-xl bg-violet-700 px-4 py-2.5 text-[11px] font-bold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <i className="ri-quill-pen-line mr-1.5"></i>Confirm Signature
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 md:p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-sm font-heading font-bold text-foreground-950">
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                        <i className="ri-information-line"></i>
                      </span>
                      Event Details
                    </h3>
                    <span className="rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-semibold text-foreground-500">
                      {selectedDayEvents.length} today
                    </span>
                  </div>
                  <div className="rounded-2xl border border-dashed border-background-300 bg-gradient-to-br from-background-50 to-primary-50/50 px-4 py-6 text-center">
                    <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-primary-500 shadow-sm">
                      <i className="ri-calendar-event-line text-lg"></i>
                    </span>
                    <p className="text-sm font-heading font-bold text-foreground-900">No event selected</p>
                    <p className="mx-auto mt-1 max-w-[240px] text-[11px] leading-5 text-foreground-500">
                      {selectedDayEvents.length > 0
                        ? `${selectedDayEvents.length} event${selectedDayEvents.length === 1 ? '' : 's'} on the selected day.`
                        : 'The selected day has no scheduled events.'}
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-left">
                      <div className="rounded-xl border border-background-200 bg-white px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Selected Day</p>
                        <p className="mt-1 text-lg font-heading font-bold text-foreground-950">{selectedDayEvents.length}</p>
                      </div>
                      <div className="rounded-xl border border-background-200 bg-white px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Upcoming</p>
                        <p className="mt-1 text-lg font-heading font-bold text-foreground-950">{upcomingEvents.length}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Upcoming Events */}
            <div className="overflow-hidden rounded-2xl border border-background-200 bg-white shadow-sm ring-1 ring-black/[0.02]">
              <div className="flex items-center justify-between gap-3 border-b border-background-100 bg-background-50/80 px-4 py-3 md:px-5">
                <h3 className="flex items-center gap-2 text-sm font-heading font-bold text-foreground-950">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <i className="ri-calendar-todo-line"></i>
                  </span>
                  Upcoming
                </h3>
                <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-foreground-500 shadow-sm">
                  {upcomingEvents.length}
                </span>
              </div>
              <div className="space-y-2 p-3 md:p-4">
                {upcomingEvents
                  .map(ev => {
                    const tc = eventConfig(ev);
                    const sourceLabel = ev.source && isSchedulableSource(ev.source)
                      ? SOURCE_FILTER_CHIP_LABELS[ev.source]
                      : typeConfig(ev.type).label;
                    return (
                      <button
                        key={ev.id}
                        onClick={() => { setSelectedDay(ev.dayOfMonth); setViewMonth(ev.month); setViewYear(ev.year); setSelectedEvent(ev); }}
                        className={`group flex w-full items-stretch gap-3 rounded-xl border p-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
                          selectedEvent?.id === ev.id
                            ? 'border-primary-300 bg-primary-50/60 ring-2 ring-primary-100'
                            : 'border-background-200 bg-white hover:border-primary-200 hover:bg-primary-50/20'
                        }`}
                      >
                        <div className="flex w-12 shrink-0 flex-col overflow-hidden rounded-xl border border-background-200 bg-background-50 text-center">
                          <span className="bg-background-100 px-1 py-1 text-[9px] font-bold uppercase tracking-wide text-foreground-500">
                            {MONTH_NAMES[ev.month].slice(0, 3)}
                          </span>
                          <span className="px-1 py-1.5 text-lg font-heading font-bold leading-none text-foreground-950">
                            {ev.dayOfMonth}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-1.5">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${tc.dot}`}></span>
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${tc.bg} ${tc.text}`}>
                              {sourceLabel}
                            </span>
                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${statusBadge(ev.status)}`}>
                              {statusLabel(ev.status)}
                            </span>
                          </div>
                          <p className="truncate text-[12px] font-heading font-bold leading-tight text-foreground-950">{ev.title}</p>
                          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-foreground-500">
                            <i className="ri-time-line text-foreground-400"></i>
                            <span className="shrink-0">{formatTime(ev.startHour)}</span>
                            {(ev.learner || ev.programme) && (
                              <>
                                <span className="text-foreground-300">·</span>
                                <span className="truncate">{ev.learner || ev.programme}</span>
                              </>
                            )}
                          </p>
                        </div>
                        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-foreground-300 transition-smooth group-hover:bg-background-100 group-hover:text-primary-600">
                          <i className="ri-arrow-right-s-line"></i>
                        </span>
                      </button>
                    );
                  })}
                {upcomingEvents.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-background-300 bg-background-50 px-4 py-8 text-center">
                    <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-foreground-300">
                      <i className="ri-calendar-check-line text-lg"></i>
                    </span>
                    <p className="text-sm font-heading font-bold text-foreground-800">No upcoming events</p>
                    <p className="mt-1 text-[11px] text-foreground-500">The forward schedule is clear.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {createSessionOpen && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={closeCreateSessionModal}>
          <div
            className="w-full max-w-[700px] max-h-[90vh] overflow-y-auto rounded-[24px] border border-background-200 bg-background-50 shadow-[0_24px_60px_-32px_rgba(15,8,40,0.32)]"
            onClick={event => event.stopPropagation()}
          >
            <div className="border-b border-background-200/70 bg-background-50 px-4 py-4 md:px-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-[10px] font-semibold text-primary-700">
                    <i className="ri-user-star-line"></i>
                    Coach Calendar
                  </div>
                  <h2 className="text-[21px] font-heading font-bold tracking-tight text-foreground-950">Schedule Coach Session</h2>
                  <p className="mt-1 text-[13px] leading-5 text-foreground-500">
                    Book a learner session and add it to both calendars.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCreateSessionModal}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-background-200 text-foreground-400 transition-smooth hover:bg-background-100 hover:text-foreground-700 cursor-pointer"
                  aria-label="Close create session modal"
                >
                  <i className="ri-close-line text-base"></i>
                </button>
              </div>
            </div>

            <div className="space-y-5 px-4 py-4 md:px-5 md:py-5">
              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-400">Learner</p>
                    <p className="mt-1 text-[12px] text-foreground-500">Choose who this session is for.</p>
                  </div>
                  <span className="rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-semibold text-foreground-500">
                    {createSessionLearnerOptions.length} learner{createSessionLearnerOptions.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="relative">
                  <div className={`rounded-[18px] border bg-white shadow-sm transition-smooth ${
                    createSessionLearnerPickerOpen
                      ? 'border-primary-300 ring-4 ring-primary-100/80'
                      : 'border-background-200 hover:border-primary-200'
                  }`}>
                    <div className="flex min-h-[56px] items-center gap-3 px-3 py-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-[12px] font-bold text-primary-700 ring-1 ring-primary-100">
                        {selectedCreateSessionLearner ? buildInitials(selectedCreateSessionLearner.name) : <i className="ri-search-line text-base"></i>}
                      </span>
                      <input
                        type="text"
                        value={createSessionLearnerPickerOpen ? createSessionLearnerSearch : (selectedCreateSessionLearner?.label || '')}
                        onFocus={() => {
                          if (createSessionLearnerOptions.length === 0) return;
                          setCreateSessionLearnerPickerOpen(true);
                          setCreateSessionLearnerSearch('');
                        }}
                        onChange={event => {
                          setCreateSessionLearnerPickerOpen(true);
                          setCreateSessionLearnerSearch(event.target.value);
                        }}
                        onBlur={() => {
                          window.setTimeout(() => setCreateSessionLearnerPickerOpen(false), 120);
                        }}
                        placeholder="Search learner name, email, programme..."
                        disabled={createSessionLearnerOptions.length === 0}
                        className="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-sm font-semibold text-foreground-900 shadow-none outline-none ring-0 placeholder:font-medium placeholder:text-foreground-400 focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none disabled:cursor-not-allowed"
                      />
                      {createSessionLearnerSearch && createSessionLearnerPickerOpen ? (
                        <button
                          type="button"
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => setCreateSessionLearnerSearch('')}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-400 transition-smooth hover:bg-background-100 hover:text-foreground-700 cursor-pointer"
                          aria-label="Clear learner search"
                        >
                          <i className="ri-close-line text-base"></i>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => {
                          if (createSessionLearnerOptions.length === 0) return;
                          setCreateSessionLearnerPickerOpen(current => !current);
                          setCreateSessionLearnerSearch('');
                        }}
                        disabled={createSessionLearnerOptions.length === 0}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-400 transition-smooth hover:bg-background-100 hover:text-foreground-700 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                        aria-label="Toggle learner list"
                      >
                        <i className={`ri-arrow-down-s-line text-lg transition-transform ${createSessionLearnerPickerOpen ? 'rotate-180' : ''}`}></i>
                      </button>
                    </div>
                  </div>

                  {createSessionLearnerPickerOpen && (
                    <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[110] overflow-hidden rounded-[18px] border border-background-200 bg-white shadow-2xl shadow-foreground-900/12">
                      <div className="max-h-[260px] overflow-y-auto p-2">
                        {filteredCreateSessionLearners.length > 0 ? (
                          filteredCreateSessionLearners.map(option => {
                            const isSelected = option.value === createSessionLearnerId;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onMouseDown={event => event.preventDefault()}
                                onClick={() => {
                                  setCreateSessionLearnerId(option.value);
                                  setCreateSessionLearnerSearch('');
                                  setCreateSessionLearnerPickerOpen(false);
                                }}
                                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-smooth cursor-pointer ${
                                  isSelected ? 'bg-primary-50 text-primary-800' : 'text-foreground-800 hover:bg-background-100'
                                }`}
                              >
                                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[12px] font-bold ${
                                  isSelected ? 'bg-primary-100 text-primary-700' : 'bg-background-100 text-foreground-600'
                                }`}>
                                  {buildInitials(option.name)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold">{option.name}</span>
                                  <span className="mt-0.5 block truncate text-[11px] text-foreground-500">
                                    {[option.programme, option.cohort, option.email].filter(value => value && value !== '--').join(' · ') || 'No extra details'}
                                  </span>
                                </span>
                                {isSelected && <i className="ri-check-line text-base text-primary-600"></i>}
                              </button>
                            );
                          })
                        ) : (
                          <div className="px-4 py-8 text-center">
                            <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-background-100 text-foreground-300">
                              <i className="ri-search-line text-lg"></i>
                            </span>
                            <p className="text-sm font-semibold text-foreground-800">No learners found</p>
                            <p className="mt-1 text-[11px] text-foreground-500">Try another name, email, or programme.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {createSessionLearnerOptions.length === 0 && (
                  <p className="mt-2 text-[11px] text-amber-700">No active learners are available in this coach caseload right now.</p>
                )}
              </section>

              <section>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-400">Session Type</p>
                <p className="mt-1 text-[12px] text-foreground-500">Choose the kind of session you want to create.</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {[
                    { value: 'catch-up' as CoachBookableSessionType, label: 'Catch-up', icon: 'ri-chat-3-line', description: 'Quick progress check-in' },
                    { value: 'student-support' as CoachBookableSessionType, label: 'Support', icon: 'ri-heart-2-line', description: 'Extra support for learner needs' },
                  ].map((sessionType) => {
                    const isActive = createSessionType === sessionType.value;
                    return (
                      <button
                        key={sessionType.value}
                        type="button"
                        onClick={() => setCreateSessionType(sessionType.value)}
                        className={`rounded-[20px] border px-4 py-4 text-left transition-smooth cursor-pointer ${
                          isActive
                            ? 'border-primary-300 bg-primary-50 shadow-sm ring-2 ring-primary-100'
                            : 'border-background-200 bg-white hover:border-primary-200 hover:bg-primary-50/40'
                        }`}
                      >
                        <span className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${isActive ? 'bg-primary-100 text-primary-600' : 'bg-background-100 text-foreground-500'}`}>
                          <i className={`${sessionType.icon} text-base`}></i>
                        </span>
                        <p className="text-[18px] font-heading font-semibold text-foreground-950">{sessionType.label}</p>
                        <p className="mt-1 text-[12px] leading-5 text-foreground-500">{sessionType.description}</p>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-400">Date</span>
                  <input
                    type="date"
                    value={createSessionDate}
                    min={todayInputValue}
                    onChange={event => setCreateSessionDate(event.target.value)}
                    className="w-full rounded-[18px] border border-background-200 bg-white px-4 py-2.5 text-sm font-medium text-foreground-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-400">Time</span>
                  <input
                    type="time"
                    value={createSessionTime}
                    onChange={event => setCreateSessionTime(event.target.value)}
                    className="w-full rounded-[18px] border border-background-200 bg-white px-4 py-2.5 text-sm font-medium text-foreground-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </label>
              </section>

              <section>
                <label className="block">
                  <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-400">Duration</span>
                  <select
                    value={createSessionDuration}
                    onChange={event => setCreateSessionDuration(Number(event.target.value))}
                    className="w-full rounded-[18px] border border-background-200 bg-white px-4 py-2.5 text-sm font-medium text-foreground-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-200"
                  >
                    {[30, 45, 60, 90].map(minutes => (
                      <option key={minutes} value={minutes}>{minutes === 60 ? '1 hour' : `${minutes} minutes`}</option>
                    ))}
                  </select>
                </label>
              </section>

              <section>
                <label className="block">
                  <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-400">Notes (Optional)</span>
                  <textarea
                    value={createSessionNotes}
                    onChange={event => setCreateSessionNotes(event.target.value.slice(0, 500))}
                    placeholder="Add anything the learner should know before the session..."
                    rows={4}
                    className="w-full rounded-[18px] border border-background-200 bg-white px-4 py-3 text-sm font-medium text-foreground-900 shadow-sm placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-200 resize-none"
                  />
                </label>
                <p className="mt-1 text-[10px] text-foreground-400">{createSessionNotes.length}/500</p>
              </section>

              {createSessionError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {createSessionError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-background-200/70 pt-3">
                <button
                  type="button"
                  onClick={closeCreateSessionModal}
                  className="rounded-[18px] border border-background-200 px-4 py-2.5 text-sm font-semibold text-foreground-600 transition-smooth hover:bg-background-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateSession}
                  disabled={createSessionBusy || !createSessionLearnerId || !createSessionDate || !createSessionTime}
                  className="inline-flex items-center gap-2 rounded-[18px] bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-smooth hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <i className={`${createSessionBusy ? 'ri-loader-4-line animate-spin' : 'ri-calendar-check-line'} text-base`}></i>
                  {createSessionBusy ? 'Booking...' : 'Book Session'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {scheduleModalOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={closeScheduleModal}>
          <div
            className="w-full max-w-[720px] max-h-[88vh] overflow-y-auto rounded-[24px] border border-background-200 bg-background-50 shadow-[0_24px_60px_-32px_rgba(15,8,40,0.32)]"
            onClick={event => event.stopPropagation()}
          >
            <div className="border-b border-background-200/70 bg-background-50 px-4 py-4 md:px-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-[10px] font-semibold text-primary-700">
                    <i className="ri-calendar-schedule-line"></i>
                    Coach Scheduler
                  </div>
                  <h2 className="text-[21px] font-heading font-bold tracking-tight text-foreground-950">Place session on calendar</h2>
                  <p className="mt-1 text-[13px] leading-5 text-foreground-500">
                    Choose source, select item, then set time.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeScheduleModal}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-background-200 text-foreground-400 transition-smooth hover:bg-background-100 hover:text-foreground-700 cursor-pointer"
                  aria-label="Close scheduler"
                >
                  <i className="ri-close-line text-base"></i>
                </button>
              </div>
            </div>

            <div className="space-y-4 px-4 py-4 md:px-5 md:py-5">
              <section>
                <div className="mb-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-400">Source</p>
                    <p className="mt-1 text-[12px] text-foreground-500">Pick the queue.</p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {SCHEDULABLE_SOURCE_ORDER.map(source => {
                    const isActive = scheduleModalType === source;
                    const meta = SCHEDULABLE_SOURCE_META[source];
                    return (
                      <button
                        key={source}
                        type="button"
                        onClick={() => setScheduleModalType(source)}
                        className={`rounded-[18px] border px-3.5 py-3 text-left transition-smooth cursor-pointer ${
                          isActive
                            ? 'border-primary-300 bg-primary-50 shadow-sm ring-2 ring-primary-100'
                            : 'border-background-200 bg-white hover:border-primary-200 hover:bg-primary-50/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${meta.surface} ${meta.accent}`}>
                            <i className={`${meta.icon} text-base`}></i>
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isActive ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500'}`}>
                            {scheduleSourceCounts[source]}
                          </span>
                        </div>
                        <p className="mt-2 text-[15px] font-heading font-semibold text-foreground-950">{SOURCE_FILTER_LABELS[source]}</p>
                        <p className="mt-0.5 text-[11px] leading-5 text-foreground-500">{meta.description}</p>
                      </button>
                    );
                  })}
                </div>
              </section>

              {scheduleTypeEvents.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-background-300 bg-background-100/60 px-4 py-8 text-center">
                  <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-background-50 text-foreground-300">
                    <i className="ri-inbox-archive-line text-lg"></i>
                  </span>
                  <p className="text-sm font-semibold text-foreground-800">No {SOURCE_FILTER_LABELS[scheduleModalType].toLowerCase()} items are available right now.</p>
                  <p className="mt-1 text-[11px] text-foreground-500">
                    Switch source or come back when a learner item is ready to be placed on the calendar.
                  </p>
                </div>
              ) : (
                <>
                  <section>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-400">Selection</p>
                        <p className="mt-1 text-[12px] text-foreground-500">Choose learner first, then the session.</p>
                      </div>
                      <span className="rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-semibold text-foreground-500">
                        {scheduleLearnerOptions.length} learner{scheduleLearnerOptions.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-400">Learner</p>
                          <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-semibold text-foreground-500">
                            {scheduleLearnerOptions.length}
                          </span>
                        </div>
                        <ThemedSelect
                          value={scheduleModalLearnerKey}
                          options={scheduleLearnerOptions}
                          onChange={setScheduleModalLearnerKey}
                          placeholder="Choose learner"
                          className="w-full"
                          buttonClassName="h-[50px] rounded-[18px] border-background-200 px-4 text-sm font-medium shadow-sm hover:border-primary-200 focus:border-primary-300 focus:ring-primary-100"
                          menuClassName="rounded-[18px] border-background-200 py-2 shadow-2xl shadow-foreground-900/10"
                        />
                      </div>
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-400">Session</p>
                          <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-semibold text-foreground-500">
                            {scheduleEventOptions.length}
                          </span>
                        </div>
                        <ThemedSelect
                          value={scheduleModalEventKey}
                          options={scheduleEventSelectOptions}
                          onChange={setScheduleModalEventKey}
                          placeholder="Choose session"
                          disabled={!scheduleModalLearnerKey || scheduleEventSelectOptions.length === 0}
                          className="w-full"
                          buttonClassName="h-[50px] rounded-[18px] border-background-200 px-4 text-sm font-medium shadow-sm hover:border-primary-200 focus:border-primary-300 focus:ring-primary-100"
                          menuClassName="rounded-[18px] border-background-200 py-2 shadow-2xl shadow-foreground-900/10"
                        />
                      </div>
                    </div>
                    {selectedScheduleEvent && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-background-200 bg-background-50 px-3 py-1 text-[11px] font-semibold text-foreground-900">
                            {selectedScheduleEvent.learner || 'Learner'}
                          </span>
                          {selectedScheduleEvent.programme && (
                            <span className="rounded-full border border-background-200 bg-background-50 px-3 py-1 text-[11px] text-foreground-600">
                              {selectedScheduleEvent.programme}
                            </span>
                          )}
                          <span className="rounded-full border border-background-200 bg-background-50 px-3 py-1 text-[11px] text-foreground-600">
                            Due {formatCompactDate(selectedScheduleEvent.targetDate || selectedScheduleEvent.date)}
                          </span>
                      </div>
                    )}
                  </section>

                  <section>
                    <div className="mb-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-400">Schedule Details</p>
                      <p className="mt-1 text-[12px] text-foreground-500">Set date, time, and duration.</p>
                    </div>
                  </section>

                  <section className="grid gap-3 md:grid-cols-3">
                    <label className="block">
                      <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-400">Date</span>
                      <input
                        type="date"
                        value={scheduleModalDate}
                        onChange={event => setScheduleModalDate(event.target.value)}
                        className="w-full rounded-[18px] border border-background-200 bg-white px-4 py-2.5 text-sm font-medium text-foreground-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-200"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-400">Start Time</span>
                      <input
                        type="time"
                        value={scheduleModalTime}
                        onChange={event => setScheduleModalTime(event.target.value)}
                        className="w-full rounded-[18px] border border-background-200 bg-white px-4 py-2.5 text-sm font-medium text-foreground-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-200"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-400">Duration</span>
                      <select
                        value={scheduleModalDuration}
                        onChange={event => setScheduleModalDuration(Number(event.target.value))}
                        className="w-full rounded-[18px] border border-background-200 bg-white px-4 py-2.5 text-sm font-medium text-foreground-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-200"
                      >
                        {[30, 45, 60, 90].map(minutes => (
                          <option key={minutes} value={minutes}>{minutes} minutes</option>
                        ))}
                      </select>
                    </label>
                  </section>

                  {selectedScheduleEvent && (
                    <section className="rounded-[18px] border border-primary-200/70 bg-primary-50/60 px-3.5 py-3">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-foreground-700">
                        <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-foreground-900">{SOURCE_FILTER_LABELS[scheduleModalType]}</span>
                        <span className="rounded-full bg-white px-2.5 py-1">{selectedScheduleEvent.learner || 'Learner'}</span>
                        <span className="rounded-full bg-white px-2.5 py-1">{scheduleModalDate || 'Choose date'}</span>
                        <span className="rounded-full bg-white px-2.5 py-1">{scheduleModalTime || '09:00'}</span>
                        <span className="rounded-full bg-white px-2.5 py-1">{scheduleModalDuration} min</span>
                      </div>
                      {selectedScheduleEvent.notes && (
                        <p className="mt-2 text-[11px] leading-5 text-foreground-500">
                          {selectedScheduleEvent.notes}
                        </p>
                      )}
                    </section>
                  )}
                </>
              )}

              {(scheduleModalError || scheduleModalNotice) && (
                <div className={`rounded-2xl border px-4 py-3 text-sm ${
                  scheduleModalError
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}>
                  {scheduleModalError || scheduleModalNotice}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-background-200/70 pt-3">
                <p className="text-[11px] text-foreground-500">
                  The original learner item stays linked to its source record.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={closeScheduleModal}
                    className="rounded-[18px] border border-background-200 px-4 py-2.5 text-sm font-semibold text-foreground-600 transition-smooth hover:bg-background-100 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleModalScheduleSave}
                    disabled={scheduleModalBusy || !selectedScheduleEvent}
                    className="inline-flex items-center gap-2 rounded-[18px] bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-smooth hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <i className={`${scheduleModalBusy ? 'ri-loader-4-line animate-spin' : 'ri-calendar-check-line'} text-base`}></i>
                    {scheduleModalBusy ? 'Scheduling...' : 'Place on Calendar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {progressReviewCompletionEvent && (
        <ProgressReviewCompletionModal
          key={eventIdentity(progressReviewCompletionEvent)}
          event={progressReviewCompletionEvent}
          busy={eventActionBusy}
          error={eventActionError}
          onClose={() => {
            if (!eventActionBusy) setProgressReviewCompletionEvent(null);
          }}
          onSubmit={handleProgressReviewSubmit}
        />
      )}
    </WorkspaceShell>
  );
}

