import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { fetchCurriculumGroups, type CurriculumGroup } from '@/lib/curriculumApi';
import CoachAttendance from './page';
import CoachAttendanceProfile from '../attendance-profile/page';
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ isInitialized: true, email: 'coach@example.com', name: 'Coach Sara' }) }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
vi.mock('@/lib/curriculumApi', () => ({ fetchCurriculumGroups: vi.fn() }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
const learners = [
  { id: '42', learner: 'Aya Khater', email: 'same@example.com', group: '--', groupName: 'Cairo A', groupId: 'group-1', programme: 'Data', programmeId: 'programme-1', programStatus: 'Active' },
  { id: '7', learner: 'Ayman Learner', email: 'same@example.com', group: '--', groupName: 'Cairo A', groupId: 'group-1', programme: 'Cyber', programmeId: 'programme-2', programStatus: 'Paused' },
  { id: '9', learner: 'Mona Test', email: 'mona@example.com', group: 'Cairo B', groupId: 'group-2', programme: 'Data', programmeId: 'programme-1', programStatus: 'Active' },
];
const attendanceRecords = [
  { learnerId: '42', sessionId: 'one', sessionDate: '2026-09-16', status: 'present' },
  { learnerId: '42', sessionId: 'two', sessionDate: '2026-09-09', status: 'absent' },
  { learnerId: '42', sessionId: 'three', sessionDate: '2026-09-02', status: 'present' },
  { learnerId: '42', sessionId: 'four', sessionDate: '2026-08-26', status: 'present' },
  { learnerId: '42', sessionId: 'five', sessionDate: '2026-08-19', status: 'absent' },
  { learnerId: '7', sessionId: 'paused', sessionDate: '2026-09-16', status: 'present' },
];
function Location() { return <output>{useLocation().pathname}</output>; }
describe('coach attendance overview', () => {
  beforeEach(() => {
    vi.mocked(coachFetch).mockClear();
    vi.mocked(coachFetch).mockImplementation(async (url, options) => options?.method === 'POST' ? new Response(JSON.stringify({ results: JSON.parse(String(options.body)).records.map((row: { learnerId: string; status: string }) => ({ ...row, version: 'v-new', sessionOccurrenceId: 'occ-2', attendanceRecord: { ...row, sessionId: 'teams:occ-2', sessionDate: '2026-09-16', counted: true } })) })) : new Response(JSON.stringify(String(url).includes('/bulk?') ? (String(url).includes('sessionOccurrenceId=occ-') ? { learners: [{ learnerId: '42', status: 'present', version: 'v1' }] } : { sessions: [{ id: 'occ-1', occurrenceStart: '2026-09-16T09:00:00Z', module: 'Data', sessionTitle: 'Morning session' }, { id: 'occ-2', occurrenceStart: '2026-09-16T14:00:00Z', module: 'Data', sessionTitle: 'Afternoon session' }] }) : { learners, attendanceRecords })));
    vi.mocked(fetchCurriculumGroups).mockResolvedValue([]);
  });

  async function renderSelectionRoster() {
    const original = vi.mocked(coachFetch).getMockImplementation()!;
    vi.mocked(coachFetch).mockImplementation(async (url, options) => {
      if (options?.method === 'POST') return original(url, options);
      if (String(url).includes('sessionOccurrenceId=occ-1')) return new Response(JSON.stringify({
        learners: [{ learnerId: '42', status: 'unmarked', version: 'v1' }, { learnerId: '9', status: 'absent', version: 'v2' }],
      }));
      if (url === '/coach_api/coach/attendance') return new Response(JSON.stringify({
        learners: [learners[0], { ...learners[2], groupId: 'group-1' },
          { ...learners[0], id: 'unavailable', learner: 'Unavailable learner' }], attendanceRecords,
      }));
      return original(url, options);
    });
    render(<MemoryRouter><CoachAttendance /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Programme' }), { target: { value: 'programme-1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'group-1' } });
    await screen.findByRole('option', { name: /Morning session/ });
    fireEvent.change(screen.getByLabelText('Session / occurrence'), { target: { value: 'occ-1' } });
    await waitFor(() => expect(screen.getByLabelText('Attendance for Mona Test')).toBeEnabled());
  }

  it('synchronizes selection, bulk actions and Clear immediately without requests', async () => {
    await renderSelectionRoster();
    const present = screen.getByRole('button', { name: 'Mark selected Present' });
    const absent = screen.getByRole('button', { name: 'Mark selected Absent' });
    const aya = screen.getByRole('checkbox', { name: 'Select Aya Khater' });
    const mona = screen.getByRole('checkbox', { name: 'Select Mona Test' });
    const requests = vi.mocked(coachFetch).mock.calls.length;
    expect(screen.getByText('Selected: 0')).toBeInTheDocument();
    expect(present).toBeDisabled();
    expect(absent).toBeDisabled();
    fireEvent.click(aya);
    expect(screen.getByText('Selected: 1')).toBeInTheDocument();
    expect(present).toBeEnabled();
    expect(absent).toBeEnabled();
    expect(aya.closest('tr')).toHaveAttribute('data-selected', 'true');
    fireEvent.click(mona);
    expect(screen.getByText('Selected: 2')).toBeInTheDocument();
    fireEvent.click(aya);
    expect(screen.getByText('Selected: 1')).toBeInTheDocument();
    expect(aya.closest('tr')).toHaveAttribute('data-selected', 'false');
    fireEvent.click(mona);
    expect(screen.getByText('Selected: 0')).toBeInTheDocument();
    expect(present).toBeDisabled();
    expect(absent).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('Selected: 2')).toBeInTheDocument();
    expect(aya).toBeChecked();
    expect(mona).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Select Unavailable learner' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Selected: 0')).toBeInTheDocument();
    expect(aya).not.toBeChecked();
    expect(mona).not.toBeChecked();
    expect(present).toBeDisabled();
    expect(absent).toBeDisabled();
    expect(vi.mocked(coachFetch).mock.calls).toHaveLength(requests);
  });

  it('stages only selected statuses, counts actual changes and uses the existing Apply flow', async () => {
    await renderSelectionRoster();
    const aya = screen.getByRole('checkbox', { name: 'Select Aya Khater' });
    const mona = screen.getByRole('checkbox', { name: 'Select Mona Test' });
    const ayaStatus = screen.getByLabelText('Attendance for Aya Khater');
    const monaStatus = screen.getByLabelText('Attendance for Mona Test');
    const requests = vi.mocked(coachFetch).mock.calls.length;
    fireEvent.click(aya);
    fireEvent.click(screen.getByRole('button', { name: 'Mark selected Present' }));
    expect(ayaStatus).toHaveValue('present');
    expect(monaStatus).toHaveValue('absent');
    expect(screen.getByText('Pending changes: 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark selected Absent' }));
    expect(ayaStatus).toHaveValue('absent');
    expect(monaStatus).toHaveValue('absent');
    expect(aya).toBeChecked();
    expect(mona).not.toBeChecked();
    expect(screen.getByText('Pending changes: 1')).toBeInTheDocument();
    fireEvent.change(monaStatus, { target: { value: 'present' } });
    expect(screen.getByText('Pending changes: 2')).toBeInTheDocument();
    fireEvent.change(monaStatus, { target: { value: 'absent' } });
    expect(screen.getByText('Pending changes: 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(ayaStatus).toHaveValue('');
    expect(monaStatus).toHaveValue('absent');
    expect(aya).toBeChecked();
    expect(screen.getByText('Pending changes: 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply bulk update' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark selected Present' }));
    expect(ayaStatus).toHaveValue('present');
    expect(monaStatus).toHaveValue('present');
    expect(screen.getByText('Pending changes: 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark selected Absent' }));
    expect(ayaStatus).toHaveValue('absent');
    expect(monaStatus).toHaveValue('absent');
    expect(screen.getByText('Pending changes: 1')).toBeInTheDocument();
    expect(vi.mocked(coachFetch).mock.calls).toHaveLength(requests);
    fireEvent.click(screen.getByRole('button', { name: 'Apply bulk update' }));
    await screen.findByText('Attendance saved.');
    expect(vi.mocked(coachFetch).mock.calls.slice(requests)).toHaveLength(1);
    const save = vi.mocked(coachFetch).mock.calls.at(-1)!;
    expect(save[0]).toBe('/coach_api/coach/attendance/bulk');
    expect(save[1]?.method).toBe('POST');
    expect(JSON.parse(String(save[1]?.body))).toEqual({ programmeId: 'programme-1', groupId: 'group-1',
      sessionOccurrenceId: 'occ-1', records: [{ learnerId: '42', status: 'absent', version: 'v1' }] });
    expect(screen.getByText('Pending changes: 0')).toBeInTheDocument();
    expect(screen.getByText('Selected: 2')).toBeInTheDocument();
  });

  it('loads valid students and shows a compact warning for unavailable enrolments', async () => {
    const original = vi.mocked(coachFetch).getMockImplementation()!;
    vi.mocked(coachFetch).mockImplementation(async (url, options) => {
      if (String(url).includes('sessionOccurrenceId=occ-1')) return new Response(JSON.stringify({
        learners: [{ learnerId: '42', status: 'present', version: 'v1' }],
        warnings: [{ learnerProfileId: 'broken', code: 'learner_source_unavailable', message: 'Attendance source unavailable for this learner.' }],
      }));
      return original(url, options);
    });
    render(<MemoryRouter><CoachAttendance /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Programme' }), { target: { value: 'programme-1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'group-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load students' }));
    await screen.findByRole('option', { name: /Morning session/ });
    fireEvent.change(screen.getByLabelText('Session / occurrence'), { target: { value: 'occ-1' } });
    const warning = await screen.findByText('1 learner unavailable');
    expect(warning).toHaveAttribute('role', 'status');
    expect(warning).toHaveAttribute('title', 'Enrolment record unavailable.');
    expect(screen.getByRole('region', { name: 'Students (1)' })).toContainElement(warning);
    expect(screen.queryByText('broken')).not.toBeInTheDocument();
    expect(screen.getByText('Students (1)')).toBeInTheDocument();
    expect(screen.getByLabelText('Attendance for Aya Khater')).toHaveValue('present');
    fireEvent.change(screen.getByLabelText('Session / occurrence'), { target: { value: 'occ-2' } });
    await waitFor(() => expect(screen.queryByText('1 learner unavailable')).not.toBeInTheDocument());
  });
  it.each(['unmarked', 'upcoming', 'in_progress'])('offers only Present and Absent when the current status is %s', async (currentStatus) => {
    const original = vi.mocked(coachFetch).getMockImplementation()!;
    vi.mocked(coachFetch).mockImplementation(async (url, options) => {
      if (String(url).includes('sessionOccurrenceId=occ-1')) return new Response(JSON.stringify({
        learners: [{ learnerId: '42', status: currentStatus, version: 'v1' }],
      }));
      return original(url, options);
    });
    render(<MemoryRouter><CoachAttendance /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Programme' }), { target: { value: 'programme-1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'group-1' } });
    await screen.findByRole('option', { name: /Morning session/ });
    fireEvent.change(screen.getByLabelText('Session / occurrence'), { target: { value: 'occ-1' } });
    const status = await screen.findByLabelText('Attendance for Aya Khater');
    await waitFor(() => expect(status).toBeEnabled());
    expect(status).toHaveValue('');
    expect(within(status).getAllByRole('option').map(option => option.textContent)).toEqual(['Present', 'Absent']);
    const placeholder = within(status).getByText('Not marked');
    expect(placeholder).toBeDisabled();
    expect(placeholder).toHaveAttribute('hidden');
    expect(screen.getByRole('button', { name: 'Apply bulk update' })).toBeDisabled();
    fireEvent.change(status, { target: { value: 'present' } });
    expect(status).toHaveValue('present');
    fireEvent.change(status, { target: { value: 'absent' } });
    expect(status).toHaveValue('absent');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(status).toHaveValue('');
    expect(vi.mocked(coachFetch).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
  it('lists programme groups without caseload learners and keeps other programmes separate', async () => {
    vi.mocked(fetchCurriculumGroups).mockResolvedValue([
      { id: 'empty-group', name: 'Empty group', programmeId: 'programme-1', status: 'active' },
      { id: 'other-group', name: 'Other programme group', programmeId: 'programme-2', status: 'active' },
      { id: 'archived-group', name: 'Archived group', programmeId: 'programme-1', status: 'archived' },
    ] as CurriculumGroup[]);
    render(<MemoryRouter><CoachAttendance /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Programme' }), { target: { value: 'programme-1' } });
    const group = screen.getByRole('combobox', { name: 'Group' });
    expect(await within(group).findByRole('option', { name: 'Empty group' })).toHaveValue('empty-group');
    expect(within(group).queryByRole('option', { name: 'Other programme group' })).not.toBeInTheDocument();
    expect(within(group).queryByRole('option', { name: 'Archived group' })).not.toBeInTheDocument();
    fireEvent.change(group, { target: { value: 'empty-group' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load students' }));
    expect(screen.getByText('No learners found for this group.')).toBeInTheDocument();
    expect(screen.queryByText('Aya Khater')).not.toBeInTheDocument();
  });
  it('reports a programme group request failure', async () => {
    vi.mocked(fetchCurriculumGroups).mockRejectedValue(new Error('Service unavailable'));
    render(<MemoryRouter><CoachAttendance /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load programme groups: Service unavailable');
  });
  it('filters by stable ids and shows recent status chips', async () => {
    render(<MemoryRouter><CoachAttendance /></MemoryRouter>);
    const programme = await screen.findByRole('combobox', { name: 'Programme' });
    const group = screen.getByRole('combobox', { name: 'Group' });
    expect(programme.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group).toBeDisabled();
    expect(within(programme).getByRole('option', { name: 'Data' })).toHaveValue('programme-1');
    fireEvent.change(programme, { target: { value: 'programme-1' } });
    expect(group).toBeEnabled();
    expect(within(group).getByRole('option', { name: 'Cairo A' })).toHaveValue('group-1');
    expect(within(group).getByRole('option', { name: 'Cairo B' })).toHaveValue('group-2');
    fireEvent.change(group, { target: { value: 'group-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load students' }));
    expect(screen.getByText('Aya Khater')).toBeInTheDocument();
    expect(screen.queryByText('Ayman Learner')).not.toBeInTheDocument();
    expect(screen.getByText('P · 16 Sep')).toBeInTheDocument();
    expect(screen.getByText('A · 09 Sep')).toBeInTheDocument();
    expect(screen.getByText('P · 02 Sep')).toBeInTheDocument();
    expect(screen.getByText('P · 26 Aug')).toBeInTheDocument();
    expect(screen.queryByText('A · 19 Aug')).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Recent' })).toBeInTheDocument();
  });
  it('shows paused attendance instead of historical chips', async () => {
    render(<MemoryRouter><CoachAttendance /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Programme' }), { target: { value: 'programme-2' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'group-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load students' }));
    expect(screen.getByText('Attendance paused')).toBeInTheDocument();
    expect(screen.queryByText('P · 16 Sep')).not.toBeInTheDocument();
  });
  it('loads distinct same-day sessions and applies an individual status without canonical refresh', async () => {
    render(<MemoryRouter><CoachAttendance /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Programme' }), { target: { value: 'programme-1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'group-1' } });
    const session = screen.getByLabelText('Session / occurrence');
    expect(await within(session).findByRole('option', { name: /Morning session/ })).toHaveValue('occ-1');
    expect(within(session).getByRole('option', { name: /Afternoon session/ })).toHaveValue('occ-2');
    fireEvent.change(session, { target: { value: 'occ-2' } });
    const status = await screen.findByLabelText('Attendance for Aya Khater');
    await waitFor(() => expect(status).toHaveValue('present'));
    fireEvent.change(status, { target: { value: 'absent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bulk update' }));
    expect(await screen.findByText('Attendance saved.')).toBeInTheDocument();
    const call = vi.mocked(coachFetch).mock.calls.find(([, options]) => options?.method === 'POST');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ programmeId: 'programme-1', groupId: 'group-1', sessionOccurrenceId: 'occ-2', records: [{ learnerId: '42', status: 'absent', version: 'v1' }] });
    expect(vi.mocked(coachFetch).mock.calls.filter(([url]) => url === '/coach_api/coach/attendance')).toHaveLength(1);
  });
  it('saves multiple learners and renders locally updated canonical Last 4 without calculating percentages', async () => {
    const groupLearners = [learners[0], { ...learners[2], groupId: 'group-1', attendance: 87 }];
    let saved = false;
    vi.mocked(coachFetch).mockImplementation(async (url, options) => {
      if (String(url).includes('/details?')) return new Response(JSON.stringify({ learner: { id: '42', name: 'Aya Khater' }, summary: { attendanceRate: 0, total: 1, present: 0, absent: 1, unknown: 0 }, sessions: [{ sessionId: 'teams:occ-1', sessionTitle: 'Morning session', sessionDate: '2026-09-16', sessionDateLabel: '16 Sep 2026', status: 'absent', rawStatus: 'pending', effectiveStatus: 'absent', counted: true }] }));
      if (options?.method === 'POST') { saved = true; return new Response(JSON.stringify({ results: JSON.parse(String(options.body)).records.map((row: { learnerId: string; status: string }) => ({ ...row, version: 'v-new', sessionOccurrenceId: 'occ-1', attendanceRecord: { ...row, sessionId: 'teams:occ-1', sessionDate: '2026-09-16', counted: true } })) })); }
      if (String(url).includes('/bulk?')) return new Response(JSON.stringify(String(url).includes('sessionOccurrenceId=occ-')
        ? { learners: [{ learnerId: '42', status: saved ? 'absent' : 'present', version: 'v1' }, { learnerId: '9', status: saved ? 'present' : 'unmarked', version: 'v2' }] }
        : { sessions: [{ id: 'occ-1', occurrenceStart: '2026-09-16T09:00:00Z', module: 'Data', sessionTitle: 'Morning session' }] }));
      return new Response(JSON.stringify({ learners: groupLearners, attendanceRecords: saved
        ? [{ learnerId: '42', sessionId: 'teams:occ-1', sessionDate: '2026-09-16', status: 'absent', counted: true }, { learnerId: '9', sessionId: 'teams:occ-1', sessionDate: '2026-09-16', status: 'present', counted: true }]
        : attendanceRecords }));
    });
    render(<MemoryRouter initialEntries={["/coach/attendance"]}><Routes><Route path="/coach/attendance" element={<CoachAttendance />} /><Route path="/coach/attendance/:learnerId" element={<CoachAttendanceProfile />} /></Routes></MemoryRouter>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Programme' }), { target: { value: 'programme-1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'group-1' } });
    await screen.findByRole('option', { name: /Morning session/ });
    fireEvent.change(screen.getByLabelText('Session / occurrence'), { target: { value: 'occ-1' } });
    expect(await screen.findByLabelText('Attendance for Mona Test')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Attendance for Aya Khater'), { target: { value: 'absent' } });
    fireEvent.change(screen.getByLabelText('Attendance for Mona Test'), { target: { value: 'present' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bulk update' }));
    expect(await screen.findByText('Attendance saved.')).toBeInTheDocument();
    const call = vi.mocked(coachFetch).mock.calls.find(([, options]) => options?.method === 'POST');
    expect(JSON.parse(String(call?.[1]?.body)).records).toEqual([{ learnerId: '9', status: 'present', version: 'v2' }, { learnerId: '42', status: 'absent', version: 'v1' }]);
    expect(within(screen.getByText('Aya Khater').closest('tr')!).getByText('A \u00b7 16 Sep')).toBeInTheDocument();
    expect(within(screen.getByText('Mona Test').closest('tr')!).getByText('P \u00b7 16 Sep')).toBeInTheDocument();
    expect(screen.getByLabelText('Attendance for Aya Khater')).toHaveValue('absent');
    expect(screen.getByLabelText('Attendance for Mona Test')).toHaveValue('present');
    fireEvent.click(within(screen.getByText('Aya Khater').closest('tr')!).getByRole('button', { name: 'View' }));
    expect(await screen.findByRole('heading', { name: 'Aya Khater' })).toBeInTheDocument();
    expect(screen.getAllByRole('table')[0].querySelector('[data-status="absent"]')).toBeInTheDocument();
    expect(screen.getByLabelText('Student attendance report').querySelector('td[data-status="absent"]')).toHaveTextContent('Absent');
    expect(screen.getByText('0 present out of 1')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Student attendance report')).getByText('Attendance rate').nextElementSibling).toHaveTextContent('0%');
  });
  it.each([409, 503])('keeps pending attendance after a %s save failure and only reports conflicts for 409', async (httpStatus) => {
    render(<MemoryRouter><CoachAttendance /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Programme' }), { target: { value: 'programme-1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'group-1' } });
    await screen.findByRole('option', { name: /Morning session/ });
    fireEvent.change(screen.getByLabelText('Session / occurrence'), { target: { value: 'occ-1' } });
    const status = await screen.findByLabelText('Attendance for Aya Khater');
    await waitFor(() => expect(status).toHaveValue('present'));
    fireEvent.change(status, { target: { value: 'absent' } });
    vi.mocked(coachFetch).mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Attendance changed; reload.' }), { status: httpStatus }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply bulk update' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(httpStatus === 409
      ? 'Attendance changed; reload.' : 'Unable to save attendance. Your pending changes have been kept. Please retry.');
    const save = vi.mocked(coachFetch).mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(save?.[1]?.body))).toEqual({ programmeId: 'programme-1', groupId: 'group-1',
      sessionOccurrenceId: 'occ-1', records: [{ learnerId: '42', status: 'absent', version: 'v1' }] });
    expect(status).toHaveValue('absent');
    expect(screen.getByText('Pending changes: 1')).toBeInTheDocument();
  });
  it.each([['absent', 'present'], ['present', 'absent']])('replaces %s with %s in place and keeps same-day occurrences separate', async (before, after) => {
    const original = vi.mocked(coachFetch).getMockImplementation()!;
    vi.mocked(coachFetch).mockImplementation(async (url, options) => {
      if (options?.method === 'POST') return new Response(JSON.stringify({ results: [{ learnerId: '42', status: after, version: 'v2', sessionOccurrenceId: 'occ-1', attendanceRecord: { learnerId: '42', sessionId: 'teams:occ-1', sessionDate: '2026-09-16', status: after, effectiveStatus: after, counted: true } }] }));
      if (String(url).includes('sessionOccurrenceId=occ-1')) return new Response(JSON.stringify({ learners: [{ learnerId: '42', status: before, version: 'v1' }] }));
      if (url === '/coach_api/coach/attendance') return new Response(JSON.stringify({ learners, attendanceRecords: [
        { learnerId: '42', sessionId: 'teams:occ-1', sessionDate: '2026-09-16', status: before },
        { learnerId: '42', sessionId: 'teams:occ-2', sessionDate: '2026-09-16', status: 'present' },
      ] }));
      return original(url, options);
    });
    render(<MemoryRouter><CoachAttendance /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Programme' }), { target: { value: 'programme-1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'group-1' } });
    await screen.findByRole('option', { name: /Morning session/ });
    fireEvent.change(screen.getByLabelText('Session / occurrence'), { target: { value: 'occ-1' } });
    const status = await screen.findByLabelText('Attendance for Aya Khater');
    await waitFor(() => expect(status).toHaveValue(before));
    const row = screen.getByText('Aya Khater').closest('tr')!;
    expect(row.querySelectorAll('[data-status]')).toHaveLength(2);
    const callsBefore = vi.mocked(coachFetch).mock.calls.length;
    fireEvent.change(status, { target: { value: after } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bulk update' }));
    await screen.findByText('Attendance saved.');
    expect(status).toHaveValue(after);
    expect(screen.getByText('Pending changes: 0')).toBeInTheDocument();
    expect(row.querySelectorAll('[data-status]')).toHaveLength(2);
    expect(row.querySelectorAll('[data-status="absent"]')).toHaveLength(after === 'absent' ? 1 : 0);
    expect(row.querySelectorAll('[data-status="present"]')).toHaveLength(after === 'present' ? 2 : 1);
    expect(vi.mocked(coachFetch).mock.calls.slice(callsBefore)).toHaveLength(1);
    fireEvent.change(status, { target: { value: before } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bulk update' }));
    await waitFor(() => expect(screen.getByText('Pending changes: 0')).toBeInTheDocument());
    const lastCall = vi.mocked(coachFetch).mock.calls.at(-1)!;
    expect(JSON.parse(String(lastCall[1]?.body)).records[0].version).toBe('v2');
  });
  it('navigates with the stable learner id', async () => {
    render(<MemoryRouter><Routes><Route path="*" element={<><CoachAttendance /><Location /></>} /></Routes></MemoryRouter>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Programme' }), { target: { value: 'programme-1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'group-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load students' }));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByText('/coach/attendance/42')).toBeInTheDocument();
  });
  it('restores applied group, programme and status from the URL on refresh', async () => {
    render(<MemoryRouter initialEntries={['/coach/attendance?group=group-1&programme=programme-1&status=active']}><Routes><Route path="/coach/attendance" element={<CoachAttendance />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Aya Khater')).toBeInTheDocument();
    expect(screen.queryByText('Ayman Learner')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Group' })).toHaveValue('group-1');
    expect(screen.getByRole('combobox', { name: 'Programme' })).toHaveValue('programme-1');
  });
});
