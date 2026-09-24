import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALENDAR_COLORS,
  getCalendarStatusKey,
  getMeetingTypeKey,
  mergeCalendarColors,
} from '../calendarColors';

describe('coach calendar color configuration', () => {
  it('keeps meeting type colors independent from RAG status colors', () => {
    expect(DEFAULT_CALENDAR_COLORS.meetingTypes['monthly-coaching']).toEqual({ accent: '#2563EB', background: '#EFF6FF' });
    expect(DEFAULT_CALENDAR_COLORS.statuses['missed-overdue']).toEqual({ accent: '#DC2626', background: '#FEF2F2' });
  });

  it('resolves curriculum review types before their legacy routing source', () => {
    expect(getMeetingTypeKey({ source: 'mcr', reviewTypeName: 'Gateway Review' })).toBe('gateway-review');
    expect(getMeetingTypeKey({ source: 'review', reviewTypeName: 'Personal Support Plan' })).toBe('personal-support-plan');
    expect(getMeetingTypeKey({ source: 'mcr', reviewTypeName: 'Monthly Coaching Meeting' })).toBe('monthly-coaching');
  });

  it('uses authoritative overdue and due-soon signals without inferring from a date here', () => {
    expect(getCalendarStatusKey('pending', true, false)).toBe('missed-overdue');
    expect(getCalendarStatusKey('pending', false, true)).toBe('pending-due-soon');
    expect(getCalendarStatusKey('scheduled', true, true)).toBe('scheduled');
  });

  it('merges valid saved colors while retaining safe defaults for invalid values', () => {
    const merged = mergeCalendarColors({
      meetingTypes: { 'monthly-coaching': { accent: '#123456', background: '#FFFFFF' } },
      statuses: { completed: { accent: 'red', background: '#FFFFFF' } },
    });
    expect(merged.meetingTypes['monthly-coaching']).toEqual({ accent: '#123456', background: '#FFFFFF' });
    expect(merged.statuses.completed).toEqual(DEFAULT_CALENDAR_COLORS.statuses.completed);
  });
});
