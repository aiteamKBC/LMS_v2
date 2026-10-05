import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import CoachAttendanceProfile from './page';
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ isInitialized: true, email: 'coach@example.com', name: 'Coach Sara' }) }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
describe('coach attendance detail', () => {
  beforeEach(() => {
    vi.mocked(coachFetch)
      .mockClear()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        learner: { id: '42', name: 'Aya Khater', email: 'same@example.com', programme: 'Data', cohort: 'September', group: 'Cairo A', programmeStartDate: '01 Sep 2020', programmeEndDate: '31 Aug 2021', learnerStartDate: '01 Sep 2026', learnerEndDate: '31 Aug 2027', coachName: 'Coach Sara' },
        summary: { attendanceRate: 79, total: 32, present: 26, absent: 6, unknown: 0 },
        sessions: [{ sessionId: 'session-2', source: 'microsoft-teams', sourceId: 'occ-2', sessionTitle: 'Data session', module: 'Data Foundations', sessionType: 'live_session', sessionDate: '2026-09-16', sessionDateLabel: '16 Sep 2026', status: 'present' }],
      })));
  });
  it('uses the canonical summary and id-only detail lookup', async () => {
    render(<MemoryRouter initialEntries={['/coach/attendance/42']}><Routes><Route path="/coach/attendance/:learnerId" element={<CoachAttendanceProfile />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Aya Khater' })).toBeInTheDocument();
    expect(screen.getAllByText('79%')).toHaveLength(2);
    expect(screen.getByText('26 present out of 32')).toBeInTheDocument();
    expect(screen.getAllByText('Data session')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Student attendance report')).toBeInTheDocument();
    expect(screen.getByText('01 Sep 2026 — 31 Aug 2027')).toBeInTheDocument();
    expect(screen.getByText('Attendance rate').nextElementSibling).toHaveTextContent('79%');
    expect(vi.mocked(coachFetch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(coachFetch).mock.calls[0][0]).toBe('/coach_api/coach/attendance/details?learner_id=42');
    expect(String(vi.mocked(coachFetch).mock.calls[0][0])).not.toContain('same%40example.com');
    expect(vi.mocked(coachFetch).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('displays unmarked separately and prints only backend summary totals', async () => {
    vi.mocked(coachFetch).mockReset().mockResolvedValueOnce(new Response(JSON.stringify({
      learner: { id: '42', name: 'Synthetic Learner' },
      summary: { attendanceRate: 50, total: 2, present: 1, absent: 1, unknown: 0 },
      sessions: [
        { sessionId: 'a', sessionTitle: 'Unverified lecture', sessionDate: '2026-09-16', sessionDateLabel: '16 Sep 2026', status: 'unmarked', counted: false },
        { sessionId: 'b', sessionTitle: 'Recovered lecture', sessionDate: '2026-09-15', sessionDateLabel: '15 Sep 2026', status: 'present', rawStatus: 'absent', effectiveStatus: 'made_up', counted: true },
      ],
    })));
    render(<MemoryRouter initialEntries={['/coach/attendance/42']}><Routes><Route path="/coach/attendance/:learnerId" element={<CoachAttendanceProfile />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Synthetic Learner' })).toBeInTheDocument();
    expect(screen.getAllByText('Unmarked')).toHaveLength(2);
    expect(screen.getAllByText('50%')).toHaveLength(2);
    expect(screen.getByText('1 present out of 2')).toBeInTheDocument();
    const report = screen.getByLabelText('Student attendance report');
    expect(within(report).getByText('Attendance rate').nextElementSibling).toHaveTextContent('50%');
  });

  it('renders every attendance record in the printable document', async () => {
    const sessions = Array.from({ length: 24 }, (_, index) => ({
      sessionId: `session-${index}`,
      sessionTitle: `Session ${index + 1}`,
      sessionType: 'Live lecture',
      sessionDate: '2026-09-16',
      sessionDateLabel: '16 Sep 2026',
      status: index % 2 ? 'absent' : 'present',
    }));
    vi.mocked(coachFetch)
      .mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        learner: { id: '42', name: 'Aya Khater' },
        summary: { total: 24, present: 12, absent: 12, unknown: 0 },
        sessions,
      })));

    const { container } = render(<MemoryRouter initialEntries={['/coach/attendance/42']}><Routes><Route path="/coach/attendance/:learnerId" element={<CoachAttendanceProfile />} /></Routes></MemoryRouter>);

    expect(await screen.findByText('24 records')).toBeInTheDocument();
    expect(container.querySelector('.attendance-profile-print-page')).toBeInTheDocument();
    const table = screen.getAllByRole('table')[0];
    const report = screen.getByLabelText('Student attendance report');
    expect(within(table).getAllByRole('row')).toHaveLength(11);
    expect(within(report).getAllByRole('row')).toHaveLength(25);
    expect(report.querySelectorAll('td[data-status="absent"]')).toHaveLength(12);
    expect(report.querySelectorAll('td[data-status="present"]')).toHaveLength(12);
    expect(within(report).getByText('Session 24')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByText('Showing 1–10 of 24 records')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(within(table).getByText('Session 11')).toBeInTheDocument();
    expect(within(table).queryByText('Session 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(screen.getByText('Showing 21–24 of 24 records')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(within(report).getAllByRole('row')).toHaveLength(25);
  });

  it('keeps present records in the printable report when the learner has no absences', async () => {
    const { container } = render(<MemoryRouter initialEntries={['/coach/attendance/42']}><Routes><Route path="/coach/attendance/:learnerId" element={<CoachAttendanceProfile />} /></Routes></MemoryRouter>);

    expect(await screen.findAllByText('Data session')).toHaveLength(2);
    expect(container.querySelector('tbody tr[data-status="present"]')).toBeInTheDocument();
    expect(container.querySelector('article[aria-label="Student attendance report"] td[data-status="present"]')).toHaveTextContent('Present');
  });
});
