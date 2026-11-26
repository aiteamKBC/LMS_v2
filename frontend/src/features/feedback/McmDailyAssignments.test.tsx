import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { feedbackApi, type FeedbackDailyRecipients, type FeedbackRecipient } from '@/api/feedback';
import { McmRecipients } from './McmRecipients';
import { McmDailyAssignments } from './McmDailyAssignments';

vi.mock('@/api/feedback', () => ({ feedbackApi: { recipientsByDay: vi.fn(), recipientsByCoach: vi.fn() } }));
afterEach(cleanup);
const owner = { key: 'email:coach@example.test', name: 'Example Coach', email: 'coach@example.test' };
const assignment = { key: 'review-1', learnerId: '1', learnerName: 'Example Student', email: 'student@example.test', programme: 'Example programme',
  sourceTitle: 'Monthly review', assignedAt: '2026-07-01T23:30:00Z', formVersion: 1, responseStatus: 'not_started' } as FeedbackRecipient;
const base: FeedbackDailyRecipients = {
  from: '2026-07-01', to: '2026-07-07', timeZone: 'Europe/London', coaches: [owner],
  days: [{ date: '2026-07-02', learnerCount: 25, assignmentCount: 26 }],
  day: '', dayPage: 1, dayPages: 2, totalDays: 15, totalLearners: 25, totalAssignments: 26, undatedCount: 0,
  assignments: [], selectedTotal: 26, page: 1, pageSize: 25, pages: 2,
};
beforeEach(() => {
  vi.mocked(feedbackApi.recipientsByDay).mockReset().mockImplementation(async (_id, filters) => ({
    ...base, day: filters.day, page: filters.page, dayPage: filters.dayPage,
    assignments: filters.day ? [{ ...assignment, coachName: owner.name, coachEmail: owner.email, ...(filters.page === 2 ? { key: 'review-last', learnerName: 'Last Student' } : {}) }] : [],
    ...(filters.search === 'absent' ? { days: [], assignments: [], totalLearners: 0, totalAssignments: 0, totalDays: 0, dayPages: 1 } : {}),
  }));
  vi.mocked(feedbackApi.recipientsByCoach).mockReset().mockResolvedValue({ coaches: [], coachKey: '', learners: [], totalLearners: 0, totalReviews: 0, totalCompleted: 0, page: 1, pageSize: 25, pages: 1 });
});

it('keeps the coach view and loads the daily view only when selected', async () => {
  const user = userEvent.setup(); render(<McmRecipients formId={7} />);
  expect(screen.getByRole('button', { name: 'By coach' })).toHaveAttribute('aria-pressed', 'true');
  expect(feedbackApi.recipientsByDay).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Daily assignments' }));
  expect(await screen.findByRole('button', { name: /02 Jul 2026/ })).toHaveTextContent('25 students · 26 assignments');
  expect(feedbackApi.recipientsByDay).toHaveBeenLastCalledWith(7, expect.objectContaining({ period: '7days' }));
  await user.click(screen.getByRole('button', { name: 'By coach' }));
  expect(await screen.findByRole('searchbox', { name: 'Find a coach or learner' })).toBeVisible();
});

it('expands a day, shows UK assignment time and paginates details without changing day totals', async () => {
  const user = userEvent.setup(); render(<McmDailyAssignments formId={7} />);
  const day = await screen.findByRole('button', { name: /02 Jul 2026/ });
  expect(screen.queryByText('Example Student')).not.toBeInTheDocument();
  await user.click(day);
  expect(await screen.findByText('Example Student')).toBeVisible();
  expect(screen.getByRole('table')).toHaveTextContent('00:30');
  expect(screen.getByRole('table')).toHaveTextContent('Not started');
  await user.click(within(screen.getByRole('navigation', { name: 'Assignment pages' })).getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Last Student')).toBeVisible();
  expect(day).toHaveTextContent('25 students · 26 assignments');
  expect(feedbackApi.recipientsByDay).toHaveBeenLastCalledWith(7, expect.objectContaining({ day: '2026-07-02', page: 2 }));
  await user.click(within(screen.getByRole('navigation', { name: 'Day pages' })).getByRole('button', { name: 'Older days' }));
  await waitFor(() => expect(feedbackApi.recipientsByDay).toHaveBeenLastCalledWith(7, expect.objectContaining({ day: '', page: 1, dayPage: 2 })));
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

it('combines period, coach and search and resets the expanded day and pagination', async () => {
  const user = userEvent.setup(); render(<McmDailyAssignments formId={7} />);
  await user.click(await screen.findByRole('button', { name: /02 Jul 2026/ }));
  await screen.findByText('Example Student');
  await user.selectOptions(screen.getByLabelText('Current coach'), owner.key);
  await waitFor(() => expect(feedbackApi.recipientsByDay).toHaveBeenLastCalledWith(7, expect.objectContaining({ coach: owner.key, day: '', page: 1 })));
  await user.selectOptions(screen.getByLabelText('Assignment period'), 'yesterday');
  await waitFor(() => expect(feedbackApi.recipientsByDay).toHaveBeenLastCalledWith(7, expect.objectContaining({ period: 'yesterday', coach: owner.key })));
  await user.type(screen.getByRole('searchbox'), 'absent');
  expect(await screen.findByText('No MCM feedback assignments match this period and filters.')).toBeVisible();
  expect(feedbackApi.recipientsByDay).toHaveBeenLastCalledWith(7, expect.objectContaining({ search: 'absent', day: '', dayPage: 1, page: 1 }));
});

it('validates custom dates without fetching invalid ranges or displaying stale results', async () => {
  const user = userEvent.setup(); render(<McmDailyAssignments formId={7} />);
  await screen.findByRole('button', { name: /02 Jul 2026/ });
  await user.selectOptions(screen.getByLabelText('Assignment period'), 'custom');
  await waitFor(() => expect(feedbackApi.recipientsByDay).toHaveBeenLastCalledWith(7, expect.objectContaining({ period: 'custom', from: base.from, to: base.to })));
  const count = vi.mocked(feedbackApi.recipientsByDay).mock.calls.length;
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-07-08' } });
  expect(screen.getByText('Choose both dates, with From on or before To.')).toBeVisible();
  expect(screen.queryByRole('button', { name: /02 Jul 2026/ })).not.toBeInTheDocument();
  expect(feedbackApi.recipientsByDay).toHaveBeenCalledTimes(count);
  fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-07-09' } });
  await waitFor(() => expect(feedbackApi.recipientsByDay).toHaveBeenLastCalledWith(7, expect.objectContaining({ from: '2026-07-08', to: '2026-07-09' })));
});

it('shows errors and retries without claiming that assignments are empty', async () => {
  vi.mocked(feedbackApi.recipientsByDay).mockRejectedValueOnce(new Error('Report unavailable'));
  const user = userEvent.setup(); render(<McmDailyAssignments formId={7} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Report unavailable');
  expect(screen.queryByText('No MCM feedback assignments match this period and filters.')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('button', { name: /02 Jul 2026/ })).toBeVisible();
});

it('ignores a stale request after the period changes', async () => {
  let resolveOld!: (data: FeedbackDailyRecipients) => void;
  vi.mocked(feedbackApi.recipientsByDay).mockImplementation(async (_id, filters) => {
    if (filters.period === '7days') return new Promise(resolve => { resolveOld = resolve; });
    return { ...base, days: [], assignments: [], totalAssignments: 0, totalLearners: 0, totalDays: 0 };
  });
  const user = userEvent.setup(); render(<McmDailyAssignments formId={7} />);
  await waitFor(() => expect(resolveOld).toBeDefined());
  await user.selectOptions(screen.getByLabelText('Assignment period'), 'today');
  expect(await screen.findByText('No MCM feedback assignments match this period and filters.')).toBeVisible();
  await act(async () => resolveOld(base));
  expect(screen.queryByRole('button', { name: /02 Jul 2026/ })).not.toBeInTheDocument();
});
