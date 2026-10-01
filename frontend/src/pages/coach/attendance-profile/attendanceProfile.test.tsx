import { render, screen } from '@testing-library/react';
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
      .mockResolvedValueOnce(new Response(JSON.stringify({
        learner: { id: '42', name: 'Aya Khater', email: 'same@example.com', programme: 'Data', cohort: 'September', group: 'Cairo A', programmeStartDate: '01 Sep 2026', programmeEndDate: '31 Aug 2027', coachName: 'Coach Sara' },
        summary: { total: 32, present: 26, absent: 6, unknown: 0 },
        sessions: [{ sessionId: 'session-2', source: 'microsoft-teams', sourceId: 'occ-2', sessionTitle: 'Data session', sessionType: 'Live lecture', sessionDate: '2026-09-16', sessionDateLabel: '16 Sep 2026', status: 'present' }],
      })));
  });
  it('uses the canonical summary and id-only detail lookup', async () => {
    render(<MemoryRouter initialEntries={['/coach/attendance/42']}><Routes><Route path="/coach/attendance/:learnerId" element={<CoachAttendanceProfile />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Aya Khater' })).toBeInTheDocument();
    expect(screen.getAllByText('81%')).toHaveLength(2);
    expect(screen.getByText('26 present out of 32')).toBeInTheDocument();
    expect(screen.getAllByText('Data session')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Student attendance report')).toBeInTheDocument();
    expect(screen.getByText('01 Sep 2026 — 31 Aug 2027')).toBeInTheDocument();
    expect(screen.getByText('Attendance rate').nextElementSibling).toHaveTextContent('81%');
    expect(vi.mocked(coachFetch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(coachFetch).mock.calls[0][0]).toBe('/coach_api/coach/attendance/details?learner_id=42');
    expect(String(vi.mocked(coachFetch).mock.calls[0][0])).not.toContain('same%40example.com');
    expect(vi.mocked(coachFetch).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
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
    expect(screen.getAllByRole('row')).toHaveLength(50);
    expect(container.querySelectorAll('tbody tr[data-status="absent"]')).toHaveLength(12);
    expect(container.querySelectorAll('tbody tr[data-status="present"]')).toHaveLength(12);
    expect(screen.getAllByText('Session 24')).toHaveLength(2);
  });

  it('keeps present records in the printable report when the learner has no absences', async () => {
    const { container } = render(<MemoryRouter initialEntries={['/coach/attendance/42']}><Routes><Route path="/coach/attendance/:learnerId" element={<CoachAttendanceProfile />} /></Routes></MemoryRouter>);

    expect(await screen.findAllByText('Data session')).toHaveLength(2);
    expect(container.querySelector('tbody tr[data-status="present"]')).toBeInTheDocument();
    expect(container.querySelector('article[aria-label="Student attendance report"] td[data-status="present"]')).toHaveTextContent('Present');
  });
});
