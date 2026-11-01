import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fetchLearnerStatusCounts } from '@/api/assignedLearners';
import { LearnerDirectoryProvider } from '../../shared/entities/AssignedLearners';
import { ModuleLearnerCount } from '../ModuleLearnerCount';

vi.mock('@/api/assignedLearners', () => ({ fetchLearnerStatusCounts: vi.fn() }));
vi.mock('@/hooks/useRefreshOnReturn', () => ({ useLiveRefresh: vi.fn() }));

beforeEach(() => {
  vi.mocked(fetchLearnerStatusCounts).mockReset().mockResolvedValue({
    'MOD-1': { total: 5, statuses: { active: 2, withdrawn: 1, 'on break': 2 } },
  });
});

it('shows one total across all statuses and opens assignments directly', async () => {
  const open = vi.fn().mockResolvedValue(5);
  render(<LearnerDirectoryProvider><ModuleLearnerCount moduleId="MOD-1" moduleName="Module A" onOpen={open} /></LearnerDirectoryProvider>);
  const count = await screen.findByRole('button', { name: 'Module A: 5 learners' });
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(count);
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('keeps genuine zeroes and permits direct assignment for an empty module', async () => {
  vi.mocked(fetchLearnerStatusCounts).mockResolvedValue({ 'MOD-1': { total: 0, statuses: {} } });
  const open = vi.fn().mockResolvedValue(0);
  render(<LearnerDirectoryProvider><ModuleLearnerCount moduleId="MOD-1" moduleName="Module A" onOpen={open} /></LearnerDirectoryProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Module A: 0 learners' }));
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
});

it('does not turn a failed count into zero or block the assignment workflow', async () => {
  vi.mocked(fetchLearnerStatusCounts).mockRejectedValueOnce(new Error('Counts unavailable'));
  const open = vi.fn().mockResolvedValue(5);
  render(<LearnerDirectoryProvider><ModuleLearnerCount moduleId="MOD-1" moduleName="Module A" onOpen={open} /></LearnerDirectoryProvider>);
  const retry = await screen.findByRole('button', { name: 'Module A: retry learner count' });
  expect(screen.queryByRole('button', { name: 'Module A: 0 learners' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Module A: view learners' }));
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  fireEvent.click(retry);
  expect(await screen.findByRole('button', { name: 'Module A: 5 learners' })).toBeEnabled();
});

it('retains the total and blocks duplicate opens while details load', async () => {
  let finish!: (count: number) => void;
  const open = vi.fn(() => new Promise<number>(resolve => { finish = resolve; }));
  render(<LearnerDirectoryProvider><ModuleLearnerCount moduleId="MOD-1" moduleName="Module A" onOpen={open} /></LearnerDirectoryProvider>);
  const count = await screen.findByRole('button', { name: 'Module A: 5 learners' });
  fireEvent.click(count);
  fireEvent.click(count);
  expect(count).toBeDisabled();
  expect(count).toHaveTextContent('5 learners');
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => finish(5));
  expect(count).toBeEnabled();
});
