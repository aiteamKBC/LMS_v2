import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumOverview } from '@/lib/curriculumApi';
import type { BulkAttendanceDirectoryLearner } from '@/api/bulkAttendanceLearners';

const mocks = vi.hoisted(() => ({ overview: vi.fn(), groups: vi.fn(), roster: vi.fn(), directory: vi.fn() }));
vi.mock('@/lib/curriculumApi', () => ({ fetchCurriculumOverview: mocks.overview, fetchCurriculumGroups: mocks.groups, fetchCurriculumScopeLearnerRoster: mocks.roster }));
vi.mock('@/api/bulkAttendanceLearners', () => ({ fetchBulkAttendanceLearners: mocks.directory }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));

import AttendancePage from './page';

const overview = {
  programmes: [{ id: 'P1', name: 'Engineering' }, { id: 'P2', name: 'Business' }],
  cohorts: [{ id: 'C1', name: 'Autumn', programmeId: 'P1', endDate: '2099-01-01' }],
  groups: [{ id: 'G1', name: 'Overview Group', cohortId: 'C1' }], modules: [], sessions: [],
} as unknown as CurriculumOverview;
const databaseGroups = [{ id: 'G1', name: 'Group One', cohortId: 'C1' }];
const directory: BulkAttendanceDirectoryLearner[] = [
  { id: '301', name: 'Alex Example', email: 'alex@example.invalid', programme: 'Engineering', group: 'Group One', endDate: '2099-01-01' },
  { id: '302', name: 'Morgan Sample', email: 'morgan@example.invalid', programme: 'Business', group: '', endDate: '2099-01-01' },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.overview.mockResolvedValue(overview);
  mocks.groups.mockResolvedValue(databaseGroups);
  mocks.directory.mockResolvedValue(directory);
  mocks.roster.mockImplementation((_scope, id) => Promise.resolve({ assignedLearners: id === 'P1' ? [
    { id: '91', name: 'Old Roster Name', email: 'ALEX@example.invalid', cohortId: 'C1', groupId: 'G1' },
  ] : [] }));
});

it('updates the table after delayed loading, searches KBC names/email and clears the search', async () => {
  let finish!: (rows: BulkAttendanceDirectoryLearner[]) => void;
  mocks.directory.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<AttendancePage />);
  const search = screen.getByRole('textbox', { name: 'Search learners by name or email' });
  fireEvent.change(search, { target: { value: ' aLeX ' } });
  expect(screen.queryByText('No learners found')).not.toBeInTheDocument();
  await act(async () => finish(directory));
  expect(await screen.findByRole('button', { name: 'Alex Example' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Morgan Sample' })).not.toBeInTheDocument();
  expect(screen.queryByText('Old Roster Name')).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'morgan@' } });
  expect(await screen.findByRole('button', { name: 'Morgan Sample' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Alex Example' })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'no-match' } });
  expect(await screen.findByText('No learners found')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(await screen.findByRole('button', { name: 'Alex Example' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Morgan Sample' })).toBeVisible();
});

it('keeps programme and group filters working after the directory loads', async () => {
  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Morgan Sample' });
  fireEvent.click(screen.getByRole('button', { name: /All Programmes/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Engineering' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Morgan Sample' })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /All Groups/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Group One' }));
  expect(await screen.findByRole('button', { name: 'Alex Example' })).toBeVisible();
});

it('keeps learners with the same name separate', async () => {
  mocks.directory.mockResolvedValue([directory[0], { ...directory[1], name: 'Alex Example' }]);
  render(<AttendancePage />);
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Alex Example' })).toHaveLength(2));
});

it('opens the learner card into a full-name directory with its own search', async () => {
  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Morgan Sample' });

  fireEvent.click(screen.getByRole('button', { name: 'View all 2 learners' }));

  const directoryDialog = await screen.findByRole('dialog', { name: 'Learner directory' });
  expect(directoryDialog).toHaveTextContent('Alex Example');
  expect(directoryDialog).toHaveTextContent('Morgan Sample');

  fireEvent.change(screen.getByRole('searchbox', { name: 'Search learner names' }), {
    target: { value: 'morgan' },
  });
  expect(directoryDialog).toHaveTextContent('Morgan Sample');
  expect(directoryDialog).not.toHaveTextContent('Alex Example');
});

it('preserves existing archived learner IDs when enriching names from KBC', async () => {
  localStorage.setItem('lumina-attendance-archive-manual', JSON.stringify(['91']));
  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Morgan Sample' });
  expect(screen.queryByRole('button', { name: 'Alex Example' })).not.toBeInTheDocument();
});

it('reports directory failures without silently using another learner source', async () => {
  mocks.directory.mockRejectedValue(new Error('Learner directory unavailable'));
  render(<AttendancePage />);
  expect(await screen.findByText('Learner directory unavailable')).toBeVisible();
  expect(screen.queryByText('Old Roster Name')).not.toBeInTheDocument();
});

it('keeps learners visible when the dedicated group read is unavailable', async () => {
  mocks.groups.mockRejectedValue(new Error('Groups endpoint unavailable'));
  render(<AttendancePage />);
  expect(await screen.findByRole('button', { name: 'Morgan Sample' })).toBeVisible();
  expect(await screen.findByText(/latest group filter could not be loaded/i)).toBeVisible();
});
