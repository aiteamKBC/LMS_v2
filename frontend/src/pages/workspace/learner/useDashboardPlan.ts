import { useCallback, useEffect, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { overviewSchedule, overviewWeek, type OverviewWeek } from '@/api/learnerOverview';
import { fetchTrainingPlanContract, type TrainingPlanContract, type TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { getLogSummary, type MonthlyLogHours } from '@/features/monthly-logs/api';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';

const AUDIT_OTJH_CUTOFF_MONTH = '2026-08';

function hours(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function monthlyLogOtjh(summary: MonthlyLogHours) {
  const hasAuditRecord = summary.learner?.aptem_id != null || summary.months.some(month => month.source === 'legacy');
  return {
    cutoffMonth: hasAuditRecord ? AUDIT_OTJH_CUTOFF_MONTH : undefined,
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
  contract: (kind: LearnerKind, id: string, signal?: AbortSignal) => Promise<TrainingPlanContract>;
  logSummary: (kind: LearnerKind, id: string, signal?: AbortSignal) => Promise<MonthlyLogHours>;
};

const LEARNER_SOURCES: DashboardPlanSources = {
  week: overviewWeek,
  schedule: overviewSchedule,
  contract: fetchTrainingPlanContract,
  logSummary: (_kind, id, signal) => getLogSummary(id, signal, 'learner'),
};

/** `sources` must be stable across renders (module constant or memoised). */
export function useDashboardPlan(kind?: LearnerKind | null, id?: string | null, enabled = true, sources: DashboardPlanSources = LEARNER_SOURCES) {
  const active = enabled && !!kind && !!id;
  const week = useLiveLearnerRead(kind, id, active, sources.week.read, sources.week.peek);
  const schedule = useLiveLearnerRead(kind, id, active, sources.schedule.read, sources.schedule.peek);
  const identity = `${kind}:${id}`;
  const [attempt, setAttempt] = useState(0);
  const [contract, setContract] = useState<{ identity: string; data: TrainingPlanContract } | null>(null);
  const [audit, setAudit] = useState<{ identity: string; data: ReturnType<typeof monthlyLogOtjh>; error: string } | null>(null);
  const retryContract = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!active || !kind || !id) {
      setContract(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      controller.abort();
      setContract({ identity, data: { months: {}, contractStatus: 'unavailable' } });
    }, 30_000);
    void sources.contract(kind, id, controller.signal).then(data => {
      if (!controller.signal.aborted) setContract({ identity, data });
    }).catch(() => {
      if (!controller.signal.aborted) setContract({ identity, data: { months: {}, contractStatus: 'unavailable' } });
    }).finally(() => window.clearTimeout(timer));
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [active, kind, id, identity, attempt, sources]);
  useEffect(() => {
    if (!active || !kind || !id) {
      setAudit(null);
      return;
    }
    // Monthly Logs is keyed by the numeric enrolment id. Personal-learning
    // preview ids use a different route and have no retained Audit record.
    if (!/^[1-9]\d*$/.test(id)) {
      setAudit({ identity, data: { months: {}, cutoffMonth: undefined }, error: '' });
      return;
    }
    // The shared reader owns the request deadline and retry. A shorter
    // dashboard timer would discard a successful response after a cold connection.
    const controller = new AbortController();
    void sources.logSummary(kind, id, controller.signal).then(summary => {
      if (!controller.signal.aborted) setAudit({ identity, data: monthlyLogOtjh(summary), error: '' });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setAudit({ identity, data: { months: {}, cutoffMonth: undefined },
        error: error instanceof Error ? error.message : 'Historical Audit hours could not be loaded.' });
    });
    return () => { controller.abort(); };
  }, [active, kind, id, identity, attempt, sources]);
  const refresh = () => { week.refresh(); schedule.refresh(); retryContract(); };
  const contractData = contract?.identity === identity ? contract.data : { months: {}, contractStatus: 'loading' };
  const auditData = audit?.identity === identity ? audit.data : { months: {}, cutoffMonth: undefined };
  const auditError = audit?.identity === identity ? audit.error : '';
  const requiredOtjh = week.data?.metrics?.otjh.planned ?? null;
  const currentAudit = audit?.identity === identity ? audit : null;
  const currentContract = contract?.identity === identity ? contract.data : undefined;
  return {
    otjh: {
      actual: currentAudit && !currentAudit.error ? monthlyLogActualOtjh(currentAudit.data.months) : null,
      planned: contractPlannedOtjh(currentContract),
      actualLoading: active && !currentAudit,
      plannedLoading: active && !currentContract,
    },
    data: schedule.data ? { ...schedule.data, ...contractData, monthlyOtjh: week.data?.monthlyOtjh, requiredOtjh,
      monthlyLogOtjh: auditData.months, auditOtjhCutoffMonth: auditData.cutoffMonth } : null,
    subjects: week.data?.planSubjects,
    loading: week.loading || schedule.loading,
    error: week.error || schedule.error || auditError || (week.data && !week.data.planSubjects ? 'Module summaries could not be loaded.' : ''),
    refresh, retryContract, week, schedule,
  };
}

export type DashboardPlanState = ReturnType<typeof useDashboardPlan>;
