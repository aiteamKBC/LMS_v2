/**
 * Coach timetable Review filters are built from Curriculum Review Types.
 *
 * Same rule as the learner calendar, and deliberately the same helper: a
 * review event's bucket is decided by its Review Type id and nothing else --
 * never by the event title, never by the legacy `source` routing value. MCM
 * and Progress Review go through exactly the same path as Career Review.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCoachSourceChips,
  buildCoachSourceOptions,
  eventMatchesSourceFilter,
  filterBySource,
  isSourceFilterValue,
  type CoachFilterableEvent,
} from '../sourceFilters';
import { reviewTypeBuckets as sharedBuckets } from '@/lib/reviewTypeFilters';

interface TestEvent extends CoachFilterableEvent {
  title: string;
  status?: string;
}

function reviewEvent(
  { title, typeId, typeCode, typeName, isSystem = false, source = 'review', status = 'scheduled' }: {
    title: string; typeId: string; typeCode: string; typeName: string;
    isSystem?: boolean; source?: string; status?: string;
  },
): TestEvent {
  return {
    title, source, status, type: 'review',
    reviewTypeId: typeId, reviewTypeCode: typeCode,
    reviewTypeName: typeName, reviewTypeIsSystem: isSystem,
  };
}

const mcm = (title = 'Monthly Coaching Meeting', status = 'scheduled') => reviewEvent({
  title, status, typeId: 'REVT-MCM', typeCode: 'mcm',
  typeName: 'Monthly Coaching Meeting', isSystem: true, source: 'mcr',
});
const progressReview = (title = 'Progress Review') => reviewEvent({
  title, typeId: 'REVT-PROGRESS_REVIEW', typeCode: 'progress_review',
  typeName: 'Progress Review', isSystem: true, source: 'progress-review',
});
const careerReview = (title = 'Career Planning Session', status = 'scheduled') => reviewEvent({
  title, status, typeId: 'REVT-CAREER', typeCode: 'career_review', typeName: 'Career Review',
});
const gatewayReview = (title = 'Gateway Check') => reviewEvent({
  title, typeId: 'REVT-GATEWAY', typeCode: 'gateway_review', typeName: 'Gateway Review',
});
const supportPlan = (title = 'Support Plan') => reviewEvent({
  title, typeId: 'REVT-PSP', typeCode: 'personal_support_plan', typeName: 'Personal Support Plan',
});

/** A legacy review event from before Review Types existed. */
const unclassifiedReview = (title = 'Legacy review'): TestEvent => ({ title, source: 'review', type: 'review' });

const liveSession = (): TestEvent => ({ title: 'Module 3 live', source: 'live-session', type: 'live-session' });
const catchUp = (): TestEvent => ({ title: 'Catch-up', source: 'catch-up', type: 'coaching' });
const support = (): TestEvent => ({ title: 'Support', source: 'student-support', type: 'welfare' });
const other = (): TestEvent => ({ title: 'Other session', source: 'other', type: 'coaching' });

describe('bucketing one coach event', () => {
  it('puts an MCM event under Monthly Coaching Meeting', () => {
    expect(eventMatchesSourceFilter(mcm(), 'review:REVT-MCM')).toBe(true);
  });

  it('puts a Progress Review event under Progress Review', () => {
    expect(eventMatchesSourceFilter(progressReview(), 'review:REVT-PROGRESS_REVIEW')).toBe(true);
  });

  it('puts a custom Career Review under Career Review', () => {
    expect(eventMatchesSourceFilter(careerReview(), 'review:REVT-CAREER')).toBe(true);
  });

  it('puts a custom Gateway Review under Gateway Review', () => {
    expect(eventMatchesSourceFilter(gatewayReview(), 'review:REVT-GATEWAY')).toBe(true);
  });

  it('never collapses two custom types together, despite one routing source', () => {
    expect(eventMatchesSourceFilter(careerReview(), 'review:REVT-GATEWAY')).toBe(false);
    expect(eventMatchesSourceFilter(gatewayReview(), 'review:REVT-CAREER')).toBe(false);
    expect(careerReview().source).toBe(gatewayReview().source);
  });

  it('keeps an unclassified legacy review in the generic bucket', () => {
    expect(eventMatchesSourceFilter(unclassifiedReview(), 'review:')).toBe(true);
    // ...and a properly classified custom type never leaks into it.
    expect(eventMatchesSourceFilter(careerReview(), 'review:')).toBe(false);
  });

  it('keeps a renamed Review template in its Review Type bucket', () => {
    const renamed = reviewEvent({
      title: 'Monthly Learner Development Session', typeId: 'REVT-MCM', typeCode: 'mcm',
      typeName: 'Monthly Coaching Meeting', isSystem: true, source: 'mcr',
    });
    expect(eventMatchesSourceFilter(renamed, 'review:REVT-MCM')).toBe(true);
    expect(renamed.title).not.toBe(renamed.reviewTypeName);
  });

  it('moves a reclassified template to its new type', () => {
    const reclassified = reviewEvent({
      title: 'Career Planning Session', typeId: 'REVT-GATEWAY',
      typeCode: 'gateway_review', typeName: 'Gateway Review',
    });
    expect(eventMatchesSourceFilter(reclassified, 'review:REVT-GATEWAY')).toBe(true);
    expect(eventMatchesSourceFilter(reclassified, 'review:REVT-CAREER')).toBe(false);
  });

  it('puts two templates of the same Review Type in one bucket', () => {
    const a = reviewEvent({ title: 'Monthly Learner Catch-up', typeId: 'REVT-MCM', typeCode: 'mcm', typeName: 'Monthly Coaching Meeting', isSystem: true, source: 'mcr' });
    const b = reviewEvent({ title: 'Monthly Review', typeId: 'REVT-MCM', typeCode: 'mcm', typeName: 'Monthly Coaching Meeting', isSystem: true, source: 'mcr' });
    expect(filterBySource([a, b], 'review:REVT-MCM')).toHaveLength(2);
  });

  it('leaves the non-review sources matching exactly as before', () => {
    expect(eventMatchesSourceFilter(liveSession(), 'live-session')).toBe(true);
    expect(eventMatchesSourceFilter(catchUp(), 'catch-up')).toBe(true);
    expect(eventMatchesSourceFilter(support(), 'student-support')).toBe(true);
    expect(eventMatchesSourceFilter(other(), 'other')).toBe(true);
    expect(eventMatchesSourceFilter({ source: 'other', type: 'welfare' }, 'other')).toBe(false);
    // The welfare `type` fallback the coach has always had.
    expect(eventMatchesSourceFilter({ source: 'other', type: 'welfare' }, 'student-support')).toBe(true);
  });

  it('never lets a review event answer to a non-review chip', () => {
    expect(eventMatchesSourceFilter(careerReview(), 'catch-up')).toBe(false);
    expect(eventMatchesSourceFilter(mcm(), 'student-support')).toBe(false);
  });

  it('accepts review bucket keys as valid filter values', () => {
    expect(isSourceFilterValue('review:REVT-CAREER')).toBe(true);
    expect(isSourceFilterValue('all')).toBe(true);
    expect(isSourceFilterValue('catch-up')).toBe(true);
    expect(isSourceFilterValue('nonsense')).toBe(false);
  });
});

describe('building the coach filter row', () => {
  const dataset = [
    liveSession(), catchUp(), support(),
    mcm(), mcm(), progressReview(),
    careerReview(), careerReview(), careerReview(), gatewayReview(), supportPlan(),
  ];

  it('offers one chip per Review Type present, and no generic Reviews chip', () => {
    const labels = buildCoachSourceChips(dataset).map((chip) => chip.label);
    expect(labels).toEqual([
      'All Sources', 'Live Sessions',
      'Monthly Coaching Meeting', 'Progress Review',
      'Career Review', 'Gateway Review', 'Personal Support Plan',
      'Catch-up', 'Support', 'Other',
    ]);
    expect(labels).not.toContain('Reviews');
    expect(labels).not.toContain('MCR');
    expect(labels).not.toContain('PR');
  });

  it('orders system types first, then custom types alphabetically', () => {
    const labels = buildCoachSourceChips([
      supportPlan(), gatewayReview(), careerReview(), progressReview(), mcm(),
    ]).filter((chip) => chip.value.startsWith('review:')).map((chip) => chip.label);
    expect(labels).toEqual([
      'Monthly Coaching Meeting', 'Progress Review',
      'Career Review', 'Gateway Review', 'Personal Support Plan',
    ]);
  });

  it('does not depend on the order events arrived in', () => {
    const forwards = buildCoachSourceChips(dataset).map((chip) => chip.value);
    const backwards = buildCoachSourceChips([...dataset].reverse()).map((chip) => chip.value);
    expect(backwards).toEqual(forwards);
  });

  it('puts an unclassified review bucket after every real type', () => {
    const labels = buildCoachSourceChips([unclassifiedReview(), careerReview(), mcm()])
      .filter((chip) => chip.value.startsWith('review:')).map((chip) => chip.label);
    expect(labels).toEqual(['Monthly Coaching Meeting', 'Career Review', 'Review']);
  });

  it('offers no review chips when the coach has no review events', () => {
    expect(buildCoachSourceChips([liveSession(), catchUp()]).map((chip) => chip.label))
      .toEqual(['All Sources', 'Live Sessions', 'Catch-up', 'Support', 'Other']);
  });

  it('uses the same colour for a Review Type as the learner calendar', () => {
    // Both sides call the shared helper, so a type's dot is identical.
    const coach = buildCoachSourceChips(dataset).find((chip) => chip.value === 'review:REVT-CAREER');
    const shared = sharedBuckets(dataset).find((bucket) => bucket.key === 'review:REVT-CAREER');
    expect(coach?.dot).toBe(shared?.dot);
    expect(coach?.dot).toBeTruthy();
  });
});

describe('coach counts and filtering', () => {
  const dataset = [
    liveSession(), catchUp(), support(),
    mcm(), mcm(), progressReview(),
    careerReview(), careerReview(), careerReview(), gatewayReview(),
  ];

  it('counts each Review Type separately', () => {
    const counts = Object.fromEntries(
      buildCoachSourceOptions(dataset, dataset).map((option) => [option.value, option.count]),
    );
    expect(counts['review:REVT-MCM']).toBe(2);
    expect(counts['review:REVT-PROGRESS_REVIEW']).toBe(1);
    expect(counts['review:REVT-CAREER']).toBe(3);
    expect(counts['review:REVT-GATEWAY']).toBe(1);
  });

  it('counts everything under All and leaves non-review counts alone', () => {
    const counts = Object.fromEntries(
      buildCoachSourceOptions(dataset, dataset).map((option) => [option.value, option.count]),
    );
    expect(counts.all).toBe(dataset.length);
    expect(counts['live-session']).toBe(1);
    expect(counts['catch-up']).toBe(1);
    expect(counts['student-support']).toBe(1);
  });

  it('keeps a chip at 0 when its type has nothing in the visible range', () => {
    const options = buildCoachSourceOptions(dataset, [mcm()]);
    const career = options.find((option) => option.value === 'review:REVT-CAREER');
    expect(career).toBeDefined();
    expect(career?.count).toBe(0);
  });

  it('All shows every event type', () => {
    expect(filterBySource(dataset, 'all')).toHaveLength(dataset.length);
  });

  it('one Review Type filter hides the other Review Types', () => {
    expect(filterBySource(dataset, 'review:REVT-CAREER').map((e) => e.title))
      .toEqual(['Career Planning Session', 'Career Planning Session', 'Career Planning Session']);
  });

  it('a system Review Type filters through the same mechanism', () => {
    expect(filterBySource(dataset, 'review:REVT-MCM')).toHaveLength(2);
  });

  it('clearing back to All restores everything', () => {
    expect(filterBySource(dataset, 'review:REVT-GATEWAY')).toHaveLength(1);
    expect(filterBySource(dataset, 'all')).toHaveLength(dataset.length);
  });

  it('composes with a status filter', () => {
    const events = [careerReview('Career Planning Session', 'completed'), careerReview(), mcm('MCM', 'completed')];
    const byType = filterBySource(events, 'review:REVT-CAREER');
    expect(byType).toHaveLength(2);
    expect(byType.filter((e) => e.status === 'completed')).toHaveLength(1);
  });

  it('composes with a search term', () => {
    const events = [mcm(), careerReview('Career Planning Session'), gatewayReview()];
    const searched = events.filter((e) => [e.title, e.reviewTypeName || '']
      .some((value) => value.toLowerCase().includes('career')));
    expect(filterBySource(searched, 'review:REVT-CAREER').map((e) => e.title))
      .toEqual(['Career Planning Session']);
  });
});
