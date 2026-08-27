import type { LearnerKind } from '@/api/learnerDetail';

export type AttendanceSessionStatus = 'attended' | 'missed' | 'late';

export interface AttendanceSessionRow {
  id: string;
  date: string;
  title: string;
  sessionType: string;
  status: AttendanceSessionStatus;
  startTime: string;
  endTime: string;
  module: string;
  coach: string;
}

export interface LearnerAttendance {
  learnerEmail: string;
  learnerId: number;
  learnerName: string;
  sessions: number;
  present: number;
  absent: number;
  late: number;
  catchup: number;
  risk: string;
  lastSessionDate: string | null;
  consecutiveMissed: number;
  updatedAt: string | null;
  attendanceRate: number;
  source?: 'microsoft-teams';
  sessionHistory: AttendanceSessionRow[];
}

export async function fetchLearnerAttendance(kind: LearnerKind, learnerId: string): Promise<LearnerAttendance | null> {
  let response: Response;
  try {
    response = await fetch(`/learner_api/attendance/${kind}/${learnerId}/`, { headers: { 'Content-Type': 'application/json' } });
  } catch {
    throw new Error('Could not reach the attendance service.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Could not load attendance (${response.status}).`);
  return data.attendance ?? null;
}
