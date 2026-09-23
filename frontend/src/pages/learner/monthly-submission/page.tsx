import { useEffect, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
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
  const groups = useMemo(() => real ? groupMonthlyAssignments(real, plan.metadata, plan.contract, plan.statuses, plan.submissionCounts) : [],
    [real, plan.metadata, plan.contract, plan.statuses, plan.submissionCounts]);
  const selectionKey = `monthly-assignment-selection:${kind}:${id}`;
  let savedSelection: { month?: string; assignment?: string } | null = null;
  try { savedSelection = JSON.parse(sessionStorage.getItem(selectionKey) || 'null'); } catch { /* Storage may be unavailable. */ }
  const requestedMonth = params.get('month') ?? savedSelection?.month;
  const group = groups.find(item => item.month === requestedMonth) || defaultAssignmentMonth(groups);
  const statusFilter = ['accepted', 'rejected'].includes(params.get('status') || '') ? params.get('status')! : 'all';
  const visibleAssignments = group?.assignments.filter(item => statusFilter === 'all' || item.status === statusFilter) || [];
  const requestedAssignment = params.get('assignment')
    ?? (savedSelection?.month === group?.month ? savedSelection?.assignment : undefined);
  const assignment = visibleAssignments.find(item => item.id === requestedAssignment)
    || visibleAssignments.find(item => !item.submitted) || visibleAssignments[0];
  const filterByStatus = (status: string) => {
    setParams(current => {
      const next = new URLSearchParams(current);
      if (status === 'all') next.delete('status'); else next.set('status', status);
      next.delete('assignment');
      return next;
    }, { replace: true });
  };
  const select = (month: string, assignmentId?: string) => {
    setParams(current => {
      const next = new URLSearchParams(current);
      next.set('month', month);
      if (assignmentId) next.set('assignment', assignmentId); else next.delete('assignment');
      return next;
    }, { replace: true });
  };
  const busy = loading || plan.loading;
  useEffect(() => {
    if (busy || loadError || plan.errors.length || !kind || !id || !group || !assignment) return;
    try { sessionStorage.setItem(selectionKey, JSON.stringify({ month: group.month, assignment: assignment.id })); } catch { /* URL selection still works without storage. */ }
    if (params.get('month') === group.month && params.get('assignment') === assignment.id) return;
    setParams(current => {
      const next = new URLSearchParams(current);
      next.set('month', group.month);
      next.set('assignment', assignment.id);
      return next;
    }, { replace: true });
  }, [busy, loadError, plan.errors.length, kind, id, group, assignment, selectionKey, params, setParams]);
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
          {group && kind && id ? <>
            <section className={styles.monthSelector} aria-label="Selected submission month">
              <div>
                <p className={styles.eyebrow}>Monthly submission</p>
                <h2><CalendarDays size={22} aria-hidden="true" />{monthName(group.month)}</h2>
                {group.label !== monthName(group.month) && <p>{group.label}</p>}
                {group.topics.length > 0 && <p>{group.topics.join(' · ')}</p>}
                <p>{group.assignments.length} assignment{group.assignments.length === 1 ? '' : 's'} · {group.submitted} submitted</p>
              </div>
              <div className="flex flex-wrap items-end gap-3"><label className={styles.monthSelectLabel}>Choose month
                <select value={group.month} onChange={event => select(event.target.value)}>
                  {groups.map(item => <option key={item.month} value={item.month}>
                    {monthName(item.month)}{item.label !== monthName(item.month) ? ` — ${item.label}` : ''}
                  </option>)}
                </select>
              </label><Link className={`${styles.primary} ${styles.extraActivityButton}`} to={`/learner/monthly-submission/${kind}/${id}/extra-activities`}>+ Extra activities</Link></div>
            </section>
            <section className={styles.assignmentSection} aria-label={`Assignments for ${group.label}`}>
              <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Assignments this month</p><h2>{group.label}</h2></div>
                <span>{visibleAssignments.length} of {group.assignments.length} assignments</span></div>
              <div className={styles.statusFilters} role="group" aria-label="Filter assignments by status">
                {(['all', 'accepted', 'rejected'] as const).map(status => <button key={status} type="button"
                  aria-pressed={statusFilter === status} data-filter={status} onClick={() => filterByStatus(status)}>
                  {status === 'all' ? 'All' : status === 'accepted' ? 'Accepted' : 'Rejected'}
                </button>)}
              </div>
              {!group.month && <p className={styles.unscheduled}>These assignments do not have a confirmed Training Plan date yet.</p>}
              {!visibleAssignments.length && <p className={styles.filterEmpty} role="status">No {statusFilter === 'all' ? '' : `${statusFilter} `}assignments for this month. Choose another filter or month.</p>}
              <div className={styles.assignmentGrid}>{visibleAssignments.map(row => <button type="button" key={row.id}
                className={styles.assignment} aria-pressed={row.id === assignment?.id} onClick={() => select(group.month, row.id)}>
                <span className={styles.assignmentTop}><span className={styles.assignmentIcon}><FileText size={19} aria-hidden="true" /></span>
                  <span className={styles.status} data-status={row.status}>{statusLabels[row.status] || row.status.replaceAll('_', ' ') || 'Status unavailable'}</span></span>
                <strong>{row.component}</strong><span className={styles.assignmentTopic}>{[row.module, row.week].filter(Boolean).join(' · ')}</span>
                {row.submissionCount !== undefined && <span>{row.submissionCount} submission{row.submissionCount === 1 ? '' : 's'}</span>}
                <span className={styles.assignmentBottom}><span>{row.expectedOtjh != null ? `${row.expectedOtjh} OTJ hours` : 'Hours not specified'}</span>
                  <span>{row.id === assignment?.id ? <><CheckCircle2 size={15} aria-hidden="true" />Selected</> : <>View details<ArrowUpRight size={15} aria-hidden="true" /></>}</span></span>
              </button>)}</div>
            </section>
            {assignment && <AssignmentDetailsCard assignment={assignment} group={group} kind={kind} learnerId={id} />}
          </> : <div className={styles.empty}><FileText size={28} aria-hidden="true" /><h2>No assignments yet</h2><p>Your assigned monthly work will appear here when it is added to your Training Plan.</p></div>}
        </>}
    </main>
  </WorkspaceShell>;
}
