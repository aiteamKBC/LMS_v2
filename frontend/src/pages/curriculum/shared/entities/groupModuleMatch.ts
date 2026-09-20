type GroupOwnedModule = {
  group?: string;
  groupId?: string;
  programmeId?: string;
};

const normalise = (value?: string) => String(value ?? '').trim().toLowerCase();

/** Match by persisted group identity; names support legacy rows without an ID. */
export function moduleMatchesGroup<T extends GroupOwnedModule>(
  module: T,
  target: { groupId?: string; groupName: string; programmeId?: string },
) {
  const targetGroupId = normalise(target.groupId);
  const moduleGroupId = normalise(module.groupId);
  const matchesGroup = targetGroupId
    ? (moduleGroupId ? moduleGroupId === targetGroupId : normalise(module.group) === normalise(target.groupName))
    : normalise(module.group) === normalise(target.groupName);
  if (!matchesGroup) return false;

  const targetProgrammeId = normalise(target.programmeId);
  return !targetProgrammeId || !module.programmeId || normalise(module.programmeId) === targetProgrammeId;
}

export function modulesForGroup<T extends GroupOwnedModule>(
  modules: T[],
  target: { groupId?: string; groupName: string; programmeId?: string },
) {
  return modules.filter(module => moduleMatchesGroup(module, target));
}

export function moduleCountForGroup<T extends GroupOwnedModule>(
  modules: T[],
  target: { groupId?: string; groupName: string; programmeId?: string },
) {
  return modulesForGroup(modules, target).length;
}
