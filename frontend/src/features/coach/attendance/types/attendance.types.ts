export type AttendanceStatus = 'present' | 'absent';

export interface CoachAttendanceRecord {
  learnerId: string;
  sessionId: string;
  sessionDate: string | null;
  status: string;
}

export interface CoachAttendanceLearner {
  id: string;
  learner: string;
  email?: string | null;
  programme: string;
  programmeId?: string | null;
  cohort?: string;
  group: string;
  groupName?: string | null;
  groupId?: string | null;
  programStatus?: string;
  attendance?: number | null;
  sessions?: number | null;
  present?: number | null;
  absent?: number | null;
  hasAttendance?: boolean;
  includedInAttendanceMetrics?: boolean;
}

export interface CoachAttendancePayload {
  learners?: CoachAttendanceLearner[];
  attendanceRecords?: CoachAttendanceRecord[];
}

export interface CoachAttendanceSession {
  sessionId: string;
  sessionTitle: string;
  sessionType: string;
  sessionDate: string | null;
  sessionDateLabel: string;
  status: string;
  absenceReport?: { id: string; status: string; url?: string } | null;
}

export interface CoachAttendanceDetailsPayload {
  sessions?: CoachAttendanceSession[];
}

