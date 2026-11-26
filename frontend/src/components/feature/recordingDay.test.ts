import { describe, expect, it } from 'vitest';
import { recordingDay } from './recordingDay';

describe('recordingDay', () => {
  it('uses the UK calendar day across daylight saving and midnight', () => {
    expect(recordingDay('2026-10-02T23:30:00Z')).toBe('2026-10-03');
    expect(recordingDay('2026-10-02T23:30:00')).toBe('2026-10-03');
    expect(recordingDay('2026-10-29T23:30:00Z')).toBe('2026-10-29');
    expect(recordingDay(null)).toBeNull();
  });
});
