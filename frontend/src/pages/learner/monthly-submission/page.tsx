import { useEffect, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, CheckCircle2, FileText } from 'lucide-react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { useExtraActivities } from '@/api/extraActivities';
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
  const extras = useExtraActivities(kind, id);
  const [params, setParams] = useSearchParams();
  const nav = roleNavMap.learner;
  const groups = useMemo(() => {
    const months = real ? groupMonthlyAssignments(real, plan.metadata, plan.contract, plan.statuses, plan.submissionCounts) : [];
    for (const activity of extras.activities) {
      if (activity.status !== 'accepted' || !/^\d{4}-\d{2}$/.test(activity.month) || months.some(item => item.month === activity.month)) continue;
      months.push({ month: activity.month, label: monthName(activity.month), topics: [], assignments: [], submitted: 0 });
    }
    return months.sort((a, b) => a.month && b.month ? a.month.localeCompare(b.month) : a.month ? -1 : b.month ? 1 : 0);
  }, [real, plan.metadata, plan.contract, plan.statuses, plan.submissionCounts, extras.activities]);
  const selectionKey = `monthly-assignment-selection:${kind}:${id}`;
  let savedSelection: { month?: string; assignment?: string } | null = null;
  try { savedSelection = JSON.parse(sessionStorage.getItem(selectionKey) || 'null'); } catch { /* Storage may be unavailable. */ }
  const requestedMonth = params.get('month') ?? savedSelection?.month;
  const group = groups.find(item => item.month === requestedMonth) || defaultAssignmentMonth(groups);
  const acceptedExtras = extras.activities.filter(activity => activity.status === 'accepted' && activity.month === group?.month);
  const statusFilter = ['accepted', 'rejected'].includes(params.get('status') || '') ? params.get('status')! : 'all';
  const visibleAssignments = group?.assignments.filter(item => statusFilter === 'all' || item.status === statusFilter) || [];
  const visibleExtras = statusFilter === 'rejected' ? [] : acceptedExtras;
  const requestedAssignment = params.get('assignment')
    ?? (savedSelection?.month === group?.month ? savedSelection?.assignment : undefined);
  const selectedExtra = visibleExtras.find(item => item.activityId === requestedAssignment)
    || (!visibleAssignments.length ? visibleExtras[0] : undefined);
  const assignment = selectedExtra ? undefined : visibleAssignments.find(item => item.id === requestedAssignment)
    || visibleAssignments.find(item => !item.submitted) || visibleAssignments[0];
  const selectedId = selectedExtra?.activityId || assignment?.id;
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
    if (busy || extras.loading || loadError || plan.errors.length || !kind || !id || !group || !selectedId) return;
    try { sessionStorage.setItem(selectionKey, JSON.stringify({ month: group.month, assignment: selectedId })); } catch { /* URL selection still works without storage. */ }
    if (params.get('month') === group.month && params.get('assignment') === selectedId) return;
    setParams(current => {
      const next = new URLSearchParams(current);
      next.set('month', group.month);
      next.set('assignment', selectedId);
      return next;
    }, { replace: true });
  }, [busy, extras.loading, loadError, plan.errors.length, kind, id, group, selectedId, selectionKey, params, setParams]);
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
          {extras.error && <div role="alert" className={styles.error}><p>{extras.error}</p><button type="button" onClick={extras.refresh}>Retry extra activities</button></div>}
          {group && kind && id ? <>
            <section className={styles.monthSelector} aria-label="Selected submission month">
              <div className={styles.monthSummary}>
                <p className={styles.eyebrow}>Monthly submission</p>
                <h2><CalendarDays size={22} aria-hidden="true" />{monthName(group.month)}</h2>
                {group.label !== monthName(group.month) && <p>{group.label}</p>}
                {group.topics.length > 0 && <p>{group.topics.join(' · ')}</p>}
                <p>{group.assignments.length} assignment{group.assignments.length === 1 ? '' : 's'} · {group.submitted} submitted</p>
              </div>
              <span className={styles.monthArt} aria-hidden="true"><img src="/assets/monthly-submission-calendar.png" alt="" /></span>
              <div className={styles.monthControls}><label className={styles.monthSelectLabel}>Choose month
                <select value={group.month} onChange={event => select(event.target.value)}>
                  {groups.map(item => <option key={item.month} value={item.month}>
                    {monthName(item.month)}{item.label !== monthName(item.month) ? ` — ${item.label}` : ''}
                  </option>)}
                </select>
              </label><Link className={`${styles.primary} ${styles.extraActivityButton}`} to={`/learner/monthly-submission/${kind}/${id}/extra-activities`}>+ Extra activities</Link></div>
            </section>
            <section className={styles.assignmentSection} aria-label={`Assignments for ${group.label}`}>
              <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Assignments this month</p><h2>{group.label}</h2></div>
                <span>{visibleAssignments.length} of {group.assignments.length} assignments{acceptedExtras.length > 0 && ` · ${visibleExtras.length} of ${acceptedExtras.length} extra activities`}</span></div>
              <div className={styles.statusFilters} role="group" aria-label="Filter assignments by status">
                {(['all', 'accepted', 'rejected'] as const).map(status => <button key={status} type="button"
                  aria-pressed={statusFilter === status} data-filter={status} onClick={() => filterByStatus(status)}>
                  {status === 'all' ? 'All' : status === 'accepted' ? 'Accepted' : 'Rejected'}
                </button>)}
                <button type="button" onClick={extras.refresh} disabled={extras.loading}>Refresh activities</button>
              </div>
              {!group.month && <p className={styles.unscheduled}>These assignments do not have a confirmed Training Plan date yet.</p>}
              {!visibleAssignments.length && !visibleExtras.length && <p className={styles.filterEmpty} role="status">No {statusFilter === 'all' ? '' : `${statusFilter} `}assignments for this month. Choose another filter or month.</p>}
              <div className={styles.assignmentGrid}>{visibleAssignments.map(row => <button type="button" key={row.id}
                className={styles.assignment} aria-pressed={row.id === assignment?.id} onClick={() => select(group.month, row.id)}>
                <span className={styles.assignmentTop}><span className={styles.assignmentIcon}><FileText size={19} aria-hidden="true" /></span>
                  <span className={styles.status} data-status={row.status}>{statusLabels[row.status] || row.status.replaceAll('_', ' ') || 'Status unavailable'}</span></span>
                <strong>{row.component}</strong><span className={styles.assignmentTopic}>{[row.module, row.week].filter(Boolean).join(' · ')}</span>
                {row.submissionCount !== undefined && <span>{row.submissionCount} submission{row.submissionCount === 1 ? '' : 's'}</span>}
                <span className={styles.assignmentBottom}><span>{row.expectedOtjh != null ? `${row.expectedOtjh} OTJ hours` : 'Hours not specified'}</span>
                  <span>{row.id === assignment?.id ? <><CheckCircle2 size={15} aria-hidden="true" />Selected</> : <>View details<ArrowUpRight size={15} aria-hidden="true" /></>}</span></span>
              </button>)}{visibleExtras.map(activity => <button type="button" key={activity.activityId}
                className={styles.assignment} aria-pressed={activity.activityId === selectedExtra?.activityId} onClick={() => select(group.month, activity.activityId)}>
                <span className={styles.assignmentTop}><span className={styles.assignmentIcon}><FileText size={19} aria-hidden="true" /></span>
                  <span className={styles.status} data-status="accepted">Accepted</span></span>
                <strong>Extra Activity · {activity.title}</strong><span className={styles.assignmentTopic}>{monthName(activity.month)}</span>
                <span className={styles.assignmentBottom}><span>{activity.hours ? `${activity.hours} hours claimed` : 'Hours not specified'}</span>
                  <span>{activity.activityId === selectedExtra?.activityId ? <><CheckCircle2 size={15} aria-hidden="true" />Selected</> : <>View details<ArrowUpRight size={15} aria-hidden="true" /></>}</span></span>
              </button>)}</div>
            </section>
            {assignment && <AssignmentDetailsCard assignment={assignment} group={group} kind={kind} learnerId={id} />}
            {selectedExtra && <section className={`${styles.hero} ${styles.extraDetails}`} aria-label="Extra activity details">
              <header className={styles.heroHeader}>
                <div className={styles.heroHeading}><span className={styles.heroIcon}><FileText size={24} aria-hidden="true" /></span>
                  <div><p className={styles.eyebrow}>Your extra activity · {monthName(group.month)}</p><h2>{selectedExtra.title}</h2></div></div>
                <span className={styles.status} data-status="accepted"><CheckCircle2 size={15} aria-hidden="true" />Accepted</span>
              </header>
              <div className={styles.extraDetailsBody}>
                <div className={styles.extraDetailsContent}>
                  <details key={selectedExtra.activityId} className={styles.extraAnswer}>
                    <summary>View submitted activity</summary><div className={styles.extraProse}>{selectedExtra.answer}</div>
                  </details>
                  {selectedExtra.coachFeedback && <section className={styles.extraFeedback} aria-label="Coach feedback">
                    <h3><CheckCircle2 size={19} aria-hidden="true" />Coach feedback</h3><p className={styles.extraProse}>{selectedExtra.coachFeedback}</p>
                  </section>}
                </div>
                <aside className={styles.extraMetadata} aria-label="Extra activity information">
                  <h3>Submission details</h3><dl>
                    <div><dt>Submitted</dt><dd>{selectedExtra.submittedAt ? new Date(selectedExtra.submittedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' }) + ' (UK time)' : 'Date unavailable'}</dd></div>
                    {selectedExtra.hours && <div><dt>Hours claimed</dt><dd>{selectedExtra.hours} {Number(selectedExtra.hours) === 1 ? 'hour' : 'hours'}</dd></div>}
                    {selectedExtra.ksbs.length > 0 && <div><dt>KSBs claimed</dt><dd className={styles.extraKsbTags}>{selectedExtra.ksbs.map((code, index) => <span key={`${code}:${index}`}>{code}</span>)}</dd></div>}
                  </dl>
                </aside>
              </div>
            </section>}
          </> : <div className={styles.empty}><FileText size={28} aria-hidden="true" /><h2>No assignments yet</h2><p>Your assigned monthly work will appear here when it is added to your Training Plan.</p></div>}
        </>}
    </main>
  </WorkspaceShell>;
}
