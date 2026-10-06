/**
 * Enrolment reviews — a completed review can be downloaded straight from its
 * card, as the same document the review's own Export PDF produces.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { OnboardingReview } from '@/api/learnerCalendar';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/hooks/useMyLearner', () => ({ useMyLearner: () => ({ kind: 'apprenticeship', id: '670' }) }));
vi.mock('@/hooks/useLearnerNavGate', () => ({ useEnrolmentSubmitted: () => true }));
const calendar = vi.hoisted(() => ({ fetchOnboardingReviews: vi.fn() }));
vi.mock('@/api/learnerCalendar', () => ({
  ...calendar,
  bookLearnerCalendarSession: vi.fn(),
  cancelLearnerCalendarSession: vi.fn(),
  fetchFirstSessionSlots: vi.fn(async () => ({ slots: [] })),
  ukOffsetForDate: () => '+01:00',
}));
const form = vi.hoisted(() => ({ fetchReviewForm: vi.fn() }));
vi.mock('@/api/reviewForm', () => form);
const doc = vi.hoisted(() => ({ downloadReviewPdf: vi.fn() }));
vi.mock('../reviews/reviewDocument', () => doc);

import OnboardingReviewsPage from '../reviews/page';
import { REVIEW_QUESTION_LABELS } from '../reviews/questions';

const event = (eventKey: string) => ({ eventKey, scheduledDate: '2026-10-01', scheduledTime: '09:00', coachName: 'Case Owner', invited: true });
const review = (type: OnboardingReview['type'], label: string, extra: Partial<OnboardingReview>): OnboardingReview =>
  ({ type, label, booked: true, hasForm: true, event: event(`ev-${type}`), ...extra }) as OnboardingReview;

const card = (label: string) => screen.getByRole('heading', { name: label }).closest('div.rounded-2xl') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  calendar.fetchOnboardingReviews.mockResolvedValue({
    caseOwner: { name: 'Case Owner', email: '' },
    allBooked: true,
    reviews: [
      review('eligibility-review', 'Eligibility Review & FS Discussion', { formStarted: true, formCompleted: true, learnerSigned: true }),
      review('workspace', 'RPL And Experience', { formStarted: true, formCompleted: false }),
      review('training-plan', 'Workplace Health & Safety Declaration', { formStarted: false }),
    ],
  });
});

function renderPage() {
  render(<MemoryRouter><OnboardingReviewsPage /></MemoryRouter>);
}

describe('enrolment review download', () => {
  it('is offered only on a completed review', async () => {
    renderPage();
    await screen.findByText('Eligibility Review & FS Discussion');

    expect(within(card('Eligibility Review & FS Discussion')).getByRole('button', { name: /Download review/ })).toBeInTheDocument();
    expect(within(card('RPL And Experience')).queryByRole('button', { name: /Download review/ })).not.toBeInTheDocument();
    expect(within(card('Workplace Health & Safety Declaration')).queryByRole('button', { name: /Download review/ })).not.toBeInTheDocument();
  });

  it('downloads that review’s document from the saved answers', async () => {
    const saved = { completed: true, answers: {} };
    form.fetchReviewForm.mockResolvedValue(saved);
    renderPage();
    await screen.findByText('Eligibility Review & FS Discussion');

    await userEvent.click(within(card('Eligibility Review & FS Discussion')).getByRole('button', { name: /Download review/ }));

    await waitFor(() => expect(doc.downloadReviewPdf).toHaveBeenCalledWith(saved, REVIEW_QUESTION_LABELS));
    expect(form.fetchReviewForm).toHaveBeenCalledWith('apprenticeship', '670', 'ev-eligibility-review');
  });

  it('says so when the download fails', async () => {
    form.fetchReviewForm.mockRejectedValue(new Error('Review not found.'));
    renderPage();
    await screen.findByText('Eligibility Review & FS Discussion');

    await userEvent.click(within(card('Eligibility Review & FS Discussion')).getByRole('button', { name: /Download review/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Review not found.');
    expect(doc.downloadReviewPdf).not.toHaveBeenCalled();
  });
});
