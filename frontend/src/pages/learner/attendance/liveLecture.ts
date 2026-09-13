import { useEffect, useState } from 'react';
import type { AttendanceLecture } from '@/api/attendanceLectures';

export function isLectureLive(lecture: AttendanceLecture, now: number): boolean {
  const start = Date.parse(lecture.startsAt || '');
  const end = Date.parse(lecture.endsAt || '');
  return Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end;
}

export function lectureJoinUrl(lecture: AttendanceLecture): string | null {
  try {
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
      const next = lectures.flatMap(lecture => [Date.parse(lecture.startsAt || ''), Date.parse(lecture.endsAt || '')])
        .filter(boundary => boundary > current);
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
