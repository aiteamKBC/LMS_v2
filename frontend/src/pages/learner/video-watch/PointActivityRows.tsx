import { Fragment, type ReactNode } from 'react';
import type { JourneyComponent } from '@/utils/learnerJourney';

/** Children keep their own routes, availability and completion controls. */
export function PointActivityRows({ components, renderRow }: {
  components: JourneyComponent[];
  renderRow: (component: JourneyComponent) => ReactNode;
}) {
  return components.map((component, index) =>
    <Fragment key={component.componentId || `activity:${index}`}>{renderRow(component)}</Fragment>);
}
