import { Fragment, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { CalendarDays, CheckCircle2, ClipboardCheck, Presentation, Search, X } from 'lucide-react';
import {
  advancedAdminLectureWorkspace,
  type AdvancedAdminAttendance, type AdvancedAdminLecture, type AdvancedAdminLectureWorkspace,
  type AdvancedAdminQuality,
} from '@/api/advancedAdmin';
import { lectureTimeline } from './lectureTimeline';
import QualityReport from './QualityReport';

type LectureRow = AdvancedAdminAttendance & { lecture?: AdvancedAdminLecture };
type QualitySelection = { title: string; reports: AdvancedAdminQuality[] };

function statusLabel(status: string) {
  return ({ present: 'Attended', completed: 'Attended', late: 'Late', absent: 'Absent',
    upcoming: 'Upcoming', in_progress: 'In progress', pending: 'Awaiting attendance',
    unmarked: 'Unmarked' } as Record<string, string>)[status] || status || 'Unknown';
}

function statusTone(status: string) {
  if (['present', 'completed', 'late'].includes(status)) return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
  if (status === 'absent') return 'bg-red-50 text-red-700 ring-red-100';
  if (status === 'upcoming' || status === 'in_progress') return 'bg-violet-50 text-violet-700 ring-violet-100';
  return 'bg-slate-50 text-slate-600 ring-slate-100';
}

function displayDate(value: string | null | undefined) {
  if (!value) return 'Date not recorded';
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function displayMonth(value: string | null | undefined) {
  if (!value) return 'Date not recorded';
  const date = new Date(`${value.slice(0, 7)}-01T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function businessDay(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const field = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${field('year')}-${field('month')}-${field('day')}`;
}

function QualityDialog({ selection, onClose }: { selection: QualitySelection; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => { element.close(); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId}
    className="w-[min(960px,calc(100vw-2rem))] max-h-[92vh] rounded-2xl border border-foreground-200 p-0 shadow-2xl backdrop:bg-slate-950/50"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-foreground-100 bg-white px-3 py-3 sm:items-center sm:px-5 sm:py-4">
      <div className="min-w-0"><h2 id={titleId} className="break-words text-base font-semibold text-primary-900 sm:text-lg">Quality · {selection.title}</h2>
        <p className="text-xs text-foreground-500">Reports for this learner from AiTeamKBC</p></div>
      <button type="button" aria-label="Close Quality" onClick={onClose}
        className="shrink-0 rounded-lg p-2 text-foreground-600 hover:bg-foreground-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"><X size={18} /></button>
    </div>
    <div className="space-y-4 overflow-y-auto p-3 sm:p-5">
      {selection.reports.length === 0 ? <p className="rounded-xl bg-foreground-50 p-4 text-sm text-foreground-600">No quality report is linked to this lecture.</p>
        : selection.reports.map((report, index) => <QualityReport key={`${report.source}:${report.sessionId}:${index}`} report={report} />)}
    </div>
  </dialog>, document.body);
}

export default function LectureQualityTimeline({ learnerId, active, attendance, quality, attendanceError, qualityError, loading }: {
  learnerId: number;
  active: boolean;
  attendance: AdvancedAdminAttendance[];
  quality: { tutor: AdvancedAdminQuality[]; lecture: AdvancedAdminQuality[] };
  attendanceError?: string;
  qualityError?: string;
  loading: boolean;
}) {
  const [workspace, setWorkspace] = useState<AdvancedAdminLectureWorkspace | null>(null);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [moduleId, setModuleId] = useState('all');
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [groupByMonth, setGroupByMonth] = useState(false);
  const [selection, setSelection] = useState<QualitySelection | null>(null);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setWorkspace(null); setWorkspaceError(''); setWorkspaceLoading(true);
    advancedAdminLectureWorkspace(learnerId, controller.signal)
      .then(result => { if (!controller.signal.aborted) setWorkspace(result); })
      .catch(error => { if (!controller.signal.aborted) setWorkspaceError(error instanceof Error ? error.message : 'Lecture schedule is unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setWorkspaceLoading(false); });
    return () => controller.abort();
  }, [active, learnerId]);

  const rows: LectureRow[] = workspace ? workspace.lectures.map(lecture => ({
    sessionId: lecture.sessionId, date: lecture.date, title: lecture.title,
    module: lecture.module, status: lecture.status, lecture,
  })) : attendance;
  const reports = [...quality.tutor, ...quality.lecture];
  const timeline = lectureTimeline(rows, reports);
  const linked = new Map<AdvancedAdminAttendance, AdvancedAdminQuality[]>();
  for (const day of timeline) for (const item of day.lectures) linked.set(item.attendance, [...item.tutor, ...item.lecture]);
  const modules = workspace?.modules.length ? workspace.modules : [...new Set(rows.map(row => row.module).filter(Boolean))]
    .map(title => ({ id: title, title }));
  const selectedModule = modules.some(module => module.id === moduleId) ? moduleId : 'all';
  const moduleRows = rows.filter(row => selectedModule === 'all' || (workspace ? row.lecture?.moduleId === selectedModule : row.module === selectedModule));
  const today = businessDay(workspace?.timeZone || 'Europe/London');
  const totalLectures = moduleRows.filter(row => row.date && row.date.slice(0, 10) <= today).length;
  const attended = moduleRows.filter(row => ['present', 'completed', 'late'].includes(row.status)).length;
  const absent = moduleRows.filter(row => row.status === 'absent').length;
  const covered = moduleRows.filter(row => row.lecture?.catchupStatus === 'completed').length;
  const rate = attended + absent ? Math.round(attended / (attended + absent) * 100) : null;
  const months = [...new Set(moduleRows.map(row => row.date?.slice(0, 7)).filter((value): value is string => !!value))].sort().reverse();
  const selectedMonth = months.includes(month) ? month : 'all';
  const searched = moduleRows.filter(row => {
    const matchingStatus = statusFilter === 'all' || (statusFilter === 'attended'
      ? ['present', 'completed', 'late'].includes(row.status) : statusFilter === 'covered'
        ? row.lecture?.catchupStatus === 'completed' : row.status === statusFilter);
    return matchingStatus && (selectedMonth === 'all' || row.date?.startsWith(selectedMonth)) &&
      `${row.title} ${row.module} ${row.lecture?.contentSummary || ''} ${row.lecture?.ksbs.join(' ') || ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
  const featured = workspace?.lectures.filter(lecture => ['upcoming', 'in_progress'].includes(lecture.status))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))[0];
  const qualityFor = (row: LectureRow) => linked.get(row) || [];
  const openQuality = (title: string, chosen: AdvancedAdminQuality[]) => setSelection({ title, reports: chosen });

  return <section aria-labelledby="advanced-lecture-timeline" className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 id="advanced-lecture-timeline" className="flex items-center gap-2 text-xl font-semibold text-foreground-900"><CheckCircle2 size={18} className="shrink-0 text-primary-700" />Attendance</h2>
        <p className="mt-1 text-sm text-foreground-600">Scheduled lectures, attendance status and quality reports for this learner.</p></div>
      <button type="button" onClick={() => openQuality('all reports', reports)}
        className="inline-flex items-center gap-2 rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"><ClipboardCheck size={16} />Quality</button>
    </div>
    {attendanceError && !workspace && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">Attendance: {attendanceError}</p>}
    {qualityError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">Quality: {qualityError}</p>}
    {workspaceError && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Live lecture schedule is unavailable. Showing the recorded attendance register. {workspaceError}</p>}
    {workspaceLoading && <p role="status" className="rounded-xl border bg-white p-4 text-sm">Loading lecture schedule…</p>}

    <div className="min-w-0 rounded-2xl border border-foreground-200 bg-white p-4 shadow-sm sm:p-5">
      {featured ? <>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground-100 pb-4">
          <div className="flex min-w-0 items-center gap-3"><span className="shrink-0 rounded-xl bg-primary-50 p-3 text-primary-700"><Presentation size={22} /></span>
            <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-foreground-500">{featured.date === today ? "Today's lecture" : 'Next lecture'}</p>
              <h3 className="break-words text-lg font-semibold text-primary-900 sm:text-xl">{featured.title}</h3><p className="break-words text-xs text-foreground-500">{featured.module}</p></div></div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusTone(featured.status)}`}>{featured.date === today ? 'Today' : statusLabel(featured.status)}</span>
        </div>
        <dl className="grid gap-4 border-b border-foreground-100 py-4 text-sm sm:grid-cols-2 xl:grid-cols-5">
          {[['Tutor', featured.tutor || 'Not recorded'], ['Coach', featured.coach || 'Not recorded'],
            ['Date', displayDate(featured.date)], ['Timing', featured.startTime ? `${featured.startTime}${featured.endTime ? ` – ${featured.endTime}` : ''}` : 'Not recorded'],
            ['Duration', featured.durationMinutes ? `${Number((featured.durationMinutes / 60).toFixed(2))} hours` : 'Not recorded']]
            .map(([label, value]) => <div key={label}><dt className="text-xs text-foreground-500">{label}</dt><dd className="mt-1 font-semibold text-primary-800">{value}</dd></div>)}
        </dl>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 text-xs text-foreground-500"><p>Times shown in {workspace?.timeZone || 'Europe/London'}.</p>
          <button type="button" onClick={() => openQuality(featured.title, qualityFor(rows.find(row => row.lecture === featured)!))}
            className="rounded-lg border border-primary-200 px-4 py-2 font-semibold text-primary-700 hover:bg-primary-50">Quality</button></div>
      </> : <div className="flex items-center gap-3"><span className="rounded-xl bg-primary-50 p-3 text-primary-700"><Presentation size={22} /></span>
        <div><h3 className="font-semibold text-primary-900">{loading || workspaceLoading ? 'Loading lectures…' : 'No upcoming lectures'}</h3>
          {!(loading || workspaceLoading) && <p className="text-sm text-foreground-500">The next scheduled lecture will appear here when available.</p>}</div></div>}
    </div>

    <div className="space-y-4">
      <div className="min-w-0 space-y-4">
        <div className="grid min-w-0 gap-4 rounded-2xl border border-foreground-200 bg-white p-4 shadow-sm xl:grid-cols-[minmax(180px,1.2fr)_minmax(130px,.8fr)_minmax(0,2fr)] xl:items-center">
          <label className="block text-xs font-semibold text-foreground-700">Select Module
            <select aria-label="Module" value={selectedModule} onChange={event => { setModuleId(event.target.value); setMonth('all'); }}
              className="mt-2 w-full rounded-lg border border-foreground-200 bg-white px-3 py-2 text-sm font-normal">
              <option value="all">All modules</option>{modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}
            </select></label>
          <div className="min-w-0"><h3 className="text-xs font-semibold text-foreground-800">Module Overview</h3>
            <p className="mt-1 break-words text-xs text-primary-700">{modules.find(module => module.id === selectedModule)?.title || 'All modules'}</p>
            <p className="mt-1 text-xs text-foreground-500">{rate == null ? 'No completed attendance yet' : `${rate}% attendance`}</p></div>
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
            {[['Total Lectures', totalLectures, 'text-blue-700 bg-blue-50'], ['Attended', attended, 'text-emerald-700 bg-emerald-50'],
              ['Absent', absent, 'text-red-700 bg-red-50'], ['Covered Missed', covered, 'text-violet-700 bg-violet-50']]
              .map(([label, value, tone]) => <div key={label} className={`rounded-xl border border-foreground-100 p-2 ${tone}`}>
                <strong className="block text-lg">{value}</strong><span className="text-[11px]">{label}</span></div>)}
          </div>
        </div>
        <div className="min-w-0 rounded-2xl border border-foreground-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-3"><h3 className="flex items-center gap-2 font-semibold text-primary-900"><Presentation size={18} />Lectures</h3>
            <Link to={`/workspace/advanced-admin/learners/${learnerId}/learning?view=courses`} className="text-xs text-primary-700 underline">View all modules</Link></div>
          <details className="mb-3 px-1 text-sm"><summary className="cursor-pointer text-xs text-foreground-600">Search &amp; filters</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(150px,auto)_minmax(150px,auto)]"><label className="relative min-w-0"><span className="sr-only">Search lectures</span><Search size={15} className="absolute left-2 top-2.5 text-foreground-400" />
              <input aria-label="Search lectures" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search lectures" className="w-full rounded-lg border border-foreground-200 py-2 pl-8 pr-2 text-xs" /></label>
              <select aria-label="Month" value={selectedMonth} onChange={event => setMonth(event.target.value)} className="w-full min-w-0 rounded-lg border border-foreground-200 px-2 py-2 text-xs"><option value="all">All months</option>{months.map(value => <option key={value} value={value}>{value}</option>)}</select>
              <select aria-label="Status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="w-full min-w-0 rounded-lg border border-foreground-200 px-2 py-2 text-xs sm:col-span-2 lg:col-span-1">
                <option value="all">All statuses</option><option value="attended">Attended</option><option value="absent">Absent</option><option value="covered">Covered</option><option value="upcoming">Upcoming</option></select>
            </div></details>
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2 text-xs text-foreground-500"><span role="status">{searched.length} lectures · {new Set(searched.map(row => row.date?.slice(0, 7))).size} months</span>
            <button type="button" aria-pressed={groupByMonth} onClick={() => setGroupByMonth(value => !value)} className="inline-flex items-center gap-1 rounded-md px-1 py-1 text-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"><CalendarDays size={14} />Group by month</button></div>
          <p className="px-1 pb-2 text-xs text-foreground-500 xl:hidden">Scroll the table sideways to see all lecture details.</p>
          <div role="region" aria-label="Lecture register" tabIndex={0} className="w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-foreground-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600">
            <table className="w-full min-w-[1320px] table-fixed border-collapse text-left text-xs"
              style={{ '--kbc-chrome-color': '#4f2b7f' } as CSSProperties}>
              <colgroup>
                <col style={{ width: 220 }} /><col style={{ width: 145 }} /><col style={{ width: 70 }} />
                <col /><col style={{ width: 260 }} /><col style={{ width: 100 }} />
                <col style={{ width: 105 }} />
              </colgroup>
              <thead className="bg-primary-800 text-white"><tr>{['Lecture', 'Date & Time', 'Hours', 'Key Content', 'KSBs', 'Status', 'Quality'].map(label => <th key={label} scope="col" className="!text-left px-3 py-2 font-semibold">{label}</th>)}</tr></thead>
              <tbody>{searched.map((row, index) => <Fragment key={`${row.lecture?.id || row.sessionId || row.title}:${index}`}>
                {groupByMonth && row.date?.slice(0, 7) !== searched[index - 1]?.date?.slice(0, 7) &&
                  <tr className="bg-primary-50"><th colSpan={7} scope="rowgroup" className="px-3 py-2 text-left font-semibold text-primary-800">{displayMonth(row.date)}</th></tr>}
                <tr className="border-b border-foreground-100 align-top hover:bg-primary-50/30">
                <td className="!text-left px-3 py-3 align-top"><strong className="block break-words leading-5 text-primary-900">{row.title || 'Lecture'}</strong><span className="mt-1 block break-words text-[11px] leading-4 text-foreground-500">{row.module}</span></td>
                <td className="!text-left whitespace-nowrap px-3 py-3 align-top text-primary-700">{displayDate(row.date)}<span className="block text-foreground-500">{row.lecture?.startTime || ''}{row.lecture?.endTime ? ` – ${row.lecture.endTime}` : ''}</span></td>
                <td className="!text-left px-3 py-3 align-top">{row.lecture?.durationMinutes ? Number((row.lecture.durationMinutes / 60).toFixed(2)) : '—'}</td>
                <td className="!text-left break-words px-3 py-3 align-top text-foreground-600"><span className="block whitespace-pre-line leading-5">{row.lecture?.contentSummary || 'Content not recorded'}</span></td>
                <td className="!text-left break-words px-3 py-3 align-top text-foreground-600"><span className="block leading-5">{row.lecture?.ksbs.length ? row.lecture.ksbs.join(', ') : '—'}</span></td>
                <td className="!text-left px-3 py-3 align-top"><span className={`inline-block whitespace-nowrap rounded-full px-2 py-1 ring-1 ${statusTone(row.status)}`}>{statusLabel(row.status)}</span></td>
                <td className="!text-left px-3 py-3 align-top"><button type="button" onClick={() => openQuality(row.title || 'Lecture', qualityFor(row))}
                  className="w-full rounded-lg border border-primary-200 px-2 py-1.5 font-semibold text-primary-700 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600">Quality{qualityFor(row).length > 0 ? ` (${qualityFor(row).length})` : ''}</button></td>
                </tr>
                </Fragment>)}</tbody>
            </table>
            {!searched.length && !loading && !workspaceLoading && <p className="p-4 text-sm text-foreground-500">No lectures match this selection.</p>}
          </div>
        </div>
      </div>
    </div>
    {selection && <QualityDialog selection={selection} onClose={() => setSelection(null)} />}
  </section>;
}
