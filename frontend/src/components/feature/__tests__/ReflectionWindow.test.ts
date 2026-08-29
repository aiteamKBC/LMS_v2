import { describe, expect, it } from 'vitest';
import { formatClock, formatRecordedClock } from '../ReflectionWindow';

describe('formatClock', () => {
  it.each([
    [0, '00:00:00'],
    [21, '00:00:21'],
    [65, '00:01:05'],
    [3661, '01:01:01'],
    [360000, '100:00:00'],
  ])('formats %s seconds as hours, minutes and seconds', (seconds, expected) => {
    expect(formatClock(seconds)).toBe(expected);
  });

  it('keeps invalid or negative values safe', () => {
    expect(formatClock(-1)).toBe('00:00:00');
    expect(formatClock(Number.NaN)).toBe('00:00:00');
  });
});

describe('formatRecordedClock', () => {
  it.each([
    ['00:21', '00:00:21'],
    ['65:04', '01:05:04'],
    ['01:05:04', '01:05:04'],
  ])('normalises the stored value %s', (stored, expected) => {
    expect(formatRecordedClock(stored)).toBe(expected);
  });

  it('ignores a missing or malformed stored time', () => {
    expect(formatRecordedClock(null)).toBeNull();
    expect(formatRecordedClock('not-a-clock')).toBeNull();
    expect(formatRecordedClock('01:80:00')).toBeNull();
  });
});
