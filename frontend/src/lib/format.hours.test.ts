import { describe, expect, it } from 'vitest';
import { formatHoursMinutes, formatHoursRatio } from './format';

describe('OTJH hours display', () => {
  it('renders decimal hours as hours and minutes', () => {
    expect(formatHoursMinutes(21.58)).toBe('21h 35m');
    expect(formatHoursMinutes(1.5)).toBe('1h 30m');
    expect(formatHoursMinutes(0.5)).toBe('30m');
    expect(formatHoursMinutes(16)).toBe('16h');
  });

  it('formats negative gaps and hour ratios without decimal hours', () => {
    expect(formatHoursMinutes(-1.25)).toBe('-1h 15m');
    expect(formatHoursRatio(1.5, 2.25)).toBe('1h 30m / 2h 15m');
  });
});
