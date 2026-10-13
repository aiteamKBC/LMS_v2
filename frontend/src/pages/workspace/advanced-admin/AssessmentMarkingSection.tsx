import { Fragment, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { ChevronDown, ChevronRight, Clock3, Eye, FileText, Pencil } from 'lucide-react';
import type { AdvancedAdminAuditAssignment, AdvancedAdminAuditEvidence, AdvancedAdminLearner, AdvancedAdminSubmission } from '@/api/advancedAdmin';
import { systemDateParts } from '@/lib/format';

const statusLabels: Record<string, string> = { notstarted: 'Planned', inprogress: 'In progress', evidencerequired: 'Evidence required',
  evidencesubmitted: 'Pending marking', pendingassessment: 'Pending marking', completed: 'Completed', referred: 'Referred', accepted: 'Accepted',
  partial: 'Partially awarded', rejected: 'Rejected', escalated: 'Escalated' };
const statusLabel = (value: string) => statusLabels[value.toLowerCase()] || value || 'Unknown';
const done = (item: AdvancedAdminAuditAssignment) => item.status.toLowerCase() === 'completed';
const hours = (value: number | null) => value == null ? '—' : `${Number(value.toFixed(2))}h`;
const monthName = (value: string) => value === 'Undated' ? 'Month unavailable' :
  new Date(`${value}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString('en-GB',
  { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }) : 'Not uploaded';
const academicYear = (month: string) => { const year = Number(month.slice(0, 4)); const start = month.slice(5) >= '09' ? year : year - 1; return `${start} - ${start + 1}`; };
const codes = (item: AdvancedAdminAuditAssignment) => [...new Set(item.evidence
  .filter(evidence => evidence.status.trim().toLowerCase() === 'accepted')
  .flatMap(evidence => evidence.verifiedKsbCodes))];
const reportHoursMessage = (item: AdvancedAdminAuditAssignment) => {
  if (item.monthSource !== 'upload') return null;
  if (item.missingReportHours) return `${item.missingReportHours} accepted ${item.missingReportHours === 1 ? 'file has' : 'files have'} no verified report hours.`;
  if (item.actualHours != null) return null;
  if (!done(item)) return 'Hours count after this file is accepted.';
  if (item.reportHoursStatus === 'missing_report') return 'No assessment report is recorded for this file.';
  if (item.reportHoursStatus === 'missing_time') return 'Time spent is missing from the assessment report.';
  return 'Assessment report hours could not be verified.';
};

export function HistoricalCoachMarking({ feedbacks, status }: { feedbacks: unknown[]; status: string }) {
  if (!feedbacks.length) return <p className="text-slate-500">No original coach feedback is recorded.</p>;
  return <div className="space-y-2" aria-label="Original coach marking">{feedbacks.map((value, index) => {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const body = typeof item.message === 'string' ? item.message : typeof value === 'string' ? value : '';
    const author = typeof item.author === 'string' ? item.author : '';
    const date = typeof item.date === 'string' ? item.date.slice(0, 10) : '';
    return <div key={index} className="rounded-lg bg-indigo-50 p-3 text-sm"><strong>Coach marking · {statusLabel(String(item.assessed_status || status))}</strong>
      {(author || date) && <p className="text-xs text-slate-600">{[author, date].filter(Boolean).join(' · ')}</p>}
      {body && <div className="prose mt-1 max-w-none break-words" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(body) }} />}</div>;
  })}</div>;
}

interface Props {
  learner?: AdvancedAdminLearner;
  assignments: AdvancedAdminAuditAssignment[];
  submissions: AdvancedAdminSubmission[];
  readOnly: boolean;
  loading: boolean;
  errors: { assessments?: string; auditAssignments?: string };
  onMark: (id: string, decision: string, feedback: string) => Promise<boolean>;
  onMarkAssignment: (id: number, decision: string, feedback: string) => Promise<boolean>;
  onMarkAssignmentSource: (id: number, decision: string, feedback: string) => Promise<boolean>;
  onOpenAssignmentDocument: (id: number, part: 'file' | 'report') => void;
}

export default function AssessmentMarkingSection({ learner, assignments, submissions, readOnly, loading,
  errors, onMark, onMarkAssignment, onMarkAssignmentSource, onOpenAssignmentDocument }: Props) {
  const [year, setYear] = useState('all');
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [marking, setMarking] = useState<number | null>(null);
  const [sourceMarking, setSourceMarking] = useState<number | null>(null);
  const [decision, setDecision] = useState('accepted');
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);
  const [otherOpen, setOtherOpen] = useState<string | null>(null);
  const [otherMarking, setOtherMarking] = useState<string | null>(null);
  const today = systemDateParts(new Date());
  const currentMonth = today ? `${today.year}-${String(today.month).padStart(2, '0')}` : '';
  const throughCurrentMonth = useMemo(() => assignments.filter(item =>
    item.month && item.month <= currentMonth), [assignments, currentMonth]);
  const undated = useMemo(() => assignments.filter(item =>
    !item.month && (item.monthSource === 'audit' || item.monthSource === 'upload')), [assignments]);
  const years = useMemo(() => [...new Set(throughCurrentMonth.map(item => academicYear(item.month!)))].sort().reverse(), [throughCurrentMonth]);
  const visible = useMemo(() => year === 'all' ? [...throughCurrentMonth, ...undated]
    : throughCurrentMonth.filter(item => item.month && academicYear(item.month) === year),
  [year, throughCurrentMonth, undated]);
  const groups = useMemo(() => {
    const result = new Map<string, AdvancedAdminAuditAssignment[]>();
    for (const item of visible) { const month = item.month || 'Undated'; result.set(month, [...(result.get(month) || []), item]); }
    return [...result].sort(([a], [b]) => (a === 'Undated' ? 1 : 0) - (b === 'Undated' ? 1 : 0) || b.localeCompare(a));
  }, [visible]);
  const totalHours = throughCurrentMonth.reduce((sum, item) => sum + (item.actualHours || 0), 0);
  const missingReportHours = throughCurrentMonth.reduce((sum, item) => sum + (
    item.missingReportHours ?? (item.monthSource === 'upload' && done(item) && item.actualHours == null ? 1 : 0)), 0);
  const missingPlannedHours = throughCurrentMonth.some(item =>
    item.monthSource === 'audit' && item.plannedHours == null);
  const plannedHours = throughCurrentMonth.reduce((sum, item) => sum + (item.plannedHours || 0), 0);
  const totalMonths = new Set(throughCurrentMonth.map(item => item.month).filter(Boolean)).size;
  const completed = throughCurrentMonth.filter(done).length;
  const percent = throughCurrentMonth.length ? Math.round(completed / throughCurrentMonth.length * 100) : 0;
  const otherSubmissions = submissions.filter(item => item.activityType !== 'assignment');
  const beginMark = (evidence: AdvancedAdminAuditEvidence, rowId: string) => {
    setOpened(rowId); setMarking(evidence.id); setSourceMarking(null);
    setOtherMarking(null);
    setDecision(evidence.reviews.at(-1)?.decision || 'accepted');
    setFeedback(evidence.reviews.at(-1)?.feedback || '');
  };
  const beginSourceMark = (item: AdvancedAdminAuditAssignment, rowId: string) => {
    if (item.sourceMarkId == null) return;
    setOpened(rowId); setSourceMarking(item.sourceMarkId); setMarking(null);
    setOtherMarking(null);
    setDecision(item.sourceReviews?.at(-1)?.decision || 'accepted');
    setFeedback(item.sourceReviews?.at(-1)?.feedback || '');
  };
  const save = async (id: number) => {
    setSaving(true);
    try { if (await onMarkAssignment(id, decision, feedback)) { setMarking(null); setFeedback(''); } }
    finally { setSaving(false); }
  };
  const saveSource = async (id: number) => {
    setSaving(true);
    try { if (await onMarkAssignmentSource(id, decision, feedback)) { setSourceMarking(null); setFeedback(''); } }
    finally { setSaving(false); }
  };
  const saveOther = async (id: string) => {
    setSaving(true);
    try { if (await onMark(id, decision, feedback)) { setOtherMarking(null); setFeedback(''); } }
    finally { setSaving(false); }
  };
  const decisionSelect = <select aria-label="Decision" value={decision} onChange={event => setDecision(event.target.value)} className="mt-1 block w-full rounded-lg border p-2">
    <option value="accepted">Accepted</option><option value="partial">Partially awarded</option><option value="referred">Referred</option><option value="escalated">Escalated</option><option value="rejected">Rejected</option>
  </select>;

  return <section className="space-y-4 text-[#101451]" aria-label="Assignments and marking">
    <div className="rounded-2xl border border-[#dce5f7] bg-white px-5 py-4 shadow-sm"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-[#dce5f7]">
      <div><p className="text-lg font-bold">{learner?.name || 'Learner assignments'}</p><p className="text-sm text-[#384680]">{learner?.email || 'Student profile'}</p></div>
      <div className="xl:pl-5"><p className="text-sm text-[#44538c]">Programme</p><p className="font-semibold">{learner?.programme || 'Not recorded'}</p></div>
      <div className="xl:pl-5"><p className="text-sm text-[#44538c]">Cohort</p><p className="font-semibold">{learner?.cohort || 'Not recorded'}</p></div>
      <div className="xl:pl-5"><p className="text-sm text-[#44538c]">Group</p><p className="font-semibold">{learner?.group || 'Not recorded'}</p></div>
    </div></div>
    {errors.auditAssignments && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">{errors.auditAssignments}</p>}
    {errors.assessments && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">{errors.assessments}</p>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Assignment summary">
      <div className="flex items-center gap-4 rounded-xl border border-[#dce5f7] bg-white p-4 shadow-sm"><span className="rounded-full bg-violet-100 p-4 text-violet-700"><FileText /></span><div><p className="text-sm text-[#3b4986]">Total Assignments & Activities</p><p className="text-3xl font-bold">{throughCurrentMonth.length}</p><p className="text-xs text-[#52619a]">across {totalMonths} months</p></div></div>
      <div className="flex items-center gap-4 rounded-xl border border-[#dce5f7] bg-white p-4 shadow-sm"><span className="rounded-full bg-emerald-100 p-4 text-emerald-600"><Clock3 /></span><div><p className="text-sm text-[#3b4986]">Total Achieved Hours</p><p className="text-3xl font-bold">{hours(totalHours)}</p><p className="text-xs text-[#52619a]">of {hours(plannedHours)} planned assignment hours</p>{missingPlannedHours && <p className="text-xs text-amber-700">Some imported assignments have no planned hours recorded.</p>}{missingReportHours > 0 && <p className="text-xs text-amber-700">{missingReportHours} accepted {missingReportHours === 1 ? 'file has' : 'files have'} no verified report hours</p>}</div></div>
      <div className="flex items-center gap-4 rounded-xl border border-[#dce5f7] bg-white p-4 shadow-sm"><span className="grid size-16 place-items-center rounded-full text-lg font-bold" style={{ background: `radial-gradient(closest-side, white 77%, transparent 79%), conic-gradient(#378bff ${percent}%, #e7edf7 0)` }}>{percent}%</span><div className="min-w-0 flex-1"><p className="text-sm text-[#3b4986]">Work Completion</p><p className="text-sm">{completed} / {throughCurrentMonth.length} completed</p><div className="mt-2 h-2 rounded-full bg-[#e7edf7]"><div className="h-2 rounded-full bg-violet-600" style={{ width: `${percent}%` }} /></div></div></div>
    </div>
    <div className="rounded-2xl border border-[#dce5f7] bg-white p-2 shadow-sm sm:p-3">
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-2"><h2 id="advanced-assessments" tabIndex={-1} className="text-xl font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600">Assignments & Activities by Month</h2><label className="text-sm font-medium">Academic year <select aria-label="Academic year" value={year} onChange={event => { setYear(event.target.value); setOpenMonth(null); }} className="ml-2 rounded-lg border border-[#cdd9ef] bg-white px-3 py-2"><option value="all">All years</option>{years.map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
      {loading && <p role="status" className="p-4">Loading assignments…</p>}
      {!loading && !errors.auditAssignments && visible.length === 0 && <p className="p-4 text-[#52619a]">{assignments.length ? 'No work is scheduled or uploaded through the current month.' : 'No assignments or uploaded activities are recorded for this learner.'}</p>}
      {undated.length > 0 && year === 'all' && <p className="px-4 pb-2 text-xs text-[#52619a]">{undated.length} {undated.length === 1 ? 'record' : 'records'} without a calendar month {undated.length === 1 ? 'is' : 'are'} listed below and excluded from totals.</p>}
      <div className="space-y-2">{groups.map(([month, items], index) => {
        const expanded = openMonth === null ? index === 0 : openMonth === month;
        const monthDone = items.filter(done).length;
        const progress = Math.round(monthDone / items.length * 100);
        const monthHours = items.reduce((sum, item) => sum + (item.actualHours || 0), 0);
        const monthKsbs = new Set(items.flatMap(codes)).size;
        return <div key={month} className="overflow-hidden rounded-lg border border-[#e1e8f5]"><button type="button" aria-expanded={expanded} aria-controls={`audit-month-${month}`} onClick={() => setOpenMonth(expanded ? '' : month)} className="flex w-full flex-wrap items-center justify-between gap-3 bg-[#f1f5fc] px-4 py-3 text-left hover:bg-[#eaf0fb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600">
          <span className="flex items-center gap-3">{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}<strong>{monthName(month)}</strong></span>
          <span className="text-sm text-[#344480]">{items.length} items <span className="mx-2 text-[#a7b6d6]">|</span> {hours(monthHours)} <span className="mx-2 text-[#a7b6d6]">|</span> {monthKsbs} KSBs</span>
          <span className="flex items-center gap-3 text-sm"><span className="h-2 w-20 rounded-full bg-[#e1e8f4]"><span className={`block h-2 rounded-full ${progress === 100 ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${progress}%` }} /></span>{monthDone} / {items.length} completed <strong>{progress}%</strong></span>
        </button>{expanded && <div id={`audit-month-${month}`} className="overflow-x-auto"><table className="w-full min-w-[900px] border-collapse text-left text-sm"><thead className="bg-[#f7f9fd] text-xs text-[#3c4a84]"><tr>{['Assignment / Component', 'Type', 'Upload Date', 'Achieved Hours', 'KSBs', 'Status', 'Mark', 'Actions'].map(value => <th scope="col" key={value} className="px-3 py-3 font-semibold">{value}</th>)}</tr></thead><tbody>{items.map(item => {
          const latest = item.evidence[0]; const mark = latest?.reviews.at(-1) || item.sourceReviews?.at(-1); const verified = codes(item);
          const rowId = item.rowId || String(item.componentId);
          return <Fragment key={rowId}><tr className="border-t border-[#e8edf7] align-top">
            <td className="px-3 py-3 font-semibold">{item.name || `Assignment ${item.componentId}`}{item.evidence.some(evidence => evidence.hasFile) ? <span className="ml-2 inline-block rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">File uploaded</span> : (item.sourceFiles?.length || item.evidence.length) > 0 && <span className="ml-2 inline-block rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">File recorded</span>}{item.plannedHours != null && <span className="block text-xs font-normal text-[#64729c]">{hours(item.plannedHours)} planned</span>}</td>
            <td className="px-3 py-3">{item.type || 'Assignment'}</td><td className="px-3 py-3">{dateLabel(latest?.submittedAt || null)}</td><td className="px-3 py-3 font-semibold">{hours(item.actualHours)}</td>
            <td className="px-3 py-3">{verified.length ? <div className="flex flex-wrap gap-1">{verified.map(code => <span key={code} className="rounded bg-violet-100 px-1.5 py-1 text-xs font-semibold text-violet-700">{code}</span>)}</div> : <span aria-label="No verified KSBs">—</span>}</td>
            <td className="px-3 py-3"><span className={`rounded-lg px-2 py-1 text-xs font-semibold ${done(item) ? 'bg-emerald-50 text-emerald-700' : latest ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>{statusLabel(item.status)}</span></td>
            <td className="px-3 py-3">{mark ? <span className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{statusLabel(mark.decision)}</span> : latest?.feedbacks.length ? <span className="text-xs font-semibold text-[#3b4986]">Original feedback</span> : '—'}</td>
            <td className="px-3 py-3"><div className="flex gap-2">{!readOnly && <button type="button" disabled={!latest && item.sourceMarkId == null} onClick={() => latest ? beginMark(latest, rowId) : beginSourceMark(item, rowId)} className="inline-flex items-center gap-1 rounded-md bg-[#6426ed] px-3 py-1.5 font-semibold text-white hover:bg-[#501acb] disabled:cursor-not-allowed disabled:opacity-40"><Pencil size={14} />Mark</button>}<button type="button" aria-expanded={opened === rowId} onClick={() => { setOpened(opened === rowId ? null : rowId); setMarking(null); setSourceMarking(null); }} className="inline-flex items-center gap-1 rounded-md border border-[#cbd8ef] px-3 py-1.5 font-semibold text-[#4c20d5] hover:bg-violet-50"><Eye size={15} />View</button></div></td>
          </tr>{opened === rowId && <tr><td colSpan={8} className="border-t border-[#e8edf7] bg-[#f8faff] p-4"><div className="space-y-3 rounded-xl bg-white p-4">
            <div><h3 className="font-semibold">{item.name}</h3><p className="text-xs text-[#52619a]">{item.monthSource === 'upload' ? 'Upload month' : item.monthSource === 'audit' ? 'Assignment month' : 'Plan month'}: {monthName(month)} · {item.monthSource === 'upload' ? 'Aptem Additional Job Activity' : item.monthSource === 'audit' ? 'Imported assignment' : 'Aptem assignment'}</p></div>
            <p><strong>Planned hours:</strong> {hours(item.plannedHours)} · <strong>Achieved hours:</strong> {hours(item.actualHours)}</p>
            {reportHoursMessage(item) && <p className="text-xs text-amber-700">{reportHoursMessage(item)}</p>}
            {verified.length > 0 && <p><strong>Verified KSBs:</strong> {verified.join(', ')}</p>}
            {!!item.sourceFiles?.length && <div className="space-y-2" aria-label="Imported assignment files"><h4 className="font-semibold">Assignment files</h4>{item.sourceFiles.map((file, fileIndex) =>
              <div key={`${file.name}-${fileIndex}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e1e8f5] px-3 py-2">
                <span className="break-all">{file.name}</span>{file.url
                  ? <a href={file.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#4c20d5] underline">Open source file</a>
                  : <span className="text-xs text-[#64729c]">Source link unavailable</span>}
              </div>)}</div>}
            {item.sourceReviews?.map((review, reviewIndex) => <p key={reviewIndex} className="whitespace-pre-wrap rounded-lg bg-emerald-50 p-3"><strong>Mark · {statusLabel(review.decision)}:</strong> {review.feedback} · {review.reviewedBy}</p>)}
            {!readOnly && sourceMarking === item.sourceMarkId && item.sourceMarkId != null && <form onSubmit={event => { event.preventDefault(); void saveSource(item.sourceMarkId!); }} className="space-y-3 rounded-lg border border-violet-200 bg-violet-50 p-4"><h4 className="font-semibold">Mark imported assignment</h4><label className="block font-medium">Decision{decisionSelect}</label><label className="block font-medium">Feedback<textarea value={feedback} onChange={event => setFeedback(event.target.value)} maxLength={20000} rows={4} className="mt-1 block w-full rounded-lg border p-2" /></label><div className="flex gap-2"><button type="submit" disabled={saving || !feedback.trim()} className="rounded-lg bg-[#6426ed] px-4 py-2 font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save decision'}</button><button type="button" onClick={() => setSourceMarking(null)} className="rounded-lg border px-4 py-2">Cancel</button></div></form>}
            {!item.evidence.length && !item.sourceFiles?.length && <p className="text-[#52619a]">No linked File evidence is available for this assignment.</p>}
            {item.evidence.map(evidence => <article key={evidence.id} className="space-y-2 rounded-lg border border-[#e1e8f5] p-3"><p className="font-semibold">{evidence.name || 'Uploaded assignment'} <span className="font-normal text-[#52619a]">· {statusLabel(evidence.status)} · {dateLabel(evidence.submittedAt)}</span></p>
              {evidence.note && <p className="whitespace-pre-wrap break-words">{evidence.note}</p>}
              <div className="flex flex-wrap gap-3">{evidence.hasFile && <button type="button" onClick={() => onOpenAssignmentDocument(evidence.id, 'file')} className="font-semibold text-[#4c20d5] underline">View submitted file</button>}{evidence.hasReport && <button type="button" onClick={() => onOpenAssignmentDocument(evidence.id, 'report')} className="font-semibold text-[#4c20d5] underline">View assessment report</button>}</div>
              {!evidence.hasFile && !evidence.hasReport && <p className="text-xs text-[#64729c]">No stored file is available for this record.</p>}
              <HistoricalCoachMarking feedbacks={evidence.feedbacks} status={evidence.status} />
              {evidence.reviews.map((review, reviewIndex) => <p key={reviewIndex} className="whitespace-pre-wrap rounded-lg bg-emerald-50 p-3"><strong>Mark · {statusLabel(review.decision)}:</strong> {review.feedback} · {review.reviewedBy}</p>)}
              {!readOnly && <button type="button" onClick={() => beginMark(evidence, rowId)} className="font-semibold text-[#4c20d5] underline">Mark this upload</button>}
              {marking === evidence.id && <form onSubmit={event => { event.preventDefault(); void save(evidence.id); }} className="space-y-3 rounded-lg border border-violet-200 bg-violet-50 p-4"><h4 className="font-semibold">Mark assignment</h4><label className="block font-medium">Decision{decisionSelect}</label><label className="block font-medium">Feedback<textarea value={feedback} onChange={event => setFeedback(event.target.value)} maxLength={20000} rows={4} className="mt-1 block w-full rounded-lg border p-2" /></label><div className="flex gap-2"><button type="submit" disabled={saving || !feedback.trim()} className="rounded-lg bg-[#6426ed] px-4 py-2 font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save decision'}</button><button type="button" onClick={() => setMarking(null)} className="rounded-lg border px-4 py-2">Cancel</button></div></form>}
            </article>)}
          </div></td></tr>}</Fragment>;
        })}</tbody></table></div>}</div>;
      })}</div>
    </div>
    <p className="rounded-lg border border-[#d4e2ff] bg-[#f4f8ff] px-4 py-3 text-sm text-[#344480]"><strong>About hours and KSBs</strong><br />Assignment hours use matched recorded hours, with missing hours filled from accepted files. Miscellaneous files are grouped by upload month and component name; their achieved hours add the verified Time spent from every accepted file's assessment report. KSB codes count only when verified on accepted files.</p>
    {otherSubmissions.length > 0 && <section className="space-y-3 rounded-xl border border-[#dce5f7] bg-white p-4" aria-label="Other submitted assessments"><h3 className="font-bold">Other submitted assessments</h3>{otherSubmissions.map(item => <article key={item.id} className="rounded-lg border border-[#e1e8f5] p-3"><div className="flex items-center justify-between gap-2"><div><p className="font-semibold">{item.activityTitle || item.activityType}</p><p className="text-xs text-[#52619a]">{item.module} · {dateLabel(item.submittedAt)} · {statusLabel(item.status)}</p></div><div className="flex gap-2">{!readOnly && <button type="button" onClick={() => { setOtherOpen(item.id); setOtherMarking(item.id); setDecision('accepted'); setFeedback(item.coachFeedback || ''); }} className="rounded-md bg-[#6426ed] px-3 py-1.5 text-white">Mark</button>}<button type="button" onClick={() => { setOtherOpen(otherOpen === item.id ? null : item.id); setOtherMarking(null); }} className="rounded-md border border-violet-200 px-3 py-1.5 text-violet-700">View</button></div></div>{otherOpen === item.id && <div className="mt-3 space-y-2 border-t pt-3"><p className="whitespace-pre-wrap">{item.learningReflection || 'No written answer recorded.'}</p>{item.coachFeedback && <p className="whitespace-pre-wrap"><strong>Mark:</strong> {item.coachFeedback}</p>}{!readOnly && otherMarking === item.id && <form onSubmit={event => { event.preventDefault(); void saveOther(item.id); }} className="space-y-2"><label className="block">Decision{decisionSelect}</label><label className="block">Feedback<textarea value={feedback} onChange={event => setFeedback(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label><button type="submit" disabled={saving || !feedback.trim()} className="rounded bg-[#6426ed] px-3 py-2 text-white disabled:opacity-50">Save decision</button></form>}</div>}</article>)}</section>}
  </section>;
}
