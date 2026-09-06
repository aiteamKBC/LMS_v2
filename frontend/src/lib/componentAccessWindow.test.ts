import { describe, expect, it } from 'vitest';
import { componentAccessWindow } from './componentAccessWindow';

describe('learner component access window', () => {
  it('stays open before, during, and after the old weekday access hours', () => {
    expect(componentAccessWindow(new Date('2026-01-15T06:59:00Z')).open).toBe(true);
    expect(componentAccessWindow(new Date('2026-01-15T07:00:00Z')).open).toBe(true);
    expect(componentAccessWindow(new Date('2026-01-15T18:59:00Z')).open).toBe(true);
    expect(componentAccessWindow(new Date('2026-01-15T19:00:00Z')).open).toBe(true);
  });

  it('stays open throughout Saturday and Sunday', () => {
    const saturday = componentAccessWindow(new Date('2026-01-17T10:00:00Z'));
    const sunday = componentAccessWindow(new Date('2026-07-19T10:00:00Z'));

    expect(saturday.open).toBe(true);
    expect(saturday.closedReason).toBeNull();
    expect(sunday.open).toBe(true);
    expect(sunday.closedReason).toBeNull();
  });

  it('rejects only an invalid timestamp', () => {
    const invalid = componentAccessWindow(new Date('invalid'));
    expect(invalid.open).toBe(false);
    expect(invalid.closedReason).toBe('invalid');
  });
});
