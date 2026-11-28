import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewFieldDefinition } from '@/api/reviewInstances';
import { isNextMeetingQuestion, NEXT_MEETING_QUESTION, nextReviewBooking, nextReviewBookingUrl, type NextBookingEvent } from './nextReviewBooking';
import { NextReviewBookingLink } from './NextReviewBookingLink';

const meeting = (id: string, overrides: Partial<NextBookingEvent> = {}): NextBookingEvent => ({
  id, eventKey: id, source: 'progress-review', learnerId: '12', reviewTemplateId: 'PR-TEMPLATE',
  occurrenceNumber: Number(id.slice(-1)), targetDate: `2026-1${id.slice(-1)}-10`,
  status: 'not-scheduled', ...overrides,
});

describe('next review booking action', () => {
  it('recognises only the matching MCM and Progress Review confirmation field', () => {
    const field = { id: 'confirmation', title: NEXT_MEETING_QUESTION, fieldType: 'boolean', configuration: {} } as ReviewFieldDefinition;
    expect(isNextMeetingQuestion(field, 'mcm')).toBe(true);
    expect(isNextMeetingQuestion({ ...field, fieldType: 'boolean_case_block' }, 'mcm')).toBe(true);
    expect(isNextMeetingQuestion(field, 'progress_review')).toBe(true);
    expect(isNextMeetingQuestion(field, 'aptem_mcm')).toBe(true);
    expect(isNextMeetingQuestion(field, 'aptem_progress_review')).toBe(true);
    expect(isNextMeetingQuestion(field, 'career_review')).toBe(false);
    expect(isNextMeetingQuestion({ ...field, title: 'Other question' }, 'progress_review')).toBe(false);
  });

  it('opens booking from the review without navigating away', () => {
    expect(nextReviewBookingUrl('coach', 'progress_review', 'REVI-1')).toBe('/coach/progress-reviews?bookNextAfter=REVI-1');
    expect(nextReviewBookingUrl('learner', 'mcm', 'REVI-1')).toBe('/learner/monthly-coaching?bookNextAfter=REVI-1');
    const onBook = vi.fn();
    render(<NextReviewBookingLink family="progress_review" onBook={onBook} />);
    fireEvent.click(screen.getByRole('button', { name: 'Book next Progress Review' }));
    expect(onBook).toHaveBeenCalledOnce();
    expect(screen.queryByRole('link', { name: /Book next/ })).not.toBeInTheDocument();
  });

  it('chooses the immediate next occurrence for the same learner and template', () => {
    const current = meeting('review-1', { reviewInstanceId: 'REVI-1', status: 'completed' });
    const otherLearner = meeting('review-2', { learnerId: '99' });
    const otherTemplate = meeting('review-2', { reviewTemplateId: 'OTHER' });
    const next = meeting('review-2');
    const later = meeting('review-3');
    expect(nextReviewBooking([later, otherLearner, otherTemplate, next, current], 'REVI-1'))
      .toEqual({ kind: 'book', event: next });
  });

  it('reports an already booked immediate occurrence instead of offering a later one', () => {
    const current = meeting('review-1', { reviewInstanceId: 'REVI-1' });
    const booked = meeting('review-2', { status: 'scheduled', scheduledDate: '2026-12-10', bookingReserved: true });
    expect(nextReviewBooking([current, booked, meeting('review-3')], 'REVI-1'))
      .toEqual({ kind: 'booked', event: booked });
  });

  it('uses the next occurrence number even when target dates are out of order', () => {
    const current = meeting('review-1', { reviewInstanceId: 'REVI-1' });
    const next = meeting('review-2', { targetDate: '2026-12-20' });
    const later = meeting('review-3', { targetDate: '2026-12-01' });
    expect(nextReviewBooking([current, later, next], 'REVI-1')).toEqual({ kind: 'book', event: next });
  });

  it('keeps an unreserved occurrence bookable even if a stale date remains', () => {
    const current = meeting('review-1', { reviewInstanceId: 'REVI-1' });
    const next = meeting('review-2', { scheduledDate: '2026-12-10', scheduledTime: '09:00', bookingReserved: false });
    expect(nextReviewBooking([current, next], 'REVI-1')).toEqual({ kind: 'book', event: next });
  });

  it('does not guess a booking when the current or next occurrence is absent', () => {
    const current = meeting('review-1', { reviewInstanceId: 'REVI-1' });
    expect(nextReviewBooking([current], 'REVI-1').kind).toBe('unavailable');
    expect(nextReviewBooking([current], 'unknown').kind).toBe('unavailable');
  });
});
