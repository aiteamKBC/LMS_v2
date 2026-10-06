import { useCallback, useEffect, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { overviewSchedule, overviewWeek, type OverviewWeek } from '@/api/learnerOverview';
import type { TrainingPlanContract, TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { getLogSummary, type MonthlyLogHours } from '@/features/monthly-logs/api';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';

function hours(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function monthlyLogOtjh(summary: MonthlyLogHours) {
  return {
    plannedEndDate: summary.learner?.planned_end_date ?? null,
    acceptedTotal: summary.training_plan_totals?.accepted_hours ?? null,
    plannedTotal: summary.training_plan_totals?.planned_hours ?? null,
    months: Object.fromEntries(summary.months.map(month => [month.month, {
      target: month.training_plan_target == null ? null : hours(month.training_plan_target),
      submitted: hours(month.not_accepted_hours),
      completed: hours(month.actual_hours),
    }])),
  };
}

export function monthlyLogActualOtjh(months: Record<string, { completed: number }> | undefined) {
  if (!months) return null;
  return Math.round(Object.values(months).reduce((total, month) => total + month.completed, 0) * 10_000) / 10_000;
}

export function contractPlannedOtjh(contract: TrainingPlanContract | undefined) {
  if (contract?.journalTargets !== undefined) {
    const values = Object.values(contract.journalTargets);
    return values.some(value => !Number.isFinite(value) || value < 0) ? null
      : Math.round(values.reduce((total, value) => total + value, 0) * 10_000) / 10_000;
  }
  if (contract?.contractStatus !== 'ready') return null;
  const months = Object.values(contract.months);
  if (!months.length || months.some(month => month.planned == null || !Number.isFinite(month.planned) || month.planned < 0)) return null;
  return Math.round(months.reduce((total, month) => total + month.planned!, 0) * 10_000) / 10_000;
}

type SourceRead<T> = { read: (kind: LearnerKind, id: string, signal?: AbortSignal, fresh?: boolean) => Promise<T>;
  peek: (kind: LearnerKind, id: string) => T | undefined };

/** Where the dashboard reads come from. Callers outside the learner's own session (the employer portal) supply their own. */
export type DashboardPlanSources = {
  week: SourceRead<OverviewWeek>;
  schedule: SourceRead<TrainingPlanDashboard>;
  logSummary: (kind: LearnerKind, id: string, signal?: AbortSignal) => Promise<MonthlyLogHours>;
};

const LEARNER_SOURCES: DashboardPlanSources = {
  week: overviewWeek,
  schedule: overviewSchedule,
  logSummary: (_kind, id, signal) => getLogSummary(id, signal, 'learner'),
};

/** `sources` must be stable across renders (module constant or memoised). */
export function useDashboardPlan(kind?: LearnerKind | null, id?: string | null, enabled = true, sources: DashboardPlanSources = LEARNER_SOURCES) {
  const active = enabled && !!kind && !!id;
  const week = useLiveLearnerRead(kind, id, active, sources.week.read, sources.week.peek);
  const schedule = useLiveLearnerRead(kind, id, active, sources.schedule.read, sources.schedule.peek);
  const identity = `${kind}:${id}`;
  const [attempt, setAttempt] = useState(0);
  const [ssot, setSsot] = useState<{ identity: string; data: ReturnType<typeof monthlyLogOtjh>; error: string } | null>(null);
  const retryContract = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!active || !kind || !id) {
      setSsot(null);
      return;
    }
    // Monthly Logs is keyed by the numeric enrolment id. Personal-learning
    // preview ids use a different route and have no retained Audit record.
    if (!/^[1-9]\d*$/.test(id)) {
      setSsot({ identity, data: { months: {}, plannedEndDate: null,
        acceptedTotal: null, plannedTotal: null }, error: '' });
      return;
    }
    // The shared reader owns the request deadline and retry. A shorter
    // dashboard timer would discard a successful response after a cold connection.
    const controller = new AbortController();
    void sources.logSummary(kind, id, controller.signal).then(summary => {
      if (!controller.signal.aborted) setSsot({ identity, data: monthlyLogOtjh(summary), error: '' });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setSsot({ identity, data: { months: {}, plannedEndDate: null,
        acceptedTotal: null, plannedTotal: null },
        error: error instanceof Error ? error.message : 'SSOT learning hours could not be loaded.' });
    });
    return () => { controller.abort(); };
  }, [active, kind, id, identity, attempt, sources]);
  const refresh = () => { week.refresh(); schedule.refresh(); retryContract(); };
  const ssotData = ssot?.identity === identity ? ssot.data : { months: {}, plannedEndDate: null,
    acceptedTotal: null, plannedTotal: null };
  const ssotError = ssot?.identity === identity ? ssot.error : '';
  const currentSsot = ssot?.identity === identity ? ssot : null;
  const targetMonths = Object.fromEntries(Object.entries(ssotData.months)
    .filter(([, month]) => month.target != null)
    .map(([month, value]) => [month, { label: '', topics: [], planned: value.target, source: 'ssot' }]));
  const contractData = {
    months: targetMonths,
    contractStatus: currentSsot ? currentSsot.error ? 'unavailable' : 'ready' : 'loading',
    programmeEndDate: ssotData.plannedEndDate,
  };
  return {
    otjh: {
      actual: currentSsot && !currentSsot.error ? currentSsot.data.acceptedTotal : null,
      planned: currentSsot && !currentSsot.error ? currentSsot.data.plannedTotal : null,
      actualLoading: active && !currentSsot,
      plannedLoading: active && !currentSsot,
    },
    data: schedule.data ? { ...schedule.data, ...contractData, monthlyOtjh: week.data?.monthlyOtjh, requiredOtjh: ssotData.plannedTotal,
      monthlyLogOtjh: ssotData.months } : null,
    plannedEndDate: ssotData.plannedEndDate,
    targetsLoading: active && !currentSsot,
    subjects: week.data?.planSubjects,
    loading: week.loading || schedule.loading,
    error: week.error || schedule.error || ssotError || (week.data && !week.data.planSubjects ? 'Module summaries could not be loaded.' : ''),
    refresh, retryContract, week, schedule,
  };
}

export type DashboardPlanState = ReturnType<typeof useDashboardPlan>;
