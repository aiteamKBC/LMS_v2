/**
 * The coach timetable's Source filter row.
 *
 * The Review buckets, their ordering and their colours come from the shared
 * helper (`@/lib/reviewTypeFilters`), which the learner calendar uses too --
 * two implementations of "which Review Type is this" would drift apart the
 * first time either was tuned, and the same Review Type would end up a
 * different colour or a different bucket on the two calendars. This module
 * only adds the coach's own non-review chips around it.
 *
 * Nothing here touches `event.source`'s other jobs: the schedule modal
 * (SCHEDULABLE_SOURCE_*), per-source card theming, the summary tiles, meeting
 * artifacts and the Progress Review / MCM actions all keep keying on it.
 * Filtering is the only thing that moved to Review Type.
 */
import {
  isReviewFilterKey,
  reviewBucketFor,
  reviewTypeBuckets,
  type ReviewFilterKey,
  type ReviewTypeClassifiedEvent,
} from '@/lib/reviewTypeFilters';

/** Fixed event-domain sources. */
export type NonReviewSourceFilter = 'all' | 'live-session' | 'catch-up' | 'student-support' | 'other';
export type SourceFilter = NonReviewSourceFilter | ReviewFilterKey;

/** What this module needs off a timetable event. The page's `TimetableEvent`
 *  satisfies it structurally, so there is no import cycle. */
export interface CoachFilterableEvent extends ReviewTypeClassifiedEvent {
  type?: string;
}

export const NON_REVIEW_SOURCE_FILTER_ORDER: NonReviewSourceFilter[] = [
  'all', 'live-session', 'catch-up', 'student-support', 'other',
];

export const NON_REVIEW_SOURCE_FILTER_LABELS: Record<NonReviewSourceFilter, string> = {
  all: 'All Sources',
  'live-session': 'Live Sessions',
  'catch-up': 'Catch-up',
  'student-support': 'Support',
  other: 'Other',
};

export const NON_REVIEW_SOURCE_FILTER_DOTS: Record<NonReviewSourceFilter, string> = {
  all: 'bg-foreground-400',
  'live-session': 'bg-violet-500',
  'catch-up': 'bg-red-500',
  'student-support': 'bg-blue-500',
  other: 'bg-slate-500',
};

/** Display names for the routing `source` values -- used by the schedule
 *  modal, the "Upcoming events" list and the session labels. These are the
 *  SCHEDULING vocabulary, not filters: a coach schedules an "MCR" slot, and
 *  that stays true however many Review Types exist. */
export const EVENT_SOURCE_LABELS: Record<string, string> = {
  'live-session': 'Live Sessions',
  mcr: 'MCR',
  'progress-review': 'Progress Reviews',
  review: 'Reviews',
  'catch-up': 'Catch-up',
  'student-support': 'Support',
  other: 'Other',
};

export function eventSourceLabel(source?: string): string {
  return EVENT_SOURCE_LABELS[source || ''] || 'Session';
}

/**
 * Translate a legacy schedule deep-link (`?source=mcr`) into a filter value.
 *
 * The intent arrives as a routing source because that is what the scheduler
 * and its links have always spoken. Review sources have no single filter any
 * more, so this finds the bucket the matching events actually landed in;
 * `all` when none are loaded. The only place a legacy source is read to pick
 * a filter, and it is unavoidable for backward compatibility.
 */
export function filterForScheduleIntent(
  intentSource: string,
  events: CoachFilterableEvent[],
): SourceFilter {
  if (isSourceFilterValue(intentSource)) return intentSource;
  const match = events.find((event) => event.source === intentSource);
  return (match && reviewBucketFor(match)) || 'all';
}

export interface CoachSourceChip {
  value: SourceFilter;
  /** Chip text. */
  label: string;
  /** Longer form, for the tooltip and the active-filter summary. */
  longLabel: string;
  dot: string;
}

export function isSourceFilterValue(value?: string): value is SourceFilter {
  if (!value) return false;
  if (isReviewFilterKey(value)) return true;
  return value === 'all' || value === 'live-session'
    || value === 'catch-up' || value === 'student-support' || value === 'other';
}

/**
 * Does one event belong under one filter chip.
 *
 * Review events bucket by Review Type identity alone -- never by title, never
 * by `source` -- so two templates of one type share a bucket, a renamed
 * template stays put, and a reclassified one moves.
 */
export function eventMatchesSourceFilter(event: CoachFilterableEvent, source: SourceFilter): boolean {
  if (source === 'all') return true;
  if (isReviewFilterKey(source)) return reviewBucketFor(event) === source;
  if (source === 'live-session') return event.source === 'live-session' || event.type === 'live-session';
  // A review event never answers to a non-review chip, whatever its legacy
  // routing source says.
  if (reviewBucketFor(event)) return false;
  if (source === 'student-support') return event.source === 'student-support' || event.type === 'welfare';
  if (source === 'other') return event.source === 'other' && event.type !== 'welfare';
  return event.source === source;
}

/**
 * Every chip the Source row shows, in display order: the fixed non-review
 * sources in the order they have always been in, with the Review Type buckets
 * sitting exactly where the old mcr / progress-review / review trio sat.
 *
 * Built from the whole loaded dataset rather than the visible range, so a
 * bucket does not vanish and reappear as the coach pages between months -- it
 * stays on screen reading 0, which is how every fixed chip already behaves.
 */
export function buildCoachSourceChips(events: CoachFilterableEvent[]): CoachSourceChip[] {
  const fixed = (value: NonReviewSourceFilter): CoachSourceChip => ({
    value,
    label: NON_REVIEW_SOURCE_FILTER_LABELS[value],
    longLabel: NON_REVIEW_SOURCE_FILTER_LABELS[value],
    dot: NON_REVIEW_SOURCE_FILTER_DOTS[value],
  });
  const reviewChips = reviewTypeBuckets(events).map((bucket): CoachSourceChip => ({
    value: bucket.key,
    label: bucket.label,
    longLabel: bucket.label,
    dot: bucket.dot,
  }));
  return [
    fixed('all'),
    fixed('live-session'),
    ...reviewChips,
    fixed('catch-up'),
    fixed('student-support'),
    fixed('other'),
  ];
}

/** Chips with a count over whichever events are currently in view. */
export function buildCoachSourceOptions<T extends CoachFilterableEvent>(
  loadedEvents: T[],
  visibleEvents: T[],
): Array<CoachSourceChip & { count: number }> {
  return buildCoachSourceChips(loadedEvents).map((chip) => ({
    ...chip,
    count: chip.value === 'all'
      ? visibleEvents.length
      : visibleEvents.filter((event) => eventMatchesSourceFilter(event, chip.value)).length,
  }));
}

/** Filter to one bucket. `all` keeps everything. */
export function filterBySource<T extends CoachFilterableEvent>(events: T[], source: SourceFilter): T[] {
  if (source === 'all') return events;
  return events.filter((event) => eventMatchesSourceFilter(event, source));
}
