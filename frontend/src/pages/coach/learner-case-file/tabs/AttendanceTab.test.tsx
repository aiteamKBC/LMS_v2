import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AttendanceTab } from './AttendanceTab';

function attendanceState() {
  const sessionHistory = Array.from({ length: 31 }, (_, index) => ({
    id: `session-${index + 1}`,
    date: `2026-09-${String(30 - (index % 30)).padStart(2, '0')}`,
    title: `Session ${index + 1}`,
    sessionType: 'Live',
    status: index === 30 ? 'missed' : 'attended',
  }));

  return {
    data: {
      learnerEmail: 'learner@example.test', learnerId: 42, learnerName: 'Learner',
      sessions: 31, present: 30, absent: 1, late: 0, catchup: 0, risk: 'green',
      lastSessionDate: '2026-09-30', consecutiveMissed: 1, updatedAt: null,
      attendanceRate: 97, source: 'combined', sessionHistory,
    },
    loading: false,
    error: null,
    retry: vi.fn(),
    invalidate: vi.fn(),
  } as never;
}

describe('AttendanceTab session history pagination', () => {
  it('shows 15 sessions per page and resets to page one when filters change', () => {
    render(<AttendanceTab attendanceState={attendanceState()} />);

    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(16);
    expect(screen.getByText('Session 1')).toBeInTheDocument();
    expect(screen.queryByText('Session 16')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Session 16')).toBeInTheDocument();
    expect(screen.queryByText('Session 1')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search session or reason'), { target: { value: 'Session 1' } });
    expect(screen.getByText('Session 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
  });
});
