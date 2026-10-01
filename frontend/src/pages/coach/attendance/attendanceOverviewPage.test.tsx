import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { fetchCurriculumGroups, type CurriculumGroup } from '@/lib/curriculumApi';
import CoachAttendance from './page';
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
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ learners, attendanceRecords })));
    vi.mocked(fetchCurriculumGroups).mockResolvedValue([]);
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
    expect(screen.getByText('Present · 16 Sept 2026')).toBeInTheDocument();
    expect(screen.getByText('Absent · 09 Sept 2026')).toBeInTheDocument();
    expect(screen.getByText('Present · 02 Sept 2026')).toBeInTheDocument();
    expect(screen.getByText('Present · 26 Aug 2026')).toBeInTheDocument();
    expect(screen.queryByText('Absent · 19 Aug 2026')).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Last 4' })).toBeInTheDocument();
  });
  it('shows paused attendance instead of historical chips', async () => {
    render(<MemoryRouter><CoachAttendance /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Programme' }), { target: { value: 'programme-2' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'group-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load students' }));
    expect(screen.getByText('Attendance paused')).toBeInTheDocument();
    expect(screen.queryByText('Present · 16 Sept 2026')).not.toBeInTheDocument();
  });
  it('supports selection, clear, and prepared days', async () => {
    render(<MemoryRouter><CoachAttendance /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Programme' }), { target: { value: 'programme-1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'group-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load students' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('Selected students: 1')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add day' }));
    expect(screen.getByRole('button', { name: 'Apply bulk update' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('button', { name: 'Apply bulk update' })).toBeDisabled();
  });
  it('navigates with the stable learner id', async () => {
    render(<MemoryRouter><Routes><Route path="*" element={<><CoachAttendance /><Location /></>} /></Routes></MemoryRouter>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Programme' }), { target: { value: 'programme-1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'group-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load students' }));
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
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
