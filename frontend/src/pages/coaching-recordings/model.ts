import type { CoachingCalendar, CoachingMeeting, CoachingMedia, RecordingState } from '@/api/coachingRecordings';

export function initialChecksPending(sync: CoachingCalendar['sync']): boolean {
  if (!sync) return false;
  // Older API versions do not distinguish initial discovery from maintenance.
  if (sync.initialPendingCalendars === undefined || sync.initialPendingEvidence === undefined) return sync.pending;
  return sync.initialPendingCalendars > 0 || sync.initialPendingEvidence > 0;
}

export const meetingKey = (row: CoachingMeeting) => `${row.coachEmail}:${row.calendarEventId}:${row.startsAt}`;
export const meetingTitle = (row: CoachingMeeting) => row.title || (row.family === 'MCM' ? 'Monthly Coaching Meeting' : row.family === 'PR' ? 'Progress Review' : row.family === 'SUPPORT' ? 'Student Support' : 'Untitled meeting');
export const meetingCategory = (row: CoachingMeeting) => row.category ?? row.family ?? 'OTHER';
export const categoryLabels = { MCM: 'MCM', PR: 'PR (Progress Review)', SUPPORT: 'Student Support', OTHER: 'Other', LECTURE: 'Lecture / subject' };

export const recordingLabels: Record<RecordingState, string> = {
  ready: 'Recording available', pending: 'Recording check pending', failed: 'Recording check failed',
  missing: 'Saved recording missing or incomplete', unavailable: 'Recording availability could not be checked', unlinked: 'Session match needs review',
};

export function recordingLabel(media: CoachingMedia): string {
  if (media.readyCount > 0) return recordingLabels.ready;
  if (media.check?.state === 'failed') return recordingLabels.failed;
  if (media.check?.state === 'complete' && !media.recordings.length) {
    return media.check.reason === 'no-teams-link' ? 'No Teams link on this calendar entry' : 'No recording returned at last check';
  }
  return recordingLabels[media.state];
}

export function hiddenReadyReasons(meetings: CoachingMeeting[], now: number): [string, number][] {
  const counts = new Map<string, number>();
  for (const row of meetings) {
    const phase = meetingPhase(row, now);
    if (phase === 'ended' || hasPlayableRecording(row, now)) continue;
    const label = phase === 'cancelled' ? 'Cancelled' : 'Upcoming / within scheduled time';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts];
}

export function calendarErrorLabel(code: string) {
  const labels: Record<string, string> = {
    calendar_mailbox_unavailable: 'Microsoft reports no calendar mailbox available through its API. Check this coach account and mailbox setup.',
    calendar_not_found: 'Microsoft could not find a calendar for this coach account. Check the saved coach email and Microsoft account.',
    calendar_request_rejected: 'Microsoft could not read this calendar. Check the saved coach account and calendar setup.',
    calendar_access_denied: 'Microsoft denied calendar access. An administrator needs to check the app access for this mailbox.',
    calendar_throttled: 'Microsoft temporarily limited calendar requests. Wait before retrying.',
    calendar_timeout: 'The calendar took too long to respond. Retry or choose one coach.',
    calendar_incomplete: 'Some calendar entries need review.',
    recordings_incomplete: 'Some saved recordings could not be verified. Refresh to check again.',
  };
  return labels[code] ?? 'Calendar unavailable. Retry to check again.';
}

export type MeetingFilter = 'ready' | 'attention' | 'ended' | 'upcoming' | 'in-progress' | 'cancelled' | 'all';
export type MatchFilter = 'all' | 'matched' | 'review';
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
export function meetingDate(startsAt: string, timeZone: string) {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    if (dateFormatters.size >= 8) dateFormatters.clear();
    dateFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(startsAt));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function meetingPhase(meeting: CoachingMeeting, now: number): CoachingMeeting['phase'] {
  if (meeting.phase === 'cancelled') return 'cancelled';
  if (Date.parse(meeting.endsAt) <= now) return 'ended';
  return Date.parse(meeting.startsAt) > now ? 'upcoming' : 'in-progress';
}
export function hasPlayableRecording(meeting: CoachingMeeting, now: number): boolean {
  const phase = meetingPhase(meeting, now);
  return phase !== 'upcoming' && phase !== 'cancelled' && meeting.media.readyCount > 0;
}
export function filterMeetings(meetings: CoachingMeeting[], phase: MeetingFilter, match: MatchFilter, family: string, now: number) {
  return meetings.filter(row => (phase === 'all'
    || (phase === 'ready' ? meetingPhase(row, now) === 'ended' || hasPlayableRecording(row, now)
      : phase === 'attention' ? meetingPhase(row, now) !== 'cancelled' && (row.match !== 'matched' || (meetingPhase(row, now) === 'ended' && !row.media.readyCount))
        : phase === 'cancelled' ? meetingPhase(row, now) === 'cancelled' || Boolean(row.cancellationSources?.length) : meetingPhase(row, now) === phase))
    && (match === 'all' || (match === 'matched' ? row.match === 'matched' : row.match !== 'matched'))
    && (family === 'all' || meetingCategory(row) === family))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.coachEmail.localeCompare(b.coachEmail));
}
