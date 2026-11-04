import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLinkedCoachingMeeting, type LinkedCoachingMeeting } from '@/api/coachingRecordings';
import { prepareRecordingPlayback } from './recordingPlayback';

vi.mock('@/api/coachingRecordings', async () => ({
  ...await vi.importActual<typeof import('@/api/coachingRecordings')>('@/api/coachingRecordings'),
  loadLinkedCoachingMeeting: vi.fn(),
}));
const occurrence = { id: 'a'.repeat(32), startsAt: '2026-11-02T23:30:00Z', endsAt: '2026-11-03T00:30:00Z', timeZone: 'Africa/Cairo' };
const input = { eventKey: 'coach-calendar:synthetic', recordingId: 'file/one+', reference: 'expired-reference', occurrence };
const linked = (): LinkedCoachingMeeting => ({ meeting: { meetingId: occurrence.id, startsAt: occurrence.startsAt,
  endsAt: occurrence.endsAt, recordingsReference: 'renewed-reference',
  media: { recordings: [{ id: input.recordingId, state: 'ready' }] } } } as LinkedCoachingMeeting);
const mp4 = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  request = vi.fn().mockResolvedValue(new Response(mp4, { status: 206, headers: { 'Content-Type': 'video/mp4' } }));
  vi.stubGlobal('fetch', request);
  vi.mocked(loadLinkedCoachingMeeting).mockResolvedValue(linked());
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('recording playback preparation', () => {
  it('renews the same occurrence with current access checks and probes only a small range', async () => {
    const result = await prepareRecordingPlayback(input, new AbortController().signal);
    expect(loadLinkedCoachingMeeting).toHaveBeenCalledWith(occurrence.id, '2026-11-03', 'Africa/Cairo', expect.any(AbortSignal), true);
    const params = new URL(result.url, 'http://localhost').searchParams;
    expect(params.get('reference')).toBe('renewed-reference');
    expect(params.get('eventKey')).toBe(input.eventKey);
    expect(params.get('recordingId')).toBe(input.recordingId);
    expect(params.get('preview')).toBe('1');
    expect(request).toHaveBeenCalledWith(result.url, expect.objectContaining({ credentials: 'include', cache: 'no-store', headers: { Range: 'bytes=0-63' } }));
  });
  it.each(['identity', 'time', 'file'] as const)('refuses a changed %s without reading video', async change => {
    const value = linked();
    if (change === 'identity') value.meeting.meetingId = 'b'.repeat(32);
    if (change === 'time') value.meeting.startsAt = '2026-11-04T10:00:00Z';
    if (change === 'file') value.meeting.media.recordings = [];
    vi.mocked(loadLinkedCoachingMeeting).mockResolvedValue(value);
    await expect(prepareRecordingPlayback(input, new AbortController().signal)).rejects.toThrow(/changed|no longer available/);
    expect(request).not.toHaveBeenCalled();
  });
  it('retains the legacy booking path without inventing a calendar reference', async () => {
    const value = await prepareRecordingPlayback({ eventKey: 'mcr:synthetic', recordingId: 'file' }, new AbortController().signal);
    expect(loadLinkedCoachingMeeting).not.toHaveBeenCalled();
    expect(new URL(value.url, 'http://localhost').searchParams.has('reference')).toBe(false);
  });
  it.each([[401, 'Sign in again'], [403, 'no longer have access'], [409, 'could not be verified'], [503, 'temporarily unavailable']])('reports HTTP %s without treating it as video', async (status, message) => {
    request.mockResolvedValue(new Response('{}', { status: Number(status), headers: { 'Content-Type': 'application/json' } }));
    await expect(prepareRecordingPlayback(input, new AbortController().signal)).rejects.toThrow(String(message));
    expect(request).toHaveBeenCalledOnce();
  });
  it('cancels the probe even when the provider ignores Range and leaves a full video stream open', async () => {
    const cancel = vi.fn();
    request.mockResolvedValue(new Response(new ReadableStream({ start(c) { c.enqueue(mp4); }, cancel }), {
      status: 200, headers: { 'Content-Type': 'video/mp4' },
    }));
    await prepareRecordingPlayback(input, new AbortController().signal);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(['text/html', 'application/json'])('rejects a successful %s page instead of mounting a broken video', async type => {
    request.mockResolvedValue(new Response('<html>sign in</html>', { headers: { 'Content-Type': type } }));
    await expect(prepareRecordingPlayback(input, new AbortController().signal)).rejects.toThrow('page instead of video');
  });
  it('rejects non-MP4 bytes', async () => {
    request.mockResolvedValue(new Response('not a video file', { headers: { 'Content-Type': 'video/mp4' } }));
    await expect(prepareRecordingPlayback(input, new AbortController().signal)).rejects.toThrow('playable MP4');
  });
  it('makes no request after cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(prepareRecordingPlayback(input, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadLinkedCoachingMeeting).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it('bounds a stalled video request', async () => {
    vi.useFakeTimers();
    request.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const result = expect(prepareRecordingPlayback(input, new AbortController().signal)).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(45000);
    await result;
  });
});
