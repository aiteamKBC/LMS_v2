import { Fragment, type ReactNode } from 'react';
import type { JourneyComponent } from '@/utils/learnerJourney';
import type { WebPointPlan } from '@/api/webWeekPoints';
import { webPointGroups } from '@/utils/webPointActivities';

/** Children keep their own routes, availability and completion controls. */
export function PointActivityRows({ components, renderRow, plan = null, current, pointIdentityFor }: {
  components: JourneyComponent[];
  renderRow: (component: JourneyComponent) => ReactNode;
  plan?: WebPointPlan | null;
  current?: (component: JourneyComponent) => boolean;
  pointIdentityFor?: (component: JourneyComponent) => string | undefined;
}) {
  const rows = (items: JourneyComponent[]) => items.map((component, index) =>
    <Fragment key={component.componentId || `activity:${index}`}>{renderRow(component)}</Fragment>);
  const groups = webPointGroups(components, plan, pointIdentityFor);
  const hasPoints = groups.some(group => group.point);
  return groups.map((group, index) => group.point
    ? <li key={`${group.components[0].weekId}:${group.point.id}`} className="px-2 py-2">
      <details className="overflow-hidden rounded-xl border border-primary-200 bg-white shadow-sm" open={group.components.some(component => current?.(component)) || undefined}>
        <summary title={group.point.title} className="cursor-pointer bg-primary-50 px-3 py-3 text-sm font-semibold text-primary-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500">
          {group.point.title}<span className="ml-2 text-xs font-normal text-foreground-500">{group.components.length} activities</span>
        </summary>
        <ul aria-label={`${group.point.title} activities`} className="divide-y divide-primary-100 border-t border-primary-200">{rows(group.components)}</ul>
      </details>
    </li>
    : hasPoints && group.components.length > 0
      ? <li key={`ungrouped:${index}`} className="pt-3">
        <h4 className="border-y border-foreground-200 bg-background-100 px-4 py-3 text-xs font-bold uppercase tracking-wide text-foreground-600">Other activities</h4>
        <ul aria-label="Other activities" className="divide-y divide-primary-100">{rows(group.components)}</ul>
      </li>
      : <Fragment key={`ungrouped:${index}`}>{rows(group.components)}</Fragment>);
}
