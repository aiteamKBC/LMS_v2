import { describe, expect, it } from 'vitest';
import { selectMeetingState, selectStableMeetingIdentity } from './meetingStateSelectors';

describe('meeting state contract', () => {
  it.each([
    ['not-scheduled', 'not-scheduled'],
    ['pending', 'not-scheduled'],
    ['scheduled', 'scheduled'],
    ['confirmed', 'confirmed'],
    ['in-progress', 'in-progress'],
    ['completed', 'completed'],
    ['awaiting-signature', 'other'],
    ['cancelled', 'other'],
  ] as const)('keeps %s distinct as %s', (status, bucket) => {
    expect(selectMeetingState(status)).toBe(bucket);
  });

  it('never treats confirmed as completed', () => {
    expect(selectMeetingState('confirmed')).not.toBe(selectMeetingState('completed'));
  });

  it('prefers the stable event key and falls back only to the event id', () => {
    expect(selectStableMeetingIdentity({ eventKey: 'mcr:42:1', id: 'row-1' })).toBe('mcr:42:1');
    expect(selectStableMeetingIdentity({ id: 'row-1' })).toBe('row-1');
  });
});

