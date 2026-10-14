import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumOverview } from '@/lib/curriculumApi';
import type { BulkAttendanceDirectoryLearner } from '@/api/bulkAttendanceLearners';
import { todayIso } from '@/utils/bulkAttendance';

const mocks = vi.hoisted(() => ({ overview: vi.fn(), groups: vi.fn(), sessions: vi.fn(), roster: vi.fn(), directory: vi.fn(), attendanceRecords: vi.fn(), liveAttendanceRecords: vi.fn(), liveHistory: vi.fn(), kbcHistory: vi.fn(), updateKbc: vi.fn(), updateLive: vi.fn() }));
vi.mock('@/lib/curriculumApi', () => ({ fetchCurriculumOverview: mocks.overview, fetchCurriculumGroups: mocks.groups, fetchCurriculumSessions: mocks.sessions, fetchCurriculumScopeLearnerRoster: mocks.roster }));
vi.mock('@/api/bulkAttendanceLearners', () => ({ fetchBulkAttendanceLearners: mocks.directory, fetchBulkAttendanceRecords: mocks.attendanceRecords, fetchBulkAttendanceKbcHistory: mocks.kbcHistory, fetchBulkAttendanceLiveRecords: mocks.liveAttendanceRecords, fetchBulkAttendanceLiveHistory: mocks.liveHistory, updateBulkAttendanceKbcRecord: mocks.updateKbc, updateBulkAttendanceLiveRecord: mocks.updateLive }));
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
  mocks.sessions.mockResolvedValue([]);
  mocks.directory.mockResolvedValue(directory);
  mocks.attendanceRecords.mockResolvedValue([]);
  mocks.liveAttendanceRecords.mockResolvedValue([]);
  mocks.liveHistory.mockResolvedValue([]);
  mocks.kbcHistory.mockResolvedValue([]);
  mocks.updateKbc.mockResolvedValue({ attendance: 'present' });
  mocks.updateLive.mockResolvedValue({ attendance: 'present' });
  mocks.roster.mockImplementation((scope, id) => Promise.resolve({ assignedLearners:
    scope === 'module' || (scope === 'cohort' && id === 'C1') || (scope === 'group' && id === 'G1') || id === 'P1' ? [
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
  await waitFor(() => expect(screen.getByRole('button', { name: 'Morgan Sample' })).toBeVisible());
  expect(screen.queryByRole('button', { name: 'Alex Example' })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'no-match' } });
  expect(await screen.findByText('No learners found')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(await screen.findByRole('button', { name: 'Alex Example' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Morgan Sample' })).toBeVisible();
});

it('loads filter entities from the compact curriculum overview and lectures separately', async () => {
  mocks.overview.mockResolvedValue({
    ...overview,
    modules: [{ id: 'M1', name: 'Project Controls', programmeId: 'P1' }],
  });
  mocks.sessions.mockResolvedValue([
    { id: 'S1', moduleId: 'M1', title: 'Planning Session', date: '2026-10-12' },
  ]);

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Morgan Sample' });

  expect(mocks.overview).toHaveBeenCalledWith(expect.any(AbortSignal), { compact: true });
  expect(mocks.sessions).toHaveBeenCalledWith(expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button', { name: /All Modules/ }));
  expect(await screen.findByRole('button', { name: 'Project Controls' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /All Lectures/ }));
  expect(await screen.findByRole('button', { name: /Planning Session/ })).toBeVisible();
});

it('shows KBC learners without waiting for slow programme rosters', async () => {
  mocks.roster.mockImplementation((scope) => scope === 'programme'
    ? new Promise(() => {})
    : Promise.resolve({ assignedLearners: [] }));

  render(<AttendancePage />);

  await waitFor(() => expect(screen.getByRole('button', { name: 'Alex Example' })).toBeVisible());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Morgan Sample' })).toBeVisible());
  expect(mocks.roster).not.toHaveBeenCalled();
});

it('uses the selected curriculum roster even when the KBC directory has no cohort placement', async () => {
  mocks.directory.mockResolvedValue([
    { ...directory[0], group: '' },
  ]);
  mocks.roster.mockImplementation((scope, id) => Promise.resolve({ assignedLearners:
    scope === 'cohort' && id === 'C1'
      ? [{ id: '91', name: 'Alex Example', email: 'alex@example.invalid', cohortId: 'C1', groupId: '' }]
      : [],
  }));

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  fireEvent.click(screen.getByRole('button', { name: /All Cohorts/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Autumn' }));

  await waitFor(() => expect(mocks.roster).toHaveBeenCalledWith('cohort', 'C1', { learnerStatus: 'all' }, expect.any(AbortSignal)));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Alex Example' })).toBeVisible());
  expect(screen.getAllByText('Autumn').length).toBeGreaterThan(0);
  expect(screen.queryByText('Group One')).not.toBeInTheDocument();
});

it('shows all learners assigned to a selected lecture, including those without a KBC attendance row', async () => {
  mocks.overview.mockResolvedValue({
    ...overview,
    modules: [{ id: 'M1', name: 'Managing Successful Programmes', programmeId: 'P1' }],
  });
  mocks.sessions.mockResolvedValue([
    {
      id: 'S1', moduleId: 'M1', module: 'Managing Successful Programmes',
      title: 'Project Controls for Transformational Change', date: '2026-10-12',
    },
  ]);
  mocks.directory.mockResolvedValue([
    ...directory,
    { id: '303', name: 'Casey Unmarked', email: 'casey@example.invalid', programme: 'Engineering', group: 'Group One', endDate: '2099-01-01' },
  ]);
  mocks.roster.mockImplementation((scope, id) => Promise.resolve({ assignedLearners:
    scope === 'programme' && id === 'P1' ? [
      { id: '91', name: 'Old Roster Name', email: 'ALEX@example.invalid', cohortId: 'C1', groupId: 'G1' },
    ] : scope === 'module' && id === 'M1' ? [
      { id: '91', name: 'Old Roster Name', email: 'ALEX@example.invalid', cohortId: 'C1', groupId: 'G1' },
      { id: '93', name: 'Casey Unmarked', email: 'casey@example.invalid', cohortId: 'C1', groupId: 'G1' },
    ] : [],
  }));
  mocks.attendanceRecords.mockResolvedValue([
    { learnerId: '301', attendance: 'present' },
    { learnerId: '302', attendance: null },
  ]);

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  expect(mocks.attendanceRecords).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: /All Lectures/ }));
  fireEvent.click(screen.getByRole('button', { name: /Project Controls for Transformational Change/ }));

  await waitFor(() => expect(mocks.attendanceRecords).toHaveBeenCalledWith({
    date: '2026-10-12',
    moduleNames: ['Managing Successful Programmes'],
    lectureName: 'Project Controls for Transformational Change',
    learnerIds: ['301', '303'],
    includeUnlabelledLecture: true,
  }, expect.any(AbortSignal)));
  expect(await screen.findByRole('button', { name: 'Show 1 present learners' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Show 1 unmarked learners' })).toBeVisible();
  expect(screen.getByText('Details')).toBeVisible();
  expect(screen.queryByText('Attendance', { exact: true })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show 1 present learners' }));
  expect(screen.getByRole('button', { name: 'Alex Example' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Casey Unmarked' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Morgan Sample' })).not.toBeInTheDocument();
});

it('loads LMS live-session marks by profile id and leaves cross-source conflicts unmarked', async () => {
  mocks.overview.mockResolvedValue({
    ...overview,
    modules: [{
      id: 'M1', moduleCatalogueId: 'CAT-1', name: 'Managing Successful Programmes',
      programmeId: 'P1', cohortId: 'C1', groupId: 'G1',
    }],
  });
  mocks.sessions.mockResolvedValue([{
    id: 'S1', moduleId: 'CAT-1', moduleCatalogueId: 'CAT-1',
    module: 'Managing Successful Programmes',
    title: 'Project Controls for Transformational Change', date: '2026-10-12',
  }]);
  mocks.roster.mockImplementation((scope, id) => Promise.resolve({ assignedLearners:
    scope === 'module' && id === 'CAT-1'
      ? [{ id: '91', name: 'Alex Example', email: 'alex@example.invalid', cohortId: 'C1', groupId: 'G1' }]
      : [],
  }));
  mocks.attendanceRecords.mockResolvedValue([{ learnerId: '301', attendance: 'present' }]);
  mocks.liveAttendanceRecords.mockResolvedValue([{ learnerProfileId: '91', attendance: 'absent' }]);

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  fireEvent.click(screen.getByRole('button', { name: /All Lectures/ }));
  fireEvent.click(screen.getByRole('button', { name: /Project Controls for Transformational Change/ }));

  await waitFor(() => expect(mocks.liveAttendanceRecords).toHaveBeenCalledWith({
    date: '2026-10-12', moduleCatalogueId: 'CAT-1',
  }, expect.any(AbortSignal)));
  await waitFor(() => expect(mocks.attendanceRecords).toHaveBeenCalled());
  expect(await screen.findByRole('button', { name: 'Show 1 unmarked learners' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Alex Example' })).toBeVisible();
});

it('opens Details with every saved KBC and LMS record, then updates the selected source', async () => {
  mocks.directory.mockResolvedValue([directory[0]]);
  const fullHistory = [
    {
      recordKey: 'kbc-older', learnerId: '301', sessionDate: '2024-05-20', moduleName: 'Legacy Programme',
      lectureName: 'Lecture 1: Kickoff', sessionNumber: 1, attendance: 'present',
    },
    {
      recordKey: 'kbc-current', learnerId: '301', sessionDate: '2026-06-01', moduleName: 'Current Programme',
      lectureName: 'Lecture 2: Checkpoint', sessionNumber: 2, attendance: null,
    },
  ];
  mocks.kbcHistory.mockImplementation((options) => Promise.resolve(
    options?.allHistory ? fullHistory : fullHistory.slice(-1),
  ));
  mocks.liveHistory.mockResolvedValue([{
    attendanceId: 'live-1', learnerProfileId: '91', learnerEmail: 'alex@example.invalid', attendance: 'absent',
    occurrenceId: 'OCC-1', liveSessionId: 'LIVE-1', sessionNumber: 3,
    sessionDate: '2026-07-01', moduleCatalogueId: 'CAT-1', moduleTitle: 'Live planning',
    programmeId: 'P1', programmeName: 'Engineering', cohortId: 'C1', cohortName: 'Autumn',
    groupId: 'G1', groupName: 'Group One',
  }]);

  render(<AttendancePage />);
  await waitFor(() => expect(mocks.kbcHistory).toHaveBeenCalledWith({
    date: todayIso(), learnerIds: ['301'], moduleNames: [],
  }, expect.any(AbortSignal)));
  await waitFor(() => expect(screen.getByRole('button', { name: 'View details for Alex Example' })).toBeVisible());
  await act(async () => {
    screen.getByRole('button', { name: 'View details for Alex Example' }).click();
  });

  expect(await screen.findByRole('dialog', { name: 'Alex Example' })).toBeVisible();
  await waitFor(() => expect(mocks.kbcHistory).toHaveBeenCalledWith({
    learnerIds: ['301'], moduleNames: [], allHistory: true,
  }, expect.any(AbortSignal)));
  await waitFor(() => expect(mocks.liveHistory).toHaveBeenCalledWith({
    learnerProfileIds: [], learnerEmail: 'alex@example.invalid',
  }, expect.any(AbortSignal)));
  const dialog = await screen.findByRole('dialog', { name: 'Alex Example' });
  expect(await within(dialog).findByText('Lecture 1: Kickoff')).toBeVisible();
  expect(within(dialog).getByText('Lecture 2: Checkpoint')).toBeVisible();
  expect(within(dialog).getByText('Live planning · Session 3')).toBeVisible();
  expect(dialog).toHaveTextContent('Unmarked');
  expect(dialog).toHaveTextContent('All attendance records');
  await act(async () => {
    within(dialog).getByRole('button', { name: 'Change present to absent' }).click();
  });
  await waitFor(() => expect(mocks.updateKbc).toHaveBeenCalledWith({
    recordKey: 'kbc-older', attendance: 'absent',
  }));
});

it('loads LMS history only for the learner profiles in the selected module', async () => {
  mocks.liveHistory.mockResolvedValue([{
    learnerProfileId: '91', learnerEmail: 'alex@example.invalid', attendance: 'present',
    occurrenceId: 'OCC-1', liveSessionId: 'LIVE-1', sessionNumber: 2,
    sessionDate: '2026-10-13', moduleCatalogueId: 'CAT-1', moduleTitle: 'AI In Marketing',
    programmeId: 'P1', programmeName: 'Engineering', cohortId: 'C1', cohortName: 'Autumn',
    groupId: 'G1', groupName: 'Group One',
  }]);
  mocks.overview.mockResolvedValue({
    ...overview,
    modules: [{ id: 'M1', moduleCatalogueId: 'CAT-1', name: 'AI In Marketing', programmeId: 'P1', cohortId: 'C1', groupId: 'G1' }],
  });
  mocks.sessions.mockResolvedValue([]);

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  fireEvent.click(screen.getByRole('button', { name: /All Modules/ }));
  fireEvent.click(screen.getByRole('button', { name: 'AI In Marketing' }));

  await waitFor(() => expect(mocks.roster).toHaveBeenCalledWith(
    'module', 'CAT-1', { learnerStatus: 'all' }, expect.any(AbortSignal),
  ));
  await waitFor(() => expect(mocks.liveHistory).toHaveBeenCalledWith({
    learnerProfileIds: ['91'],
  }, expect.any(AbortSignal)));
  await waitFor(() => expect(screen.getAllByText('AI In Marketing · Session 2').length).toBeGreaterThan(0));
  expect(screen.queryByRole('button', { name: /All Groups/ })).not.toBeInTheDocument();
});

it('keeps programme and cohort filters working after the directory loads', async () => {
  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Morgan Sample' });
  fireEvent.click(screen.getByRole('button', { name: /All Programmes/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Engineering' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Morgan Sample' })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /All Cohorts/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Autumn' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Alex Example' })).toBeVisible());
  expect(mocks.roster).toHaveBeenCalledWith('cohort', 'C1', { learnerStatus: 'all' }, expect.any(AbortSignal));
  expect(screen.queryByRole('button', { name: /All Groups/ })).not.toBeInTheDocument();
});

it('keeps learners with the same name separate', async () => {
  mocks.directory.mockResolvedValue([directory[0], { ...directory[1], name: 'Alex Example' }]);
  render(<AttendancePage />);
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Alex Example' })).toHaveLength(2));
});

it('uses the Module filter instead of a Group filter', async () => {
  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });
  expect(screen.getByRole('button', { name: /ModuleAll Modules/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: /GroupAll Groups/ })).not.toBeInTheDocument();
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

it('does not substitute curriculum learners when the KBC directory is unavailable', async () => {
  mocks.directory.mockRejectedValue(new Error('Learner directory unavailable'));
  render(<AttendancePage />);
  expect(await screen.findByText(/Learner directory unavailable/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Old Roster Name' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Alex Example' })).not.toBeInTheDocument();
  expect(mocks.roster).not.toHaveBeenCalled();
  expect(mocks.liveHistory).not.toHaveBeenCalled();
});

it('filters learners to the selected module roster', async () => {
  mocks.overview.mockResolvedValue({
    ...overview,
    modules: [{ id: 'M1', name: 'Project Controls', programmeId: 'P1', cohortId: 'C1', groupId: 'G1' }],
  });
  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Morgan Sample' });

  fireEvent.click(screen.getByRole('button', { name: /All Modules/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Project Controls' }));

  await waitFor(() => expect(screen.getByRole('button', { name: 'Alex Example' })).toBeVisible());
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Morgan Sample' })).not.toBeInTheDocument());
  expect(mocks.roster).toHaveBeenCalledWith('module', 'M1', { learnerStatus: 'all' }, expect.any(AbortSignal));
});

it('uses overview lectures when the standalone lecture request is empty and maps module aliases', async () => {
  mocks.overview.mockResolvedValue({
    ...overview,
    modules: [{ id: 'M1', moduleCatalogueId: 'CAT-1', deliveryModuleId: 'DEL-1', name: 'Project Controls', programmeId: 'P1' }],
    sessions: [{ id: 'S1', moduleId: 'DEL-1', moduleCatalogueId: 'CAT-1', title: 'Planning Session', date: '2026-10-12' }],
  });
  mocks.sessions.mockResolvedValue([]);
  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Morgan Sample' });

  fireEvent.click(screen.getByRole('button', { name: /All Modules/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Project Controls' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /All Lectures/ })).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: /All Lectures/ }));

  expect(screen.getByRole('button', { name: /Planning Session/ })).toBeVisible();
  expect(mocks.roster).toHaveBeenCalledWith('module', 'CAT-1', { learnerStatus: 'all' }, expect.any(AbortSignal));
});

it('limits modules to the selected cohort and clears dependent filters when the cohort changes', async () => {
  mocks.overview.mockResolvedValue({
    ...overview,
    modules: [
      { id: 'M1', name: 'Autumn Module', programmeId: 'P1', cohortId: 'C1' },
      { id: 'M2', name: 'Other Cohort Module', programmeId: 'P1', cohortId: 'C2' },
    ],
    cohorts: [...overview.cohorts, { id: 'C2', name: 'Spring', programmeId: 'P1', endDate: '2099-01-01' }],
  });
  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Morgan Sample' });
  fireEvent.click(screen.getByRole('button', { name: /All Modules/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Other Cohort Module' }));
  fireEvent.click(screen.getByRole('button', { name: /All Cohorts/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Autumn' }));

  expect(screen.getByRole('button', { name: /All Modules/ })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /All Modules/ }));
  expect(screen.getByRole('button', { name: 'Autumn Module' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Other Cohort Module' })).not.toBeInTheDocument();
});

it('keeps KBC learners visible when the curriculum overview request fails', async () => {
  mocks.overview.mockRejectedValue(new Error('Curriculum overview unavailable'));
  render(<AttendancePage />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Alex Example' })).toBeVisible());
  expect(screen.getByText(/Programme and cohort filters could not be loaded/)).toBeVisible();
  expect(screen.getByText(/Check the curriculum API\/database connection and retry/)).toBeVisible();
});

it('can retry curriculum filters after an overview failure', async () => {
  mocks.overview.mockRejectedValue(new Error('Curriculum overview unavailable'));
  render(<AttendancePage />);
  expect(await screen.findByText(/Programme and cohort filters could not be loaded/)).toBeVisible();

  mocks.overview.mockResolvedValue(overview);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading data' }));

  await waitFor(() => expect(screen.queryByText(/Programme and cohort filters could not be loaded/)).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /All Cohorts/ }));
  expect(await screen.findByRole('button', { name: 'Autumn' })).toBeVisible();
});

it('retries with the full curriculum overview when the compact filter request fails', async () => {
  const fullOverview = {
    ...overview,
    cohorts: [...overview.cohorts, { id: 'C2', name: 'Spring', programmeId: 'P2', endDate: '2099-01-01' }],
  } as unknown as CurriculumOverview;
  mocks.overview.mockImplementation((_signal, options) => options?.compact
    ? Promise.reject(new Error('Compact overview unavailable'))
    : Promise.resolve(fullOverview));

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Morgan Sample' });

  expect(mocks.overview).toHaveBeenNthCalledWith(1, expect.any(AbortSignal), { compact: true });
  expect(mocks.overview).toHaveBeenNthCalledWith(2, expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button', { name: /All Cohorts/ }));
  expect(await screen.findByRole('button', { name: 'Spring' })).toBeVisible();
  expect(screen.queryByText(/Programme and cohort filters could not be loaded/)).not.toBeInTheDocument();
});

it('does not request the separate Groups endpoint for the register', async () => {
  mocks.groups.mockRejectedValue(new Error('Groups endpoint unavailable'));
  render(<AttendancePage />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Morgan Sample' })).toBeVisible());
  expect(mocks.groups).not.toHaveBeenCalled();
  expect(screen.queryByText(/latest group filter could not be loaded/i)).not.toBeInTheDocument();
});

it('shows KBC Last 4 records and leaves a KBC/LMS attendance conflict unmarked', async () => {
  mocks.directory.mockResolvedValue([directory[0]]);
  mocks.overview.mockResolvedValue({
    ...overview,
    modules: [{ id: 'M1', moduleCatalogueId: 'CAT-1', name: 'Managing Successful Programmes', programmeId: 'P1' }],
  });
  mocks.liveHistory.mockResolvedValue([{
    learnerProfileId: '91', learnerEmail: 'alex@example.invalid', attendance: 'present',
    occurrenceId: 'OCC-2', liveSessionId: 'LIVE-1', sessionNumber: 2,
    sessionDate: '2026-10-12', moduleCatalogueId: 'CAT-1', moduleTitle: 'Managing Successful Programmes',
    programmeId: 'P1', programmeName: 'Engineering', cohortId: 'C1', cohortName: 'Autumn',
    groupId: 'G1', groupName: 'Group One',
  }]);
  mocks.kbcHistory.mockResolvedValue([
    {
      learnerId: '301', sessionDate: '2026-10-11', moduleName: 'Ray - Managing Successful Programmes Jan 2026',
      lectureName: '', sessionNumber: null, attendance: 'present',
    },
    {
      learnerId: '301', sessionDate: '2026-10-12', moduleName: 'Ray - Managing Successful Programmes Jan 2026',
      lectureName: 'Lec 2: Project Controls for Transformational Change', sessionNumber: 2, attendance: 'absent',
    },
  ]);

  render(<AttendancePage />);
  await screen.findByRole('button', { name: 'Alex Example' });

  fireEvent.click(screen.getByRole('button', { name: /All Modules/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Managing Successful Programmes' }));
  await waitFor(() => expect(mocks.liveHistory).toHaveBeenCalledWith({
    learnerProfileIds: ['91'],
  }, expect.any(AbortSignal)));

  expect(mocks.kbcHistory).toHaveBeenCalledWith({
    date: todayIso(), learnerIds: ['301'], moduleNames: [],
  }, expect.any(AbortSignal));
  expect(await screen.findByTitle(/Ray - Managing Successful Programmes Jan 2026 .* Present/)).toBeVisible();
  expect(await screen.findByTitle(/Lec 2: Project Controls for Transformational Change .* Unmarked/)).toBeVisible();
});
