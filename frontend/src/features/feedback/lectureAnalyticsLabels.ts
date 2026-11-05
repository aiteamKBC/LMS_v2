import type { FeedbackAnalyticsLecture } from '@/api/feedback';

export function lectureAnalyticsLabel(lecture: FeedbackAnalyticsLecture) {
  const moment = new Date(lecture.startsAt);
  const date = Number.isNaN(moment.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(moment);
  return [lecture.sessionTitle || lecture.occurrenceKey || `Lecture ${lecture.deliveryId}`, date,
    lecture.groupName || lecture.cohortName, lecture.formTitle, `v${lecture.version}`, `#${lecture.deliveryId}`].filter(Boolean).join(' · ');
}
