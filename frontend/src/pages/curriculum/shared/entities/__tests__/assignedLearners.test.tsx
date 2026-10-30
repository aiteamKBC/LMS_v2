import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssignedLearners, LearnerDirectoryProvider } from '../AssignedLearners';
import { useRefreshAssignedLearners } from '../assignedLearnerDirectory';
import { fetchAssignedLearners } from '@/api/assignedLearners';
vi.mock('@/api/assignedLearners', () => ({ fetchAssignedLearners: vi.fn() }));
const target = { scope: 'module' as const, id: 'MOD-A', name: 'Module A' };
const page = { scope: 'module' as const, id: 'MOD-A', status: 'active' as const, total: 2, filteredTotal: 2, page: 1, pageSize: 25,
  learners: [{ id: '1', name: 'Alice Example', email: 'alice@example.invalid', status: 'active' },
    { id: '2', name: 'Bob Example', email: 'bob@example.invalid', status: 'active' }] };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(fetchAssignedLearners).mockResolvedValue(page); });
const open = () => userEvent.click(screen.getByRole('button', { name: 'Module A: view assigned learners' }));

it('makes zero requests for mounted cards, StrictMode, filtering or rerenders and reuses existing counts', async () => {
  const cards = (limit: number) => <StrictMode><LearnerDirectoryProvider>
    <AssignedLearners target={target} initialCount={7} />
    {Array.from({ length: limit }, (_, index) => <AssignedLearners key={index} target={{ scope: (['programme', 'cohort', 'group', 'module'] as const)[index % 4], id: String(index), name: `Scope ${index}` }} />)}
  </LearnerDirectoryProvider></StrictMode>;
  const { rerender } = render(cards(200));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(screen.getByRole('button', { name: 'Module A: 7 active assigned learners' })).toBeInTheDocument();
  rerender(cards(15));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(fetchAssignedLearners).not.toHaveBeenCalled();
});

it('opens exactly one requested roster on click, deduplicates repeated opens and updates only its count', async () => {
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /><AssignedLearners target={{ ...target, id: 'MOD-B', name: 'Module B' }} initialCount={4} /></LearnerDirectoryProvider>);
  const button = screen.getByRole('button', { name: 'Module A: view assigned learners' });
  expect(fetchAssignedLearners).not.toHaveBeenCalled();
  fireEvent.click(button); fireEvent.click(button);
  expect(await screen.findByText('Alice Example')).toBeVisible();
  expect(fetchAssignedLearners).toHaveBeenCalledTimes(1);
  expect(fetchAssignedLearners).toHaveBeenCalledWith(target, 'active', '', 1, expect.any(AbortSignal));
  expect(screen.getByRole('button', { name: 'Module A: 2 active assigned learners' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Module B: 4 active assigned learners' })).toBeInTheDocument();
});

it('keeps the active badge when the author explicitly requests all statuses', async () => {
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /></LearnerDirectoryProvider>);
  await open(); await screen.findByText('Alice Example');
  vi.mocked(fetchAssignedLearners).mockResolvedValue({ ...page, status: 'all', total: 3, filteredTotal: 3,
    learners: [...page.learners, { id: '3', name: 'Former learner', email: 'former@example.invalid', status: 'withdrawn' }] });
  await userEvent.selectOptions(screen.getByLabelText('Status'), 'all');
  await screen.findByText('3 assigned learners');
  expect(screen.getByRole('button', { name: 'Module A: 2 active assigned learners' })).toBeInTheDocument();
  expect(fetchAssignedLearners).toHaveBeenCalledTimes(2);
});

it('does not fabricate a zero on failure and retries only on request', async () => {
  vi.mocked(fetchAssignedLearners).mockRejectedValueOnce(new Error('Please retry.'));
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /></LearnerDirectoryProvider>);
  await open();
  expect(await screen.findByRole('alert')).toHaveTextContent('Please retry.');
  expect(screen.queryByText('0 learners')).not.toBeInTheDocument();
  expect(fetchAssignedLearners).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Alice Example')).toBeVisible();
});

it('debounces search, cancels stale requests and never replaces the latest results', async () => {
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /></LearnerDirectoryProvider>);
  await open(); await screen.findByText('Alice Example');
  let resolveOld!: (value: typeof page) => void;
  vi.mocked(fetchAssignedLearners).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  fireEvent.change(screen.getByLabelText('Search learners'), { target: { value: 'o' } });
  fireEvent.change(screen.getByLabelText('Search learners'), { target: { value: 'old' } });
  expect(fetchAssignedLearners).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(fetchAssignedLearners).toHaveBeenLastCalledWith(target, 'active', 'old', 1, expect.any(AbortSignal)));
  expect(fetchAssignedLearners).toHaveBeenCalledTimes(2);
  const oldSignal = vi.mocked(fetchAssignedLearners).mock.calls.at(-1)![4];
  fireEvent.change(screen.getByLabelText('Search learners'), { target: { value: 'new' } });
  expect(oldSignal.aborted).toBe(true);
  vi.mocked(fetchAssignedLearners).mockResolvedValue({ ...page, learners: [{ ...page.learners[0], name: 'New result' }] });
  await screen.findByText('New result');
  await act(async () => resolveOld({ ...page, learners: [{ ...page.learners[0], name: 'Stale result' }] }));
  expect(screen.queryByText('Stale result')).not.toBeInTheDocument();
});

it('cancels a queued open when closed immediately, without sending a request', async () => {
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /></LearnerDirectoryProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Module A: view assigned learners' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(fetchAssignedLearners).not.toHaveBeenCalled();
});

it('aborts on close, invalidates after assignments without fetching, and reads fresh only on reopen', async () => {
  function Invalidate() { const refresh = useRefreshAssignedLearners(); return <button onClick={() => refresh?.(target)}>Assignments changed</button>; }
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /><Invalidate /></LearnerDirectoryProvider>);
  await open(); await screen.findByText('Alice Example');
  const signal = vi.mocked(fetchAssignedLearners).mock.calls[0][4];
  await userEvent.keyboard('{Escape}'); expect(signal.aborted).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Assignments changed' }));
  expect(screen.getByRole('button', { name: 'Module A: view assigned learners' })).toBeInTheDocument();
  expect(fetchAssignedLearners).toHaveBeenCalledTimes(1);
  await open(); await screen.findByText('Alice Example');
  expect(fetchAssignedLearners).toHaveBeenCalledTimes(2);
});

it('keeps assignment loading visible and prevents repeated opens until the existing workflow is ready', async () => {
  let finish!: () => void;
  const manage = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<LearnerDirectoryProvider><AssignedLearners target={target} onManage={manage} /></LearnerDirectoryProvider>);
  await open(); await screen.findByText('Alice Example');
  await userEvent.click(screen.getByRole('button', { name: 'Assignments & progress' }));
  expect(screen.getByRole('button', { name: 'Opening assignments...' })).toBeDisabled();
  expect(manage).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
