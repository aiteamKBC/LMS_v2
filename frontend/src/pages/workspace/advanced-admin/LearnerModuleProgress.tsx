import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { advancedAdminMonthlyLogs, type AdvancedAdminLearner, type AdvancedAdminModuleProgress, type AdvancedAdminWordPressCourse } from '@/api/advancedAdmin';
import type { SubjectEntry } from '@/pages/learner/my-learning/learningSummary';
import { OtjHoursChart } from '@/pages/learner/training-plan-timeline/OtjHoursChart';
import { monthlyLogOtjh } from '@/pages/workspace/learner/useDashboardPlan';
import { buildModuleViews, defaultModuleId, type Learning } from './moduleProgressModel';
import styles from './LearnerModuleProgress.module.css';
type ActivityStatus = 'Completed' | 'Needs Attention' | 'In Progress' | 'Not Started';
type ActivityType = 'Attendance' | 'Quiz' | 'Reading' | 'Audio' | 'Video' | 'Activity';

const activityTypes: ActivityType[] = ['Attendance', 'Quiz', 'Reading', 'Audio', 'Video', 'Activity'];
const statuses: ActivityStatus[] = ['Needs Attention', 'In Progress', 'Completed'];
const count = (value: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value);
const percent = (done: number | null, total: number | null) =>
  done != null && total != null && total > 0 ? Math.min(100, Math.round(done / total * 100)) : null;
const displayPercent = (value: number | null) => value == null ? 'N/A' : `${value}%`;
const dateLabel = (value: string | null | undefined) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'N/A' : parsed.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    ...(value.includes('T') ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Europe/London',
  });
};
const hoursLabel = (value: number | null) => value == null ? 'N/A' : `${count(value)}h`;

function activityType(entry: SubjectEntry): ActivityType {
  const category = (entry.category || '').toLowerCase().replace(/[-\s]+/g, '_');
  if (['attendance', 'live_session', 'session'].includes(category)) return 'Attendance';
  if (category.includes('quiz')) return 'Quiz';
  if (['reading', 'powerpoint', 'pdf', 'document', 'slides'].includes(category)) return 'Reading';
  if (['audio', 'podcast'].includes(category)) return 'Audio';
  if (category === 'video') return 'Video';
  return 'Activity';
}

function activityStatus(entry: SubjectEntry, learning: Learning): ActivityStatus {
  if (entry.completed) return 'Completed';
  const marking = entry.native?.componentId && learning.current.componentMarkingStatus?.[entry.native.componentId];
  if (marking && ['referred', 'rejected'].includes(marking.status)) return 'Needs Attention';
  if (marking?.status === 'submitted_for_tutor_review' || entry.legacy?.has_result ||
    entry.legacy?.video_started || entry.legacy?.reading_viewed || entry.legacy?.quiz_attempted ||
    (entry.native?.quizMeta && learning.current.quizAttempts?.some(attempt => attempt.quizId === entry.native?.quizMeta?.quizId))) {
    return 'In Progress';
  }
  return 'Not Started';
}

function ProgressBar({ value, label }: { value: number | null; label: string }) {
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={value ?? undefined} aria-valuetext={displayPercent(value)}
    className="h-2 overflow-hidden rounded-full bg-foreground-100">
    {value != null && <div className="h-full rounded-full bg-primary-600" style={{ width: `${value}%` }} />}
  </div>;
}

function MetricCard({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return <div className="rounded-xl border border-primary-100 bg-white p-4 text-center">
    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full p-[7px]"
      style={{ background: value == null ? '#e5e7eb' : `conic-gradient(#10b981 ${value}%, #e5e7eb 0)` }}>
      <span className="flex h-full w-full items-center justify-center rounded-full bg-white text-lg font-bold text-primary-900">{displayPercent(value)}</span>
    </div>
    <h4 className="mt-3 text-sm font-semibold text-foreground-900">{label}</h4>
    <p className="mt-1 text-sm font-medium text-foreground-800">{detail}</p>
  </div>;
}

function weekLabel(entry: SubjectEntry) {
  return entry.week || entry.legacy?.section_title ||
    (entry.schedule.week_start ? `Week of ${dateLabel(entry.schedule.week_start)}` : 'Unscheduled activities');
}

function recordedActivity(entry: SubjectEntry, learning: Learning) {
  return learning.historical.canonical_otjh_activities?.filter(row =>
    row.componentId && row.componentId === entry.native?.componentId) || [];
}

function recordedHours(entry: SubjectEntry, learning: Learning) {
  const canonical = recordedActivity(entry, learning);
  return canonical.length ? canonical.reduce((sum, row) => sum + row.actualSeconds, 0) / 3600
    : entry.legacy?.hours_mapped ? entry.legacy.actual : null;
}

export default function LearnerModuleProgress({ learner, learning, progress, wordpressCourses, onOpenActivity }: {
  learner: AdvancedAdminLearner;
  learning: Learning;
  progress: AdvancedAdminModuleProgress;
  wordpressCourses?: AdvancedAdminWordPressCourse[];
  onOpenActivity: (subjectId: string, activityId: string) => void;
}) {
  const modules = useMemo(() => buildModuleViews(learning, progress, wordpressCourses), [learning, progress, wordpressCourses]);
  const [selection, setSelection] = useState<{ learnerId: number; moduleId: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<ActivityStatus | 'All'>('All');
  const [typeFilter, setTypeFilter] = useState<ActivityType | 'All'>('All');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [monthlyLogs, setMonthlyLogs] = useState<Awaited<ReturnType<typeof advancedAdminMonthlyLogs>> | null>(null);
  const [hoursLoading, setHoursLoading] = useState(true);
  const [hoursError, setHoursError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setMonthlyLogs(null); setHoursLoading(true); setHoursError('');
    advancedAdminMonthlyLogs(learner.id, controller.signal)
      .then(result => { if (!controller.signal.aborted) setMonthlyLogs(result); })
      .catch(error => { if (!controller.signal.aborted) setHoursError(error instanceof Error ? error.message : 'Could not load monthly hours.'); })
      .finally(() => { if (!controller.signal.aborted) setHoursLoading(false); });
    return () => controller.abort();
  }, [learner.id]);
  const loggedHours = monthlyLogs ? monthlyLogOtjh({
    learner: { planned_end_date: progress.programmeEndDate },
    months: monthlyLogs.months,
    training_plan_totals: monthlyLogs.trainingPlanTotals,
  }) : null;
  const chartData = loggedHours ? {
    months: progress.months,
    actual: progress.actual,
    actualAvailable: progress.actualAvailable,
    monthlyLogOtjh: loggedHours.months,
    requiredOtjh: loggedHours.plannedTotal,
  } : null;
  const selectedId = selection?.learnerId === learner.id ? selection.moduleId : null;
  const selected = modules.find(module => module.subject.id === selectedId) ||
    modules.find(module => module.subject.id === defaultModuleId(modules, progress));
  const activities = selected?.subject.activities || [];
  const startedActivities = activities.filter(entry => activityType(entry) !== 'Attendance' && activityStatus(entry, learning) !== 'Not Started');
  const filtered = startedActivities.filter(entry =>
    (statusFilter === 'All' || activityStatus(entry, learning) === statusFilter) &&
    (typeFilter === 'All' || activityType(entry) === typeFilter) &&
    entry.title.toLowerCase().includes(search.trim().toLowerCase()));
  const weeks = new Map<string, SubjectEntry[]>();
  for (const entry of filtered) {
    const key = weekLabel(entry);
    weeks.set(key, [...(weeks.get(key) || []), entry]);
  }
  const hourPercent = selected ? percent(selected.hoursActual, selected.hoursPlanned) : null;
  const ksbPercent = selected ? percent(selected.ksbDone, selected.ksbTotal) : null;
  const activityPercent = selected ? percent(selected.done, selected.total) : null;
  const overall = [hourPercent, ksbPercent, activityPercent].every(value => value != null)
    ? Math.round(((hourPercent || 0) + (ksbPercent || 0) + (activityPercent || 0)) / 3) : null;

  return <div className="space-y-4 text-foreground-900">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-2xl font-bold text-primary-950">Learner Module Progress</h2>
        <p className="mt-1 text-sm text-primary-700">Review module activities, OTH, KSBs and completion.</p></div>
      <Link to="/workspace/advanced-admin" className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-white px-4 py-2 text-sm font-semibold text-primary-900 hover:bg-primary-50"><ArrowLeft size={16} />Back to Students</Link>
    </div>

    <section aria-label="Learner details" className="grid gap-4 rounded-xl border border-primary-100 bg-primary-50/50 p-4 text-sm sm:grid-cols-2 xl:grid-cols-5">
      <div><strong className="block text-base">{learner.name}</strong><span className="block break-all text-primary-700">{learner.email || 'Email N/A'}</span><span className="text-primary-700">Learner ID: {learner.enrolmentId ?? 'N/A'}</span></div>
      <div><span className="block text-foreground-500">Programme</span><strong>{learner.programme || 'N/A'}</strong></div>
      <div><span className="block text-foreground-500">Cohort</span><strong>{learner.cohort || 'N/A'}</strong><span className="block text-primary-700">{learner.group || ''}</span></div>
      <div><span className="block text-foreground-500">Module</span><strong>{selected?.subject.title || 'Select a module below'}</strong><span className="block break-all text-primary-700">{selected?.code || 'N/A'}</span></div>
      <div><span className="block text-foreground-500">Last activity</span><strong>{dateLabel(selected?.lastActivity)}</strong><span className="block text-primary-700">{selected ? selected.total > 0 && selected.done === selected.total ? 'Completed' : selected.done > 0 ? 'In Progress' : 'Not Started' : 'N/A'}</span></div>
    </section>

    <section aria-label="Module selector" className="rounded-xl border border-primary-100 bg-white p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-64 flex-1"><label htmlFor="module-progress-select" className="mb-1 block text-sm font-semibold">Module</label>
          <select id="module-progress-select" value={selected?.subject.id || ''} onChange={event => {
            setSelection({ learnerId: learner.id, moduleId: event.target.value }); setCollapsed([]); setStatusFilter('All'); setTypeFilter('All'); setSearch('');
          }} className="w-full rounded-lg border border-primary-200 bg-white px-3 py-2 text-sm text-primary-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600">
            {modules.length === 0 && <option value="">No modules assigned</option>}
            {modules.map(module => <option key={module.subject.id} value={module.subject.id}>{module.subject.title}</option>)}
          </select>
        </div>
        <span className="text-xs text-foreground-500">{modules.length} modules</span>
      </div>
      {selected && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-primary-800">
        <span>{selected.subject.source === 'legacy' ? 'WordPress course' : 'Current LMS module'}</span>
        <strong>{selected.done} / {selected.total} activities complete</strong>
        <strong>{displayPercent(percent(selected.done, selected.total))}</strong>
      </div>}
    </section>

    {selected && <>
      <div className="space-y-4">
        <section aria-label="Progress Overview" className="rounded-xl border border-primary-100 bg-primary-50/50 p-4">
          <h3 className="mb-3 font-bold">Progress Overview</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <MetricCard label="OTH Progress" value={hourPercent} detail={`${hoursLabel(selected.hoursActual)} / ${hoursLabel(selected.hoursPlanned)}`} />
            <MetricCard label="KSB Progress" value={ksbPercent} detail={`${selected.ksbDone ?? 'N/A'} / ${selected.ksbTotal ?? 'N/A'} mapped weight`} />
            <MetricCard label="Activities Progress" value={activityPercent} detail={`${selected.done} / ${selected.total} completed`} />
          </div>
          <div className="mt-4 border-t border-primary-100 pt-3"><div className="mb-2 flex justify-between text-sm font-semibold"><span>Overall Progress</span><span>{displayPercent(overall)}</span></div>
            <ProgressBar value={overall} label="Overall progress" /><p className="mt-2 text-xs text-primary-700">Average of OTH, KSB and activities when all three values are available.</p></div>
        </section>
        {hoursLoading && <p role="status" className="rounded-xl border border-primary-100 bg-white p-4 text-sm text-primary-700">Loading off-the-job hours…</p>}
        {hoursError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Off-the-job hours unavailable: {hoursError}</p>}
        {chartData && <div className={styles.hoursChart}>
          <OtjHoursChart data={chartData} programmeStartMonth={progress.programmeStartDate?.slice(0, 7)}
            programmeEndMonth={loggedHours?.plannedEndDate?.slice(0, 7) || progress.programmeEndDate?.slice(0, 7)}
            targetAsOfToday={progress.targetAsOfToday} />
        </div>}
      </div>

      <section aria-label="Weekly Activity Breakdown" className="rounded-xl border border-primary-100 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-bold">Weekly Activity Breakdown</h3>
          <p className="text-xs text-foreground-500">{startedActivities.length} started activities shown · progress totals still include all {activities.length} assigned activities.</p></div>
          <div className="flex flex-wrap gap-2" aria-label="Activity status filters">
            {(['All', ...statuses] as const).map(status => <button key={status} type="button" aria-pressed={statusFilter === status}
              onClick={() => setStatusFilter(status)} className={`rounded-full border px-3 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 ${statusFilter === status ? 'border-primary-500 bg-primary-100 text-primary-900' : 'border-foreground-200 hover:bg-primary-50'}`}>{status}</button>)}
          </div>
        </div>
        <div className="my-3 flex flex-wrap gap-2"><label className="sr-only" htmlFor="module-activity-type">Activity type</label>
          <select id="module-activity-type" value={typeFilter} onChange={event => setTypeFilter(event.target.value as ActivityType | 'All')}
            className="rounded-lg border border-foreground-200 bg-white px-3 py-2 text-sm"><option value="All">All activity types</option>{activityTypes.filter(type => type !== 'Attendance').map(type => <option key={type}>{type}</option>)}</select>
          <label className="relative min-w-48 flex-1"><Search size={16} className="absolute left-3 top-3 text-foreground-400" aria-hidden="true" /><span className="sr-only">Search activities</span>
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search activities…" className="w-full rounded-lg border border-foreground-200 py-2 pl-9 pr-3 text-sm" /></label>
          <button type="button" className="text-xs font-semibold text-primary-700 underline" onClick={() => setCollapsed([])}>Expand all</button>
          <button type="button" className="text-xs font-semibold text-primary-700 underline" onClick={() => setCollapsed([...weeks.keys()])}>Collapse all</button>
        </div>
        {weeks.size === 0 && <p className="rounded-lg bg-background-100 p-4 text-sm">No activities match these filters.</p>}
        <div className="space-y-2">{[...weeks].map(([week, entries]) => {
          const isCollapsed = collapsed.includes(week);
          const assignedWeek = activities.filter(entry => weekLabel(entry) === week);
          const weekDone = assignedWeek.filter(item => item.completed).length;
          const weekHours = assignedWeek.reduce((sum, entry) => sum + (recordedHours(entry, learning) || 0), 0);
          const hasWeekHours = assignedWeek.some(entry => recordedHours(entry, learning) != null);
          return <div key={week} className="overflow-hidden rounded-lg border border-foreground-200">
            <button type="button" onClick={() => setCollapsed(previous => isCollapsed ? previous.filter(item => item !== week) : [...previous, week])}
              aria-expanded={!isCollapsed} className="flex w-full flex-wrap items-center justify-between gap-2 bg-primary-50 px-3 py-3 text-left text-sm">
              <span className="flex items-center gap-2 font-semibold">{isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}{week}</span>
              <span className="text-xs text-primary-700">{weekDone} / {assignedWeek.length} activities · OTH {hasWeekHours ? hoursLabel(weekHours) : 'N/A'} · {displayPercent(percent(weekDone, assignedWeek.length))}</span>
            </button>
            {!isCollapsed && <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="bg-background-100 text-foreground-600"><tr>{['Activity', 'OTH', 'Time', 'Status / Result', 'Actions'].map(label => <th key={label} scope="col" className="px-3 py-2 font-semibold">{label}</th>)}</tr></thead>
              <tbody>{entries.map(entry => {
                const canonical = recordedActivity(entry, learning).map(row => row.submittedAt).filter(Boolean).sort().at(-1);
                const hours = recordedHours(entry, learning);
                const status = activityStatus(entry, learning);
                return <tr key={entry.id} className="border-t border-foreground-100"><td className="max-w-[24rem] px-3 py-3"><strong className="block">{entry.title}</strong><span className="text-foreground-500">{activityType(entry)}</span></td>
                  <td className="px-3 py-3">{hoursLabel(hours)}</td>
                  <td className="px-3 py-3">{dateLabel(canonical || entry.legacy?.date)}</td>
                  <td className="px-3 py-3"><span className="rounded-full bg-background-100 px-2 py-1">{status}</span>{entry.bestScorePercent != null && <span className="ml-1">{Math.round(entry.bestScorePercent)}%</span>}</td>
                  <td className="px-3 py-3"><button type="button" onClick={() => onOpenActivity(selected.subject.id, entry.id)} className="inline-flex items-center gap-1 rounded-lg border border-primary-200 px-3 py-1.5 font-semibold text-primary-700 hover:bg-primary-50"><BookOpen size={14} />View Details</button></td>
                </tr>;
              })}</tbody></table></div>}
          </div>;
        })}</div>
        {selected.subject.recordedHistory && <p className="mt-3 text-xs text-foreground-500">WordPress activity rows are recorded history; the full catalogue may contain activities without a recorded row.</p>}
      </section>
    </>}
  </div>;
}
