// The Course structure rail's component-type filter. Picking a type shows only
// the components of that type, across every week, under the weeks that hold
// them -- so "every live session in this module" is one click, not a walk
// through thirty collapsed weeks.
import { componentAuthoringDefinitions, type ModuleComponentType } from './componentAuthoringModel';

type TypedComponent = { id: string; type: ModuleComponentType | string };

export type ComponentTypeCount = { type: string; label: string; icon: string; count: number };

/** Every component type the weeks hold, with how many, in authoring order. */
export function componentTypeCounts(weeks: { components: TypedComponent[] }[]): ComponentTypeCount[] {
  const counts = new Map<string, number>();
  weeks.forEach(week => week.components.forEach(component => {
    counts.set(component.type, (counts.get(component.type) || 0) + 1);
  }));
  const order = componentAuthoringDefinitions.map(definition => definition.type as string);
  return Array.from(counts, ([type, count]) => {
    const definition = componentAuthoringDefinitions.find(item => item.type === type);
    return { type, label: definition?.label || type, icon: definition?.icon || 'ri-file-line', count };
  }).sort((a, b) => {
    const left = order.indexOf(a.type), right = order.indexOf(b.type);
    return (left < 0 ? order.length : left) - (right < 0 ? order.length : right);
  });
}

/**
 * Put an edit made on a filtered week back into the whole week.
 *
 * The nested rail hands back the list it was shown, so a reorder, delete or
 * duplicate on "live sessions only" would otherwise replace the week with just
 * its live sessions. The shown components that remain keep the slots they held
 * in the week, in their new order; one deleted gives up its own slot; one added
 * (a duplicate) goes straight after the component it follows in the shown list.
 * Every other component stays exactly where it was.
 */
export function mergeFilteredComponents<T extends TypedComponent>(full: T[], shownIds: Set<string>, next: T[]): T[] {
  const nextIds = new Set(next.map(component => component.id));
  const fullIds = new Set(full.map(component => component.id));
  const kept = next.filter(component => fullIds.has(component.id));
  const merged: T[] = [];
  full.forEach(component => {
    if (!shownIds.has(component.id)) merged.push(component);
    else if (nextIds.has(component.id)) merged.push(kept.shift()!);
  });
  next.forEach((component, index) => {
    if (fullIds.has(component.id)) return;
    const before = index > 0 ? merged.findIndex(item => item.id === next[index - 1].id) : -1;
    const firstShown = merged.findIndex(item => nextIds.has(item.id));
    merged.splice(before >= 0 ? before + 1 : Math.max(firstShown, 0), 0, component);
  });
  return merged;
}
