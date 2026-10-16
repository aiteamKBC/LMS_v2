import { learningFetch } from '@/lib/personalLearning';
import type { SessionPerson, SessionFile } from '@/api/sessionResults';
import type { Lecture } from './types';
export interface DailyResults {
  date: string; timeZone: string; reportReady: boolean; reportCount: number;
  attendance: SessionPerson[]; staff: { name: string; email: string; roles: string[]; seconds: number; status: 'joined' | 'unconfirmed' }[];
  artifacts: SessionFile[]; unplacedFileCount: number;
}
export async function loadDailyResults(lecture: Pick<Lecture, 'moduleId' | 'occurrenceId' | 'date' | 'seriesId' | 'sessionNumber'>, timeZone: string, signal: AbortSignal): Promise<DailyResults> {
  const query = new URLSearchParams({ moduleId: lecture.moduleId, occurrenceId: lecture.occurrenceId || '', date: lecture.date, timeZone });
  const response = await learningFetch(`/curriculum_api/curriculum/session-results/${encodeURIComponent(lecture.seriesId!)}/sessions/${lecture.sessionNumber}/day-results/?${query}`, { credentials: 'include', cache: 'no-store', signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Attendance could not be loaded.');
  if (data.date !== lecture.date || data.timeZone !== timeZone) throw new Error('The returned attendance does not match this lecture day.');
  return data;
}
