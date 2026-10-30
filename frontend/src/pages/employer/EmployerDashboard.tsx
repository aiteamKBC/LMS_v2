import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, BarChart3, BriefcaseBusiness, CalendarDays, Check, Video, ChevronLeft, ChevronRight, CircleAlert, ClipboardPenLine, Eye, GraduationCap, PlayCircle, RotateCcw, Search, Users, Workflow } from 'lucide-react';
import type { EmployerDashboardMetrics, EmployerLearnerCard, EmployerPortal } from '@/api/employerPortal';
import { formatReviewDate, greeting, isOpenReview, learnerHref, learnerReviewHref, learnerKey, londonToday, nextReview, orderReviewJourney, programmeAverages, relativeReviewDate, reviewDate, reviewLabels, reviewMatches, reviewState, riskLabels, riskOf, type DashboardAttendance, type DashboardReviews, type DashboardReviewSummaries, type Loadable } from './employerDashboardData';
import styles from './EmployerPortalPage.module.css';
import { EmployerReviewJourneys } from './EmployerReviewJourneys';
import { EmployerMeetings } from './EmployerMeetings';
import { EmployerStatDialog, type StatDialogRow } from './EmployerStatDialog';
import { presentReview } from '@/pages/learner/progress-reviews/reviewPresentation';
import { isAptemReview } from '@/pages/learner/progress-reviews/reviewPresentation';
import selection from '@/pages/learner/reviews/reviewMarkerSelection.module.css';

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
  icon: ReactNode; label: string; value: number | string; help: string; tone: string; onClick?: () => void;
}) {
  const content = <><span className={styles.statIcon}>{icon}</span><span className={styles.statCopy}><span className={styles.statLabel}>{label}</span><strong>{value}</strong><small>{help}</small></span>{onClick && <span className={styles.statArrow}><ChevronRight size={19} /></span>}</>;
  return onClick ? <button type="button" className={styles.statCard} data-tone={tone} aria-label={`${label}: ${value}. ${help}`} onClick={onClick}>{content}</button>
    : <div className={styles.statCard} data-tone={tone}>{content}</div>;
}
function ProgressBar({ value, label }: { value: number; label: string }) {
  return <div className={styles.progressTrack} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><span style={{ width: `${value}%` }} /></div>;
}
function PanelHeader({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return <header className={styles.panelHeader}><h2>{icon}{title}</h2>{action}</header>;
}

export function EmployerDashboard({ data, metrics, programmeMetrics, attendance: attendanceByLearner, reviews, reviewSummaries, onRetry, view = 'home', today = londonToday(), backAction }: Props) {
  const employerId = data.employer.id;
  const learners = data.learners;
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // A stat card or programme bar opens its section with a filter already
  // applied. That intent travels in the URL so it survives the navigation --
  // and whether or not the route change remounts this component -- which also
  // leaves the filtered section bookmarkable and reloadable.
  const paramProgramme = params.get('programme') || '';
  const paramStatus = params.get('status') || '';
  const paramUpcoming = params.get('upcoming') || 'any';
  const [query, setQuery] = useState('');
  const [tableNameFilter, setTableNameFilter] = useState('');
  const [journeyNameFilter, setJourneyNameFilter] = useState('');
  const [programme, setProgramme] = useState(paramProgramme);
  const [cohort, setCohort] = useState('');
  const [status, setStatus] = useState(paramStatus);
  const [upcoming, setUpcoming] = useState(paramUpcoming);
  const [page, setPage] = useState(1);
  useEffect(() => {
    setQuery('');
    setCohort('');
    setProgramme(paramProgramme);
    setStatus(paramStatus);
    setUpcoming(paramUpcoming);
    setPage(1);
  }, [paramProgramme, paramStatus, paramUpcoming]);
  useEffect(() => { setPage(1); }, [query, programme, cohort, status, upcoming]);
  const clearFilters = () => {
    setQuery(''); setProgramme(''); setCohort(''); setStatus(''); setUpcoming('any'); setPage(1);
    setTableNameFilter(''); setJourneyNameFilter('');
    // Keep the address honest: a cleared form must not be reapplied on reload.
    if (params.toString()) setParams({}, { replace: true });
  };
  const openSection = (section: 'learners' | 'reviews', filter: { programme?: string; status?: string; upcoming?: string } = {}) => {
    setQuery('');
    setCohort('');
    setTableNameFilter(''); setJourneyNameFilter('');
    setPage(1);
    setProgramme(filter.programme || '');
    setStatus(filter.status || '');
    setUpcoming(filter.upcoming || 'any');
    const search = new URLSearchParams(filter as Record<string, string>).toString();
    navigate(`/employers/${employerId}/${section}${search ? `?${search}` : ''}`, { state: location.state });
  };
  const filtered = learners.filter(learner => {
    const term = query.trim().toLocaleLowerCase();
    if (term && ![learner.name, learner.email, learner.programme, learner.cohort].some(value => value.toLocaleLowerCase().includes(term))) return false;
    if (programme && learner.programme !== programme) return false;
    if (cohort && learner.cohort !== cohort) return false;
    if (status === 'active' && !learner.isActive) return false;
    if (status === 'inactive' && learner.isActive) return false;
    const risk = riskOf(metrics.data, learner);
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
  const programmeFailed = view === 'home' && programmeMetrics.status === 'error';
  const due = learners.reduce((total, learner) => total + (reviewSummaries[learnerKey(learner)]?.data || []).filter(event => isOpenReview(event) && reviewDate(event)?.slice(0, 7) === today.slice(0, 7)).length, 0);
  const knownRisks = learners.filter(learner => learner.isActive && riskOf(metrics.data, learner) !== 'unavailable');
  const attention = knownRisks.filter(learner => ['need-attention', 'at-risk'].includes(riskOf(metrics.data, learner))).length;
  const attentionAvailable = metrics.status === 'ready' && knownRisks.length === active;
  const actions = filtered.filter(learner => learner.outstandingCount > 0);
  const actionsCount = actions.reduce((total, learner) => total + learner.outstandingCount, 0);
  const programmes = programmeAverages(filtered, programmeMetrics.data);
  const buckets = [
    { key: 'on-track', label: 'On track', color: '#00a778' },
    { key: 'need-attention', label: 'Needs attention', color: '#edb51c' },
    { key: 'at-risk', label: 'At risk', color: '#fa3e7c' },
    { key: 'unavailable', label: 'Not available', color: '#babbd1' },
  ].map(bucket => ({ ...bucket, count: filtered.filter(learner => riskOf(metrics.data, learner) === bucket.key).length }));
  let offset = 0;
  const gradient = buckets.map(bucket => {
    const start = offset;
    offset += filtered.length ? bucket.count / filtered.length * 100 : 0;
    return `${bucket.color} ${start}% ${offset}%`;
  }).join(', ');
  const isHome = view === 'home';
  const journeyMatches = filtered.filter(learner => learner.name.toLocaleLowerCase().includes(journeyNameFilter.trim().toLocaleLowerCase()));
  const journeyLearners = view === 'reviews' ? journeyMatches : journeyMatches.slice(0, 2);
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
        <label className={styles.panelNameFilter}><Search size={15} aria-hidden="true" /><span className="sr-only">Filter learners by name</span><input type="search" value={tableNameFilter} onChange={event => { setTableNameFilter(event.target.value); setPage(1); }} placeholder="Filter by name" /></label>
        {tableFiltered.length !== learners.length && <span className={styles.caption}>{learners.length} in total</span>}
      </div>
    </header>
    {!tableFiltered.length ? <div className={styles.emptyState}><Users size={30} /><h3>{tableNameFilter && filtered.length ? 'No learners match that name' : learners.length ? 'No matching learners' : 'No learners linked yet'}</h3><p>{tableNameFilter && filtered.length ? 'Try another name or clear this filter.' : learners.length ? 'Try another search or clear your filters.' : 'Linked learners and their progress will appear here.'}</p>{tableNameFilter && filtered.length ? <button type="button" className={styles.textButton} onClick={() => setTableNameFilter('')}>Clear name filter</button> : learners.length > 0 && <button type="button" className={styles.textButton} onClick={clearFilters}>Clear filters</button>}</div>
      : <><div className={styles.tableScroll} role="region" aria-label="Employer learners" tabIndex={0}><table className={styles.learnerTable}><thead><tr>{['Learner', 'Programme', 'Cohort', 'OTJ Progress', 'Attendance', 'Next review', 'Status', 'Actions'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{rows.map(learner => {
        const resource = reviews[learnerKey(learner)];
        const event = nextReview(resource?.data);
        const date = event ? reviewDate(event) : null;
        const otjh = learner.otjhProgress;
        const percent = otjh?.percent != null && Number.isFinite(otjh.percent) ? otjh.percent : null;
        const attendanceResource = attendanceByLearner[learnerKey(learner)];
        const attendance = attendanceResource?.data;
        const attendancePercent = attendance && attendance.sessions > 0 && Number.isFinite(attendance.attendanceRate)
          ? attendance.attendanceRate : null;
        const risk = riskOf(metrics.data, learner);
        return <tr key={learnerKey(learner)}>
          <td><div className={styles.identity}><Avatar learner={learner} /><div><Link to={learnerHref(employerId, learner)} state={location.state} className={styles.learnerName}>{learner.name}</Link><small>{learner.email}</small></div></div></td>
          <td>{learner.programme || 'Not assigned'}</td><td>{learner.cohort || 'Not assigned'}</td>
          <td><div className={styles.progressCell}>
            {percent != null ? <><strong>{percentLabel(percent)}</strong><ProgressBar value={Math.max(0, Math.min(100, percent))} label={`${learner.name} OTJ progress`} /></>
              : <span className={styles.unavailable}>Not available</span>}
            {otjh && <small title="Completed OTJ hours / total planned hours">{otjh.actual == null ? '—' : progressNumber.format(otjh.actual)} / {otjh.planned == null ? '—' : progressNumber.format(otjh.planned)} OTJ hours</small>}
          </div></td>
          <td>{attendancePercent != null ? <div className={styles.progressCell} title="Includes late attendance and completed catch-up">
            <strong>{percentLabel(attendancePercent)}</strong><ProgressBar value={attendancePercent} label={`${learner.name} attendance`} />
            <small>{progressNumber.format(attendance!.present)} / {progressNumber.format(attendance!.sessions)} sessions</small>
          </div> : <span className={styles.unavailable}>{!attendanceResource || attendanceResource.status === 'loading' ? 'Loading…' : attendanceResource.status === 'ready' && attendance === null ? 'No attendance records yet' : 'Not available'}</span>}</td>
          <td><div className={styles.reviewCell}>{resource?.status === 'ready' ? event ? <><Link to={learnerHref(employerId, learner, 'reviews')} state={location.state}><CalendarDays size={14} />{formatReviewDate(date)}</Link><small>{relativeReviewDate(date, today)}</small></> : <span className={styles.unavailable}>No upcoming review</span> : <span className={styles.unavailable}>{resource?.status === 'error' ? 'Not available' : 'Loading…'}</span>}</div></td>
          <td><span className={styles.statusBadge} data-status={risk}><span />{risk !== 'unavailable' ? riskLabels[risk] : learner.programmeStatus || 'Not set'}</span>{risk === 'unavailable' && <small className={styles.statusHelp}>OTJ status unavailable</small>}</td>
          <td><Link className={styles.viewButton} aria-label={`View ${learner.name}`} to={learnerHref(employerId, learner)} state={location.state}><Eye size={14} />View learner</Link></td>
        </tr>;
      })}</tbody></table></div>{pages > 1 && <nav className={styles.pagination} aria-label="Learner pages"><span>Page {currentPage} of {pages}</span><button type="button" aria-label="Previous learner page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={17} /></button><button type="button" aria-label="Next learner page" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={17} /></button></nav>}</>}
  </section>;

  const journeyPanel = <section className={styles.panel} aria-labelledby="employer-reviews"><header className={styles.panelHeader}><h2 id="employer-reviews" tabIndex={-1}><Workflow size={22} />Progress review journey</h2><div className={styles.panelHeaderActions}><label className={styles.panelNameFilter}><Search size={15} aria-hidden="true" /><span className="sr-only">Filter reviews by learner name</span><input type="search" value={journeyNameFilter} onChange={event => setJourneyNameFilter(event.target.value)} placeholder="Filter by name" /></label>{view !== 'reviews' && <Link className={`${styles.textButton} ${styles.reviewActionLink}`} to={`/employers/${employerId}/reviews`} state={location.state}>View all<ArrowRight size={15} /></Link>}</div></header><div className={styles.journeys} data-wide={view === 'reviews' ? 'true' : undefined}>{journeyLearners.map(learner => {
    const resource = reviews[learnerKey(learner)];
    const events = orderReviewJourney(resource?.data || []);
    const upcomingKey = nextReview(resource?.data)?.eventKey;
    const nextIndex = events.findIndex(event => reviewState(event) !== 'completed');
    const start = Math.max(0, nextIndex < 0 ? events.length - 4 : nextIndex - 1);
    const displayed = view === 'reviews' ? events : events.slice(start, start + 4);
    return <article className={styles.journey} key={learnerKey(learner)}><div className={styles.journeyIdentity}><Avatar learner={learner} /><div><Link to={learnerHref(employerId, learner, 'reviews')} state={location.state} className={styles.learnerName}>{learner.name}</Link><small>{learner.programme || 'Programme not assigned'}{learner.cohort ? ` | ${learner.cohort}` : ''}</small></div></div>{resource?.status === 'ready' ? events.length ? <><ol className={styles.journeySteps}>{displayed.map(event => {
      const state = reviewState(event);
      return <li key={event.eventKey} data-status={state}><Link to={learnerReviewHref(employerId, learner, event.eventKey)} state={location.state} className={selection.control} data-selection={isAptemReview(event) ? 'marker' : undefined} aria-current={event.eventKey === upcomingKey ? 'step' : undefined} aria-label={`${learner.name}: ${event.title}, ${reviewLabels[state]}, ${formatReviewDate(reviewDate(event))}`}><span className={`${styles.journeyMarker} ${selection.marker}`}>{state === 'completed' ? <Check size={12} /> : state === 'signature' ? '!' : <CalendarDays size={11} />}</span><strong>{event.title}{event.occurrenceNumber ? ` #${event.occurrenceNumber}` : ''}</strong><span>{formatReviewDate(reviewDate(event))}</span><small>{reviewLabels[state]}</small></Link></li>;
    })}</ol><Link className={`${styles.journeyLink} ${styles.reviewActionLink}`} to={learnerHref(employerId, learner, 'reviews')} state={location.state}>View reviews ({events.length})<ArrowRight size={13} /></Link></> : <p className={styles.journeyEmpty}>No progress reviews planned yet.</p> : <p className={styles.journeyEmpty}>{resource?.status === 'error' ? 'Reviews unavailable. Use Try again above.' : 'Loading progress reviews…'}</p>}</article>;
  })}{!journeyLearners.length && <p className={styles.journeyEmpty}>{journeyNameFilter && filtered.length ? 'No learners match that name.' : 'No learners to show.'}{journeyNameFilter && filtered.length > 0 && <button type="button" className={styles.textButton} onClick={() => setJourneyNameFilter('')}>Clear name filter</button>}</p>}</div></section>;

  return <div id="employer-dashboard" className={styles.page} data-view={view}>
    {isHome ? <section className={styles.hero} aria-labelledby="employer-portal-title">
      <div className={styles.heroIdentity}><span className={styles.heroIcon}><BriefcaseBusiness size={30} aria-hidden="true" /></span><div><p className={styles.greeting}>{greeting()}</p><h1 id="employer-portal-title">{data.employer.name || 'Employer'}</h1><p className={styles.organisation}>{data.employer.employerGroupNames.join(', ') || 'No organisation'}</p><p className={styles.heroIntro}>You have {active} learner{active === 1 ? '' : 's'} on programme. Here’s an overview of their progress and any actions required.</p></div></div>
      <div className={styles.heroMessage}><img src="/assets/employer/graduation-group.webp" alt="" /><p>Supporting your learners<br />towards a brighter future<span /></p></div>{backAction}
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
      <Stat icon={<ClipboardPenLine />} label="Reviews due this month" value={reviewSummaryReady ? due : reviewSummaryFailed ? 'Unavailable' : '…'} help={reviewSummaryReady ? 'Open progress reviews' : reviewSummaryFailed ? 'Review data could not be loaded' : 'Loading review dates'} tone="amber" onClick={reviewSummaryReady ? () => setOpenStat('reviews') : undefined} />
      <Stat icon={<CircleAlert />} label="Needs attention" value={attentionAvailable ? attention : metrics.status === 'loading' ? '…' : 'Unavailable'} help={attentionAvailable ? 'Saved learner OTJ status' : metrics.status === 'loading' ? 'Loading learner OTJ status' : 'OTJ status not available for all learners'} tone="rose" onClick={attentionAvailable ? () => setOpenStat('attention') : undefined} />
    </section>}

    {(metrics.status === 'error' || reviewsFailed || attendanceFailed || programmeFailed) && <div className={styles.dataNotice} role="alert"><CircleAlert size={18} /><p>{metrics.status === 'error' && 'Learner status could not be loaded. '}{attendanceFailed && 'Some attendance records could not be loaded. '}{programmeFailed && 'Programme progress could not be loaded. '}{reviewsFailed && 'Some progress reviews could not be loaded. '}Available records are still shown.</p><button type="button" onClick={onRetry}>Try again</button></div>}
    {(isHome || view === 'reviews') && <EmployerMeetings employerId={employerId} learners={learners} reviews={reviews} today={today} returnState={location.state} />}
    <form className={styles.filters} aria-label="Filter learners" onSubmit={event => event.preventDefault()}>
      <label className={styles.searchBox}><Search size={22} /><span className="sr-only">Search learners</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search learners by name or email..." /></label>
      <label className={styles.filterLabel}>Programme<select value={programme} onChange={event => setProgramme(event.target.value)}><option value="">All programmes</option>{[...new Set(learners.map(learner => learner.programme).filter(Boolean))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
      <label className={styles.filterLabel}>Cohort<select value={cohort} onChange={event => setCohort(event.target.value)}><option value="">All cohorts</option>{[...new Set(learners.map(learner => learner.cohort).filter(Boolean))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
      <label className={styles.filterLabel}>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option><option value="active">Active on programme</option><option value="inactive">Not active</option><option value="on-track">On track</option><option value="attention">Needs attention or at risk</option><option value="need-attention">Needs attention</option><option value="at-risk">At risk</option><option value="unavailable">OTJ status unavailable</option></select></label>
      <label className={styles.filterLabel}>Upcoming review<select value={upcoming} onChange={event => setUpcoming(event.target.value)}><option value="any">Any time</option><option value="month">This month</option><option value="30">Next 30 days</option><option value="overdue">Overdue</option><option value="signature">Needs my signature</option><option value="none">No date scheduled</option></select></label>
      <button type="button" className={styles.clearButton} onClick={clearFilters}><RotateCcw size={18} />Clear filters</button>
    </form>

    {isHome ? <div className={styles.dashboardGrid}>
      <div className={styles.mainColumn}>
        {learnersPanel}

        <div className={styles.chartsGrid}>
          <section className={styles.panel} aria-label="Learner progress overview"><PanelHeader icon={<BarChart3 size={21} />} title="Learner progress overview" /><p className={styles.chartCaption}>OTJ hours against the current target</p><div className={styles.donutContent}><div className={styles.donut} style={{ '--donut-gradient': filtered.length ? `conic-gradient(${gradient})` : '#e8e7f0' } as CSSProperties} role="img" aria-label={buckets.map(bucket => `${bucket.label}: ${bucket.count}`).join(', ')}><div><strong>{filtered.length}</strong><span>learners</span></div></div><ul className={styles.legend}>{buckets.map(bucket => <li key={bucket.key}><span className={styles.legendDot} style={{ backgroundColor: bucket.color }} /><span>{bucket.label}</span><strong>{bucket.count} <span>({filtered.length ? Math.round(bucket.count / filtered.length * 100) : 0}%)</span></strong></li>)}</ul></div></section>
          <section className={styles.panel} aria-label="Progress by programme"><PanelHeader icon={<GraduationCap size={22} />} title="Progress by programme" /><p className={styles.chartCaption}>Average programme completion</p><div className={styles.programmes}>{programmes.length ? programmes.map(group => <div key={group.name}><div className={styles.programmeHeading}><button type="button" onClick={() => openSection('learners', group.name === 'Not assigned' ? {} : { programme: group.name })}>{group.name}</button><strong>{group.percent != null ? percentLabel(group.percent) : '—'}</strong></div>{group.percent != null ? <ProgressBar value={group.percent} label={`${group.name} average progress`} /> : <p className={styles.unavailable}>{programmeMetrics.status === 'loading' ? 'Loading…' : 'Progress not available'}</p>}{group.available < group.total && <small className={styles.caption}>{group.available} of {group.total} learners have progress data</small>}</div>) : <p className={styles.unavailable}>No learners to show</p>}</div></section>
        </div>
      </div>

      <aside className={styles.sideColumn} aria-label="Employer actions and reviews">
        <section className={`${styles.panel} ${styles.actionsPanel}`} aria-label="Action required"><PanelHeader icon={<CircleAlert size={22} />} title={`Action required (${actionsCount})`} action={<Link className={styles.textButton} to={`/employers/${employerId}/documents`} state={location.state}>View all<ArrowRight size={15} /></Link>} /><div className={styles.actionList}>{actions.length ? actions.slice(0, 3).map(learner => <Link key={learnerKey(learner)} to={learnerHref(employerId, learner, 'documents')} state={location.state} className={styles.actionItem}><Avatar learner={learner} /><span><strong>{learner.name}</strong><span>{learner.outstandingCount} document{learner.outstandingCount === 1 ? '' : 's'} need your signature</span><small>Ready for your review</small></span><ChevronRight size={18} /></Link>) : <p className={styles.noActions}><Check size={19} />No signatures needed for these learners.</p>}</div></section>
        {journeyPanel}
      </aside>
    </div>
      : view === 'learners' ? learnersPanel : <EmployerReviewJourneys employerId={employerId} learners={filtered}
        totalLearners={learners.length} reviews={reviews} onRetry={onRetry} onClearFilters={clearFilters} />}
  </div>;
}
