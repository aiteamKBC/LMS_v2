import { describe, expect, it } from 'vitest';
import { componentAccessWindow } from './componentAccessWindow';

describe('learner component access window', () => {
  it('requires a declaration during a weekday bank holiday and every day of a manual closure', () => {
    const holidays = [{ start: '2026-12-25', end: '2026-12-25' }, { start: '2026-12-28', end: '2026-12-31' }];
    for (const day of [25, 28, 29, 31]) {
      expect(componentAccessWindow(new Date(`2026-12-${day}T12:00:00Z`), holidays))
        .toMatchObject({ open: true, outsideWorkingHours: true, outsideReason: 'holiday' });
    }
    expect(componentAccessWindow(new Date('2027-01-01T12:00:00Z'), holidays).outsideWorkingHours).toBe(false);
  });

  it('compares holiday dates in London, including the BST midnight boundary', () => {
    const holidays = [{ start: '2026-07-15', end: '2026-07-15' }];
    expect(componentAccessWindow(new Date('2026-07-14T23:00:00Z'), holidays).outsideReason).toBe('holiday');
    expect(componentAccessWindow(new Date('2026-07-15T23:00:00Z'), holidays).outsideReason).toBe('outside-hours');
  });
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
