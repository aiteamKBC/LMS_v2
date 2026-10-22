import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
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
  dayLearners: vi.fn(),
  save: vi.fn(),
  addLiveDay: vi.fn(),
  liveDayRecords: vi.fn(),
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
  fetchBulkAttendanceDayLearners: mocks.dayLearners,
  saveBulkAttendanceChanges: mocks.save,
  createBulkAttendanceLiveDay: mocks.addLiveDay,
  fetchBulkAttendanceLiveDayRecords: mocks.liveDayRecords,
  BulkAttendanceSaveError: class extends Error {
    saved: string[];
    constructor(message: string, saved: string[] = []) {
      super(message);
      this.saved = saved;
    }
  },
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>,
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
  mocks.dayLearners.mockResolvedValue(directory.map((learner) => learner.id));
  mocks.save.mockResolvedValue(['live:7']);
  mocks.addLiveDay.mockResolvedValue({ created: 1, updated: 0 });
  mocks.liveDayRecords.mockResolvedValue([]);
});

it('filters by saved day membership outside Last 4 while keeping complete history', async () => {
  const recent = [{
    recordKey: 'saved-1', learnerId: '301', sessionDate: '2026-10-14',
    moduleName: 'Module A', lectureName: 'Recent lecture', attendance: 'present', source: 'live',
  }];
  mocks.kbcRecent.mockResolvedValue({ recent: { '301': recent }, warnings: [] });
  mocks.kbcHistory.mockResolvedValue({ records: [...recent, {
    ...recent[0], recordKey: 'old-1', sessionDate: '2020-01-02', lectureName: 'Historical lecture', source: 'kbc',
  }], warnings: [] });
  mocks.dayLearners.mockImplementation(async (day: string) => day === '2020-01-02' ? ['301'] : []);
  render(<AttendancePage />);
  const dateInput = screen.getByLabelText('Date');
  fireEvent.change(dateInput, { target: { value: '2020-01-02' } });
  await screen.findByRole('button', { name: 'Alex Example' });
  expect(screen.queryByRole('button', { name: 'Morgan Sample' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'View all 1 learners' })).toBeVisible();
  expect(screen.getByText('Oct 14')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'View details for Alex Example' }));
  expect(await screen.findByText('Historical lecture')).toBeVisible();
  expect(screen.getByText('Recent lecture')).toBeVisible();
  expect(mocks.kbcHistory).toHaveBeenCalledWith('301', expect.any(AbortSignal), { source: 'all' });
});

it('ignores an old date response and keeps empty days empty with a usable add-day action', async () => {
  let finishOld!: (ids: string[]) => void;
  mocks.dayLearners.mockImplementation((day: string) => day === '2020-01-02'
    ? new Promise<string[]>((resolve) => { finishOld = resolve; })
    : Promise.resolve(day === '2020-01-03' ? ['302'] : []));
  render(<AttendancePage />);
  const dateInput = screen.getByLabelText('Date');
  fireEvent.change(dateInput, { target: { value: '2020-01-02' } });
  await waitFor(() => expect(finishOld).toBeTypeOf('function'));
  fireEvent.change(dateInput, { target: { value: '2020-01-03' } });
  await screen.findByRole('button', { name: 'Morgan Sample' });
  await act(async () => finishOld(['301']));
  expect(screen.queryByRole('button', { name: 'Alex Example' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Morgan Sample' })).toBeVisible();
  fireEvent.change(dateInput, { target: { value: '2020-01-04' } });
  await screen.findByText('No learners found');
  expect(screen.queryByRole('button', { name: 'Morgan Sample' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add attendance day' })).toBeEnabled();
});

it('reports a failed day read and retries rather than showing the unfiltered directory', async () => {
  mocks.dayLearners.mockRejectedValueOnce(new Error('Day unavailable')).mockResolvedValue(['301']);
  render(<AttendancePage />);
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2020-01-02' } });
  expect(await screen.findByText('Day unavailable')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Alex Example' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry attendance date' }));
  expect(await screen.findByRole('button', { name: 'Alex Example' })).toBeVisible();
});

it('intersects the selected day with the group roster and learner search', async () => {
  mocks.overview.mockResolvedValue({ ...overview, groups: [{ id: 'G1', name: 'Group A', cohortId: 'C1' }] });
  mocks.dayLearners.mockResolvedValue(['302', '303']);
  mocks.roster.mockResolvedValue({ assignedLearners: [
    { id: 1, email: 'alex@example.invalid', groupId: 'G1' },
    { id: 2, email: 'morgan@example.invalid', groupId: 'G1' },
  ] });
  render(<AttendancePage />);
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2020-01-02' } });
  await screen.findByRole('button', { name: 'Morgan Sample' });
  fireEvent.click(screen.getByRole('button', { name: /^Group\s*All Groups$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Group A' }));
  await screen.findByRole('button', { name: 'Morgan Sample' });
  expect(screen.queryByRole('button', { name: 'Alex Example' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Riley Past' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('Search learner by name or email'), { target: { value: 'Alex' } });
  await screen.findByText('No learners found');
  expect(screen.queryByRole('button', { name: 'Alex Example' })).not.toBeInTheDocument();
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
  expect(within(header).getByText('Learner / Status')).toBeInTheDocument();
  expect(within(header).queryByText('Attendance')).not.toBeInTheDocument();
  expect(within(header).queryByText('Lecture')).not.toBeInTheDocument();
  expect(screen.queryByText('Select session')).not.toBeInTheDocument();
  const actionsButton = screen.getByRole('button', { name: 'Actions' });
  expect(actionsButton).toBeVisible();
  fireEvent.click(actionsButton);
  expect(screen.getByRole('menuitem', { name: 'Export PDF' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: 'Export CSV' })).toBeVisible();

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
  // The dropdown reflects the choice before the deferred roster request begins.
  expect(screen.getByRole('button', { name: /^Group\s*Group A$/ })).toBeVisible();

  await waitFor(() => expect(mocks.roster).toHaveBeenCalledWith(
    'group', 'G1', { learnerStatus: 'all' }, expect.any(AbortSignal), { timeoutMs: 60000, compact: true },
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

it('starts without a date filter and shows the full active roster', async () => {
  mocks.dayLearners.mockImplementation(() => new Promise(() => undefined));
  render(<AttendancePage />);
  const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
  expect(dateInput.value).toBe('');
  for (const name of ['Alex Example', 'Morgan Sample', 'Riley Past']) {
    expect(await screen.findByRole('button', { name })).toBeVisible();
  }
  expect(screen.queryByText('Unable to load attendance for this date.')).not.toBeInTheDocument();
});

it('hides test, rewan, osama and known test names from every filter category', async () => {
  mocks.overview.mockResolvedValue({
    ...overview,
    programmes: [
      { id: 'P1', name: 'Engineering' },
      { id: 'P2', name: 'Test LMS Curriculum' },
      { id: 'P3', name: 'Rewan 2' },
      { id: 'P4', name: 'Osama-Final-Prog' },
    ],
    cohorts: [
      { id: 'C1', name: 'Autumn', programmeId: 'P1' },
      { id: 'C2', name: 'Test cohort', programmeId: 'P1' },
    ],
    groups: [
      { id: 'G1', name: 'Group A', cohortId: 'C1' },
      { id: 'G2', name: 'Osama Group', cohortId: 'C1' },
      { id: 'G3', name: 'gg', cohortId: 'C1' },
    ],
    modules: [
      { id: 'M1', moduleCatalogueId: 'MC1', name: 'Visible Module', programmeId: 'P1', groupId: 'G1' },
      { id: 'M2', moduleCatalogueId: 'MC2', name: 'Test 45', programmeId: 'P1', groupId: 'G1' },
      { id: 'M3', moduleCatalogueId: 'MC3', name: 'Rewan test', programmeId: 'P1', groupId: 'G1' },
      { id: 'M4', moduleCatalogueId: 'MC4', name: 'Osama-prog', programmeId: 'P1', groupId: 'G1' },
      { id: 'M5', moduleCatalogueId: 'MC5', name: 'AI in Project Control copy', programmeId: 'P1', groupId: 'G1' },
      { id: 'M6', moduleCatalogueId: 'MC6', name: '333', programmeId: 'P1', groupId: 'G1' },
      { id: 'M7', moduleCatalogueId: 'MC7', name: 'latest mod', programmeId: 'P1', groupId: 'G1' },
    ],
  });
  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });

  fireEvent.click(screen.getByRole('button', { name: /^Programme\s*All Programmes$/ }));
  expect(screen.getByRole('button', { name: 'Engineering' })).toBeVisible();
  for (const name of ['Test LMS Curriculum', 'Rewan 2', 'Osama-Final-Prog']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Engineering' }));

  fireEvent.click(screen.getByRole('button', { name: /^Cohort\s*All Cohorts$/ }));
  expect(screen.getByRole('button', { name: 'Autumn' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Test cohort' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Autumn' }));

  fireEvent.click(screen.getByRole('button', { name: /^Group\s*All Groups$/ }));
  expect(screen.getByRole('button', { name: 'Group A' })).toBeVisible();
  for (const name of ['Osama Group', 'gg']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  }

  fireEvent.click(screen.getByRole('button', { name: /^Module\s*All Modules$/ }));
  expect(screen.getByRole('button', { name: 'Visible Module' })).toBeVisible();
  for (const name of ['Test 45', 'Rewan test', 'Osama-prog', 'AI in Project Control copy', '333', 'latest mod']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  }
});

it('uses overview modules as the catalogue while retaining their learner roster scope', async () => {
  mocks.overview.mockResolvedValue({
    ...overview,
    modules: [{ id: 'REAL', moduleCatalogueId: 'MC-real', name: 'Real overview module', programmeId: 'P1' }],
  });
  mocks.roster.mockImplementation(async (scope: string, identifier: string) => (
    scope === 'module' && identifier === 'MC-real'
      ? { assignedLearners: [{ id: 9, email: 'morgan@example.invalid', cohort: 'Autumn', group: 'Group A' }] }
      : { assignedLearners: [] }
  ));
  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  fireEvent.click(screen.getByRole('button', { name: /^Module\s*All Modules$/ }));
  expect(screen.getByRole('button', { name: 'Real overview module' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Real overview module' }));
  await waitFor(() => expect(mocks.roster).toHaveBeenCalledWith(
    'module', 'MC-real', { learnerStatus: 'all' }, expect.any(AbortSignal), { timeoutMs: 60000, compact: true },
  ));
  expect(await screen.findByRole('button', { name: 'Morgan Sample' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Alex Example' })).not.toBeInTheDocument();
});

it('cascades programme, cohort, group, module and lecture choices', async () => {
  mocks.overview.mockResolvedValue({
    programmes: [
      { id: 'P1', name: 'Engineering' },
      { id: 'P2', name: 'Design' },
    ],
    cohorts: [
      { id: 'C1', name: 'Autumn', programmeId: 'P1' },
      { id: 'C2', name: 'Winter', programmeId: 'P1' },
      { id: 'C3', name: 'Spring', programmeId: 'P2' },
    ],
    groups: [
      { id: 'G1', name: 'Group A', cohortId: 'C1' },
      { id: 'G2', name: 'Group B', cohortId: 'C1' },
      { id: 'G3', name: 'Group C', cohortId: 'C2' },
      { id: 'G4', name: 'Group D', cohortId: 'C3' },
    ],
    modules: [
      // This represents older rows that identify the group but not its cohort.
      { id: 'M1', moduleCatalogueId: 'MC1', name: 'Module A', programmeId: 'P1', groupId: 'G1' },
      { id: 'M2', moduleCatalogueId: 'MC2', name: 'Module B', programmeId: 'P1', groupId: 'G2' },
      { id: 'M3', moduleCatalogueId: 'MC3', name: 'Cohort module', programmeId: 'P1', cohortId: 'C1' },
      { id: 'M4', moduleCatalogueId: 'MC4', name: 'Unscoped module', programmeId: 'P1' },
      { id: 'M5', moduleCatalogueId: 'MC5', name: 'Other programme module', programmeId: 'P2', groupId: 'G4' },
    ],
    sessions: [],
  } as unknown as CurriculumOverview);
  mocks.sessions.mockResolvedValue([
    { id: 'S1', title: 'Lecture A', moduleId: 'M1', date: '2026-10-18' },
    { id: 'S2', title: 'Lecture B', moduleId: 'M2', date: '2026-10-18' },
  ]);
  mocks.roster.mockImplementation(async (scope: string, identifier: string) => (
    scope === 'module' && identifier === 'MC1'
      // Older enrolment rows can carry the Group label before its id backfill.
      ? { assignedLearners: [{ id: 9, email: 'morgan@example.invalid', cohort: 'Autumn', group: 'Group A', cohortId: 'C1' }] }
      : { assignedLearners: [] }
  ));

  const choose = (filter: RegExp, option: string) => {
    fireEvent.click(screen.getByRole('button', { name: filter }));
    fireEvent.click(screen.getByRole('button', { name: option }));
  };

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });

  choose(/^Programme\s*All Programmes$/, 'Engineering');
  fireEvent.change(screen.getByLabelText('Jump to date'), { target: { value: '2026-10-18' } });
  await waitFor(() => expect(mocks.roster).toHaveBeenCalledWith(
    'programme', 'P1', { learnerStatus: 'all' }, expect.any(AbortSignal), { timeoutMs: 60000, compact: true },
  ));
  fireEvent.click(screen.getByRole('button', { name: /^Cohort\s*All Cohorts$/ }));
  expect(screen.getByRole('button', { name: 'Autumn' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Winter' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Spring' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Autumn' }));
  await waitFor(() => expect(mocks.roster).toHaveBeenCalledWith(
    'cohort', 'C1', { learnerStatus: 'all' }, expect.any(AbortSignal), { timeoutMs: 60000, compact: true },
  ));
  fireEvent.click(screen.getByRole('button', { name: /^Group\s*All Groups$/ }));
  expect(screen.getByRole('button', { name: 'Group A' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Group B' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Group C' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Group A' }));
  await waitFor(() => expect(mocks.roster).toHaveBeenCalledWith(
    'group', 'G1', { learnerStatus: 'all' }, expect.any(AbortSignal), { timeoutMs: 60000, compact: true },
  ));
  fireEvent.click(screen.getByRole('button', { name: /^Module\s*All Modules$/ }));
  expect(screen.getByRole('button', { name: 'Module A' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Module B' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cohort module' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Unscoped module' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Module A' }));
  await waitFor(() => expect(mocks.roster).toHaveBeenCalledWith(
    'module', 'MC1', { learnerStatus: 'all' }, expect.any(AbortSignal), { timeoutMs: 60000, compact: true },
  ));
  expect(await screen.findByRole('button', { name: 'Morgan Sample' })).toBeVisible();
  expect(screen.getByRole('button', { name: /^Open register for Lecture A/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Open register for Lecture B/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Lecture\s*All Lectures$/ }));
  expect(screen.getByRole('button', { name: /^Lecture A/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Lecture B/ })).not.toBeInTheDocument();
});

it('adds attendance through the live-session register only after a lecture is selected', async () => {
  mocks.overview.mockResolvedValue({
    ...overview,
    modules: [{ id: 'M1', moduleCatalogueId: 'MC1', name: 'Module A', programmeId: 'P1', cohortId: 'C1' }],
  });
  mocks.sessions.mockResolvedValue([
    { id: 'S1', title: 'Lecture A', moduleId: 'M1', moduleCatalogueId: 'MC1', date: '2026-10-17' },
  ]);
  mocks.roster.mockImplementation(async (scope: string, identifier: string) => (
    scope === 'module' && identifier === 'MC1'
      ? { assignedLearners: [{ id: 8, email: 'alex@example.invalid', cohort: 'Autumn', cohortId: 'C1' }] }
      : { assignedLearners: [] }
  ));

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });

  fireEvent.click(screen.getByRole('button', { name: 'Add attendance day' }));
  const blocked = await screen.findByRole('dialog', { name: 'Add attendance day' });
  expect(within(blocked).getByLabelText('Live session')).toBeVisible();
  expect(within(blocked).getByRole('button', { name: 'Add attendance' })).toBeDisabled();
  fireEvent.click(within(blocked).getByRole('button', { name: 'Close add attendance day' }));

  fireEvent.click(screen.getByRole('button', { name: /^Module\s*All Modules$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Module A' }));
  await waitFor(() => expect(mocks.roster).toHaveBeenCalledWith(
    'module', 'MC1', { learnerStatus: 'all' }, expect.any(AbortSignal), { timeoutMs: 60000, compact: true },
  ));
  fireEvent.click(screen.getByRole('button', { name: /^Lecture\s*All Lectures$/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Lecture A/ }));

  fireEvent.click(screen.getByRole('button', { name: 'Add attendance day' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add attendance day' });
  expect(within(dialog).getByRole('option', { name: /Lecture A/ })).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add attendance' }));

  await waitFor(() => expect(mocks.addLiveDay).toHaveBeenCalledWith({
    learnerIds: ['301'], moduleCatalogueId: 'MC1', date: '2026-10-17', attendance: 'present',
  }));
});

it('persists weekly register changes to the live-session attendance register', async () => {
  mocks.overview.mockResolvedValue({
    ...overview,
    modules: [{ id: 'M1', moduleCatalogueId: 'MC1', name: 'Module A', programmeId: 'P1', cohortId: 'C1' }],
  });
  mocks.sessions.mockResolvedValue([
    { id: 'S1', title: 'Lecture A', moduleId: 'M1', moduleCatalogueId: 'MC1', date: '2026-10-17' },
  ]);
  mocks.roster.mockImplementation(async (scope: string, identifier: string) => (
    scope === 'module' && identifier === 'MC1'
      ? { assignedLearners: [{ id: 8, email: 'alex@example.invalid', cohort: 'Autumn', cohortId: 'C1' }] }
      : { assignedLearners: [] }
  ));

  const { container } = render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '2026-10-17' } });
  fireEvent.click(screen.getByRole('button', { name: /^Module\s*All Modules$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Module A' }));
  await waitFor(() => expect(mocks.roster).toHaveBeenCalledWith(
    'module', 'MC1', { learnerStatus: 'all' }, expect.any(AbortSignal), { timeoutMs: 60000, compact: true },
  ));

  fireEvent.click(screen.getByRole('tab', { name: 'Week' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Alex Example 2026-10-17 unmarked' }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  });

  await waitFor(() => expect(mocks.addLiveDay).toHaveBeenCalledWith({
    learnerIds: ['301'], moduleCatalogueId: 'MC1', date: '2026-10-17', attendance: 'present',
  }));
  expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
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
  expect(mocks.roster.mock.calls[0][4]).toEqual({ timeoutMs: 60000, compact: true });

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

it('keeps the full filter hierarchy while loading date-scoped live attendance', async () => {
  mocks.overview.mockResolvedValue({
    programmes: [{ id: 'P1', name: 'Engineering' }],
    cohorts: [{ id: 'C1', name: 'Autumn', programmeId: 'P1' }],
    groups: [
      { id: 'G1', name: 'Group A', cohortId: 'C1' },
      { id: 'G2', name: 'Group B', cohortId: 'C1' },
    ],
    modules: [
      { id: 'M1', moduleCatalogueId: 'MC1', name: 'Module A', programmeId: 'P1', cohortId: 'C1', groupId: 'G1' },
      { id: 'M2', moduleCatalogueId: 'MC2', name: 'Module B', programmeId: 'P1', cohortId: 'C1', groupId: 'G2' },
    ],
    sessions: [],
  } as unknown as CurriculumOverview);
  mocks.sessions.mockResolvedValue([
    { id: 'S1', title: 'Lecture A', moduleId: 'M1', moduleCatalogueId: 'MC1', date: '2026-10-17' },
    { id: 'S2', title: 'Lecture B', moduleId: 'M2', moduleCatalogueId: 'MC2', date: '2026-10-18' },
  ]);
  mocks.roster.mockImplementation(async (scope: string, identifier: string) => (
    scope === 'module' && identifier === 'MC1'
      ? { assignedLearners: [{ id: 8, email: 'alex@example.invalid', cohort: 'Autumn', group: 'Group A', cohortId: 'C1', groupId: 'G1' }] }
      : { assignedLearners: [] }
  ));
  mocks.liveDayRecords.mockResolvedValue([{
    recordKey: 'live:7', learnerId: '301', moduleCatalogueId: 'MC1', occurrenceId: 'O1', attendance: 'present',
  }]);

  const { container } = render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '2026-10-17' } });

  fireEvent.click(screen.getByRole('button', { name: /^Group\s*All Groups$/ }));
  expect(screen.getByRole('button', { name: 'Group A' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Group B' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^Module\s*All Modules$/ }));
  expect(screen.getByRole('button', { name: 'Module A' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Module B' })).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Module A' }));
  await waitFor(() => expect(mocks.liveDayRecords).toHaveBeenCalledWith('2026-10-17', 'MC1', expect.any(AbortSignal)));
  expect(screen.queryByText('Select session')).not.toBeInTheDocument();
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
  await waitFor(() => expect(mocks.kbcHistory).toHaveBeenCalledWith('302', expect.any(AbortSignal), { source: 'all' }));
});

it("shows the same four saved KBC and live records as history despite a different curriculum schedule", async () => {
  mocks.overview.mockResolvedValue({
    ...overview,
    cohorts: [{ id: 'C1', name: 'Autumn', programmeId: 'P1' }],
    modules: [{
      id: 'M1', moduleCatalogueId: 'MC1', name: 'Customer Journey Optimisation',
      programmeId: 'P1', cohortId: 'C1', groupId: 'G1', cohort: 'Autumn', group: 'Group A',
    }],
  });
  mocks.sessions.mockResolvedValue([
    { id: 'S1', title: 'Lecture 1', moduleId: 'M1', moduleCatalogueId: 'MC1', date: '2026-10-10' },
    { id: 'S2', title: 'Lecture 2', moduleId: 'M1', moduleCatalogueId: 'MC1', date: '2026-10-11' },
    { id: 'S3', title: 'Lecture 3', moduleId: 'M1', moduleCatalogueId: 'MC1', date: '2026-10-12' },
    { id: 'S4', title: 'Lecture 4', moduleId: 'M1', moduleCatalogueId: 'MC1', date: '2026-10-13' },
  ]);
  mocks.directory.mockResolvedValue({
    learners: [{ ...directory[0], group: 'Group A' }], warnings: [],
  });
  const records = [
    { recordKey: 'kbc:1', learnerId: '301', sessionDate: '2026-10-10', moduleName: 'Customer Journey (legacy title)', lectureName: 'Lecture 1', sessionNumber: 1, attendance: 'present', source: 'kbc' },
    { recordKey: 'kbc:2', learnerId: '301', sessionDate: '2026-10-11', moduleName: 'Customer Journey Optimisation', lectureName: 'Lecture 2', sessionNumber: 2, attendance: 'present', source: 'kbc' },
    { recordKey: 'live:3', learnerId: '301', sessionDate: '2026-10-12', moduleName: 'Customer Journey Optimisation', lectureName: 'Lecture 3', sessionNumber: 3, attendance: 'absent', source: 'live' },
    { recordKey: 'kbc:4', learnerId: '301', sessionDate: '2026-10-15', moduleName: 'Customer Journey Optimisation', lectureName: 'Lecture 4', sessionNumber: 4, attendance: 'absent', source: 'kbc' },
  ];
  mocks.kbcRecent.mockResolvedValue({ recent: { '301': records }, warnings: [] });
  mocks.kbcHistory.mockResolvedValue({ records: [...records].reverse().concat([
    { recordKey: 'kbc:0', learnerId: '301', sessionDate: '2026-10-01', moduleName: 'Customer Journey Optimisation', lectureName: 'Lecture 0', sessionNumber: 0, attendance: 'present', source: 'kbc' },
  ]), warnings: [] });

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  expect(screen.getByTitle(/Lecture 1/)).toBeVisible();
  expect(screen.getByTitle(/Lecture 2/)).toBeVisible();
  expect(screen.getByTitle(/Lecture 3/)).toBeVisible();
  expect(screen.getByTitle(/Lecture 4/)).toBeVisible();
  expect(screen.getByTitle(/Lecture 1 \(KBC\).*Present/)).toBeVisible();
  expect(screen.getByTitle(/Lecture 4 \(KBC\).*Absent/)).toBeVisible();
  expect(screen.queryByText('Oct 13')).not.toBeInTheDocument();
  expect(mocks.kbcRecent).toHaveBeenCalledWith(expect.any(AbortSignal), { source: 'all' });

  fireEvent.click(screen.getByRole('button', { name: 'View details for Alex Example' }));
  const dialog = await screen.findByRole('dialog', { name: 'Alex Example' });
  expect(await within(dialog).findByText('Lecture 4')).toBeVisible();
  expect(within(dialog).getByText('Thu, Oct 15, 2026')).toBeVisible();
  expect(within(dialog).getAllByRole('button', { name: /^Change .* for Lecture/ })
    .slice(0, 4).map((button) => button.getAttribute('aria-label')))
    .toEqual([
      'Change absent to present for Lecture 4',
      'Change absent to present for Lecture 3',
      'Change present to absent for Lecture 2',
      'Change present to absent for Lecture 1',
    ]);
});

it('shows all four live lectures when their module title no longer matches the schedule', async () => {
  mocks.overview.mockResolvedValue({
    ...overview,
    modules: [{ id: 'M1', moduleCatalogueId: 'MC1', name: 'Customer Journey Optimisation', programmeId: 'P1' }],
  });
  mocks.sessions.mockResolvedValue([
    { id: 'S1', title: 'Scheduled 1', moduleId: 'M1', moduleCatalogueId: 'MC1', date: '2026-10-10' },
    { id: 'S2', title: 'Scheduled 2', moduleId: 'M1', moduleCatalogueId: 'MC1', date: '2026-10-11' },
    { id: 'S3', title: 'Scheduled 3', moduleId: 'M1', moduleCatalogueId: 'MC1', date: '2026-10-12' },
    { id: 'S4', title: 'Scheduled 4', moduleId: 'M1', moduleCatalogueId: 'MC1', date: '2026-10-13' },
  ]);
  mocks.directory.mockResolvedValue({ learners: [directory[0]], warnings: [] });
  mocks.kbcRecent.mockResolvedValue({ recent: { '301': [
    { recordKey: 'live:1', learnerId: '301', sessionDate: '2026-10-14', moduleName: 'Renamed module', lectureName: 'Live 1', sessionNumber: 1, attendance: 'present', source: 'live' },
    { recordKey: 'live:2', learnerId: '301', sessionDate: '2026-10-15', moduleName: 'Renamed module', lectureName: 'Live 2', sessionNumber: 2, attendance: 'absent', source: 'live' },
    { recordKey: 'live:3', learnerId: '301', sessionDate: '2026-10-16', moduleName: 'Renamed module', lectureName: 'Live 3', sessionNumber: 3, attendance: 'present', source: 'live' },
    { recordKey: 'live:4', learnerId: '301', sessionDate: '2026-10-17', moduleName: 'Renamed module', lectureName: 'Live 4', sessionNumber: 4, attendance: 'absent', source: 'live' },
  ] }, warnings: [] });

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  expect(screen.getByTitle(/Live 1 \(Live register\).*Present/)).toBeVisible();
  expect(screen.getByTitle(/Live 2 \(Live register\).*Absent/)).toBeVisible();
  expect(screen.getByTitle(/Live 3 \(Live register\).*Present/)).toBeVisible();
  expect(screen.getByTitle(/Live 4 \(Live register\).*Absent/)).toBeVisible();
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
      recordKey: 'live:9', learnerId: '301', sessionDate: '2026-10-01', moduleName: 'Project Controls',
      lectureName: 'Lecture 9', sessionNumber: 9, attendance: 'absent', source: 'live',
    }] },
    warnings: [],
  });
  mocks.save.mockResolvedValue(['live:9']);
  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  const badge = await screen.findByRole('button', { name: /^Lecture 9 \(Live register\) • .* • Absent\. Click to mark present$/ });
  fireEvent.click(badge);
  expect(await screen.findByRole('button', { name: /^Lecture 9 \(Live register\) • .* • Present\. Click to mark absent$/ })).toBeVisible();
  expect(screen.getByText('1 attendance correction not saved')).toBeVisible();

  const bar = screen.getByRole('region', { name: 'Unsaved attendance corrections' });
  await act(async () => {
    fireEvent.click(within(bar).getByRole('button', { name: /^Save$/ }));
  });
  expect(mocks.save).toHaveBeenCalledWith([{ source: 'live', recordKey: 'live:9', attendance: 'present' }]);
  await waitFor(() => expect(mocks.kbcRecent).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/attendance correction not saved/)).not.toBeInTheDocument();
});

it("shows the latest four saved database lectures, including legacy KBC rows", async () => {
  const record = (key: string, sessionDate: string, attendance: 'present' | 'absent', source: 'live' | 'kbc' = 'live') => ({
    recordKey: key, learnerId: '301', sessionDate, moduleName: 'Project Controls',
    lectureName: `Lecture ${key}`, sessionNumber: null, attendance, source,
  });
  mocks.kbcRecent.mockResolvedValue({
    recent: {
      '301': [
        record('1', '2026-09-17', 'present'),
        record('2', '2026-09-24', 'absent'),
        record('3', '2026-10-01', 'present'),
        record('4', '2026-10-08', 'absent'),
        record('legacy', '2026-10-09', 'present', 'kbc'),
      ],
    },
    warnings: [],
  });

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });

  expect(screen.getByTitle(/^Lecture 2 \(Live register\) • .* • Absent$/)).toBeInTheDocument();
  expect(screen.getByTitle(/^Lecture 4 \(Live register\) • .* • Absent$/)).toBeInTheDocument();
  expect(screen.getByTitle(/^Lecture legacy \(KBC\) • .* • Present$/)).toBeInTheDocument();
  expect(screen.queryByTitle(/^Lecture 1 \(Live register\)/)).not.toBeInTheDocument();
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
  await waitFor(() => expect(mocks.kbcHistory).toHaveBeenCalledWith('301', expect.any(AbortSignal), { source: 'all' }));
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
function prepareSameDayRegisters(sameCatalogue = false) {
  mocks.overview.mockResolvedValue({ ...overview, modules: [
    { id: 'M1', moduleCatalogueId: 'MC1', name: 'Module A', programmeId: 'P1', cohortId: 'C1' },
    { id: 'M2', moduleCatalogueId: sameCatalogue ? 'MC1' : 'MC2', name: 'Module B', programmeId: 'P1', cohortId: 'C1' },
  ] });
  mocks.sessions.mockResolvedValue([
    { id: 'S1', title: 'Session A', moduleId: 'M1', moduleCatalogueId: 'MC1', date: '2026-10-20' },
    { id: 'S2', title: 'Session B', moduleId: 'M2', moduleCatalogueId: sameCatalogue ? 'MC1' : 'MC2', date: '2026-10-20' },
  ]);
  mocks.roster.mockResolvedValue({ assignedLearners: [
    { id: 8, email: 'alex@example.invalid', cohort: 'Autumn', cohortId: 'C1' },
    { id: 9, email: 'morgan@example.invalid', cohort: 'Autumn', cohortId: 'C1' },
  ] });
  mocks.liveDayRecords.mockImplementation(async (_date: string, moduleId: string) => [{
    recordKey: moduleId === 'MC1' ? 'live:11' : 'live:22', learnerId: '301', moduleCatalogueId: moduleId,
    occurrenceId: moduleId === 'MC1' ? 'O1' : 'O2', attendance: moduleId === 'MC1' ? 'present' : 'absent',
  }]);
}

async function openSessionA() {
  fireEvent.click(await screen.findByRole('button', { name: /^Open register for Session A/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mark Alex Example present' })).toBeEnabled());
}

it('selects same-day sessions by ID and distinguishes completion from attendance without writing on navigation', async () => {
  prepareSameDayRegisters();
  render(<AttendancePage />);
  await openSessionA();
  expect(screen.getByRole('button', { name: 'Mark Alex Example present' })).toHaveAttribute('aria-pressed', 'true');
  const summary = within(screen.getByLabelText('Current register summary'));
  expect(summary.getByText('50% marked')).toBeVisible();
  expect(screen.getByRole('progressbar', { name: 'Register completion' })).toHaveAttribute('value', '50');
  fireEvent.click(screen.getByRole('button', { name: /^Open register for Session B/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mark Alex Example absent' })).toHaveAttribute('aria-pressed', 'true'));
  expect(mocks.liveDayRecords).toHaveBeenCalledWith('2026-10-20', 'MC2', expect.any(AbortSignal));
  expect(mocks.addLiveDay).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.kbcHistory).not.toHaveBeenCalled();
});

it('saves an individual mark with the original stable KBC and module keys, retains the old mark on failure, and allows retry', async () => {
  prepareSameDayRegisters();
  mocks.addLiveDay.mockRejectedValueOnce(new Error('Save refused')).mockResolvedValueOnce({ created: 0, updated: 1 });
  render(<AttendancePage />);
  await openSessionA();
  fireEvent.click(screen.getByRole('button', { name: 'Mark Alex Example absent' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save refused');
  expect(screen.getByRole('button', { name: 'Mark Alex Example present' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Mark Alex Example absent' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mark Alex Example absent' })).toHaveAttribute('aria-pressed', 'true'));
  expect(mocks.addLiveDay).toHaveBeenLastCalledWith({ learnerIds: ['301'], moduleCatalogueId: 'MC1', date: '2026-10-20', attendance: 'absent' });
  expect(mocks.addLiveDay).toHaveBeenCalledTimes(2);
});

it('prevents duplicate submissions and ignores a completed save after another same-day register is selected', async () => {
  prepareSameDayRegisters();
  let complete!: (value: { created: number; updated: number }) => void;
  mocks.addLiveDay.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  render(<AttendancePage />);
  await openSessionA();
  fireEvent.click(screen.getByRole('button', { name: 'Mark Alex Example present' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mark Alex Example present' }));
  await waitFor(() => expect(mocks.addLiveDay).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Mark Morgan Sample absent' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /^Open register for Session B/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mark Alex Example absent' })).toHaveAttribute('aria-pressed', 'true'));
  await act(async () => complete({ created: 0, updated: 1 }));
  expect(screen.getByRole('button', { name: 'Mark Alex Example absent' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Mark Alex Example present' })).toHaveAttribute('aria-pressed', 'false');
});

it('preserves selected bulk scope including hidden learners while keeping unselected learners untouched', async () => {
  prepareSameDayRegisters();
  render(<AttendancePage />);
  await openSessionA();
  fireEvent.click(screen.getByRole('button', { name: 'Select Alex Example' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search learners by name or email' }), { target: { value: 'Morgan' } });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Alex Example' })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Mark selected absent' }));
  await waitFor(() => expect(mocks.addLiveDay).toHaveBeenCalledTimes(1));
  expect(mocks.addLiveDay).toHaveBeenCalledWith({ learnerIds: ['301'], moduleCatalogueId: 'MC1', date: '2026-10-20', attendance: 'absent' });
});

it('disables new individual controls when the existing module/date contract cannot distinguish two sessions', async () => {
  prepareSameDayRegisters(true);
  render(<AttendancePage />);
  fireEvent.click(await screen.findByRole('button', { name: /^Open register for Session A/ }));
  await screen.findByText(/More than one session shares this module and date/);
  expect(await screen.findByRole('button', { name: 'Mark Alex Example present' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Mark Alex Example absent' })).toBeDisabled();
  expect(mocks.addLiveDay).not.toHaveBeenCalled();
});

it('retains date navigation in Week, Report and the archive without creating attendance', async () => {
  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  fireEvent.click(screen.getByRole('tab', { name: /^Week$/ }));
  fireEvent.change(screen.getByLabelText('Jump to date'), { target: { value: '2026-10-13' } });
  expect(screen.getByText(/Oct 12.*Oct 18/)).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: /^Report$/ }));
  expect(screen.getByLabelText('Jump to date')).toHaveValue('2026-10-13');
  expect(screen.getByLabelText('From')).toHaveValue('2026-10-12');
  expect(screen.getByLabelText('To')).toHaveValue('2026-10-18');
  fireEvent.click(screen.getByRole('button', { name: 'Archived (3)' }));
  fireEvent.change(screen.getByLabelText('Jump to date'), { target: { value: '2026-10-20' } });
  expect(screen.getByRole('button', { name: 'Casey Done' })).toBeVisible();
  expect(mocks.addLiveDay).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
