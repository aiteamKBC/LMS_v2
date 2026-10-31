import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchAssignedLearners, fetchLearnerStatusCounts } from '@/api/assignedLearners';
import { LearnerDirectoryProvider } from '../AssignedLearners';
import { LearnerStatusCounts } from '../LearnerStatusCounts';

vi.mock('@/api/assignedLearners', () => ({ fetchAssignedLearners: vi.fn(), fetchLearnerStatusCounts: vi.fn() }));
vi.mock('@/hooks/useRefreshOnReturn', () => ({ useLiveRefresh: vi.fn() }));

const target = { scope: 'group' as const, id: 'G1', name: 'Group A' };
const summary = { total: 4, statuses: { active: 2, withdrawn: 1, 'on break': 1 } };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchLearnerStatusCounts).mockImplementation(async (_scope, ids) => Object.fromEntries(ids.map(id => [id, summary])));
  vi.mocked(fetchAssignedLearners).mockResolvedValue({ scope: 'group', id: 'G1', status: 'all', total: 1, filteredTotal: 1, page: 1, pageSize: 25,
    learners: [{ id: 'synthetic-1', name: 'Former learner', email: 'former@example.invalid', status: 'withdrawn' }] });
});
afterEach(cleanup);

it('automatically batches visible rows, bounds requests and never loads names on mount', async () => {
  render(<StrictMode><LearnerDirectoryProvider>{Array.from({ length: 205 }, (_, index) =>
    <LearnerStatusCounts key={index} target={{ ...target, id: `G${index}`, name: `Group ${index}` }} />)}</LearnerDirectoryProvider></StrictMode>);
  await screen.findByRole('button', { name: 'Group 204: 4 all statuses learners' });
  expect(fetchLearnerStatusCounts).toHaveBeenCalledTimes(3);
  expect(vi.mocked(fetchLearnerStatusCounts).mock.calls.map(call => call[1].length)).toEqual([100, 100, 5]);
  expect(fetchAssignedLearners).not.toHaveBeenCalled();
});

it('shows labelled, distinct icons and colours for each status, with hover titles and keyboard names', async () => {
  render(<LearnerDirectoryProvider><LearnerStatusCounts target={target} /></LearnerDirectoryProvider>);
  const active = await screen.findByRole('button', { name: 'Group A: 2 active learners' });
  expect(active).toHaveAttribute('title', 'Active: 2 learners');
  expect(active).toHaveClass('text-emerald-700');
  expect(screen.getByRole('button', { name: 'Group A: 1 withdrawn learners' })).toHaveClass('text-red-700');
  expect(screen.getByRole('button', { name: 'Group A: 1 on break learners' })).toHaveAttribute('title', 'On Break: 1 learners');
  expect(screen.getByRole('button', { name: 'Group A: 4 all statuses learners' })).toBeVisible();
});

it('opens only the selected scope and status, while leaving all count chips unchanged', async () => {
  render(<LearnerDirectoryProvider><LearnerStatusCounts target={target} /><LearnerStatusCounts target={{ ...target, id: 'G2', name: 'Group B' }} /></LearnerDirectoryProvider>);
  await userEvent.click(await screen.findByRole('button', { name: 'Group A: 1 withdrawn learners' }));
  expect(await screen.findByText('Former learner')).toBeVisible();
  expect(fetchAssignedLearners).toHaveBeenCalledWith(target, 'all', '', 1, expect.any(AbortSignal), 'withdrawn');
  expect(screen.getByLabelText('Status')).toHaveValue('withdrawn');
  expect(screen.getByRole('button', { name: 'Group A: 4 all statuses learners' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Group B: 4 all statuses learners' })).toBeVisible();
});

it('shows genuine zeroes but never turns a failed count read into zero', async () => {
  vi.mocked(fetchLearnerStatusCounts).mockRejectedValueOnce(new Error('Counts unavailable'));
  render(<LearnerDirectoryProvider><LearnerStatusCounts target={target} /></LearnerDirectoryProvider>);
  const retry = await screen.findByRole('button', { name: 'Retry learner counts' });
  expect(screen.queryByRole('button', { name: /0 all statuses/ })).toBeNull();
  vi.mocked(fetchLearnerStatusCounts).mockResolvedValueOnce({ G1: { total: 0, statuses: {} } });
  fireEvent.click(retry);
  expect(await screen.findByRole('button', { name: 'Group A: 0 all statuses learners' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Group A: 0 active learners' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Group A: 0 withdrawn learners' })).toBeVisible();
});

it('reuses counts across filtering/remounts and refreshes after a new data revision', async () => {
  const rows = (show: boolean, revision: number) => <LearnerDirectoryProvider>{show && <LearnerStatusCounts target={target} refreshKey={revision} />}</LearnerDirectoryProvider>;
  const view = render(rows(true, 0));
  await screen.findByRole('button', { name: 'Group A: 4 all statuses learners' });
  expect(fetchLearnerStatusCounts).toHaveBeenCalledTimes(1);
  view.rerender(rows(false, 0));
  view.rerender(rows(true, 0));
  await screen.findByRole('button', { name: 'Group A: 4 all statuses learners' });
  expect(fetchLearnerStatusCounts).toHaveBeenCalledTimes(1);
  vi.mocked(fetchLearnerStatusCounts).mockResolvedValueOnce({ G1: { total: 1, statuses: { completed: 1 } } });
  view.rerender(rows(true, 1));
  expect(await screen.findByRole('button', { name: 'Group A: 1 completed learners' })).toBeVisible();
  expect(fetchAssignedLearners).not.toHaveBeenCalled();
});

it('retains the last valid counts during a failed refresh and exposes a retry', async () => {
  const view = render(<LearnerDirectoryProvider><LearnerStatusCounts target={target} refreshKey={0} /></LearnerDirectoryProvider>);
  await screen.findByRole('button', { name: 'Group A: 4 all statuses learners' });
  vi.mocked(fetchLearnerStatusCounts).mockRejectedValueOnce(new Error('Retry later'));
  view.rerender(<LearnerDirectoryProvider><LearnerStatusCounts target={target} refreshKey={1} /></LearnerDirectoryProvider>);
  await screen.findByRole('button', { name: 'Group A: retry learner counts' });
  expect(within(screen.getByRole('group', { name: 'Group A: learner counts' })).getByRole('button', { name: /4 all statuses/ })).toBeVisible();
});
