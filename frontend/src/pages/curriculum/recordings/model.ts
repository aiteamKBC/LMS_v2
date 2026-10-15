import type { LibraryRecording, RecordingsAttention, RecordingsDelivery, RecordingsLibrary } from '@/api/sessionResults';
import type { Lecture, Recording, RecordingStatus } from './types';
import { TIME_ZONE_LABEL } from './utils';

const localParts = new Map<string, Intl.DateTimeFormat>();

function dateTime(instant: string | null, timeZone: string) {
  if (!instant || Number.isNaN(Date.parse(instant))) return null;
  let formatter = localParts.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    localParts.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(instant));
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` };
}

function recordingStatus(recording: LibraryRecording): RecordingStatus {
  return recording.state === 'ready' ? 'ready' : recording.state === 'failed' ? 'archiveFailed' : 'pending';
}

function attentionStatus(attention: RecordingsAttention): RecordingStatus {
  return attention.status === 'notRecorded' ? 'missing' : attention.status === 'missingSync' ? 'unsynced' : 'pending';
}

function fileItem(recording: LibraryRecording, index: number, total: number): Recording {
  const duration = recording.recordedAt && recording.endsAt
    ? Math.round((Date.parse(recording.endsAt) - Date.parse(recording.recordedAt)) / 60000) : 0;
  const note = recording.state === 'failed'
    ? 'The recording was found, but saving its archive copy failed. Request a results synchronization from the module Sessions tab.'
    : recording.state === 'pending'
      ? 'A saved archive copy has not been confirmed yet. Request a results synchronization if this persists.'
      : recording.hiddenFromLearners ? 'Hidden from learners.' : undefined;
  const placementNote = recording.placementReview
    ? 'This Teams recording was made outside the saved lecture time. Check the Teams run before assigning it to that lecture.'
    : undefined;
  return {
    id: recording.id,
    label: total > 1 ? `Recording ${index + 1}` : 'Recording',
    status: recordingStatus(recording),
    durationLabel: duration > 0 ? `${duration} min` : undefined,
    note: [placementNote, note,
      recording.duplicateCount > 0
        ? `${recording.duplicateCount} identical ${recording.duplicateCount === 1 ? 'copy' : 'copies'} also stored.`
        : undefined].filter(Boolean).join(' ') || undefined,
    source: recording,
  };
}

function fallbackTitle(delivery: RecordingsDelivery) {
  return delivery.title;
}

function teamsJoinUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'teams.microsoft.com' ? url.href : undefined;
  } catch { return undefined; }
}

export function buildCalendarLectures(library: RecordingsLibrary, timeZone = TIME_ZONE_LABEL): { lectures: Lecture[]; undated: { recording: LibraryRecording; archived: boolean; programmeActive: boolean }[] } {
  const lectures = new Map<string, Lecture>();
  const undated: { recording: LibraryRecording; archived: boolean; programmeActive: boolean }[] = [];
  const deliveries = new Map(library.deliveries.map(item => [item.moduleId, item]));

  for (const session of library.sessions ?? []) {
    const start = dateTime(session.startsAt, timeZone);
    if (!start) continue;
    const end = dateTime(session.endsAt, timeZone);
    const delivery = deliveries.get(session.moduleId);
    const now = Date.now();
    const starts = session.startsAt ? Date.parse(session.startsAt) : 0;
    const ends = session.endsAt ? Date.parse(session.endsAt) : starts;
    const status: RecordingStatus = session.source === 'authored' || session.status === 'planned' ? 'planned'
      : session.status === 'cancelled' ? 'cancelled'
      : starts > now ? 'upcoming'
        : ends > now ? 'inProgress'
          : session.attentionStatus === 'notRecorded' ? 'missing'
            : session.attentionStatus === 'missingSync' ? 'unsynced'
              : session.attentionStatus === 'verificationRequired' ? 'pending' : 'unavailable';
    lectures.set(`${session.moduleId}:${session.occurrenceId}`, {
      id: `${session.moduleId}:${session.occurrenceId}`, moduleId: session.moduleId,
      title: session.title || session.moduleTitle,
      date: start.date, startTime: start.time, endTime: end?.time ?? start.time,
      programme: session.programme, cohort: session.cohort, group: session.group,
      module: session.moduleTitle, week: session.weekNumber, weekTitle: session.weekTitle,
      archived: session.archived ?? delivery?.archived ?? false, programmeActive: session.programmeActive,
      joinUrl: ['cancelled', 'planned'].includes(status) ? undefined : teamsJoinUrl(session.joinUrl),
      source: session.source,
      status, statusReason: session.attentionReason || undefined, recordings: [],
    });
  }

  for (const delivery of library.deliveries) {
    for (const week of delivery.weeks) {
      for (const recording of week.recordings) {
        if (recording.placementReview) {
          const actual = dateTime(recording.recordedAt, timeZone);
          if (!actual) { undated.push({ recording, archived: delivery.archived, programmeActive: delivery.programmeActive }); continue; }
          const key = `recording-review:${delivery.moduleId}:${actual.date}`;
          let review = lectures.get(key);
          if (!review) {
            review = {
              id: key, moduleId: delivery.moduleId,
              title: `${delivery.title} — recording to review`,
              date: actual.date, startTime: actual.time,
              endTime: dateTime(recording.endsAt, timeZone)?.time ?? actual.time,
              programme: delivery.programme, cohort: delivery.cohort, group: delivery.group,
              module: delivery.title, week: null, weekTitle: '',
              archived: delivery.archived, programmeActive: delivery.programmeActive,
              source: 'recording-review', status: 'review',
              statusReason: 'Teams saved this file, but its run does not confirm the LMS lecture date. Review the meeting before filing it under a week.',
              recordings: [],
            };
            lectures.set(key, review);
          }
          review.recordings.push(fileItem(recording, review.recordings.length, 1));
          continue;
        }
        const start = dateTime(recording.startsAt ?? recording.recordedAt, timeZone);
        if (!start) { undated.push({ recording, archived: delivery.archived, programmeActive: delivery.programmeActive }); continue; }
        const key = `${delivery.moduleId}:${recording.occurrenceId ?? `${recording.seriesId}:${recording.sessionNumber ?? recording.id}`}`;
        let lecture = lectures.get(key);
        if (!lecture) {
          lecture = {
            id: key, moduleId: delivery.moduleId,
            title: fallbackTitle(delivery),
            date: start.date, startTime: start.time,
            endTime: dateTime(recording.endsAt, timeZone)?.time ?? start.time,
            programme: delivery.programme, cohort: delivery.cohort, group: delivery.group,
            module: delivery.title, week: week.weekNumber, weekTitle: week.title,
            archived: delivery.archived, programmeActive: delivery.programmeActive,
            status: recordingStatus(recording), recordings: [],
          };
          lectures.set(key, lecture);
        }
        lecture.recordings.push(fileItem(recording, lecture.recordings.length, 1));
        lecture.status = lecture.recordings.every(item => item.status === 'ready') ? 'ready'
          : lecture.recordings.some(item => item.status === 'archiveFailed') ? 'archiveFailed' : 'pending';
      }
    }
    for (const attention of delivery.attention) {
      const start = dateTime(attention.startsAt, timeZone);
      if (!start) continue;
      const key = `${delivery.moduleId}:${attention.occurrenceId}`;
      let lecture = lectures.get(key);
      if (!lecture) {
        lecture = {
          id: key, moduleId: delivery.moduleId,
          title: fallbackTitle(delivery),
          date: start.date, startTime: start.time, endTime: start.time,
          programme: delivery.programme, cohort: delivery.cohort, group: delivery.group,
          module: delivery.title, week: attention.weekNumber, weekTitle: attention.weekTitle,
          archived: delivery.archived, programmeActive: delivery.programmeActive,
          status: attentionStatus(attention), recordings: [],
        };
        lectures.set(key, lecture);
      }
      if (!lecture.recordings.length && !['upcoming', 'inProgress', 'cancelled'].includes(lecture.status)) {
        lecture.status = attentionStatus(attention);
        lecture.statusReason = attention.reason;
      }
    }
  }

  for (const lecture of lectures.values()) {
    lecture.recordings.forEach((recording, index) => {
      recording.label = lecture.recordings.length > 1 ? `Recording ${index + 1}` : 'Recording';
    });
  }
  return { lectures: [...lectures.values()].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)), undated };
}
