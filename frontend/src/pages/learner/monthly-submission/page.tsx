import { useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, CheckCircle2, FileText } from 'lucide-react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { AssignmentDetailsCard } from './AssignmentDetailsCard';
import { defaultAssignmentMonth, groupMonthlyAssignments, monthName, statusLabels } from './model';
import { useMonthlyAssignmentPlan } from './useMonthlyAssignmentPlan';
import styles from './monthlySubmission.module.css';

/** Assigned components use the same delivery dates and month topics as Training Plan. */
export default function MonthlySubmissionPage() {
  const { kind: routeKind, id: routeId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(routeKind, routeId);
  const { real, loading, loadError, refresh } = useLearnerDetailParam(kind, id, true);
  const plan = useMonthlyAssignmentPlan(kind, id);
  const [params, setParams] = useSearchParams();
  const nav = roleNavMap.learner;
  const groups = useMemo(() => real ? groupMonthlyAssignments(real, plan.metadata, plan.contract, plan.statuses) : [],
    [real, plan.metadata, plan.contract, plan.statuses]);
  const group = groups.find(item => item.month === params.get('month')) || defaultAssignmentMonth(groups);
  const assignment = group?.assignments.find(item => item.id === params.get('assignment'))
    || group?.assignments.find(item => !item.submitted) || group?.assignments[0];
  const monthsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    monthsRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [group?.month, plan.loading]);
  const select = (month: string, assignmentId?: string) => {
    setParams(current => {
      const next = new URLSearchParams(current);
      next.set('month', month);
      if (assignmentId) next.set('assignment', assignmentId); else next.delete('assignment');
      return next;
    }, { replace: true });
  };
  const busy = loading || plan.loading;
  return <WorkspaceShell role="learner" roleLabel={nav.label} navItems={nav.items} workspaceLabel={nav.workspaceLabel}
    pageTitle="Monthly submission" pageSubtitle="Your assignment, evidence and coaching preparation" userName={real?.name || 'Learner'} userRole="Learner">
    <main className={`page-container ${styles.page}`}>
      <header className={styles.pageHeader}><div><h1>Monthly submission</h1>
        <p>Your assignments, organised by Training Plan month. Review the brief, continue your work or arrange support.</p></div>
        {!busy && groups.length > 0 && <span className={styles.total}><FileText size={16} aria-hidden="true" />{groups.reduce((total, item) => total + item.assignments.length, 0)} assignments</span>}
      </header>
      {busy ? <div className={styles.loading} role="status">Loading your monthly assignments…</div>
        : loadError ? <div role="alert" className={styles.error}><p>{loadError}</p><button type="button" onClick={refresh}>Retry assignments</button></div>
        : <>
          {plan.errors.length > 0 && <div role="alert" className={styles.error}>{plan.errors.map(error => <p key={error}>{error}</p>)}<button type="button" onClick={plan.retry}>Retry plan details</button></div>}
          {group && assignment && kind && id ? <>
            <nav ref={monthsRef} className={styles.months} aria-label="Assignment months">
              {groups.map(item => <button key={item.month} type="button" aria-pressed={item.month === group.month}
                className={styles.month} onClick={() => select(item.month)}>
                <span className={styles.monthHeading}><CalendarDays size={16} aria-hidden="true" />{item.label}</span>
                {item.topics.length > 0 && <span className={styles.monthTopic}>{item.topics.join(' · ')}</span>}
                {item.month && item.label !== monthName(item.month) && <span>{monthName(item.month)}</span>}
                <small>{item.assignments.length} assignment{item.assignments.length === 1 ? '' : 's'} · {item.submitted} submitted</small>
              </button>)}
            </nav>
            <AssignmentDetailsCard assignment={assignment} group={group} kind={kind} learnerId={id} />
            <section className={styles.assignmentSection} aria-label={`Assignments for ${group.label}`}>
              <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Assignments this month</p><h2>{group.label}</h2></div>
                <span>{group.assignments.length} assignment{group.assignments.length === 1 ? '' : 's'}</span></div>
              {!group.month && <p className={styles.unscheduled}>These assignments do not have a confirmed Training Plan date yet.</p>}
              <div className={styles.assignmentGrid}>{group.assignments.map(row => <button type="button" key={row.id}
                className={styles.assignment} aria-pressed={row.id === assignment.id} onClick={() => select(group.month, row.id)}>
                <span className={styles.assignmentTop}><span className={styles.assignmentIcon}><FileText size={19} aria-hidden="true" /></span>
                  <span className={`${styles.status} ${row.submitted ? styles.positive : ''}`}>{statusLabels[row.status] || row.status.replaceAll('_', ' ') || 'Status unavailable'}</span></span>
                <strong>{row.component}</strong><span className={styles.assignmentTopic}>{[row.module, row.week].filter(Boolean).join(' · ')}</span>
                <span className={styles.assignmentBottom}><span>{row.expectedOtjh != null ? `${row.expectedOtjh} OTJ hours` : 'Hours not specified'}</span>
                  <span>{row.id === assignment.id ? <><CheckCircle2 size={15} aria-hidden="true" />Selected</> : <>View details<ArrowUpRight size={15} aria-hidden="true" /></>}</span></span>
              </button>)}</div>
            </section>
          </> : <div className={styles.empty}><FileText size={28} aria-hidden="true" /><h2>No assignments yet</h2><p>Your assigned monthly work will appear here when it is added to your Training Plan.</p></div>}
        </>}
    </main>
  </WorkspaceShell>;
}
