import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AssignmentAttemptHistory } from './AssignmentAttemptHistory';

afterEach(cleanup);
const previous = { number: 1, status: 'rejected', answer: 'First answer', coachFeedback: 'Revise the evidence', reviewedBy: 'Coach', reviewedAt: null, submittedAt: null };

it.each(['submitted_for_tutor_review', 'accepted'])('keeps the rejection alongside the %s attempt', status => {
  render(<AssignmentAttemptHistory attempts={[previous, { ...previous, number: 2, status, answer: 'Revised answer', coachFeedback: status === 'accepted' ? 'Accepted feedback' : '', reviewedBy: '' }]} />);
  expect(screen.getByText('Submission history (2 attempts)')).toBeVisible();
  fireEvent.click(screen.getByText('Attempt 1 — Rejected'));
  expect(screen.getByText('First answer')).toBeVisible();
  fireEvent.click(screen.getByText(status === 'accepted' ? 'Attempt 2 — Accepted' : 'Attempt 2 — Awaiting coach review'));
  expect(screen.getByText('Revised answer')).toBeVisible();
  expect(screen.getByText('Revise the evidence')).toBeVisible();
  expect(screen.getByText(status === 'accepted' ? 'Accepted feedback' : 'No feedback recorded yet.')).toBeVisible();
});

it('does not invent an attempt for an empty draft', () => {
  render(<AssignmentAttemptHistory attempts={[]} />);
  expect(screen.queryByRole('region')).toBeNull();
});
