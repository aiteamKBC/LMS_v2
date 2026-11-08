import type { QRLecture } from '@/api/qrAttendance';

export function lectureSchedule(lecture: QRLecture, timeZone: string) {
  const date = new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium' }).format(new Date(lecture.startsAt));
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  return { date, time: `${time.format(new Date(lecture.startsAt))}${lecture.endsAt ? ` – ${time.format(new Date(lecture.endsAt))}` : ''}` };
}

export function lectureDate(lecture: QRLecture, timeZone: string) {
  const schedule = lectureSchedule(lecture, timeZone);
  return `${schedule.date} · ${schedule.time}`;
}
