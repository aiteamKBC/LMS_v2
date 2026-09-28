import { describe, expect, it } from 'vitest';
import { formatAttendancePercentage, selectAttendanceLearner, selectRecentAttendance, selectRecordedAttendance } from './attendanceSelectors';

describe('Coach Attendance selectors', () => {
  it('matches learners only by stable id', () => {
    const learners = [
      { id: '1', learner: 'Same Name', programme: 'A', group: 'G' },
      { id: '2', learner: 'Same Name', programme: 'B', group: 'G' },
    ];
    expect(selectAttendanceLearner(learners, '2')?.programme).toBe('B');
    expect(selectAttendanceLearner(learners, '3')).toBeNull();
  });

  it('keeps only the four latest canonical present/absent records', () => {
    const records = [
      ['2026-09-01', 'present'], ['2026-09-05', 'absent'], ['2026-09-04', 'present'],
      ['2026-09-03', 'absent'], ['2026-09-02', 'present'], ['2026-09-06', 'unknown'],
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

  it('excludes unresolved session statuses from recorded attendance', () => {
    const sessions = ['present', 'absent', 'unknown'].map((status, index) => ({
      sessionId: String(index), sessionTitle: 'Session', sessionType: 'Live', sessionDate: null, sessionDateLabel: '--', status,
    }));
    expect(selectRecordedAttendance(sessions).map(row => row.status)).toEqual(['present', 'absent']);
  });
});

