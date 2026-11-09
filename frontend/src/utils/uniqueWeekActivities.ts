import type { JourneyComponent } from './learnerJourney';

/** Flattened web lists keep one row per saved activity, never per title or quiz. */
export function uniqueWeekActivities(components: readonly JourneyComponent[]): JourneyComponent[] {
  const seen = new Set<string>();
  return components.filter(component => {
    if (!component.componentId) return true;
    if (seen.has(component.componentId)) return false;
    seen.add(component.componentId);
    return true;
  });
}
