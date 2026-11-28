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
  it('uses backend totals and asks for server filters/pages while displaying reasons', () => {
    const setSelection = vi.fn();
    const state = {
      data: { sessions: 46, present: 23, absent: 23, sessionHistory: [
        { id: 'last', title: 'Last lesson', date: '2026-10-06', status: 'absent', reason: 'Transport' },
      ] }, loading: false, error: null, retry: vi.fn(), invalidate: vi.fn(), setSelection,
      selection: { search: '', status: 'all', month: 'all', page: '1', pageSize: '20' },
      projection: { summary: { outstandingAbsences: 23 }, months: ['2026-10', '2026-09'],
        pagination: { page: 1, pageSize: 20, total: 46, hasMore: true } },
    } as never;
    render(<AttendanceTab attendanceState={state} />);
    expect(screen.getByText('23 / 46')).toBeInTheDocument();
    expect(screen.getByText('Transport')).toBeInTheDocument();
    expect(screen.getByText('46 of 46 sessions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(setSelection.mock.calls[0][0]({ page: '1' }).page).toBe('2');
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-09' } });
    expect(setSelection.mock.calls[1][0]({ page: '2' })).toMatchObject({ page: '1', month: '2026-09' });
    fireEvent.change(screen.getByPlaceholderText('Search session or reason'), { target: { value: 'Transport' } });
    expect(setSelection.mock.calls[2][0]({ page: '2' })).toMatchObject({ page: '1', search: 'Transport' });
  });
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
