import { learningFetch, personalLearningUrl } from '@/lib/personalLearning';
import { coachFetch } from '@/lib/coachFetch';
import type { LearnerKind } from './learnerDetail';

export interface SessionPerson {
  email: string; name: string; seconds: number; expected: boolean;
  /** Result of the original Teams occurrence. Recovery never changes this. */
  status: 'present' | 'absent' | 'pending' | 'review' | 'excused' | 'recovered';
  attendance: 0 | 1 | null; excused: boolean; catchupCompleted: boolean;
  rawStatus?: 'present' | 'absent' | 'pending' | 'review';
  rawAttendance?: 0 | 1 | null;
  excuseStatus?: 'none' | 'pending' | 'approved' | 'declined';
  recoveryStatus?: string;
  effectiveStatus?: 'present' | 'absent' | 'pending' | 'review' | 'absent_excused' | 'made_up';
  effectiveAttendance?: 0 | 1 | null;
  finalOutcome?: 'present' | 'absent' | 'pending' | 'review' | 'absent_excused' | 'made_up';
  intervals?: { joinedAt: string; leftAt: string }[];
}
export interface SessionFile {
  id: string; type: 'recording' | 'transcript'; state: 'pending' | 'ready' | 'failed';
  createdAt?: string; text?: string | null;
  hiddenFromLearners?: boolean;
  endsAt?: string | null; timingReady?: boolean;
  transcriptLinks?: TranscriptLink[];
}
export interface TranscriptLink { id: string; timingReady: boolean; offsetSeconds: number | null }
export interface TranscriptCue { start: number; end: number; speaker: string; text: string }
export interface SessionResult {
  id: string; seriesId: string; sessionNumber: number; startsAt: string; endsAt: string;
  title?: string; actualStartsAt?: string | null; actualEndsAt?: string | null;
  runs?: { startsAt: string; endsAt: string }[];
  state: string; reportReady: boolean; syncedAt?: string; fileCount?: number; archiveReady?: boolean;
  attendance?: SessionPerson[]; artifacts?: SessionFile[];
}
export interface ModuleSessionResults {
  syncAvailable?: boolean;
  warning?: string;
  series: { id: string; title: string; sessions: SessionResult[] }[];
  jobs: SessionSyncJob[];
}
export interface SessionSyncJob {
  live_session_id: string; state: string; last_error: string;
  started_at?: string | null; finished_at?: string | null;
  progress?: {
    filesReady: number; totalFiles: number;
    transfer: {
      phase: 'preparing' | 'downloading' | 'uploading' | 'finalizing';
      bytesTransferred: number; totalBytes: number | null; updatedAt: string;
      type: 'recording' | 'transcript'; sessionNumber: number;
    } | null;
  };
}
export interface SessionLearner { kind: LearnerKind; id: string }
const adminBase = '/curriculum_api/curriculum/session-results';
export const sessionBase = (seriesId: string, learner?: SessionLearner) => learner
  ? `/learner_api/session-results/${learner.kind}/${encodeURIComponent(learner.id)}/${encodeURIComponent(seriesId)}`
  : `${adminBase}/${encodeURIComponent(seriesId)}`;

async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await learningFetch(url, { credentials: 'include', cache: 'no-store', signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Saved results could not be loaded.');
  return result as T;
}
export const loadModuleSessions = (moduleId: string, signal?: AbortSignal) =>
  read<ModuleSessionResults>(`/curriculum_api/curriculum/modules/${encodeURIComponent(moduleId)}/session-results/`, signal);
export const loadSessionResult = (seriesId: string, number: number, learner?: SessionLearner, signal?: AbortSignal) =>
  read<{ sessions: SessionResult[]; job?: SessionSyncJob | null }>(`${sessionBase(seriesId, learner)}/sessions/${number}/`, signal);
export const sessionFileUrl = (seriesId: string, file: SessionFile, learner?: SessionLearner, text = false) =>
  personalLearningUrl(`${sessionBase(seriesId, learner)}/artifacts/${encodeURIComponent(file.id)}/${text ? '?format=txt' : ''}`);
export const loadTranscriptCues = (seriesId: string, artifactId: string, learner?: SessionLearner, signal?: AbortSignal) =>
  read<{ cues: TranscriptCue[] }>(`${sessionBase(seriesId, learner)}/artifacts/${encodeURIComponent(artifactId)}/?format=cues`, signal);
export const sessionAttendanceUrl = (session: SessionResult, format: 'csv' | 'pdf' = 'csv') =>
  `${sessionBase(session.seriesId)}/sessions/${session.sessionNumber}/attendance.${format}`;
export async function requestSessionSync(seriesId: string) {
  const response = await coachFetch(`${adminBase}/${encodeURIComponent(seriesId)}/sync/`, { method: 'POST' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not request synchronization.');
  return result as { state: 'queued'; message: string };
}

export async function setRecordingVisibility(seriesId: string, artifactId: string, hidden: boolean) {
  const response = await coachFetch(`${adminBase}/${encodeURIComponent(seriesId)}/artifacts/${encodeURIComponent(artifactId)}/visibility/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not update recording visibility.');
}
