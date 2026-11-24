import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { feedbackApi, type FeedbackCoachRecipients, type FeedbackRecipient } from '@/api/feedback';
import { McmRecipients } from './McmRecipients';

vi.mock('@/api/feedback', () => ({ feedbackApi: { recipientsByCoach: vi.fn() } }));
afterEach(cleanup);
const group = { key: 'email:coach@example.test', name: 'Example Coach', email: 'coach@example.test', learnerCount: 26, reviewCount: 27, completedCount: 1, remainingCount: 26 };
const review = { key: 'review-1', sourceTitle: 'Historical coaching review', sourceStartsAt: '2026-07-01T09:00:00Z', assignedAt: '2026-07-01T09:00:00Z', formVersion: 1, responseStatus: 'completed' } as FeedbackRecipient;
const learner = { learnerId: '1', learnerName: 'Example Student', email: 'student@example.test', programme: 'Example programme', coachName: group.name, reviewCount: 2, completedCount: 1, remainingCount: 1,
  reviews: [review, { ...review, key: 'review-2', sourceTitle: 'Latest coaching review', responseStatus: 'not_started' as const }] };
const base: FeedbackCoachRecipients = { coaches: [group], coachKey: '', learners: [], totalLearners: 26, totalReviews: 27, totalCompleted: 1, page: 1, pageSize: 25, pages: 1 };
beforeEach(() => {
  vi.mocked(feedbackApi.recipientsByCoach).mockReset().mockImplementation(async (_id, search, coach, page = 1) => ({
    ...base, coachKey: coach || '', learners: coach ? [page === 1 ? learner : { ...learner, learnerId: '26', learnerName: 'Last Student' }] : [],
    pages: coach ? 2 : 1, page, ...(search === 'no match' ? { coaches: [], learners: [], totalLearners: 0, totalReviews: 0, totalCompleted: 0 } : {}),
  }));
});

it('opens coach and learner groups, preserves reviews and paginates students', async () => {
  const user = userEvent.setup(); render(<McmRecipients formId={7} />);
  const coach = await screen.findByRole('button', { name: /Example Coach/ });
  expect(coach).toHaveTextContent('26 students · 27 reviews');
  expect(screen.queryByText('Example Student')).not.toBeInTheDocument();
  await user.click(coach);
  await user.click(await screen.findByText('Example Student'));
  const reviews = screen.getByRole('list', { name: 'Example Student reviews' });
  expect(within(reviews).getByText('Historical coaching review')).toBeVisible();
  expect(within(reviews).getAllByText(/01 Jul 2026, 10:00/)).toHaveLength(4);
  expect(within(reviews).getByText('Not started')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Last Student')).toBeVisible();
  expect(screen.queryByText('Example Student')).not.toBeInTheDocument();
  expect(feedbackApi.recipientsByCoach).toHaveBeenLastCalledWith(7, '', group.key, 2);
  await user.click(coach);
  expect(screen.queryByRole('region', { name: 'Example Coach learners' })).not.toBeInTheDocument();
});

it('resets coach and page for a new search and shows an empty state', async () => {
  const user = userEvent.setup(); render(<McmRecipients formId={7} />);
  await user.click(await screen.findByRole('button', { name: /Example Coach/ }));
  await user.click(await screen.findByRole('button', { name: 'Next' }));
  await screen.findByText('Last Student');
  await user.type(screen.getByRole('searchbox', { name: 'Find a coach or learner' }), 'no match');
  expect(await screen.findByText('No coaches or learners match your search.')).toBeVisible();
  expect(feedbackApi.recipientsByCoach).toHaveBeenLastCalledWith(7, 'no match', '', 1);
  await user.clear(screen.getByRole('searchbox'));
  expect(await screen.findByRole('button', { name: /Example Coach/ })).toHaveAttribute('aria-expanded', 'false');
});

it('shows request failures and retries without inventing empty assignments', async () => {
  vi.mocked(feedbackApi.recipientsByCoach).mockRejectedValueOnce(new Error('Assignments unavailable'));
  const user = userEvent.setup(); render(<McmRecipients formId={7} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Assignments unavailable');
  expect(screen.queryByText('No MCM feedback assignments yet.')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('button', { name: /Example Coach/ })).toBeVisible();
});

it('ignores stale coach requests and includes the unassigned group', async () => {
  const other = { ...group, key: 'unassigned', name: 'No coach assigned', email: '' };
  let resolveOld!: (data: FeedbackCoachRecipients) => void;
  vi.mocked(feedbackApi.recipientsByCoach).mockImplementation(async (_id, _search, coach) => {
    if (coach === group.key) return new Promise(resolve => { resolveOld = resolve; });
    return { ...base, coaches: [group, other], coachKey: coach || '', learners: coach ? [{ ...learner, learnerName: 'Unassigned Student' }] : [] };
  });
  const user = userEvent.setup(); render(<McmRecipients formId={7} />);
  await user.click(await screen.findByRole('button', { name: /Example Coach/ }));
  await waitFor(() => expect(resolveOld).toBeDefined());
  await user.click(screen.getByRole('button', { name: /No coach assigned/ }));
  expect(await screen.findByText('Unassigned Student')).toBeVisible();
  await act(async () => resolveOld({ ...base, coachKey: group.key, learners: [learner] }));
  expect(screen.getByText('Unassigned Student')).toBeVisible();
  expect(screen.queryByText('Example Student')).not.toBeInTheDocument();
});
