import { useCallback, useEffect, useRef, useState } from 'react';
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
import { adoptMigratedReviewBooking, bookMigratedReview, rescheduleMigratedReview, markReviewInstanceInProgressManually, openReviewInstanceForEvent, type ReviewInstanceFormDefinition } from '@/api/reviewInstances';
import { MonthlyCoachingCompletionModal } from '../meetings/MonthlyCoachingCompletionModal';
import { CoachMeetingArtifactsPanel } from '../shared/CoachMeetingArtifactsPanel';
import { MigratedMeetingIntelligence } from '../shared/MigratedMeetingIntelligence';
import ProgressReviewCompletionModal from '../shared/ProgressReviewCompletionModal';
import { ModernDatePicker, ModernDurationPicker, ScheduleFieldLabel, ScheduleTimeInput } from '../shared/ScheduleControls';
import { loadImportedReviewForBooking } from '../shared/importedReviewBooking';
import { useImportedMeetingJoin } from '../shared/useImportedMeetingJoin';
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
  const allowedPaths = ['/coach/meetings', '/coach/monthly-coaching', '/coach/progress-reviews', '/coach/reviews', '/coach/learner-case-file', '/coach/timetable'];
  return value && allowedPaths.some(path => value === path || value.startsWith(`${path}/`) || value.startsWith(`${path}?`)) ? value : null;
}

function isMeetingDetailEvent(event: CoachCalendarEvent) {
  return event.source === 'mcr'
    || event.source === 'catch-up'
    || event.source === 'student-support';
}

function meetingDisplayTitle(event: CoachCalendarEvent, isProgressReview: boolean) {
  const fallback = isProgressReview ? 'Progress Review' : 'Monthly Coaching Meeting';
  const title = event.title || fallback;
  const occurrence = event.occurrenceNumber ?? event.sequence;
  if (!['mcr', 'progress-review'].includes(event.source || '') || /\s#\d+$/i.test(title)) return title;
  if (occurrence == null) return `${title} — Manual Review`;
  return `${title} #${occurrence}`;
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
  const otherReviews = location.pathname.startsWith('/coach/reviews/');
  const listPath = otherReviews ? '/coach/reviews' : isProgressReview ? '/coach/progress-reviews' : '/coach/monthly-coaching';
  const returnTo = safeReturnTo((location.state as MeetingDetailLocationState | null)?.returnTo) || listPath;
  const backLabel = returnTo.startsWith('/coach/learner-case-file')
    ? 'Back to Learner Reviews'
    : returnTo.startsWith('/coach/timetable')
      ? 'Back to Timetable'
    : otherReviews ? 'Back to Review' : isProgressReview ? 'Back to Progress Reviews' : 'Back to Coaching Meetings';
  const [event, setEvent] = useState<CoachCalendarEvent | null>(null);
  const [ownerName, setOwnerName] = useState('Coach');
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(EMPTY_SCHEDULE_FORM);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [completionEvent, setCompletionEvent] = useState<CoachCalendarEvent | null>(null);
  const [importedReviewData, setImportedReview] = useState<ReviewInstanceFormDefinition | null>(null);
  const [loadedReviewKey, setLoadedReviewKey] = useState('');
  const [importedReviewReload, setImportedReviewReload] = useState(0);
  const [importedReviewLoading, setImportedReviewLoading] = useState(false);
  const [importedReviewError, setImportedReviewError] = useState<string | null>(null);
  const bookingInFlightRef = useRef(false);
  const importedRequestGeneration = useRef(0);

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
    fetchCoachCalendarEvents(controller.signal, {
      includeLiveSessions: false,
      includeSchedulerQueues: false,
    })
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

  // An imported Aptem review carries its own booking eligibility and its own
  // booking endpoint, neither of which is part of a calendar row. Reading it
  // here prepares exactly the form the Review workspace would, so the controls
  // below do not depend on which screen the coach happened to open first.
  const importedReviewId = event?.reviewSource === 'aptem'
    && (eventIdentity(event) === eventKey || event.reviewInstanceId === eventKey)
    ? event.formEventKey || eventIdentity(event) : '';
  const importedRequestKey = `${coach.email}:${coach.isViewingAsCoach}:${importedReviewId}`;
  // The server may resolve a legacy form key. Associate its response with the
  // request that loaded it, not an assumed equality with the calendar key.
  const importedReview = importedReviewId && loadedReviewKey === importedRequestKey ? importedReviewData : null;
  useEffect(() => {
    importedRequestGeneration.current += 1;
    setImportedReview(null);
    setLoadedReviewKey('');
    setImportedReviewError(null);
    setImportedReviewLoading(Boolean(importedReviewId));
    if (!importedReviewId) {
      return;
    }
    const controller = new AbortController();
    let active = true;
    loadImportedReviewForBooking(importedReviewId, {
      viewingAsCoach: coach.isViewingAsCoach,
      signal: controller.signal,
      onAdoptionError: err => {
        if (active) setImportedReviewError(err instanceof Error ? err.message : 'Unable to link the existing meeting. Retry below.');
      },
    })
      .then(definition => {
        if (!active) return;
        setImportedReview(definition);
        setLoadedReviewKey(importedRequestKey);
        if (!coach.isViewingAsCoach && definition.booking?.booked
          && ['scheduled', 'in-progress'].includes(definition.localStatus || '')) {
          setEvent(current => current ? {
            ...current,
            status: (definition.booking?.status || definition.localStatus || definition.instance.status) as CoachCalendarEvent['status'],
            calendarEventKey: definition.booking?.eventKey ?? current.calendarEventKey,
            meetingLink: definition.booking?.meetingLink ?? current.meetingLink,
            scheduledDate: definition.booking?.scheduledDate ?? current.scheduledDate,
            scheduledTime: definition.booking?.scheduledTime ?? current.scheduledTime,
            durationMinutes: definition.booking?.durationMinutes ?? current.durationMinutes,
            syncState: definition.booking?.syncState as CoachCalendarEvent['syncState'],
          } : current);
        }
        if (definition.booking?.canReschedule) {
          setScheduleForm({
            date: definition.booking.scheduledDate || definition.instance.targetDate,
            time: definition.booking.scheduledTime || '09:00',
            durationMinutes: definition.booking.durationMinutes || 60,
          });
        }
      })
      .catch(err => {
        if (active) setImportedReviewError(err instanceof Error ? err.message : 'Unable to load this review. Reopen the details to try again.');
      })
      .finally(() => { if (active) setImportedReviewLoading(false); });
    return () => { active = false; controller.abort(); importedRequestGeneration.current += 1; };
  }, [importedReviewId, importedRequestKey, coach.isViewingAsCoach, importedReviewReload]);

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

  // The imported review's own booking action. It keeps the Aptem review's
  // identity as the booking key, so the meeting this creates is the same one
  // the Review workspace would have created, never a second appointment.
  const bookImportedReview = async (useExistingMeeting: boolean) => {
    const booking = importedReview?.booking;
    if (!event || !importedReview || !booking || bookingInFlightRef.current) return;
    if (!(useExistingMeeting ? booking.canAttach : booking.canBook || booking.canReschedule)) return;
    bookingInFlightRef.current = true;
    const requestGeneration = importedRequestGeneration.current;
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const slot = {
        scheduledDate: useExistingMeeting ? booking.scheduledDate || '' : scheduleForm.date,
        scheduledTime: useExistingMeeting ? booking.scheduledTime || '' : scheduleForm.time,
        durationMinutes: useExistingMeeting ? booking.durationMinutes || 60 : scheduleForm.durationMinutes,
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      };
      const updated = useExistingMeeting
        ? await adoptMigratedReviewBooking(importedReview.instance.id)
        : booking.canReschedule
        ? await rescheduleMigratedReview(importedReview.instance.id, slot, booking)
        : await bookMigratedReview(importedReview.instance.id, slot);
      if (requestGeneration !== importedRequestGeneration.current) return;
      setImportedReview(updated);
      setImportedReviewError(null);
      if (updated.booking?.scheduledDate && updated.booking.scheduledTime) {
        setScheduleForm({ date: updated.booking.scheduledDate, time: updated.booking.scheduledTime,
          durationMinutes: updated.booking.durationMinutes || 60 });
      }
      setEvent(current => (current ? {
        ...current,
        status: (updated.booking?.status || updated.localStatus || updated.instance.status) as CoachCalendarEvent['status'],
        calendarEventKey: updated.booking?.eventKey ?? current.calendarEventKey,
        syncState: updated.booking?.syncState as CoachCalendarEvent['syncState'],
        scheduledDate: updated.booking?.scheduledDate ?? current.scheduledDate,
        scheduledTime: updated.booking?.scheduledTime ?? current.scheduledTime,
        durationMinutes: updated.booking?.durationMinutes ?? current.durationMinutes,
        meetingLink: updated.booking?.meetingLink ?? current.meetingLink,
      } : current));
      if (booking.canReschedule && !useExistingMeeting) setActionNotice('Meeting rescheduled.');
    } catch (err) {
      if (requestGeneration === importedRequestGeneration.current) {
        setActionError(err instanceof Error ? err.message : `Unable to book this ${isProgressReview ? 'review' : 'meeting'}.`);
      }
    } finally {
      bookingInFlightRef.current = false;
      setBusy(false);
    }
  };

  const joinMeeting = useImportedMeetingJoin({
    contextKey: `${coach.email}:${coach.isViewingAsCoach}:${eventKey}`, readOnly: coach.isViewingAsCoach,
    onError: setActionError,
    onStarted: () => setEvent(current => current ? { ...current, status: 'in-progress' } : current),
  });
  const handleJoin = () => {
    if (!event) return;
    setActionError(null);
    joinMeeting(event);
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
    if (event.reviewSource === 'aptem' && eventIdentity(event).startsWith('imported-review:')) {
      navigate(reviewInstancePath(eventIdentity(event)), {
        state: reviewInstanceRouteState(event, `${location.pathname}${location.search}`),
      });
      return;
    }
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
  // Unbooked imported calendar rows carry the target date in scheduledDate.
  // Keep that date for planning, but do not present it as a booked appointment.
  const scheduledDate = event?.reviewSource === 'aptem' && event.status === 'not-scheduled'
    ? null
    : event?.scheduledDate;
  const canEditBooking = event?.reviewSource !== 'aptem' && (event?.status === 'not-scheduled' || event?.status === 'scheduled');
  // Aptem bookings are authorized by the imported review itself, not by the
  // calendar row, and an admin reading another workspace never books.
  const importedBooking = event?.reviewSource === 'aptem' ? importedReview?.booking : undefined;
  const usesMigratedIntelligence = event?.reviewSource === 'aptem'
    && ['mcr', 'progress-review'].includes(event.source || '')
    && event.importedReviewType?.trim().toLowerCase() !== 'personal support plan';
  const migratedIntelligenceReady = importedReview?.migratedForm
    && ['aptem_mcm', 'aptem_progress_review'].includes(importedReview.template.reviewTypeCode || '')
    && importedBooking?.eventKey && importedBooking.syncState === 'synced';
  const canBookImported = Boolean(!coach.isViewingAsCoach && importedBooking?.canBook);
  const canRescheduleImported = Boolean(!coach.isViewingAsCoach && importedBooking?.canReschedule);
  const canAttachImported = Boolean(!coach.isViewingAsCoach && importedBooking?.canAttach);
  const importedBookingConflict = Boolean(importedBooking?.conflict);
  const showScheduleFields = canEditBooking || canBookImported || canRescheduleImported;
  const showMeetingActions = canEditBooking || event?.status === 'in-progress' || (event?.reviewSource === 'aptem' && event.status === 'scheduled')
    || canBookImported || canAttachImported || importedBookingConflict;
  const bookingPanelTitle = event?.status === 'not-scheduled'
    ? `Schedule ${isProgressReview ? 'Review' : 'Meeting'}`
    : event?.status === 'in-progress'
      ? 'Meeting Actions'
      : `Manage ${isProgressReview ? 'Review' : 'Meeting'}`;
 const canOpenReviewFormFromHeader = Boolean(
    event?.reviewTemplateId || event?.reviewSource === 'aptem',
 );
  const reviewFormHeaderLabel = event?.status === 'completed'
    ? 'View Form'
    : event?.status === 'awaiting-signature'
      ? 'Sign Form'
      : 'Open Form';
  const showBookingNotes = Boolean(
    event && !isProgressReview && !['mcr', 'progress-review', 'review'].includes(event.source || ''),
  );

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle={isProgressReview ? 'Review Details' : 'Meeting Details'} pageSubtitle={otherReviews ? 'Learner review workspace' : isProgressReview ? 'Progress review workspace' : 'Monthly coaching meeting workspace'} userName={ownerName} userRole="Progress Coach">
      <PageContainer>
        {loading ? <Panel><RowsSkeleton rows={6} /></Panel> : null}
        {!loading && error ? <EmptyState variant="error" title={`Unable to load this ${isProgressReview ? 'review' : 'meeting'}.`} description={error} /> : null}

        {!loading && !error && event ? (
          <>
            <PageHeader
              title={event.learner || (isProgressReview ? 'Progress Review' : 'Coaching Meeting')}
              description={meetingDisplayTitle(event, isProgressReview)}
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

            {importedReviewError ? <Panel>
              <p role="alert" className="text-sm text-red-700">{importedReviewError}</p>
              <RowAction label="Refresh booking" icon="ri-refresh-line" disabled={importedReviewLoading || busy}
                onClick={() => setImportedReviewReload(value => value + 1)} />
            </Panel> : null}

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
                {showScheduleFields ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div><ScheduleFieldLabel>Meeting date</ScheduleFieldLabel><ModernDatePicker value={scheduleForm.date} onChange={(value) => setScheduleForm(current => ({ ...current, date: value }))} /></div>
                    <div><ScheduleFieldLabel>Start time</ScheduleFieldLabel><ScheduleTimeInput value={scheduleForm.time} onChange={(value) => setScheduleForm(current => ({ ...current, time: value }))} /></div>
                    <div><ScheduleFieldLabel>Duration</ScheduleFieldLabel><ModernDurationPicker value={scheduleForm.durationMinutes} onChange={(durationMinutes) => setScheduleForm(current => ({ ...current, durationMinutes }))} /></div>
                  </div>
                ) : null}
                {importedBookingConflict ? (
                  <p role="alert" className="mt-4 text-[12px] font-semibold text-red-700">
                    This review has a conflicting calendar association. Ask an administrator to resolve it before booking.
                  </p>
                ) : null}
                <div className={cn('flex flex-wrap items-center gap-2', showScheduleFields && 'mt-5 border-t border-foreground-100 pt-4')}>
                  {canEditBooking ? <RowAction label={event.status === 'scheduled' ? 'Reschedule' : 'Schedule'} icon="ri-calendar-check-line" emphasis="primary" disabled={busy} onClick={() => { void handleSchedule(); }} /> : null}
                  {canBookImported || canRescheduleImported ? <RowAction label={canRescheduleImported ? 'Reschedule' : isProgressReview ? 'Book Review' : 'Book Meeting'} icon="ri-calendar-check-line" emphasis="primary" disabled={busy || !scheduleForm.date || !scheduleForm.time} onClick={() => { void bookImportedReview(false); }} /> : null}
                  {canAttachImported ? <RowAction label="Retry linking meeting" icon="ri-link" disabled={busy} onClick={() => { void bookImportedReview(true); }} /> : null}
                  {event.reviewSource === 'aptem' ? <RowAction label="Open Review" icon="ri-file-list-3-line" emphasis="primary" disabled={busy} onClick={() => { void openReviewWorkflow(false); }} /> : null}
                  {(event.status === 'scheduled' || event.status === 'in-progress') && url ? <RowAction label="Join Meeting" icon="ri-video-on-line" emphasis="meeting" disabled={busy} onClick={() => { void handleJoin(); }} /> : null}
                  {event.status === 'scheduled' && event.reviewTemplateId ? <RowAction label="Mark In Progress" icon="ri-play-circle-line" disabled={busy} onClick={() => { void markReviewInProgress(); }} /> : null}
                  {/* A catch-up has no coaching form; it must never open the Monthly Coaching record. */}
                  {event.status === 'in-progress' && event.source !== 'catch-up' ? <RowAction label="Form" icon="ri-file-list-3-line" disabled={busy} onClick={() => { void openReviewWorkflow(false); }} /> : null}
                </div>
              </Panel>
            ) : null}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
              <Panel className="bg-white">
                <SectionHeading icon="ri-information-line" title={`${isProgressReview ? 'Review' : 'Meeting'} overview`} />
                <dl className="mt-4 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  <DetailItem label="Target date" value={formatDateLabel(event.targetDate)} icon="ri-flag-line" />
                  <DetailItem label="Scheduled date" value={scheduledDate ? formatDateLabel(scheduledDate) : 'Not scheduled'} icon="ri-calendar-check-line" />
                  <DetailItem label="Time" value={formatTimeLabel(event)} icon="ri-time-line" />
                  <DetailItem label="Provider" value={providerLabel(event)} icon="ri-video-chat-line" />
                </dl>
                <div className="mt-4 border-t border-foreground-100 pt-4">
                  <p className="text-[11px] font-semibold uppercase text-foreground-400">Reference</p>
                  <p className="mt-1 break-all font-mono text-[11px] leading-5 text-foreground-600">#{event.occurrenceNumber || event.sequence || '--'} - {eventIdentity(event)}</p>
                </div>
              </Panel>

              {showBookingNotes ? (
                <Panel className="bg-white">
                  <SectionHeading icon="ri-sticky-note-line" title="Notes" />
                  <p className="mt-4 text-[13px] leading-6 text-foreground-600">
                    {event.notes || 'No notes have been added to this meeting.'}
                  </p>
                </Panel>
              ) : null}
            </div>

            {url ? (
              usesMigratedIntelligence ? migratedIntelligenceReady && importedReview ? (
                <MigratedMeetingIntelligence
                  key={importedReview.instance.id}
                  instanceId={importedReview.instance.id}
                  family={importedReview.template.reviewTypeCode || ''}
                  status={importedReview.localStatus || importedReview.instance.status}
                  viewAs={coach.isViewingAsCoach}
                  readOnly={importedReview.readOnly || importedReview.templateSync?.status === 'conflict'}
                  meetingLink={importedBooking?.meetingLink}
                  bound={Boolean(importedReview.summaryBinding?.fieldKey)}
                  savedBinding={importedReview.summaryBinding}
                  showBoundSummary
                  checkBlocked={busy}
                  onCheckComplete={result => {
                    if (result.event?.status === 'in-progress') {
                      handleArtifactsStatusChange('in-progress');
                      setImportedReview(current => current ? { ...current, localStatus: 'in-progress',
                        instance: { ...current.instance, status: 'in-progress' } } : current);
                    }
                  }}
                />
              ) : (
                <Panel className="bg-white">
                  <p role="status" className="text-sm text-foreground-600">
                    {importedReview
                      ? 'Session checks require an available review form and a synced Teams booking. Open the review form to check its availability.'
                      : importedReviewError ? 'Refresh the booking to load this review’s meeting resources.' : 'Loading review meeting resources…'}
                  </p>
                </Panel>
              ) : <CoachMeetingArtifactsPanel event={event} onEventStatusChange={handleArtifactsStatusChange} />
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
