import { describe, expect, it } from 'vitest';
import { sessionActivityGroups, type SessionActivityIdentity } from './sessionActivityGroups';

const live: SessionActivityIdentity = { componentId: 'L', moduleId: 'M', weekId: 'W', type: 'live_session' };
const recording: SessionActivityIdentity = { componentId: 'R', moduleId: 'M', weekId: 'W', type: 'recording_placeholder', linkedSessionComponentId: 'L' };
const group = (items: SessionActivityIdentity[]) => sessionActivityGroups(items, item => item);

describe('session activity presentation', () => {
  it('groups the explicit pair and keeps the exact records and unrelated order', () => {
    const reading = { ...live, type: 'reading', componentId: 'READ' };
    const items = [live, reading, recording];
    const before = structuredClone(items);
    const result = group(items);
    expect(result).toEqual([{ primary: live, recordings: [recording] }, { primary: reading, recordings: [] }]);
    expect(result[0].primary).toBe(live);
    expect(result[0].recordings[0]).toBe(recording);
    expect(items).toEqual(before);
  });

  it.each([
    { linkedSessionComponentId: undefined },
    { linkedSessionComponentId: 'MISSING' },
    { linkedSessionModuleId: 'OTHER' },
    { moduleId: 'OTHER' },
    { weekId: 'OTHER' },
  ])('keeps an unresolved, external or cross-week recording visible: %j', patch => {
    expect(group([live, { ...recording, ...patch }])).toHaveLength(2);
  });

  it('keeps filtered recordings, missing identities and ambiguous parents visible', () => {
    expect(group([recording])[0].primary).toBe(recording);
    expect(group([live, { ...recording, weekId: null }])).toHaveLength(2);
    expect(group([live, { ...live }, recording])).toHaveLength(3);
  });

  it('never groups different sessions just because their titles or Teams links match', () => {
    const other = { ...live, componentId: 'OTHER' };
    const result = group([live, other, recording]);
    expect(result[0].recordings).toEqual([recording]);
    expect(result[1].primary).toBe(other);
    expect(result[1].recordings).toEqual([]);
  });
});
