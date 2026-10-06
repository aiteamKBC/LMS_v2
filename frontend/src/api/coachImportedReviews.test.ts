import { describe, expect, it } from 'vitest';
import type { ImportedReview } from './reviewHistory';
import { importedReviewEvents, type CoachImportedReviewLearner } from './coachImportedReviews';

function review(overrides: Partial<ImportedReview> = {}): ImportedReview {
  return {
    id: '2322',
    aptemReviewId: '14010',
    name: 'Monthly coaching review',
    type: 'Monthly Coaching Meeting',
    reviewerName: '',
    plannedDate: '2026-09-25',
    plannedTime: null,
    completedDate: null,
    status: 'Not Scheduled',
    extractionStatus: 'partial',
    detailsAvailable: false,
    sections: [],
    ...overrides,
  };
}

function learner(importedReview: ImportedReview): CoachImportedReviewLearner {
  return {
    id: '316',
    aptemId: '5170',
    name: 'Example learner',
    learnerType: 'apprenticeship',
    mcm: [importedReview],
    reviews: [],
  };
}

describe('importedReviewEvents', () => {
  it('uses only the canonical Aptem review id and exposes summary-only availability', () => {
    const [event] = importedReviewEvents([learner(review())], 'mcm');

    expect(event.id).toBe('imported-review:14010');
    expect(event.eventKey).toBe('imported-review:14010');
    expect(event.aptemReviewId).toBe('14010');
    expect(event.hasReviewForm).toBe(false);
    expect(event.id).not.toContain('2322');
  });

  it('does not create an ambiguous route from the database row id when Aptem id is absent', () => {
    const missingCanonicalId = review({ aptemReviewId: '' });

    expect(importedReviewEvents([learner(missingCanonicalId)], 'mcm')).toEqual([]);
  });
});
