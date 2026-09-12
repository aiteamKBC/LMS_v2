import { readLearnerJson, peekLearnerJson } from './learnerRead';
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
  source?: 'kbc-attendance' | 'microsoft-teams' | 'combined';
  sessionHistory: AttendanceSessionRow[];
}

const attendanceUrl = (kind: LearnerKind, learnerId: string) => `/learner_api/attendance/${kind}/${learnerId}/`;

export function peekLearnerAttendance(kind: LearnerKind, learnerId: string): LearnerAttendance | null | undefined {
  return peekLearnerJson<{ attendance: LearnerAttendance | null }>(attendanceUrl(kind, learnerId))?.attendance;
}

export async function fetchLearnerAttendance(kind: LearnerKind, learnerId: string, signal?: AbortSignal, fresh = false): Promise<LearnerAttendance | null> {
  const data = await readLearnerJson<{ attendance: LearnerAttendance | null }>(attendanceUrl(kind, learnerId), { ttlMs: 30_000, signal, revalidate: fresh });
  return data.attendance ?? null;
}
