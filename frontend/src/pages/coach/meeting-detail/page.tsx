import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { AppIcon } from '@/components/feature/AppIcon';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RowAction } from '@/components/ui/ActionRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { cn } from '@/lib/cn';
import { statusTone } from '@/lib/statusTone';
import { roleNavMap } from '@/mocks/navigation';
import type { ProgressReviewResponses } from '@/pages/shared/progressReviewForm';
import { markReviewInstanceInProgressManually, openReviewInstanceForEvent } from '@/api/reviewInstances';
import { MonthlyCoachingCompletionModal } from '../meetings/MonthlyCoachingCompletionModal';
import { CoachMeetingArtifactsPanel } from '../shared/CoachMeetingArtifactsPanel';
import ProgressReviewCompletionModal from '../shared/ProgressReviewCompletionModal';
import { ModernDatePicker, ModernDurationPicker, ScheduleFieldLabel, ScheduleTimeInput } from '../shared/ScheduleControls';
import { reviewInstancePath, reviewInstanceRouteState } from '../shared/reviewInstanceNavigation';
import {
  type CoachCalendarEvent,
  type ScheduleFormState,
  eventDisplayDate,
  eventIdentity,
  fetchCoachCalendarEvents,
  formatDateLabel,
  formatTimeLabel,
  meetingUrl,
  runCoachCalendarAction,
  scheduleCoachCalendarEvent,
  scheduleDefaults,
  statusLabel,
} from '../shared/calendarEvents';

const coachNav = roleNavMap.coach;
const EMPTY_SCHEDULE_FORM: ScheduleFormState = { date: '', time: '09:00', durationMinutes: 60 };

interface MeetingDetailLocationState {
  returnTo?: string;
}

function safeReturnTo(value?: string) {
  const allowedPaths = ['/coach/meetings', '/coach/monthly-coaching', '/coach/progress-reviews', '/coach/learner-case-file', '/coach/timetable'];
  return value && allowedPaths.some(path => value === path || value.startsWith(`${path}/`) || value.startsWith(`${path}?`)) ? value : null;
}

function isMeetingDetailEvent(event: CoachCalendarEvent) {
  return event.source === 'mcr'
    || event.source === 'catch-up'
    || event.source === 'student-support';
}

function HeaderFact({ icon, text }: { icon: string; text: string }) {
  return (
    <span className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-primary-100 bg-white/80 px-2.5 text-[12px] font-medium text-foreground-700">
      <AppIcon className={`${icon} text-primary-600`}></AppIcon>
      {text}
    </span>
  );
}

function MeetingProgress({ status }: { status: CoachCalendarEvent['status'] }) {
  const steps = [
    { label: 'Planned', icon: 'ri-flag-line' },
    { label: 'Scheduled', icon: 'ri-calendar-check-line' },
    { label: 'In progress', icon: 'ri-play-circle-line' },
    { label: 'Sign-off', icon: 'ri-quill-pen-line' },
    { label: 'Complete', icon: 'ri-checkbox-circle-line' },
  ];
  const activeStep = status === 'completed' || status === 'confirmed'
    ? 4
    : status === 'awaiting-signature'
      ? 3
      : status === 'in-progress'
        ? 2
        : status === 'scheduled'
          ? 1
          : 0;

  return (
    <section className="rounded-xl border border-foreground-100 bg-white px-4 py-4 shadow-sm" aria-label="Meeting progress">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-foreground-900">Meeting progress</h2>
        <span className="text-[11px] font-medium text-foreground-400">Step {activeStep + 1} of {steps.length}</span>
      </div>
      <ol className="grid grid-cols-5">
        {steps.map((step, index) => {
          const reached = index <= activeStep;
          const current = index === activeStep;
          return (
            <li key={step.label} className="relative flex min-w-0 flex-col items-center text-center">
              {index > 0 ? <span className={cn('absolute right-1/2 top-4 h-0.5 w-full', index <= activeStep ? 'bg-primary-500' : 'bg-foreground-100')}></span> : null}
              <span className={cn(
                'relative z-10 flex h-8 w-8 items-center justify-center rounded-full border text-[13px]',
                current
                  ? 'border-primary-600 bg-primary-600 text-white shadow-sm ring-4 ring-primary-50'
                  : reached
                    ? 'border-primary-200 bg-primary-50 text-primary-700'
                    : 'border-foreground-200 bg-white text-foreground-400',
              )}>
                <AppIcon className={step.icon}></AppIcon>
              </span>
              <span className={cn('mt-2 w-full px-1 text-[10px] font-semibold sm:text-[11px]', reached ? 'text-foreground-800' : 'text-foreground-400')}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function bookingContext(event: CoachCalendarEvent) {
  if (event.status === 'not-scheduled') return `Target date ${formatDateLabel(event.targetDate)} - Teams link will be created with the booking.`;
  if (event.status === 'in-progress') return 'The meeting is active. Meeting access and the review form remain available.';
  if (event.status === 'awaiting-signature') return 'The review is awaiting the required sign-off.';
  return `${formatDateLabel(event.scheduledDate || eventDisplayDate(event))} - ${formatTimeLabel(event)} - ${event.durationMinutes || 60} minutes`;
}

function providerLabel(event: CoachCalendarEvent) {
  const values = [event.platform, event.meetingProvider];
  return values.find(value => value && value !== '--') || 'Microsoft Teams';
}

function SectionHeading({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
        <AppIcon className={icon}></AppIcon>
      </span>
      <h2 className="text-[14px] font-semibold text-foreground-900">{title}</h2>
    </div>
  );
}

function DetailItem({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 border-b border-foreground-100 py-3">
      <AppIcon className={`${icon} mt-0.5 shrink-0 text-primary-500`}></AppIcon>
      <div className="min-w-0">
        <dt className="text-[11px] font-semibold uppercase text-foreground-400">{label}</dt>
        <dd className="mt-0.5 break-words text-[13px] font-semibold text-foreground-800">{value}</dd>
      </div>
    </div>
  );
}

export default function CoachMeetingDetail() {
  const coach = useCoachIdentity();
  const navigate = useNavigate();
  const location = useLocation();
  const { eventKey = '' } = useParams();
  const isProgressReview = location.pathname.startsWith('/coach/progress-reviews/')
    || location.pathname.startsWith('/coach/reviews/');
  const listPath = isProgressReview ? '/coach/progress-reviews' : '/coach/monthly-coaching';
  const returnTo = safeReturnTo((location.state as MeetingDetailLocationState | null)?.returnTo) || listPath;
  const backLabel = returnTo.startsWith('/coach/learner-case-file')
    ? 'Back to Learner Reviews'
    : returnTo.startsWith('/coach/timetable')
      ? 'Back to Timetable'
    : isProgressReview ? 'Back to Progress Reviews' : 'Back to Coaching Meetings';
  const [event, setEvent] = useState<CoachCalendarEvent | null>(null);
  const [ownerName, setOwnerName] = useState('Coach');
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(EMPTY_SCHEDULE_FORM);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [completionEvent, setCompletionEvent] = useState<CoachCalendarEvent | null>(null);

  useEffect(() => {
    if (!coach.isInitialized) return;
    if (!coach.email) {
      setError('Coach access is required to load this meeting.');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchCoachCalendarEvents(controller.signal)
      .then((data) => {
        const selected = (data.events || []).find(item => {
          const identityMatches = item.reviewInstanceId === eventKey || eventIdentity(item) === eventKey;
          if (!identityMatches) return false;
          return isProgressReview
            ? (item.type === 'review' || item.source === 'progress-review' || item.source === 'review' || Boolean(item.reviewTemplateId))
            : isMeetingDetailEvent(item);
        });
        if (!selected) throw new Error(`This ${isProgressReview ? 'review' : 'coaching meeting'} could not be found.`);
        setEvent(selected);
        setScheduleForm(scheduleDefaults(selected));
        setActionNotice(selected.syncWarning || null);
        setOwnerName(data.owner?.name || coach.name);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setEvent(null);
        setError(err instanceof Error ? err.message : `Unable to load this ${isProgressReview ? 'review' : 'coaching meeting'}.`);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [coach.email, coach.isInitialized, coach.name, eventKey, isProgressReview]);

  const updateEvent = (updatedEvent: CoachCalendarEvent) => {
    setEvent(updatedEvent);
    setScheduleForm(scheduleDefaults(updatedEvent));
  };

  const handleArtifactsStatusChange = useCallback((status: string) => {
    setEvent(current => current && current.status !== status
      ? { ...current, status: status as CoachCalendarEvent['status'] }
      : current);
  }, []);

  const openEventInCalendar = () => {
    if (!event) return;
    navigate('/coach/timetable', {
      state: {
        focusEvent: {
          eventKey: eventIdentity(event),
          source: event.source,
          date: eventDisplayDate(event),
          title: event.title,
          scheduledTime: event.scheduledTime,
        },
      },
    });
  };

  const handleSchedule = async () => {
    if (!event) return;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await scheduleCoachCalendarEvent(event, scheduleForm);
      updateEvent(data.event);
      if (data.warning) setActionNotice(data.warning);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Unable to schedule ${isProgressReview ? 'review' : 'meeting'}.`);
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = () => {
    if (!event) return;
    const url = meetingUrl(event);
    if (!url) {
      setActionError('This meeting does not have a Teams link yet.');
      return;
    }
    setActionError(null);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleCompleteMeeting = async (responses: ProgressReviewResponses) => {
    if (!completionEvent) return;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const result = await runCoachCalendarAction(completionEvent, 'complete', { reviewResponses: responses });
      updateEvent(result.event);
      if (result.warning) setActionNotice(result.warning);
      setCompletionEvent(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Unable to complete ${isProgressReview ? 'progress review' : 'monthly coaching meeting'}.`);
    } finally {
      setBusy(false);
    }
  };

  const openReviewWorkflow = async (manualOverride = false) => {
    if (!event) return;
    if (event.reviewInstanceId) {
      navigate(reviewInstancePath(event.reviewInstanceId), {
        state: reviewInstanceRouteState(event, `${location.pathname}${location.search}`),
      });
      return;
    }
    if (manualOverride && !event.reviewTemplateId) {
      setActionError(null);
      await Swal.fire({
        icon: 'warning',
        title: `Legacy ${isProgressReview ? 'review' : 'meeting'}`,
        text: `This ${isProgressReview ? 'review' : 'meeting'} was created before Curriculum review linkage and cannot be moved to In Progress. Reconcile it with a Curriculum Review first.`,
        confirmButtonText: 'OK',
        confirmButtonColor: '#6d28d9',
      });
      return;
    }
    if (!event.reviewTemplateId && !manualOverride) {
      setCompletionEvent(event);
      return;
    }

    setBusy(true);
    setActionError(null);
    try {
      const { instanceId } = await openReviewInstanceForEvent(eventIdentity(event));
      const linkedEvent = { ...event, reviewInstanceId: instanceId };
      updateEvent(linkedEvent);
      navigate(reviewInstancePath(instanceId), {
        state: reviewInstanceRouteState(linkedEvent, `${location.pathname}${location.search}`),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to open this review.';
      if (manualOverride && message === 'This event is not a Curriculum review.') {
        setActionError(null);
        await Swal.fire({
          icon: 'warning',
          title: `Legacy ${isProgressReview ? 'review' : 'meeting'}`,
          text: `This ${isProgressReview ? 'review' : 'meeting'} is not linked to a Curriculum Review and cannot be moved to In Progress until it has been reconciled.`,
          confirmButtonText: 'OK',
          confirmButtonColor: '#6d28d9',
        });
      } else {
        setActionError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const markReviewInProgress = async () => {
    if (!event) return;
    if (!event.reviewTemplateId) {
      await openReviewWorkflow(true);
      return;
    }
    const confirmation = await Swal.fire({
      icon: 'question',
      title: 'Mark review in progress?',
      text: 'Use this when the meeting has started but Teams attendance cannot confirm it automatically.',
      showCancelButton: true,
      confirmButtonText: 'OK',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#6d28d9',
    });
    if (!confirmation.isConfirmed) return;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const instanceId = event.reviewInstanceId || (await openReviewInstanceForEvent(eventIdentity(event))).instanceId;
      const updated = await markReviewInstanceInProgressManually(instanceId, {
        reasonCode: 'coach-confirmed-live-start',
      });
      updateEvent({ ...event, reviewInstanceId: instanceId, status: updated.instance.status as CoachCalendarEvent['status'] });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to mark this review in progress.');
    } finally {
      setBusy(false);
    }
  };

  const url = event ? meetingUrl(event) : '';
  const canEditBooking = event?.status === 'not-scheduled' || event?.status === 'scheduled';
  const showMeetingActions = canEditBooking || event?.status === 'in-progress';
  const bookingPanelTitle = event?.status === 'not-scheduled'
    ? `Schedule ${isProgressReview ? 'Review' : 'Meeting'}`
    : event?.status === 'in-progress'
      ? 'Meeting Actions'
      : `Manage ${isProgressReview ? 'Review' : 'Meeting'}`;
 const canOpenReviewFormFromHeader = Boolean(
    event?.reviewTemplateId,
 );
  const reviewFormHeaderLabel = event?.status === 'completed'
    ? 'View Form'
    : event?.status === 'awaiting-signature'
      ? 'Sign Form'
      : 'Open Form';

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle={isProgressReview ? 'Review Details' : 'Meeting Details'} pageSubtitle={isProgressReview ? 'Progress review workspace' : 'Monthly coaching meeting workspace'} userName={ownerName} userRole="Progress Coach">
      <PageContainer>
        {loading ? <Panel><RowsSkeleton rows={6} /></Panel> : null}
        {!loading && error ? <EmptyState variant="error" title={`Unable to load this ${isProgressReview ? 'review' : 'meeting'}.`} description={error} /> : null}

        {!loading && !error && event ? (
          <>
            <PageHeader
              title={event.learner || (isProgressReview ? 'Progress Review' : 'Coaching Meeting')}
              description={event.title || (isProgressReview ? 'Progress Review' : 'Monthly Coaching Meeting')}
              icon="ri-calendar-event-line"
              backTo={{ to: returnTo, label: backLabel }}
              meta={(
                <>
                  <StatusBadge tone={statusTone(event.status)} label={statusLabel(event.status)} size="sm" />
                  <HeaderFact icon="ri-calendar-line" text={formatDateLabel(eventDisplayDate(event))} />
                  <HeaderFact icon="ri-time-line" text={formatTimeLabel(event)} />
                  <HeaderFact icon="ri-book-open-line" text={event.programme || '--'} />
                  <HeaderFact icon="ri-group-line" text={event.group || event.cohort || '--'} />
                  <HeaderFact icon="ri-video-chat-line" text={providerLabel(event)} />
                </>
              )}
              actions={(
                <>
                  <RowAction label="Calendar" icon="ri-calendar-schedule-line" emphasis="calendar" onClick={openEventInCalendar} />
                  {canOpenReviewFormFromHeader ? <RowAction label={reviewFormHeaderLabel} icon="ri-file-list-3-line" emphasis="primary" disabled={busy} onClick={() => { void openReviewWorkflow(false); }} /> : null}
                  {url ? <RowAction label="Join Meeting" icon="ri-video-on-line" emphasis="meeting" disabled={busy} onClick={() => { void handleJoin(); }} /> : null}
                </>
              )}
            />

            <MeetingProgress status={event.status} />

            {(actionError || actionNotice) ? (
              <div className={cn('flex items-start gap-2 rounded-lg border px-4 py-3 text-[12px] font-semibold', actionError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800')}>
                <AppIcon className={actionError ? 'ri-error-warning-line mt-0.5' : 'ri-information-line mt-0.5'}></AppIcon>
                <span>{actionError || actionNotice}</span>
              </div>
            ) : null}

            {showMeetingActions ? (
              <Panel className="border-primary-200/80 bg-white shadow-sm">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-foreground-100 pb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase text-primary-600">Microsoft Teams booking</p>
                    <h2 className="mt-1 text-[16px] font-semibold text-foreground-900">{bookingPanelTitle}</h2>
                    <p className="mt-1 text-[12px] text-foreground-500">{bookingContext(event)}</p>
                  </div>
                  <StatusBadge tone={statusTone(event.status)} label={statusLabel(event.status)} size="sm" />
                </div>
                {canEditBooking ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div><ScheduleFieldLabel>Meeting date</ScheduleFieldLabel><ModernDatePicker value={scheduleForm.date} onChange={(value) => setScheduleForm(current => ({ ...current, date: value }))} /></div>
                    <div><ScheduleFieldLabel>Start time</ScheduleFieldLabel><ScheduleTimeInput value={scheduleForm.time} onChange={(value) => setScheduleForm(current => ({ ...current, time: value }))} /></div>
                    <div><ScheduleFieldLabel>Duration</ScheduleFieldLabel><ModernDurationPicker value={scheduleForm.durationMinutes} onChange={(durationMinutes) => setScheduleForm(current => ({ ...current, durationMinutes }))} /></div>
                  </div>
                ) : null}
                <div className={cn('flex flex-wrap items-center gap-2', canEditBooking && 'mt-5 border-t border-foreground-100 pt-4')}>
                  {canEditBooking ? <RowAction label={event.status === 'scheduled' ? 'Reschedule' : 'Schedule'} icon="ri-calendar-check-line" emphasis="primary" disabled={busy} onClick={() => { void handleSchedule(); }} /> : null}
                  {(event.status === 'scheduled' || event.status === 'in-progress') && url ? <RowAction label="Join Meeting" icon="ri-video-on-line" emphasis="meeting" disabled={busy} onClick={() => { void handleJoin(); }} /> : null}
                  {event.status === 'scheduled' && event.reviewTemplateId ? <RowAction label="Mark In Progress" icon="ri-play-circle-line" disabled={busy} onClick={() => { void markReviewInProgress(); }} /> : null}
                  {event.status === 'in-progress' ? <RowAction label="Form" icon="ri-file-list-3-line" disabled={busy} onClick={() => { void openReviewWorkflow(false); }} /> : null}
                </div>
              </Panel>
            ) : null}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
              <Panel className="bg-white">
                <SectionHeading icon="ri-information-line" title={`${isProgressReview ? 'Review' : 'Meeting'} overview`} />
                <dl className="mt-4 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  <DetailItem label="Target date" value={formatDateLabel(event.targetDate)} icon="ri-flag-line" />
                  <DetailItem label="Scheduled date" value={event.scheduledDate ? formatDateLabel(event.scheduledDate) : 'Not scheduled'} icon="ri-calendar-check-line" />
                  <DetailItem label="Time" value={formatTimeLabel(event)} icon="ri-time-line" />
                  <DetailItem label="Provider" value={providerLabel(event)} icon="ri-video-chat-line" />
                </dl>
                <div className="mt-4 border-t border-foreground-100 pt-4">
                  <p className="text-[11px] font-semibold uppercase text-foreground-400">Reference</p>
                  <p className="mt-1 break-all font-mono text-[11px] leading-5 text-foreground-600">#{event.occurrenceNumber || event.sequence || '--'} - {eventIdentity(event)}</p>
                </div>
              </Panel>

              <Panel className="bg-white">
                <SectionHeading icon="ri-sticky-note-line" title="Notes" />
                <p className="mt-4 text-[13px] leading-6 text-foreground-600">
                  {event.notes || `No notes have been added to this ${isProgressReview ? 'review' : 'meeting'}.`}
                </p>
              </Panel>
            </div>

            {url ? (
              <CoachMeetingArtifactsPanel event={event} onEventStatusChange={handleArtifactsStatusChange} />
            ) : (
              <Panel className="bg-white">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-500">
                      <AppIcon className="ri-folder-video-line text-[18px]"></AppIcon>
                    </span>
                    <div>
                      <h2 className="text-[14px] font-semibold text-foreground-900">Meeting resources</h2>
                      <p className="mt-1 text-[12px] leading-5 text-foreground-500">Attendance, recording, transcript and recap become available after the Teams meeting is scheduled and processed.</p>
                    </div>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-foreground-200 bg-background-100 px-2.5 py-1 text-[11px] font-semibold text-foreground-600">
                    <AppIcon className="ri-time-line"></AppIcon>
                    Awaiting booking
                  </span>
                </div>
              </Panel>
            )}

            {completionEvent && !completionEvent.reviewInstanceId ? (
              isProgressReview ? (
                <ProgressReviewCompletionModal
                  key={eventIdentity(completionEvent)}
                  event={completionEvent}
                  busy={busy}
                  error={actionError}
                  onClose={() => { if (!busy) setCompletionEvent(null); }}
                  onSubmit={handleCompleteMeeting}
                />
              ) : (
                <MonthlyCoachingCompletionModal
                  key={eventIdentity(completionEvent)}
                  event={completionEvent}
                  busy={busy}
                  error={actionError}
                  onClose={() => { if (!busy) setCompletionEvent(null); }}
                  onSubmit={handleCompleteMeeting}
                />
              )
            ) : null}

          </>
        ) : null}
      </PageContainer>
    </WorkspaceShell>
  );
}
