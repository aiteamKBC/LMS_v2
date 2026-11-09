import type { QRLecture } from '@/api/qrAttendance';

export function attendanceDayMessage(lecture: QRLecture, timeZone: string, now: number): string {
  const start = Date.parse(lecture.startsAt);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return 'Attendance date is unavailable.';
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const day = (instant: number) => {
    const parts = formatter.formatToParts(instant);
    return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
  };
  const lectureDay = day(start);
  const today = day(now);
  if (lectureDay < today) return 'Attendance closed — lecture date has passed.';
  if (lectureDay > today) return 'Attendance opens on the lecture date.';
  return '';
}

export function lectureSchedule(lecture: QRLecture, timeZone: string) {
  const date = new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium' }).format(new Date(lecture.startsAt));
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  return { date, time: `${time.format(new Date(lecture.startsAt))}${lecture.endsAt ? ` – ${time.format(new Date(lecture.endsAt))}` : ''}` };
}

export function lectureDate(lecture: QRLecture, timeZone: string) {
  const schedule = lectureSchedule(lecture, timeZone);
  return `${schedule.date} · ${schedule.time}`;
}
