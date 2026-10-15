import type { DashboardTabsProps } from '../DashboardTabs';
import { DashboardTrainingPlan } from '../DashboardTrainingPlan';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDashboardMonthly } from '@/hooks/useDashboardMonthly';
import { MonthlyPlanBoard } from '../MonthlyPlanBoard';
import styles from '@/pages/learner/training-plan-timeline/TrainingPlanDetails.module.css';

function SelectedMonthlyPlan({ kind, learnerId, monthlyDataEnabled, programmeStartDate, programmeEndDate }: Pick<DashboardTabsProps, 'kind' | 'learnerId' | 'monthlyDataEnabled' | 'programmeStartDate' | 'programmeEndDate'>) {
  const [params] = useSearchParams();
  const initialMonth = params.get('month') || '';
  const [selection, setSelection] = useState({ identity: `${kind}:${learnerId}`, month: /^\d{4}-(0[1-9]|1[0-2])$/.test(initialMonth) ? initialMonth : '', subject: params.get('subject') || '' });
  const current = selection.identity === `${kind}:${learnerId}` ? selection : { month: initialMonth, subject: params.get('subject') || '' };
  const read = useDashboardMonthly(kind, learnerId, current.month, current.subject, monthlyDataEnabled, { programmeStartDate, programmeEndDate });
  return <div className={styles.root}>
    {read.error && <div role="alert" className={styles.error}><span>Your monthly learning could not refresh. {read.error}</span><button onClick={read.refresh}>Retry monthly learning</button></div>}
    {read.data ? <MonthlyPlanBoard key={`${kind}:${learnerId}`} payload={read.data} kind={kind} learnerId={learnerId}
      refreshing={read.refreshing} onRefresh={read.refresh}
      onMonthChange={month => setSelection({ identity: `${kind}:${learnerId}`, month, subject: '' })} />
      : read.loading && <div role="status" aria-label="Loading monthly learning and coaching" className={styles.loading}><div aria-hidden="true"><span /><span /><span /></div></div>}
  </div>;
}

export default function DashboardMonthlyTab({ kind, learnerId, plan, programmeStartDate, programmeEndDate, pageError, learningSubjects, learningSubjectsLoading, learningSubjectsError, onRetryLearningSubjects, attendanceWorkspace, tabData, monthlyDataEnabled }: DashboardTabsProps) {
  const [params] = useSearchParams();
  if (tabData) return <SelectedMonthlyPlan key={`${kind}:${learnerId}:${params.get('month') || ''}:${params.get('subject') || ''}`} kind={kind} learnerId={learnerId} monthlyDataEnabled={monthlyDataEnabled} programmeStartDate={programmeStartDate} programmeEndDate={programmeEndDate} />;
  return <DashboardTrainingPlan kind={kind} learnerId={learnerId} plan={plan} canOpenActivities showRewards={false} monthlyOnly programmeStartDate={programmeStartDate} programmeEndDate={programmeEndDate} pageError={pageError} learningSubjects={learningSubjects} learningSubjectsLoading={learningSubjectsLoading} learningSubjectsError={learningSubjectsError} onRetryLearningSubjects={onRetryLearningSubjects} attendanceWorkspace={attendanceWorkspace} />;
}
