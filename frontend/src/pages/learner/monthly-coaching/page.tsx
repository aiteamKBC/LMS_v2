import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { downloadLearnerMcmPdf, fetchLearnerMeetingArtifacts, learnerMeetingArtifactContentUrl, signLearnerProgressReview, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import { useLinkedLearner } from '@/hooks/useMyLearner';
import { useLearnerWorkspaceAccess } from '@/hooks/useLearnerWorkspaceAccess';
import { monthlyCoachingAnswers } from '@/pages/shared/monthlyCoachingForm';
import type { ProgressReviewResponses } from '@/pages/shared/progressReviewForm';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { CoachMeetingArtifactsPanel } from '@/pages/coach/shared/CoachMeetingArtifactsPanel';
import { useReviewSessions } from '@/pages/learner/reviews/useReviewSessions';
import type { ImportedReview } from '@/api/reviewHistory';
import { isoDate } from '@/pages/learner/reviews/bookingDates';
import {
  activityTimeLabel,
  learningKsbCodes,
  learningMinutesForRecord,
  uniqueLearningProgress,
} from '@/lib/reviewLearningProgress';
import { useMeetingAttendance } from '../reviews/useMeetingAttendance';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import AbsenceReportDialog from '../attendance/components/AbsenceReportDialog';
import AbsenceReportForm from '../attendance/components/AbsenceReportForm';
import { useMeetingBooking } from '../reviews/useMeetingBooking';
import { LearnerReviewInstanceForm, useLearnerReviewInstance } from '../reviews/LearnerReviewInstanceForm';

import CoachingHome from './CoachingHome';
import { useCoachingReviewDefinitions } from './useCoachingReviewDefinitions';

const learnerNav = roleNavMap.learner;

function dateOf(session?: LearnerCalendarEvent | null): string | null {
  return session?.scheduledDate || session?.targetDate || session?.date || null;
}
function formatDate(value?: string | null, long = false): string {
  if (!value) return '-';
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', long
    ? { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}
function monthLabel(value?: string | null): string {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

function monthlyCoachingTitle(session?: LearnerCalendarEvent | null): string {
  if (session?.importedReview) {
    return session.importedReview.name || session.title || 'Monthly Coaching Meeting';
  }
  if (session?.reviewTemplateId) return `${session.title} #${session.occurrenceNumber || session.sequence}`;
  const month = monthLabel(dateOf(session));
  return `Monthly Coaching Meeting${month ? ` — ${month}` : ''}${session?.sequence ? ` #${session.sequence}` : ''}`;
}

function shouldShowLearnerMeetingRecording(session?: LearnerCalendarEvent | null): boolean {
  return Boolean(
    session?.eventKey
    && session?.meetingLink
    && ['completed', 'awaiting-signature'].includes(session.status),
  );
}

function formatTime(value?: string | null): string {
  if (!value) return '-';
  const [hour, minute] = value.split(':').map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status?: string): string {
  const labels: Record<string, string> = {
    'not-scheduled': 'Not Scheduled', scheduled: 'Scheduled', 'in-progress': 'In Progress', completed: 'Completed', cancelled: 'Cancelled',
  };
  return status ? labels[status] || status : '-';
}

function initials(name?: string): string {
  return name ? name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() : '-';
}

function inWindow(value: string | undefined | null, from: Date | null, to: Date): boolean {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && (!from || date > from) && date <= to;
}

function hoursLabel(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} ${hours === 1 ? 'hr' : 'hrs'}`;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-background-300 bg-background-100/50 px-5 py-7 text-center"><p className="text-xl font-bold text-foreground-300">-</p><p className="mt-1 text-xs text-foreground-400">{children}</p></div>;
}

function importedValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(importedValue).join(', ');
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

/** Older Aptem exports kept question/answer pairs only in raw_text. */
function rawTextFields(rawText: string): Array<{ label: string; value: string }> {
  const blocks = rawText.split(/\r?\n\s*\r?\n+/)
    .map((block) => block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length);
  return blocks.flatMap((lines) => {
    const first = lines[0];
    const separator = first.indexOf(':');
    if (separator > 0) return [{ label: first.slice(0, separator).trim(), value: [first.slice(separator + 1).trim(), ...lines.slice(1)].filter(Boolean).join('\n') || '-' }];
    return [{ label: first, value: lines.slice(1).join('\n') || '-' }];
  });
}

function importedFieldValue(review: ImportedReview, labels: string[]): unknown {
  const wanted = labels.map((label) => label.toLowerCase());
  for (const section of review.sections) {
    for (const field of section.fields) {
      const label = String(field.label || '').toLowerCase();
      if (wanted.some((value) => label === value || label.includes(value))) return field.value;
    }
  }
  return undefined;
}

function importedDate(value?: unknown): string {
  const text = importedValue(value);
  if (text === '-') return '-';
  const iso = /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
  if (iso) return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB');
  return text;
}

function ImportedSectionBody({ section }: { section: ImportedReview['sections'][number] }) {
  const fields = section.fields.length ? section.fields : rawTextFields(section.rawText);
  const links = section.fields.flatMap((field) => 'links' in field && Array.isArray(field.links) ? field.links : []);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  return <div className="space-y-3">
    {fields.map((field, index) => <div key={`${field.label || 'field'}:${index}`} className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{field.label || 'Response'}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{importedValue(field.value)}</p></div>)}
    {links.length > 0 && <div className="space-y-1">{links.map((link, index) => { const url = link.azure_url || link.url || link.href; const name = link.text || link.title || `Attachment ${index + 1}`; return url ? <button key={index} type="button" onClick={() => setPreview({ url, name })} className="block max-w-full truncate text-left text-xs font-semibold text-primary-600 underline">{name}</button> : null; })}</div>}
    {section.tables.map((table, index) => <div key={index} className="overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="min-w-full text-left text-xs"><tbody className="divide-y divide-slate-200">{(table.rows || []).map((row, rowIndex) => <tr key={rowIndex} className={rowIndex === 0 ? 'bg-slate-100 font-bold text-slate-800' : 'text-slate-700'}>{(Array.isArray(row) ? row : [row]).map((cell, cellIndex) => <td key={cellIndex} className="whitespace-pre-wrap px-3 py-2.5 align-top">{importedValue(cell)}</td>)}</tr>)}</tbody></table></div>)}
    {!fields.length && section.rawText && section.rawText !== 'EMPTY_STRING' && <p className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700">{section.rawText}</p>}
    {preview && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}><div role="dialog" aria-modal="true" aria-label={preview.name} className="flex h-[min(88vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3"><p className="truncate text-sm font-bold text-slate-900">{preview.name}</p><button type="button" aria-label="Close attachment preview" onClick={() => setPreview(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><AppIcon className="ri-close-line" /></button></div><iframe title={preview.name} src={preview.url} className="min-h-0 flex-1 bg-slate-100" /></div></div>}
    {!fields.length && !section.tables.length && (!section.rawText || section.rawText === 'EMPTY_STRING') && <Empty>No response was recorded for this section.</Empty>}
  </div>;
}

function ImportedMcmSections({ review }: { review: ImportedReview }) {
  if (!review.sections.length) return <Empty>No section details were imported for this Aptem review.</Empty>;
  return <div className="space-y-3">
    {review.sections.map((section) => <section key={section.id} className="rounded-xl border border-background-200 bg-background-100/45 p-4">
      <h2 className="text-sm font-bold text-foreground-900">{section.name.replace(/\s+(completed|incomplete)$/i, '').trim()}</h2>
      <div className="mt-3"><ImportedSectionBody section={section} /></div>
    </section>)}
  </div>;
}

function ImportedMcmAccordion({ id, title, open, onToggle, children }: { id: string; title: string; open: boolean; onToggle: (id: string) => void; children: ReactNode }) {
  return <section className="overflow-hidden border border-slate-300 bg-white shadow-[0_1px_4px_rgba(15,39,68,0.12)]">
    <button type="button" onClick={() => onToggle(id)} aria-expanded={open} className="flex w-full items-center gap-3 bg-slate-50 px-4 py-3.5 text-left text-sm font-semibold text-slate-600 transition hover:bg-slate-100">
      <AppIcon className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-lg text-slate-700`} />
      <span className="min-w-0 flex-1">{title}</span>
    </button>
    {open && <div className="border-t border-slate-200 bg-white p-4 sm:p-6">{children}</div>}
  </section>;
}

function ImportedMcmView({ selected, learner, openSections, toggle, onBack }: { selected: LearnerCalendarEvent; learner: ReturnType<typeof useReviewSessions>['learner']; openSections: string[]; toggle: (id: string) => void; onBack: () => void }) {
  const review = selected.importedReview;
  if (!review) return null;
  const programmeStart = learner?.programmeStartDate || importedFieldValue(review, ['programme start date']);
  const practicalEnd = learner?.gatewayStartDate || importedFieldValue(review, ['planned practical period end date']);
  const gatewayDate = learner?.gatewayStartDate || importedFieldValue(review, ['planned gateway date']);
  const apprenticeshipEnd = learner?.epaEndDate || learner?.programmeEndDate || importedFieldValue(review, ['planned apprenticeship end date']);
  const mentor = importedFieldValue(review, ['mentor']) || '-';
  const infoRows: [string, unknown][] = [
    ['Programme Name', learner?.programme || importedFieldValue(review, ['programme name', 'programme'])],
    ['Programme Start Date', programmeStart],
    ['Planned Practical Period End Date', practicalEnd],
    ['Planned Gateway Date', gatewayDate],
    ['Planned Apprenticeship End Date', apprenticeshipEnd],
    ['Programme Status', learner?.programmeStatus || importedFieldValue(review, ['programme status', 'status'])],
    ['Employer', learner?.employer || importedFieldValue(review, ['employer'])],
    ['Manager', learner?.lineManager || importedFieldValue(review, ['manager', 'line manager'])],
    ['Mentor', mentor],
  ];
  const detailSections = review.sections.filter((section) => !section.name.toLowerCase().includes('learner information'));
  const date = selected.scheduledDate || selected.targetDate || selected.date;
  return <div className="space-y-3">
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 pb-3">
      <button type="button" onClick={onBack} aria-label="Back to coaching meetings" className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"><AppIcon className="ri-arrow-left-line" /></button>
      <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">Monthly Coaching Meeting <span className="font-normal text-slate-600">- {importedDate(date)}</span></h1>
      <p className="ml-auto text-xs text-slate-500">Reviewed by: <span className="font-semibold text-slate-600">{review.reviewerName || selected.coachName || '-'}</span></p>
    </header>

    <ImportedMcmAccordion id="learner-information" title="Learner Information" open={openSections.includes('learner-information')} onToggle={toggle}>
      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <div className="flex flex-col items-center justify-center border-b border-slate-200 pb-6 md:border-b-0 md:border-r md:pb-0 md:pr-8"><span className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-400 text-xl font-bold text-white">{initials(learner?.name)}</span><p className="mt-3 text-xl font-bold text-slate-800">{learner?.name || '-'}</p></div>
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-[minmax(210px,1fr)_minmax(260px,2fr)]">{infoRows.map(([label, value]) => <div key={label} className="contents"><p className="text-xs font-semibold text-slate-600">{label}:</p><p className="text-sm text-slate-500">{label.toLowerCase().includes('date') ? importedDate(value) : importedValue(value)}</p></div>)}</div>
      </div>
    </ImportedMcmAccordion>

    {detailSections.length ? detailSections.map((section) => <ImportedMcmAccordion key={section.id} id={`imported-section:${section.id}`} title={section.name} open={openSections.includes(`imported-section:${section.id}`)} onToggle={toggle}><ImportedSectionBody section={section} /></ImportedMcmAccordion>) : <ImportedMcmAccordion id="imported-review" title="Review Details" open={openSections.includes('imported-review')} onToggle={toggle}><ImportedMcmSections review={review} /></ImportedMcmAccordion>}
  </div>;
}

function SavedMcmAnswers({ sectionId, responses, emptyMessage }: { sectionId: string; responses?: ProgressReviewResponses; emptyMessage: string }) {
  const answers = monthlyCoachingAnswers(responses, sectionId);
  if (!answers.length) return <Empty>{emptyMessage}</Empty>;
  return (
    <div className="space-y-3">
      {answers.map((item) => (
        <div key={item.id} className="rounded-xl border border-background-200 bg-background-100/55 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">{item.label}</p>
          {item.type === 'rag' ? (
            <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${item.answer.toLowerCase() === 'green' ? 'bg-emerald-100 text-emerald-700' : item.answer.toLowerCase() === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}><AppIcon className="ri-circle-fill text-[8px]"></AppIcon>{item.answer}</span>
          ) : item.type === 'yes-no' || item.type === 'agreement' ? (
            <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-bold ${item.answer === 'Yes' || item.answer === 'Agree' ? 'bg-emerald-100 text-emerald-700' : item.answer === 'No' || item.answer === 'Disagree' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{item.answer}</span>
          ) : item.type === 'date' ? (
            <p className="mt-2 text-sm font-bold text-primary-700">{formatDate(item.answer, true)}</p>
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground-700">{item.answer}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function Accordion({ id, title, icon, status, open, onToggle, children }: { id: string; title: string; icon: string; status?: 'Complete' | 'Incomplete'; open: boolean; onToggle: (id: string) => void; children: ReactNode }) {
  const steps: Record<string, number> = {
    opening: 1,
    presentation: 2,
    'ksb-reflection': 3,
    'next-month': 4,
    resources: 5,
    wellbeing: 6,
    feedback: 7,
    'confirm-next': 8,
  };
  const step = steps[id];
  const isOverview = id === 'learning' || id === 'previous-summary';
  const isSummary = id === 'meeting-summary';
  const helper = isOverview ? 'Session context' : isSummary ? 'Final record' : step ? `Agenda step ${step} of 8` : 'Session section';
  return (
    <section className={`overflow-hidden rounded-2xl border bg-background-50 transition-all duration-200 ${open ? 'border-primary-200 shadow-[0_10px_30px_rgba(69,26,128,0.08)]' : 'border-foreground-200/70 shadow-[0_3px_12px_rgba(25,12,50,0.035)] hover:border-primary-200 hover:shadow-md'}`}>
      <button type="button" onClick={() => onToggle(id)} aria-expanded={open} className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors sm:px-5 sm:py-4 ${open ? 'bg-gradient-to-r from-primary-50/90 to-secondary-50/30' : 'hover:bg-primary-50/35'}`}>
        <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${open ? 'bg-primary-600 text-white shadow-md shadow-primary-600/20' : isSummary ? 'bg-secondary-50 text-secondary-700' : 'bg-primary-50 text-primary-700'}`}>
          <AppIcon className={`${icon} text-base`} />
          {step && <span className={`absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white px-1 text-[8px] font-extrabold ${open ? 'bg-secondary-500 text-white' : 'bg-primary-700 text-white'}`}>{step}</span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[9px] font-bold uppercase tracking-[0.12em] ${open ? 'text-primary-600' : 'text-foreground-400'}`}>{helper}</span>
          <span className="mt-0.5 block text-sm font-bold text-foreground-900 sm:text-[15px]">{title}</span>
        </span>
        {status && <span className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold sm:inline-flex ${status === 'Complete' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}><span className={`h-1.5 w-1.5 rounded-full ${status === 'Complete' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>{status}</span>}
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${open ? 'rotate-180 bg-primary-100 text-primary-700' : 'bg-background-100 text-foreground-500'}`}><AppIcon className="ri-arrow-down-s-line text-lg" /></span>
      </button>
      {status && <div className="px-4 pb-3 sm:hidden"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${status === 'Complete' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}><span className={`h-1.5 w-1.5 rounded-full ${status === 'Complete' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>{status}</span></div>}
      {open && <div className="border-t border-primary-100 bg-white p-4 sm:p-6">{children}</div>}
    </section>
  );
}

export function MonthlyCoachingListPage() {
  const learner = useLinkedLearner();
  return <MonthlyCoachingList key={`${learner.kind}:${learner.id}`} />;
}

function MonthlyCoachingList() {
  const { myLearner, learner, currentCoach, sessions, setEvents, bookingCalendar, loading, error, refresh } = useReviewSessions('mcr');
  const attendance = useMeetingAttendance(myLearner);
  const reviews = useCoachingReviewDefinitions(myLearner.kind, myLearner.id, sessions);
  const [absence, setAbsence] = useState<MeetingAttendance | null>(null);
  const booking = useMeetingBooking({
    learner: myLearner, rules: bookingCalendar, attendance: attendance.data?.sessions || [],
    titleOf: monthlyCoachingTitle, setEvents, refresh: () => { refresh(); attendance.refresh(); },
  });

  return (
    <WorkspaceShell role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel} pageTitle="Monthly Coaching Meeting" pageSubtitle="Coaching meetings" userName={learner?.name || 'Learner'} userRole={learner?.programme ? `${learner.programme} Learner` : 'Learner'}>
      <main className="page-container min-w-0 w-full space-y-4 p-4 md:p-7">
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}<button type="button" onClick={refresh} className="ml-3 font-bold underline">Try again</button></div>}
        {booking.notice}
        {attendance.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{attendance.error}<button type="button" onClick={attendance.refresh} className="ml-2 underline">Retry attendance</button></p>}
        {attendance.notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{attendance.notice}</p>}
        {reviews.error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{reviews.error}<button type="button" disabled={reviews.loading} onClick={reviews.refresh} className="ml-2 underline">Retry signature details</button></p>}
        {reviews.loading && <p role="status" className="text-sm text-foreground-500">Checking meeting signatures...</p>}
        <CoachingHome sessions={sessions} attendance={attendance.data?.sessions || []} reviews={reviews.definitions} learner={myLearner} currentCoach={currentCoach}
          today={attendance.data?.today || bookingCalendar?.today || isoDate(new Date())} timeZone={attendance.data?.timeZone}
          loading={loading} error={error} canAct={attendance.canAct} busy={Boolean(attendance.busy)}
          onSchedule={booking.openBooking} onAttend={attendance.attend} onReport={setAbsence}/>
        {booking.dialog}
        {absence?.absenceSessionId && absence.date && <AbsenceReportDialog onClose={() => setAbsence(null)}>
          <AbsenceReportForm key={absence.id} scope="meetings" compact showHistory={false}
            preselectMatch={{ id: absence.absenceSessionId, dateIso: absence.date, title: absence.title }}
            onSubmitted={() => attendance.refresh()} onCancel={() => setAbsence(null)} />
        </AbsenceReportDialog>}
      </main>
    </WorkspaceShell>
  );
}

export default function MonthlyCoachingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { sessionId } = useParams<{ sessionId: string }>();
  const { myLearner, learner, sessions, loading, error, refresh } = useReviewSessions('mcr');
  const { canProgress } = useLearnerWorkspaceAccess(myLearner.id);
  // Keep the data-driven Aptem review details visible on first open while
  // preserving the existing learning-summary default for legacy meetings.
  const [openSections, setOpenSections] = useState<string[]>(['learning', 'imported-review']);
  const selected = sessions.find((session) => session.id === sessionId) || null;
  const reviewInstance = useLearnerReviewInstance(
    myLearner.kind,
    myLearner.id,
    selected?.reviewTemplateId || selected?.reviewInstanceId ? (selected.eventKey || selected.id) : '',
  );
  const meetingMonth = dateOf(selected)?.slice(0, 7) || '';
  const completedMcm = Boolean(
    selected && meetingMonth && (selected.source === 'mcr' || selected.reviewTypeCode === 'mcm') &&
    ['completed', 'awaiting-signature'].includes(reviewInstance.definition?.instance?.status || selected.status),
  );
  const backParams = new URLSearchParams({ kind: myLearner.kind, learner: myLearner.id });
  if (searchParams.get('view') === 'all') {
    backParams.set('view', 'all');
    const tab = searchParams.get('tab');
    if (tab && ['needs-action', 'upcoming', 'past'].includes(tab)) backParams.set('tab', tab);
    const page = Number.parseInt(searchParams.get('page') || '1', 10);
    if (Number.isFinite(page) && page > 1) backParams.set('page', String(page));
  }
  const backHref = `/learner/monthly-coaching?${backParams}`;
  const refreshReview = reviewInstance.refresh;
  const signLearnerReview = useCallback((signature: string) => signLearnerProgressReview(
    myLearner.kind,
    myLearner.id,
    selected?.eventKey || selected?.id || '',
    { name: learner?.name || 'Learner', signature },
  ).then(() => { refresh(); refreshReview(); }), [learner?.name, myLearner.id, myLearner.kind, refresh, refreshReview, selected?.eventKey, selected?.id]);
  const index = selected ? sessions.findIndex((session) => session.id === selected.id) : -1;
  const previous = index > 0 ? sessions[index - 1] : null;

  const window = useMemo(() => {
    const previousDate = dateOf(previous);
    const selectedDate = dateOf(selected);
    const from = previousDate ? new Date(`${previousDate}T23:59:59`) : null;
    const plannedEnd = selectedDate ? new Date(`${selectedDate}T23:59:59`) : new Date();
    return { from, to: plannedEnd > new Date() ? new Date() : plannedEnd };
  }, [previous, selected]);

  const progress = useMemo(() => learner ? [
    ...learner.quizAttempts.filter((item) => item.passed),
    ...(learner.videoProgress || []),
    ...(learner.componentProgress || []),
  ].filter((item) => inWindow(item.submittedAt, window.from, window.to)) : [], [learner, window]);

  const uniqueProgress = useMemo(() => uniqueLearningProgress(progress), [progress]);

  const learningItems = useMemo(() => uniqueProgress.map((record) => {
    if ('quizId' in record) {
      const component = learner?.components.find((item) => item.quizMeta?.quizId === record.quizId);
      return { key: `quiz:${record.quizId}:${record.submittedAt}`, title: component?.component || `Quiz #${record.quizId}`, detail: 'Passed quiz', at: record.submittedAt };
    }
    const component = learner?.components.find((item) => item.componentId === record.componentId);
    const type = 'componentType' in record ? record.componentType : 'Video';
    return { key: `component:${record.componentId}:${record.submittedAt}`, title: component?.component || type, detail: `${type} completed · ${activityTimeLabel(learningMinutesForRecord(record, learner?.components || []))}`, at: record.submittedAt };
  }), [learner, uniqueProgress]);
  const ksbCodes = useMemo(
    () => learningKsbCodes(uniqueProgress, learner?.components || []),
    [learner?.components, uniqueProgress],
  );
  const learningMinutes = uniqueProgress.reduce(
    (sum, record) => sum + learningMinutesForRecord(record, learner?.components || []),
    0,
  );
  const toggle = (id: string) => setOpenSections((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  const loadArtifacts = useCallback((eventKey: string, signal?: AbortSignal) => fetchLearnerMeetingArtifacts(myLearner.kind, myLearner.id, eventKey, signal), [myLearner.id, myLearner.kind]);
  const artifactContentUrl = useCallback((eventKey: string, artifactType: string, artifactId: string, options: { preview?: boolean } = {}) => learnerMeetingArtifactContentUrl(myLearner.kind, myLearner.id, eventKey, artifactType, artifactId, options), [myLearner.id, myLearner.kind]);

  return (
    <WorkspaceShell role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel} pageTitle="Monthly Coaching Meeting" pageSubtitle="Coaching meeting" userName={learner?.name || 'Learner'} userRole={learner?.programme ? `${learner.programme} Learner` : 'Learner'}>
      <div className=" page-container min-w-0 w-full space-y-3 p-3 md:space-y-4 md:p-6">
        {completedMcm && meetingMonth && <aside className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-background-200 bg-background-50 p-4" aria-label="Monthly learning log">
          <div><p className="text-sm font-semibold text-foreground-900">Your monthly learning log</p><p className="mt-1 text-sm text-foreground-600">You can also review your learning activities for {monthLabel(`${meetingMonth}-01`)}.</p></div>
          <Link className="rounded-lg border border-background-300 bg-white px-4 py-3 text-sm font-semibold text-primary-700" to={`/learner/monthly-logs/${myLearner.kind}/${myLearner.id}/${meetingMonth}?workflow=mcm&source=mcm`}>Open monthly log</Link>
        </aside>}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AppIcon className="ri-error-warning-line mr-2" />{error}<button type="button" onClick={refresh} className="ml-3 font-bold underline">Try again</button></div>}
        <button type="button" onClick={() => navigate(backHref)} className="inline-flex items-center gap-1.5 text-xs font-bold text-primary-600 hover:text-primary-800"><AppIcon className="ri-arrow-left-line" />Back to coaching meetings</button>
        {loading ? <div className="rounded-xl border border-background-200 bg-white p-5"><RowsSkeleton rows={4} /></div> : !selected ? <div className="rounded-xl border border-background-200 bg-white p-5"><Empty>This monthly coaching session was not found.</Empty></div> : reviewInstance.loading ? <div className="rounded-xl border border-background-200 bg-white p-5"><RowsSkeleton rows={4} /></div> : reviewInstance.error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{reviewInstance.error}<button type="button" onClick={reviewInstance.refresh} className="ml-3 underline">Retry review</button></p> : reviewInstance.definition ? <LearnerReviewInstanceForm definition={reviewInstance.definition} onDownload={() => downloadLearnerMcmPdf(myLearner.kind, myLearner.id, selected.eventKey || selected.id)} signatoryName={learner?.name || 'Learner'} onSign={canProgress ? signLearnerReview : undefined} /> : selected.importedReview ? <ImportedMcmView selected={selected} learner={learner} openSections={openSections} toggle={toggle} onBack={() => navigate(backHref)} /> : (
          <>
            <section className="overflow-hidden rounded-2xl border border-background-200 bg-white shadow-sm">
              <div className="learner-super-admin-hero p-5 text-primary-800 sm:p-6 workspace-page-hero"><span className="rounded-full border border-primary-200/60 bg-primary-100/60 px-2.5 py-1 text-[10px] font-bold text-foreground-500">{statusLabel(selected.status)}</span><div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary-600">30-day coaching meeting</p><h1 className="mt-1 text-xl font-bold text-primary-800">{monthlyCoachingTitle(selected)}</h1><p className="mt-1 text-sm text-foreground-500">{formatDate(dateOf(selected), true)} at {formatTime(selected.scheduledTime)}</p></div>{selected.meetingLink && <a href={selected.meetingLink} target="_blank" rel="noopener noreferrer" className="meeting-join-action rounded-lg px-4 py-2 text-xs font-bold"><AppIcon className="ri-video-chat-line mr-1.5" />Join meeting</a>}</div></div>
              <div className="space-y-5 p-5 sm:p-6">
                {shouldShowLearnerMeetingRecording(selected) ? (
                  <CoachMeetingArtifactsPanel event={{ ...selected, eventKey: selected.eventKey || selected.id }} fetchArtifacts={loadArtifacts} contentUrl={artifactContentUrl} showAttendance={false} visibleArtifactTypes={['recording']} className="border-primary-100 bg-primary-50/30" />
                ) : null}
                <div><p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-foreground-400">Session participants</p><div className="grid gap-3 sm:grid-cols-2"><div className="flex items-center gap-3 rounded-xl border border-background-200 p-3.5"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">{initials(learner?.name)}</span><div><p className="text-[10px] font-semibold uppercase text-foreground-400">Learner</p><p className="text-sm font-bold text-foreground-900">{learner?.name || '-'}</p></div></div><div className="flex items-center gap-3 rounded-xl border border-background-200 p-3.5"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-100 text-xs font-bold text-accent-700">{initials(selected.coachName)}</span><div><p className="text-[10px] font-semibold uppercase text-foreground-400">Coach</p><p className="text-sm font-bold text-foreground-900">{selected.coachName || '-'}</p></div></div></div></div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[['Duration', `${selected.durationMinutes || 60} minutes`], ['Meeting type', selected.meetingProvider || '-'], ['Scheduled time', formatTime(selected.scheduledTime)], ['Learning window', previous ? `Since session #${previous.sequence}` : 'First 30-day period']].map(([label, value]) => <div key={label} className="rounded-xl bg-background-100 p-3.5"><p className="text-[9px] font-semibold uppercase tracking-wider text-foreground-400">{label}</p><p className="mt-1 text-xs font-bold text-foreground-800">{value}</p></div>)}</div>
              </div>
            </section>

            {!selected.importedReview && <Accordion id="learning" title="30-Day Learning Progress & Summary" icon="ri-graduation-cap-line" open={openSections.includes('learning')} onToggle={toggle}>
              <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-primary-50 p-4"><p className="text-[10px] font-semibold uppercase text-primary-500">Completed activities</p><p className="mt-1 text-2xl font-bold text-primary-800">{uniqueProgress.length}</p></div><div className="rounded-xl bg-accent-50 p-4"><p className="text-[10px] font-semibold uppercase text-accent-600">Completed activity time</p><p className="mt-1 text-2xl font-bold text-accent-800">{hoursLabel(learningMinutes)}</p></div><div className="rounded-xl bg-emerald-50 p-4"><p className="text-[10px] font-semibold uppercase text-emerald-600">KSBs evidenced</p><p className="mt-1 text-2xl font-bold text-emerald-800">{ksbCodes.length}</p></div></div>
              <div className="mt-4"><div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-bold text-foreground-800">What the learner completed</h2><span className="text-[10px] text-foreground-400">{learningItems.length} {learningItems.length === 1 ? 'record' : 'records'}</span></div>{learningItems.length === 0 ? <Empty>No completed learning was recorded in this 30-day period.</Empty> : <div className="divide-y divide-background-200 rounded-xl border border-background-200">{learningItems.map((item) => <div key={item.key} className="flex items-start gap-3 p-3.5"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><AppIcon className="ri-checkbox-circle-line" /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-foreground-800">{item.title}</p><p className="text-xs text-foreground-400">{item.detail}</p></div><span className="text-[10px] text-foreground-400">{new Date(item.at).toLocaleDateString('en-GB')}</span></div>)}</div>}</div>
            </Accordion>}
            {selected.importedReview && <Accordion id="imported-review" title="Review Details" icon="ri-file-list-3-line" open={openSections.includes('imported-review')} onToggle={toggle}><ImportedMcmSections review={selected.importedReview} /></Accordion>}
            {!selected.importedReview && <>
            <Accordion id="previous-summary" title="Previous Meeting Summary" icon="ri-history-line" status={monthlyCoachingAnswers(selected.reviewResponses, 'previous-summary').length ? 'Complete' : 'Incomplete'} open={openSections.includes('previous-summary')} onToggle={toggle}>
              <SavedMcmAnswers sectionId="previous-summary" responses={selected.reviewResponses} emptyMessage="No previous meeting summary has been recorded." />
            </Accordion>
            <Accordion id="opening" title="Opening the Meeting (5 minutes)" icon="ri-play-circle-line" status={monthlyCoachingAnswers(selected.reviewResponses, 'opening').length ? 'Complete' : 'Incomplete'} open={openSections.includes('opening')} onToggle={toggle}>
              <SavedMcmAnswers sectionId="opening" responses={selected.reviewResponses} emptyMessage="The opening check-in has not been recorded." />
            </Accordion>
            <Accordion id="presentation" title="Learner Presentation & Review (15 minutes)" icon="ri-presentation-line" status={monthlyCoachingAnswers(selected.reviewResponses, 'presentation').length ? 'Complete' : 'Incomplete'} open={openSections.includes('presentation')} onToggle={toggle}>
              <SavedMcmAnswers sectionId="presentation" responses={selected.reviewResponses} emptyMessage="No learner presentation information has been recorded for this session." />
            </Accordion>
            <Accordion id="ksb-reflection" title="Reflection on Knowledge, Skills, and Behaviours (10 minutes)" icon="ri-lightbulb-line" status={monthlyCoachingAnswers(selected.reviewResponses, 'ksb-reflection').length ? 'Complete' : 'Incomplete'} open={openSections.includes('ksb-reflection')} onToggle={toggle}>
              <SavedMcmAnswers sectionId="ksb-reflection" responses={selected.reviewResponses} emptyMessage="No KSB reflection has been recorded for this session." />
            </Accordion>
            <Accordion id="next-month" title="Preparing for Next Month (10 minutes)" icon="ri-calendar-todo-line" status={monthlyCoachingAnswers(selected.reviewResponses, 'next-month').length ? 'Complete' : 'Incomplete'} open={openSections.includes('next-month')} onToggle={toggle}><SavedMcmAnswers sectionId="next-month" responses={selected.reviewResponses} emptyMessage="No targets or actions for next month have been recorded." /></Accordion>
            <Accordion id="resources" title="Learning Resources – Coach Guidance (5 minutes)" icon="ri-book-open-line" status={monthlyCoachingAnswers(selected.reviewResponses, 'resources').length ? 'Complete' : 'Incomplete'} open={openSections.includes('resources')} onToggle={toggle}><SavedMcmAnswers sectionId="resources" responses={selected.reviewResponses} emptyMessage="No coach learning resources or guidance have been recorded." /></Accordion>
            <Accordion id="wellbeing" title="Wellbeing & Safeguarding Check (5 minutes)" icon="ri-shield-check-line" status={monthlyCoachingAnswers(selected.reviewResponses, 'wellbeing').length ? 'Complete' : 'Incomplete'} open={openSections.includes('wellbeing')} onToggle={toggle}><SavedMcmAnswers sectionId="wellbeing" responses={selected.reviewResponses} emptyMessage="No wellbeing or safeguarding response has been recorded." /></Accordion>
            <Accordion id="feedback" title="Learner Feedback on Teaching & Curriculum (5 minutes)" icon="ri-feedback-line" status={monthlyCoachingAnswers(selected.reviewResponses, 'feedback').length ? 'Complete' : 'Incomplete'} open={openSections.includes('feedback')} onToggle={toggle}><SavedMcmAnswers sectionId="feedback" responses={selected.reviewResponses} emptyMessage="No learner feedback has been recorded." /></Accordion>
            <Accordion id="confirm-next" title="Confirm Next Meeting & Close (5 minutes)" icon="ri-calendar-check-line" status={monthlyCoachingAnswers(selected.reviewResponses, 'confirm-next').length ? 'Complete' : 'Incomplete'} open={openSections.includes('confirm-next')} onToggle={toggle}>
              <SavedMcmAnswers sectionId="confirm-next" responses={selected.reviewResponses} emptyMessage="The next meeting confirmation has not been recorded." />
            </Accordion>
            <Accordion id="meeting-summary" title="Meeting Summary" icon="ri-file-text-line" status={monthlyCoachingAnswers(selected.reviewResponses, 'meeting-summary').length ? 'Complete' : 'Incomplete'} open={openSections.includes('meeting-summary')} onToggle={toggle}><SavedMcmAnswers sectionId="meeting-summary" responses={selected.reviewResponses} emptyMessage="No meeting summary has been recorded." /></Accordion>
            </>}
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}

