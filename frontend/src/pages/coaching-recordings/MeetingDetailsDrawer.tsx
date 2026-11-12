import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Info, ShieldCheck, Users, Video } from 'lucide-react';
import RecordingsDetailsHeader from '@/components/feature/RecordingsDetailsHeader';
import detailsStyles from '@/components/feature/RecordingsDetails.module.css';
import type { CoachingMeeting } from '@/api/coachingRecordings';
import { formatFullDate } from '@/pages/curriculum/recordings/utils';
import { meetingDate, meetingPhase, meetingTitle, meetingCategory, categoryLabels } from './model';
import SessionDetails from './SessionDetails';
import type { EvidenceTab } from './location';
import MeetingQualityChecks from './MeetingQualityChecks';
import { invalidateQualityReviews } from '@/api/coachingQualityReviews';
const QualityReviewDialog = lazy(() => import('./QualityReviewDialog'));
const tabs = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'recordings', label: 'Recording', icon: Video },
  { id: 'attendance', label: 'Attendance', icon: Users },
  { id: 'transcript', label: 'Transcript', icon: FileText },
  { id: 'quality', label: 'Quality check', icon: ShieldCheck },
] as const;

interface Props {
  meeting: CoachingMeeting; reference?: string; timeZone: string; now: number;
  coachName: string; learnerNames: string[]; onClose: () => void;
  qualityEnabled?: boolean;
  activeTab?: EvidenceTab; onTabChange?: (tab: EvidenceTab) => void;
}

export default function MeetingDetailsDrawer({ meeting, reference, timeZone, now, coachName, learnerNames, onClose, qualityEnabled = false, activeTab, onTabChange }: Props) {
  const [reportOpen, setReportOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [localTab, setLocalTab] = useState<EvidenceTab>('overview');
  const [evidenceTab, setEvidenceTab] = useState<EvidenceTab>(activeTab ?? 'recordings');
  const requestedTab = activeTab ?? localTab;
  const selectedTab = requestedTab === 'analysis' ? 'transcript' : requestedTab === 'quality' && !qualityEnabled ? 'overview' : requestedTab;
  const visibleTabs = tabs.filter(tab => tab.id !== 'quality' || qualityEnabled);
  useEffect(() => { setEvidenceTab(activeTab ?? 'recordings'); }, [activeTab]);
  const selectTab = (tab: EvidenceTab) => {
    if (requestedTab === tab) return;
    setLocalTab(tab); setEvidenceTab(tab === 'transcript' ? 'transcript' : 'recordings'); onTabChange?.(tab);
  };
  const selectEvidence = (tab: EvidenceTab) => {
    setEvidenceTab(tab);
    // Collapsing an evidence accordion keeps the surrounding Transcript tab open.
    if (tab === 'transcript' || tab === 'analysis') { setLocalTab(tab); onTabChange?.(tab); }
  };
  const [reviewId, setReviewId] = useState<string | undefined>(), [qualityRefresh, setQualityRefresh] = useState(0);
  const modalOpen = reportOpen || qualityOpen;
  const previewOpen = useRef(modalOpen); previewOpen.current = modalOpen;
  const titleId = useId(), panel = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null), body = useRef<HTMLDivElement>(null);
  useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [selectedTab]);
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
      const nodes = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, input:not(:disabled), select:not(:disabled), video[controls], iframe, [tabindex="0"]'))
        .filter(node => !node.closest('[hidden]') && node.tabIndex >= 0)
        .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
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
  return createPortal(<div className={detailsStyles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside ref={panel} role="dialog" aria-modal={modalOpen ? undefined : true} aria-hidden={modalOpen || undefined} aria-labelledby={titleId} className={detailsStyles.drawer}>
      <RecordingsDetailsHeader eyebrow="Meeting details" title={meetingTitle(meeting)} titleId={titleId} closeLabel="Close meeting details" onClose={onClose} closeButtonRef={closeButton} />
      <div className={detailsStyles.tabBar}>
        <div role="tablist" aria-label="Meeting detail sections" className={`${detailsStyles.tabs} scrollbar-slim`}>
          {visibleTabs.map(({ id, label, icon: Icon }) => <button key={id} id={`${titleId}-tab-${id}`} type="button" role="tab"
            aria-selected={selectedTab === id} aria-controls={`${titleId}-panel`} tabIndex={selectedTab === id ? 0 : -1}
            onClick={() => selectTab(id)} onKeyDown={event => {
              const index = visibleTabs.findIndex(tab => tab.id === id);
              const next = event.key === 'ArrowRight' ? (index + 1) % visibleTabs.length : event.key === 'ArrowLeft' ? (index - 1 + visibleTabs.length) % visibleTabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? visibleTabs.length - 1 : null;
              if (next === null) return;
              event.preventDefault(); selectTab(visibleTabs[next].id);
              document.getElementById(`${titleId}-tab-${visibleTabs[next].id}`)?.focus();
            }} className={`${detailsStyles.tab} inline-flex min-h-10 shrink-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-2 text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 ${selectedTab === id ? 'bg-primary-600 text-white shadow-sm' : 'text-foreground-600 hover:bg-white hover:text-primary-800'}`}>
            <Icon size={13} aria-hidden="true" />{label}
          </button>)}
        </div>
      </div>
      <div ref={body} role="tabpanel" id={`${titleId}-panel`} aria-labelledby={`${titleId}-tab-${selectedTab}`} tabIndex={0} className={`${detailsStyles.body} scrollbar-slim focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-primary-500`}>
        <div hidden={selectedTab !== 'overview'}>
        <dl className={detailsStyles.metadata}>
          {[['Date', formatFullDate(meetingDate(meeting.startsAt, timeZone))], ['Time', `${clock(meeting.startsAt)}–${clock(meeting.endsAt)} (${timeZone})${meetingDate(meeting.endsAt, timeZone) !== meetingDate(meeting.startsAt, timeZone) ? ` · Ends ${formatFullDate(meetingDate(meeting.endsAt, timeZone))}` : ''}`],
            ['Coach', coachName], ['Meeting type', categoryLabels[meetingCategory(meeting)]],
            ['Learners', learnerNames.join(', ') || 'No learner linked'], ['Calendar status', phase === 'ended' ? 'Ended' : phase === 'upcoming' ? 'Upcoming' : phase === 'cancelled' ? 'Cancelled' : 'Within scheduled time']].map(([label, value]) =>
            <div key={label} className="min-w-0"><dt className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">{label}</dt><dd className="mt-1 break-words font-medium text-foreground-800">{value}</dd></div>)}
        </dl>
        <p className="mt-3 text-xs text-foreground-500">Calendar status follows scheduled times and does not confirm whether the call is still live. Published evidence is shown independently.</p>
        {meeting.match !== 'matched' && <details className="mt-5 rounded-lg border border-background-200 bg-background-50 p-3 text-xs text-foreground-600"><summary className="cursor-pointer font-semibold">LMS booking link: {meeting.match === 'external' ? 'not linked' : 'needs review'}</summary><p className="mt-2 leading-5">This Microsoft calendar meeting is not linked to one confirmed LMS booking. This is a booking comparison notice; recordings, attendance and transcripts are checked separately using the verified meeting identity.</p></details>}
        {Boolean(meeting.cancellationSources?.length) && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-900">Cancellation source: {meeting.cancellationSources!.map(source => source === 'lms' ? 'LMS' : 'Microsoft').join(' + ')}{phase !== 'cancelled' ? ' · Microsoft still shows an active meeting; needs review.' : ''}</p>}
        </div>
        {qualityEnabled && <div hidden={selectedTab !== 'quality'}>
          <button type="button" onClick={() => { setReviewId(undefined); setQualityOpen(true); }}
            className={`${detailsStyles.quality} w-full text-left text-sm font-semibold`}>Quality Check<span className="mt-1 block text-xs font-normal">Choose a feedback form and complete a review for one learner</span></button>
          <MeetingQualityChecks meetingId={meeting.meetingId} refresh={qualityRefresh} onOpen={id => { setReviewId(id); setQualityOpen(true); }} onPreviewChange={setReportOpen} />
        </div>}
        <div hidden={selectedTab === 'overview' || selectedTab === 'quality'}>
        {canReview && phase !== 'upcoming' ? <SessionDetails eventKey={reference ? '' : meeting.eventKey!} reference={reference} category={meetingCategory(meeting)} timeZone={timeZone}
          occurrence={meeting.meetingId ? { id: meeting.meetingId, startsAt: meeting.startsAt, endsAt: meeting.endsAt, timeZone } : undefined}
          section={selectedTab} activeTab={evidenceTab} onTabChange={selectEvidence}
          analysisEventKey={meeting.eventKey || undefined} analysisContext={phase === 'ended' ? meeting.analysisContext : undefined} onPreviewChange={setReportOpen} />
          : <p className="mt-6 rounded-lg bg-primary-50 p-4 text-sm text-primary-800">{phase === 'upcoming' ? 'Recording and attendance checks start once the scheduled meeting begins. Published evidence can then be viewed before its scheduled end.' : 'A verified recording or attendance source is not available for this meeting yet.'}</p>}
        </div>
      </div>
    </aside>
    {qualityOpen && <Suspense fallback={<div role="status" className="fixed inset-0 z-[90] flex items-center justify-center bg-white/95 text-sm">Loading the quality form…</div>}>
      <QualityReviewDialog eventKey={reference ? '' : meeting.eventKey ?? ''} reference={reference} initialLearnerId={meeting.learnerIds.length === 1 ? meeting.learnerIds[0] : ''}
        meetingId={meeting.meetingId} meetingStartsAt={meeting.startsAt} meetingEndsAt={meeting.endsAt}
        reviewId={reviewId} timeZone={timeZone} onClose={() => setQualityOpen(false)} onSaved={() => { invalidateQualityReviews(); setQualityRefresh(value => value + 1); }} />
    </Suspense>}
  </div>, document.body);
}
