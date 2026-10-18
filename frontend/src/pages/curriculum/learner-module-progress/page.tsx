import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AnimatedProgressCircle } from '@/components/ui/AnimatedProgressCircle';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  fetchCurriculumScopeLearnerKsbImpact, fetchCurriculumScopeLearnerRoster,
  saveCurriculumActivityStatus,
  fetchCurriculumActivityStatusHistory, type CurriculumActivityStatusHistory,
  type CurriculumActivityCompletionTime,
  type CurriculumProgrammeAssignedLearner, type CurriculumScopeLearnerKsbImpactResponse,
} from '@/lib/curriculumApi';
import { formatHoursMinutes, formatSystemTimestamp } from '@/lib/format';
import { EntityEmptyState, InlineError } from '../shared/entities/ui';
import {
  buildProgressRows, plannedPoints, ratioPercent, recordedHours, resolveProgressLearner, overallPercent,
  type ActivityStatus, type ActivityType, type ProgressRow,
} from './progressView';
import './progress.css';
import CompletionDialog from './CompletionDialog';
import AttendanceDialog from './AttendanceDialog';

type ActivityFilter = 'all' | ActivityStatus;
const STATUS = {
  'completed': { label: 'Completed', icon: 'ri-checkbox-circle-fill' },
  'needs-attention': { label: 'Needs Attention', icon: 'ri-error-warning-fill' },
  'in-progress': { label: 'In Progress', icon: 'ri-time-line' },
  'not-started': { label: 'Not Started', icon: 'ri-indeterminate-circle-fill' },
};
const FILTERS: ActivityFilter[] = ['all', 'needs-attention', 'in-progress', 'not-started', 'completed'];
const TYPES: ActivityType[] = ['Attendance', 'Quiz', 'Reading', 'Assignment', 'Audio', 'Video', 'Activity'];
const TYPE_ICON: Record<ActivityType, string> = {
  Attendance: 'ri-group-fill', Quiz: 'ri-question-line', Reading: 'ri-book-open-line',
  Assignment: 'ri-file-text-line', Audio: 'ri-headphone-line', Video: 'ri-video-line', Activity: 'ri-list-check-2',
};

function text(value: unknown, fallback = 'Not available') { return String(value ?? '').trim() || fallback; }
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length ? `${words[0][0]}${words.length > 1 ? words.at(-1)?.[0] : ''}`.toUpperCase() : '--';
}
function numberLabel(value: number) { return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value); }
function submittedLabel(value?: string) {
  return value ? formatSystemTimestamp(value, {
    day: 'numeric', month: 'short', year: 'numeric', ...(/^\d{4}-\d{2}-\d{2}$/.test(value) ? {} : { hour: '2-digit' as const, minute: '2-digit' as const }),
  }) || 'Not recorded' : 'Not recorded';
}

function TypeIcon({ type }: { type: ActivityType }) {
  return <span className={`lmp-type-icon lmp-type-${type.toLowerCase()}`} aria-hidden="true"><AppIcon name={TYPE_ICON[type]} size={21} /></span>;
}
function StatusBadge({ row }: { row: ProgressRow }) {
  const submissionStatus = row.type === 'Assignment' ? row.history?.reflection?.status : '';
  const manual = 'statusSource' in row.activity && row.activity.statusSource === 'manual';
  const attendanceMode = 'logState' in row.activity ? row.activity.logState?.attendanceMode : null;
  const label = row.type === 'Attendance' && row.status === 'completed' && attendanceMode
    ? attendanceMode === 'attended' ? 'Attended' : 'Watched recording' : STATUS[row.status].label;
  return <span className={`lmp-status lmp-status-${row.status}`}><AppIcon name={STATUS[row.status].icon} size={17} />
    <span>{!manual && submissionStatus ? submissionStatus.replace(/_/g, ' ') : label}
      {manual && submissionStatus && <small>{submissionStatus.replace(/_/g, ' ')}</small>}</span></span>;
}
function ProgressBar({ percent, label, tone = 'green' }: { percent: number | null; label: string; tone?: string }) {
  return <span className="lmp-bar" role={percent == null ? undefined : 'progressbar'} aria-label={label}
    aria-valuemin={percent == null ? undefined : 0} aria-valuemax={percent == null ? undefined : 100}
    aria-valuenow={percent == null ? undefined : Math.max(0, Math.min(100, percent))}>
    <span className={`lmp-bar-fill lmp-tone-${tone}`} style={{ width: `${Math.max(0, Math.min(100, percent || 0))}%` }} /></span>;
}
function OverviewCard({ label, percent, value, detail, tone }: {
  label: string; percent: number | null; value: string; detail: string; tone: string;
}) {
  const circumference = 2 * Math.PI * 38;
  return <article className={`lmp-overview-card lmp-tone-${tone}`} aria-label={label}>
    <div className="lmp-ring"><svg viewBox="0 0 90 90" aria-hidden="true">
      <circle cx="45" cy="45" r="38" fill="none" stroke="#e9eef6" strokeWidth="8" />
      <AnimatedProgressCircle cx="45" cy="45" r="38" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.max(0, Math.min(100, percent || 0)) / 100)} transform="rotate(-90 45 45)" />
    </svg><strong>{percent == null ? 'N/A' : `${percent}%`}</strong></div>
    <h3>{label}</h3><p className="lmp-overview-value">{value}</p><p className="lmp-overview-detail">{detail}</p>
  </article>;
}

function ActivityTable({ rows, onOpen, onStatus, busy }: { rows: ProgressRow[]; onOpen: (row: ProgressRow) => void; onStatus: (row: ProgressRow) => void; busy: boolean }) {
  return <div className="lmp-table-scroll" tabIndex={0} aria-label="Scroll activity table"><table className="lmp-activity-table">
    <thead><tr>{['Activity', 'OTH', 'KSBs', 'Points', 'Time', 'Status / Result', 'Actions'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
    <tbody>{rows.map(row => {
      const submittedAt = row.history?.submittedAt || row.activity.submittedAt;
      const log = 'logState' in row.activity ? row.activity.logState : undefined;
      const hours = log ? log.actualOtjh : row.history?.actualOtjh;
      const writable = 'canChangeStatus' in row.activity && row.activity.canChangeStatus;
      return <tr key={row.id}>
        <td><div className="lmp-activity-name"><TypeIcon type={row.type} /><div><strong>{text(row.activity.componentTitle, row.type)}</strong><span>{row.type}</span></div></div></td>
        <td title={log?.hoursSource || 'Recorded activity hours'}>{hours == null ? '—' : formatHoursMinutes(hours)}</td>
        <td><span className="lmp-ksb-codes">{row.ksbs.length ? row.ksbs.join(', ') : '—'}</span></td>
        <td title="Planned activity points">{row.plannedPoints == null ? '—' : numberLabel(row.plannedPoints)}</td>
        <td>{log?.timeEntryMode === 'input' && log.activityDate ? <span className="lmp-recorded-time">Input<small>{log.activityDate}</small></span> : log?.startedAt && log.endedAt ? <span className="lmp-recorded-time" title={submittedLabel(log.startedAt)}>
          {formatSystemTimestamp(log.startedAt, { hour: '2-digit', minute: '2-digit', second: '2-digit' })} → {formatSystemTimestamp(log.endedAt, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}<small>Activity Log · UK time</small>
        </span> : submittedAt ? <span className="lmp-recorded-time" title={`${submittedLabel(submittedAt)} (UK time)`}>
          {formatSystemTimestamp(submittedAt, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) || '—'}<small>Submitted · UK time</small>
        </span> : <span className="lmp-muted">Not recorded</span>}</td>
        <td>{writable ? <button type="button" className="lmp-status-button" disabled={busy} onClick={() => onStatus(row)} aria-label={`Change status for ${row.activity.componentTitle}`}><StatusBadge row={row} /></button> : <StatusBadge row={row} />}</td>
        <td><button type="button" className="lmp-details-button" onClick={() => onOpen(row)} aria-label={`View details for ${text(row.activity.componentTitle, row.type)}`}>
          <AppIcon name={TYPE_ICON[row.type]} size={18} />View Details</button></td>
      </tr>;
    })}</tbody>
  </table></div>;
}

function ActivityDrawer({ row, onClose, moduleId, learnerId }: { row: ProgressRow; onClose: () => void; moduleId: string; learnerId: string }) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [history, setHistory] = useState<CurriculumActivityStatusHistory[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  useEffect(() => {
    if (!('canChangeStatus' in row.activity) || !row.activity.canChangeStatus) return;
    const controller = new AbortController();
    fetchCurriculumActivityStatusHistory(moduleId, learnerId, row.activity.componentId, controller.signal)
      .then(result => { if (!controller.signal.aborted) setHistory(result.history); })
      .catch(error => { if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : 'Unable to load status history.'); });
    return () => controller.abort();
  }, [row, moduleId, learnerId]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; close.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, []);
  const log = 'logState' in row.activity ? row.activity.logState : undefined;
  const hours = log ? log.actualOtjh : row.history?.actualOtjh;
  const source = log?.hoursSource || row.history?.actualOtjhSource || ('source' in row.activity ? row.activity.source : 'learner activity record');
  return createPortal(<div className="lmp-drawer-backdrop" onClick={onClose}>
    <aside className="lmp-drawer" ref={panel} role="dialog" aria-modal="true" aria-label={`${text(row.activity.componentTitle, row.type)} details`}
      onClick={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === 'Escape') onClose();
        if (event.key !== 'Tab') return;
        const targets = panel.current?.querySelectorAll<HTMLElement>('button, a[href], input, select, [tabindex="0"]');
        if (!targets?.length) return;
        const first = targets[0]; const last = targets[targets.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <header><div><p>Activity details</p><h2>{text(row.activity.componentTitle, row.type)}</h2></div>
        <button type="button" ref={close} onClick={onClose} aria-label="Close activity details"><AppIcon name="ri-close-line" size={22} /></button></header>
      <div className="lmp-drawer-content"><div className="lmp-drawer-status"><TypeIcon type={row.type} /><StatusBadge row={row} /></div>
        <dl><div><dt>Recorded OTH</dt><dd>{hours == null ? 'Not recorded' : formatHoursMinutes(hours)}</dd></div>
          {log && <div><dt>Calculated status</dt><dd>{log.calculatedStatus.replace(/_/g, ' ')}</dd></div>}
          {log && <div><dt>Accepted OTH</dt><dd>{log.acceptedOtjh == null ? 'Not available' : formatHoursMinutes(log.acceptedOtjh)}</dd></div>}
          {Boolean(log?.unallocatedAcceptedRecords) && <div><dt>Time allocation</dt><dd>{log!.unallocatedAcceptedRecords} accepted record(s) without allocated time. Recorded accepted hours are included in progress.</dd></div>}
          {log?.multipleRecordedAllocations && <div><dt>Data review</dt><dd>Multiple Activity Log allocations. The row shows the highest eligible allocation; accepted hours include the persisted ledger allocations. Review the Activity Log before changing hours.</dd></div>}
          {log?.startedAt && <div><dt>Activity Log time (UK)</dt><dd>{submittedLabel(log.startedAt)} → {submittedLabel(log.endedAt || undefined)}</dd></div>}
          {log?.timeEntryMode === 'input' && log.activityDate && <div><dt>Activity Log date</dt><dd>{log.activityDate} · Input</dd></div>}
          <div><dt>Planned OTH</dt><dd>{row.activity.expectedOtjh == null ? 'Not available' : formatHoursMinutes(row.activity.expectedOtjh)}</dd></div>
          <div><dt>Submitted (UK time)</dt><dd>{submittedLabel(row.history?.submittedAt || row.activity.submittedAt)}</dd></div>
          <div><dt>KSBs mapped / evidenced</dt><dd>{row.ksbs.join(', ') || 'None recorded'}</dd></div>
          <div><dt>Points planned</dt><dd>{row.plannedPoints == null ? 'Not available' : numberLabel(row.plannedPoints)}</dd></div>
          <div><dt>Hours source</dt><dd>{source}</dd></div></dl>
        {row.history?.reflection?.text && <section><h3>Learning reflection</h3><p className="lmp-reflection">{row.history.reflection.text}</p></section>}
        {Boolean(row.history?.evidence.length) && <section><h3>Recorded evidence</h3><ul>{row.history?.evidence.map(item => <li key={item.evidenceId}>{item.fileName} <span className="lmp-muted">{item.status}</span></li>)}</ul></section>}
        {'canChangeStatus' in row.activity && row.activity.canChangeStatus && <section><h3>Status history</h3>
          {historyError ? <p role="alert">{historyError}</p> : history === null ? <p>Loading history…</p>
            : history.length ? <ol>{history.map(change => <li key={change.revision}><strong>{change.displayStatus === 'completed' ? 'Completed' : 'Not Started'}</strong>
              <p>{change.reason}</p><small>{submittedLabel(change.created_at)} · Actor {change.actor_id} · Revision {change.revision}</small></li>)}</ol> : <p>No status changes.</p>}</section>}
        <p className="lmp-drawer-note">Viewing details preserves the learner’s activity records, answers, submissions and attendance.</p>
      </div>
    </aside>
  </div>, document.body);
}

export default function LearnerModuleProgressPage() {
  const [params] = useSearchParams();
  const moduleId = params.get('moduleId') || params.get('module') || '';
  const learnerId = params.get('learnerId') || params.get('learner') || '';
  const enrolmentId = params.get('enrolmentId') || '';
  const [data, setData] = useState<CurriculumScopeLearnerKsbImpactResponse | null>(null);
  const [roster, setRoster] = useState<CurriculumProgrammeAssignedLearner[]>([]);
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selectedActivity, setSelectedActivity] = useState<ProgressRow | null>(null);
  const [completionActivity, setCompletionActivity] = useState<ProgressRow | null>(null);
  const [attendanceActivity, setAttendanceActivity] = useState<ProgressRow | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [saveError, setSaveError] = useState('');
  const scopeKey = `${moduleId}:${learnerId}:${enrolmentId}`;
  const activeScope = useRef(scopeKey); activeScope.current = scopeKey;
  const [loading, setLoading] = useState(Boolean(moduleId && (learnerId || enrolmentId)));
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const closeDrawer = useCallback(() => setSelectedActivity(null), []);
  useEffect(() => {
    setData(null); setRoster([]); setSelectedActivity(null); setCompletionActivity(null); setAttendanceActivity(null); setSaveError(''); setCollapsed(new Set());
    if (!moduleId || (!learnerId && !enrolmentId)) { setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setError(null);
    Promise.all([
      fetchCurriculumScopeLearnerKsbImpact('module', moduleId, { learnerStatus: 'all', moduleProgress: true }, controller.signal),
      fetchCurriculumScopeLearnerRoster('module', moduleId, { learnerStatus: 'all' }, controller.signal),
    ]).then(([impact, response]) => {
      if (!controller.signal.aborted) { setData(impact); setRoster(response.assignedLearners || []); }
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load learner progress.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [learnerId, enrolmentId, moduleId, retry]);
  const learner = useMemo(() => resolveProgressLearner([...roster, ...(data?.assignedLearners || [])], learnerId, enrolmentId), [data, roster, learnerId, enrolmentId]);
  const profileId = learner ? String(learner.id) : '';
  const otjh = data?.otjhAchievement?.learners.find(row => String(row.learnerId) === profileId);
  const consumption = data?.learnerKsbConsumption?.find(row => String(row.learnerId) === profileId);
  const activities = useMemo(() => data && profileId ? buildProgressRows(data, profileId) : [], [data, profileId]);
  const completed = activities.filter(row => row.status === 'completed').length;
  const activityPercent = ratioPercent(completed, activities.length);
  const logHours = activities.every(row => 'logState' in row.activity && row.activity.logState)
    ? recordedHours(activities)
    : undefined;
  const logSummary = data?.activityLogOtjh?.learners.find(row => String(row.learnerId) === profileId);
  const unallocatedRecords = logSummary?.unallocatedAcceptedRecords ?? activities.reduce((sum, row) => sum + ('logState' in row.activity ? row.activity.logState?.unallocatedAcceptedRecords || 0 : 0), 0);
  const actualHours = logSummary ? logSummary.achievedOtjh : logHours === undefined ? otjh?.achievedOtjh : logHours;
  const othPercent = otjh && actualHours != null ? ratioPercent(actualHours, otjh.plannedOtjh) : null;
  const ksbPercent = consumption ? ratioPercent(consumption.cappedConsumedWeightTotal, consumption.expectedWeightTotal) : null;
  const overall = overallPercent(othPercent, ksbPercent, activityPercent);
  const points = plannedPoints(activities);
  const types = TYPES.filter(type => activities.some(row => row.type === type));
  const weeks = useMemo(() => {
    const groups = new Map<string, { id: string; title: string; rows: ProgressRow[] }>();
    for (const row of activities) {
      const week = groups.get(row.weekId) || { id: row.weekId, title: row.weekTitle, rows: [] };
      week.rows.push(row); groups.set(row.weekId, week);
    }
    return [...groups.values()];
  }, [activities]);
  const matches = (row: ProgressRow) => (filter === 'all' || row.status === filter) && (typeFilter === 'all' || row.type === typeFilter)
    && (!query.trim() || `${row.activity.componentTitle} ${row.type} ${row.weekTitle} ${row.ksbs.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const matchingCount = activities.filter(matches).length;
  const lastSubmitted = activities.map(row => ('logState' in row.activity ? row.activity.logState?.endedAt || row.activity.logState?.activityDate : null) || row.history?.submittedAt || row.activity.submittedAt).filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value))))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  const moduleTitle = data?.lineage?.moduleTitle || 'Module';
  const displayName = learner?.name || 'Learner';
  const learnerStatus: ActivityStatus = activities.length && completed === activities.length ? 'completed'
    : completed > 0 || activities.some(row => row.history) ? 'in-progress' : 'not-started';
  const toggleWeek = (id: string) => setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const saveStatus = async (row: ProgressRow, displayStatus: 'completed' | 'not_started', values?: CurriculumActivityCompletionTime) => {
    const log = 'logState' in row.activity ? row.activity.logState : undefined;
    if (!log) throw new Error('Reload the activity before changing its status.');
    setSavingStatus(true); setSaveError('');
    try {
      const result = await saveCurriculumActivityStatus(moduleId, profileId, row.activity.componentId, {
        displayStatus, expectedRevision: log.revision, snapshotHash: log.snapshotHash,
        ...values,
      });
      if (activeScope.current !== scopeKey) return;
      setData(current => {
        if (!current) return current;
        const summary = current.activityLogOtjh;
        const hoursDelta = (result.state.acceptedOtjh || 0) - (log.acceptedOtjh || 0);
        const missingDelta = (result.state.unallocatedAcceptedRecords || 0) - (log.unallocatedAcceptedRecords || 0);
        const hasSummary = summary?.learners.some(item => String(item.learnerId) === profileId);
        return { ...current, learnerActivityPlan: current.learnerActivityPlan?.map(item => item.activityPlanId === row.id
          ? { ...item, logState: result.state, displayStatus, statusSource: 'manual' } : item),
          activityLogOtjh: summary && hasSummary ? { ...summary,
            achievedTotal: summary.achievedTotal == null ? null : summary.achievedTotal + hoursDelta,
            unallocatedAcceptedRecords: (summary.unallocatedAcceptedRecords || 0) + missingDelta,
            learners: summary.learners.map(item => String(item.learnerId) === profileId ? { ...item,
              achievedOtjh: item.achievedOtjh == null ? null : item.achievedOtjh + hoursDelta,
              unallocatedAcceptedRecords: (item.unallocatedAcceptedRecords || 0) + missingDelta,
            } : item),
          } : summary };
      });
      try {
        const refreshed = await fetchCurriculumScopeLearnerKsbImpact('module', moduleId, { learnerStatus: 'all', moduleProgress: true });
        if (activeScope.current === scopeKey) setData(refreshed);
      } catch { if (activeScope.current === scopeKey) setSaveError('Status saved. Could not refresh summaries; reload this page before editing again.'); }
    } finally { setSavingStatus(false); }
  };
  const changeStatus = (row: ProgressRow) => {
    if (row.status !== 'completed') {
      if (row.type === 'Attendance') setAttendanceActivity(row);
      else setCompletionActivity(row);
      return;
    }
    void saveStatus(row, 'not_started').catch(failure => setSaveError(failure instanceof Error ? failure.message : 'Unable to save status.'));
  };

  return <WorkspaceShell role="curriculum" roleLabel="Curriculum" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio"
    pageTitle="Learner Module Progress" hideBreadcrumbs showBackButton={false}>
    <div className="lmp-page">
      <header className="lmp-page-heading"><div><h1>Learner Module Progress</h1><p>Review a learner’s progress for this module, including activity completion, OTH, KSBs and assessment status.</p></div>
        <Link className="lmp-back-button" to={`/curriculum/module-builder?module=${encodeURIComponent(moduleId)}`}><AppIcon name="ri-arrow-left-line" size={19} />Back to Students</Link></header>
      {!moduleId || (!learnerId && !enrolmentId) ? <EntityEmptyState icon="ri-user-search-line" title="Choose a learner to view progress" message="Open View progress from an assigned learner in the module roster." />
        : loading ? <div className="lmp-loading" role="status">Loading learner progress…</div>
        : error ? <InlineError message={error} onRetry={() => setRetry(value => value + 1)} />
        : !learner ? <EntityEmptyState icon="ri-user-search-line" title="Learner not found in this module" message="The learner assignment or identity link is unavailable. Return to the assigned learners and reload." /> : <>
          <section className="lmp-learner-card" aria-label="Learner details">
            <div className="lmp-learner-identity"><span className="lmp-avatar" aria-hidden="true">{initials(displayName)}</span><div><h2>{displayName}</h2>
              <p><AppIcon name="ri-mail-line" size={17} />{text(learner.email, 'No email on record')}</p><p><AppIcon name="ri-user-line" size={17} />Learner ID: {profileId}</p></div></div>
            <div className="lmp-identity-field"><span>Programme</span><strong>{text(learner.programme || data?.lineage?.programmeName)}</strong></div>
            <div className="lmp-identity-field"><span>Cohort</span><strong>{text(learner.cohort || data?.lineage?.cohortName)}</strong><small>{learner.group}</small></div>
            <div className="lmp-identity-field"><span>Module</span><strong>{moduleTitle}</strong><small>{data?.lineage?.moduleCatalogueId || moduleId}</small></div>
            <div className="lmp-identity-field"><span>Last activity</span><strong className="lmp-last-activity"><AppIcon name="ri-calendar-line" size={20} />{submittedLabel(lastSubmitted)}</strong></div>
            <span className={`lmp-status lmp-status-${learnerStatus}`}><AppIcon name={STATUS[learnerStatus].icon} size={21} />{STATUS[learnerStatus].label}</span>
          </section>
          <div className="lmp-summary-grid">
            <section className="lmp-panel" aria-labelledby="lmp-overview"><h2 id="lmp-overview">Progress Overview</h2><div className="lmp-overview-grid">
              <OverviewCard label="OTH Progress" tone="green" percent={othPercent}
                value={otjh && actualHours != null ? `${formatHoursMinutes(actualHours)} / ${formatHoursMinutes(otjh.plannedOtjh)}` : 'Not available'} detail={`${logHours === undefined ? 'Credited / planned hours' : 'Activity Log accepted / planned hours'}${unallocatedRecords ? ` · ${unallocatedRecords} accepted record(s) without allocated time` : ''}`} />
              <OverviewCard label="KSB Progress" tone="purple" percent={ksbPercent}
                value={consumption ? `${numberLabel(consumption.consumedWeightTotal)} / ${numberLabel(consumption.expectedWeightTotal)}` : 'Not available'} detail="Achieved / mapped weight" />
              <OverviewCard label="Activities Progress" tone="blue" percent={activityPercent} value={`${completed} / ${activities.length} completed`} detail="All assigned activities" />
              <OverviewCard label="Points" tone="orange" percent={null} value={points == null ? 'Not available' : `${numberLabel(points)} planned`} detail="Earned points not available" />
            </div><div className="lmp-overall"><div><strong>Overall Progress</strong><b>{overall == null ? 'N/A' : `${overall}%`}</b></div>
              <ProgressBar percent={overall} label="Overall module progress" tone="purple" /><small>Average of OTH, KSB and Activities progress · All assigned activities</small></div></section>
            <section className="lmp-panel" aria-labelledby="lmp-type-heading"><h2 id="lmp-type-heading">Activity Type Breakdown</h2><div className="lmp-type-breakdown">
              {types.length ? types.map(type => {
                const rows = activities.filter(row => row.type === type); const done = rows.filter(row => row.status === 'completed').length; const percent = ratioPercent(done, rows.length);
                return <div className="lmp-type-row" key={type}><TypeIcon type={type} /><span>{type === 'Assignment' ? 'Assignments' : type}</span>
                  <ProgressBar percent={percent} label={`${type} completion`} tone={type.toLowerCase()} /><strong>{percent == null ? 'N/A' : `${percent}%`}</strong><small>{done} / {rows.length}</small></div>;
              }) : <p className="lmp-muted">No assigned activities.</p>}
            </div></section>
          </div>
          <section className="lmp-panel lmp-weekly" aria-labelledby="lmp-weekly-heading">
            {saveError && <p role="alert" className="lmp-save-error">{saveError}</p>}
            <div className="lmp-weekly-toolbar"><h2 id="lmp-weekly-heading">Weekly Activity Breakdown</h2><div className="lmp-filters" aria-label="Activity status filters">
              {FILTERS.map(option => <button key={option} type="button" aria-pressed={filter === option} className={`lmp-filter ${filter === option ? 'is-active' : ''} ${option !== 'all' ? `lmp-filter-${option}` : ''}`}
                onClick={() => setFilter(option)}>{option !== 'all' && <AppIcon name={STATUS[option].icon} size={16} />}{option === 'all' ? 'All' : STATUS[option].label}</button>)}</div>
              <select aria-label="Activity type" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="all">All activity types</option>{types.map(type => <option key={type} value={type}>{type}</option>)}</select>
              <label className="lmp-search"><AppIcon name="ri-search-line" size={17} /><input aria-label="Search activities" placeholder="Search activities…" value={query} onChange={event => setQuery(event.target.value)} /></label>
            </div>
            <div className="lmp-weekly-controls"><span>{matchingCount} of {activities.length} activities · Overall progress stays unchanged by filters</span>
              <div><button type="button" onClick={() => setCollapsed(new Set())}>Expand all</button><button type="button" onClick={() => setCollapsed(new Set(weeks.map(week => week.id)))}>Collapse all</button></div></div>
            <div className="lmp-weeks">{weeks.filter(week => week.rows.some(matches)).map((week, index) => {
              const rows = week.rows.filter(matches); const done = week.rows.filter(row => row.status === 'completed').length; const percent = ratioPercent(done, week.rows.length);
              const hours = recordedHours(week.rows); const weekPoints = plannedPoints(week.rows); const codes = new Set(week.rows.flatMap(row => row.ksbs)); const open = !collapsed.has(week.id);
              return <section className="lmp-week" key={week.id} aria-label={week.title}>
                <button type="button" className="lmp-week-heading" aria-expanded={open} aria-controls={`lmp-week-${index}`} onClick={() => toggleWeek(week.id)}>
                  <AppIcon name={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} size={21} /><strong>{week.title}</strong><span className="lmp-week-count">{done} / {week.rows.length} activities</span>
                  <span className="lmp-week-metrics"><span className="lmp-pill lmp-pill-green" title="Recorded accepted hours">OTH: {hours == null ? 'N/A' : formatHoursMinutes(hours)}</span>
                    <span className="lmp-pill lmp-pill-blue" title="Distinct mapped or evidenced KSBs">KSBs: {codes.size}</span><span className="lmp-pill lmp-pill-orange" title="Planned points">Points: {weekPoints == null ? 'N/A' : numberLabel(weekPoints)}</span>
                    <ProgressBar percent={percent} label={`${week.title} completion`} tone={percent === 100 ? 'green' : 'purple'} /><b>{percent == null ? 'N/A' : `${percent}%`}</b></span>
                </button>
                {open && <div id={`lmp-week-${index}`}><ActivityTable rows={rows} onOpen={setSelectedActivity} onStatus={changeStatus} busy={savingStatus} /></div>}
              </section>;
            })}</div>
            {!activities.length && <EntityEmptyState icon="ri-book-open-line" title="No assigned activities returned" message="The module’s activity list is unavailable or empty. Reload the assigned learners to check its content." />}
            {Boolean(activities.length) && !matchingCount && <EntityEmptyState icon="ri-search-line" title="No activities match these filters" message="Clear the search or select All to see the module’s activities." />}
            <div className="lmp-notes"><div><AppIcon name="ri-time-line" size={27} /><p><strong>Time calculation note</strong><span>Times are shown in UK time. Missing recorded times remain unavailable.</span></p></div>
              <div><AppIcon name="ri-information-fill" size={27} /><p><strong>Progress note</strong><span>Not Started preserves Activity Log hours and evidence. OTH uses accepted Activity Log hours. Points are planned.</span></p></div></div>
          </section>
        </>}
      {selectedActivity && <ActivityDrawer row={selectedActivity} onClose={closeDrawer} moduleId={moduleId} learnerId={profileId} />}
      {attendanceActivity && <AttendanceDialog row={attendanceActivity} onClose={() => setAttendanceActivity(null)}
        onRecording={() => { setCompletionActivity(attendanceActivity); setAttendanceActivity(null); }}
        onSave={values => saveStatus(attendanceActivity, 'completed', values)} />}
      {completionActivity && <CompletionDialog row={completionActivity} recording={completionActivity.type === 'Attendance'} onClose={() => setCompletionActivity(null)}
        onSave={values => saveStatus(completionActivity, 'completed', { ...values, ...(completionActivity.type === 'Attendance' ? { attendanceMode: 'recording' as const } : {}) })} />}
    </div>
  </WorkspaceShell>;
}
