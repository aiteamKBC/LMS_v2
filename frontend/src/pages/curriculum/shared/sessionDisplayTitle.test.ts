import { describe, expect, it } from 'vitest';
import { componentSessionTitle, seriesSessionWeekTitle, sessionDisplayTitle } from './sessionDisplayTitle';

describe('curriculum session display titles', () => {
  const week = { id: 'W2', moduleId: 'M1', title: 'Pricing' };
  const component = { id: 'C1', weekId: 'W2', moduleId: 'M1', type: 'live-session', title: 'Price elasticity',
    settings: { teamsOccurrenceId: 'O7', liveSessionUrl: 'https://example.test/join' } };

  it('prefers the owning week even over a custom lecture title without mutating identity or settings', () => {
    const before = structuredClone(component);
    expect(componentSessionTitle(component, week)).toBe('Pricing (Live Teams Session)');
    expect(component).toEqual(before);
    expect(week.title).toBe('Pricing');
  });

  it('keeps recording and live-session types distinct', () => {
    expect(componentSessionTitle({ ...component, type: 'recording-placeholder' }, week)).toBe('Pricing (Recording Session)');
    expect(componentSessionTitle({ ...component, type: 'video' }, week)).toBe('Price elasticity');
  });

  it.each([undefined, { ...week, title: '  ' }, { ...week, id: 'W3' }, { ...week, moduleId: 'M2' }])(
    'keeps the current title when no unambiguous owning week is available', candidate => {
      expect(componentSessionTitle(component, candidate)).toBe('Price elasticity');
    },
  );

  it('keeps the current session title when a backend rejects an ambiguous link', () => {
    expect(sessionDisplayTitle('Live Teams Session 1', '', 'Recording Session')).toBe('Live Teams Session 1');
    expect(sessionDisplayTitle('Live Teams Session 1', ' Pricing ', 'Recording Session')).toBe('Pricing (Recording Session)');
  });

  it('names a planned row by its stored series/session identity instead of its row position', () => {
    const linked = { ...component, settings: { teamsLiveSessionId: 'S1', teamsSessionNumber: '7' } };
    const weeks = [{ ...week, components: [linked] },
      { ...week, id: 'W3', title: 'Other week', components: [{ ...linked, weekId: 'W3', settings: { teamsLiveSessionId: 'S1', teamsSessionNumber: '9' } }] }];
    expect(seriesSessionWeekTitle([...weeks].reverse(), 'M1', 'S1', 7)).toBe('Pricing');
    expect(seriesSessionWeekTitle(weeks, 'M2', 'S1', 7)).toBe('');
    expect(seriesSessionWeekTitle(weeks, 'M1', 'S2', 7)).toBe('');
    expect(seriesSessionWeekTitle([{ ...week, components: [linked, { ...linked, id: 'DUP' }] }], 'M1', 'S1', 7)).toBe('');
  });

  it('keeps the current title when a partial module response omits the week identity or settings', () => {
    type Weeks = Parameters<typeof seriesSessionWeekTitle>[0];
    const partialModule = [{ weekNumber: 1, components: [{ type: 'live-session', title: 'Live Teams Session 1' }] }] as unknown as Weeks;
    expect(seriesSessionWeekTitle(partialModule, 'M1', 'S1', 7)).toBe('');
    const missingSettings = [{ ...week, components: [{ ...component, settings: undefined }] }] as unknown as Weeks;
    expect(seriesSessionWeekTitle(missingSettings, 'M1', 'S1', 7)).toBe('');
  });

  it('requires an actual owning week ID even when the series identity matches', () => {
    const linked = { ...component, weekId: '', settings: { teamsLiveSessionId: 'S1', teamsSessionNumber: '7' } };
    expect(seriesSessionWeekTitle([{ ...week, id: '', components: [linked] }], 'M1', 'S1', 7)).toBe('');
  });

  it('keeps the current title when the matched week has no title', () => {
    type Weeks = Parameters<typeof seriesSessionWeekTitle>[0];
    const linked = { ...component, settings: { teamsLiveSessionId: 'S1', teamsSessionNumber: '7' } };
    const weeks = [{ ...week, title: undefined, components: [linked] }] as unknown as Weeks;
    expect(seriesSessionWeekTitle(weeks, 'M1', 'S1', 7)).toBe('');
  });
});
