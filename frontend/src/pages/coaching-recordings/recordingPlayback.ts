import { coachingRecordingUrl, loadLinkedCoachingMeeting } from '@/api/coachingRecordings';
import { meetingDate } from './model';

export interface RecordingOccurrence {
  id: string; startsAt: string; endsAt: string; timeZone: string;
}

interface PlaybackRequest {
  eventKey: string; recordingId: string; reference?: string; occurrence?: RecordingOccurrence;
}

export async function prepareRecordingPlayback(input: PlaybackRequest, signal: AbortSignal) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const timer = setTimeout(cancel, 45000);
  try {
    controller.signal.throwIfAborted();
    let reference = input.reference;
    if (reference && input.occurrence) {
      const occurrence = input.occurrence;
      // The drawer can outlive its one-hour signed reference. Renew through the
      // existing authorised lookup, never by extending or decoding that token.
      const { meeting } = await loadLinkedCoachingMeeting(occurrence.id,
        meetingDate(occurrence.startsAt, occurrence.timeZone), occurrence.timeZone, controller.signal, true);
      if (meeting.meetingId !== occurrence.id || !meeting.recordingsReference
        || Date.parse(meeting.startsAt) !== Date.parse(occurrence.startsAt)
        || Date.parse(meeting.endsAt) !== Date.parse(occurrence.endsAt)) {
        throw new Error('This meeting has changed. Reopen its current calendar entry before playing the recording.');
      }
      if (!meeting.media.recordings.some(file => file.id === input.recordingId && file.state === 'ready')) {
        throw new Error('This recording is no longer available for this meeting. Refresh its details.');
      }
      reference = meeting.recordingsReference;
    }
    controller.signal.throwIfAborted();
    const url = coachingRecordingUrl(input.eventKey, input.recordingId, true, reference);
    // A native video error hides the HTTP response. Check a bounded range first;
    // Range also keeps this request outside the JSON GET-batching transport.
    const response = await fetch(url, { credentials: 'include', cache: 'no-store',
      headers: { Range: 'bytes=0-63' }, signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { code?: string } | null;
      if (response.status === 401) throw new Error('Your session has expired. Sign in again to play this recording.');
      if (response.status === 403) throw new Error('You no longer have access to this recording.');
      if (body?.code === 'invalid_calendar_reference') throw new Error('Refresh the calendar and reopen this meeting to renew its recording link.');
      if (response.status === 404 || response.status === 409) throw new Error('This recording could not be verified for this meeting. Refresh its details.');
      throw new Error('The recording service is temporarily unavailable. Retry playback.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('The recording service returned no video. Retry playback.');
    try {
      if (!['video/mp4', 'application/octet-stream'].includes((response.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase())) {
        throw new Error('The recording service returned a page instead of video. Sign in again and retry playback.');
      }
      const prefix: number[] = [];
      while (prefix.length < 12) {
        const chunk = await reader.read();
        if (chunk.done) break;
        prefix.push(...chunk.value.subarray(0, 12 - prefix.length));
      }
      if (prefix.length < 12 || String.fromCharCode(...prefix.slice(4, 8)) !== 'ftyp') {
        throw new Error('The recording service did not return playable MP4 content. Retry playback.');
      }
    } finally {
      await reader.cancel().catch(() => { /* The transport may already be aborted. */ });
    }
    controller.signal.throwIfAborted();
    return { url, reference };
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted) throw new Error('Preparing the recording took too long. Retry playback.');
    if (error instanceof TypeError) throw new Error('The recording service could not be reached. Retry playback.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}
