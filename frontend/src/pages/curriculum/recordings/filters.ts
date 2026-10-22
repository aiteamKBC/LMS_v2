import type { Lecture } from './types';
import { addDays, lectureReadyCount, lectureNeedsAttention } from './utils';

export type Period = 'day' | 'workWeek' | 'week' | 'month';
export type SessionFilter = 'all' | 'ended' | 'upcoming' | 'notEnded';

/** Calendar dates are already in the selected viewing zone; never use host-local dates. */
export function periodBounds(date: string, period: Period) {
  if (period === 'day') return { start: date, end: date };
  const instant = new Date(`${date}T12:00:00Z`);
  if (period === 'week' || period === 'workWeek') {
    const start = addDays(date, -((instant.getUTCDay() + 6) % 7));
    return { start, end: addDays(start, period === 'workWeek' ? 4 : 6) };
  }
  const end = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { start: `${date.slice(0, 7)}-01`, end };
}

export function sessionMatches(lecture: Lecture, filter: SessionFilter, now: number) {
  if (filter === 'all') return true;
  if (lecture.cancelled || lecture.status === 'cancelled' || lecture.source === 'recording-review') return false;
  const instant = Date.parse((filter === 'upcoming' ? lecture.startsAt : lecture.endsAt) || '');
  return Number.isFinite(instant) && (filter === 'ended' ? instant <= now : instant > now);
}

export function matchesLectureQuery(lecture: Lecture, query: string) {
  const fields = `${lecture.title} ${lecture.module} ${lecture.programme} ${lecture.group} ${lecture.cohort} ${lecture.weekTitle}`.toLocaleLowerCase();
  return fields.includes(query.trim().toLocaleLowerCase().replace(/\s+/g, ' '));
}

export type AgendaFilter = 'all' | 'ready' | 'attention' | 'ended' | 'notEnded' | 'pending' | 'missing' | 'unsynced' | 'archiveFailed' | 'review';
export function agendaMatches(lecture: Lecture, filter: AgendaFilter, now: number) {
  if (filter === 'ready') return lectureReadyCount(lecture) > 0;
  if (filter === 'attention') return lectureNeedsAttention(lecture);
  if (filter === 'pending' || filter === 'missing' || filter === 'unsynced' || filter === 'archiveFailed' || filter === 'review') {
    return lecture.status === filter || lecture.recordings.some(recording => recording.status === filter);
  }
  return sessionMatches(lecture, filter, now);
}
