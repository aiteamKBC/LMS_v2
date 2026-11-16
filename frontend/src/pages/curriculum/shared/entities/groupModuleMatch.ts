type GroupOwnedModule = {
  group?: string;
  groupId?: string;
  programmeId?: string;
};

const normalise = (value?: string) => String(value ?? '').trim().toLowerCase();

/** Match only by the persisted canonical group identity. */
export function moduleMatchesGroup<T extends GroupOwnedModule>(
  module: T,
  target: { groupId?: string; groupName: string; programmeId?: string },
) {
  const targetGroupId = normalise(target.groupId);
  const moduleGroupId = normalise(module.groupId);
  if (!targetGroupId || !moduleGroupId || moduleGroupId !== targetGroupId) return false;
  return true;
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
