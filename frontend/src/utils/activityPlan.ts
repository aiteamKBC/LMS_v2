import type { JourneyComponent } from './learnerJourney';
import { groupPointActivities } from './pointActivities';

/** Allocated curriculum hours only. Media length and time spent are separate. */
export function allocatedActivityHours(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function subjectActivityHours(entry: {
  legacy?: { planned_hours_mapped: boolean; planned: number };
  native?: { expectedOtjh: number | null };
}): number | null {
  return allocatedActivityHours(entry.legacy
    ? entry.legacy.planned_hours_mapped ? entry.legacy.planned : null
    : entry.native?.expectedOtjh);
}

/** Keep a required point's knowledge check reachable without assigning it hours. */
export function requiredActivityRows(components: readonly JourneyComponent[]): Set<JourneyComponent> {
  const required = new Set(components.filter(component => allocatedActivityHours(component.expectedOtjh) != null));
  for (const group of groupPointActivities(components)) {
    if (group.pointNumber === null || !group.activities.some(component => required.has(component))) continue;
    for (const component of group.activities) {
      if (component.isQuiz || component.type?.trim().toLowerCase() === 'quiz') required.add(component);
    }
  }
  return required;
}
