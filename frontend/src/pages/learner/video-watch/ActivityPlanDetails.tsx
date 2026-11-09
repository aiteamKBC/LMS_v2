import { allocatedActivityHours } from '@/utils/activityPlan';
import { formatHoursMinutes } from '@/utils/learnerJourney';
import { peekLearnerAttendanceMode, readLearnerAttendanceMode } from '@/api/learnerAttendanceMode';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';
import { parsePersonalLearning } from '@/lib/personalLearning';

/** A quiet, wrapping addition to the existing row/header; no completion rules. */
export function ActivityPlanDetails({ hours, componentType, kind, learnerId }: {
  hours?: number | null; componentType?: string | null; kind?: string; learnerId?: string;
}) {
  const allocated = allocatedActivityHours(hours);
  const liveSession = componentType?.trim().toLowerCase().replace(/[\s-]+/g, '_') === 'live_session';
  const learnerKind = kind === 'commercial' || kind === 'apprenticeship' ? kind : null;
  const mode = useLiveLearnerRead(learnerKind, learnerId,
    allocated != null && liveSession && !parsePersonalLearning(learnerId),
    readLearnerAttendanceMode, peekLearnerAttendanceMode);
  if (allocated == null) return null;
  const requirement = mode.data === 'live' ? 'Required: Live attendance'
    : mode.data === 'lazy' ? 'Required: Recording' : 'Required';
  return <span className="mt-1 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5">
    <span aria-busy={mode.loading || undefined} className="rounded-md border border-amber-200 bg-amber-50 px-1.5 font-semibold text-amber-900">{requirement}</span>
    {mode.error && <span className="text-foreground-600">Attendance requirement unavailable.</span>}
    <span className="text-foreground-600">Planned time: <span className="font-medium tabular-nums">{allocated * 60 < 0.5 ? 'Less than 1 min' : formatHoursMinutes(allocated)}</span></span>
  </span>;
}
