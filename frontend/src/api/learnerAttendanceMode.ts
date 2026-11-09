import type { LearnerKind } from './learnerDetail';
import { peekLearnerJson, readLearnerJson } from './learnerRead';

type ModeResponse = { mode?: unknown };
export type LearnerAttendanceMode = 'live' | 'lazy';

const url = (kind: LearnerKind, id: string) => `/learner_api/attendance/${kind}/${encodeURIComponent(id)}/mode/`;
const savedMode = (data: ModeResponse | undefined): LearnerAttendanceMode | undefined =>
  data?.mode === 'live' || data?.mode === 'lazy' ? data.mode : undefined;

/** The active mode used by User Management and attendance; pending requests do not change it. */
export async function readLearnerAttendanceMode(kind: LearnerKind, id: string, signal?: AbortSignal, fresh = false): Promise<LearnerAttendanceMode> {
  const mode = savedMode(await readLearnerJson<ModeResponse>(url(kind, id), { ttlMs: 30_000, signal, revalidate: fresh }));
  if (!mode) throw new Error('Attendance requirement unavailable.');
  return mode;
}

export const peekLearnerAttendanceMode = (kind: LearnerKind, id: string) =>
  savedMode(peekLearnerJson<ModeResponse>(url(kind, id)));
