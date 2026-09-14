import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { currentAssignmentMonthKey, groupMonthlyAssignments } from './model';
import { useMonthlyAssignmentPlan } from './useMonthlyAssignmentPlan';
import { MonthlySubmissionOverview } from './MonthlySubmissionOverview';
import styles from './monthlySubmission.module.css';

/** The current month's work is the entry point. Explicit links can open history. */
export default function MonthlySubmissionPage() {
  const { kind: routeKind, id: routeId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(routeKind, routeId);
  const { real, loading, loadError, refresh } = useLearnerDetailParam(kind, id, true);
  const plan = useMonthlyAssignmentPlan(kind, id);
  const nav = roleNavMap.learner;
  const groups = useMemo(() => real ? groupMonthlyAssignments(real, plan.metadata, plan.contract, plan.statuses) : [],
    [real, plan.metadata, plan.contract, plan.statuses]);
  const busy = loading || plan.loading;
  return <WorkspaceShell role="learner" roleLabel={nav.label} navItems={nav.items} workspaceLabel={nav.workspaceLabel}
    pageTitle="Monthly submission" pageSubtitle="Your assignments and next steps this month" userName={real?.name || 'Learner'} userRole="Learner">
    <main className={`page-container ${styles.page}`}>
      {busy ? <div className={styles.loading} role="status">Loading your monthly assignments...</div>
        : loadError ? <div role="alert" className={styles.error}><p>{loadError}</p><button type="button" onClick={refresh}>Retry assignments</button></div>
        : <>
          {plan.errors.length > 0 && <div role="alert" className={styles.error}>{plan.errors.map(error => <p key={error}>{error}</p>)}<button type="button" onClick={plan.retry}>Retry plan details</button></div>}
          {kind && id && <MonthlySubmissionOverview groups={groups} kind={kind} learnerId={id} currentMonth={currentAssignmentMonthKey()} />}
        </>}
    </main>
  </WorkspaceShell>;
}
