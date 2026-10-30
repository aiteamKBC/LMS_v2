import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLinkedCoachingMeeting, type LinkedCoachingMeeting } from '@/api/coachingRecordings';
import { QualityReviewError } from '@/api/coachingQualityReviews';
import { createQualityMeetingReference } from './qualityMeetingReference';

vi.mock('@/api/coachingRecordings', () => ({ loadLinkedCoachingMeeting: vi.fn() }));
const occurrence = { id: 'a'.repeat(32), startsAt: '2026-10-24T23:30:00Z', endsAt: '2026-10-25T00:30:00Z', timeZone: 'Europe/London' };
const renewed = () => ({ meeting: { meetingId: occurrence.id, startsAt: occurrence.startsAt, endsAt: occurrence.endsAt, recordingsReference: 'renewed' } }) as LinkedCoachingMeeting;
const expired = () => new QualityReviewError('Refresh the calendar to renew this meeting reference.', 400, 'invalid_calendar_reference');

describe('Quality meeting reference renewal', () => {
  beforeEach(() => vi.mocked(loadLinkedCoachingMeeting).mockReset().mockResolvedValue(renewed()));

  it('renews through the saved meeting using the business date and remembers the token', async () => {
    const send = vi.fn().mockRejectedValueOnce(expired()).mockResolvedValue('saved');
    const withReference = createQualityMeetingReference('expired', occurrence);
    const signal = new AbortController().signal;
    expect(await withReference(send, signal)).toBe('saved');
    expect(loadLinkedCoachingMeeting).toHaveBeenCalledWith(occurrence.id, '2026-10-25', 'Europe/London', signal, true);
    expect(send.mock.calls).toEqual([['expired'], ['renewed']]);
    await withReference(send);
    expect(send).toHaveBeenLastCalledWith('renewed');
    expect(loadLinkedCoachingMeeting).toHaveBeenCalledOnce();
  });

  it('accepts the same instants expressed with different UTC offsets', async () => {
    const value = renewed(); value.meeting.startsAt = '2026-10-25T00:30:00+01:00';
    vi.mocked(loadLinkedCoachingMeeting).mockResolvedValue(value);
    const send = vi.fn().mockRejectedValueOnce(expired()).mockResolvedValue('saved');
    await expect(createQualityMeetingReference('expired', occurrence)(send)).resolves.toBe('saved');
  });

  it.each([
    { meetingId: 'b'.repeat(32) }, { startsAt: '2026-10-25T23:30:00Z' },
    { endsAt: '2026-10-25T01:30:00Z' }, { recordingsReference: undefined },
  ])('does not save against a changed occurrence: %j', async change => {
    const value = renewed(); Object.assign(value.meeting, change);
    vi.mocked(loadLinkedCoachingMeeting).mockResolvedValue(value);
    const send = vi.fn().mockRejectedValueOnce(expired());
    await expect(createQualityMeetingReference('expired', occurrence)(send)).rejects.toThrow('Your answers are still here');
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([
    new QualityReviewError('Access denied', 403, 'forbidden'),
    new QualityReviewError('Version conflict', 409, 'review_conflict'),
    new QualityReviewError('Invalid form', 400, 'invalid_review'),
    new QualityReviewError('Unavailable', 503), new Error('Network failed'),
  ])('preserves other errors without retrying: %s', async error => {
    const send = vi.fn().mockRejectedValue(error);
    await expect(createQualityMeetingReference('signed', occurrence)(send)).rejects.toBe(error);
    expect(send).toHaveBeenCalledOnce(); expect(loadLinkedCoachingMeeting).not.toHaveBeenCalled();
  });

  it('limits each request to one renewal and does not loop after another invalid reference', async () => {
    const error = expired(), send = vi.fn().mockRejectedValue(error);
    await expect(createQualityMeetingReference('expired', occurrence)(send)).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(2); expect(loadLinkedCoachingMeeting).toHaveBeenCalledOnce();
  });

  it('propagates renewal failure and can retry it on the next explicit action', async () => {
    const failure = new Error('This meeting is unavailable');
    vi.mocked(loadLinkedCoachingMeeting).mockRejectedValueOnce(failure);
    const send = vi.fn().mockRejectedValueOnce(expired()).mockRejectedValueOnce(expired()).mockResolvedValue('saved');
    const withReference = createQualityMeetingReference('expired', occurrence);
    await expect(withReference(send)).rejects.toBe(failure);
    await expect(withReference(send)).resolves.toBe('saved');
    expect(send.mock.calls).toEqual([['expired'], ['expired'], ['renewed']]);
  });

  it('leaves legacy booking-only requests unchanged when no occurrence is available', async () => {
    const error = expired(), send = vi.fn().mockRejectedValue(error);
    await expect(createQualityMeetingReference('expired')(send)).rejects.toBe(error);
    await expect(createQualityMeetingReference(undefined, occurrence)(send)).rejects.toBe(error);
    expect(loadLinkedCoachingMeeting).not.toHaveBeenCalled();
  });
});
