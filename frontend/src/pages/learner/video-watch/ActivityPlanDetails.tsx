import { allocatedActivityHours } from '@/utils/activityPlan';
import { formatHoursMinutes } from '@/utils/learnerJourney';

/** A quiet, wrapping addition to the existing row/header; no completion rules. */
export function ActivityPlanDetails({ hours }: { hours?: number | null }) {
  const allocated = allocatedActivityHours(hours);
  if (allocated == null) return null;
  return <span className="mt-1 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5">
    <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 font-semibold text-amber-900">Required</span>
    <span className="text-foreground-600">Planned time: <span className="font-medium tabular-nums">{allocated * 60 < 0.5 ? 'Less than 1 min' : formatHoursMinutes(allocated)}</span></span>
  </span>;
}
