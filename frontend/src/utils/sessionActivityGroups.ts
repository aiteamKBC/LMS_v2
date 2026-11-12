export interface SessionActivityIdentity {
  componentId?: string | null;
  type?: string | null;
  moduleId?: string | null;
  weekId?: string | null;
  linkedSessionComponentId?: string | null;
  linkedSessionModuleId?: string | null;
}

/** Presentation only: keep canonical records, completion and saved order intact.
 * Group only an explicit link whose unique parent is present in the same week
 * and module. Filtered, missing, cross-week and external parents stay separate.
 */
export function sessionActivityGroups<T>(items: readonly T[], identity: (item: T) => SessionActivityIdentity) {
  const key = (moduleId: string | null | undefined, weekId: string, id: string) => JSON.stringify([moduleId || '', weekId, id]);
  const kind = (value: string | null | undefined) => (value || '').trim().toLowerCase().replace(/-/g, '_');
  const parents = new Map<string, T[]>();
  items.forEach(item => {
    const data = identity(item);
    if (kind(data.type) !== 'live_session' || !data.componentId || !data.weekId) return;
    const id = key(data.moduleId, data.weekId, data.componentId);
    parents.set(id, [...(parents.get(id) || []), item]);
  });
  const recordings = new Map<T, T[]>();
  const grouped = new Set<T>();
  items.forEach(item => {
    const data = identity(item);
    if (kind(data.type) !== 'recording_placeholder' || !data.linkedSessionComponentId || !data.weekId) return;
    const parentModule = data.linkedSessionModuleId || data.moduleId;
    if ((parentModule || '') !== (data.moduleId || '')) return;
    const matches = parents.get(key(parentModule, data.weekId, data.linkedSessionComponentId));
    if (matches?.length !== 1) return;
    const parent = matches[0];
    recordings.set(parent, [...(recordings.get(parent) || []), item]);
    grouped.add(item);
  });
  return items.filter(item => !grouped.has(item)).map(primary => ({ primary, recordings: recordings.get(primary) || [] }));
}
