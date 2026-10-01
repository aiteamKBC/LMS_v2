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
  learnerType?: string | null;
  enrolmentId?: string | null;
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
  programmeStartDate?: string | null;
  programmeEndDate?: string | null;
  coachName?: string | null;
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
  manualId?: string;
  source?: string;
  sourceId?: string;
  absenceReport?: { id: string; status: string; url?: string } | null;
}

export interface ManualAttendanceInput {
  learnerId: string;
  date: string;
  module: string;
  sessionTitle: string;
  status: AttendanceStatus;
}

export interface SourceAttendanceInput extends ManualAttendanceInput {
  source: string;
  sourceId: string;
}

export interface CoachAttendanceDetailsPayload {
  learner?: {
    id: string;
    name: string;
    email?: string | null;
    programme?: string | null;
    programmeId?: string | null;
    cohort?: string | null;
    group?: string | null;
    groupId?: string | null;
    programStatus?: string | null;
    learnerType?: string | null;
    enrolmentId?: string | null;
    programmeStartDate?: string | null;
    programmeEndDate?: string | null;
    coachName?: string | null;
  };
  summary?: {
    total: number;
    present: number;
    absent: number;
    unknown: number;
  };
  sessions?: CoachAttendanceSession[];
}

