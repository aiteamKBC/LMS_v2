/**
 * An onboarding apprentice's Reviews stay locked until they submit their
 * enrolment — in the sidebar, and on the Reviews page itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const fetchLearnerSummary = vi.fn();
vi.mock('@/api/learnerDetail', () => ({
  fetchLearnerSummary: (...args: unknown[]) => fetchLearnerSummary(...args),
}));

const getRememberedLearner = vi.fn();
vi.mock('../useMyLearner', () => ({
  getRememberedLearner: () => getRememberedLearner(),
  useMyLearner: () => getRememberedLearner(),
}));

const fetchOnboardingReviews = vi.fn();
vi.mock('@/api/learnerCalendar', () => ({
  fetchOnboardingReviews: (...args: unknown[]) => fetchOnboardingReviews(...args),
  bookLearnerCalendarSession: vi.fn(),
  cancelLearnerCalendarSession: vi.fn(),
  fetchFirstSessionSlots: vi.fn(),
  ukOffsetForDate: vi.fn(),
}));
// The page's chrome is not under test; only what it puts in <main>.
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { markEnrolmentSubmitted, useEnrolmentSubmitted, useLearnerNavGate } from '../useLearnerNavGate';
import { isEnrolmentSubmitted, navItemsForStatus, ONBOARDING_REVIEWS_ROUTE } from '../useOnboardingRedirect';
import OnboardingReviewsPage from '@/pages/learner/onboarding/reviews/page';

const reviewsItem = (items: { href?: string; locked?: boolean }[]) => items.find((i) => i.href === ONBOARDING_REVIEWS_ROUTE);
let n = 0;
const apprentice = () => ({ kind: 'apprenticeship', id: `lock-${++n}` });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  fetchOnboardingReviews.mockResolvedValue({ caseOwner: null, reviews: [], allBooked: false });
});

describe('the onboarding menu', () => {
  it('counts a submitted or staff-completed enrolment as finished', () => {
    expect(isEnrolmentSubmitted('Submitted')).toBe(true);
    expect(isEnrolmentSubmitted('Completed')).toBe(true);
    expect(isEnrolmentSubmitted('In progress')).toBe(false);
    expect(isEnrolmentSubmitted('')).toBe(false);
  });

  it('locks Reviews until the enrolment is submitted', () => {
    expect(reviewsItem(navItemsForStatus('Onboarding', [], 'apprenticeship', false, false, false))).toMatchObject({ locked: true });
    expect(reviewsItem(navItemsForStatus('Onboarding', [], 'apprenticeship', false, false, true))?.locked).toBeUndefined();
  });
});

describe('the learner sidebar', () => {
  it('shows Reviews locked for a learner still filling in their enrolment', async () => {
    const learner = apprentice();
    getRememberedLearner.mockReturnValue(learner);
    fetchLearnerSummary.mockResolvedValue({ learnerType: 'apprenticeship', programmeStatus: 'Onboarding', onboardingStatus: 'In progress' });

    const { result } = renderHook(() => useLearnerNavGate('learner', []));

    await waitFor(() => expect(reviewsItem(result.current)).toMatchObject({ locked: true }));
  });

  it('opens Reviews the moment the learner submits', async () => {
    const learner = apprentice();
    getRememberedLearner.mockReturnValue(learner);
    fetchLearnerSummary.mockResolvedValue({ learnerType: 'apprenticeship', programmeStatus: 'Onboarding', onboardingStatus: 'In progress' });
    const { result } = renderHook(() => useLearnerNavGate('learner', []));
    await waitFor(() => expect(reviewsItem(result.current)?.locked).toBe(true));

    act(() => markEnrolmentSubmitted(learner.kind, learner.id));

    expect(reviewsItem(result.current)?.locked).toBeUndefined();
  });

  it('leaves Reviews open when the status cannot be looked up', async () => {
    getRememberedLearner.mockReturnValue(apprentice());
    fetchLearnerSummary.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useEnrolmentSubmitted('apprenticeship', `lock-${++n}`));

    await waitFor(() => expect(result.current).toBe(true));
  });
});

describe('the Reviews page', () => {
  it('shows the lock instead of the reviews before the enrolment is submitted', async () => {
    getRememberedLearner.mockReturnValue(apprentice());
    fetchLearnerSummary.mockResolvedValue({ onboardingStatus: 'In progress' });

    render(<MemoryRouter><OnboardingReviewsPage /></MemoryRouter>);

    expect(await screen.findByText('Reviews open once your enrolment is submitted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go to My Enrolment/ })).toBeInTheDocument();
    expect(fetchOnboardingReviews).not.toHaveBeenCalled();
  });

  it('shows the reviews once it is submitted', async () => {
    getRememberedLearner.mockReturnValue(apprentice());
    fetchLearnerSummary.mockResolvedValue({ onboardingStatus: 'Submitted' });

    render(<MemoryRouter><OnboardingReviewsPage /></MemoryRouter>);

    expect(await screen.findByText('Your enrolment reviews')).toBeInTheDocument();
    expect(fetchOnboardingReviews).toHaveBeenCalled();
    expect(screen.queryByText('Reviews open once your enrolment is submitted')).not.toBeInTheDocument();
  });
});
