import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import CoachAttendance from './page';

vi.mock('@/hooks/useCoachIdentity', () => ({
  useCoachIdentity: () => ({ isInitialized: true, email: 'coach@example.com', name: 'Coach Sara' }),
}));

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function CurrentPath() {
  return <div data-testid="current-path">{useLocation().pathname}</div>;
}

describe('coach attendance overview page', () => {
  beforeEach(() => {
    vi.mocked(coachFetch).mockImplementation(async (url) => {
      if (url === '/coach_api/coach/absence-reports') {
        return new Response(JSON.stringify({
          items: [{ learnerId: '42', learner: 'Aya Khater', email: 'aya@example.com', sessionDate: '2026-09-10' }],
        }));
      }
      return new Response(JSON.stringify({
        summary: { totalLearners: 1, onTrack: 0, needsAttention: 1, atRisk: 0 },
        learners: [{
          id: '42', learner: 'Aya Khater', initials: 'AK', email: 'aya@example.com', programme: 'Data Analyst',
          cohort: 'September 2026', group: 'A', employer: 'Acme', attendance: 80, sessions: 5, present: 3,
          absent: 2, lastSession: '10 Sep 2026', lastSessionDate: '2026-09-10', risk: 'amber', hasAttendance: true,
        }],
      }));
    });
  });

  it('combines live attendance and absence report totals, then opens the learner profile', async () => {
    render(
      <MemoryRouter initialEntries={['/coach/attendance']}>
        <Routes>
          <Route path="/coach/attendance" element={<><CoachAttendance /><CurrentPath /></>} />
          <Route path="/coach/attendance/:learnerId" element={<CurrentPath />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'My Learners – Attendance Overview' })).toBeInTheDocument();
    expect(await screen.findByText('1 / 2 submitted')).toBeInTheDocument();
    expect(screen.getByText('3 / 5')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/coach/attendance/42'));
  });
});
