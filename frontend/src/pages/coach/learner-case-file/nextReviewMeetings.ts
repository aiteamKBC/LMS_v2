import { formatSystemTimestamp } from '@/lib/format';
import type { CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import { caseFileReviewCategory } from './data';

/** Scheduled dates/times are LMS business wall times, not browser-local times. */
export function nextReviewMeetings(events: CoachCalendarEvent[], learnerId: string, now = new Date()) {
  const today = formatSystemTimestamp(now, { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-');
  const time = formatSystemTimestamp(now, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const upcoming = events.filter(event =>
    [event.learnerId, event.enrolmentId].some(id => String(id || '') === learnerId)
    && ['scheduled', 'confirmed'].includes(event.status)
    && /^\d{4}-\d{2}-\d{2}$/.test(event.scheduledDate || '')
    && /^\d{2}:\d{2}(?::\d{2})?$/.test(event.scheduledTime || '')
    && `${event.scheduledDate}T${event.scheduledTime?.padEnd(8, ':00')}` >= `${today}T${time}`,
  ).sort((a, b) => `${a.scheduledDate}T${a.scheduledTime}`.localeCompare(`${b.scheduledDate}T${b.scheduledTime}`));
  const label = (category: 'progress-review' | 'mcr') => {
    const event = upcoming.find(item => caseFileReviewCategory({
      source: item.source || 'review', reviewTypeName: item.reviewTypeName || '', reviewTypeCode: item.reviewTypeCode,
    }) === category);
    if (!event) return '--';
    const [year, month, day] = event.scheduledDate!.split('-').map(Number);
    const date = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
    return `${date} · ${event.scheduledTime!.slice(0, 5)}`;
  };
  return { pr: label('progress-review'), mcm: label('mcr') };
}
