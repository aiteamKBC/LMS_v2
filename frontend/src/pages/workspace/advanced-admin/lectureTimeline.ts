import type { AdvancedAdminAttendance, AdvancedAdminQuality } from '@/api/advancedAdmin';

export interface LectureWithQuality {
  attendance: AdvancedAdminAttendance;
  tutor: AdvancedAdminQuality[];
  lecture: AdvancedAdminQuality[];
}

export interface LectureDay {
  date: string;
  lectures: LectureWithQuality[];
  unmatched: AdvancedAdminQuality[];
}

function normalized(value: string | null | undefined) {
  return (value || '').trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
}

/** Keep date-only QA reports visible without assigning them to the wrong lecture. */
export function lectureTimeline(attendance: AdvancedAdminAttendance[], quality: AdvancedAdminQuality[]): LectureDay[] {
  const days = new Map<string, LectureDay>();
  const dayFor = (date: string) => {
    const key = date.slice(0, 10) || 'Undated';
    if (!days.has(key)) days.set(key, { date: key, lectures: [], unmatched: [] });
    return days.get(key)!;
  };
  for (const row of attendance) dayFor(row.date || '').lectures.push({ attendance: row, tutor: [], lecture: [] });
  for (const report of quality) {
    const day = dayFor(report.date || '');
    const byId = report.sessionId
      ? day.lectures.filter(item => item.attendance.sessionId && item.attendance.sessionId === report.sessionId)
      : [];
    const subject = normalized(report.subject);
    const byTitle = subject ? day.lectures.filter(item => [item.attendance.title, item.attendance.module]
      .some(value => normalized(value) === subject)) : [];
    const target = byId.length === 1 ? byId[0] : byTitle.length === 1 ? byTitle[0]
      : day.lectures.length === 1 ? day.lectures[0] : null;
    if (target) target[report.source].push(report);
    else day.unmatched.push(report);
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}
