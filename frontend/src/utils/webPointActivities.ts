import type { WebPoint, WebPointPlan } from '@/api/webWeekPoints';
import type { JourneyComponent } from './learnerJourney';

/** Match both week and module; old pointNumber metadata never creates a group. */
export function webPointGroups<T extends JourneyComponent>(
  components: readonly T[], plan: WebPointPlan | null,
  identity: (component: T) => string | undefined = component => component.componentId,
): { point: WebPoint | null; components: T[] }[] {
  const assigned = new Set<T>();
  const groups: { point: WebPoint | null; components: T[] }[] = [];
  for (const [weekId, week] of Object.entries(plan?.weeks || {})) {
    for (const point of week.points) {
      const ids = new Set(point.componentIds);
      const members = components.filter(component => !assigned.has(component)
        && component.weekId === weekId && component.moduleId === week.moduleId
        && ids.has(identity(component) || ''));
      if (!members.length) continue;
      members.forEach(component => assigned.add(component));
      groups.push({ point, components: members });
    }
  }
  return [...groups, { point: null, components: components.filter(component => !assigned.has(component)) }];
}
