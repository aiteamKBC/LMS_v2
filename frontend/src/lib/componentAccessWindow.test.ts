import { describe, expect, it } from 'vitest';
import { componentAccessWindow } from './componentAccessWindow';

describe('learner component access window', () => {
  it('stays open while identifying weekday UK out-of-hours access', () => {
    expect(componentAccessWindow(new Date('2026-01-15T06:59:00Z'))).toMatchObject({ open: true, outsideWorkingHours: true, outsideReason: 'outside-hours' });
    expect(componentAccessWindow(new Date('2026-01-15T07:00:00Z'))).toMatchObject({ open: true, outsideWorkingHours: false, outsideReason: null });
    expect(componentAccessWindow(new Date('2026-01-15T18:59:00Z'))).toMatchObject({ open: true, outsideWorkingHours: false, outsideReason: null });
    expect(componentAccessWindow(new Date('2026-01-15T19:00:00Z'))).toMatchObject({ open: true, outsideWorkingHours: true, outsideReason: 'outside-hours' });
  });

  it('stays open but identifies Saturday and Sunday as out of hours', () => {
    const saturday = componentAccessWindow(new Date('2026-01-17T10:00:00Z'));
    const sunday = componentAccessWindow(new Date('2026-07-19T10:00:00Z'));

    expect(saturday.open).toBe(true);
    expect(saturday.closedReason).toBeNull();
    expect(saturday.outsideReason).toBe('weekend');
    expect(sunday.open).toBe(true);
    expect(sunday.closedReason).toBeNull();
    expect(sunday.outsideReason).toBe('weekend');
  });

  it('uses BST automatically for the summer boundary', () => {
    expect(componentAccessWindow(new Date('2026-07-15T05:59:00Z')).outsideWorkingHours).toBe(true);
    expect(componentAccessWindow(new Date('2026-07-15T06:00:00Z')).outsideWorkingHours).toBe(false);
    expect(componentAccessWindow(new Date('2026-07-15T18:00:00Z')).outsideWorkingHours).toBe(true);
  });

  it('rejects only an invalid timestamp', () => {
    const invalid = componentAccessWindow(new Date('invalid'));
    expect(invalid.open).toBe(false);
    expect(invalid.closedReason).toBe('invalid');
  });
});
