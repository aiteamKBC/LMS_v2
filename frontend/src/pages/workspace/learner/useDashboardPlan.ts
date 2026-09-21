import { useCallback, useEffect, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { overviewSchedule, overviewWeek } from '@/api/learnerOverview';
import { fetchTrainingPlanContract, type TrainingPlanContract } from '@/api/trainingPlanDashboard';
import { getLogSummary, type LogSummary } from '@/features/monthly-logs/api';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';

const AUDIT_OTJH_CUTOFF_MONTH = '2026-08';

function hours(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function monthlyLogOtjh(summary: LogSummary) {
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

export function combinedActualOtjh(
  metrics: { historical: number | null; actual: number | null } | undefined,
  months: Record<string, { completed: number }> | undefined,
  auditCutoffMonth: string | undefined,
) {
  if (!auditCutoffMonth || metrics?.historical == null) return metrics?.actual ?? null;
  const laterLmsHours = Object.entries(months || {})
    .filter(([month]) => month > auditCutoffMonth)
    .reduce((total, [, value]) => total + value.completed, 0);
  return Math.round((metrics.historical + laterLmsHours) * 10_000) / 10_000;
}

export function useDashboardPlan(kind?: LearnerKind | null, id?: string | null, enabled = true) {
  const active = enabled && !!kind && !!id;
  const week = useLiveLearnerRead(kind, id, active, overviewWeek.read, overviewWeek.peek);
  const schedule = useLiveLearnerRead(kind, id, active, overviewSchedule.read, overviewSchedule.peek);
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
    void fetchTrainingPlanContract(kind, id, controller.signal).then(data => {
      if (!controller.signal.aborted) setContract({ identity, data });
    }).catch(() => {
      if (!controller.signal.aborted) setContract({ identity, data: { months: {}, contractStatus: 'unavailable' } });
    }).finally(() => window.clearTimeout(timer));
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [active, kind, id, identity, attempt]);
  useEffect(() => {
    if (!active || !id) {
      setAudit(null);
      return;
    }
    // Monthly Logs is keyed by the numeric enrolment id. Personal-learning
    // preview ids use a different route and have no retained Audit record.
    if (!/^[1-9]\d*$/.test(id)) {
      setAudit({ identity, data: { months: {}, cutoffMonth: undefined }, error: '' });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      controller.abort();
      setAudit({ identity, data: { months: {}, cutoffMonth: undefined }, error: 'Historical Audit hours could not be loaded.' });
    }, 30_000);
    void getLogSummary(id, controller.signal, 'learner').then(summary => {
      if (!controller.signal.aborted) setAudit({ identity, data: monthlyLogOtjh(summary), error: '' });
    }).catch(() => {
      if (!controller.signal.aborted) setAudit({ identity, data: { months: {}, cutoffMonth: undefined }, error: 'Historical Audit hours could not be loaded.' });
    }).finally(() => window.clearTimeout(timer));
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [active, id, identity, attempt]);
  const refresh = () => { week.refresh(); schedule.refresh(); retryContract(); };
  const contractData = contract?.identity === identity ? contract.data : { months: {}, contractStatus: 'loading' };
  const auditData = audit?.identity === identity ? audit.data : { months: {}, cutoffMonth: undefined };
  const auditError = audit?.identity === identity ? audit.error : '';
  const requiredOtjh = week.data?.metrics?.otjh.planned ?? null;
  return {
    data: schedule.data ? { ...schedule.data, ...contractData, monthlyOtjh: week.data?.monthlyOtjh, requiredOtjh,
      monthlyLogOtjh: auditData.months, auditOtjhCutoffMonth: auditData.cutoffMonth } : null,
    subjects: week.data?.planSubjects,
    loading: week.loading || schedule.loading,
    error: week.error || schedule.error || auditError || (week.data && !week.data.planSubjects ? 'Module summaries could not be loaded.' : ''),
    refresh, retryContract, week, schedule,
  };
}

export type DashboardPlanState = ReturnType<typeof useDashboardPlan>;
