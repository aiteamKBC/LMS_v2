import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumOverview } from '@/lib/curriculumApi';
import type { BulkAttendanceDirectoryLearner } from '@/api/bulkAttendanceLearners';

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  groups: vi.fn(),
  sessions: vi.fn(),
  roster: vi.fn(),
  directory: vi.fn(),
  kbcHistory: vi.fn(),
  kbcRecent: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@/lib/curriculumApi', () => ({
  fetchCurriculumOverview: mocks.overview,
  fetchCurriculumGroups: mocks.groups,
  fetchCurriculumSessions: mocks.sessions,
  fetchCurriculumScopeLearnerRoster: mocks.roster,
}));
vi.mock('@/api/bulkAttendanceLearners', () => ({
  fetchBulkAttendanceLearners: mocks.directory,
  fetchBulkAttendanceKbcHistory: mocks.kbcHistory,
  fetchBulkAttendanceKbcRecent: mocks.kbcRecent,
  saveBulkAttendanceChanges: mocks.save,
  BulkAttendanceSaveError: class extends Error {
    saved: string[];
    constructor(message: string, saved: string[] = []) {
      super(message);
      this.saved = saved;
    }
  },
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import AttendancePage from './page';

const overview = {
  programmes: [{ id: 'P1', name: 'Engineering' }],
  cohorts: [{ id: 'C1', name: 'Autumn', programmeId: 'P1', endDate: '2099-01-01' }],
  groups: [], modules: [], sessions: [],
} as unknown as CurriculumOverview;

const directory: BulkAttendanceDirectoryLearner[] = [
  { id: '301', name: 'Alex Example', email: 'alex@example.invalid', programme: 'Engineering', group: '', endDate: '2099-01-01', status: 'Active' },
  { id: '302', name: 'Morgan Sample', email: 'morgan@example.invalid', programme: '', group: '', endDate: '2099-01-01', status: 'Onboarding' },
  // Past its end date but still Active: end dates no longer archive anyone.
  { id: '303', name: 'Riley Past', email: 'riley@example.invalid', programme: '', group: '', endDate: '2020-01-01', status: 'Delivery' },
  { id: '304', name: 'Casey Done', email: 'casey@example.invalid', programme: '', group: '', endDate: '2099-01-01', status: 'Completed' },
  { id: '305', name: 'Jamie Epa', email: 'jamie@example.invalid', programme: '', group: '', endDate: '2099-01-01', status: 'EnteredEpa' },
  { id: '306', name: 'Taylor Left', email: 'taylor@example.invalid', programme: '', group: '', endDate: '2099-01-01', status: 'Withdrawn' },
];

beforeEach(() => {
  // reset, not clear: a test's leftover mockResolvedValueOnce must not leak into the next.
  vi.resetAllMocks();
  localStorage.clear();
  mocks.overview.mockResolvedValue(overview);
  mocks.groups.mockResolvedValue([]);
  mocks.sessions.mockResolvedValue([]);
  mocks.roster.mockResolvedValue({ assignedLearners: [] });
  mocks.directory.mockResolvedValue({ learners: directory, warnings: [] });
  mocks.kbcHistory.mockResolvedValue({ records: [], warnings: [] });
  mocks.kbcRecent.mockResolvedValue({ recent: {}, warnings: [] });
  mocks.save.mockResolvedValue(['live:7']);
});

it('archives only Completed, EnteredEpa and Withdrawn learners and shows every status', async () => {
  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });

  // The register keeps a learner past their end date while their status is active.
  for (const name of ['Alex Example', 'Morgan Sample', 'Riley Past']) {
    expect(screen.getByRole('button', { name })).toBeVisible();
  }
  for (const name of ['Casey Done', 'Jamie Epa', 'Taylor Left']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  }
  expect(screen.getByText('Delivery')).toBeVisible();
  expect(screen.getByText('Onboarding')).toBeVisible();
  const header = screen.getByText('Last 4 lectures').parentElement as HTMLElement;
  expect(within(header).getByText('Status')).toBeInTheDocument();
  expect(within(header).queryByText('Lecture')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Archived (3)' }));
  for (const [name, status] of [['Casey Done', 'Completed'], ['Jamie Epa', 'EnteredEpa'], ['Taylor Left', 'Withdrawn']]) {
    const row = (await screen.findByRole('button', { name })).closest('div.flex.flex-col') as HTMLElement;
    expect(within(row).getByText(status)).toBeVisible();
  }
  expect(screen.queryByRole('button', { name: /Restore/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Archive learners/ })).not.toBeInTheDocument();
});

it('filters the register by group using that group\'s roster', async () => {
  mocks.overview.mockResolvedValue({
    ...overview,
    groups: [
      { id: 'G1', name: 'Group A', cohortId: 'C1' },
      { id: 'G2', name: 'Group B', cohortId: 'C-other' },
    ],
  });
  mocks.roster.mockImplementation(async (scope: string, identifier: string) => (
    scope === 'group' && identifier === 'G1'
      ? { assignedLearners: [{ id: 9, email: 'morgan@example.invalid', cohort: 'Autumn', group: 'Group A', cohortId: 'C1', groupId: 'G1' }] }
      : { assignedLearners: [] }
  ));

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  fireEvent.click(screen.getByRole('button', { name: /^Group\s*All Groups$/ }));
  expect(screen.getByRole('button', { name: 'Group B' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Group A' }));

  await waitFor(() => expect(mocks.roster).toHaveBeenCalledWith(
    'group', 'G1', { learnerStatus: 'all' }, expect.any(AbortSignal), { timeoutMs: 180000 },
  ));
  expect(await screen.findByRole('button', { name: 'Morgan Sample' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Alex Example' })).not.toBeInTheDocument();

  // Choosing a cohort limits the group choices to that cohort's groups.
  fireEvent.click(screen.getByRole('button', { name: /^Cohort\s*All Cohorts$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Autumn' }));
  fireEvent.click(screen.getByRole('button', { name: /^Group\s*All Groups$/ }));
  expect(screen.getByRole('button', { name: 'Group A' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Group B' })).not.toBeInTheDocument();
});

it('loads each filter roster once and reuses it when the filter is chosen again', async () => {
  mocks.overview.mockResolvedValue({
    ...overview,
    groups: [{ id: 'G1', name: 'Group A', cohortId: 'C1' }],
  });
  mocks.roster.mockImplementation(async (scope: string) => (
    scope === 'group'
      ? { assignedLearners: [{ id: 9, email: 'morgan@example.invalid', cohort: 'Autumn', group: 'Group A', cohortId: 'C1', groupId: 'G1' }] }
      : { assignedLearners: [{ id: 8, email: 'alex@example.invalid', cohort: 'Autumn', group: '', cohortId: 'C1' }] }
  ));
  const choose = (filter: RegExp, option: string) => {
    fireEvent.click(screen.getByRole('button', { name: filter }));
    fireEvent.click(screen.getByRole('button', { name: option }));
  };

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  choose(/^Group\s*All Groups$/, 'Group A');
  expect(await screen.findByRole('button', { name: 'Morgan Sample' })).toBeVisible();
  expect(mocks.roster.mock.calls[0][4]).toEqual({ timeoutMs: 180000 });

  choose(/^Group\s*Group A$/, 'All Groups');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Riley Past' })).toBeVisible());
  choose(/^Group\s*All Groups$/, 'Group A');
  expect(await screen.findByRole('button', { name: 'Morgan Sample' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Riley Past' })).not.toBeInTheDocument();
  expect(mocks.roster).toHaveBeenCalledTimes(1);
});

it('offers a retry when a filter roster cannot be loaded', async () => {
  mocks.overview.mockResolvedValue({ ...overview, groups: [{ id: 'G1', name: 'Group A', cohortId: 'C1' }] });
  mocks.roster
    .mockRejectedValueOnce(new Error('The request timed out.'))
    .mockResolvedValueOnce({ assignedLearners: [{ id: 9, email: 'morgan@example.invalid', cohort: '', group: 'Group A', groupId: 'G1' }] });

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  fireEvent.click(screen.getByRole('button', { name: /^Group\s*All Groups$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Group A' }));
  expect(await screen.findByText('The request timed out.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('button', { name: 'Morgan Sample' })).toBeVisible();
  expect(mocks.roster).toHaveBeenCalledTimes(2);
});

it('opens View details when a learner is chosen in the learner directory', async () => {
  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  fireEvent.click(screen.getByRole('button', { name: /^View all \d+ learners$/ }));
  const entry = await screen.findByRole('button', { name: 'Open attendance details for Morgan Sample' });
  await act(async () => {
    fireEvent.click(entry);
  });
  expect(await screen.findByRole('dialog', { name: 'Morgan Sample' })).toBeVisible();
  await waitFor(() => expect(mocks.kbcHistory).toHaveBeenCalledWith('302', expect.any(AbortSignal)));
});

it('switches and saves any record, KBC or live, present or absent or unmarked', async () => {
  const live = {
    recordKey: 'live:7', learnerId: '301', sessionDate: '2026-10-08', moduleName: 'Commercial Intelligence',
    lectureName: 'Pricing workshop', sessionNumber: 3, attendance: 'present', source: 'live',
  };
  const kbc = {
    recordKey: 'k1', learnerId: '301', sessionDate: '2026-09-01', moduleName: 'Legacy',
    lectureName: 'Lecture 1', sessionNumber: 1, attendance: 'absent', source: 'kbc',
  };
  const unmarked = {
    recordKey: 'k2', learnerId: '301', sessionDate: '2026-08-01', moduleName: 'Legacy',
    lectureName: 'Lecture 0', sessionNumber: 0, attendance: null, source: 'kbc',
  };
  mocks.kbcHistory
    .mockResolvedValueOnce({ records: [live, kbc, unmarked], warnings: [] })
    .mockResolvedValueOnce({
      records: [{ ...live, attendance: 'absent' }, { ...kbc, attendance: 'present' }, { ...unmarked, attendance: 'present' }],
      warnings: [],
    });
  mocks.save.mockResolvedValue(['live:7', 'k1', 'k2']);

  render(<AttendancePage />);
  const details = await screen.findByRole('button', { name: 'View details for Alex Example' });
  await act(async () => {
    fireEvent.click(details);
  });
  const dialog = await screen.findByRole('dialog', { name: 'Alex Example' });
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Change present to absent for Pricing workshop' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Change absent to present for Lecture 1' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Change unmarked to present for Lecture 0' }));
  expect(within(dialog).getByText('3 unsaved changes')).toBeVisible();
  expect(within(dialog).queryByRole('button', { name: /arrow/i })).not.toBeInTheDocument();
  expect(dialog.querySelector('.ri-arrow-left-right-line')).toBeNull();

  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: /^Save$/ }));
  });

  expect(mocks.save).toHaveBeenCalledWith(expect.arrayContaining([
    { source: 'live', recordKey: 'live:7', attendance: 'absent' },
    { source: 'kbc', recordKey: 'k1', attendance: 'present' },
    { source: 'kbc', recordKey: 'k2', attendance: 'present' },
  ]));
  await waitFor(() => expect(mocks.kbcHistory).toHaveBeenCalledTimes(2));
  expect(await within(dialog).findByRole('button', { name: 'Change absent to present for Pricing workshop' })).toBeVisible();
  expect(within(dialog).queryByText(/unsaved change/)).not.toBeInTheDocument();
  await waitFor(() => expect(mocks.kbcRecent).toHaveBeenCalledTimes(2));
});

it('switching a record back to its saved status leaves nothing to save', async () => {
  mocks.kbcHistory.mockResolvedValue({ records: [{
    recordKey: 'k1', learnerId: '301', sessionDate: '2026-09-01', moduleName: 'Legacy',
    lectureName: 'Lecture 1', sessionNumber: 1, attendance: 'absent', source: 'kbc',
  }], warnings: [] });
  render(<AttendancePage />);
  const details = await screen.findByRole('button', { name: 'View details for Alex Example' });
  await act(async () => {
    fireEvent.click(details);
  });
  const dialog = await screen.findByRole('dialog', { name: 'Alex Example' });
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Change absent to present for Lecture 1' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Change present to absent for Lecture 1' }));
  expect(within(dialog).queryByText(/unsaved change/)).not.toBeInTheDocument();
});

it('keeps unsaved changes, including after closing, and reports the error when saving fails', async () => {
  mocks.kbcHistory.mockResolvedValue({ records: [{
    recordKey: 'live:7', learnerId: '301', sessionDate: '2026-10-08', moduleName: 'M',
    lectureName: 'Pricing workshop', sessionNumber: 3, attendance: 'absent', source: 'live',
  }], warnings: [] });
  mocks.save.mockRejectedValueOnce(new Error('Attendance could not be saved. Nothing was changed; please try again.'));

  render(<AttendancePage />);
  const details = await screen.findByRole('button', { name: 'View details for Alex Example' });
  await act(async () => {
    fireEvent.click(details);
  });
  const dialog = await screen.findByRole('dialog', { name: 'Alex Example' });
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Change absent to present for Pricing workshop' }));
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: /^Save$/ }));
  });
  expect(await within(dialog).findByText('Attendance could not be saved. Nothing was changed; please try again.')).toBeVisible();
  expect(within(dialog).getByText('1 unsaved change')).toBeVisible();

  fireEvent.click(within(dialog).getByRole('button', { name: 'Close history' }));
  expect(screen.queryByRole('dialog', { name: 'Alex Example' })).not.toBeInTheDocument();
  expect(screen.getByText('1 attendance correction not saved')).toBeVisible();
});

it('switches a Last 4 badge and saves it from the register', async () => {
  mocks.kbcRecent.mockResolvedValue({
    recent: { '301': [{
      recordKey: 'k9', learnerId: '301', sessionDate: '2026-10-01', moduleName: 'Project Controls',
      lectureName: 'Lecture 9', sessionNumber: 9, attendance: 'absent', source: 'kbc',
    }] },
    warnings: [],
  });
  mocks.save.mockResolvedValue(['k9']);
  render(<AttendancePage />);
  const badge = await screen.findByRole('button', { name: /^Lecture 9 \(KBC\) • .* • Absent\. Click to mark present$/ });
  fireEvent.click(badge);
  expect(await screen.findByRole('button', { name: /^Lecture 9 \(KBC\) • .* • Present\. Click to mark absent$/ })).toBeVisible();
  expect(screen.getByText('1 attendance correction not saved')).toBeVisible();

  const bar = screen.getByRole('region', { name: 'Unsaved attendance corrections' });
  await act(async () => {
    fireEvent.click(within(bar).getByRole('button', { name: /^Save$/ }));
  });
  expect(mocks.save).toHaveBeenCalledWith([{ source: 'kbc', recordKey: 'k9', attendance: 'present' }]);
  await waitFor(() => expect(mocks.kbcRecent).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/attendance correction not saved/)).not.toBeInTheDocument();
});

it("shows each learner's last four saved lectures from KBC and the live register", async () => {
  const record = (key: string, sessionDate: string, attendance: 'present' | 'absent', source: 'kbc' | 'live' = 'kbc') => ({
    recordKey: key, learnerId: '301', sessionDate, moduleName: 'Project Controls',
    lectureName: `Lecture ${key}`, sessionNumber: null, attendance, source,
  });
  mocks.kbcRecent.mockResolvedValue({
    recent: {
      '301': [
        record('1', '2026-09-17', 'present'),
        record('2', '2026-09-24', 'absent'),
        record('3', '2026-10-01', 'present'),
        record('4', '2026-10-08', 'absent', 'live'),
      ],
    },
    warnings: [],
  });

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });

  expect(await screen.findByTitle(/^Lecture 1 \(KBC\) • .* • Present$/)).toBeInTheDocument();
  expect(screen.getByTitle(/^Lecture 2 \(KBC\) • .* • Absent$/)).toBeInTheDocument();
  expect(screen.getByTitle(/^Lecture 4 \(Live register\) • .* • Absent$/)).toBeInTheDocument();
  expect(mocks.kbcRecent).toHaveBeenCalledTimes(1);
  expect(mocks.kbcHistory).not.toHaveBeenCalled();
});

it('shows a partial-read warning when the live register could not be read', async () => {
  mocks.kbcRecent.mockResolvedValue({
    recent: {},
    warnings: ['The live session register could not be read; showing KBC attendance only.'],
  });
  render(<AttendancePage />);
  expect(await screen.findByText('The live session register could not be read; showing KBC attendance only.')).toBeVisible();
});

it('reports a recent-attendance failure instead of silently showing empty badges', async () => {
  mocks.kbcRecent.mockRejectedValueOnce(new Error('Unable to load recent KBC attendance. Please try again.'));
  render(<AttendancePage />);
  expect(await screen.findByText('Unable to load recent KBC attendance. Please try again.')).toBeVisible();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Retry recent attendance' }));
  });
  await waitFor(() => expect(mocks.kbcRecent).toHaveBeenCalledTimes(2));
});

it('renders KBC learner names and searches the directory without requesting attendance history', async () => {
  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  expect(screen.getByRole('button', { name: 'Morgan Sample' })).toBeVisible();
  expect(mocks.kbcHistory).not.toHaveBeenCalled();

  fireEvent.change(screen.getByRole('textbox', { name: 'Search learners by name or email' }), {
    target: { value: 'morgan@' },
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Morgan Sample' })).toBeVisible());
  expect(screen.queryByRole('button', { name: 'Alex Example' })).not.toBeInTheDocument();
});

it('loads every KBC attendance record only after View details is pressed', async () => {
  mocks.kbcHistory.mockResolvedValue({ records: [
    {
      recordKey: 'kbc-older', learnerId: '301', sessionDate: '2024-05-20',
      moduleName: 'Legacy Programme', lectureName: 'Lecture 1: Kickoff',
      sessionNumber: 1, attendance: 'present', source: 'kbc',
    },
    {
      recordKey: 'live:7', learnerId: '301', sessionDate: '2026-06-01',
      moduleName: 'Current Programme', lectureName: 'Lecture 2: Checkpoint',
      sessionNumber: 2, attendance: 'absent', source: 'live',
    },
  ], warnings: [] });

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'View details for Alex Example' });
  expect(mocks.kbcHistory).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'View details for Alex Example' }));
  });

  expect(await screen.findByRole('dialog', { name: 'Alex Example' })).toBeVisible();
  await waitFor(() => expect(mocks.kbcHistory).toHaveBeenCalledWith('301', expect.any(AbortSignal)));
  const dialog = screen.getByRole('dialog', { name: 'Alex Example' });
  expect(await within(dialog).findByText('Lecture 1: Kickoff')).toBeVisible();
  expect(within(dialog).getByText('Lecture 2: Checkpoint')).toBeVisible();
  expect(within(dialog).getByText('Module: Legacy Programme')).toBeVisible();
  expect(within(dialog).getByText('All attendance records')).toBeVisible();
  expect(within(dialog).getByText('Source: KBC')).toBeVisible();
  expect(within(dialog).getByText('Source: Live register')).toBeVisible();
  // Every record can be corrected, KBC history included.
  expect(within(dialog).getByRole('button', { name: 'Change present to absent for Lecture 1: Kickoff' })).toBeVisible();
});
