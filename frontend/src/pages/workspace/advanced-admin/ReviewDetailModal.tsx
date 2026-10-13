import { useEffect, useRef, useState } from 'react';
import { Bot, CalendarDays, ClipboardList, FileDown, FileText, LayoutGrid, ShieldCheck, UserRound, Users, X } from 'lucide-react';
import {
  advancedAdminCoachingSessionDetail, advancedAdminOriginalReviewPdf,
  type AdvancedAdminCoachingSession, type AdvancedAdminCoachingSessionDetail,
  type AdvancedAdminLearner, type AdvancedAdminReview,
} from '@/api/advancedAdmin';
import StructuredRecord from './StructuredRecord';
import { AiReportPanel, AttendancePanel, TranscriptPanel } from './ReviewMeetingPanels';

type Tab = 'summary' | 'transcript' | 'ai' | 'attendance';
const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'summary', label: 'Summary', icon: <ClipboardList size={15} /> },
  { id: 'transcript', label: 'Transcript', icon: <FileText size={15} /> },
  { id: 'ai', label: 'AI Report', icon: <Bot size={15} /> },
  { id: 'attendance', label: 'Attendance', icon: <Users size={15} /> },
];

function dateTime(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium', ...(value.length > 10 ? { timeStyle: 'short' as const } : {}),
    timeZone: value.length > 10 ? 'Europe/London' : 'UTC',
  }).format(date);
}

function Card({ title, icon, tone, children }: { title: string; icon: React.ReactNode; tone: 'navy' | 'blue' | 'gold' | 'teal'; children: React.ReactNode }) {
  const border = { navy: 'border-t-primary-950', blue: 'border-t-sky-600', gold: 'border-t-amber-500', teal: 'border-t-teal-500' }[tone];
  const iconColor = { navy: 'bg-amber-50 text-primary-950', blue: 'bg-sky-50 text-primary-700', gold: 'bg-amber-50 text-amber-700', teal: 'bg-teal-50 text-teal-600' }[tone];
  return <section className={`overflow-hidden rounded-2xl border border-t-4 border-foreground-200 bg-white shadow-sm ${border}`}>
    <h4 className="flex items-center gap-3 border-b border-foreground-100 px-4 py-3 font-bold text-primary-950"><span className={`flex size-9 items-center justify-center rounded-lg ${iconColor}`}>{icon}</span>{title}</h4>
    <dl className="divide-y divide-primary-100 px-4">{children}</dl>
  </section>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="grid gap-1 py-3 text-sm sm:grid-cols-[9rem_1fr]">
    <dt className="text-[11px] font-bold uppercase tracking-wide text-foreground-500">{label}</dt>
    <dd className="min-w-0 break-words font-medium text-foreground-900">{value ?? 'Not recorded'}</dd>
  </div>;
}

function Status({ value, positive, purple }: { value: string; positive?: boolean; purple?: boolean }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${purple ? 'border-primary-200 bg-primary-50 text-primary-700' : positive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>{value}</span>;
}

export default function ReviewDetailModal({ learnerId, learner, review, family, session, coachingError, meetingListLoading, pdfStatus, onClose }: {
  learnerId: number;
  learner?: AdvancedAdminLearner;
  review: AdvancedAdminReview;
  family: 'pr' | 'mcm';
  session?: AdvancedAdminCoachingSession;
  coachingError?: string;
  meetingListLoading?: boolean;
  pdfStatus?: 'loading' | 'ready' | 'error';
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('summary');
  const [detail, setDetail] = useState<AdvancedAdminCoachingSessionDetail | null>(null);
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button, a[href], summary');
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, [onClose]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    advancedAdminCoachingSessionDetail(learnerId, session.id, controller.signal)
      .then(setDetail)
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Meeting details are unavailable.'); });
    return () => controller.abort();
  }, [learnerId, session]);

  const report = detail?.report || session?.report || review.aiCoachingReport;
  const meetingUnavailable = !session
    ? meetingListLoading ? 'Checking for a linked coaching meeting…'
      : coachingError ? 'Coaching meetings could not be loaded, so evidence availability cannot be checked.'
        : 'No coaching meeting could be uniquely matched to this review.'
    : error ? `Meeting details could not be loaded: ${error}`
      : !detail ? 'Loading meeting details…' : '';
  const hasTranscript = Boolean(detail?.transcript?.content?.trim());
  const transcriptUnavailable = meetingUnavailable || (!detail?.meetingId
    ? 'This session has no linked meeting ID, so a transcript cannot be shown.'
    : detail.status === 'waiting_for_transcript' || ['pending', 'processing'].includes(detail.transcript?.status?.toLowerCase() || '')
      ? 'The transcript for this meeting is still being processed. Check again later.'
      : detail.transcript
        ? 'A transcript record exists for this meeting, but it contains no text.'
        : 'No transcript text is stored for this meeting. A completed review or PDF does not confirm that a transcript was captured.');
  const reportUnavailable = meetingUnavailable || (!detail?.meetingId
    ? 'No AI report is stored for this review; no meeting is linked to this session.'
    : 'No AI report is stored for this meeting.');
  const attendanceUnavailable = meetingUnavailable || 'No attendance report is stored for this meeting.';
  const sessionStage = detail?.status || session?.status;
  const pdfAvailable = Boolean(review.aptemReviewId && (family === 'mcm' || pdfStatus === 'ready'));
  const learnerName = review.learnerName || detail?.learnerName || learner?.name || 'Learner';
  const attendance = detail?.attendance;
  const learnerAttended = Boolean(attendance?.learner || detail?.learnerAttended === true);
  const managerAttended = Boolean(attendance?.manager || detail?.managerAttended === true);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="review-dialog-title"
      className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-foreground-200 p-5 sm:p-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-primary-950"><FileText size={20} /></span>
          <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="review-dialog-title" className="text-xl font-extrabold text-primary-950">{learnerName}</h3>
            <span className="rounded-full bg-primary-50 px-2 py-1 text-xs font-semibold text-primary-700">{family === 'pr' ? 'Progress Review' : 'MCM'}</span>
            <Status value={review.status.replaceAll('-', ' ')} positive={review.status === 'completed'} />
          </div>
          <p className="mt-1 text-sm text-foreground-600">{review.name}{(detail?.coachName || review.coachName) && ` · Coach: ${detail?.coachName || review.coachName}`}</p>
          <p className="mt-1 text-xs text-foreground-500">{detail?.programme || review.programme || learner?.programme || review.type} · Planned: {dateTime(session?.plannedDate || review.plannedDate)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">{pdfAvailable ? <a href={advancedAdminOriginalReviewPdf(learnerId, review.aptemReviewId)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-700 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"><FileDown size={16} />Download PDF</a>
          : <span className="text-xs text-foreground-500">{pdfStatus === 'loading' && review.aptemReviewId ? 'Checking Aptem PDF…' : 'Aptem PDF unavailable'}</span>}
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close review"
          className="rounded-lg border border-foreground-200 p-2 text-foreground-600 hover:bg-foreground-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"><X size={20} /></button>
        </div>
      </header>
      <div className="overflow-y-auto bg-slate-50 p-4 sm:p-6">
        <div role="tablist" aria-label="Review details" className="mb-5 inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-foreground-200 bg-white p-1">
          {tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id}
            onClick={() => setTab(item.id)} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 ${tab === item.id ? 'bg-primary-700 text-white' : 'text-foreground-600 hover:bg-primary-50'}`}>{item.icon}{item.label}</button>)}
        </div>
        <div role="tabpanel" className="space-y-4">
          {tab === 'summary' && <>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Learner & Contacts" tone="navy" icon={<UserRound size={18} />}>
                <Field label="Learner name" value={learnerName} />
                <Field label="Learner email" value={review.learnerEmail || detail?.learnerEmail || learner?.email} />
                {learner?.programmeStatus && <Field label="Programme status" value={<Status value={learner.programmeStatus} positive={learner.programmeStatus.toLowerCase() === 'active'} />} />}
                <Field label="Coach" value={detail?.coachName || review.coachName || learner?.coach} />
                <Field label="Manager name" value={detail?.managerName || review.managerName} />
                <Field label="Manager email" value={detail?.managerEmail} />
              </Card>
              <Card title="Programme & Session" tone="blue" icon={<LayoutGrid size={18} />}>
                <Field label="Programme" value={detail?.programme || review.programme || learner?.programme} />
                <Field label="Component" value={review.name} />
                <Field label="Session type" value={<Status value={family === 'pr' ? 'Progress Review' : 'MCM'} purple />} />
                <Field label="Session stage" value={<Status value={sessionStage === 'matching_failed' ? 'No meeting matched' : sessionStage || 'Not linked'} positive={sessionStage === 'completed'} />} />
                <Field label="Aptem status" value={<Status value={review.status.replaceAll('-', ' ')} positive={review.status === 'completed'} />} />
              </Card>
              <Card title="Dates & Timing" tone="gold" icon={<CalendarDays size={18} />}>
                <Field label="Planned date" value={session ? dateTime(detail?.plannedDate || session.plannedDate) : 'Not linked'} />
                <Field label="Completion date" value={dateTime(review.completedDate)} />
                <Field label="Meeting start" value={dateTime(detail?.actualStartAt || session?.actualStartAt)} />
                <Field label="Meeting end" value={dateTime(detail?.actualEndAt)} />
                <Field label="Meeting ID" value={detail?.meetingId} />
              </Card>
              <Card title="Attendance & Evidence" tone="teal" icon={<ShieldCheck size={18} />}>
                <Field label="Learner attendance" value={<Status value={learnerAttended ? 'Attended' : 'Not confirmed'} positive={learnerAttended} />} />
                <Field label="Manager attendance" value={<Status value={managerAttended ? 'Attended' : 'Not confirmed'} positive={managerAttended} />} />
                <Field label="Transcript" value={<><Status value={hasTranscript ? 'Available' : !detail && session && !error ? 'Checking' : 'Not available'} positive={hasTranscript} />{!hasTranscript && <p className="mt-1 text-xs font-normal text-foreground-500">{transcriptUnavailable}</p>}</>} />
                <Field label="AI report" value={<><Status value={report ? 'Ready' : 'Not available'} positive={Boolean(report)} />{!report && <p className="mt-1 text-xs font-normal text-foreground-500">{reportUnavailable}</p>}</>} />
              </Card>
            </div>
            {session && !detail && !error && <p role="status" className="rounded-xl border border-primary-100 bg-white p-3 text-sm text-foreground-600">Loading meeting details…</p>}
            {review.sections?.length > 0 && <details className="rounded-xl border border-foreground-200 bg-white p-4">
              <summary className="cursor-pointer font-semibold text-primary-950">Aptem review details</summary>
              <div className="mt-3 space-y-3">{review.sections.map(section => <section key={section.id} className="rounded-lg border p-3">
                <h5 className="font-semibold">{section.name}</h5><StructuredRecord value={section.fields} />
              </section>)}</div>
            </details>}
            {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Meeting details: {error}</p>}
          </>}
          {tab === 'transcript' && <TranscriptPanel detail={detail} fallback={transcriptUnavailable} />}
          {tab === 'ai' && <AiReportPanel report={report} review={review} detail={detail} fallback={reportUnavailable} />}
          {tab === 'attendance' && <AttendancePanel detail={detail} fallback={attendanceUnavailable} transcriptUnavailable={transcriptUnavailable} />}
        </div>
      </div>
    </div>
  </div>;
}
