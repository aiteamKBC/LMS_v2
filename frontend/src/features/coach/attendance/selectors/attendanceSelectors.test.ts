import { describe, expect, it } from 'vitest';
import { formatAttendancePercentage, selectRecentAttendance, selectRecordedAttendance } from './attendanceSelectors';

describe('Coach Attendance selectors', () => {
  it('keeps only the four latest canonical present/absent records', () => {
    const records = [
      ['2026-09-06', 'unmarked'], ['2026-09-05', 'absent'], ['2026-09-04', 'present'],
      ['2026-09-03', 'absent'], ['2026-09-02', 'present'], ['2026-09-01', 'present'],
    ].map(([sessionDate, status], index) => ({ learnerId: '1', sessionId: String(index), sessionDate, status }));
    expect(selectRecentAttendance(records, '1').map(row => row.sessionDate)).toEqual([
      '2026-09-05', '2026-09-04', '2026-09-03', '2026-09-02',
    ]);
  });

  it('preserves zero separately from unavailable', () => {
    expect(formatAttendancePercentage(0)).toBe('0%');
    expect(formatAttendancePercentage(null)).toBe('--');
    expect(formatAttendancePercentage(undefined)).toBe('--');
  });

  it('includes unmarked history without counting future or active sessions', () => {
    const sessions = ['present', 'absent', 'unmarked', 'upcoming', 'in_progress'].map((status, index) => ({
      sessionId: String(index), sessionTitle: 'Session', sessionType: 'Live', sessionDate: null, sessionDateLabel: '--', status,
    }));
    expect(selectRecordedAttendance(sessions).map(row => row.status)).toEqual(['present', 'absent', 'unmarked']);
  });
});

