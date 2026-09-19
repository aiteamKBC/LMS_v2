import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

const attendanceRecords = [
  {
    learnerId: '42', learnerName: 'Aya Khater', learnerEmail: 'aya@example.com', sessionId: 'session-1',
    sessionTitle: 'Data Analysis — Session 1', sessionDate: '2026-09-10', sessionDateLabel: '10 Sep 2026', status: 'present',
  },
  {
    learnerId: '7', learnerName: 'Ayman Learner', learnerEmail: 'ayman@example.com', sessionId: 'session-1',
    sessionTitle: 'Data Analysis — Session 1', sessionDate: '2026-09-10', sessionDateLabel: '10 Sep 2026', status: 'absent',
  },
  {
    learnerId: '42', learnerName: 'Aya Khater', learnerEmail: 'aya@example.com', sessionId: 'session-2',
    sessionTitle: 'Data Analysis — Session 2', sessionDate: '2026-09-17', sessionDateLabel: '17 Sep 2026', status: 'absent',
  },
  {
    learnerId: '9', learnerName: 'Mona Test', learnerEmail: 'mona@example.com', sessionId: 'session-3',
    sessionTitle: 'Safeguarding — Session 1', sessionDate: '2026-09-11', sessionDateLabel: '11 Sep 2026', status: 'present',
  },
];

describe('coach lecture attendance page', () => {
  beforeEach(() => {
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ attendanceRecords })));
  });

  it('shows only the two dependent filters and the selected lecture register', async () => {
    render(<MemoryRouter><CoachAttendance /></MemoryRouter>);

    const subject = await screen.findByRole('combobox', { name: 'Subject' });
    const lectureDate = screen.getByRole('combobox', { name: 'Lecture date' });

    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(lectureDate).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Search by learner/i)).not.toBeInTheDocument();

    fireEvent.change(subject, { target: { value: 'Data Analysis' } });
    expect(lectureDate).toBeEnabled();
    expect(within(lectureDate).getByRole('option', { name: '10 Sep 2026' })).toBeInTheDocument();
    expect(within(lectureDate).getByRole('option', { name: '17 Sep 2026' })).toBeInTheDocument();
    expect(within(lectureDate).queryByRole('option', { name: '11 Sep 2026' })).not.toBeInTheDocument();

    fireEvent.change(lectureDate, { target: { value: '2026-09-10' } });
    expect(screen.getByText('Aya Khater')).toBeInTheDocument();
    expect(screen.getByText('Ayman Learner')).toBeInTheDocument();
    expect(screen.getByText('Present')).toBeInTheDocument();
    expect(screen.getByText('Absent')).toBeInTheDocument();
    expect(screen.queryByText('Mona Test')).not.toBeInTheDocument();
  });

  it('clears the lecture date when the subject changes', async () => {
    render(<MemoryRouter><CoachAttendance /></MemoryRouter>);

    const subject = await screen.findByRole('combobox', { name: 'Subject' });
    const lectureDate = screen.getByRole('combobox', { name: 'Lecture date' });
    fireEvent.change(subject, { target: { value: 'Data Analysis' } });
    fireEvent.change(lectureDate, { target: { value: '2026-09-10' } });
    fireEvent.change(subject, { target: { value: 'Safeguarding' } });

    expect(lectureDate).toHaveValue('');
    expect(screen.getByText('Select a lecture date')).toBeInTheDocument();
  });
});
