/**
 * The learner calendar's Source filter row.
 *
 * The Review buckets and their ordering/colour live in the shared helper
 * (`@/lib/reviewTypeFilters`), which the coach timetable uses too -- two
 * implementations of "which Review Type is this" would drift apart the first
 * time either was tuned, and the same Review Type would end up a different
 * colour or a different bucket on the two calendars. This module only adds the
 * learner's own non-review chips and adapts Aptem's imported type names.
 *
 * See the shared helper for how imported type names map to filter identities
 * without using an event's routing source or template title.
 */
import type { CalendarEvent } from '@/pages/learner/clubs/data';
import {
  buildReviewTypeLookup,
  isReviewEvent,
  isReviewFilterKey,
  reviewFilterKey,
  reviewClassification,
  reviewTypeBuckets as sharedReviewTypeBuckets,
  reviewTypeDot,
  UNCLASSIFIED_REVIEW_LABEL,
  type ReviewFilterKey,
  type ReviewTypeLookup,
} from '@/lib/reviewTypeFilters';

export { REVIEW_FILTER_PREFIX } from '@/lib/reviewTypeFilters';

/** The non-review buckets. These are event-domain sources and stay fixed. */
export type LearnerNonReviewSource =
  | 'all' | 'live-session' | 'catch-up' | 'student-support' | 'first-session' | 'lms-introduction' | 'gateway' | 'eligibility-review' | 'other' | 'personal' | 'busy';

export type LearnerReviewSource = ReviewFilterKey;

export type LearnerSourceFilter = LearnerNonReviewSource | LearnerReviewSource;

export interface SourceFilterOption {
  key: LearnerSourceFilter;
  /** Chip text. */
  label: string;
  /** Longer form, used for the chip's title attribute. */
  longLabel: string;
  dot: string;
  isReviewType: boolean;
}

export const LEARNER_NON_REVIEW_SOURCE_META: Record<
  LearnerNonReviewSource, { label: string; short: string; dot: string }
> = {
  all: { label: 'All Sources', short: 'All', dot: 'bg-foreground-400' },
  'live-session': { label: 'Live Sessions', short: 'Live Session', dot: 'bg-violet-500' },
  'catch-up': { label: 'Catch-up', short: 'Catch-up', dot: 'bg-rose-500' },
  'student-support': { label: 'Student Support', short: 'Support', dot: 'bg-blue-500' },
  'first-session': { label: 'First Session', short: 'First Session', dot: 'bg-indigo-500' },
  'lms-introduction': { label: 'LMS Introduction', short: 'LMS Introduction', dot: 'bg-emerald-500' },
  gateway: { label: 'Gateway Session', short: 'Gateway Session', dot: 'bg-violet-500' },
  'eligibility-review': { label: 'Eligibility Review', short: 'Eligibility Review', dot: 'bg-teal-500' },
  other: { label: 'Other', short: 'Other', dot: 'bg-slate-500' },
  personal: { label: 'Personal Events', short: 'Personal', dot: 'bg-sky-500' },
  busy: { label: 'Busy Time', short: 'Busy', dot: 'bg-slate-500' },
};

/** Label/colour for whichever bucket an event falls in -- the fixed record for
 *  a non-review source, the Review Type's own name and colour for a review.
 *  Used by the cards and side panels, which show an event's source. */
export function learnerSourceMeta(event: CalendarEvent, lookup?: ReviewTypeLookup): { label: string; short: string; dot: string } {
  const key = learnerEventSource(event, lookup);
  if (!isReviewFilterKey(key)) return LEARNER_NON_REVIEW_SOURCE_META[key];
  const classification = reviewClassification(event, lookup);
  const label = classification.reviewTypeName || UNCLASSIFIED_REVIEW_LABEL;
  return { label, short: label, dot: reviewTypeDot(classification.reviewTypeId || label) };
}

/** Which filter bucket one event belongs to. */
export function learnerEventSource(event: CalendarEvent, lookup?: ReviewTypeLookup): LearnerSourceFilter {
  if (event.type === 'Busy') return 'busy';
  if (event.club === 'Personal' || event.type === 'Personal') return 'personal';
  if (event.source === 'live-session') return 'live-session';
  const classification = reviewClassification(event, lookup);
  if (isReviewEvent(classification)) return reviewFilterKey(classification.reviewTypeId);
  if (event.source === 'catch-up') return 'catch-up';
  if (event.source === 'student-support') return 'student-support';
  if (event.source === 'first-session' || event.source === 'lms-introduction'
    || event.source === 'gateway' || event.source === 'eligibility-review') return event.source;
  if (event.source) return 'other';
  return 'personal';
}

/** The review buckets present in a set of events, in the shared deterministic
 *  order (system types first, then custom, alphabetical within each). */
export function reviewTypeBuckets(events: CalendarEvent[]): SourceFilterOption[] {
  return sharedReviewTypeBuckets(events).map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    longLabel: bucket.label,
    dot: bucket.dot,
    isReviewType: true,
  }));
}

/**
 * Every chip the Source row shows, in display order: the fixed non-review
 * sources in the order they have always been in, with the review buckets
 * sitting exactly where the old mcr/progress-review/review trio sat.
 *
 * Built from the whole loaded dataset rather than the visible range, so a
 * bucket does not vanish and reappear as the learner pages between months --
 * it stays on screen reading 0, which is how every fixed chip already behaves.
 */
export function buildSourceFilters(events: CalendarEvent[]): SourceFilterOption[] {
  const fixed = (key: LearnerNonReviewSource): SourceFilterOption => ({
    key,
    label: LEARNER_NON_REVIEW_SOURCE_META[key].short,
    longLabel: LEARNER_NON_REVIEW_SOURCE_META[key].label,
    dot: LEARNER_NON_REVIEW_SOURCE_META[key].dot,
    isReviewType: false,
  });
  return [
    fixed('all'),
    fixed('live-session'),
    ...reviewTypeBuckets(events),
    fixed('catch-up'),
    fixed('student-support'),
    ...(['first-session', 'lms-introduction', 'gateway', 'eligibility-review', 'personal', 'busy'] as const)
      .filter(source => events.some(event => learnerEventSource(event) === source))
      .map(fixed),
    fixed('other'),
  ];
}

/** Per-bucket counts over whichever events are currently in view. `all`
 *  counts everything, including buckets with no chip of their own. */
export function countBySource(
  events: CalendarEvent[],
  options: SourceFilterOption[],
  lookup = buildReviewTypeLookup(events),
): Record<string, number> {
  const counts: Record<string, number> = { all: 0 };
  options.forEach((option) => { counts[option.key] = 0; });
  events.forEach((event) => {
    counts.all += 1;
    const key = learnerEventSource(event, lookup);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

/** Filter to one bucket. `all` keeps everything, review and non-review alike. */
export function filterBySource(events: CalendarEvent[], filter: LearnerSourceFilter, lookup = buildReviewTypeLookup(events)): CalendarEvent[] {
  if (filter === 'all') return events;
  return events.filter((event) => learnerEventSource(event, lookup) === filter);
}
