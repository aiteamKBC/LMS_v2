import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { fetchLearnerMeetingArtifacts, learnerMeetingArtifactContentUrl, signLearnerProgressReview, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import { fetchEvidence } from '@/api/evidence';
import { useLinkedLearner } from '@/hooks/useMyLearner';
import { responsesForSection, type ProgressReviewResponses } from '@/pages/shared/progressReviewForm';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { useReviewSessions } from '@/pages/learner/reviews/useReviewSessions';
import { isoDate } from '@/pages/learner/reviews/bookingDates';
import { MetricCard } from '@/components/ui/MetricCard';
import { CoachMeetingArtifactsPanel } from '@/pages/coach/shared/CoachMeetingArtifactsPanel';
import ProgressReviewSlidesModal, { type ProgressReviewSlidesDeck } from '@/pages/coach/progress-reviews/components/ProgressReviewSlidesModal';
import { buildProgressReviewSlidesDeck } from '@/pages/coach/progress-reviews/page';
import type { CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import ProgressReviewSignModal from './components/ProgressReviewSignModal';
import styles from './progressReviews.module.css';
import FeaturedMeeting from '../reviews/FeaturedMeeting';
import MeetingAttendanceActions from '../reviews/MeetingAttendanceActions';
import { useMeetingAttendance } from '../reviews/useMeetingAttendance';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import AbsenceReportDialog from '../attendance/components/AbsenceReportDialog';
import AbsenceReportForm from '../attendance/components/AbsenceReportForm';
import { meetingCalendarHref } from '../reviews/meetingBooking';
import { useMeetingBooking } from '../reviews/useMeetingBooking';
import MeetingSchedulingAction from '../reviews/MeetingSchedulingAction';
import { LearnerReviewInstanceForm, useLearnerReviewInstance } from '../reviews/LearnerReviewInstanceForm';

const learnerNav = roleNavMap.learner;

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

function formatTime(value?: string | null): string {
  if (!value) return '-';
  const [hour, minute] = value.split(':').map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit',
  });
}

function reviewDate(review?: LearnerCalendarEvent | null): string | null {
  return review?.scheduledDate || review?.targetDate || review?.date || null;
}

function progressReviewTitle(review?: LearnerCalendarEvent | null): string {
  if (review?.importedReview) return review.importedReview.name || review.title || 'Review';
  if (review?.reviewTemplateId) return `${review.title} #${review.occurrenceNumber || review.sequence}`;
  const month = monthLabel(reviewDate(review));
  return `Progress Review${month ? ` — ${month}` : ''}${review?.sequence ? ` #${review.sequence}` : ''}`;
}

function reviewTypeLabel(review?: LearnerCalendarEvent | null): string {
  return review?.reviewTypeName || review?.importedReview?.type || 'Formal progress review';
}

function importedValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value === 'EMPTY_STRING' ? '-' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return JSON.stringify(value); } catch { return String(value); }
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

function importedSectionName(name: string): string {
  return name.trim().replace(/\s+(completed|incomplete)$/i, '').trim().toLowerCase();
}

function ImportedAttachmentLinks({ section }: { section: NonNullable<LearnerCalendarEvent['importedReview']>['sections'][number] }) {
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const links = section.fields.flatMap((field) => 'links' in field && Array.isArray(field.links) ? field.links : []);
  if (!links.length) return null;
  return <><div className="mt-2 space-y-1">{links.map((link, index) => {
    const url = link.azure_url || link.url || link.href;
    const name = link.text || link.title || `Attachment ${index + 1}`;
    return url ? <button key={index} type="button" onClick={() => setPreview({ url, name })} className="block max-w-full truncate text-left text-xs font-semibold text-primary-600 underline hover:text-primary-800">{name}</button> : null;
  })}</div>{preview && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}><div role="dialog" aria-modal="true" aria-label={preview.name} className="flex h-[min(88vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between gap-3 border-b border-background-200 px-4 py-3"><p className="truncate text-sm font-bold text-foreground-900">{preview.name}</p><button type="button" aria-label="Close attachment preview" onClick={() => setPreview(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-500 hover:bg-background-100"><AppIcon className="ri-close-line" /></button></div><iframe title={preview.name} src={preview.url} className="min-h-0 flex-1 bg-background-100" /></div></div>}</>;
}

function ImportedReviewsSchedule({ section }: { section: NonNullable<LearnerCalendarEvent['importedReview']>['sections'][number] }) {
  const tableRows = section.tables.flatMap((table) => table.rows || []);
  if (tableRows.length > 1) return <div className="overflow-x-auto rounded-xl border border-background-200 bg-white"><table className="min-w-full text-left text-xs"><thead className="bg-background-100 text-[10px] uppercase tracking-wide text-foreground-500"><tr>{(tableRows[0] || []).map((cell, index) => <th key={index} className="px-4 py-3">{importedValue(cell)}</th>)}</tr></thead><tbody className="divide-y divide-background-200">{tableRows.slice(1).map((row, index) => <tr key={index}>{(Array.isArray(row) ? row : [row]).map((cell, cellIndex) => <td key={cellIndex} className="whitespace-pre-wrap px-4 py-3">{importedValue(cell)}</td>)}</tr>)}</tbody></table></div>;
  const dates = [...(section.rawText || '').matchAll(/\b\d{2}\/\d{2}\/\d{4}\b/g)].map((match) => match[0]);
  const rows = Array.from({ length: Math.ceil(dates.length / 2) }, (_, index) => [dates[index * 2] || '-', dates[index * 2 + 1] || '-']);
  if (!rows.length) return null;
  return <div className="overflow-x-auto rounded-xl border border-background-200 bg-white"><table className="min-w-full text-left text-xs"><thead className="bg-background-100 text-[10px] uppercase tracking-wide text-foreground-500"><tr><th className="px-4 py-3">Review Name / Review Type</th><th className="px-4 py-3">Planned Date</th><th className="px-4 py-3">Actual Date</th></tr></thead><tbody className="divide-y divide-background-200">{rows.map(([planned, actual], index) => <tr key={index}><td className="px-4 py-3"><p className="font-bold text-foreground-900">Progress Review</p><p className="text-foreground-500">Progress Review</p></td><td className="px-4 py-3">{planned}</td><td className="px-4 py-3">{actual}</td></tr>)}</tbody></table></div>;
}

function ImportedFunctionalSkills({ section }: { section: NonNullable<LearnerCalendarEvent['importedReview']>['sections'][number] }) {
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const text = section.rawText || '';
  const beforeResults = text.split(/\bResults\b/i)[0];
  const resultsText = text.split(/\bResults\b/i)[1] || '';
  const assessments = [...beforeResults.matchAll(/\b(English|Maths)\s*\n+\s*Assessment Date:\s*([^\n]+)\s*\n+\s*(Level\s*\d+)/gi)].map((match) => ({ subject: match[1], date: match[2], level: match[3] }));
  const exemptions = [...(text.match(/\bExemptions\b([\s\S]*?)(?=\bResults\b|$)/i)?.[1] || '').matchAll(/\b(English|Maths|ICT)\s*\n+\s*(Opt Out|Not Exempt)(?:\s*\n+\s*([^\n]+\.pdf))?/gi)].map((match) => ({ subject: match[1], status: match[2], attachment: match[3] }));
  const results = [...resultsText.matchAll(/\b(English Reading|English Writing|English SLC|Maths|ICT)\s*\n+\s*Assessment Date:\s*\n+\s*([^\n]+)/gi)].map((match) => ({ subject: match[1], score: match[2] }));
  if (!assessments.length && !exemptions.length && !results.length) return null;
  const links = section.fields.flatMap((field) => 'links' in field && Array.isArray(field.links) ? field.links : []);
  const attachment = links[0];
  const attachmentUrl = attachment?.azure_url || attachment?.url || attachment?.href;
  return <div className="space-y-4">
    {assessments.length > 0 && <div><h4 className="mb-2 text-sm font-bold text-foreground-900">Initial Assessments</h4><div className="grid gap-3 sm:grid-cols-2">{assessments.map((item) => <div key={`${item.subject}:${item.date}`} className="rounded-lg border border-background-200 bg-white p-3"><p className="text-sm font-bold text-foreground-900">{item.subject}</p><p className="mt-1 text-xs text-foreground-500">Assessment Date: {item.date}</p><span className="mt-2 inline-flex rounded bg-primary-50 px-2 py-1 text-xs font-bold text-primary-700">{item.level}</span></div>)}</div></div>}
    {exemptions.length > 0 && <div><h4 className="mb-2 text-sm font-bold text-foreground-900">Exemptions</h4><div className="grid gap-3 sm:grid-cols-3">{exemptions.map((item) => <div key={item.subject} className="rounded-lg border border-background-200 bg-white p-3"><div className="flex items-start justify-between gap-2"><p className="text-sm font-bold text-foreground-900">{item.subject}</p><span className="rounded bg-background-200 px-2 py-1 text-[10px] font-bold text-foreground-600">{item.status}</span></div>{item.attachment && attachmentUrl && <button type="button" onClick={() => setPreview({ url: attachmentUrl, name: item.attachment || 'Attachment' })} className="mt-3 block max-w-full truncate text-left text-xs font-semibold text-primary-600 underline">{item.attachment}</button>}</div>)}</div></div>}
    {results.length > 0 && <div><h4 className="mb-2 text-sm font-bold text-foreground-900">Results</h4><div className="grid gap-3 sm:grid-cols-3">{results.map((item) => <div key={`${item.subject}:${item.score}`} className="rounded-lg border border-background-200 bg-white p-3"><p className="text-sm font-bold text-foreground-900">{item.subject}</p><p className="mt-1 text-xs text-foreground-500">Assessment Date:</p><span className="mt-2 inline-flex h-8 w-8 items-center justify-center rounded-full border-4 border-background-200 text-[10px] font-bold text-foreground-700">{item.score}</span></div>)}</div></div>}
    {preview && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}><div role="dialog" aria-modal="true" aria-label={preview.name} className="flex h-[min(88vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between gap-3 border-b border-background-200 px-4 py-3"><p className="truncate text-sm font-bold text-foreground-900">{preview.name}</p><button type="button" aria-label="Close attachment preview" onClick={() => setPreview(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-500 hover:bg-background-100"><AppIcon className="ri-close-line" /></button></div><iframe title={preview.name} src={preview.url} className="min-h-0 flex-1 bg-background-100" /></div></div>}
  </div>;
}

function ImportedReviewSections({ review }: { review: NonNullable<LearnerCalendarEvent['importedReview']> }) {
  if (!review.sections.length) return <Empty>No section details were imported for this review.</Empty>;
  return <div className="space-y-3">
    {review.sections.map((section) => <section key={section.id} className="rounded-xl border border-background-200 bg-background-100/45 p-4">
      <h3 className="text-sm font-bold text-foreground-900">{section.name.replace(/\s+(completed|incomplete)$/i, '').trim()}</h3>
      <div className="mt-3 space-y-3">
        {importedSectionName(section.name) === 'reviews schedule' && <ImportedReviewsSchedule section={section} />}
        {importedSectionName(section.name) === 'functional skills' && <ImportedFunctionalSkills section={section} />}
        {importedSectionName(section.name) !== 'reviews schedule' && <>
        {(section.fields.length ? section.fields : rawTextFields(section.rawText)).map((field, index) => <div key={`${field.label || 'field'}:${index}`} className="rounded-lg border border-background-200 bg-white p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">{field.label || 'Response'}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-foreground-700">{importedValue(field.value)}</p></div>)}
        <ImportedAttachmentLinks section={section} />
        {section.tables.map((table, index) => <div key={index} className="overflow-x-auto rounded-lg border border-background-200 bg-white"><table className="min-w-full text-left text-xs"><tbody className="divide-y divide-background-200">{(table.rows || []).map((row, rowIndex) => <tr key={rowIndex} className={rowIndex === 0 ? 'bg-background-100 font-bold text-foreground-800' : 'text-foreground-700'}>{(Array.isArray(row) ? row : [row]).map((cell, cellIndex) => <td key={cellIndex} className="whitespace-pre-wrap px-3 py-2.5 align-top">{importedValue(cell)}</td>)}</tr>)}</tbody></table></div>)}
        {!section.fields.length && !rawTextFields(section.rawText).length && section.rawText && section.rawText !== 'EMPTY_STRING' && <p className="whitespace-pre-wrap rounded-lg border border-background-200 bg-white p-3 text-sm leading-6 text-foreground-700">{section.rawText}</p>}
        </>}
      </div>
    </section>)}
  </div>;
}

function shouldShowLearnerMeetingPanel(review?: LearnerCalendarEvent | null): boolean {
  return Boolean(
    review?.eventKey
    && review?.meetingLink
  );
}

function statusLabel(status?: string): string {
  const labels: Record<string, string> = {
    'not-scheduled': 'Not Scheduled',
    scheduled: 'Scheduled',
    'in-progress': 'In progress',
    'awaiting-signature': 'Awaiting signatures',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  return status ? labels[status] || status : '-';
}

function statusStyle(status?: string): string {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'scheduled') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (status === 'in-progress') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'awaiting-signature') return 'border-violet-200 bg-violet-50 text-violet-700';
  if (status === 'cancelled') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'not-scheduled') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-background-200 bg-background-100 text-foreground-700';
}

function initials(value?: string | null): string {
  if (!value) return '-';
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function asNumber(value?: string | number | null): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function Empty({ children = 'No information has been recorded for this review.' }: { children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-background-300 bg-background-100/50 px-5 py-7 text-center">
      <p className="text-xl font-bold text-foreground-300">-</p>
      <p className="mt-1 text-xs text-foreground-400">{children}</p>
    </div>
  );
}

function SavedReviewAnswers({
  sectionId,
  responses,
  emptyMessage,
}: {
  sectionId: string;
  responses?: ProgressReviewResponses;
  emptyMessage: string;
}) {
  const answers = responsesForSection(responses, sectionId);
  if (!answers.length) return <Empty>{emptyMessage}</Empty>;
  return (
    <div className="space-y-3">
      {answers.map((item) => (
        <div key={item.id} className="rounded-xl border border-background-200 bg-background-100/55 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">{item.label}</p>
          {item.type === 'rating' ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-lg font-bold text-primary-700">{item.answer}/5</span>
              <div className="flex gap-1">{[1, 2, 3, 4, 5].map((rating) => <AppIcon key={rating} className={`${rating <= Number(item.answer) ? 'ri-star-fill text-amber-400' : 'ri-star-line text-foreground-300'}`}></AppIcon>)}</div>
            </div>
          ) : item.type === 'rag' ? (
            <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${item.answer.toLowerCase() === 'green' ? 'bg-emerald-100 text-emerald-700' : item.answer.toLowerCase() === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
              <AppIcon className="ri-circle-fill text-[8px]"></AppIcon>{item.answer}
            </span>
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground-700">{item.answer}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function PersonCard({ role, name, icon, tone }: { role: string; name?: string; icon: string; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-background-200 bg-background-50 p-3.5">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${tone}`}>
        {name ? initials(name) : <AppIcon className={icon} />}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">{role}</p>
        <p className="truncate text-sm font-bold text-foreground-900">{name || '-'}</p>
      </div>
    </div>
  );
}

function Accordion({
  id, title, icon, open, onToggle, children,
}: {
  id: string; title: string; icon: string; open: boolean; onToggle: (id: string) => void; children: ReactNode;
}) {
  const steps: Record<string, number> = {
    'progress-checks': 1,
    'learner-reflection': 2,
    'manager-reflection': 3,
    'tutor-reflection': 4,
    safeguarding: 5,
    'additional-support': 6,
    actions: 7,
    rag: 8,
  };
  const step = steps[id];
  return (
    <section className={`overflow-hidden rounded-2xl border bg-background-50 transition-all duration-200 ${open ? 'border-primary-200 shadow-[0_10px_30px_rgba(69,26,128,0.08)]' : 'border-foreground-200/70 shadow-[0_3px_12px_rgba(25,12,50,0.035)] hover:border-primary-200 hover:shadow-md'}`}>
      <button type="button" onClick={() => onToggle(id)} aria-expanded={open} className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors sm:px-5 sm:py-4 ${open ? 'bg-gradient-to-r from-primary-50/90 to-secondary-50/30' : 'hover:bg-primary-50/35'}`}>
        <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${open ? 'bg-primary-600 text-white shadow-md shadow-primary-600/20' : id === 'rag' ? 'bg-amber-50 text-amber-700' : 'bg-primary-50 text-primary-700'}`}>
          <AppIcon className={`${icon} text-base`} />
          <span className={`absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white px-1 text-[8px] font-extrabold ${open ? 'bg-secondary-500' : 'bg-primary-700'} text-white`}>{step}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[9px] font-bold uppercase tracking-[0.12em] ${open ? 'text-primary-600' : 'text-foreground-400'}`}>Review section {step} of 8</span>
          <span className="mt-0.5 block text-sm font-bold text-foreground-900 sm:text-[15px]">{title}</span>
        </span>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${open ? 'rotate-180 bg-primary-100 text-primary-700' : 'bg-background-100 text-foreground-500'}`}><AppIcon className="ri-arrow-down-s-line text-lg" /></span>
      </button>
      {open && <div className="border-t border-primary-100 bg-white p-4 sm:p-6">{children}</div>}
    </section>
  );
}

export function ProgressReviewsListPage() {
  const learner = useLinkedLearner();
  return <ProgressReviewsList key={`${learner.kind}:${learner.id}`} />;
}

function ProgressReviewsList() {
  const { myLearner, learner, sessions: reviews, setEvents, bookingCalendar, loading, error, refresh } = useReviewSessions('progress-review');
  const attendance = useMeetingAttendance(myLearner);
  const [absence, setAbsence] = useState<MeetingAttendance | null>(null);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'planned' | 'finished'>('planned');

  const booking = useMeetingBooking({
    learner: myLearner, rules: bookingCalendar, attendance: attendance.data?.sessions || [],
    titleOf: progressReviewTitle, setEvents, refresh: () => { refresh(); attendance.refresh(); },
  });
  const { openBooking } = booking;

  const pageSize = 10;
  const finishedReviews = reviews.filter((review) => review.status.toLowerCase() === 'completed');
  const plannedReviews = reviews.filter((review) => review.status.toLowerCase() !== 'completed');
  const tabReviews = view === 'finished' ? finishedReviews : plannedReviews;
  const totalPages = Math.max(1, Math.ceil(tabReviews.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleReviews = tabReviews.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const completedCount = finishedReviews.length;
  const scheduledCount = reviews.filter((review) => review.status.toLowerCase() === 'scheduled').length;
  const inProgressCount = reviews.filter((review) => review.status.toLowerCase() === 'in-progress').length;
  const planningCount = plannedReviews.filter((review) => ['not-scheduled', 'not scheduled', 'not_scheduled'].includes(review.status.toLowerCase())).length;
  const awaitingSignatureCount = reviews.filter(review => review.status.toLowerCase() === 'awaiting-signature').length;
  const reviewerName = reviews.find((review) => review.coachName)?.coachName || 'Your reviewer';
  const summaryMetrics = [
    { label: 'Total', value: reviews.length, icon: 'ri-stack-line', tone: 'brand' as const, iconClassName: 'bg-violet-100 text-violet-700' },
    { label: 'Scheduled', value: scheduledCount, icon: 'ri-calendar-check-line', tone: 'info' as const, iconClassName: 'bg-blue-100 text-blue-700' },
    { label: 'In progress', value: inProgressCount, icon: 'ri-time-line', tone: 'caution' as const, iconClassName: 'bg-amber-100 text-amber-700' },
    { label: 'Completed', value: completedCount, icon: 'ri-checkbox-circle-line', tone: 'positive' as const, iconClassName: 'bg-emerald-100 text-emerald-700' },
    { label: 'Not Scheduled', value: planningCount, icon: 'ri-time-line', tone: 'neutral' as const, iconClassName: 'bg-amber-100 text-amber-700' },
    { label: 'Awaiting Signature', value: awaitingSignatureCount, icon: 'ri-quill-pen-line', tone: 'brand' as const, iconClassName: 'bg-violet-100 text-violet-700' },
  ];

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Reviews"
      pageSubtitle="Your planned and completed review sessions"
      userName={learner?.name || 'Learner'}
      userRole={learner?.programme ? `${learner.programme} Learner` : 'Learner'}
    >
      <main className={`page-container ${styles.page} min-w-0 w-full space-y-3 p-3 md:space-y-4 md:p-6`}>
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AppIcon className="ri-error-warning-line mr-2" />{error}<button type="button" onClick={refresh} className="ml-3 font-bold underline">Try again</button></div>}

        <section className="learner-super-admin-hero relative overflow-hidden rounded-2xl p-4 text-primary-800 sm:rounded-3xl sm:p-6 md:p-6 workspace-page-hero">
          <div className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-secondary-300/15 blur-3xl hidden"></div>
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-primary-200/60 bg-primary-100/60 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary-600"><AppIcon className="ri-team-line text-secondary-300" />Formal review</span>
              <h1 className="mt-3 text-[22px] font-bold leading-tight text-primary-800 sm:text-2xl md:text-3xl">Reviews</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-500">Review your learning, progress and next actions with {reviewerName} and your line manager.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:min-w-[650px] xl:grid-cols-5">
              {summaryMetrics.map((metric) => <MetricCard key={metric.label} {...metric} className="progress-review-hero-metric" valuePosition="stacked" />)}
            </div>
          </div>
        </section>

        {booking.notice}
        <FeaturedMeeting sessions={reviews} source="progress-review" learner={learner} learnerQuery={`kind=${myLearner.kind}&learner=${myLearner.id}`}
          today={attendance.data?.today || bookingCalendar?.today || isoDate(new Date())} loading={loading} error={error}
          onSchedule={openBooking} titleOf={progressReviewTitle} attendance={attendance.data?.sessions || []}
          timeZone={attendance.data?.timeZone} busy={attendance.busy} canAct={attendance.canAct} onAttend={attendance.attend} onReport={setAbsence} />
        {attendance.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{attendance.error}<button type="button" onClick={attendance.refresh} className="ml-2 underline">Retry attendance</button></p>}
        {attendance.notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{attendance.notice}</p>}
        <section aria-label="Reviews sessions" className="overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-sm">
          <div className="flex flex-col gap-3 border-b border-background-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><AppIcon className="ri-file-list-3-line" /></span><div><h2 className="text-base font-bold text-foreground-900">Reviews sessions</h2><p className="mt-0.5 text-xs text-foreground-500">Check each review status and open the full review record.</p></div></div>
            <div className="flex flex-wrap items-center gap-2"><Link to={`/learner/calendar?kind=${myLearner.kind}&learner=${myLearner.id}`} className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-4 text-xs font-bold text-primary-700 transition hover:bg-primary-100"><AppIcon className="ri-calendar-2-line" />Open calendar</Link></div>
          </div>
          <div role="tablist" aria-label="Review status" className="flex overflow-x-auto border-b border-background-200 bg-white px-4 pt-3 sm:px-5">
            {(['planned', 'finished'] as const).map((tab) => {
              const count = tab === 'planned' ? plannedReviews.length : finishedReviews.length;
              const active = view === tab;
              return <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => { setView(tab); setPage(1); }}
                className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition ${active ? 'border-primary-600 text-primary-700' : 'border-transparent text-foreground-500 hover:border-primary-200 hover:text-primary-700'}`}
              >
                <AppIcon className={tab === 'planned' ? 'ri-calendar-event-line' : 'ri-checkbox-circle-line'} />
                {tab === 'planned' ? 'Planned' : 'Finished'}
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${active ? 'bg-primary-100 text-primary-700' : 'bg-background-100 text-foreground-500'}`}>{count}</span>
              </button>;
            })}
          </div>
          {loading ? <div className="p-5"><RowsSkeleton rows={4} /></div> : error && reviews.length === 0 ? null : tabReviews.length === 0 ? <div className="p-5"><Empty>{view === 'finished' ? 'No finished reviews were found.' : 'No planned reviews were found.'}</Empty></div> : (
            <>
              <div className="divide-y divide-background-200 md:hidden">
                {visibleReviews.map((review) => {
                  const isBooked = Boolean(review.scheduledDate) && !['not-scheduled', 'cancelled'].includes(review.status);
                  return (
                    <article key={review.id} className="space-y-4 p-4">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="text-sm font-bold text-foreground-900">{progressReviewTitle(review)}</h3>
                              <p className="mt-1 text-[11px] text-foreground-500">{reviewTypeLabel(review)}</p>
                            </div>
                            <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusStyle(review.status)}`}>
                              <AppIcon className={review.status === 'completed' ? 'ri-checkbox-circle-line' : review.status === 'cancelled' ? 'ri-close-circle-line' : review.status === 'scheduled' ? 'ri-calendar-check-line' : 'ri-time-line'} />{review.status === 'not-scheduled' ? 'Not Scheduled' : statusLabel(review.status)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="flex min-w-0 items-center gap-2 rounded-xl bg-background-100/70 p-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary-100 text-[9px] font-bold text-secondary-700">{initials(review.coachName)}</span>
                          <div className="min-w-0"><p className="text-[9px] uppercase text-foreground-400">Reviewer</p><p className="truncate text-xs font-semibold text-foreground-800">{review.coachName || '-'}</p></div>
                        </div>
                        <div className="flex min-w-0 items-center gap-2 rounded-xl bg-background-100/70 p-2.5">
                          <AppIcon className="ri-calendar-line shrink-0 text-primary-500" />
                          <div className="min-w-0"><p className="text-[9px] uppercase text-foreground-400">{isBooked ? 'Scheduled' : 'Planned'}</p><p className="truncate text-xs font-semibold text-foreground-800">{formatDate(isBooked ? review.scheduledDate : review.targetDate)}</p>{isBooked && <p className="text-[10px] text-foreground-400">{formatTime(review.scheduledTime)}</p>}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="col-span-2"><MeetingAttendanceActions session={attendance.data?.sessions.find(item => item.id === review.id)} busy={Boolean(attendance.busy)} canAct={attendance.canAct}
                          onAttend={() => attendance.attend(review.id)} onReport={() => { const item = attendance.data?.sessions.find(item => item.id === review.id); if (item) setAbsence(item); }} onReschedule={() => openBooking(review)} /></div>
                        <MeetingSchedulingAction label={['completed', 'cancelled', 'awaiting-signature', 'in-progress'].includes(review.status) ? 'View in calendar' : isBooked ? 'Reschedule' : 'Schedule'}
                          calendarHref={meetingCalendarHref(review, myLearner, undefined, attendance.data?.sessions.find(item => item.id === review.id))}
                          onSchedule={() => openBooking(review)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 text-xs font-bold text-primary-700 transition hover:bg-primary-100" />
                        <Link to={`/learner/progress-reviews/${encodeURIComponent(review.id)}?kind=${myLearner.kind}&learner=${myLearner.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary-600 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700">View review <AppIcon className="ri-arrow-right-line" /></Link>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className={`${styles.tableWrap} hidden md:block`}>
                <table className="w-full min-w-[980px] text-left">
                  <thead className="border-b border-primary-100 bg-primary-50/70 text-[10px] font-bold uppercase tracking-wide text-primary-900/60">
                    <tr><th className="px-5 py-3.5">Review Name / Review Type</th><th className="px-5 py-3.5">Reviewer</th><th className="px-5 py-3.5">Planned / Scheduled Date</th><th className="px-5 py-3.5">Status</th><th className="px-5 py-3.5">Attendance action</th><th className="px-5 py-3.5">Scheduling Assistant</th><th className="px-5 py-3.5 text-right">Review Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-background-200">
                  {visibleReviews.map((review) => {
                    const isBooked = Boolean(review.scheduledDate) && !['not-scheduled', 'cancelled'].includes(review.status);
                    return (
                      <tr key={review.id} className="group transition-colors hover:bg-primary-50/35">
                        <td className="px-5 py-4"><div><p className="text-xs font-bold text-foreground-900">{progressReviewTitle(review)}</p><p className="mt-1 text-[10px] text-foreground-400">{reviewTypeLabel(review)}</p></div></td>
                        <td className="px-5 py-4"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary-100 text-[9px] font-bold text-secondary-700">{initials(review.coachName)}</span><span className="text-xs font-semibold text-foreground-700">{review.coachName || '-'}</span></div></td>
                        <td className="px-5 py-4"><div className="flex items-center gap-2"><AppIcon className="ri-calendar-line text-primary-500" /><div><p className="text-xs font-semibold text-foreground-700">{formatDate(isBooked ? review.scheduledDate : review.targetDate)}</p>{isBooked && <p className="mt-1 text-[10px] text-foreground-400">at {formatTime(review.scheduledTime)}</p>}</div></div></td>
                        <td className="px-5 py-4"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusStyle(review.status)}`}><AppIcon className={review.status === 'completed' ? 'ri-checkbox-circle-line' : review.status === 'cancelled' ? 'ri-close-circle-line' : review.status === 'scheduled' ? 'ri-calendar-check-line' : 'ri-time-line'} />{review.status === 'not-scheduled' ? 'Not Scheduled' : statusLabel(review.status)}</span></td>
                          <td className="px-5 py-4"><MeetingAttendanceActions session={attendance.data?.sessions.find(item => item.id === review.id)} busy={Boolean(attendance.busy)} canAct={attendance.canAct}
                            onAttend={() => attendance.attend(review.id)} onReport={() => { const item = attendance.data?.sessions.find(item => item.id === review.id); if (item) setAbsence(item); }} onReschedule={() => openBooking(review)} /></td>
                        <td className="px-5 py-4"><MeetingSchedulingAction label={['completed', 'cancelled', 'awaiting-signature', 'in-progress'].includes(review.status) ? 'View in calendar' : isBooked ? 'Reschedule' : 'Schedule'}
                          calendarHref={meetingCalendarHref(review, myLearner, undefined, attendance.data?.sessions.find(item => item.id === review.id))}
                          onSchedule={() => openBooking(review)} className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-foreground-600 transition hover:bg-primary-50 hover:text-primary-700" /></td>
                        <td className="px-5 py-4"><div className="flex items-center justify-end"><Link to={`/learner/progress-reviews/${encodeURIComponent(review.id)}?kind=${myLearner.kind}&learner=${myLearner.id}`} className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 hover:shadow-md">View <AppIcon className="ri-arrow-right-line" /></Link></div></td>
                      </tr>
                    );
                  })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-3 border-t border-background-200 bg-background-50 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => setPage(1)} disabled={currentPage === 1} className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-300 bg-white text-xs text-foreground-500 disabled:opacity-40"><AppIcon className="ri-skip-left-line" /></button>
                  <button type="button" onClick={() => setPage((value) => Math.max(1, Math.min(value, totalPages) - 1))} disabled={currentPage === 1} className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-300 bg-white text-xs text-foreground-500 disabled:opacity-40"><AppIcon className="ri-arrow-left-s-line" /></button>
                  {Array.from({ length: totalPages }, (_, index) => index + 1).slice(0, 5).map((number) => <button key={number} type="button" onClick={() => setPage(number)} aria-current={currentPage === number ? 'page' : undefined} className={`h-8 min-w-8 rounded-lg border px-2 text-xs font-bold ${currentPage === number ? 'border-primary-600 bg-primary-600 text-white' : 'border-background-300 bg-white text-foreground-600'}`}>{number}</button>)}
                  <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage === totalPages} className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-300 bg-white text-xs text-foreground-500 disabled:opacity-40"><AppIcon className="ri-arrow-right-s-line" /></button>
                  <button type="button" onClick={() => setPage(totalPages)} disabled={currentPage === totalPages} className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-300 bg-white text-xs text-foreground-500 disabled:opacity-40"><AppIcon className="ri-skip-right-line" /></button>
                  <span className="ml-2 hidden text-[10px] text-foreground-400 sm:inline">10 items per page</span>
                </div>
                <p className="text-[10px] text-foreground-500">{(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, tabReviews.length)} of {tabReviews.length} items</p>
              </div>
            </>
          )}
        </section>
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

export default function ProgressReviewsPage() {
  const navigate = useNavigate();
  const { reviewId } = useParams<{ reviewId: string }>();
  const { myLearner, learner, sessions: reviews, setEvents, loading, error: loadError, refresh } = useReviewSessions('progress-review');
  const [actionError, setError] = useState('');
  const error = loadError || actionError;
  const [selectedId, setSelectedId] = useState(reviewId || '');
  const [openSections, setOpenSections] = useState<string[]>(['progress-checks']);
  const [slidesDeck, setSlidesDeck] = useState<ProgressReviewSlidesDeck | null>(null);
  const [slidesBusy, setSlidesBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signatureBusy, setSignatureBusy] = useState(false);
  const [signatureError, setSignatureError] = useState('');

  const completed = useMemo(() => reviews.filter((review) => review.status === 'completed'), [reviews]);
  const planned = useMemo(() => reviews.filter((review) => !['completed', 'cancelled'].includes(review.status)), [reviews]);

  useEffect(() => {
    if (reviewId) setSelectedId(reviewId);
  }, [reviewId]);

  useEffect(() => {
    if (reviewId || !reviews.length || reviews.some((review) => review.id === selectedId)) return;
    setSelectedId((planned[0] || completed.at(-1) || reviews[0]).id);
  }, [reviewId, reviews, planned, completed, selectedId]);

  const selected = reviewId
    ? reviews.find(review => review.id === reviewId) || null
    : reviews.find(review => review.id === selectedId) || planned[0] || completed.at(-1) || reviews[0] || null;
  const reviewInstance = useLearnerReviewInstance(
    myLearner.kind,
    myLearner.id,
    selected?.reviewTemplateId || selected?.reviewInstanceId ? (selected.eventKey || selected.id) : '',
  );
  const selectedIndex = selected ? reviews.findIndex((review) => review.id === selected.id) : -1;
  const previousReview = selectedIndex > 0 ? reviews[selectedIndex - 1] : null;

  const progressVariance = asNumber(learner?.progressVariance);

  const toggleSection = (id: string) => {
    setOpenSections((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const addToCalendar = () => {
    if (!selected?.scheduledDate || !selected.scheduledTime) return;
    const start = `${selected.scheduledDate.replaceAll('-', '')}T${selected.scheduledTime.replace(':', '')}00`;
    const startDate = new Date(`${selected.scheduledDate}T${selected.scheduledTime}:00`);
    const endDate = new Date(startDate.getTime() + selected.durationMinutes * 60_000);
    const pad = (value: number) => String(value).padStart(2, '0');
    const end = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;
    const content = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${progressReviewTitle(selected)}`, selected.meetingLink ? `URL:${selected.meetingLink}` : '', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `progress-review-${selected.sequence}.ics`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const loadArtifacts = useCallback((eventKey: string, signal?: AbortSignal) => (
    fetchLearnerMeetingArtifacts(myLearner.kind, myLearner.id, eventKey, signal)
  ), [myLearner.id, myLearner.kind]);
  const artifactContentUrl = useCallback((eventKey: string, artifactType: string, artifactId: string, options: { preview?: boolean } = {}) => (
    learnerMeetingArtifactContentUrl(myLearner.kind, myLearner.id, eventKey, artifactType, artifactId, options)
  ), [myLearner.id, myLearner.kind]);

  const showSlides = async () => {
    if (!selected || !learner) return;
    setSlidesBusy(true);
    setError('');
    try {
      const evidence = await fetchEvidence(myLearner.kind, myLearner.id).catch(() => []);
      const review = {
        ...selected,
        learner: learner.name,
        learnerId: myLearner.id,
        learnerType: myLearner.kind,
        programme: learner.programme,
        ownerName: selected.coachName,
      } as unknown as CoachCalendarEvent;
      setSlidesDeck(buildProgressReviewSlidesDeck(review, selected.coachName || 'Coach', myLearner.kind, learner, evidence));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not prepare the progress review slides.');
    } finally {
      setSlidesBusy(false);
    }
  };

  const saveSignature = async (signature: string) => {
    if (!selected) return;
    setSignatureBusy(true);
    setSignatureError('');
    try {
      const result = await signLearnerProgressReview(myLearner.kind, myLearner.id, selected.eventKey || selected.id, { name: learner?.name || 'Learner', signature });
      setEvents((current) => current.map((event) => event.id === selected.id ? { ...event, ...result.event } : event));
      setSigning(false);
    } catch (reason) {
      setSignatureError(reason instanceof Error ? reason.message : 'Could not save your signature.');
    } finally {
      setSignatureBusy(false);
    }
  };

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Reviews"
      pageSubtitle="Formal reviews with your coach and line manager"
      userName={learner?.name || 'Learner'}
      userRole={learner?.programme ? `${learner.programme} Learner` : 'Learner'}
    >
      <div className={`page-container ${styles.page} min-w-0 w-full space-y-3 p-3 md:space-y-4 md:p-6`}>
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AppIcon className="ri-error-warning-line mr-2" />{error}<button type="button" onClick={refresh} className="ml-3 font-bold underline">Try again</button></div>}

        <button type="button" onClick={() => navigate(`/learner/progress-reviews?kind=${myLearner.kind}&learner=${myLearner.id}`)} className="inline-flex h-9 items-center gap-2 self-start rounded-xl border border-primary-200 bg-primary-50 px-3.5 text-xs font-bold text-primary-700 shadow-sm transition hover:-translate-x-0.5 hover:bg-primary-100">
          <AppIcon className="ri-arrow-left-line" /> Back to Reviews
        </button>

        <section className="learner-super-admin-hero relative overflow-hidden rounded-3xl p-5 text-primary-800 sm:p-6 workspace-page-hero">
          <div className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-secondary-300/15 blur-3xl hidden"></div>
          <div className="relative flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary-200/60 bg-primary-100/60 text-xl text-primary-600 shadow-lg"><AppIcon className="ri-team-line" /></span>
              <div>
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary-600">Formal review</span>
                  <span className="rounded-full border border-primary-200/60 bg-primary-100/60 px-2.5 py-1 text-[10px] font-bold text-foreground-500">{loading ? 'Loading...' : learner?.programme || '-'}</span>
                </div>
                <h1 className="font-heading text-xl font-bold text-primary-800 sm:text-2xl">Your review record</h1>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-foreground-500">Each review brings together you, your coach and line manager to discuss learning, progress and next actions.</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:min-w-[390px]">
              {([
                { label: 'Completed', value: loading ? '-' : completed.length, color: 'text-emerald-600', icon: 'ri-checkbox-circle-line' },
                { label: 'Planned', value: loading ? '-' : planned.length, color: 'text-primary-600', icon: 'ri-calendar-event-line' },
                { label: 'All Reviews', value: loading ? '-' : reviews.length, color: 'text-foreground-900', icon: 'ri-stack-line' },
              ] as const).map(({ label, value, color, icon }) => (
                <div key={label} className="rounded-2xl border border-white/[0.08] bg-white/[0.07] px-3 py-3 text-center backdrop-blur">
                  <AppIcon className={`${icon} ${color === 'text-foreground-900' ? 'text-secondary-200' : color.replace('600', '300')} text-sm`} />
                  <p className="mt-0.5 text-xl font-bold text-primary-800">{value}</p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-foreground-500">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {loading ? (
          <section className="rounded-2xl border border-background-200 bg-background-50 p-10 text-center text-sm text-foreground-400">Loading progress reviews...</section>
        ) : !selected ? (
          <section className="rounded-2xl border border-background-200 bg-background-50 p-6"><Empty>{reviewId ? 'This progress review is no longer available. Return to Progress Review to choose a current session.' : 'No progress reviews have been created for this learner.'}</Empty></section>
        ) : (
          <div>
            <main className="space-y-4">
              <section className="overflow-hidden rounded-3xl border border-background-200 bg-background-50 shadow-[0_10px_35px_rgba(25,12,50,0.07)]">
                <div className="learner-super-admin-hero relative overflow-hidden border-b border-primary-200/60 p-5 text-primary-800 sm:p-6 workspace-page-hero">
                  <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-secondary-400/10 blur-3xl hidden"></div>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="relative">
                      <span className={`inline-flex rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white/80`}>{statusLabel(selected?.status)}</span>
                      <h2 className="mt-2 text-xl font-bold text-primary-800">{progressReviewTitle(selected)}</h2>
                      <p className="mt-1 text-sm text-foreground-500">{formatDate(reviewDate(selected), true)} at {formatTime(selected?.scheduledTime)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selected?.meetingLink && <a href={selected.meetingLink} target="_blank" rel="noopener noreferrer" className={`${styles.primaryButton} meeting-join-action inline-flex items-center rounded-lg px-4 py-2.5 text-xs font-extrabold`}><AppIcon className="ri-video-chat-line mr-1.5" />Join meeting</a>}
                      {!selected.importedReview && <button type="button" onClick={() => void showSlides()} disabled={slidesBusy} className="inline-flex items-center rounded-lg border border-primary-200/60 bg-white px-3.5 py-2 text-xs font-bold text-primary-900 shadow-sm hover:bg-primary-50 disabled:opacity-60"><AppIcon className={slidesBusy ? 'ri-loader-4-line mr-1.5 animate-spin' : 'ri-slideshow-line mr-1.5'} />{slidesBusy ? 'Preparing slides…' : 'Show slides'}</button>}
                      {!selected.importedReview && <button type="button" onClick={addToCalendar} disabled={!selected?.scheduledDate || !selected.scheduledTime} className="rounded-lg border border-primary-200/60 bg-primary-100/60 px-3.5 py-2 text-xs font-bold text-primary-800 disabled:cursor-not-allowed disabled:opacity-40"><AppIcon className="ri-calendar-check-line mr-1.5" />Add to calendar</button>}
                    </div>
                  </div>
                </div>

                <div className="space-y-5 p-5 sm:p-6">
                  {shouldShowLearnerMeetingPanel(selected) ? (
                    <CoachMeetingArtifactsPanel event={{ ...selected, eventKey: selected.eventKey || selected.id }} fetchArtifacts={loadArtifacts} contentUrl={artifactContentUrl} showAttendance={false} visibleArtifactTypes={['recording']} className="border-primary-100 bg-primary-50/30" />
                  ) : null}

                  {selected && !selected.importedReview && ['awaiting-signature', 'completed'].includes(selected.status) ? (
                    <div className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 sm:flex-row sm:items-center">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><AppIcon className={selected.learnerSigned ? 'ri-checkbox-circle-line' : 'ri-file-sign-line'} /></span>
                      <div className="flex-1"><p className="text-sm font-bold text-violet-950">{selected.learnerSigned ? 'Slides signed by learner' : 'Your formal acknowledgement is required'}</p><p className="mt-1 text-xs text-violet-700">{selected.learnerSigned ? `Signed ${selected.learnerSignedAt ? formatDate(selected.learnerSignedAt.split('T')[0]) : ''}` : 'Review the slides, then sign to confirm the progress review record.'}</p></div>
                      {!selected.learnerSigned ? <button type="button" onClick={() => void showSlides()} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 text-xs font-bold text-white shadow-sm hover:bg-violet-800"><AppIcon className="ri-slideshow-line" />Show slides & sign</button> : null}
                    </div>
                  ) : null}
                  <div>
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-foreground-400">Review participants</p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <PersonCard role="Learner" name={learner?.name} icon="ri-user-line" tone="bg-primary-100 text-primary-700" />
                      <PersonCard role="Coach" name={selected?.coachName} icon="ri-user-star-line" tone="bg-amber-100 text-amber-700" />
                      <PersonCard role="Line manager" name={learner?.lineManager} icon="ri-briefcase-line" tone="bg-emerald-100 text-emerald-700" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ['Duration', selected?.durationMinutes ? `${selected.durationMinutes} minutes` : '-', 'ri-time-line'],
                      ['Meeting type', selected?.meetingProvider || '-', 'ri-video-chat-line'],
                      ['Scheduled time', formatTime(selected?.scheduledTime), 'ri-calendar-schedule-line'],
                      ['Review window', previousReview ? `Since ${progressReviewTitle(previousReview)}` : 'Programme to date', 'ri-history-line'],
                    ].map(([label, value, icon]) => (
                      <div key={label} className="rounded-xl bg-background-100 p-3.5">
                        <AppIcon className={`${icon} text-primary-500`} />
                        <p className="mt-2 text-[9px] font-semibold uppercase tracking-wider text-foreground-400">{label}</p>
                        <p className="mt-0.5 text-xs font-bold text-foreground-800">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {reviewInstance.loading ? <div className="rounded-xl border border-background-200 bg-white p-5"><RowsSkeleton rows={4} /></div> : reviewInstance.error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{reviewInstance.error}</p> : reviewInstance.definition ? <LearnerReviewInstanceForm definition={reviewInstance.definition} onSign={saveSignature} signatoryName={learner?.name || 'Learner'} /> : selected.reviewTemplateId ? <p className="p-4 text-sm text-foreground-500">This review form is not available.</p> : <>
              {selected.importedReview ? <div className="space-y-3">
                {selected.importedReview.sections.map((section, index) => <Accordion key={section.id} id={`imported-section:${section.id}`} title={section.name.replace(/\s+(completed|incomplete)$/i, '').trim()} icon="ri-file-list-3-line" open={openSections.includes(`imported-section:${section.id}`) || (!openSections.some((id) => id.startsWith('imported-section:')) && index === 0)} onToggle={toggleSection}>
                  <ImportedReviewSections review={{ ...selected.importedReview, sections: [section] }} />
                </Accordion>)}
                {!selected.importedReview.sections.length && <Empty>Detailed questions and answers have not been imported for this review yet.</Empty>}
              </div> : <>
              <Accordion id="progress-checks" title="Progress Checks" icon="ri-check-double-line" open={openSections.includes('progress-checks')} onToggle={toggleSection}>
                <SavedReviewAnswers sectionId="progress-checks" responses={selected?.reviewResponses} emptyMessage="No progress checks have been recorded for this Progress Review." />
              </Accordion>
              <Accordion id="learner-reflection" title="Learner Reflections & Ratings" icon="ri-user-heart-line" open={openSections.includes('learner-reflection')} onToggle={toggleSection}><SavedReviewAnswers sectionId="learner-reflection" responses={selected?.reviewResponses} emptyMessage="Learner reflection data is not available for this Progress Review." /></Accordion>
              <Accordion id="manager-reflection" title="Manager Reflections & Ratings" icon="ri-briefcase-line" open={openSections.includes('manager-reflection')} onToggle={toggleSection}><SavedReviewAnswers sectionId="manager-reflection" responses={selected?.reviewResponses} emptyMessage="Manager reflection data is not available for this Progress Review." /></Accordion>
              <Accordion id="tutor-reflection" title="Tutor Reflections & Ratings" icon="ri-user-star-line" open={openSections.includes('tutor-reflection')} onToggle={toggleSection}><SavedReviewAnswers sectionId="tutor-reflection" responses={selected?.reviewResponses} emptyMessage="Tutor reflection data is not available for this Progress Review." /></Accordion>
              <Accordion id="safeguarding" title="Safeguarding & Key Themes" icon="ri-shield-check-line" open={openSections.includes('safeguarding')} onToggle={toggleSection}><SavedReviewAnswers sectionId="safeguarding" responses={selected?.reviewResponses} emptyMessage="No safeguarding or key-theme discussion has been recorded for this Progress Review." /></Accordion>
              <Accordion id="additional-support" title="Additional Support" icon="ri-hand-heart-line" open={openSections.includes('additional-support')} onToggle={toggleSection}><SavedReviewAnswers sectionId="additional-support" responses={selected?.reviewResponses} emptyMessage="No additional support information has been recorded for this Progress Review." /></Accordion>
              <Accordion id="actions" title="Progress Targets & Actions" icon="ri-focus-3-line" open={openSections.includes('actions')} onToggle={toggleSection}><SavedReviewAnswers sectionId="actions" responses={selected?.reviewResponses} emptyMessage="No targets or actions have been recorded for this Progress Review." /></Accordion>
              <Accordion id="rag" title="RAG Status" icon="ri-traffic-light-line" open={openSections.includes('rag')} onToggle={toggleSection}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-background-100 p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">OTJH status</p><p className="mt-1 text-base font-bold text-foreground-900">{learner?.otjhStatus || '-'}</p></div>
                  <div className="rounded-xl bg-background-100 p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Progress variance</p><p className="mt-1 text-base font-bold text-foreground-900">{progressVariance === null ? '-' : `${Math.round(progressVariance * 100)}%`}</p></div>
                  <div className="rounded-xl bg-background-100 p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Coach RAG</p><p className="mt-1 text-base font-bold text-foreground-900">{selected?.reviewResponses?.rag_status || '-'}</p></div>
                </div>
                {responsesForSection(selected?.reviewResponses, 'rag').length > 0 && <div className="mt-4"><SavedReviewAnswers sectionId="rag" responses={selected?.reviewResponses} emptyMessage="No RAG assessment has been recorded for this Progress Review." /></div>}
              </Accordion>
              </>}
                  </>}
            </main>
          </div>
        )}
      </div>
      <ProgressReviewSlidesModal
        open={Boolean(slidesDeck)}
        deck={slidesDeck}
        onClose={() => setSlidesDeck(null)}
        primaryAction={selected && !selected.importedReview && ['awaiting-signature', 'completed'].includes(selected.status) && !selected.learnerSigned ? (
          <button type="button" onClick={() => setSigning(true)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-violet-700 px-4 text-[12px] font-bold text-white shadow-sm transition hover:bg-violet-800">
            <AppIcon className="ri-quill-pen-line" />Sign slides
          </button>
        ) : null}
      />
      {signing ? <ProgressReviewSignModal name={learner?.name || 'Learner'} saving={signatureBusy} error={signatureError} onClose={() => setSigning(false)} onSign={(signature) => void saveSignature(signature)} /> : null}
    </WorkspaceShell>
  );
}
