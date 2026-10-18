import { describe, expect, it } from 'vitest';
import { formatHoursClock } from './hoursClock';

describe('OTJH clock display', () => {
  it('renders decimal hours as zero-padded hours, minutes and seconds', () => {
    expect(formatHoursClock((1 * 3600 + 22 * 60 + 32) / 3600)).toBe('01:22:32');
    expect(formatHoursClock(23 / 3600)).toBe('00:00:23');
    expect(formatHoursClock((26 * 60 + 23) / 3600)).toBe('00:26:23');
    expect(formatHoursClock(3617 / 3600)).toBe('01:00:17');
    expect(formatHoursClock(0)).toBe('00:00:00');
  });

  it('lets hours grow past two digits for programme totals', () => {
    expect(formatHoursClock(175)).toBe('175:00:00');
    expect(formatHoursClock(1400)).toBe('1400:00:00');
  });

  it('absorbs floating-point drift from summed seconds', () => {
    const summed = [3617, 1800, 23].reduce((total, seconds) => total + seconds / 3600, 0);
    expect(formatHoursClock(summed)).toBe('01:30:40');
  });

  it('keeps the sign of a negative value and leaves missing values empty', () => {
    expect(formatHoursClock(-1.25)).toBe('-01:15:00');
    expect(formatHoursClock(null)).toBe('--');
    expect(formatHoursClock(Number.NaN)).toBe('--');
  });
});
