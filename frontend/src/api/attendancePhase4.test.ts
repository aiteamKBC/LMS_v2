import { describe, expect, it } from 'vitest';
import { attendanceWorkspaceForDisplay, isMadeUpLecture, isManuallyConfirmedLecture, type AttendanceWorkspace } from './attendanceLectures';
import { attendanceForDisplay, type LearnerAttendance } from './learnerAttendance';

describe('canonical attendance display compatibility', () => {
  it('distinguishes manual presence, verified presence, recovery and recorded credit without changing totals', () => {
    const wire = { totals: { attended: 5, absent: 1 }, lectures: [
      { status: 'present', rawStatus: 'absent', effectiveStatus: 'present', effectiveAttendance: 1, finalOutcome: 'present' },
      { status: 'present', rawAttendanceStatus: 'unmarked', effectiveAttendanceStatus: 'present', effectiveAttendance: 1 },
      { status: 'present', rawStatus: 'present', effectiveStatus: 'present', effectiveAttendance: 1 },
      { status: 'present', rawStatus: 'absent', effectiveStatus: 'made_up', effectiveAttendance: 1, catchupStatus: 'completed' },
      { status: 'present', rawStatus: 'absent', effectiveStatus: 'recorded', effectiveAttendance: 1, attendanceBasis: 'recorded' },
      { status: 'absent', rawStatus: 'absent', effectiveStatus: 'absent', effectiveAttendance: 0, catchupStatus: 'completed' },
    ] } as unknown as AttendanceWorkspace;
    const display = attendanceWorkspaceForDisplay(wire);
    expect(display.lectures.map(row => row.status)).toEqual(['completed', 'completed', 'completed', 'absent', 'completed', 'absent']);
    expect(display.lectures.map(isMadeUpLecture)).toEqual([false, false, false, true, false, false]);
    expect(display.lectures.map(isManuallyConfirmedLecture)).toEqual([true, true, false, false, false, false]);
    expect(display.totals).toEqual(wire.totals);
    expect(wire.lectures[0].status).toBe('present');
  });

  it('lets a later attendance correction override old recovery details', () => {
    const wire = { lectures: [
      { status: 'present', rawStatus: 'absent', effectiveStatus: 'present', effectiveAttendance: 1,
        finalOutcome: 'made_up', catchupStatus: 'completed', recovery: { method: 'catch-up' } },
    ] } as unknown as AttendanceWorkspace;
    const row = attendanceWorkspaceForDisplay(wire).lectures[0];
    expect(row.status).toBe('completed');
    expect(isMadeUpLecture(row)).toBe(false);
    expect(isManuallyConfirmedLecture(row)).toBe(true);
  });

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
