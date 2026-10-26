import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { CoachingMeeting } from '@/api/coachingRecordings';
import { formatFullDate } from '@/pages/curriculum/recordings/utils';
import { meetingDate, meetingPhase, meetingTitle, meetingCategory, categoryLabels } from './model';
import SessionDetails from './SessionDetails';
import type { EvidenceTab } from './location';
import MeetingQualityChecks from './MeetingQualityChecks';
import { invalidateQualityReviews } from '@/api/coachingQualityReviews';
import { suggestQualityType } from './qualityReviewType';
const QualityReviewDialog = lazy(() => import('./QualityReviewDialog'));

interface Props {
  meeting: CoachingMeeting; reference?: string; timeZone: string; now: number;
  coachName: string; learnerNames: string[]; onClose: () => void;
  qualityEnabled?: boolean;
  activeTab?: EvidenceTab; onTabChange?: (tab: EvidenceTab) => void;
}

export default function MeetingDetailsDrawer({ meeting, reference, timeZone, now, coachName, learnerNames, onClose, qualityEnabled = false, activeTab, onTabChange }: Props) {
  const [reportOpen, setReportOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [reviewId, setReviewId] = useState<string | undefined>(), [qualityRefresh, setQualityRefresh] = useState(0);
  const modalOpen = reportOpen || qualityOpen;
  const previewOpen = useRef(modalOpen); previewOpen.current = modalOpen;
  const titleId = useId(), panel = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (previewOpen.current) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      // Let the browser traverse its native video controls. The focus guard
      // catches the next outside focus after the last native control.
      if (document.activeElement instanceof HTMLVideoElement) return;
      const nodes = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, input:not(:disabled), select:not(:disabled), video[controls], iframe, [tabindex="0"]'));
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    const containFocus = (event: FocusEvent) => {
      if (previewOpen.current) return;
      if (panel.current && event.target instanceof Node && !panel.current.contains(event.target)) closeButton.current?.focus();
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', containFocus);
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('focusin', containFocus); document.body.style.overflow = previous; if (trigger?.isConnected) trigger.focus(); };
  }, []);
  const phase = meetingPhase(meeting, now);
  const clock = (stamp: string) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(stamp));
  const canReview = Boolean(reference || (meeting.match === 'matched' && meeting.eventKey));
  const suggestedQualityType = suggestQualityType(meetingTitle(meeting));
  return createPortal(<div className="fixed inset-0 z-50 bg-black/40" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside ref={panel} role="dialog" aria-modal={modalOpen ? undefined : true} aria-hidden={modalOpen || undefined} aria-labelledby={titleId} className="absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col border-l border-background-200 bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-3 border-b border-background-200 p-5">
        <div className="min-w-0"><p id={titleId} className="text-[10px] font-bold uppercase tracking-wider text-primary-600">Meeting details</p>
          <h2 className="mt-1 break-words text-base font-bold text-foreground-950">{meetingTitle(meeting)}</h2></div>
        <button ref={closeButton} type="button" aria-label="Close meeting details" onClick={onClose} className="rounded-md p-1.5 text-foreground-500 hover:bg-background-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"><X size={18} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-slim">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-5 text-sm">
          {[['Date', formatFullDate(meetingDate(meeting.startsAt, timeZone))], ['Time', `${clock(meeting.startsAt)}–${clock(meeting.endsAt)} (${timeZone})${meetingDate(meeting.endsAt, timeZone) !== meetingDate(meeting.startsAt, timeZone) ? ` · Ends ${formatFullDate(meetingDate(meeting.endsAt, timeZone))}` : ''}`],
            ['Coach', coachName], ['Meeting type', categoryLabels[meetingCategory(meeting)]],
            ['Learners', learnerNames.join(', ') || 'No learner linked'], ['Status', phase === 'ended' ? 'Ended' : phase === 'upcoming' ? 'Upcoming' : phase === 'cancelled' ? 'Cancelled' : 'In progress']].map(([label, value]) =>
            <div key={label} className="min-w-0"><dt className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">{label}</dt><dd className="mt-1 break-words font-medium text-foreground-800">{value}</dd></div>)}
        </dl>
        {qualityEnabled && <><button type="button" onClick={() => { setReviewId(undefined); setQualityOpen(true); }}
          className="mt-5 w-full rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-left text-sm font-semibold text-primary-800 hover:bg-primary-100">Quality Check<span className="mt-1 block text-xs font-normal">{suggestedQualityType ? `${suggestedQualityType} form suggested from the title · You can change it` : 'Choose MCM or PR and complete a form for one learner'}</span></button>
          <MeetingQualityChecks meetingId={meeting.meetingId} refresh={qualityRefresh} onOpen={id => { setReviewId(id); setQualityOpen(true); }} onPreviewChange={setReportOpen} />
        </>}
        {meeting.match !== 'matched' && <details className="mt-5 rounded-lg border border-background-200 bg-background-50 p-3 text-xs text-foreground-600"><summary className="cursor-pointer font-semibold">LMS booking link: {meeting.match === 'external' ? 'not linked' : 'needs review'}</summary><p className="mt-2 leading-5">This Microsoft calendar meeting is not linked to one confirmed LMS booking. This is a booking comparison notice; recordings, attendance and transcripts are checked separately using the verified meeting identity.</p></details>}
        {Boolean(meeting.cancellationSources?.length) && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-900">Cancellation source: {meeting.cancellationSources!.map(source => source === 'lms' ? 'LMS' : 'Microsoft').join(' + ')}{phase !== 'cancelled' ? ' · Microsoft still shows an active meeting; needs review.' : ''}</p>}
        {canReview && (phase === 'ended' || phase === 'cancelled') ? <SessionDetails eventKey={reference ? '' : meeting.eventKey!} reference={reference} category={meetingCategory(meeting)}
          activeTab={activeTab} onTabChange={onTabChange}
          analysisEventKey={meeting.eventKey || undefined} analysisContext={phase === 'ended' ? meeting.analysisContext : undefined} onPreviewChange={setReportOpen} />
          : <p className="mt-6 rounded-lg bg-primary-50 p-4 text-sm text-primary-800">{phase === 'upcoming' || phase === 'in-progress' ? 'Recordings and attendance can be checked after this meeting ends.' : 'A verified recording or attendance source is not available for this meeting yet.'}</p>}
      </div>
    </aside>
    {qualityOpen && <Suspense fallback={<div role="status" className="fixed inset-0 z-[90] flex items-center justify-center bg-white/95 text-sm">Loading the quality form…</div>}>
      <QualityReviewDialog eventKey={reference ? '' : meeting.eventKey ?? ''} reference={reference} initialLearnerId={meeting.learnerIds.length === 1 ? meeting.learnerIds[0] : ''}
        initialReviewType={reviewId ? undefined : suggestedQualityType} reviewId={reviewId} timeZone={timeZone} onClose={() => setQualityOpen(false)} onSaved={() => { invalidateQualityReviews(); setQualityRefresh(value => value + 1); }} />
    </Suspense>}
  </div>, document.body);
}
