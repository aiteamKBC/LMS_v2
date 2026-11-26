import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssignedLearners, LearnerDirectoryProvider } from '../AssignedLearners';
import { useRefreshAssignedLearners } from '../assignedLearnerDirectory';
import { fetchAssignedLearners, fetchAssignedLearnerProgress, changeProgrammeMembership } from '@/api/assignedLearners';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
vi.mock('@/api/assignedLearners', () => ({ fetchAssignedLearners: vi.fn(), fetchAssignedLearnerProgress: vi.fn(), changeProgrammeMembership: vi.fn() }));
vi.mock('@/components/feature/CurriculumSweetAlert', () => ({ showCurriculumConfirm: vi.fn(async ({ onConfirm }) => { await onConfirm(); return true; }) }));
const target = { scope: 'module' as const, id: 'MOD-A', name: 'Module A' };
const page = { scope: 'module' as const, id: 'MOD-A', status: 'active' as const, total: 2, filteredTotal: 2, page: 1, pageSize: 25,
  learners: [{ id: '1', name: 'Alice Example', email: 'alice@example.invalid', status: 'active' },
    { id: '2', name: 'Bob Example', email: 'bob@example.invalid', status: 'active' }] };
const metrics = { due: { completed: 6, total: 8, percent: 75 }, available: { completed: 6, total: 20, percent: 30 }, undatedActivities: 0, asOfDate: '2026-10-31', timeZone: 'Europe/London' };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchAssignedLearners).mockReset().mockResolvedValue(page);
  vi.mocked(fetchAssignedLearnerProgress).mockReset().mockImplementation(async (_target, ids) => Object.fromEntries(ids.map(id => [id, metrics])));
  vi.mocked(changeProgrammeMembership).mockReset().mockResolvedValue(undefined);
});
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
  expect(fetchAssignedLearnerProgress).not.toHaveBeenCalled();
});

it('shows two independent activity denominators and meaningful status colours', async () => {
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /></LearnerDirectoryProvider>);
  await open();
  expect((await screen.findAllByText('75%'))).toHaveLength(2);
  expect(screen.getAllByText('6 / 20 available activities')).toHaveLength(2);
  expect(screen.getAllByRole('progressbar', { name: 'Plan to date' })[0]).toHaveAttribute('aria-valuenow', '75');
  expect(screen.getAllByText('Active')[0]).toHaveClass('text-emerald-800');
});

it('keeps unknown plan dates distinct from zero progress and can retry failed progress', async () => {
  vi.mocked(fetchAssignedLearnerProgress).mockRejectedValueOnce(new Error('Progress failed'));
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /></LearnerDirectoryProvider>);
  await open();
  await userEvent.click(await screen.findByRole('button', { name: 'Retry progress' }));
  await screen.findAllByText('75%');
  expect(fetchAssignedLearnerProgress).toHaveBeenCalledTimes(2);
});

it.each(['module', 'programme', 'cohort', 'group'] as const)('changes programme membership from the %s directory and refreshes after success', async scope => {
  const member = { ...page.learners[0], programme: 'Example programme', enrolmentId: 91 };
  vi.mocked(fetchAssignedLearners).mockResolvedValue({ ...page, learners: [member] });
  render(<LearnerDirectoryProvider><AssignedLearners target={{ ...target, scope }} /></LearnerDirectoryProvider>);
  await open();
  await userEvent.click(await screen.findByRole('button', { name: 'Remove Alice Example from programme' }));
  await waitFor(() => expect(changeProgrammeMembership).toHaveBeenCalledWith({ ...target, scope }, member, 'remove'));
  await waitFor(() => expect(fetchAssignedLearners).toHaveBeenCalledTimes(2));
});

it('restores withdrawn learners and names the actual programme in confirmation', async () => {
  const member = { ...page.learners[0], programme: 'Example programme', enrolmentId: 91, status: 'withdrawn' };
  vi.mocked(fetchAssignedLearners).mockResolvedValue({ ...page, learners: [member] });
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /></LearnerDirectoryProvider>);
  await open();
  await userEvent.click(await screen.findByRole('button', { name: 'Restore Alice Example to programme' }));
  expect(showCurriculumConfirm).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Example programme') }));
  expect(changeProgrammeMembership).toHaveBeenCalledWith(target, member, 'restore');
});

it('does not change membership when confirmation is cancelled or the identity bridge is missing', async () => {
  vi.mocked(showCurriculumConfirm).mockResolvedValueOnce(false);
  vi.mocked(fetchAssignedLearners).mockResolvedValue({ ...page, learners: [{ ...page.learners[0], programme: 'Example programme', enrolmentId: 91 }, page.learners[1]] });
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /></LearnerDirectoryProvider>);
  await open();
  expect(await screen.findByRole('button', { name: 'Remove Bob Example from programme' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Remove Alice Example from programme' }));
  expect(changeProgrammeMembership).not.toHaveBeenCalled();
});

it('aborts progress on close and ignores late results after reopening', async () => {
  let finish!: (value: Record<string, typeof metrics>) => void;
  vi.mocked(fetchAssignedLearnerProgress).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /></LearnerDirectoryProvider>);
  await open(); await screen.findByText('Alice Example');
  const signal = vi.mocked(fetchAssignedLearnerProgress).mock.calls[0][2];
  await userEvent.keyboard('{Escape}');
  expect(signal.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Module A: 2 active assigned learners' }));
  await screen.findAllByText('75%');
  await act(async () => finish({ '1': { ...metrics, due: { completed: 1, total: 8, percent: 12.5 } } }));
  expect(screen.queryByText('12.5%')).not.toBeInTheDocument();
});

it('loads visible progress in batches of at most five without fetching other pages', async () => {
  const learners = Array.from({ length: 12 }, (_, index) => ({ ...page.learners[0], id: String(index + 1), name: `Learner ${index + 1}` }));
  vi.mocked(fetchAssignedLearners).mockResolvedValue({ ...page, total: 40, filteredTotal: 40, learners });
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /></LearnerDirectoryProvider>);
  await open(); await screen.findAllByText('75%');
  await waitFor(() => expect(fetchAssignedLearnerProgress).toHaveBeenCalledTimes(3));
  expect(vi.mocked(fetchAssignedLearnerProgress).mock.calls.map(call => call[1].length)).toEqual([5, 5, 2]);
  expect(fetchAssignedLearners).toHaveBeenCalledTimes(1);
});

it('keeps missing plan dates separate from no activities due', async () => {
  vi.mocked(fetchAssignedLearnerProgress).mockResolvedValue({
    '1': { ...metrics, due: null, undatedActivities: 2 },
    '2': { ...metrics, due: { completed: 0, total: 0, percent: null } },
  });
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /></LearnerDirectoryProvider>);
  await open();
  expect(await screen.findByText('2 activities need plan dates')).toBeInTheDocument();
  expect(screen.getByText('Nothing due yet')).toBeInTheDocument();
  expect(screen.getByText('Plan dates need review')).toBeInTheDocument();
  expect(screen.queryByText('0%')).not.toBeInTheDocument();
});

it('does not refetch or report success when a membership update fails', async () => {
  vi.mocked(fetchAssignedLearners).mockResolvedValue({ ...page, learners: [{ ...page.learners[0], programme: 'Example programme', enrolmentId: 91 }] });
  vi.mocked(changeProgrammeMembership).mockRejectedValue(new Error('The learner status changed. Reload the list.'));
  render(<LearnerDirectoryProvider><AssignedLearners target={target} /></LearnerDirectoryProvider>);
  await open();
  await userEvent.click(await screen.findByRole('button', { name: 'Remove Alice Example from programme' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The learner status changed.');
  expect(fetchAssignedLearners).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/removed from the programme/)).not.toBeInTheDocument();
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
