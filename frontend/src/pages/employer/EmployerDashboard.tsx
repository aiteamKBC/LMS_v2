import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowRight, BarChart3, BriefcaseBusiness, CalendarDays, Video, ChevronLeft, ChevronRight, CircleAlert, ClipboardPenLine, Eye, PlayCircle, RotateCcw, Search, Users, Workflow } from 'lucide-react';
import type { EmployerDashboardMetrics, EmployerLearnerCard, EmployerPortal } from '@/api/employerPortal';
import { formatReviewDate, isOpenReview, learnerHref, learnerReviewHref, learnerKey, londonToday, nextReview, relativeReviewDate, reviewDate, reviewMatches, reviewState, riskLabels, riskOf, type DashboardAttendance, type DashboardReviews, type DashboardReviewSummaries, type Loadable } from './employerDashboardData';
import styles from './EmployerPortalPage.module.css';
import { EmployerReviewJourneys } from './EmployerReviewJourneys';
import { EmployerMeetings } from './EmployerMeetings';
import { EmployerModuleOverview } from './EmployerModuleOverview';
import { EmployerLearnerAssessmentCell } from './EmployerLearnerAssessmentCell';
import { learnerRecordedDates } from '@/lib/learnerRecordedDates';
import { formatProgrammeStartDate } from '@/pages/workspace/learner/learnerHeaderPlan';
import { useEmployerLearningSummary } from './useEmployerLearningSummary';
import { EmployerPerformanceCards } from './EmployerPerformance';
import { EmployerModuleColumnChart } from './EmployerModuleColumnChart';
import { EmployerModuleProgressTable } from './EmployerModuleProgressTable';
import { EmployerStatDialog, type StatDialogRow } from './EmployerStatDialog';
import { presentReview } from '@/pages/learner/progress-reviews/reviewPresentation';

/**
 * `home` is the whole overview. The other two are the sidebar's own sections,
 * which used to be query strings that only scrolled this same page.
 */
export type EmployerPortalView = 'home' | 'learners' | 'reviews';
/** The summary card whose records are open in the overview's dialog. */
type StatKey = 'learners' | 'active' | 'reviews' | 'attention';

type Props = {
  data: EmployerPortal;
  metrics: Loadable<EmployerDashboardMetrics>;
  programmeMetrics: Loadable<EmployerDashboardMetrics>;
  attendance: DashboardAttendance;
  reviews: DashboardReviews;
  reviewSummaries: DashboardReviewSummaries;
  onRetry: () => void;
  view?: EmployerPortalView;
  today?: string;
  backAction?: ReactNode;
};
const progressNumber = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const percentLabel = (value: number) => `${progressNumber.format(value)}%`;

function Avatar({ learner }: { learner: EmployerLearnerCard }) {
  const initials = learner.name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  return <span className={styles.avatar} data-tone={Number(learner.id) % 2 ? 'blue' : 'mint'} aria-hidden="true">{initials || '?'}</span>;
}
function Stat({ icon, label, value, help, tone, onClick }: {
  icon: ReactNode; label: string; value: number | string; help: ReactNode; tone: string; onClick?: () => void;
}) {
  const content = <><span className={styles.statIcon}>{icon}</span><span className={styles.statCopy}><span className={styles.statLabel}>{label}</span><strong>{value}</strong></span>{onClick && <span className={styles.statArrow}><ChevronRight size={19} /></span>}</>;
  return onClick ? <button type="button" className={styles.statCard} data-tone={tone} aria-label={`${label}: ${value}${typeof help === 'string' ? `. ${help}` : ''}`} onClick={onClick}>{content}</button>
    : <div className={styles.statCard} data-tone={tone}>{content}</div>;
}
function ProgressBar({ value, label, target }: { value: number; label: string; target?: { percent: number; label: string; details: ReactNode } }) {
  const tooltipId = useId();
  const bar = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const cancelHide = () => { if (hideTimer.current != null) clearTimeout(hideTimer.current); };
  const show = (event: SyntheticEvent<HTMLElement>) => {
    if (!target) return;
    cancelHide();
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const above = rect.top >= 140;
    setPosition({ left: Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2)),
      top: above ? rect.top - 8 : rect.bottom + 8, above });
  };
  const hideSoon = () => {
    cancelHide();
    if (!bar.current?.contains(document.activeElement)) hideTimer.current = setTimeout(() => setPosition(null), 120);
  };
  useEffect(() => () => { if (hideTimer.current != null) clearTimeout(hideTimer.current); }, []);
  useEffect(() => {
    if (!position) return;
    const dismiss = () => setPosition(null);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => { window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss); };
  }, [position]);
  return <div ref={bar} className={styles.progressBar} onMouseEnter={show} onMouseLeave={hideSoon} onFocus={show} onBlur={hideSoon}
    onKeyDown={event => { if (event.key === 'Escape') { cancelHide(); setPosition(null); } }}>
    <div className={styles.progressTrack} role="progressbar" aria-label={label} aria-describedby={position ? tooltipId : undefined} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><span style={{ width: `${value}%` }} /></div>
    {target && <span className={styles.progressTarget} role="img" aria-label={target.label} aria-describedby={position ? tooltipId : undefined} tabIndex={0}
      style={{ left: `${Math.max(0, Math.min(100, target.percent))}%` }} />}
    {target && position && createPortal(<div id={tooltipId} role="tooltip" className={styles.otjTooltip}
      style={{ left: position.left, top: position.top, transform: position.above ? 'translateY(-100%)' : undefined }}
      onMouseEnter={cancelHide} onMouseLeave={hideSoon}>{target.details}</div>, document.body)}
  </div>;
}
function PanelHeader({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return <header className={styles.panelHeader}><h2>{icon}{title}</h2>{action}</header>;
}

export function EmployerDashboard({ data, metrics, attendance: attendanceByLearner, reviews, reviewSummaries, onRetry, view = 'home', today = londonToday(), backAction }: Props) {
  const employerId = data.employer.id;
  const learners = data.learners;
  const learning = useEmployerLearningSummary(employerId, learners, view === 'home' || view === 'learners');
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  // Keep section filters bookmarkable and reloadable through their URL.
  const paramProgramme = params.get('programme') || '';
  const paramStatus = params.get('status') || '';
  const paramUpcoming = params.get('upcoming') || 'any';
  const [query, setQuery] = useState('');
  const [tableNameFilter, setTableNameFilter] = useState('');
  const [programme, setProgramme] = useState(paramProgramme);
  const [cohort, setCohort] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [progress, setProgress] = useState('');
  const [status, setStatus] = useState(paramStatus);
  const [upcoming, setUpcoming] = useState(paramUpcoming);
  const [page, setPage] = useState(1);
  useEffect(() => {
    setQuery('');
    setCohort('');
    setModuleFilter('');
    setProgress('');
    setProgramme(paramProgramme);
    setStatus(paramStatus);
    setUpcoming(paramUpcoming);
    setPage(1);
  }, [view, paramProgramme, paramStatus, paramUpcoming]);
  useEffect(() => { setPage(1); }, [query, programme, cohort, moduleFilter, status, progress, upcoming]);
  const clearFilters = () => {
    setQuery(''); setProgress(''); setProgramme(''); setCohort(''); setModuleFilter(''); setStatus(''); setUpcoming('any'); setPage(1);
    setTableNameFilter('');
    // Keep the address honest: a cleared form must not be reapplied on reload.
    if (params.toString()) setParams({}, { replace: true });
  };
  const modulesLoading = learners.some(learner => !learning.records[learnerKey(learner)] || learning.records[learnerKey(learner)].status === 'loading');
  const moduleOptions = [...new Map(learners.flatMap(learner => learning.records[learnerKey(learner)]?.data?.programme || [])
    .map(module => [module.id, module])).values()].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const filtered = learners.filter(learner => {
    const term = query.trim().toLocaleLowerCase();
    if (term && ![learner.name, learner.email, learner.programme, learner.cohort].some(value => value.toLocaleLowerCase().includes(term))) return false;
    if (programme && learner.programme !== programme) return false;
    if (cohort && learner.cohort !== cohort) return false;
    if ((view === 'home' || view === 'learners') && moduleFilter && !learning.records[learnerKey(learner)]?.data?.programme.some(module => module.id === moduleFilter)) return false;
    if (status === 'active' && !learner.isActive) return false;
    if (status === 'inactive' && learner.isActive) return false;
    const risk = riskOf(metrics.data, learner);
    if (view === 'learners' && progress && risk !== progress) return false;
    if (status === 'attention' && !['need-attention', 'at-risk'].includes(risk)) return false;
    if (status && !['active', 'inactive', 'attention'].includes(status) && risk !== status) return false;
    const resource = reviews[learnerKey(learner)];
    return upcoming === 'any' || (resource?.status === 'ready' && reviewMatches(resource.data || [], upcoming, today));
  });
  const tableFiltered = filtered.filter(learner => learner.name.toLocaleLowerCase().includes(tableNameFilter.trim().toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(tableFiltered.length / 8));
  const currentPage = Math.min(page, pages);
  const rows = tableFiltered.slice((currentPage - 1) * 8, currentPage * 8);
  const active = learners.filter(learner => learner.isActive).length;
  const reviewSummaryReady = learners.every(learner => reviewSummaries[learnerKey(learner)]?.status === 'ready');
  const reviewSummaryFailed = learners.some(learner => reviewSummaries[learnerKey(learner)]?.status === 'error');
  const reviewsFailed = learners.some(learner => reviews[learnerKey(learner)]?.status === 'error');
  const attendanceFailed = learners.some(learner => attendanceByLearner[learnerKey(learner)]?.status === 'error');
  const due = learners.reduce((total, learner) => total + (reviewSummaries[learnerKey(learner)]?.data || []).filter(event => isOpenReview(event) && reviewDate(event)?.slice(0, 7) === today.slice(0, 7)).length, 0);
  const knownRisks = learners.filter(learner => learner.isActive && riskOf(metrics.data, learner) !== 'unavailable');
  const attention = knownRisks.filter(learner => ['need-attention', 'at-risk'].includes(riskOf(metrics.data, learner))).length;
  const attentionAvailable = metrics.status === 'ready' && knownRisks.length === active;
  const buckets = [
    { key: 'on-track', label: 'On track', color: 'var(--employer-primary)' },
    { key: 'need-attention', label: 'Needs attention', color: 'var(--employer-warning)' },
    { key: 'at-risk', label: 'At risk', color: 'var(--employer-danger)' },
    { key: 'unavailable', label: 'Not available', color: 'var(--employer-muted)' },
  ].map(bucket => ({ ...bucket, count: filtered.filter(learner => riskOf(metrics.data, learner) === bucket.key).length }));
  let offset = 0;
  const gradient = buckets.map(bucket => {
    const start = offset;
    offset += filtered.length ? bucket.count / filtered.length * 100 : 0;
    return `${bucket.color} ${start}% ${offset}%`;
  }).join(', ');
  const isHome = view === 'home';
  const signatures = filtered.reduce((total, learner) => total + (reviews[learnerKey(learner)]?.data || []).filter(event => reviewState(event) === 'signature').length, 0);
  const organisation = data.employer.name || 'your organisation';
  // Each summary card opens its own records here instead of navigating away.
  const [openStat, setOpenStat] = useState<StatKey | null>(null);
  const learnerRow = (learner: EmployerLearnerCard, meta: string): StatDialogRow => ({
    id: learnerKey(learner),
    primary: learner.name,
    secondary: [learner.programme, learner.cohort].filter(Boolean).join(' · '),
    meta,
  });
  // The summary read behind the card carries dates and status only, so the
  // join link comes from the full review this dashboard already loads for the
  // meetings panel. Same rule as there: Microsoft has to have confirmed the
  // invitation before a join link is offered.
  const reviewRowActions = (learner: EmployerLearnerCard, eventKey: string) => {
    const full = (reviews[learnerKey(learner)]?.data || []).find(event => event.eventKey === eventKey);
    const presentation = full && presentReview(full, undefined, today, undefined, 'employer');
    const syncPending = Boolean(full && (full.invited === false || (full.syncState && full.syncState !== 'synced')));
    const joinUrl = presentation && !syncPending ? presentation.joinUrl : null;
    return <>
      {joinUrl
        ? <a className={styles.viewButton} href={joinUrl} target="_blank" rel="noopener noreferrer"
          aria-label={`Join ${learner.name}: ${full?.title || 'progress review'}`}><Video size={15} />Join meeting</a>
        : <span className={styles.unavailable}>{syncPending ? 'Invitation not confirmed. Contact your coach.'
          : !full ? 'Meeting details still loading.' : 'Meeting link not available yet.'}</span>}
      <Link className={`${styles.textButton} ${styles.reviewActionLink}`} to={learnerReviewHref(employerId, learner, eventKey)}
        state={location.state} onClick={() => setOpenStat(null)}>View review</Link>
    </>;
  };
  const statDialogs: Record<StatKey, { title: string; caption: string; emptyMessage: string; rows: StatDialogRow[] }> = {
    learners: {
      title: 'Total learners',
      caption: `Every learner linked to ${organisation}`,
      emptyMessage: 'No learners are linked to your organisation yet.',
      rows: learners.map(learner => learnerRow(learner, learner.programmeStatus || 'No status recorded')),
    },
    active: {
      title: 'Active on programme',
      caption: 'Learners currently active on their programme',
      emptyMessage: 'None of your learners are active on programme right now.',
      rows: learners.filter(learner => learner.isActive)
        .map(learner => learnerRow(learner, learner.programmeStatus || 'Active')),
    },
    reviews: {
      title: 'Reviews due this month',
      caption: 'Open progress reviews dated this month',
      emptyMessage: 'No progress reviews are due this month.',
      rows: learners.flatMap(learner => (reviewSummaries[learnerKey(learner)]?.data || [])
        .filter(event => isOpenReview(event) && reviewDate(event)?.slice(0, 7) === today.slice(0, 7))
        .map(event => ({
          id: `${learnerKey(learner)}-${event.eventKey || event.id}`,
          primary: learner.name,
          secondary: event.title,
          meta: formatReviewDate(reviewDate(event)),
          action: reviewRowActions(learner, event.eventKey),
        }))),
    },
    attention: {
      title: 'Needs attention',
      caption: 'Learners whose saved OTJ status needs attention or is at risk',
      emptyMessage: 'No learner needs attention on their saved OTJ status.',
      rows: knownRisks.filter(learner => ['need-attention', 'at-risk'].includes(riskOf(metrics.data, learner)))
        .map(learner => learnerRow(learner, riskLabels[riskOf(metrics.data, learner) as keyof typeof riskLabels])),
    },
  };

  const learnersPanel = <section className={styles.panel} aria-labelledby="employer-learners">
    <header className={styles.panelHeader}>
      <h2 id="employer-learners" tabIndex={-1}><Users size={21} />Your learners ({tableFiltered.length})</h2>
      <div className={styles.panelHeaderActions}>
        <label data-search-field className={styles.panelNameFilter}><Search size={15} aria-hidden="true" /><span className="sr-only">Filter learners by name</span><input type="search" value={tableNameFilter} onChange={event => { setTableNameFilter(event.target.value); setPage(1); }} placeholder="Filter by name" /></label>
        {tableFiltered.length !== learners.length && <span className={styles.caption}>{learners.length} in total</span>}
      </div>
    </header>
    {learners.some(learner => learning.records[learnerKey(learner)]?.status === 'error') && <div className={styles.dataNotice} role="alert"><CircleAlert size={18} /><p>Some module and assessment records could not be loaded. Available learner details are still shown.</p><button type="button" onClick={learning.retry}>Retry learning data</button></div>}
    {!tableFiltered.length && moduleFilter && modulesLoading ? <LoadingSkeleton label="Loading module learners" variant="cards" /> : !tableFiltered.length ? <div className={styles.emptyState}><Users size={30} /><h3>{tableNameFilter && filtered.length ? 'No learners match that name' : learners.length ? 'No matching learners' : 'No learners linked yet'}</h3><p>{tableNameFilter && filtered.length ? 'Try another name or clear this filter.' : learners.length ? 'Try another search or clear your filters.' : 'Linked learners and their progress will appear here.'}</p>{tableNameFilter && filtered.length ? <button type="button" className={styles.textButton} onClick={() => setTableNameFilter('')}>Clear name filter</button> : learners.length > 0 && <button type="button" className={styles.textButton} onClick={clearFilters}>Clear filters</button>}</div>
      : <><div className={styles.tableScroll} role="region" aria-label="Employer learners" tabIndex={0}><table className={styles.learnerTable}><thead><tr>{['Learner', 'Programme', 'Cohort', 'Start date', 'End date', 'Assessment', 'OTJ Progress', 'Attendance', 'Next review', 'Status', 'Actions'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{rows.map(learner => {
        const dates = learnerRecordedDates(learner);
        const resource = reviews[learnerKey(learner)];
        const event = nextReview(resource?.data);
        const date = event ? reviewDate(event) : null;
        const otjh = learner.otjhProgress;
        const percent = otjh?.percent != null && Number.isFinite(otjh.percent) ? otjh.percent : null;
        const target = otjh?.targetToDate != null && Number.isFinite(otjh.targetToDate) && otjh.targetToDate >= 0
          && otjh.planned != null && Number.isFinite(otjh.planned) && otjh.planned > 0
          ? { percent: otjh.targetToDate / otjh.planned * 100,
            label: `${learner.name} OTJ target today: ${progressNumber.format(otjh.targetToDate)} hours (${percentLabel(otjh.targetToDate / otjh.planned * 100)})`,
            details: <><div className={styles.otjTooltipHeading}>OTJ progress</div><dl>
              <div><dt>Actual</dt><dd>{otjh.actual == null ? 'Unavailable' : `${progressNumber.format(otjh.actual)} h (${percentLabel(percent!)})`}</dd></div>
              <div className={styles.otjTooltipTarget}><dt>Target today</dt><dd>{progressNumber.format(otjh.targetToDate)} h ({percentLabel(otjh.targetToDate / otjh.planned * 100)})</dd></div>
              <div><dt>Total planned</dt><dd>{progressNumber.format(otjh.planned)} h</dd></div>
            </dl></> }
          : undefined;
        const attendanceResource = attendanceByLearner[learnerKey(learner)];
        const attendance = attendanceResource?.data;
        const attendancePercent = attendance && attendance.sessions > 0 && Number.isFinite(attendance.attendanceRate)
          ? attendance.attendanceRate : null;
        const attendanceMode = attendance?.mode === 'mixed' ? 'Live + Recorded'
          : attendance?.mode === 'recorded' ? 'Recorded' : 'Live Session';
        const attendanceHelp = attendance?.mode === 'recorded' ? 'Completed recordings / planned Live Sessions in the current Training Plan'
          : attendance?.mode === 'mixed' ? 'Live attendance plus completed recordings / planned Live Sessions in the current Training Plan; each session counts once'
          : 'Live attendance / planned Live Sessions in the current Training Plan; includes late attendance and completed catch-up';
        const risk = riskOf(metrics.data, learner);
        return <tr key={learnerKey(learner)}>
          <td><div className={styles.identity}><Avatar learner={learner} /><div><Link to={learnerHref(employerId, learner)} state={location.state} className={styles.learnerName}>{learner.name}</Link><small>{learner.email}</small></div></div></td>
          <td>{learner.programme || 'Not assigned'}</td><td>{learner.cohort || 'Not assigned'}</td>
          <td className={styles.learnerDate}>{dates.start ? formatProgrammeStartDate(dates.start) : <span className={styles.unavailable}>Not recorded</span>}</td>
          <td className={styles.learnerDate}>{dates.end ? formatProgrammeStartDate(dates.end) : <span className={styles.unavailable}>Not recorded</span>}</td>
          <EmployerLearnerAssessmentCell employerId={employerId} learner={learner} resource={learning.records[learnerKey(learner)]} />
          <td><div className={styles.progressCell}>
            {percent != null ? <><strong>{percentLabel(percent)}</strong><ProgressBar value={Math.max(0, Math.min(100, percent))} label={`${learner.name} OTJ progress`} target={target} /></>
              : <span className={styles.unavailable}>Not available</span>}
            {otjh && <small title="Completed OTJ hours / total planned hours">{otjh.actual == null ? '—' : progressNumber.format(otjh.actual)} / {otjh.planned == null ? '—' : progressNumber.format(otjh.planned)} OTJ hours</small>}
          </div></td>
          <td>{attendancePercent != null ? <div className={styles.progressCell} title={attendanceHelp}>
            <div className={styles.attendanceHeading}><strong>{percentLabel(attendancePercent)}</strong>
              <span className={styles.attendanceMode}>{attendanceMode}</span></div>
            <ProgressBar value={attendancePercent} label={`${learner.name} attendance`} />
            <small>{progressNumber.format(attendance!.present)} / {progressNumber.format(attendance!.sessions)} sessions</small>
            {attendance?.mode === 'mixed' && <small>{progressNumber.format(attendance.livePresent ?? 0)} Live + {progressNumber.format(attendance.recordedPresent ?? 0)} Recorded</small>}
          </div> : <span className={styles.unavailable}>{!attendanceResource || attendanceResource.status === 'loading' ? <LoadingSkeleton label="Loading…" variant="text" /> : attendanceResource.status === 'ready' && attendance === null ? 'No attendance records yet' : 'Not available'}</span>}</td>
          <td><div className={styles.reviewCell}>{resource?.status === 'ready' ? event ? <><Link to={learnerHref(employerId, learner, 'reviews')} state={location.state}><CalendarDays size={14} />{formatReviewDate(date)}</Link><small>{relativeReviewDate(date, today)}</small></> : <span className={styles.unavailable}>No upcoming review</span> : <span className={styles.unavailable}>{resource?.status === 'error' ? 'Not available' : <LoadingSkeleton label="Loading…" variant="text" />}</span>}</div></td>
          <td><span className={styles.statusBadge} data-status={risk}><span />{risk !== 'unavailable' ? riskLabels[risk] : learner.programmeStatus || 'Not set'}</span>{risk === 'unavailable' && <small className={styles.statusHelp}>OTJ status unavailable</small>}</td>
          <td><Link className={styles.viewButton} aria-label={`View ${learner.name}`} to={learnerHref(employerId, learner)} state={location.state}><Eye size={14} />View learner</Link></td>
        </tr>;
      })}</tbody></table></div>{pages > 1 && <nav className={styles.pagination} aria-label="Learner pages"><span>Page {currentPage} of {pages}</span><button type="button" aria-label="Previous learner page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={17} /></button><button type="button" aria-label="Next learner page" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={17} /></button></nav>}</>}
  </section>;

  const progressPanel = <section className={styles.panel} aria-label="Learner progress overview"><PanelHeader icon={<BarChart3 size={21} />} title="Learner progress overview" /><p className={styles.chartCaption}>OTJ hours against the current target</p><div className={styles.donutContent}><div className={styles.donut} style={{ '--donut-gradient': filtered.length ? `conic-gradient(${gradient})` : 'var(--employer-soft)' } as CSSProperties} role="img" aria-label={buckets.map(bucket => `${bucket.label}: ${bucket.count}`).join(', ')}><div><strong>{filtered.length}</strong><span>learners</span></div></div><ul className={styles.legend}>{buckets.map(bucket => <li key={bucket.key}><span className={styles.legendDot} style={{ backgroundColor: bucket.color }} /><span>{bucket.label}</span><strong>{bucket.count} <span>({filtered.length ? Math.round(bucket.count / filtered.length * 100) : 0}%)</span></strong></li>)}</ul></div></section>;

  const learnerFilters = <form className={styles.filters} aria-label="Filter learners" onSubmit={event => event.preventDefault()}>
      <label data-search-field className={styles.searchBox}><Search size={22} /><span className="sr-only">Search learners</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search learners by name or email..." /></label>
      <label className={styles.filterLabel}>Programme<select value={programme} onChange={event => setProgramme(event.target.value)}><option value="">All programmes</option>{[...new Set(learners.map(learner => learner.programme).filter(Boolean))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
      <label className={styles.filterLabel}>Cohort<select value={cohort} onChange={event => setCohort(event.target.value)}><option value="">All cohorts</option>{[...new Set(learners.map(learner => learner.cohort).filter(Boolean))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
      {(isHome || view === 'learners') && <label className={styles.filterLabel}>Module<select value={moduleFilter} onChange={event => setModuleFilter(event.target.value)} disabled={modulesLoading || !moduleOptions.length} aria-busy={modulesLoading}>
        <option value="">{modulesLoading ? 'Loading modules…' : moduleOptions.length ? 'All modules' : 'No modules available'}</option>
        {moduleFilter && !moduleOptions.some(module => module.id === moduleFilter) && <option value={moduleFilter}>Selected module (unavailable)</option>}
        {moduleOptions.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}
      </select></label>}
      {view === 'learners' && <label className={styles.filterLabel}>Progress<select value={progress} onChange={event => setProgress(event.target.value)}><option value="">All progress</option><option value="on-track">On track</option><option value="need-attention">Needs attention</option><option value="at-risk">At risk</option><option value="unavailable">Not available</option></select></label>}
      <label className={styles.filterLabel}>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option><option value="active">Active on programme</option><option value="inactive">Not active</option><option value="on-track">On track</option><option value="attention">Needs attention or at risk</option><option value="need-attention">Needs attention</option><option value="at-risk">At risk</option><option value="unavailable">OTJ status unavailable</option></select></label>
      <label className={styles.filterLabel}>Upcoming review<select value={upcoming} onChange={event => setUpcoming(event.target.value)}><option value="any">Any time</option><option value="month">This month</option><option value="30">Next 30 days</option><option value="overdue">Overdue</option><option value="signature">Needs my signature</option><option value="none">No date scheduled</option></select></label>
      <button type="button" className={styles.clearButton} onClick={clearFilters}><RotateCcw size={18} />Clear filters</button>
    </form>;

  return <div id="employer-dashboard" className={styles.page} data-view={view} data-employer-theme>
    {isHome ? <section className={styles.hero} aria-labelledby="employer-portal-title">
      <div className={styles.heroIdentity}><span className={styles.heroIcon}><BriefcaseBusiness size={22} aria-hidden="true" /></span><div><p className={styles.greeting}>Overview</p><h1 id="employer-portal-title">{data.employer.name || 'Employer'}</h1><p className={styles.organisation}>{data.employer.employerGroupNames.join(', ') || 'No organisation'}</p></div></div>
      {backAction}
    </section>
      : <section className={styles.sectionHero} aria-labelledby="employer-portal-title">
        <span className={styles.sectionIcon}>{view === 'learners' ? <Users size={27} aria-hidden="true" /> : <Workflow size={27} aria-hidden="true" />}</span>
        <div>
          <p className={styles.sectionEyebrow}>{organisation}</p>
          <h1 id="employer-portal-title">{view === 'learners' ? 'My learners' : 'Progress reviews'}</h1>
          <p className={styles.sectionLead}>{view === 'learners'
            ? `Search, filter and open any of the ${learners.length} learner${learners.length === 1 ? '' : 's'} linked to ${organisation}.`
            : `Every progress review planned for your learners${signatures ? `, including ${signatures} waiting for your signature` : ''}.`}</p>
        </div>
        <Link className={styles.sectionBack} to={`/employers/${employerId}`} state={location.state}><ArrowRight size={14} />Back to overview</Link>{backAction}
      </section>}

    {openStat && <EmployerStatDialog {...statDialogs[openStat]} onClose={() => setOpenStat(null)} />}
    {isHome && <section className={styles.statsGrid} aria-label="Learner summary">
      <Stat icon={<Users />} label="Total learners" value={learners.length} help="Linked to your organisation" tone="purple" onClick={() => setOpenStat('learners')} />
      <Stat icon={<PlayCircle />} label="Active on programme" value={active} help={learners.length ? `${Math.round(active / learners.length * 100)}% of all your learners` : 'No learners linked yet'} tone="green" onClick={() => setOpenStat('active')} />
      <Stat icon={<ClipboardPenLine />} label="Reviews due this month" value={reviewSummaryReady ? due : reviewSummaryFailed ? 'Unavailable' : '…'} help={reviewSummaryReady ? 'Open progress reviews' : reviewSummaryFailed ? 'Review data could not be loaded' : <LoadingSkeleton label={'Loading review dates'} />} tone="amber" onClick={reviewSummaryReady ? () => setOpenStat('reviews') : undefined} />
      <Stat icon={<CircleAlert />} label="Needs attention" value={attentionAvailable ? attention : metrics.status === 'loading' ? '…' : 'Unavailable'} help={attentionAvailable ? 'Saved learner OTJ status' : metrics.status === 'loading' ? <LoadingSkeleton label={'Loading learner OTJ status'} /> : 'OTJ status not available for all learners'} tone="rose" onClick={attentionAvailable ? () => setOpenStat('attention') : undefined} />
    </section>}

    {isHome && <EmployerPerformanceCards employerId={employerId} learners={filtered} records={learning.records} attendance={attendanceByLearner} reviews={reviews} />}

    {(metrics.status === 'error' || reviewsFailed || attendanceFailed) && <div className={styles.dataNotice} role="alert"><CircleAlert size={18} /><p>{metrics.status === 'error' && 'Learner status could not be loaded. '}{attendanceFailed && 'Some attendance records could not be loaded. '}{reviewsFailed && 'Some progress reviews could not be loaded. '}Available records are still shown.</p><button type="button" onClick={onRetry}>Try again</button></div>}
    {(isHome || view === 'reviews') && <EmployerMeetings employerId={employerId} learners={learners} reviews={reviews} today={today} returnState={location.state} />}
    {isHome ? <EmployerModuleOverview employerId={employerId} learners={learners} filtered={filtered} filters={learnerFilters} records={learning.records} onRetry={learning.retry} moduleId={moduleFilter} /> : learnerFilters}
    {isHome && moduleFilter && learners.some(learner => learning.records[learnerKey(learner)]?.status === 'error') && <div className={styles.dataNotice} role="alert"><CircleAlert size={18} /><p>Some module records could not be loaded. Only learners confirmed in the selected module are shown.</p><button type="button" onClick={learning.retry}>Retry module membership</button></div>}
    {isHome && <EmployerModuleColumnChart learners={filtered} records={learning.records} moduleId={moduleFilter} />}
    {isHome && <EmployerModuleProgressTable employerId={employerId} learners={filtered} records={learning.records} moduleId={moduleFilter} onRetry={learning.retry} />}
    {view === 'learners' && <>{progressPanel}{learnersPanel}</>}
    {(isHome || view === 'reviews') && (isHome && moduleFilter && modulesLoading
      ? <LoadingSkeleton label="Loading module learners" variant="cards" />
      : <EmployerReviewJourneys employerId={employerId} learners={filtered}
        totalLearners={learners.length} reviews={reviews} onRetry={onRetry} onClearFilters={clearFilters} />)}
  </div>;
}
