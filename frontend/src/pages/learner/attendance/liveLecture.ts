import { useEffect, useState } from 'react';
import type { AttendanceLecture } from '@/api/attendanceLectures';
import type { PlanModule } from '@/api/trainingPlanDashboard';
import { deliveryDateKey, deliveryWeekEnd } from '@/lib/deliveryWeek';

export function lectureToday(now: number, timeZone = 'Europe/London'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Keep a delivered session available through its training week, including recordings. */
export function featuredLecture(lectures: AttendanceLecture[], now: number, timeZone?: string,
  modules: Pick<PlanModule, 'id' | 'curriculumSlots'>[] = []): AttendanceLecture | null {
  const today = lectureToday(now, timeZone);
  const candidates = lectures.filter(row => row.status !== 'cancelled' && deliveryDateKey(row.date))
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`) || a.id.localeCompare(b.id));
  const liveRows = candidates.filter(row => isLectureLive(row, now));
  const live = liveRows.find(row => !['completed', 'late'].includes(row.status)) || liveRows[0];
  if (live) return live;

  const currentWeeks = new Map(modules.map(module => {
    const slots = (module.curriculumSlots || []).filter(slot => deliveryDateKey(slot.date)).map(slot => {
      // A moved occurrence keeps its authored week identity. Its actual delivery
      // date, rather than the generated slot date, anchors that week's recordings.
      const delivered = slot.weekId && candidates.find(row => row.moduleId === `native:${module.id}` && row.weekId === slot.weekId);
      return { ...slot, date: delivered ? delivered.date : slot.date };
    }).sort((a, b) => a.date.localeCompare(b.date));
    const slot = slots.filter(item => item.date <= today).at(-1);
    const end = slot && deliveryWeekEnd(slot.date);
    const next = slot && slots.find(item => item.date > slot.date);
    const moduleKey: string = `native:${module.id}`;
    return [moduleKey, { hasSlots: slots.length > 0, id: slot?.weekId,
      start: slot?.date, end, next: next?.date, teaching: slot?.type === 'live-session' }] as const;
  }));
  const current = candidates.filter(row => {
    const week = currentWeeks.get(row.moduleId);
    if (week?.hasSlots) {
      return week.teaching && week.start && week.end && today <= week.end
        && (!row.weekId || !week.id || row.weekId === week.id)
        && (!week.next || today < week.next) && row.date >= week.start && row.date <= week.end
        && (!week.next || row.date < week.next);
    }
    // Older payloads have no slot spine: the lecture's own delivery date anchors its seven days.
    const end = deliveryWeekEnd(row.date);
    return row.date <= today && end != null && today <= end;
  });
  const upcoming = (row: AttendanceLecture) => {
    if (row.date < today || ['completed', 'late'].includes(row.status)) return false;
    const end = Date.parse(row.endsAt || '');
    return !Number.isFinite(end) || end > now;
  };
  return current.find(upcoming) || current.at(-1) || candidates.find(upcoming) || null;
}

export function isLectureLive(lecture: AttendanceLecture, now: number): boolean {
  const start = Date.parse(lecture.startsAt || '');
  const end = Date.parse(lecture.endsAt || '');
  return Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end;
}

/** Teams holds early arrivals in the lobby, so Join opens a little before the start. */
export const JOIN_EARLY_MINUTES = 15;
const JOIN_EARLY_MS = JOIN_EARLY_MINUTES * 60_000;

/** Join is offered from shortly before a timed lecture starts until it ends. */
export function isLectureJoinable(lecture: AttendanceLecture, now: number): boolean {
  if (lecture.status === 'cancelled') return false;
  const start = Date.parse(lecture.startsAt || '');
  const end = Date.parse(lecture.endsAt || '');
  return Number.isFinite(start) && Number.isFinite(end) && start < end && start - JOIN_EARLY_MS <= now && now < end;
}

export function lectureJoinUrl(lecture: AttendanceLecture): string | null {
  try {
    if (/^\/learner_api\/session-results\/[^?#]+\/join\/$/.test(lecture.joinUrl || '')) return lecture.joinUrl!;
    const url = new URL(lecture.joinUrl || '');
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

/** Change the action at a lecture boundary even while the API response is cached. */
export function useLectureClock(lectures: AttendanceLecture[]): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      const next = lectures.flatMap(lecture => {
        const start = Date.parse(lecture.startsAt || '');
        return [start - JOIN_EARLY_MS, start, Date.parse(lecture.endsAt || '')];
      }).filter(boundary => boundary > current);
      // Periodically account for changes to the system clock as well as exact boundaries.
      timer = setTimeout(tick, Math.min(60_000, Math.max(1, Math.min(...next) - current)));
    };
    tick();
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [lectures]);
  return now;
}
