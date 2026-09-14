import { useEffect, useId, useRef } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock3, FileText, MessageCircle } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import { AssignmentDetailsCard } from './AssignmentDetailsCard';
import { assignmentCounts, monthName, monthlyAssignmentHref, needsAssignmentChanges, nextMonthlyAssignment, statusLabels,
  type AssignmentMonth, type MonthlyAssignmentRow } from './model';
import styles from './monthlySubmission.module.css';

function Status({ row }: { row: MonthlyAssignmentRow }) {
  const finished = ['accepted', 'completed'].includes(row.status);
  return <span className={`${styles.status} ${finished ? styles.positive : needsAssignmentChanges(row) ? styles.changesRequested : ''}`}>
    {finished && <CheckCircle2 size={16} aria-hidden="true" />}
    {row.awaitingBrief ? 'Instructions coming soon' : statusLabels[row.status] || row.status.replaceAll('_', ' ') || 'Status unavailable'}
  </span>;
}

function plannedDate(row: MonthlyAssignmentRow) {
  return row.date ? new Date(`${row.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }) : '';
}

export function MonthlySubmissionOverview({ groups, kind, learnerId, currentMonth }: {
  groups: AssignmentMonth[]; kind: LearnerKind; learnerId: string; currentMonth: string;
}) {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const monthPickerId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const requestedMonth = params.get('month');
  const requestedAssignment = params.get('assignment');
  const linkedGroup = requestedMonth === null && requestedAssignment ? groups.find(item => item.assignments.some(row => row.id === requestedAssignment)) : undefined;
  const selectedMonth = requestedMonth !== null && (requestedMonth === '' || /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth))
    ? requestedMonth : linkedGroup?.month ?? currentMonth;
  const group = groups.find(item => item.month === selectedMonth);
  const assignment = group?.assignments.find(row => row.id === requestedAssignment);
  const isCurrent = selectedMonth === currentMonth;
  const browsing = params.get('view') === 'all' || !isCurrent;
  const monthLabel = monthName(selectedMonth);
  const rows = group?.assignments || [];
  const counts = assignmentCounts(rows);
  const next = nextMonthlyAssignment(rows);
  const others = rows.filter(row => row.id !== next?.id);
  const earlierChanges = groups.filter(item => item.month && item.month < currentMonth)
    .flatMap(item => item.assignments.filter(needsAssignmentChanges));
  const nextMonth = groups.find(item => item.month > currentMonth);
  const viewKey = `${selectedMonth}:${assignment?.id || ''}:${browsing}`;
  const previousView = useRef(viewKey);
  useEffect(() => {
    if (previousView.current !== viewKey) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView?.({ block: 'start' });
    }
    previousView.current = viewKey;
  }, [viewKey]);

  function pageHref(month: string | null, assignmentId?: string, all = false) {
    const query = new URLSearchParams(params);
    query.delete('month'); query.delete('assignment'); query.delete('view');
    if (month !== null) query.set('month', month);
    if (assignmentId) query.set('assignment', assignmentId);
    if (all) query.set('view', 'all');
    return `${pathname}${query.size ? `?${query}` : ''}`;
  }
  const detailsHref = (row: MonthlyAssignmentRow) => pageHref(row.month, row.id, browsing);
  const actionHref = (row: MonthlyAssignmentRow) => needsAssignmentChanges(row) || ['accepted', 'completed'].includes(row.status)
    ? detailsHref(row) : monthlyAssignmentHref(row, kind, learnerId);

  function assignmentRow(row: MonthlyAssignmentRow) {
    return <article key={row.id} aria-label={`${row.component} — ${row.week || row.module || ''}`} className={styles.workRow}>
      <div className={styles.workRowText}>
        <Status row={row} />
        <h3>{row.component}</h3>
        <p>{[row.module, row.week].filter(Boolean).join(' · ')}</p>
        {row.date && <p className={styles.plannedDate}>Planned for {plannedDate(row)}</p>}
      </div>
      <div className={styles.rowActions}>
        {row.awaitingBrief ? <span className={styles.waitingText}>Your coach will add the instructions.</span>
          : <Link className={styles.secondary} to={actionHref(row)}>{row.action}<ArrowRight size={18} aria-hidden="true" /></Link>}
        <Link className={styles.textLink} to={detailsHref(row)}>{row.awaitingBrief ? 'View assignment details' : 'Read instructions'}</Link>
      </div>
    </article>;
  }

  if (assignment && group) return <>
    <Link className={styles.textLink} to={pageHref(selectedMonth, undefined, browsing)}><ArrowLeft size={18} aria-hidden="true" />Back to this month</Link>
    <header className={styles.pageHeader}><div>
      <p className={styles.eyebrow}>{monthLabel}</p>
      <h1 ref={heading} tabIndex={-1}>Assignment instructions</h1>
      <p>Read the task, then continue with your assignment.</p>
    </div></header>
    <AssignmentDetailsCard key={assignment.id} assignment={assignment} group={group} kind={kind} learnerId={learnerId} />
  </>;

  return <>
    <header className={styles.pageHeader}><div>
      <p className={styles.eyebrow}>{browsing ? 'Browse your assignments' : 'Your work this month'}</p>
      <h1 ref={heading} tabIndex={-1}>{monthLabel}</h1>
      <p>{browsing ? 'Choose a month to see its assignments and saved work.' : 'See what needs your attention, then pick up where you left off.'}</p>
    </div>
      <Link className={styles.secondary} to={browsing ? pageHref(null) : pageHref(selectedMonth, undefined, true)}>
        {browsing ? <ArrowLeft size={18} aria-hidden="true" /> : <CalendarDays size={18} aria-hidden="true" />}
        {browsing ? 'Back to current month' : 'View other months'}
      </Link>
    </header>

    {browsing && <div className={styles.monthPicker}>
      <label htmlFor={monthPickerId}>Choose a month</label>
      <select id={monthPickerId} value={selectedMonth} onChange={event => {
        const query = new URLSearchParams(params); query.set('view', 'all'); query.set('month', event.target.value); query.delete('assignment'); setParams(query);
      }}>
        {!groups.some(item => item.month === selectedMonth) && <option value={selectedMonth}>{monthLabel}{isCurrent ? ' — Current month' : ''}</option>}
        {groups.map(item => <option key={item.month} value={item.month}>{monthName(item.month)}{item.month === currentMonth ? ' — Current month' : ''} · {item.assignments.length} assignment{item.assignments.length === 1 ? '' : 's'}</option>)}
      </select>
    </div>}
    {requestedAssignment && !assignment && <p role="alert" className={styles.error}>That assignment could not be found in this month. Choose an assignment below.</p>}
    {group && <section aria-label={`${monthLabel} assignment summary`} className={styles.monthSummary}>
      <div className={styles.summaryHeading}><FileText size={21} aria-hidden="true" /><h2>{counts.total} assignment{counts.total === 1 ? '' : 's'} {isCurrent ? 'this month' : `in ${monthLabel}`}</h2></div>
      {(group.label !== monthLabel || group.topics.length > 0) && <p>{[group.label !== monthLabel ? group.label : '', ...group.topics].filter(Boolean).join(' · ')}</p>}
      <ul className={styles.summaryCounts}>
        <li><strong>{counts.needsWork}</strong> need your work</li>
        <li><strong>{counts.awaitingReview}</strong> awaiting coach review</li>
        <li><strong>{counts.completed}</strong> complete</li>
        {counts.waitingForBrief > 0 && <li><strong>{counts.waitingForBrief}</strong> awaiting instructions</li>}
        {counts.unknown > 0 && <li><strong>{counts.unknown}</strong> status unavailable</li>}
      </ul>
    </section>}

    {!rows.length && <section className={styles.empty} aria-label="No assignments this month">
      <CalendarDays size={30} aria-hidden="true" />
      <h2>No assignments planned for {monthLabel}</h2>
      <p>{groups.length ? 'You can still view assignments from other months.' : 'Your assignments will appear here when they are added to your Training Plan.'}</p>
      {isCurrent && nextMonth && <Link className={styles.secondary} to={pageHref(nextMonth.month, undefined, true)}>View {monthName(nextMonth.month)}<ArrowRight size={18} aria-hidden="true" /></Link>}
    </section>}

    {next && <section className={styles.nextAssignment} aria-label="Your next assignment">
      <div className={styles.nextHeading}><p className={styles.eyebrow}>{needsAssignmentChanges(next) ? 'Your coach has requested changes' : next.status === 'draft' ? 'Pick up where you left off' : 'Start here'}</p><Status row={next} /></div>
      <h2>{next.component}</h2>
      <p className={styles.nextContext}>{[next.module, next.week].filter(Boolean).join(' · ')}</p>
      <p className={styles.nextInstruction}>{needsAssignmentChanges(next) ? 'Read your coach’s feedback, update your work and send it again.'
        : next.status === 'draft' ? 'Your draft is saved. Continue your work when you are ready.'
          : 'Read the instructions, then work through your assignment one step at a time.'}</p>
      <div className={styles.nextMeta}>
        {next.date && <span><CalendarDays size={17} aria-hidden="true" />Planned for {plannedDate(next)}</span>}
        {next.expectedOtjh != null && <span><Clock3 size={17} aria-hidden="true" />{next.expectedOtjh} planned learning hours</span>}
      </div>
      <div className={styles.actions}>
        <Link className={styles.primary} to={actionHref(next)}>{next.action}<ArrowRight size={20} aria-hidden="true" /></Link>
        <Link className={styles.textLink} to={detailsHref(next)}>Read instructions</Link>
      </div>
    </section>}

    {!next && rows.length > 0 && counts.needsWork === 0 && counts.unknown === 0 && counts.waitingForBrief === 0 && <p className={styles.caughtUp}>
      <CheckCircle2 size={22} aria-hidden="true" />{counts.awaitingReview ? 'Your work has been submitted. Your coach’s feedback will appear here.' : 'All assignments for this month are complete.'}
    </p>}

    {others.length > 0 && <section className={styles.workList} aria-label={`Assignments for ${group?.label || monthLabel}`}>
      <h2>{next ? (isCurrent ? 'Other assignments this month' : `Other assignments in ${monthLabel}`) : 'Your assignments'}</h2>
      {!selectedMonth && <p className={styles.unscheduled}>These assignments do not have a confirmed Training Plan date yet.</p>}
      {others.map(assignmentRow)}
    </section>}

    {isCurrent && earlierChanges.length > 0 && <aside className={styles.earlierChanges} aria-label="Changes requested from earlier months">
      <details><summary>{earlierChanges.length} earlier assignment{earlierChanges.length === 1 ? ' needs' : 's need'} changes</summary>
        <p>Your coach’s feedback is ready. These assignments belong to earlier months.</p>
        {earlierChanges.map(row => <div key={row.id}><span><strong>{row.component}</strong><small>{monthName(row.month)}</small></span>
          <Link className={styles.textLink} to={detailsHref(row)}>Read feedback &amp; update<ArrowRight size={18} aria-hidden="true" /></Link></div>)}
      </details>
    </aside>}
    <footer className={styles.supportFooter}><MessageCircle size={20} aria-hidden="true" /><span>Need a hand with your work?</span>
      <Link className={styles.textLink} to={`/learner/calendar?${new URLSearchParams({ book: 'student-support', kind, learner: learnerId })}`}>Book 1:1 coach support</Link>
    </footer>
  </>;
}
