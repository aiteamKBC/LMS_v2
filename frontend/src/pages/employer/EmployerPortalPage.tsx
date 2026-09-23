import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { fetchEmployerLearner, fetchEmployerLearnerSummary, fetchEmployerPortal, type EmployerLearnerCard, type EmployerLearnerDetail, type EmployerLearnerSummary, type EmployerPortal } from '@/api/employerPortal';
import EmployerHeader from './components/EmployerHeader';
import EmptyState from './components/EmptyState';
import LoadingState from './components/LoadingState';
import { ErrorState, Metric, ProgressBar, Tabs, date, hours, initials, percent, secondaryButton } from './components/Presentation';
import './styles/employer-readdy.css';

type SummaryState = { status: 'loading' } | { status: 'ready'; data: EmployerLearnerSummary } | { status: 'error'; error: string };
type DetailState = { status: 'loading' } | { status: 'ready'; data: EmployerLearnerDetail } | { status: 'error'; error: string };

type ActionCategory = 'reviews' | 'evidence' | 'attendance';
type ActionItem = {
  key: string; employerId: string; learnerName: string; kind: string; learnerId: string;
  category: ActionCategory; icon: string; iconClass: string; title: string; typeLabel: string;
  description: string; dueDate: string | null; overdue: boolean; tabToken: string;
};

function MetricBlock({ label, value, sub, valueClassName = 'text-foreground-950', subClassName = 'text-foreground-500' }: { label: string; value: string; sub?: string; valueClassName?: string; subClassName?: string }) {
  return <div className="rounded-md border border-background-200 bg-background-100/50 px-3 py-2.5"><p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">{label}</p><p className={`mt-0.5 text-base font-bold ${value === 'Unavailable' ? 'text-foreground-500' : valueClassName}`}>{value}</p>{sub && <p className={`mt-0.5 text-xs ${subClassName}`}>{sub}</p>}</div>;
}

// Readdy StatusBadge.getReviewStatusLabel, derived from the real domain's
// review-signature fields rather than Readdy's richer mock review-status enum
// (we have no "scheduled"/"in-progress"/"overdue" concept for a review here).
function ReviewStatusBadge({ pending, lastReviewDate, available }: { pending: number | null; lastReviewDate: string | null | undefined; available: boolean }) {
  const meta = !available
    ? { label: 'Review status unavailable', icon: 'ri-question-line', className: 'bg-background-200 text-foreground-600 border-background-300' }
    : pending != null && pending > 0
      ? { label: 'Awaiting employer signature', icon: 'ri-alert-line', className: 'bg-accent-100 text-accent-800 border-accent-300' }
      : lastReviewDate
        ? { label: 'Completed', icon: 'ri-check-double-line', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
        : { label: 'Not scheduled', icon: 'ri-time-line', className: 'bg-background-200 text-foreground-600 border-background-300' };
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${meta.className}`}><i className={`${meta.icon} text-sm`} aria-hidden="true" />{meta.label}</span>;
}

// Readdy LearnerCards composition. Only the data binding and unsupported actions differ.
function LearnerCard({ learner, state, employerId }: { learner: EmployerLearnerCard; state?: SummaryState; employerId: string }) {
  const summary = state?.status === 'ready' ? state.data : null;
  const path = `/employers/${employerId}/learner/${learner.kind}/${learner.id}`;
  const attendance = summary?.attendance.available ? summary.attendance : null;
  const ksb = summary?.ksb.available ? summary.ksb : null;
  const pending = summary?.reviews.available ? summary.reviews.pendingEmployerSignatureCount : null;
  const selection = summary?.currentLearning.selectionState ?? 'unavailable';
  const attendanceConcern = attendance?.classification === 'amber' || attendance?.classification === 'red';
  return <article className="flex flex-col rounded-lg border border-background-200 bg-background-50 p-5">
    <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-700">{initials(learner.name)}</span>
      <div className="min-w-0"><Link to={path} className="block truncate text-sm font-semibold text-foreground-950 transition-colors hover:text-primary-700">{learner.name}</Link>{learner.email && <p className="truncate text-xs text-foreground-500">{learner.email}</p>}</div>
    </div><Link to={path} aria-label={`View ${learner.name}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground-400 transition-colors hover:bg-background-100 hover:text-primary-600"><i className="ri-arrow-right-up-line text-lg" aria-hidden="true" /></Link></div>
    <p className="mt-3 text-sm font-medium text-foreground-800">{learner.programme || 'Programme unavailable'}</p>
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-500"><span>Cohort {learner.cohort || 'Unavailable'}</span><span aria-hidden="true">·</span><span>Coach {summary?.coach.name || 'Unavailable'}</span></div>
    <div className="mt-4 rounded-lg border border-background-200 bg-background-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-500">{({ current: 'Current module', next: 'Next module', last: 'Last module', multiple: 'Current modules', unavailable: 'Current module' })[selection]}</p>
      {state?.status === 'loading' ? <div role="status" className="mt-2"><span className="sr-only">Loading current learning</span><LoadingState count={1} /></div> : <>
        {state?.status === 'error' && <p className="mt-2 text-xs text-foreground-500">Summary unavailable</p>}
        {selection === 'unavailable' ? <p className="mt-2 text-sm text-foreground-500">Current module unavailable</p> :
          summary?.currentLearning.modules.map((module, index) => <div key={module.moduleId || index} className="mt-1"><div className="flex items-baseline justify-between gap-3"><p className="truncate text-sm font-semibold text-foreground-950">{module.moduleName || 'Unavailable'}</p><p className="whitespace-nowrap text-sm font-bold text-foreground-950">{module.available ? percent(module.progressPercent) : 'Unavailable'}</p></div><ProgressBar value={module.available ? module.progressPercent : null} /><p className="mt-1.5 text-xs text-foreground-600">{module.completedActivities ?? 'Unavailable'} of {module.totalActivities ?? 'Unavailable'} activities completed</p><p className="text-xs text-foreground-500">Week {module.currentWeek ?? 'Unavailable'} of {module.totalWeeks ?? 'Unavailable'}</p></div>)}
      </>}
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <MetricBlock label="Attendance" value={percent(attendance?.ratePercent)} valueClassName={attendanceConcern ? 'text-accent-700' : 'text-foreground-950'} sub={attendance ? `${attendance.sessionsAttended ?? 'Unavailable'} / ${attendance.sessionsHeld ?? 'Unavailable'} sessions` : undefined} />
      <MetricBlock label="Absences" value={attendance?.absences == null ? 'Unavailable' : String(attendance.absences)} sub={attendance ? (attendance.absences ? `Last: ${date(attendance.lastSessionDate)}` : 'No absences recorded') : undefined} />
      <MetricBlock label="Off-the-job" value={`${hours(summary?.otj.actualHours)} / ${hours(summary?.otj.plannedToDateHours)}`} sub={summary?.otj.plannedToDateAvailable ? summary.otj.behindPlan ? `${hours(Math.abs(summary.otj.varianceToDateHours ?? 0))} behind plan` : 'On or ahead of plan' : 'Planned-to-date needs programme dates'} subClassName={summary?.otj.behindPlan ? 'text-accent-700' : 'text-foreground-500'} />
      <MetricBlock label="KSB Coverage" value={ksb?.achieved != null && ksb.total != null ? `${ksb.achieved} / ${ksb.total}` : 'Unavailable'} sub={ksb ? percent(ksb.percentage) : undefined} />
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-background-200 pt-3"><ReviewStatusBadge pending={pending} lastReviewDate={summary?.reviews.lastReviewDate} available={!!summary?.reviews.available} /><span className="text-xs text-foreground-500">Next review: {date(summary?.reviews.nextReviewDate)}</span></div>
    <div className="mt-3"><Link to={path} className={`w-full ${secondaryButton}`}>View learner</Link></div>
  </article>;
}

const ACTION_FILTERS: { id: 'all' | ActionCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'attendance', label: 'Attendance' },
];

/**
 * Readdy ActionCentre composition, built entirely from data already fetched
 * for other parts of the dashboard (per-learner summaries + detail) — no
 * fake action types. There is no "OTJ" filter here (unlike Readdy's mock):
 * this portal has no employer-facing OTJ-approval workflow, so that category
 * is omitted rather than shown permanently empty. Only Progress Reviews carry
 * a real date to be "overdue" against; documents and attendance concerns have
 * no due-date concept in this domain, so they are listed under "Requires
 * attention" rather than sorted into an invented due-date bucket.
 */
function DashboardActionCentre({ actions, available, retry }: { actions: ActionItem[]; available: boolean; retry: () => void }) {
  const [filter, setFilter] = useState<'all' | ActionCategory>('all');
  const counts: Record<'all' | ActionCategory, number> = {
    all: actions.length,
    reviews: actions.filter(a => a.category === 'reviews').length,
    evidence: actions.filter(a => a.category === 'evidence').length,
    attendance: actions.filter(a => a.category === 'attendance').length,
  };
  const overdueCount = actions.filter(a => a.overdue).length;
  const visible = filter === 'all' ? actions : actions.filter(a => a.category === filter);
  const overdue = visible.filter(a => a.overdue);
  const rest = visible.filter(a => !a.overdue);

  const Item = ({ action }: { action: ActionItem }) => <li className="rounded-lg border border-background-200 bg-background-50 p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${action.iconClass}`}><i className={`${action.icon} text-base`} aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground-950">{action.learnerName} <span className="font-normal text-foreground-400">·</span> <span className="font-normal text-foreground-500">{action.typeLabel}</span></p>
          <p className="mt-0.5 text-sm text-foreground-950">{action.title}</p>
          <p className="mt-0.5 text-sm text-foreground-600">{action.description}</p>
          {action.dueDate && <p className={`mt-1.5 inline-flex items-center gap-1 text-xs ${action.overdue ? 'font-medium text-rose-600' : 'text-foreground-500'}`}><i className={action.overdue ? 'ri-alarm-warning-line' : 'ri-calendar-line'} aria-hidden="true" />Due {date(action.dueDate)}{action.overdue && <span className="font-semibold"> · Overdue</span>}</p>}
        </div>
      </div>
      <Link to={`/employers/${action.employerId}/learner/${action.kind}/${action.learnerId}?tab=${action.tabToken}`} className="shrink-0 self-start rounded-md border border-background-300 bg-background-50 px-3.5 py-1.5 text-sm font-medium text-foreground-700 transition-colors hover:bg-background-100 sm:self-center">Review</Link>
    </div>
  </li>;

  return <section className="rounded-xl border border-background-200 bg-background-50 p-5">
    <h2 className="text-lg font-semibold text-foreground-950">Action Centre</h2>
    {!available ? <p className="mt-1 text-sm text-foreground-600">Review actions unavailable</p> : <p className="mt-1 text-sm text-foreground-600">{actions.length} action{actions.length === 1 ? '' : 's'} require your attention{overdueCount > 0 && <> · <span className="font-medium text-rose-600">{overdueCount} overdue</span></>}</p>}
    {!available && <button type="button" className={`mt-3 ${secondaryButton}`} onClick={retry}>Retry actions</button>}
    {available && <>
    <div className="mt-4 inline-flex flex-wrap items-center gap-1 rounded-full border border-background-200 bg-background-50 p-1">
      {ACTION_FILTERS.map(f => <button key={f.id} type="button" onClick={() => setFilter(f.id)} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${filter === f.id ? 'bg-primary-500 text-background-50' : 'text-foreground-600 hover:text-foreground-950'}`}>{f.label} <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${filter === f.id ? 'bg-background-50/25 text-background-50' : 'bg-background-100 text-foreground-600'}`}>{counts[f.id]}</span></button>)}
    </div>
    <div className="mt-4">
      {visible.length === 0 ? <p className="text-sm text-foreground-500">No actions require your attention{filter !== 'all' ? ` in ${ACTION_FILTERS.find(f => f.id === filter)?.label.toLowerCase()}` : ''}.</p> : <div className="space-y-5">
        {overdue.length > 0 && <div>
          <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden="true" /><h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-600">Overdue</h3><span className="rounded-full bg-background-100 px-2 py-0.5 text-xs font-medium text-foreground-600">{overdue.length}</span></div>
          <ul className="mt-3 space-y-3">{overdue.map(a => <Item key={a.key} action={a} />)}</ul>
        </div>}
        {rest.length > 0 && <div>
          {overdue.length > 0 && <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-background-400" aria-hidden="true" /><h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-600">Requires attention</h3><span className="rounded-full bg-background-100 px-2 py-0.5 text-xs font-medium text-foreground-600">{rest.length}</span></div>}
          <ul className="mt-3 space-y-3">{rest.map(a => <Item key={a.key} action={a} />)}</ul>
        </div>}
      </div>}
    </div>
    </>}
  </section>;
}

const EMPLOYER_GUIDANCE = [
  { icon: 'ri-quill-pen-line', title: 'Signing progress reviews', body: "As the employer or line manager, you'll be asked to sign formal progress reviews once the coach has completed them. Read the full review and add your signature to confirm you agree with the agreed actions." },
  { icon: 'ri-time-line', title: 'Off-the-job training', body: 'Your apprentice must complete at least 20% of their working hours in off-the-job training. As their employer, approve the submitted hours promptly to keep the records accurate.' },
  { icon: 'ri-shield-check-line', title: 'Safeguarding & wellbeing', body: "As the employer, if you have any concerns about your apprentice's wellbeing or safeguarding, contact your dedicated coach immediately. All concerns are treated confidentially." },
  { icon: 'ri-chat-3-line', title: 'Giving effective feedback', body: 'Be specific and constructive. Link your feedback to the agreed workplace actions and next steps so your apprentice knows exactly what to work on before the next review.' },
];

/**
 * Readdy TrendsByApprentice composition. The bar list is real (each
 * learner's current-module progress, already fetched for their card above).
 * The line chart is not: it needs a month-by-month history of module
 * progress, and Phase 2 only ever exposes the current point-in-time value —
 * there is no historical snapshot to plot. Rather than invent one, that half
 * of the section says plainly that trend history isn't tracked yet.
 */
function TrendsByApprentice({ ready }: { ready: EmployerLearnerSummary[] }) {
  const rows = ready
    .filter(s => s.currentLearning.selectionState !== 'unavailable' && s.currentLearning.modules[0]?.available)
    .map(s => ({ name: s.learner.name, percent: s.currentLearning.modules[0].progressPercent as number }))
    .sort((a, b) => b.percent - a.percent);
  return <section className="space-y-4">
    <h2 className="text-lg font-semibold text-foreground-950">Trends by Apprentice</h2>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-background-200 bg-background-50 p-5">
        <p className="text-sm font-medium text-foreground-700">Average module progress</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-2 py-6 text-center">
          <i className="ri-line-chart-line text-2xl text-foreground-400" aria-hidden="true" />
          <p className="text-sm text-foreground-500">Trend history is not tracked yet — this system only records each learner's current progress, not a month-by-month history.</p>
        </div>
      </div>
      <div className="rounded-lg border border-background-200 bg-background-50 p-5">
        <p className="text-sm font-medium text-foreground-700">Current module progress</p>
        {rows.length === 0 ? <p className="mt-4 text-sm text-foreground-500">No current module progress is available yet.</p> : <div className="mt-4 space-y-3">
          {rows.map(row => <div key={row.name}>
            <div className="flex items-baseline justify-between gap-3"><span className="truncate text-sm text-foreground-800">{row.name}</span><span className="text-sm font-semibold text-foreground-950">{percent(row.percent)}</span></div>
            <ProgressBar value={row.percent} />
          </div>)}
        </div>}
      </div>
    </div>
    <div>
      <h3 className="text-base font-semibold text-foreground-950">Guidance &amp; Good Practice for Employers</h3>
      <p className="mt-1 text-sm text-foreground-600">Practical guidance for you as the employer or line manager supporting your apprentice.</p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {EMPLOYER_GUIDANCE.map(g => <div key={g.title} className="rounded-lg border border-background-200 bg-background-50 p-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100 text-primary-700"><i className={`${g.icon} text-base`} aria-hidden="true" /></span>
          <p className="mt-3 text-sm font-semibold text-foreground-950">{g.title}</p>
          <p className="mt-1 text-sm text-foreground-600">{g.body}</p>
        </div>)}
      </div>
    </div>
  </section>;
}

function Dashboard({ employerId }: { employerId: string }) {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const [portal, setPortal] = useState<EmployerPortal | null>(null);
  const [summaries, setSummaries] = useState<Record<string, SummaryState>>({});
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState('Dashboard');
  useEffect(() => {
    let active = true;
    setLoading(true); setPortal(null); setError(''); setSummaries({}); setDetails({});
    fetchEmployerPortal(employerId).then(data => {
      if (!active) return;
      setPortal(data);
      setSummaries(Object.fromEntries(data.learners.map(l => [`${l.kind}:${l.id}`, { status: 'loading' }])));
      setDetails(Object.fromEntries(data.learners.map(l => [`${l.kind}:${l.id}`, { status: 'loading' }])));
      data.learners.forEach(l => {
        const key = `${l.kind}:${l.id}`;
        fetchEmployerLearnerSummary(employerId, l.kind, l.id).then(result => {
          if (active) setSummaries(old => ({ ...old, [key]: { status: 'ready', data: result } }));
        }).catch((reason: Error) => { if (active) setSummaries(old => ({ ...old, [key]: { status: 'error', error: reason.message } })); });
        // Full learner detail (reviews + documents) drives the Action Centre
        // below — the summary alone has counts but no review/document ids to
        // link to.
        fetchEmployerLearner(employerId, l.kind, l.id).then(result => {
          if (active) setDetails(old => ({ ...old, [key]: { status: 'ready', data: result } }));
        }).catch((reason: Error) => { if (active) setDetails(old => ({ ...old, [key]: { status: 'error', error: reason.message } })); });
      });
    }).catch((reason: Error) => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [employerId, revision]);
  const learners = portal?.learners ?? [];
  const ready = learners.map(l => summaries[`${l.kind}:${l.id}`]).filter((s): s is { status: 'ready'; data: EmployerLearnerSummary } => s?.status === 'ready').map(s => s.data);
  const readyDetails = learners.map(l => details[`${l.kind}:${l.id}`]).filter((d): d is { status: 'ready'; data: EmployerLearnerDetail } => d?.status === 'ready').map(d => d.data);
  const allReviews = ready.length === learners.length && ready.every(s => s.reviews.available && s.reviews.pendingEmployerSignatureCount != null);
  const pending = allReviews ? ready.reduce((n, s) => n + s.reviews.pendingEmployerSignatureCount!, 0) : 'Unavailable';
  const allAttendance = ready.length === learners.length && ready.every(s => s.attendance.available);
  const attendanceConcerns = allAttendance ? ready.filter(s => s.attendance.classification === 'amber' || s.attendance.classification === 'red').length : 'Unavailable';
  const today = new Date().toISOString().slice(0, 10);
  const actions: ActionItem[] = [
    ...readyDetails.flatMap(d => d.reviews
      .filter(r => r.reviewInstanceId && r.reviewType === 'progress_review' && r.employerSignatureRequired && !r.signed)
      .map((r): ActionItem => ({
        key: `review:${d.learner.id}:${r.eventKey}`, employerId, learnerName: d.learner.name, kind: d.learner.kind, learnerId: d.learner.id,
        category: 'reviews', icon: 'ri-quill-pen-line', iconClass: 'bg-accent-100 text-accent-700',
        title: r.label, typeLabel: 'Progress Review', description: 'Awaiting your signature.',
        dueDate: r.scheduledDate || null, overdue: !!r.scheduledDate && r.scheduledDate < today, tabToken: 'reviews',
      }))),
    ...readyDetails.flatMap(d => d.documents
      .filter(doc => doc.signable && !doc.signed)
      .map((doc): ActionItem => ({
        key: `doc:${d.learner.id}:${doc.id}`, employerId, learnerName: d.learner.name, kind: d.learner.kind, learnerId: d.learner.id,
        category: 'evidence', icon: 'ri-file-text-line', iconClass: 'bg-background-200 text-foreground-700',
        title: doc.label, typeLabel: doc.docType || 'Document', description: 'Awaiting your signature.',
        dueDate: null, overdue: false, tabToken: 'documents',
      }))),
    ...ready.filter(s => s.attendance.available && (s.attendance.classification === 'amber' || s.attendance.classification === 'red'))
      .map((s): ActionItem => ({
        key: `attendance:${s.learner.id}`, employerId, learnerName: s.learner.name, kind: s.learner.kind, learnerId: s.learner.id,
        category: 'attendance', icon: 'ri-calendar-check-line', iconClass: 'bg-rose-50 text-rose-700',
        title: 'Attendance concern', typeLabel: 'Attendance', description: `Attendance rate ${percent(s.attendance.ratePercent)} — below the expected level.`,
        dueDate: null, overdue: false, tabToken: 'attendance',
      })),
  ];
  const actionsAvailable = ready.length === learners.length && readyDetails.length === learners.length;
  // The backend never computes a "planned to date" OTJ figure (Phase 2 leaves
  // Planned-to-date OTJ is pro-rated from each learner's programme dates, so a
  // learner is only counted once that figure is known. As with attendance, one
  // learner whose dates are missing makes the whole count unavailable rather
  // than understating it — showing a partial count would read as "on track".
  const allOtj = ready.length === learners.length && ready.every(s => s.otj.plannedToDateAvailable && s.otj.behindPlan != null);
  const otjBehindPlan = allOtj ? ready.filter(s => s.otj.behindPlan).length : 'Unavailable';
  const retry = () => setRevision(n => n + 1);
  return <div className="employer-readdy min-h-screen bg-background-100">
    <EmployerHeader employer={{ name: portal?.employer.name || auth.account?.displayName || 'Employer', organisationName: portal?.employer.employerGroupNames.join(', ') || '' }} title="Employer Performance Dashboard" subtitle={portal ? `Employer: ${portal.employer.name} · Organisation: ${portal.employer.employerGroupNames.join(', ') || 'Unavailable'}` : undefined} nav={<Tabs labels={['Dashboard', 'Progress Reviews']} selected={tab} onSelect={setTab} label="Employer portal sections" />} />
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-6 md:px-6 md:py-8">
      {auth.account?.role !== 'employer' && <button className={secondaryButton} onClick={() => navigate(-1)}>Back to users</button>}
      {loading ? <div role="status"><span className="sr-only">Loading employer learners</span><LoadingState variant="cards" /></div> : error ? <ErrorState message={error} retry={retry} /> : portal && <>
        {tab === 'Dashboard' ? <>
          <section aria-label="Key performance indicators" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Learners" value={learners.length} icon="ri-team-line" detail="Assigned to your organisation" />
            <Metric label="Reviews Requiring Action" value={pending} icon="ri-quill-pen-line" iconClassName="bg-accent-100 text-accent-700" tone="attention" detail="Awaiting your sign-off" />
            <Metric label="Attendance Concerns" value={attendanceConcerns} icon="ri-alert-line" iconClassName="bg-accent-100 text-accent-800" tone={typeof attendanceConcerns === 'number' && attendanceConcerns > 0 ? 'attention' : 'neutral'} detail="Learners flagged for attention" />
            <Metric label="OTJ Behind Plan" value={otjBehindPlan} icon="ri-time-line" iconClassName="bg-accent-100 text-accent-800" tone={typeof otjBehindPlan === 'number' && otjBehindPlan > 0 ? 'attention' : 'neutral'} detail={allOtj ? 'Behind their pro-rata planned hours' : 'Planned-to-date needs programme dates'} />
          </section>
          <section><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold text-foreground-950">Team Overview</h2><span className="text-sm text-foreground-600">{learners.length} learner{learners.length === 1 ? '' : 's'}</span></div>
            {Object.values(summaries).some(s => s.status === 'error') && <button className={`mb-4 ${secondaryButton}`} onClick={retry}>Retry unavailable summaries</button>}
            {learners.length === 0 ? <EmptyState icon="ri-team-line" title="No learners are linked to this employer yet." description="Your assigned learners will appear here." /> : <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{learners.map(l => <LearnerCard key={`${l.kind}:${l.id}`} learner={l} employerId={employerId} state={summaries[`${l.kind}:${l.id}`]} />)}</div>}
          </section>
          <DashboardActionCentre actions={actions} available={actionsAvailable} retry={retry} />
          <TrendsByApprentice ready={ready} />
        </> : <section className="space-y-4"><h2 className="text-lg font-semibold text-foreground-950">Progress Reviews</h2>{learners.map(l => <div key={`${l.kind}:${l.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-background-200 bg-background-50 p-5"><div><p className="text-sm font-semibold">{l.name}</p><p className="text-xs text-foreground-500">{l.programme || 'Programme unavailable'}</p></div><Link className={secondaryButton} to={`/employers/${employerId}/learner/${l.kind}/${l.id}?tab=reviews`}>View Reviews</Link></div>)}{learners.length === 0 && <EmptyState title="No progress reviews" description="No learners are assigned." />}</section>}
      </>}
    </main>
  </div>;
}
export default function EmployerPortalPage() { const { employerId = '' } = useParams(); return <Dashboard key={employerId} employerId={employerId} />; }
