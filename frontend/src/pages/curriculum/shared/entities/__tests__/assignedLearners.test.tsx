import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssignedLearners, LearnerDirectoryProvider } from '../AssignedLearners';
import { fetchAssignedCounts, fetchAssignedLearners } from '@/api/assignedLearners';
vi.mock('@/api/assignedLearners', () => ({ fetchAssignedCounts: vi.fn(), fetchAssignedLearners: vi.fn() }));
const target = { scope: 'module' as const, id: 'MOD-A', name: 'Module A' };
const page = { scope: 'module' as const, id: 'MOD-A', status: 'active' as const, total: 2, filteredTotal: 2, page: 1, pageSize: 25,
  learners: [{ id: '1', name: 'Alice Example', email: 'alice@example.invalid', status: 'active' },
    { id: '2', name: 'Bob Example', email: 'bob@example.invalid', status: 'active' }] };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchAssignedCounts).mockImplementation(async (_scope, ids) => ({ counts: Object.fromEntries(ids.map(id => [id, 2])) }));
  vi.mocked(fetchAssignedLearners).mockResolvedValue(page);
});
it('batches visible counts and loads names only on click with an active default', async () => {
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /><AssignedLearners target={{ ...target, id: 'MOD-B', name: 'Module B' }} /></LearnerDirectoryProvider>);
  await waitFor(() => expect(fetchAssignedCounts).toHaveBeenCalledTimes(1));
  expect(fetchAssignedCounts).toHaveBeenCalledWith('module', ['MOD-A', 'MOD-B'], expect.any(AbortSignal), false);
  expect(fetchAssignedLearners).not.toHaveBeenCalled();
  await userEvent.click(await screen.findByRole('button', { name: 'Module A: 2 active assigned learners' }));
  expect(await screen.findByText('Alice Example')).toBeVisible();
  expect(fetchAssignedLearners).toHaveBeenCalledWith(target, 'active', '', 1, expect.any(AbortSignal));
});
it('keeps the active badge when the author views all statuses', async () => {
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /></LearnerDirectoryProvider>);
  await userEvent.click(await screen.findByRole('button', { name: 'Module A: 2 active assigned learners' }));
  await screen.findByText('Alice Example');
  vi.mocked(fetchAssignedLearners).mockResolvedValue({ ...page, status: 'all', total: 8, filteredTotal: 8 });
  await userEvent.selectOptions(screen.getByLabelText('Status'), 'all');
  await screen.findByText('8 assigned learners');
  expect(screen.getByRole('button', { name: 'Module A: 2 active assigned learners' })).toBeInTheDocument();
});
it('keeps failures distinct from zero and supports retry', async () => {
  vi.mocked(fetchAssignedCounts).mockRejectedValue(new Error('Unavailable'));
  vi.mocked(fetchAssignedLearners).mockRejectedValueOnce(new Error('Please retry.'));
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /></LearnerDirectoryProvider>);
  await waitFor(() => expect(screen.getByRole('button', { name: /Module A:/ })).toHaveAttribute('title', expect.stringContaining('unavailable')));
  expect(screen.queryByText('0 learners')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Module A:/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please retry.');
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Alice Example')).toBeVisible();
});
it('cancels stale name searches and never replaces the latest results', async () => {
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /></LearnerDirectoryProvider>);
  await userEvent.click(await screen.findByRole('button', { name: 'Module A: 2 active assigned learners' }));
  await screen.findByText('Alice Example');
  let resolveOld!: (value: typeof page) => void;
  vi.mocked(fetchAssignedLearners).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  fireEvent.change(screen.getByLabelText('Search learners'), { target: { value: 'old' } });
  await waitFor(() => expect(fetchAssignedLearners).toHaveBeenLastCalledWith(target, 'active', 'old', 1, expect.any(AbortSignal)));
  const oldSignal = vi.mocked(fetchAssignedLearners).mock.calls.at(-1)![4];
  fireEvent.change(screen.getByLabelText('Search learners'), { target: { value: 'new' } });
  expect(oldSignal.aborted).toBe(true);
  vi.mocked(fetchAssignedLearners).mockResolvedValue({ ...page, learners: [{ ...page.learners[0], name: 'New result' }] });
  await screen.findByText('New result');
  await act(async () => resolveOld({ ...page, learners: [{ ...page.learners[0], name: 'Stale result' }] }));
  expect(screen.queryByText('Stale result')).not.toBeInTheDocument();
});

it('keeps assignment loading visible and prevents repeated opens until the existing workflow is ready', async () => {
  let finish!: () => void;
  const manage = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<LearnerDirectoryProvider><AssignedLearners target={target} onManage={manage} /></LearnerDirectoryProvider>);
  await userEvent.click(await screen.findByRole('button', { name: 'Module A: 2 active assigned learners' }));
  await screen.findByText('Alice Example');
  await userEvent.click(screen.getByRole('button', { name: 'Assignments & progress' }));
  expect(screen.getByRole('button', { name: 'Opening assignments...' })).toBeDisabled();
  expect(manage).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
