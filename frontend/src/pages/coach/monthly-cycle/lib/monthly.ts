// ============================================================================
// Monthly Cycle — data helpers.
//
// Pure functions only, moved verbatim out of page.tsx. Nothing about the
// month-key math, the MCR/MCM/Progress-Review/Catch-up/Support categorisation,
// or the endpoint contract changed — this is the same logic, just no longer
// inline in the component file.
// ============================================================================
import type {
  CoachingDeliveryFocusSource,
  CoachingDeliveryKind,
  CoachingDeliveryScheduleSource,
  CoachingDeliveryStatus,
  CoachingDeliverySummary,
  InlineActivityFilter,
  MonthlyActivityItem,
} from '../types';
import { COACHING_DELIVERY_ORDER } from './constants';

export async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : `Request failed with ${response.status}`;
    throw new Error(detail);
  }
  return data as T;
}

export function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonthKey(monthKey: string, offset: number) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return currentMonthKey(date);
}

export function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

export function monthlyActivityEndpoint(monthKey: string) {
  const params = new URLSearchParams({ month: monthKey });
  return `/coach_api/coach/monthly-activity?${params.toString()}`;
}

export function activityIcon(type: string) {
  const normalized = type.toLowerCase();
  if (normalized.includes('quiz')) return 'ri-question-answer-line';
  if (normalized.includes('video')) return 'ri-play-circle-line';
  if (normalized.includes('evidence')) return 'ri-folder-upload-line';
  if (normalized.includes('support')) return 'ri-hand-heart-line';
  if (normalized.includes('mcm') || normalized.includes('mcr') || normalized.includes('catch') || normalized.includes('pr')) return 'ri-calendar-check-line';
  return 'ri-checkbox-circle-line';
}

export function formatSourceLabel(source: string) {
  return source
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function inlineActivityCategory(type: string): InlineActivityFilter {
  const normalized = type.toLowerCase();
  if (normalized.includes('quiz')) return 'quiz';
  if (normalized.includes('video')) return 'video';
  if (normalized.includes('evidence')) return 'evidence';
  if (normalized.includes('mcm') || normalized.includes('mcr') || normalized.includes('catch') || normalized.includes('pr') || normalized.includes('support') || normalized.includes('welfare') || normalized.includes('coaching') || normalized.includes('review')) return 'coaching';
  return 'learning';
}

export function coachingDeliveryKind(activity: MonthlyActivityItem): CoachingDeliveryKind | null {
  const type = activity.type.trim().toLowerCase();
  const text = `${activity.type} ${activity.title} ${activity.detail} ${activity.source}`.toLowerCase();
  if (type === 'mcm' || type === 'mcr' || text.includes('monthly coaching')) return 'mcr';
  if (type === 'pr' || text.includes('progress review') || text.includes('progress-review')) return 'pr';
  if (text.includes('catch-up') || text.includes('catch up') || text.includes('catchup')) return 'catch-up';
  if (text.includes('student support') || text.includes('support') || text.includes('welfare')) return 'support';
  return null;
}

export function coachingDeliveryStatus(activity: MonthlyActivityItem) {
  return activity.detail.split(' - ')[0]?.trim() || 'Captured';
}

export function coachingDeliveryStatusKey(activity: MonthlyActivityItem): CoachingDeliveryStatus {
  const rawStatus = normalizeSearch(activity.status || coachingDeliveryStatus(activity));
  if (rawStatus.includes('completed')) return 'completed';
  if (rawStatus.includes('cancelled') || rawStatus.includes('canceled')) return 'cancelled';
  if (rawStatus.includes('not-scheduled') || rawStatus.includes('needs schedule') || rawStatus.includes('need schedule')) return 'needs-schedule';
  return 'booked';
}

export function coachingDeliveryScheduleSource(kind: CoachingDeliveryKind): CoachingDeliveryScheduleSource | null {
  if (kind === 'mcr') return 'mcr';
  if (kind === 'pr') return 'progress-review';
  if (kind === 'catch-up') return 'catch-up';
  return null;
}

export function coachingDeliveryFocusSource(kind: CoachingDeliveryKind): CoachingDeliveryFocusSource {
  if (kind === 'pr') return 'progress-review';
  if (kind === 'support') return 'student-support';
  return kind;
}

export function coachingDeliveryEventKey(activityId: string) {
  return activityId.startsWith('event:') ? activityId.slice('event:'.length) : undefined;
}

export function coachingDeliveryScheduledTime(timeLabel: string) {
  const match = timeLabel.match(/\b\d{2}:\d{2}\b/);
  return match?.[0];
}

export function emptyCoachingDeliveryCounts(): Record<CoachingDeliveryStatus, number> {
  return {
    booked: 0,
    completed: 0,
    cancelled: 0,
    'needs-schedule': 0,
  };
}

export function emptyCoachingDeliverySummary(): CoachingDeliverySummary {
  return {
    byKind: COACHING_DELIVERY_ORDER.reduce((acc, kind) => {
      acc[kind] = {
        items: [],
        counts: emptyCoachingDeliveryCounts(),
      };
      return acc;
    }, {} as CoachingDeliverySummary['byKind']),
  };
}

export function groupActivitiesByDate(activities: MonthlyActivityItem[]) {
  const groups = new Map<string, MonthlyActivityItem[]>();
  activities.forEach((activity) => {
    const items = groups.get(activity.date) || [];
    groups.set(activity.date, [...items, activity]);
  });
  return Array.from(groups.entries());
}

export function uniqueActivityDays(activities: MonthlyActivityItem[]) {
  return new Set(activities.map((activity) => activity.date)).size;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('en-GB').format(value);
}

/** "42h" / "12.5h" — distinct from the shared `formatHours` in `@/lib/format`,
 * which has a different (unitless) output; kept local so this page's PDF and
 * on-screen labels do not change. */
export function formatHoursLabel(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}h`;
}

export function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}
