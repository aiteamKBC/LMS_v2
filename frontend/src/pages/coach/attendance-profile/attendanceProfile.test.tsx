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
      .mockResolvedValueOnce(new Response(JSON.stringify({ learners: [{ id: '42', learner: 'Aya Khater', email: 'same@example.com', programme: 'Data', cohort: 'September', group: 'Cairo A', attendance: 81, sessions: 32, present: 26 }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sessions: [{ sessionId: 'session-2', sessionTitle: 'Data session', sessionType: 'Live lecture', sessionDate: '2026-09-16', sessionDateLabel: '16 Sep 2026', status: 'present' }] })));
  });
  it('uses the canonical summary and id-only detail lookup', async () => {
    render(<MemoryRouter initialEntries={['/coach/attendance/42']}><Routes><Route path="/coach/attendance/:learnerId" element={<CoachAttendanceProfile />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Aya Khater' })).toBeInTheDocument();
    expect(screen.getByText('81%')).toBeInTheDocument();
    expect(screen.getByText('26 present out of 32')).toBeInTheDocument();
    expect(screen.getByText('Data session')).toBeInTheDocument();
    expect(vi.mocked(coachFetch).mock.calls[1][0]).toBe('/coach_api/coach/attendance/details?learner_id=42');
    expect(String(vi.mocked(coachFetch).mock.calls[1][0])).not.toContain('same%40example.com');
  });
});
