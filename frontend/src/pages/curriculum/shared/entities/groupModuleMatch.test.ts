import { describe, expect, it } from 'vitest';
import { moduleCountForGroup, moduleMatchesGroup, modulesForGroup } from './groupModuleMatch';

describe('group module matching', () => {
  it('uses the persisted group ID when a group display name has changed', () => {
    const modules = [
      { groupId: 'GROUP-FINAL', group: 'Final Group (old name)', programmeId: 'PROGRAMME-1' },
      { groupId: 'GROUP-OTHER', group: 'Final Group', programmeId: 'PROGRAMME-1' },
    ];

    expect(modulesForGroup(modules, {
      groupId: 'GROUP-FINAL', groupName: 'Final Group', programmeId: 'PROGRAMME-1',
    })).toEqual([modules[0]]);
    expect(moduleCountForGroup(modules, {
      groupId: 'GROUP-FINAL', groupName: 'Final Group', programmeId: 'PROGRAMME-1',
    })).toBe(1);
  });

  it('falls back to the display name for legacy module rows without a group ID', () => {
    expect(moduleMatchesGroup(
      { group: 'Final Group', programmeId: 'PROGRAMME-1' },
      { groupId: 'GROUP-FINAL', groupName: 'Final Group', programmeId: 'PROGRAMME-1' },
    )).toBe(true);
  });
});
