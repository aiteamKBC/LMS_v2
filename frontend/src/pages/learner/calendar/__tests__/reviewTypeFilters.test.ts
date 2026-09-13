/**
 * Learner calendar Review filters are built from Curriculum Review Types.
 *
 * The rule under test throughout: a review event's bucket is decided by its
 * Review Type id and nothing else -- never by the event title, never by the
 * legacy `source` routing value. MCM and Progress Review go through exactly
 * the same path as Career Review or Gateway Review.
 */
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@/pages/learner/clubs/data';
import {
  buildSourceFilters,
  countBySource,
  filterBySource,
  learnerEventSource,
  reviewTypeBuckets,
} from '../reviewTypeFilters';

let seed = 0;
function event(partial: Partial<CalendarEvent> = {}): CalendarEvent {
  seed += 1;
  return {
    id: `event-${seed}`,
    title: 'Untitled',
    date: '10 Sep',
    dayName: 'Thursday',
    time: '09:00–10:00',
    club: 'Coaching',
    clubId: '',
    type: 'Coaching',
    format: '1:1 Teams',
    location: 'Online',
    host: 'Your coach',
    points: 0,
    status: 'confirmed',
    description: '',
    ...partial,
  };
}

/** A review event as the API now sends it: legacy routing `source`, plus the
 *  Review Type classification beside it. */
function reviewEvent(
  { title, typeId, typeCode, typeName, isSystem = false, source = 'review' }: {
    title: string; typeId: string; typeCode: string; typeName: string;
    isSystem?: boolean; source?: string;
  },
): CalendarEvent {
  return event({
    title,
    source,
    reviewTypeId: typeId,
    reviewTypeCode: typeCode,
    reviewTypeName: typeName,
    reviewTypeIsSystem: isSystem,
  });
}

const mcm = (title = 'Monthly Coaching Meeting') => reviewEvent({
  title, typeId: 'REVT-MCM', typeCode: 'mcm', typeName: 'Monthly Coaching Meeting',
  isSystem: true, source: 'mcr',
});
const progressReview = (title = 'Progress Review') => reviewEvent({
  title, typeId: 'REVT-PROGRESS_REVIEW', typeCode: 'progress_review',
  typeName: 'Progress Review', isSystem: true, source: 'progress-review',
});
const careerReview = (title = 'Career Planning Session') => reviewEvent({
  title, typeId: 'REVT-CAREER', typeCode: 'career_review', typeName: 'Career Review',
});
const gatewayReview = (title = 'Gateway Check') => reviewEvent({
  title, typeId: 'REVT-GATEWAY', typeCode: 'gateway_review', typeName: 'Gateway Review',
});

const liveSession = () => event({ title: 'Module 3 live', source: 'live-session', club: 'Data Module' });
const catchUp = () => event({ title: 'Catch-up', source: 'catch-up' });
const support = () => event({ title: 'Support', source: 'student-support' });
const personal = () => event({ title: 'Dentist', club: 'Personal', type: 'Personal' });
const busy = () => event({ title: 'Busy', type: 'Busy' });

describe('bucketing one event', () => {
  it('puts an MCM event in the Monthly Coaching Meeting bucket', () => {
    expect(learnerEventSource(mcm())).toBe('review:REVT-MCM');
  });

  it('puts a Progress Review event in the Progress Review bucket', () => {
    expect(learnerEventSource(progressReview())).toBe('review:REVT-PROGRESS_REVIEW');
  });

  it('puts a custom Career Review in its own bucket', () => {
    expect(learnerEventSource(careerReview())).toBe('review:REVT-CAREER');
  });

  it('puts a custom Gateway Review in its own bucket', () => {
    expect(learnerEventSource(gatewayReview())).toBe('review:REVT-GATEWAY');
  });

  it('never collapses two different custom types into one bucket', () => {
    expect(learnerEventSource(careerReview())).not.toBe(learnerEventSource(gatewayReview()));
    // ...even though both arrive on the same legacy routing source.
    expect(careerReview().source).toBe(gatewayReview().source);
  });

  it('keeps a renamed Review template in its Review Type bucket', () => {
    // The brief's example: the template is called something else entirely.
    const renamed = reviewEvent({
      title: 'Monthly Learner Catch-up', typeId: 'REVT-MCM', typeCode: 'mcm',
      typeName: 'Monthly Coaching Meeting', isSystem: true, source: 'mcr',
    });
    expect(learnerEventSource(renamed)).toBe(learnerEventSource(mcm()));
  });

  it('puts two templates of the same type in the same bucket', () => {
    const first = reviewEvent({ title: 'Career Planning Session', typeId: 'REVT-CAREER', typeCode: 'career_review', typeName: 'Career Review' });
    const second = reviewEvent({ title: 'Where next?', typeId: 'REVT-CAREER', typeCode: 'career_review', typeName: 'Career Review' });
    expect(learnerEventSource(first)).toBe(learnerEventSource(second));
  });

  it('leaves the non-review sources exactly as they were', () => {
    expect(learnerEventSource(liveSession())).toBe('live-session');
    expect(learnerEventSource(catchUp())).toBe('catch-up');
    expect(learnerEventSource(support())).toBe('student-support');
    expect(learnerEventSource(personal())).toBe('personal');
    expect(learnerEventSource(busy())).toBe('busy');
  });

  it('keeps an unclassified review in a generic bucket rather than dropping it', () => {
    // A template that predates Review Types: no metadata, legacy source only.
    expect(learnerEventSource(event({ title: 'Legacy review', source: 'review' }))).toBe('review:');
  });
});

describe('building the filter row', () => {
  const dataset = [
    liveSession(), catchUp(), support(),
    mcm(), mcm(), progressReview(),
    careerReview(), careerReview(), careerReview(), gatewayReview(),
  ];

  it('offers one chip per Review Type present, and no generic Review chip', () => {
    const labels = buildSourceFilters(dataset).map((option) => option.label);
    expect(labels).toEqual([
      'All', 'Live Session',
      'Monthly Coaching Meeting', 'Progress Review', 'Career Review', 'Gateway Review',
      'Catch-up', 'Support',
    ]);
    expect(labels).not.toContain('Review');
  });

  it('orders system types first, then custom types alphabetically', () => {
    const buckets = reviewTypeBuckets([
      gatewayReview(), careerReview(), progressReview(), mcm(),
    ]);
    expect(buckets.map((bucket) => bucket.label)).toEqual([
      'Monthly Coaching Meeting', 'Progress Review', 'Career Review', 'Gateway Review',
    ]);
  });

  it('does not depend on the order events arrived in', () => {
    const forwards = reviewTypeBuckets(dataset).map((bucket) => bucket.key);
    const backwards = reviewTypeBuckets([...dataset].reverse()).map((bucket) => bucket.key);
    expect(backwards).toEqual(forwards);
  });

  it('puts an unclassified review bucket after every real type', () => {
    const buckets = reviewTypeBuckets([
      event({ title: 'Legacy', source: 'review' }), careerReview(), mcm(),
    ]);
    expect(buckets.map((bucket) => bucket.label)).toEqual([
      'Monthly Coaching Meeting', 'Career Review', 'Review',
    ]);
  });

  it('offers no review chips at all when the learner has no reviews', () => {
    const labels = buildSourceFilters([liveSession(), catchUp()]).map((option) => option.label);
    expect(labels).toEqual(['All', 'Live Session', 'Catch-up', 'Support']);
  });

  it('gives each Review Type a stable colour across rebuilds', () => {
    const first = reviewTypeBuckets(dataset);
    const second = reviewTypeBuckets([...dataset].reverse());
    expect(second.map((b) => b.dot)).toEqual(first.map((b) => b.dot));
  });
});

describe('counts', () => {
  const dataset = [
    liveSession(), catchUp(),
    mcm(), mcm(), progressReview(),
    careerReview(), careerReview(), careerReview(),
  ];
  const options = buildSourceFilters(dataset);

  it('counts each Review Type separately', () => {
    const counts = countBySource(dataset, options);
    expect(counts['review:REVT-MCM']).toBe(2);
    expect(counts['review:REVT-PROGRESS_REVIEW']).toBe(1);
    expect(counts['review:REVT-CAREER']).toBe(3);
  });

  it('counts everything under All', () => {
    expect(countBySource(dataset, options).all).toBe(dataset.length);
  });

  it('counts the non-review sources as before', () => {
    const counts = countBySource(dataset, options);
    expect(counts['live-session']).toBe(1);
    expect(counts['catch-up']).toBe(1);
    expect(counts['student-support']).toBe(0);
  });

  it('reports zero for a chip whose type has nothing in the current range', () => {
    // The chips come from the whole dataset, the counts from what is in view --
    // so a bucket stays on screen reading 0 rather than disappearing.
    const counts = countBySource([mcm()], options);
    expect(counts['review:REVT-CAREER']).toBe(0);
    expect(counts['review:REVT-MCM']).toBe(1);
  });
});

describe('filtering', () => {
  const dataset = [
    liveSession(), catchUp(), support(), personal(),
    mcm(), progressReview(), careerReview(), gatewayReview(),
  ];

  it('All shows every review type and every non-review source', () => {
    expect(filterBySource(dataset, 'all')).toHaveLength(dataset.length);
  });

  it('picking one Review Type hides the other review types', () => {
    const shown = filterBySource(dataset, 'review:REVT-CAREER');
    expect(shown.map((e) => e.title)).toEqual(['Career Planning Session']);
  });

  it('picking a system Review Type works the same way', () => {
    expect(filterBySource(dataset, 'review:REVT-MCM').map((e) => e.title))
      .toEqual(['Monthly Coaching Meeting']);
  });

  it('picking a non-review source still works unchanged', () => {
    expect(filterBySource(dataset, 'live-session')).toHaveLength(1);
    expect(filterBySource(dataset, 'catch-up')).toHaveLength(1);
    expect(filterBySource(dataset, 'student-support')).toHaveLength(1);
  });

  it('clearing back to All restores everything', () => {
    const narrowed = filterBySource(dataset, 'review:REVT-GATEWAY');
    expect(narrowed).toHaveLength(1);
    expect(filterBySource(dataset, 'all')).toHaveLength(dataset.length);
  });

  it('combines with a status filter the way the page composes them', () => {
    const events = [
      mcm(), careerReview(),
      { ...careerReview(), bookingStatus: 'completed' } as CalendarEvent,
    ];
    const byType = filterBySource(events, 'review:REVT-CAREER');
    expect(byType).toHaveLength(2);
    expect(byType.filter((e) => e.bookingStatus === 'completed')).toHaveLength(1);
  });

  it('combines with a search term the way the page composes them', () => {
    const events = [mcm(), careerReview('Career Planning Session'), gatewayReview()];
    const searched = events.filter((e) => [e.title, e.reviewTypeName || '']
      .some((value) => value.toLowerCase().includes('career')));
    expect(filterBySource(searched, 'review:REVT-CAREER').map((e) => e.title))
      .toEqual(['Career Planning Session']);
    // Searching the TYPE name finds a template named nothing like it.
    const renamed = [reviewEvent({
      title: 'Where next?', typeId: 'REVT-CAREER', typeCode: 'career_review', typeName: 'Career Review',
    })];
    expect(renamed.filter((e) => (e.reviewTypeName || '').toLowerCase().includes('career'))).toHaveLength(1);
  });
});
