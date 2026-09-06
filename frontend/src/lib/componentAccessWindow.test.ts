import { describe, expect, it } from 'vitest';
import {
  COMPONENT_ACCESS_END_HOUR,
  COMPONENT_ACCESS_START_HOUR,
  componentAccessWindow,
} from './componentAccessWindow';

describe('learner component access window', () => {
  it('is configured from 07:00 until 19:00 UK time', () => {
    expect(COMPONENT_ACCESS_START_HOUR).toBe(7);
    expect(COMPONENT_ACCESS_END_HOUR).toBe(19);
  });

  it('opens at 07:00 and closes exactly at 19:00 during GMT', () => {
    expect(componentAccessWindow(new Date('2026-01-15T06:59:00Z')).open).toBe(false);
    expect(componentAccessWindow(new Date('2026-01-15T07:00:00Z')).open).toBe(true);
    expect(componentAccessWindow(new Date('2026-01-15T18:59:00Z')).open).toBe(true);
    expect(componentAccessWindow(new Date('2026-01-15T19:00:00Z')).open).toBe(false);
  });

  it('uses BST automatically in summer', () => {
    // 06:00 UTC is 07:00 BST; 18:00 UTC is 19:00 BST.
    expect(componentAccessWindow(new Date('2026-07-15T05:59:00Z')).open).toBe(false);
    expect(componentAccessWindow(new Date('2026-07-15T06:00:00Z')).open).toBe(true);
    expect(componentAccessWindow(new Date('2026-07-15T18:00:00Z')).open).toBe(false);
  });

  it('stays closed throughout Saturday and Sunday in UK time', () => {
    const saturday = componentAccessWindow(new Date('2026-01-17T10:00:00Z'));
    const sunday = componentAccessWindow(new Date('2026-07-19T10:00:00Z'));

    expect(saturday.open).toBe(false);
    expect(saturday.closedReason).toBe('weekend');
    expect(sunday.open).toBe(false);
    expect(sunday.closedReason).toBe('weekend');
    expect(componentAccessWindow(new Date('2026-01-19T07:00:00Z')).open).toBe(true);
  });
});
