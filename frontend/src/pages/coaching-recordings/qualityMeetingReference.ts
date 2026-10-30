import { loadLinkedCoachingMeeting } from '@/api/coachingRecordings';
import { QualityReviewError } from '@/api/coachingQualityReviews';
import { meetingDate } from './model';

interface QualityMeetingOccurrence {
  id: string; startsAt: string; endsAt: string; timeZone: string;
}

export function createQualityMeetingReference(reference?: string, occurrence?: QualityMeetingOccurrence) {
  let current = reference;
  return async function withReference<T>(send: (reference?: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
    try {
      return await send(current);
    } catch (error) {
      if (!(error instanceof QualityReviewError) || error.status !== 400 || error.code !== 'invalid_calendar_reference'
        || !current || !occurrence) throw error;

      // Resolve the same occurrence through current server-side access checks.
      // Keep the renewed token outside React state so a save cannot reset answers.
      const { meeting } = await loadLinkedCoachingMeeting(occurrence.id, meetingDate(occurrence.startsAt, occurrence.timeZone), occurrence.timeZone, signal, true);
      if (meeting.meetingId !== occurrence.id || !meeting.recordingsReference
        || Date.parse(meeting.startsAt) !== Date.parse(occurrence.startsAt)
        || Date.parse(meeting.endsAt) !== Date.parse(occurrence.endsAt)) {
        throw new Error('This meeting has changed. Your answers are still here; check the current meeting before saving.');
      }
      current = meeting.recordingsReference;
      // One retry only, with the original form, version and idempotency key.
      return send(current);
    }
  };
}
