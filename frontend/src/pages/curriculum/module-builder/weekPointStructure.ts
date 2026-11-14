import type { WebPoint } from '@/api/webWeekPoints';
import type { ModuleComponent } from './moduleAuthoringData';

export const pointOfComponent = (points: WebPoint[], id: string) => points.find(point => point.componentIds.includes(id))?.id || null;

export function reorderWeekPoints(points: WebPoint[], sourceId: string, targetId: string): WebPoint[] {
  const from = points.findIndex(point => point.id === sourceId);
  const to = points.findIndex(point => point.id === targetId);
  if (from < 0 || to < 0 || from === to) return points;
  const next = [...points];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** Change membership without rewriting component fields or dropping stale references. */
export function assignPointComponents(points: WebPoint[], targetId: string | null, ids: string[], components: ModuleComponent[]): WebPoint[] {
  if (targetId !== null && !points.some(point => point.id === targetId)) return points;
  const moving = new Set(ids);
  return points.map(point => {
    if (point.id !== targetId && !point.componentIds.some(id => moving.has(id))) return point;
    const members = point.componentIds.filter(id => !moving.has(id));
    if (point.id === targetId) members.push(...ids);
    const memberSet = new Set(members);
    const ordered = components.filter(component => memberSet.has(component.id)).map(component => component.id);
    const known = new Set(ordered);
    let index = 0;
    return { ...point, componentIds: members.map(id => known.has(id) ? ordered[index++] : id) };
  });
}

/** Move visible session groups as units, keeping other Point memberships intact. */
export function movePointComponents(components: ModuleComponent[], points: WebPoint[], movingIds: string[], targetPointId: string | null, overIds: string[] = []) {
  const unchanged = { components, points };
  if (targetPointId !== null && !points.some(point => point.id === targetPointId)) return unchanged;
  const movingSet = new Set(movingIds);
  const moving = components.filter(component => movingSet.has(component.id));
  if (!moving.length || overIds.some(id => movingSet.has(id))) return unchanged;
  const remaining = components.filter(component => !movingSet.has(component.id));
  const over = new Set(overIds.length ? overIds : points.find(point => point.id === targetPointId)?.componentIds || []);
  const targets = remaining.flatMap((component, index) => over.has(component.id) ? [index] : []);
  const after = !overIds.length || components.findIndex(component => component.id === moving[0].id)
    < components.findIndex(component => over.has(component.id));
  const insertion = targets.length ? (after ? targets[targets.length - 1] + 1 : targets[0]) : remaining.length;
  const next = [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)];
  return { components: next, points: assignPointComponents(points, targetPointId, moving.map(component => component.id), next) };
}
