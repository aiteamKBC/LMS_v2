import { describe, expect, it } from 'vitest';
import { buildReviewTypeLookup, reviewBucketFor, reviewTypeBuckets } from './reviewTypeFilters';

const importedTypes = [
  'Break in Learning Review', 'Eligibility Review & FS Discussion', 'Gateway Review',
  'Monthly Coaching Meeting', 'Personal Support Plan', 'Progress Review',
  'Progress Review (+ Skills Radar)', 'RPL and Experience', 'Return from Break in Learning',
  'Skills Radar', 'ULN Privacy Notice & Learner Acknowledgement Review', 'Withdrawal Review',
  'Workplace Health & Safety Declaration',
];

describe('all imported review classifications', () => {
  it.each(importedTypes)('combines %s with a matching native type while preserving other types', name => {
    const id = name === 'Monthly Coaching Meeting' ? 'REVT-MCM'
      : name === 'Progress Review' ? 'REVT-PROGRESS_REVIEW' : 'REVT-CUSTOM';
    const native = { reviewTypeId: id, reviewTypeName: name };
    const imported = importedTypes.map(importedReviewType => ({ importedReviewType, source: 'progress-review' }));
    const events = [...imported, native];
    const lookup = buildReviewTypeLookup(events);
    expect(reviewTypeBuckets(events)).toHaveLength(importedTypes.length);
    expect(events.filter(event => reviewBucketFor(event, lookup) === `review:${id}`))
      .toEqual([imported.find(event => event.importedReviewType === name), native]);
    expect(reviewTypeBuckets([...events].reverse())).toEqual(reviewTypeBuckets(events));
  });

  it('does not guess between two distinct native IDs with the same type name', () => {
    const events = [
      { reviewTypeId: 'A', reviewTypeName: 'Career Review' },
      { reviewTypeId: 'B', reviewTypeName: 'Career Review' },
      { importedReviewType: 'Career Review' },
    ];
    const lookup = buildReviewTypeLookup(events);
    expect(new Set(events.map(event => reviewBucketFor(event, lookup))).size).toBe(3);
    expect(reviewTypeBuckets(events)).toHaveLength(3);
  });

  it('resolves type spelling differences without changing titles or routing metadata', () => {
    const native = { reviewTypeId: 'PSP', reviewTypeName: 'Personal Support Plan' };
    const imported = Object.freeze({ importedReviewType: ' personal  SUPPORT plan ', source: 'progress-review' });
    expect(reviewBucketFor(imported, buildReviewTypeLookup([native, imported]))).toBe('review:PSP');
    expect(imported.source).toBe('progress-review');
  });
});

describe('imported and Curriculum system review types', () => {
  it.each([
    ['Monthly Coaching Meeting', 'REVT-MCM', 'mcm'],
    ['Progress Review', 'REVT-PROGRESS_REVIEW', 'progress_review'],
  ])('groups imported %s with its Curriculum type without changing the event', (name, id, code) => {
    const native = { reviewTypeId: id, reviewTypeCode: code, reviewTypeName: name, reviewTypeIsSystem: true };
    const coach = Object.freeze({ source: 'progress-review', importedReviewType: name });
    const learner = Object.freeze({ source: 'progress-review', importedReview: { type: name } });
    expect(reviewBucketFor(coach)).toBe(reviewBucketFor(native));
    expect(reviewBucketFor(learner)).toBe(reviewBucketFor(native));
    expect(reviewTypeBuckets([coach, native, learner])).toEqual(reviewTypeBuckets([native]));
    expect(coach).toEqual({ source: 'progress-review', importedReviewType: name });
    expect(learner).toEqual({ source: 'progress-review', importedReview: { type: name } });
  });

  it('keeps custom classifications authoritative even when they share a system type label', () => {
    const custom = {
      reviewTypeId: 'REVT-CUSTOM', reviewTypeName: 'Monthly Coaching Meeting',
      importedReviewType: 'Monthly Coaching Meeting',
    };
    expect(reviewBucketFor(custom)).toBe('review:REVT-CUSTOM');
    expect(reviewTypeBuckets([custom, { importedReviewType: 'Monthly Coaching Meeting' }])).toHaveLength(2);
  });

  it('does not merge distinct imported types through a common routing code', () => {
    const types = ['Progress Review', 'Progress Review (+ Skills Radar)', 'Personal Support Plan'];
    const events = types.map(importedReviewType => ({ source: 'progress-review', reviewTypeCode: 'progress_review', importedReviewType }));
    expect(new Set(events.map(event => reviewBucketFor(event))).size).toBe(3);
    expect(reviewTypeBuckets(events).map(bucket => bucket.label).sort()).toEqual([...types].sort());
  });

  it('uses the current Curriculum label regardless of which source arrives first', () => {
    const imported = { importedReviewType: 'Monthly Coaching Meeting' };
    const native = {
      reviewTypeId: 'REVT-MCM', reviewTypeCode: 'mcm',
      reviewTypeName: 'Monthly Development Review', reviewTypeIsSystem: true,
    };
    expect(reviewTypeBuckets([imported, native])).toEqual(reviewTypeBuckets([native]));
    expect(reviewTypeBuckets([native, imported])).toEqual(reviewTypeBuckets([native]));
  });
});
