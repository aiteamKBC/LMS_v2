import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { qrAttendanceApi, type QRLecture } from '@/api/qrAttendance';
import QRAttendancePage from './page';
import { attendanceDayMessage, lectureDate } from './dates';

vi.mock('@/api/qrAttendance', () => ({ qrAttendanceApi: {
  configuration: vi.fn(), lookup: vi.fn(), lectures: vi.fn(), confirm: vi.fn(),
} }));

const lecture: QRLecture = { id: 'O1', moduleId: 'M1', title: 'Module One — Session 1',
  startsAt: '2026-11-07T10:00:00Z', endsAt: '2026-11-07T12:00:00Z', group: 'Group A', cohort: 'October', current: true };
const modules = [{ id: 'M1', title: 'Module One', group: 'Group A', cohort: 'October' },
  { id: 'M2', title: 'Unassigned Module', group: 'Group B', cohort: 'January' }];

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.mocked(qrAttendanceApi.configuration).mockResolvedValue({ csrfToken: 'csrf', url: 'https://college.example.test/qr-attendance', timeZone: 'Europe/London', serverNow: '2026-11-07T11:00:00Z' });
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [lecture] });
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: [lecture] });
  vi.mocked(qrAttendanceApi.confirm).mockResolvedValue({ recorded: true, alreadyRecorded: false, confirmedAt: '2026-11-07T11:01:00Z', message: 'Attendance confirmed successfully.' });
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function selectModule(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(screen.getByRole('combobox', { name: 'Choose Module' }));
  const module = modules.find(item => item.id === id)!;
  await user.click(screen.getByRole('option', { name: new RegExp(module.title) }));
}

async function identify() {
  const user = userEvent.setup();
  render(<QRAttendancePage />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Find My Lectures' })).toBeEnabled());
  await user.type(screen.getByLabelText('Your Registered Email'), 'student@example.test');
  await user.click(screen.getByRole('button', { name: 'Find My Lectures' }));
  return user;
}

it('suggests a current lecture and confirms with email only', async () => {
  const user = await identify();
  await waitFor(() => expect(screen.getByRole('radio')).toBeChecked());
  expect(screen.getByRole('radio')).toHaveAttribute('value', 'O1');
  expect(screen.getByText('Email recognised')).toBeVisible();
  expect(screen.getByLabelText('Choose Module')).toHaveTextContent('Module One');
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Confirm Attendance' }));
  expect(await screen.findByText('Attendance confirmed successfully.')).toBeVisible();
  expect(qrAttendanceApi.confirm).toHaveBeenCalledExactlyOnceWith('csrf', 'student@example.test', 'M1', 'O1');
  expect(screen.queryByText(/This lecture is with another group/)).not.toBeInTheDocument();
});

it('keeps a future unassigned module visible but prevents selecting or confirming its lecture', async () => {
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [] });
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: [{ ...lecture, id: 'FUTURE', moduleId: 'M2', startsAt: '2027-06-01T09:00:00Z', endsAt: '2027-06-01T10:00:00Z', current: false }] });
  const user = await identify();
  await selectModule(user, 'M2');
  await waitFor(() => expect(screen.getByRole('radio')).toHaveAttribute('value', 'FUTURE'));
  const future = screen.getByRole('radio', { name: /1 Jun 2027.*10:00.*11:00/ });
  expect(future).not.toBeChecked();
  expect(future).toBeDisabled();
  expect(future).toHaveAccessibleDescription('Attendance opens on the lecture date.');
  await user.click(future);
  expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeDisabled();
  expect(screen.getByText(/No lectures are available for attendance today/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Confirm Attendance' }));
  expect(qrAttendanceApi.confirm).not.toHaveBeenCalled();
});

it('keeps multiple current lectures selectable instead of choosing arbitrarily', async () => {
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [lecture, { ...lecture, id: 'O2', moduleId: 'M2' }] });
  await identify();
  expect(await screen.findByText('Suggested lectures')).toBeVisible();
  expect(screen.getByLabelText('Choose Module')).toHaveTextContent('Select a module');
});

it('updates lecture options after a module change and discards a stale response', async () => {
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [] });
  let resolveFirst!: (value: { lectures: QRLecture[] }) => void;
  vi.mocked(qrAttendanceApi.lectures).mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
    .mockResolvedValueOnce({ lectures: [{ ...lecture, id: 'O2', moduleId: 'M2' }] });
  const user = await identify();
  await selectModule(user, 'M1');
  expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeDisabled();
  await selectModule(user, 'M2');
  await waitFor(() => expect(screen.getByRole('radio')).toHaveAttribute('value', 'O2'));
  await act(async () => resolveFirst({ lectures: [lecture] }));
  expect(screen.getByRole('radio')).toHaveAttribute('value', 'O2');
  expect(screen.getAllByRole('radio')).toHaveLength(1);
});

it('clears previously resolved identity when the email changes', async () => {
  const user = await identify();
  await screen.findByLabelText('Choose Module');
  await user.clear(screen.getByLabelText('Your Registered Email'));
  expect(screen.getByLabelText('Choose Module')).toBeDisabled();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(screen.queryByText('Email recognised')).not.toBeInTheDocument();
});

it('shows an empty module lecture list and allows another module selection', async () => {
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: [] });
  await identify();
  expect(await screen.findByText(/No lectures are scheduled/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeDisabled();
  expect(screen.getByLabelText('Choose Module')).toBeEnabled();
});

it('shows lookup errors without revealing a student profile', async () => {
  vi.mocked(qrAttendanceApi.lookup).mockRejectedValue(new Error('This email matches more than one record. Please contact the college.'));
  await identify();
  expect(await screen.findByRole('alert')).toHaveTextContent('more than one record');
  expect(screen.getByLabelText('Choose Module')).toBeDisabled();
});

it('allows a safe retry after failure and treats an existing declaration as success', async () => {
  vi.mocked(qrAttendanceApi.confirm).mockRejectedValueOnce(new Error('Please try again.'))
    .mockResolvedValueOnce({ recorded: true, alreadyRecorded: true, confirmedAt: '2026-11-06T09:00:00Z', message: 'Your attendance has already been recorded.' });
  const user = await identify();
  const confirm = await screen.findByRole('button', { name: 'Confirm Attendance' });
  await waitFor(() => expect(confirm).toBeEnabled());
  await user.click(confirm);
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.');
  await user.click(confirm);
  expect(await screen.findByText('Your attendance has already been recorded.')).toBeVisible();
});

it('disables repeated confirmation while the request is pending', async () => {
  vi.mocked(qrAttendanceApi.confirm).mockImplementation(() => new Promise(() => {}));
  const user = await identify();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeEnabled());
  await user.dblClick(screen.getByRole('button', { name: 'Confirm Attendance' }));
  expect(qrAttendanceApi.confirm).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Confirming…' })).toBeDisabled();
  expect(screen.getByLabelText('Your Registered Email')).toBeDisabled();
  expect(screen.getByRole('radio')).toBeDisabled();
});

it('generates one permanent QR from server configuration', async () => {
  render(<QRAttendancePage />);
  expect(await screen.findByText('https://college.example.test/qr-attendance')).toBeInTheDocument();
  expect(document.getElementById('college-attendance-qr')).toBeInTheDocument();
});

it('shows all three steps before lookup and validates the email without sending an invalid lookup', async () => {
  const user = userEvent.setup();
  render(<QRAttendancePage />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Find My Lectures' })).toBeEnabled());
  expect(screen.getByRole('heading', { name: 'QR Attendance' })).toBeVisible();
  expect(screen.getByPlaceholderText('Enter your registered email')).toHaveAccessibleName('Your Registered Email');
  expect(screen.queryByRole('button', { name: /admin/i })).not.toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Choose Lecture' })).toBeVisible();
  expect(screen.getByLabelText('Choose Module')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeDisabled();
  const email = screen.getByLabelText('Your Registered Email');
  await user.type(email, 'not-an-email');
  await user.click(screen.getByRole('button', { name: 'Find My Lectures' }));
  expect(email).toBeInvalid();
  expect(qrAttendanceApi.lookup).not.toHaveBeenCalled();
});

it('allows today while keeping past and future cards disabled with their delivery details', async () => {
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [] });
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: [
    { ...lecture, id: 'PAST', title: 'Past session', startsAt: '2026-01-01T10:00:00Z', endsAt: null, current: false, group: 'Group B', cohort: 'January' },
    lecture,
    { ...lecture, id: 'FUTURE', title: 'Future session', startsAt: '2027-06-01T09:00:00Z', endsAt: '2027-06-01T10:00:00Z', current: false },
  ] });
  const user = await identify();
  await selectModule(user, 'M1');
  const past = await screen.findByRole('radio', { name: /Past session.*1 Jan 2026.*Group B.*January/ });
  const current = screen.getByRole('radio', { name: /Module One/ });
  expect(current).toBeChecked();
  await user.click(screen.getByText('Past session'));
  expect(past).toBeDisabled();
  expect(past).toHaveAccessibleDescription('Attendance closed — lecture date has passed.');
  expect(past).not.toBeChecked();
  expect(current).toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Confirm Attendance' }));
  await screen.findByText('Attendance confirmed successfully.');
  expect(qrAttendanceApi.confirm).toHaveBeenLastCalledWith('csrf', 'student@example.test', 'M1', 'O1');
  const future = screen.getByRole('radio', { name: /Future session/ });
  expect(future).toBeDisabled();
  await user.click(future);
  expect(current).toBeChecked();
});

it('allows retry after success and displays the idempotent response as success', async () => {
  const user = await identify();
  const confirm = screen.getByRole('button', { name: 'Confirm Attendance' });
  await waitFor(() => expect(confirm).toBeEnabled());
  await user.click(confirm);
  await screen.findByText('Attendance confirmed successfully.');
  expect(confirm).toBeEnabled();
  vi.mocked(qrAttendanceApi.confirm).mockResolvedValueOnce({ recorded: true, alreadyRecorded: true, confirmedAt: '2026-11-07T11:01:00Z', message: 'Your attendance has already been recorded.' });
  await user.click(confirm);
  expect(await screen.findByText('Your attendance has already been recorded.')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('keeps every occurrence in the keyboard-accessible list instead of truncating large schedules', async () => {
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: Array.from({ length: 50 }, (_, i) => ({ ...lecture, id: `O${i}`, title: `Session ${i}`, current: false })) });
  const user = await identify();
  const list = await screen.findByRole('region', { name: 'Available lectures' });
  expect(list).toHaveAttribute('tabindex', '0');
  expect(screen.getAllByRole('radio')).toHaveLength(50);
  await user.click(screen.getByRole('radio', { name: /^Session 49,/ }));
  await user.click(screen.getByRole('button', { name: 'Confirm Attendance' }));
  await screen.findByText('Attendance confirmed successfully.');
  expect(qrAttendanceApi.confirm).toHaveBeenCalledWith('csrf', 'student@example.test', 'M1', 'O49');
});

it('reports lecture-loading failure and retries without losing the selected module', async () => {
  vi.mocked(qrAttendanceApi.lectures).mockRejectedValueOnce(new Error('Please try again.'))
    .mockResolvedValueOnce({ lectures: [lecture] });
  const user = await identify();
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.');
  expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('radio')).toBeChecked();
  expect(screen.getByLabelText('Choose Module')).toHaveTextContent('Module One');
});

it('does not restore an old identity when an email lookup resolves after editing the email', async () => {
  let resolve!: (value: { modules: typeof modules; suggestions: QRLecture[] }) => void;
  vi.mocked(qrAttendanceApi.lookup).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const user = await identify();
  await user.clear(screen.getByLabelText('Your Registered Email'));
  await user.type(screen.getByLabelText('Your Registered Email'), 'other@example.test');
  await act(async () => resolve({ modules, suggestions: [lecture] }));
  expect(screen.getByLabelText('Choose Module')).toBeDisabled();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(qrAttendanceApi.lectures).not.toHaveBeenCalled();
});

it('keeps a configuration failure and its recovery action visible while editing the email', async () => {
  vi.mocked(qrAttendanceApi.configuration).mockRejectedValue(new Error('Attendance is temporarily unavailable. Please try again.'));
  const user = userEvent.setup();
  render(<QRAttendancePage />);
  await screen.findByRole('alert');
  await user.type(screen.getByLabelText('Your Registered Email'), 'student@example.test');
  expect(screen.getByRole('alert')).toHaveTextContent('temporarily unavailable');
  expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Find My Lectures' })).toBeDisabled();
});

it('selects the server current module even when no lecture is due', async () => {
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [],
    moduleCandidates: ['M2'], selection: { moduleId: 'M2', occurrenceId: null } });
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: [{ ...lecture, id: 'FUTURE', moduleId: 'M2', startsAt: '2026-11-08T10:00:00Z', endsAt: null, current: false }], suggestedOccurrenceId: null });
  const user = await identify();
  await waitFor(() => expect(screen.getByLabelText('Choose Module')).toHaveTextContent('Unassigned Module'));
  const future = await screen.findByRole('radio');
  expect(future).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeDisabled();
  await user.click(future);
  expect(future).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeDisabled();
});

it('keeps the current module selected when it has no lecture records', async () => {
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [],
    moduleCandidates: ['M1'], selection: { moduleId: 'M1', occurrenceId: null } });
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: [], suggestedOccurrenceId: null });
  const user = await identify();
  expect(await screen.findByText(/No lectures are scheduled/)).toBeVisible();
  expect(screen.getByLabelText('Choose Module')).toHaveTextContent('Module One');
  expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeDisabled();
  expect(qrAttendanceApi.confirm).not.toHaveBeenCalled();
  await selectModule(user, 'M2');
  await waitFor(() => expect(qrAttendanceApi.lectures).toHaveBeenLastCalledWith('csrf', 'student@example.test', 'M2'));
});

it('applies the server today suggestion even when it is not currently running', async () => {
  const today = { ...lecture, id: 'TODAY', current: false };
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [today],
    selection: { moduleId: 'M1', occurrenceId: 'TODAY' } });
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: [today], suggestedOccurrenceId: 'TODAY' });
  await identify();
  expect(await screen.findByRole('radio')).toBeChecked();
  expect(screen.getByLabelText('Choose Module')).toHaveTextContent('Module One');
});

it('keeps matching other groups collapsed and selects a lecture without confirming', async () => {
  const other = { ...lecture, id: 'OTHER', moduleId: 'M2', group: 'Group B', title: 'Group B lecture', matchingModuleIds: ['M1', 'M2'] };
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [lecture], otherGroupLectures: [other],
    selection: { moduleId: 'M1', occurrenceId: 'O1' } });
  vi.mocked(qrAttendanceApi.lectures).mockImplementation(async (_csrf, _email, moduleId) => ({
    lectures: moduleId === 'M2' ? [other] : [lecture], suggestedOccurrenceId: moduleId === 'M2' ? 'OTHER' : 'O1',
  }));
  const user = await identify();
  const heading = await screen.findByText('Other groups available today (1)');
  const section = heading.closest('details')!;
  expect(section).not.toHaveAttribute('open');
  await user.click(heading);
  expect(section).toHaveAttribute('open');
  expect(within(section).getByText('Unassigned Module')).toBeVisible();
  expect(within(section).getByText('Group B · October')).toBeVisible();
  await user.click(within(section).getByRole('button', { name: /Choose lecture/ }));
  expect(await screen.findByRole('radio', { name: /Group B lecture/ })).toBeChecked();
  expect(screen.getByLabelText('Choose Module')).toHaveTextContent('Unassigned Module');
  expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeEnabled();
  expect(qrAttendanceApi.confirm).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Confirm Attendance' }));
  expect(await screen.findByText('Attendance confirmed successfully.')).toBeVisible();
  expect(screen.getByText(/This lecture is with another group/)).toBeVisible();
  expect(qrAttendanceApi.confirm).toHaveBeenCalledExactlyOnceWith('csrf', 'student@example.test', 'M2', 'OTHER');
});

it('shows the other-group notice for an existing attendance confirmation', async () => {
  const other = { ...lecture, id: 'OTHER', moduleId: 'M2', group: 'Group B', matchingModuleIds: ['M1', 'M2'] };
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [other], otherGroupLectures: [other],
    selection: { moduleId: 'M2', occurrenceId: 'OTHER' } });
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: [other], suggestedOccurrenceId: 'OTHER' });
  vi.mocked(qrAttendanceApi.confirm).mockResolvedValue({ recorded: true, alreadyRecorded: true,
    confirmedAt: '2026-11-07T11:01:00Z', message: 'Your attendance has already been recorded.' });
  const user = await identify();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Confirm Attendance' }));
  expect(await screen.findByText('Your attendance has already been recorded.')).toBeVisible();
  expect(screen.getByText(/This lecture is with another group/)).toBeVisible();
});

it('only shows other-group lectures matching the chosen module', async () => {
  const match = { ...lecture, id: 'MATCH', moduleId: 'M2', group: 'Group B', title: 'Matching lecture', matchingModuleIds: ['M1', 'M2'] };
  const unrelated = { ...lecture, id: 'UNRELATED', moduleId: 'M3', group: 'Group C', title: 'Unrelated lecture', matchingModuleIds: ['M3'] };
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [lecture],
    selection: { moduleId: 'M1', occurrenceId: 'O1' }, otherGroupLectures: [match, unrelated] });
  const user = await identify();
  await user.click(await screen.findByText('Other groups available today (1)'));
  expect(screen.getByText('Matching lecture')).toBeVisible();
  expect(screen.queryByText('Unrelated lecture')).not.toBeInTheDocument();
});

it('does not show other-group suggestions for another day', async () => {
  const future = { ...lecture, id: 'FUTURE', moduleId: 'M2', startsAt: '2026-11-08T10:00:00Z' };
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [], otherGroupLectures: [future] });
  await identify();
  expect(screen.queryByText(/Other groups available today/)).not.toBeInTheDocument();
});

it('reveals the automatically selected lecture inside the list without scrolling the page', async () => {
  const past = { ...lecture, id: 'PAST', startsAt: '2026-11-06T10:00:00Z', current: false };
  const today = { ...lecture, id: 'TODAY', title: 'Today lecture', current: false };
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [today],
    selection: { moduleId: 'M1', occurrenceId: 'TODAY' } });
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: [past, today], suggestedOccurrenceId: 'TODAY' });
  const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect');
  rect.mockImplementation(function (this: Element) {
    if (this.classList.contains('qr-attendance-lectures')) return { top: 100, bottom: 300 } as DOMRect;
    if (this.classList.contains('qr-lecture-card')) return { top: 450, bottom: 520 } as DOMRect;
    return { top: 0, bottom: 0 } as DOMRect;
  });

  await identify();
  expect(await screen.findByRole('radio', { name: /Today lecture/ })).toBeChecked();
  expect(screen.getByRole('region', { name: 'Available lectures' }).scrollTop).toBe(220);
});

it('loads the unique current module but waits for a choice between tied lecture candidates', async () => {
  const options = [lecture, { ...lecture, id: 'O2', title: 'Another session' }];
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: options,
    selection: { moduleId: 'M1', occurrenceId: null } });
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: options, suggestedOccurrenceId: null });
  const user = await identify();
  await screen.findAllByRole('radio');
  expect(screen.getByLabelText('Choose Module')).toHaveTextContent('Module One');
  for (const option of screen.getAllByRole('radio')) expect(option).not.toBeChecked();
  await user.click(screen.getByRole('radio', { name: /Another session/ }));
  expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeEnabled();
});

it('does not invent a current module from multiple equally valid server candidates', async () => {
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [],
    moduleCandidates: ['M1', 'M2'], selection: { moduleId: null, occurrenceId: null } });
  const user = await identify();
  expect(screen.getByLabelText('Choose Module')).toHaveTextContent('Select a module');
  expect(qrAttendanceApi.lectures).not.toHaveBeenCalled();
  await selectModule(user, 'M2');
  expect(await screen.findByRole('radio')).toBeVisible();
});

it('offers current modules without lectures and lets the student choose a suggestion', async () => {
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [],
    moduleCandidates: ['M1', 'M2', 'UNAVAILABLE'], selection: { moduleId: null, occurrenceId: null } });
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: [], suggestedOccurrenceId: null });
  const user = await identify();
  const suggestions = within(await screen.findByRole('group', { name: 'Suggested modules' }));
  expect(suggestions.getAllByRole('button')).toHaveLength(2);
  expect(qrAttendanceApi.lectures).not.toHaveBeenCalled();
  const candidate = suggestions.getByRole('button', { name: /Module One.*Group A.*October/ });
  await user.click(candidate);
  expect(await screen.findByText(/No lectures are scheduled/)).toBeVisible();
  expect(candidate).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Choose Module')).toHaveTextContent('Module One');
  expect(qrAttendanceApi.lectures).toHaveBeenCalledWith('csrf', 'student@example.test', 'M1');
  expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeDisabled();
  await user.clear(screen.getByLabelText('Your Registered Email'));
  expect(screen.queryByRole('group', { name: 'Suggested modules' })).not.toBeInTheDocument();
});

it('keeps other programme modules available outside the current suggestions', async () => {
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({
    modules: [...modules, { id: 'M3', title: 'Another current module', group: 'Group A', cohort: 'October' }],
    suggestions: [], moduleCandidates: ['M1', 'M3'], selection: { moduleId: null, occurrenceId: null },
  });
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: [], suggestedOccurrenceId: null });
  const user = await identify();
  expect(within(await screen.findByRole('group', { name: 'Suggested modules' })).queryByText('Unassigned Module')).not.toBeInTheDocument();
  await selectModule(user, 'M2');
  expect(await screen.findByText(/No lectures are scheduled/)).toBeVisible();
  expect(screen.getByLabelText('Choose Module')).toHaveTextContent('Unassigned Module');
  expect(qrAttendanceApi.lectures).toHaveBeenCalledWith('csrf', 'student@example.test', 'M2');
});

it('respects a null server suggestion instead of applying a client-side running fallback', async () => {
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [], selection: { moduleId: 'M1', occurrenceId: null } });
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: [lecture], suggestedOccurrenceId: null });
  await identify();
  expect(await screen.findByRole('radio')).not.toBeChecked();
});

it('ignores a stale automatic module response after the student selects another module', async () => {
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [], selection: { moduleId: 'M1', occurrenceId: null } });
  let finish!: (value: { lectures: QRLecture[]; suggestedOccurrenceId: string }) => void;
  vi.mocked(qrAttendanceApi.lectures).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ lectures: [{ ...lecture, id: 'MANUAL', moduleId: 'M2' }], suggestedOccurrenceId: 'MANUAL' });
  const user = await identify();
  await selectModule(user, 'M2');
  await screen.findByRole('radio');
  await act(async () => finish({ lectures: [lecture], suggestedOccurrenceId: 'O1' }));
  expect(screen.getByLabelText('Choose Module')).toHaveTextContent('Unassigned Module');
  expect(screen.getByRole('radio')).toHaveAttribute('value', 'MANUAL');
  expect(screen.getByRole('radio')).toBeChecked();
});

it.each([
  ['2026-03-29T00:30:00Z', /00:30 GMT/], ['2026-03-29T01:30:00Z', /02:30 BST/],
  ['2026-10-25T00:30:00Z', /01:30 BST/], ['2026-10-25T01:30:00Z', /01:30 GMT/],
])('formats the scheduled instant in UK business time at %s', (startsAt, expected) => {
  expect(lectureDate({ ...lecture, startsAt, endsAt: null }, 'Europe/London')).toMatch(expected);
});

it.each(['2026-11-07T00:00:00Z', '2026-11-07T23:59:59Z'])('allows today before or after the lecture at %s using server time', async serverNow => {
  vi.mocked(qrAttendanceApi.configuration).mockResolvedValue({ csrfToken: 'csrf', url: 'https://college.example.test/qr-attendance', timeZone: 'Europe/London', serverNow });
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T12:00:00Z'));
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: [{ ...lecture, current: false }], suggestedOccurrenceId: 'O1' });
  const user = await identify();
  await waitFor(() => expect(screen.getByRole('radio')).toBeChecked());
  await user.click(screen.getByRole('button', { name: 'Confirm Attendance' }));
  expect(await screen.findByText('Attendance confirmed successfully.')).toBeVisible();
});

it('closes yesterday and opens today when midnight passes with the page open', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.mocked(qrAttendanceApi.configuration).mockResolvedValue({ csrfToken: 'csrf', url: 'https://college.example.test/qr-attendance', timeZone: 'Europe/London', serverNow: '2026-11-07T23:59:59Z' });
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: [lecture,
    { ...lecture, id: 'NEXT', title: 'Next day lecture', startsAt: '2026-11-08T10:00:00Z', endsAt: null, current: false }], suggestedOccurrenceId: 'O1' });
  const user = await identify();
  const previous = await screen.findByRole('radio', { name: /Module One/ });
  const next = screen.getByRole('radio', { name: /Next day lecture/ });
  expect(previous).toBeChecked();
  expect(next).toBeDisabled();
  vi.mocked(performance.now).mockReturnValue(1000);
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(previous).toBeDisabled();
  expect(previous).not.toBeChecked();
  expect(next).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeDisabled();
  await user.click(next);
  await user.click(screen.getByRole('button', { name: 'Confirm Attendance' }));
  expect(await screen.findByText('Attendance confirmed successfully.')).toBeVisible();
  expect(qrAttendanceApi.confirm).toHaveBeenCalledExactlyOnceWith('csrf', 'student@example.test', 'M1', 'NEXT');
});

it('rechecks the day on submit even before the next clock refresh', async () => {
  const user = await identify();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeEnabled());
  vi.mocked(performance.now).mockReturnValue(24 * 60 * 60 * 1000);
  await user.click(screen.getByRole('button', { name: 'Confirm Attendance' }));
  expect(qrAttendanceApi.confirm).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeDisabled();
});

it.each(['focus', 'visibilitychange'])('refreshes eligibility on %s after the tab was inactive', async event => {
  await identify();
  await waitFor(() => expect(screen.getByRole('radio')).toBeChecked());
  vi.mocked(performance.now).mockReturnValue(24 * 60 * 60 * 1000);
  act(() => { (event === 'focus' ? window : document).dispatchEvent(new Event(event)); });
  expect(screen.getByRole('radio')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeDisabled();
});

it.each([
  ['2026-07-01T23:30:00Z', '2026-07-01T22:59:59Z', false],
  ['2026-07-01T23:30:00Z', '2026-07-01T23:00:00Z', true],
  ['2026-07-01T23:30:00Z', '2026-07-02T22:59:59Z', true],
  ['2026-07-01T23:30:00Z', '2026-07-02T23:00:00Z', false],
  ['2026-03-29T10:00:00Z', '2026-03-29T22:59:59Z', true],
  ['2026-03-29T10:00:00Z', '2026-03-29T23:00:00Z', false],
  ['2026-10-25T10:00:00Z', '2026-10-24T23:00:00Z', true],
  ['2026-10-25T10:00:00Z', '2026-10-25T23:59:59Z', true],
  ['2026-10-25T10:00:00Z', '2026-10-26T00:00:00Z', false],
])('checks the college day for %s at %s', (startsAt, now, allowed) => {
  expect(attendanceDayMessage({ ...lecture, startsAt }, 'Europe/London', Date.parse(now)) === '').toBe(allowed);
});

it('does not select an out-of-date suggestion returned by a stale server response', async () => {
  const past = { ...lecture, startsAt: '2026-11-06T10:00:00Z', endsAt: null };
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [past], selection: { moduleId: 'M1', occurrenceId: 'O1' } });
  vi.mocked(qrAttendanceApi.lectures).mockResolvedValue({ lectures: [past], suggestedOccurrenceId: 'O1' });
  await identify();
  expect(await screen.findByRole('radio')).toBeDisabled();
  expect(screen.getByRole('radio')).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Confirm Attendance' })).toBeDisabled();
});

it('searches modules by delivery details and selects with the keyboard', async () => {
  vi.mocked(qrAttendanceApi.lookup).mockResolvedValue({ modules, suggestions: [], selection: { moduleId: null, occurrenceId: null } });
  const user = await identify();
  const trigger = screen.getByRole('combobox', { name: 'Choose Module' });
  await user.click(trigger);
  await user.type(screen.getByRole('textbox', { name: /Search modules/ }), 'January');
  expect(screen.getByRole('option', { name: /Unassigned Module.*Group B.*January/ })).toBeVisible();
  expect(screen.queryByRole('option', { name: /Module One/ })).not.toBeInTheDocument();
  await user.keyboard('{Enter}');
  expect(trigger).toHaveTextContent('Unassigned Module');
  expect(trigger).toHaveFocus();
  await screen.findByRole('radio');
  expect(qrAttendanceApi.lectures).toHaveBeenCalledWith('csrf', 'student@example.test', 'M2');
  await user.click(trigger);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
