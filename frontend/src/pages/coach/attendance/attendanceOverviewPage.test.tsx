import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import CoachAttendance from './page';
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ isInitialized: true, email: 'coach@example.com', name: 'Coach Sara' }) }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
const learners = [
  { id: '42', learner: 'Aya Khater', email: 'same@example.com', group: '--', groupName: 'Cairo A', groupId: 'group-1', programme: 'Data', programmeId: 'programme-1', programStatus: 'Active' },
  { id: '7', learner: 'Ayman Learner', email: 'same@example.com', group: '--', groupName: 'Cairo A', groupId: 'group-1', programme: 'Cyber', programmeId: 'programme-2', programStatus: 'Paused' },
  { id: '9', learner: 'Mona Test', email: 'mona@example.com', group: 'Cairo B', groupId: 'group-2', programme: 'Data', programmeId: 'programme-1', programStatus: 'Active' },
];
const attendanceRecords = [
  { learnerId: '42', sessionId: 'one', sessionDate: '2026-09-16', status: 'present' },
  { learnerId: '42', sessionId: 'two', sessionDate: '2026-09-09', status: 'absent' },
];
function Location() { return <output>{useLocation().pathname}</output>; }
describe('coach attendance overview', () => {
  beforeEach(() => vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ learners, attendanceRecords }))));
  it('filters by stable ids and shows recent status chips', async () => {
    render(<MemoryRouter><CoachAttendance /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Group' }), { target: { value: 'group-1' } });
    expect(within(screen.getByRole('combobox', { name: 'Group' })).getByRole('option', { name: 'Cairo A' })).toHaveValue('group-1');
    const programme = screen.getByRole('combobox', { name: 'Programme' });
    expect(within(programme).getByRole('option', { name: 'Data' })).toHaveValue('programme-1');
    fireEvent.change(programme, { target: { value: 'programme-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load students' }));
    expect(screen.getByText('Aya Khater')).toBeInTheDocument();
    expect(screen.queryByText('Ayman Learner')).not.toBeInTheDocument();
    expect(screen.getByText('P 09-16')).toBeInTheDocument();
    expect(screen.getByText('A 09-09')).toBeInTheDocument();
  });
  it('supports selection, clear, and prepared days', async () => {
    render(<MemoryRouter><CoachAttendance /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Group' }), { target: { value: 'group-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load students' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('Selected students: 2')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add day' }));
    expect(screen.getByRole('button', { name: 'Apply bulk update' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('button', { name: 'Apply bulk update' })).toBeDisabled();
  });
  it('navigates with the stable learner id', async () => {
    render(<MemoryRouter><Routes><Route path="*" element={<><CoachAttendance /><Location /></>} /></Routes></MemoryRouter>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Group' }), { target: { value: 'group-1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Programme' }), { target: { value: 'programme-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load students' }));
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(screen.getByText('/coach/attendance/42')).toBeInTheDocument();
  });
});
