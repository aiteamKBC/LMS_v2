import { coachFetch } from '@/lib/coachFetch';
import type { LearnerKind } from './learnerDetail';

export interface SessionPerson {
  email: string; name: string; seconds: number; expected: boolean;
  status: 'present' | 'absent' | 'pending' | 'review' | 'excused' | 'recovered';
  attendance: 0 | 1 | null; excused: boolean; catchupCompleted: boolean;
}
export interface SessionFile {
  id: string; type: 'recording' | 'transcript'; state: 'pending' | 'ready' | 'failed';
  createdAt?: string; text?: string | null;
}
export interface SessionResult {
  id: string; seriesId: string; sessionNumber: number; startsAt: string; endsAt: string;
  state: string; reportReady: boolean; syncedAt?: string; fileCount?: number;
  attendance?: SessionPerson[]; artifacts?: SessionFile[];
}
export interface ModuleSessionResults {
  series: { id: string; title: string; sessions: SessionResult[] }[];
  jobs: { live_session_id: string; state: string; last_error: string; finished_at?: string }[];
}
export interface SessionLearner { kind: LearnerKind; id: string }
const adminBase = '/curriculum_api/curriculum/session-results';
export const sessionBase = (seriesId: string, learner?: SessionLearner) => learner
  ? `/learner_api/session-results/${learner.kind}/${encodeURIComponent(learner.id)}/${encodeURIComponent(seriesId)}`
  : `${adminBase}/${encodeURIComponent(seriesId)}`;

async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: 'include', signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Saved results could not be loaded.');
  return result as T;
}
export const loadModuleSessions = (moduleId: string, signal?: AbortSignal) =>
  read<ModuleSessionResults>(`/curriculum_api/curriculum/modules/${encodeURIComponent(moduleId)}/session-results/`, signal);
export const loadSessionResult = (seriesId: string, number: number, learner?: SessionLearner, signal?: AbortSignal) =>
  read<{ sessions: SessionResult[] }>(`${sessionBase(seriesId, learner)}/sessions/${number}/`, signal);
export const sessionFileUrl = (seriesId: string, file: SessionFile, learner?: SessionLearner, text = false) =>
  `${sessionBase(seriesId, learner)}/artifacts/${encodeURIComponent(file.id)}/${text ? '?format=txt' : ''}`;
export const sessionAttendanceUrl = (session: SessionResult) =>
  `${sessionBase(session.seriesId)}/sessions/${session.sessionNumber}/attendance.csv`;
export async function requestSessionSync(seriesId: string) {
  const response = await coachFetch(`${adminBase}/${encodeURIComponent(seriesId)}/sync/`, { method: 'POST' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not request synchronization.');
  return result as { state: 'queued'; message: string };
}
