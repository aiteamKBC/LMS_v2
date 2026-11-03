/**
 * Calendar Review filters, derived from Curriculum's Review Types.
 *
 * Shared by the learner calendar and the coach timetable. Both used to carry
 * `mcr` / `progress-review` / `review` as three literal filters, so every
 * Review Type a curriculum admin invented -- Career Review, Gateway Review,
 * Personal Support Plan -- arrived as the single generic "Review" chip and
 * became indistinguishable. Buckets are derived from the `reviewType*`
 * metadata each review event carries instead, so a new Review Type needs no
 * frontend change at all. Imported system types are first adapted to their
 * Curriculum identities, then follow the same bucketing path as custom types.
 *
 * Four concepts, kept strictly apart:
 *
 *   event.source          legacy ROUTING value -- scheduling, booking, Teams,
 *                         meeting artifacts and per-source theming all key on
 *                         it. Never used to decide which review bucket.
 *   event.reviewTypeId    stable filter IDENTITY.
 *   event.reviewTypeName  the filter LABEL.
 *   event.title           the Review TEMPLATE's live name -- what the card
 *                         shows. "Monthly Learner Catch-up" displays under
 *                         itself while filtering as "Monthly Coaching
 *                         Meeting", and renaming it moves nothing.
 *
 * Page-specific wrappers add their own non-review chips around
 * `reviewTypeBuckets`; see pages/learner/calendar/reviewTypeFilters.ts.
 */

/** The minimum a calendar event must expose to be bucketed. Both the learner
 *  `CalendarEvent` and the coach `TimetableEvent` satisfy it structurally. */
export interface ReviewTypeClassifiedEvent {
  source?: string;
  importedReviewType?: string | null;
  importedReview?: { type?: string | null } | null;
  reviewTypeId?: string | null;
  reviewTypeCode?: string | null;
  reviewTypeName?: string | null;
  reviewTypeIsSystem?: boolean;
}

/** Exact Aptem type names corresponding to the fixed system identities in
 * backend/curriculum_api/review_types.py. This adapts classification only;
 * it does not associate an imported review with a native form or booking.
 * Other imported types retain their own identities, including Skills Radar.
 */
export type ReviewTypeLookup = ReadonlyMap<string, ReviewTypeClassifiedEvent>;

const normalizedTypeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

const IMPORTED_SYSTEM_REVIEW_TYPES = new Map<string, ReviewTypeClassifiedEvent>([
  ['monthly coaching meeting', {
    reviewTypeId: 'REVT-MCM', reviewTypeCode: 'mcm',
    reviewTypeName: 'Monthly Coaching Meeting', reviewTypeIsSystem: true,
  }],
  ['progress review', {
    reviewTypeId: 'REVT-PROGRESS_REVIEW', reviewTypeCode: 'progress_review',
    reviewTypeName: 'Progress Review', reviewTypeIsSystem: true,
  }],
]);

/** Resolve any imported type against unambiguous Curriculum type metadata in
 * the full loaded calendar, not just the selected day or search results.
 * Explicit type IDs always win; two distinct native IDs are never merged.
 */
export function buildReviewTypeLookup(events: ReviewTypeClassifiedEvent[]): ReviewTypeLookup {
  const candidates = new Map<string, ReviewTypeClassifiedEvent | null>();
  events.forEach(event => {
    if (!event.reviewTypeId || event.reviewTypeId.startsWith('aptem-type:') || !event.reviewTypeName?.trim()) return;
    const name = normalizedTypeName(event.reviewTypeName);
    const systemType = IMPORTED_SYSTEM_REVIEW_TYPES.get(name);
    if (systemType && systemType.reviewTypeId !== event.reviewTypeId) return;
    const previous = candidates.get(name);
    candidates.set(name, previous === null || (previous && previous.reviewTypeId !== event.reviewTypeId) ? null : {
      reviewTypeId: event.reviewTypeId, reviewTypeCode: event.reviewTypeCode,
      reviewTypeName: event.reviewTypeName, reviewTypeIsSystem: event.reviewTypeIsSystem,
    });
  });
  const lookup = new Map(IMPORTED_SYSTEM_REVIEW_TYPES);
  candidates.forEach((type, name) => { if (type) lookup.set(name, type); });
  return lookup;
}

/** Aptem has a type name, while Curriculum has a stable type ID. Adapt both
 *  calendar payloads to the same filter identity without changing the event,
 *  its routing source, or its booking/form association. */
export function reviewClassification(event: ReviewTypeClassifiedEvent, lookup: ReviewTypeLookup = IMPORTED_SYSTEM_REVIEW_TYPES): ReviewTypeClassifiedEvent {
  const importedType = (event.importedReviewType || event.importedReview?.type)?.trim();
  if (event.reviewTypeId || !importedType) return event;
  const knownType = lookup.get(normalizedTypeName(importedType));
  if (knownType) return { ...event, ...knownType };
  return {
    ...event,
    reviewTypeId: `aptem-type:${encodeURIComponent(importedType)}`,
    reviewTypeName: importedType,
  };
}

/** A review bucket is addressed by its Review Type id. The prefix keeps review
 *  and non-review filter keys in separate namespaces. */
export const REVIEW_FILTER_PREFIX = 'review:';

export type ReviewFilterKey = `review:${string}`;

/** Legacy routing values that mean "this came from a Curriculum Review
 *  template". Used only to decide that an event belongs in SOME review
 *  bucket -- never which one. */
const REVIEW_EVENT_SOURCES = new Set(['mcr', 'progress-review', 'review']);

/** Label for a review whose template has no Review Type yet. */
export const UNCLASSIFIED_REVIEW_LABEL = 'Review';

export interface ReviewTypeBucket {
  key: ReviewFilterKey;
  /** review_types.name, or the generic label for unclassified legacy data. */
  label: string;
  /** review_types.id; empty only for the unclassified bucket. */
  reviewTypeId: string;
  isSystem: boolean;
  dot: string;
}

/** Chip colours, picked by hashing the bucket's stable identity so a Review
 *  Type keeps the same colour across reloads, across learners, and between
 *  the learner calendar and the coach timetable. */
const REVIEW_DOTS = [
  'bg-orange-500', 'bg-teal-500', 'bg-secondary-500', 'bg-amber-500',
  'bg-emerald-500', 'bg-indigo-500', 'bg-pink-500', 'bg-cyan-500',
];

export function reviewTypeDot(identity: string): string {
  let hash = 0;
  for (let index = 0; index < identity.length; index += 1) {
    hash = (hash * 31 + identity.charCodeAt(index)) | 0;
  }
  return REVIEW_DOTS[Math.abs(hash) % REVIEW_DOTS.length];
}

export function isReviewEvent(event: ReviewTypeClassifiedEvent): boolean {
  // The type metadata is proof on its own; the legacy sources cover a review
  // whose template has no type yet.
  return Boolean(reviewClassification(event).reviewTypeId) || REVIEW_EVENT_SOURCES.has(event.source || '');
}

export function reviewFilterKey(reviewTypeId?: string | null): ReviewFilterKey {
  return `${REVIEW_FILTER_PREFIX}${reviewTypeId || ''}`;
}

export function isReviewFilterKey(value: string): value is ReviewFilterKey {
  return value.startsWith(REVIEW_FILTER_PREFIX);
}

/**
 * The review buckets present in a set of events, deterministically ordered:
 * system Review Types first, then custom ones, alphabetical by type name
 * within each group, with any unclassified reviews last.
 *
 * Ordering never depends on the order events arrived in. It mirrors
 * curriculum.review_types' own `order by is_system desc, name asc`, using the
 * `reviewTypeIsSystem` flag the API sends rather than matching type codes.
 */
export function reviewTypeBuckets(events: ReviewTypeClassifiedEvent[], lookup = buildReviewTypeLookup(events)): ReviewTypeBucket[] {
  const buckets = new Map<ReviewFilterKey, { name: string; isSystem: boolean; id: string; hasNativeType: boolean }>();
  events.forEach((rawEvent) => {
    const event = reviewClassification(rawEvent, lookup);
    if (!isReviewEvent(event)) return;
    const key = reviewFilterKey(event.reviewTypeId);
    const existing = buckets.get(key);
    const hasNativeType = Boolean(rawEvent.reviewTypeId);
    // A native type may have been renamed. Prefer its current metadata over
    // the imported alias, independently of the order events arrived in.
    if (existing && (existing.hasNativeType || !hasNativeType)) return;
    buckets.set(key, {
      id: event.reviewTypeId || '',
      name: event.reviewTypeName || UNCLASSIFIED_REVIEW_LABEL,
      isSystem: Boolean(event.reviewTypeIsSystem),
      hasNativeType,
    });
  });

  return Array.from(buckets.entries())
    .sort(([, a], [, b]) => {
      // Unclassified reviews sit after every real type.
      if (Boolean(a.id) !== Boolean(b.id)) return a.id ? -1 : 1;
      if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map(([key, bucket]) => ({
      key,
      label: bucket.name,
      reviewTypeId: bucket.id,
      isSystem: bucket.isSystem,
      dot: reviewTypeDot(bucket.id || bucket.name),
    }));
}

/**
 * Which review bucket one event belongs to, or null when it is not a review.
 *
 * Review events bucket by Review Type id and nothing else -- not by title, not
 * by `source` -- so two templates sharing a type share a bucket and a renamed
 * template stays put.
 */
export function reviewBucketFor(event: ReviewTypeClassifiedEvent, lookup?: ReviewTypeLookup): ReviewFilterKey | null {
  const classification = reviewClassification(event, lookup);
  return isReviewEvent(classification) ? reviewFilterKey(classification.reviewTypeId) : null;
}
