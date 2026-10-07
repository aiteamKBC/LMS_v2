import { useSearchParams } from 'react-router-dom';
import { useCaseFileMonthFocus } from '@/features/coach/case-file/hooks/useCaseFileMonthFocus';
import { TrainingPlanDetails } from '@/pages/learner/training-plan-timeline/TrainingPlanDetails';
import { dashboardPlanSubjects } from '@/pages/workspace/learner/dashboardPlan';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { parseLocalDate } from '@/pages/coach/shared/calendarEvents';
import type { LearnerKind } from '@/api/learnerDetail';

function isoDate(value?: string | null) {
  const date = parseLocalDate(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
}

export function CaseFileMonthlyFocusTab({ kind, learnerId, startDate, endDate }: {
  kind: LearnerKind; learnerId: string; startDate?: string | null; endDate?: string | null;
}) {
  const [params] = useSearchParams();
  const requested = params.get('month');
  const start = isoDate(startDate), end = isoDate(endDate);
  const current = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }).slice(0, 7);
  const implicit = start && current < start.slice(0, 7) ? start.slice(0, 7)
    : end && current > end.slice(0, 7) ? end.slice(0, 7) : current;
  const month = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : implicit;
  const state = useCaseFileMonthFocus(month, true);
  if (state?.error) return <div role="alert">{state.error}<button type="button" onClick={state.refresh}>Retry monthly focus</button></div>;
  if (!state?.data?.schedule || !state.data.week) return <div role="status" aria-label="Loading monthly focus"><RowsSkeleton rows={5} /></div>;
  const schedule = state.data.schedule;
  return <TrainingPlanDetails data={schedule} subjects={dashboardPlanSubjects(state.data.week.planSubjects, schedule)}
    kind={kind} learnerId={learnerId} initialMonth={month} monthlyOnly canOpenActivities={false}
    programmeStartDate={schedule.programmeStartDate || start} programmeEndDate={schedule.programmeEndDate || end}
    onRefresh={state.refresh} onRetryContract={state.refresh} />;
}
