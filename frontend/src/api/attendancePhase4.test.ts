import { describe, expect, it } from 'vitest';
import { attendanceWorkspaceForDisplay, type AttendanceWorkspace } from './attendanceLectures';
import { attendanceForDisplay, type LearnerAttendance } from './learnerAttendance';

describe('canonical attendance display compatibility', () => {
  it('preserves raw/effective statuses and unmarked while adapting existing lecture labels', () => {
    const wire = { lectures: [
      { status: 'present', rawStatus: 'absent', effectiveStatus: 'made_up', effectiveAttendance: 1, counted: true },
      { status: 'present', rawStatus: 'late', effectiveStatus: 'late', counted: true },
      { status: 'unmarked', rawStatus: 'pending', counted: false },
    ] } as unknown as AttendanceWorkspace;
    const display = attendanceWorkspaceForDisplay(wire);
    expect(display.lectures.map(row => row.status)).toEqual(['absent', 'late', 'unmarked']);
    expect(display.lectures[0]).toMatchObject({ rawStatus: 'absent', effectiveStatus: 'made_up', counted: true });
    expect(wire.lectures[0].status).toBe('present');
  });

  it('keeps canonical summary totals and historical Coach display labels consistent', () => {
    const wire = { present: 1, absent: 1, sessions: 2, attendanceRate: 50, sessionHistory: [
      { status: 'present', rawStatus: 'absent', effectiveStatus: 'made_up' },
      { status: 'absent', rawStatus: 'absent', effectiveStatus: 'absent' },
    ] } as LearnerAttendance;
    const display = attendanceForDisplay(wire)!;
    expect(display.sessionHistory.map(row => row.status)).toEqual(['attended', 'missed']);
    expect(display).toMatchObject({ present: 1, absent: 1, sessions: 2, attendanceRate: 50 });
    expect(display.sessionHistory[0].effectiveStatus).toBe('made_up');
  });
});
