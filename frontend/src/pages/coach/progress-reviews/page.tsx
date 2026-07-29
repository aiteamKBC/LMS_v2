import { useEffect, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import {
  PROGRESS_REVIEW_SECTIONS,
  REQUIRED_PROGRESS_REVIEW_RESPONSE_IDS,
  type ProgressReviewResponses,
} from '@/pages/shared/progressReviewForm';
import {
  type CalendarAction,
  type CoachCalendarEvent,
  type ScheduleFormState,
  avatarClass,
  canJoinMeeting,
  eventDisplayDate,
  eventIdentity,
  eventPeriodLabel,
  fetchCoachCalendarEvents,
  formatDateLabel,
  formatTimeLabel,
  isAtRiskProgressReview,
  isAwaitingSignatureEvent,
  isDueSoonEvent,
  isEventThisMonth,
  isInProgressEvent,
  isScheduledEvent,
  initialsFor,
  isCompletedEvent,
  meetingUrl,
  needsScheduling,
  runCoachCalendarAction,
  scheduleCoachCalendarEvent,
  scheduleDefaults,
  sortEvents,
  statusLabel,
  statusPillClass,
} from '../shared/calendarEvents';

const coachNav = roleNavMap.coach;

type ReviewTab = 'this-month' | 'overdue' | 'due-soon' | 'needs-schedule' | 'scheduled' | 'in-progress' | 'awaiting-signature' | 'completed' | 'all';

const FILTER_COPY: Record<ReviewTab, { label: string; description: string }> = {
  'this-month': {
    label: 'This Month',
    description: 'Progress reviews with a target or scheduled date inside the current month, excluding completed reviews.',
  },
  overdue: {
    label: 'Overdue',
    description: 'Progress reviews where the target date has passed and the review is still not scheduled.',
  },
  'due-soon': {
    label: 'Due Soon',
    description: 'Progress reviews not scheduled yet and due within the next 14 days.',
  },
  'needs-schedule': {
    label: 'Not Scheduled',
    description: 'Progress reviews that still need a first calendar booking.',
  },
  scheduled: {
    label: 'Scheduled',
    description: 'Progress reviews that are booked and waiting to start.',
  },
  'in-progress': {
    label: 'In Progress',
    description: 'Progress reviews that have already been started by the coach.',
  },
  'awaiting-signature': {
    label: 'Awaiting Signature',
    description: 'Progress reviews completed by the coach and waiting for the line manager signature.',
  },
  completed: {
    label: 'Completed',
    description: 'Progress reviews marked as completed or confirmed.',
  },
  all: {
    label: 'All',
    description: 'Every generated progress review for this coach across the learner programme dates.',
  },
};

const EMPTY_SCHEDULE_FORM: ScheduleFormState = {
  date: '',
  time: '09:00',
  durationMinutes: 60,
};

const REVIEWS_PER_PAGE = 10;

export default function CoachProgressReviews() {
  const [tab, setTab] = useState<ReviewTab>('this-month');
  const [currentPage, setCurrentPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [events, setEvents] = useState<CoachCalendarEvent[]>([]);
  const [ownerName, setOwnerName] = useState('Med Maher');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(EMPTY_SCHEDULE_FORM);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [completionEvent, setCompletionEvent] = useState<CoachCalendarEvent | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const loadReviews = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchCoachCalendarEvents(controller.signal);
        const reviews = sortEvents((data.events || []).filter(event => event.source === 'progress-review'));
        setEvents(reviews);
        setOwnerName(data.owner?.name || 'Med Maher');
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setEvents([]);
        setError(err instanceof Error ? err.message : 'Unable to load progress reviews.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    loadReviews();
    return () => controller.abort();
  }, []);

  const thisMonthEvents = events.filter(event => isEventThisMonth(event));
  const overdueEvents = events.filter(event => isAtRiskProgressReview(event));
  const dueSoonEvents = events.filter(event => isDueSoonEvent(event));
  const scheduledEvents = events.filter(event => isScheduledEvent(event));
  const inProgressEvents = events.filter(event => isInProgressEvent(event));
  const awaitingSignatureEvents = events.filter(event => isAwaitingSignatureEvent(event));
  const completedEvents = events.filter(event => isCompletedEvent(event));
  const needsScheduleEvents = events.filter(needsScheduling);
  const thisMonth = thisMonthEvents.length;
  const overdue = overdueEvents.length;
  const dueSoon = dueSoonEvents.length;
  const pendingSchedule = needsScheduleEvents.length;
  const data = tab === 'this-month'
    ? thisMonthEvents
    : tab === 'overdue'
      ? overdueEvents
      : tab === 'due-soon'
        ? dueSoonEvents
        : tab === 'needs-schedule'
          ? needsScheduleEvents
          : tab === 'scheduled'
            ? scheduledEvents
            : tab === 'in-progress'
              ? inProgressEvents
              : tab === 'awaiting-signature'
                ? awaitingSignatureEvents
                : tab === 'completed'
                  ? completedEvents
                  : tab === 'all'
                    ? events
                    : [];
  const pageCount = Math.ceil(data.length / REVIEWS_PER_PAGE);
  const activePage = Math.min(currentPage, Math.max(pageCount, 1));
  const paginatedReviews = data.slice(
    (activePage - 1) * REVIEWS_PER_PAGE,
    activePage * REVIEWS_PER_PAGE,
  );

  const changeTab = (nextTab: ReviewTab) => {
    setTab(nextTab);
    setCurrentPage(1);
    setExpanded(null);
  };

  const updateEvent = (updatedEvent: CoachCalendarEvent) => {
    setEvents(prevEvents => sortEvents(prevEvents.map(event => (
      eventIdentity(event) === eventIdentity(updatedEvent) ? updatedEvent : event
    ))));
    setExpanded(eventIdentity(updatedEvent));
    setScheduleForm(scheduleDefaults(updatedEvent));
  };

  const toggleExpanded = (event: CoachCalendarEvent) => {
    const id = eventIdentity(event);
    setExpanded(expanded === id ? null : id);
    setScheduleForm(scheduleDefaults(event));
    setActionError(null);
    setActionNotice(event.syncWarning || null);
  };

  const handleSchedule = async (event: CoachCalendarEvent) => {
    setBusyEventId(eventIdentity(event));
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await scheduleCoachCalendarEvent(event, scheduleForm);
      updateEvent(data.event);
      if (data.warning) setActionNotice(data.warning);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to schedule review.');
    } finally {
      setBusyEventId(null);
    }
  };

  const handleAction = async (event: CoachCalendarEvent, action: CalendarAction) => {
    setBusyEventId(eventIdentity(event));
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await runCoachCalendarAction(event, action);
      updateEvent(data.event);
      if (data.warning) setActionNotice(data.warning);
      const url = meetingUrl(data.event);
      if (action === 'start' && url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update review.');
    } finally {
      setBusyEventId(null);
    }
  };

  const handleJoin = async (event: CoachCalendarEvent) => {
    if (event.status === 'scheduled') {
      await handleAction(event, 'start');
      return;
    }
    const url = meetingUrl(event);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openCompletionForm = (event: CoachCalendarEvent) => {
    setActionError(null);
    setCompletionEvent(event);
  };

  const handleCompleteReview = async (responses: ProgressReviewResponses) => {
    if (!completionEvent) return;
    setBusyEventId(eventIdentity(completionEvent));
    setActionError(null);
    setActionNotice(null);
    try {
      const result = await runCoachCalendarAction(completionEvent, 'complete', { reviewResponses: responses });
      updateEvent(result.event);
      if (result.warning) setActionNotice(result.warning);
      setCompletionEvent(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to complete review.');
    } finally {
      setBusyEventId(null);
    }
  };

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Progress Reviews" pageSubtitle="Manage learner progress reviews and sign-offs" userName={ownerName} userRole="Progress Coach">
      <div className="min-h-screen w-full space-y-4 bg-[#f7f6fb] p-3 md:p-5">
        <section
          className="rounded-2xl border border-white/10 px-6 py-6 text-white shadow-[0_14px_32px_rgba(20,4,46,0.16)]"
          style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] text-white/55">
                <span>Coach Workspace</span>
                <i className="ri-arrow-right-s-line"></i>
                <span className="font-semibold text-white">Progress Reviews</span>
              </div>
              <h1 className="text-2xl font-heading font-bold tracking-[-0.02em] text-white">Progress Reviews</h1>
              <p className="mt-1 max-w-xl text-[12px] leading-5 text-white/70">
                Schedule, run and complete learner progress reviews for {ownerName}'s active learners.
              </p>
            </div>
            <button
              type="button"
              onClick={() => changeTab(overdue > 0 ? 'overdue' : 'this-month')}
              className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl border border-white/15 bg-white px-4 text-[11px] font-semibold text-primary-800 shadow-sm transition hover:bg-primary-50 lg:self-center"
            >
              <i className={overdue > 0 ? 'ri-alarm-warning-line text-red-600' : 'ri-checkbox-circle-line text-emerald-600'}></i>
              {overdue > 0
                ? `${overdue} overdue review${overdue === 1 ? '' : 's'}`
                : 'Everything is on track'}
            </button>
          </div>
        </section>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="overflow-hidden rounded-3xl border border-background-200 bg-background-50 shadow-[0_12px_40px_-30px_oklch(var(--foreground-950)/0.35)]">
          <div className="border-b border-background-200 px-4 pt-5 sm:px-6">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-base font-bold text-foreground-900">{FILTER_COPY[tab].label} reviews</h3>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-foreground-400">{FILTER_COPY[tab].description}</p>
              </div>
              <span className="w-fit rounded-full bg-primary-50 px-3 py-1 text-[11px] font-bold text-primary-700">
                {data.length} {data.length === 1 ? 'review' : 'reviews'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 pb-4">
              <TabButton active={tab === 'this-month'} onClick={() => changeTab('this-month')} label={FILTER_COPY['this-month'].label} count={thisMonth} description={FILTER_COPY['this-month'].description} />
              <TabButton active={tab === 'overdue'} onClick={() => changeTab('overdue')} label={FILTER_COPY.overdue.label} count={overdue} description={FILTER_COPY.overdue.description} />
              <TabButton active={tab === 'due-soon'} onClick={() => changeTab('due-soon')} label={FILTER_COPY['due-soon'].label} count={dueSoon} description={FILTER_COPY['due-soon'].description} />
              <TabButton active={tab === 'needs-schedule'} onClick={() => changeTab('needs-schedule')} label={FILTER_COPY['needs-schedule'].label} count={pendingSchedule} description={FILTER_COPY['needs-schedule'].description} />
              <TabButton active={tab === 'scheduled'} onClick={() => changeTab('scheduled')} label={FILTER_COPY.scheduled.label} count={scheduledEvents.length} description={FILTER_COPY.scheduled.description} />
              <TabButton active={tab === 'in-progress'} onClick={() => changeTab('in-progress')} label={FILTER_COPY['in-progress'].label} count={inProgressEvents.length} description={FILTER_COPY['in-progress'].description} />
              <TabButton active={tab === 'awaiting-signature'} onClick={() => changeTab('awaiting-signature')} label={FILTER_COPY['awaiting-signature'].label} count={awaitingSignatureEvents.length} description={FILTER_COPY['awaiting-signature'].description} />
              <TabButton active={tab === 'completed'} onClick={() => changeTab('completed')} label={FILTER_COPY.completed.label} count={completedEvents.length} description={FILTER_COPY.completed.description} />
              <TabButton active={tab === 'all'} onClick={() => changeTab('all')} label={FILTER_COPY.all.label} count={events.length} description={FILTER_COPY.all.description} />
            </div>
          </div>

          <div className="grid gap-3 bg-background-100/55 p-3 sm:p-5 xl:grid-cols-2">
            {loading && <div className="xl:col-span-2"><EmptyState icon="ri-loader-4-line" title="Loading progress reviews..." /></div>}
            {!loading && !error && data.length === 0 && <div className="xl:col-span-2"><EmptyState icon="ri-file-chart-line" title="No progress reviews found." /></div>}

            {!loading && paginatedReviews.map(review => {
              const isOpen = expanded === eventIdentity(review);
              const isBusy = busyEventId === eventIdentity(review);
              const joinAvailable = canJoinMeeting(review);
              return (
                <article key={eventIdentity(review)} className={`group overflow-hidden rounded-2xl border bg-background-50 transition-all duration-200 ${isOpen ? 'border-primary-300 shadow-[0_12px_32px_-22px_oklch(var(--primary-700)/0.5)] xl:col-span-2' : 'border-background-200 hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-sm'}`}>
                  <div className="flex cursor-pointer items-center gap-3 p-4 sm:gap-4 sm:p-5" onClick={() => toggleExpanded(review)}>
                    <div className="hidden h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl border border-background-200 bg-background-100 sm:flex">
                      <span className="text-[9px] font-bold uppercase tracking-wide text-foreground-300">Review</span>
                      <i className="ri-file-chart-line mt-1 text-lg text-primary-600"></i>
                    </div>
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-background-50 ${avatarClass(review)}`}>
                      <span className="text-sm font-bold">{initialsFor(review.learner)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-bold text-foreground-900">{review.learner || 'Unknown learner'}</p>
                        <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold ${statusPillClass(review.status)}`}>{statusLabel(review.status)}</span>
                        {isAtRiskProgressReview(review) && <span className="rounded-full bg-red-50 px-2.5 py-1 text-[9px] font-bold text-red-700">Overdue</span>}
                        <span className="rounded-full bg-background-100 px-2.5 py-1 text-[9px] font-semibold text-foreground-500">{eventPeriodLabel(review)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-400">
                        <span><i className="ri-book-open-line mr-1 text-primary-500"></i>{review.programme || '--'}</span>
                        <span><i className="ri-calendar-line mr-1 text-primary-500"></i>{formatDateLabel(eventDisplayDate(review))}</span>
                        <span><i className="ri-time-line mr-1 text-primary-500"></i>{formatTimeLabel(review)}</span>
                      </div>
                    </div>
                    <div className="hidden shrink-0 items-center gap-2 md:flex">
                      {joinAvailable && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleJoin(review); }} disabled={isBusy} className="cursor-pointer whitespace-nowrap rounded-xl bg-primary-600 px-4 py-2.5 text-[11px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-700 disabled:opacity-60">
                          <i className="ri-video-on-line mr-1.5"></i>Join Meeting
                        </button>
                      )}
                      <button type="button" onClick={(e) => { e.stopPropagation(); toggleExpanded(review); }} className="cursor-pointer whitespace-nowrap rounded-xl border border-background-200 bg-background-50 px-4 py-2.5 text-[11px] font-semibold text-foreground-600 transition-smooth hover:border-primary-200 hover:bg-primary-50">
                        {needsScheduling(review) ? 'Schedule' : 'Manage'}
                      </button>
                    </div>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background-100 text-foreground-400 transition-transform ${isOpen ? 'rotate-180 bg-primary-50 text-primary-600' : ''}`}>
                      <i className="ri-arrow-down-s-line"></i>
                    </span>
                  </div>

                  {isOpen && (
                    <div className="space-y-4 border-t border-background-200 bg-white/60 p-4 sm:p-5 sm:pl-[9.25rem]" onClick={(e) => e.stopPropagation()}>
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <InfoBox label="Programme" value={review.programme || '--'} />
                        <InfoBox label="Target date" value={formatDateLabel(review.targetDate)} />
                        <InfoBox label="Scheduled date" value={review.scheduledDate ? formatDateLabel(review.scheduledDate) : '--'} />
                        <InfoBox label="Status" value={statusLabel(review.status)} />
                        {isAtRiskProgressReview(review) && <InfoBox label="Risk" value="Target date passed and not scheduled" />}
                      </div>
                      {review.notes && (
                        <div className="bg-background-100/60 rounded-lg p-3">
                          <p className="text-[11px] font-semibold text-foreground-700 mb-1">Coach Notes</p>
                          <p className="text-[12px] text-foreground-600">{review.notes}</p>
                        </div>
                      )}
                      {(actionError || actionNotice) && (
                        <div className={`rounded-lg border px-3 py-2 text-[11px] ${actionError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                          {actionError || actionNotice}
                        </div>
                      )}
                      {!['completed', 'awaiting-signature'].includes(review.status) && (
                        <div className="rounded-xl border border-background-200/60 bg-background-100/60 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500 mb-3">Schedule Review</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <ScheduleInput label="Date" type="date" value={scheduleForm.date} onChange={(value) => setScheduleForm(prev => ({ ...prev, date: value }))} />
                            <ScheduleInput label="Time" type="time" value={scheduleForm.time} onChange={(value) => setScheduleForm(prev => ({ ...prev, time: value }))} />
                            <label className="block">
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Duration</span>
                              <select value={scheduleForm.durationMinutes} onChange={(e) => setScheduleForm(prev => ({ ...prev, durationMinutes: Number(e.target.value) }))} className="w-full rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[11px] text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-300">
                                {[30, 45, 60, 90].map(minutes => <option key={minutes} value={minutes}>{minutes} min</option>)}
                              </select>
                            </label>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-3">
                            {joinAvailable && (
                              <button type="button" onClick={() => handleJoin(review)} disabled={isBusy} className="whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">
                                <i className="ri-video-on-line mr-1"></i>Join Meeting
                              </button>
                            )}
                            <button type="button" onClick={() => handleSchedule(review)} disabled={isBusy} className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap">
                              <i className="ri-calendar-check-line mr-1"></i>{review.status === 'scheduled' || review.status === 'in-progress' ? 'Reschedule' : 'Schedule'}
                            </button>
                            {review.status === 'in-progress' && (
                              <button type="button" onClick={() => openCompletionForm(review)} disabled={isBusy} className="px-3 py-2 bg-secondary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-secondary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap">
                                <i className="ri-send-plane-line mr-1"></i>Submit Review
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      {review.status === 'awaiting-signature' && (
                        <div className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 sm:flex-row sm:items-center">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                            <i className="ri-pen-nib-line"></i>
                          </span>
                          <div className="flex-1">
                            <p className="text-xs font-bold text-violet-900">Waiting for line manager signature</p>
                            <p className="mt-1 text-[11px] text-violet-700">The coach review is saved. Confirm the manager signature to finish this review.</p>
                          </div>
                          <button type="button" onClick={() => handleAction(review, 'sign')} disabled={isBusy} className="whitespace-nowrap rounded-xl bg-violet-700 px-4 py-2.5 text-[11px] font-bold text-white transition hover:bg-violet-800 disabled:opacity-60">
                            <i className="ri-quill-pen-line mr-1.5"></i>Confirm Manager Signature
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            {!loading && pageCount > 1 && (
              <Pagination
                currentPage={activePage}
                pageCount={pageCount}
                totalItems={data.length}
                onPageChange={(page) => {
                  setCurrentPage(page);
                  setExpanded(null);
                }}
              />
            )}
          </div>
        </section>
        {completionEvent && (
          <ProgressReviewCompletionModal
            key={eventIdentity(completionEvent)}
            event={completionEvent}
            busy={busyEventId === eventIdentity(completionEvent)}
            error={actionError}
            onClose={() => {
              if (!busyEventId) setCompletionEvent(null);
            }}
            onSubmit={handleCompleteReview}
          />
        )}
      </div>
    </WorkspaceShell>
  );
}

function ProgressReviewCompletionModal({
  event,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  event: CoachCalendarEvent;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (responses: ProgressReviewResponses) => void;
}) {
  const [responses, setResponses] = useState<ProgressReviewResponses>(() => ({ ...(event.reviewResponses || {}) }));
  const [openSection, setOpenSection] = useState(PROGRESS_REVIEW_SECTIONS[0].id);
  const [validationError, setValidationError] = useState('');
  const answeredCount = REQUIRED_PROGRESS_REVIEW_RESPONSE_IDS.filter((id) => responses[id]?.trim()).length;
  const completionPercent = Math.round((answeredCount / REQUIRED_PROGRESS_REVIEW_RESPONSE_IDS.length) * 100);

  const updateResponse = (id: string, value: string) => {
    setResponses((current) => ({ ...current, [id]: value }));
    setValidationError('');
  };

  const submit = () => {
    const firstMissing = PROGRESS_REVIEW_SECTIONS.find((section) => (
      section.questions.some((question) => (
        (
          question.required !== false
          || (
            question.showWhen
            && responses[question.showWhen.questionId] === question.showWhen.value
          )
        )
        && !responses[question.id]?.trim()
      ))
    ));
    if (firstMissing) {
      setOpenSection(firstMissing.id);
      setValidationError('Please answer every question before submitting the review for signature.');
      return;
    }
    onSubmit(responses);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-primary-950/65 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/20 bg-background-50 shadow-2xl">
        <header className="shrink-0 border-b border-white/10 bg-gradient-to-r from-[#10021f] via-primary-950 to-[#35105e] px-5 py-5 text-white sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-lg text-secondary-200">
                <i className="ri-file-edit-line"></i>
              </span>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-secondary-200">Submit progress review</p>
                <h2 className="mt-1 text-lg font-bold text-white">{event.learner || 'Learner'} · {eventPeriodLabel(event)}</h2>
                <p className="mt-1 text-xs text-white/60">Complete the review record, then send it for the line manager signature.</p>
              </div>
            </div>
            <button type="button" onClick={onClose} disabled={busy} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-50" aria-label="Close form">
              <i className="ri-close-line text-lg"></i>
            </button>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-secondary-300 transition-all" style={{ width: `${completionPercent}%` }} />
            </div>
            <span className="text-[10px] font-bold text-white/70">{answeredCount}/{REQUIRED_PROGRESS_REVIEW_RESPONSE_IDS.length} answered</span>
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto bg-[#f7f6fb] p-4 sm:p-6">
          <div className="rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-xs leading-5 text-primary-800">
            <i className="ri-information-line mr-2"></i>
            These answers will be saved to this review and shown to the learner in their Progress Review record.
          </div>

          <div className="grid gap-3 rounded-2xl border border-background-200 bg-background-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Learner', event.learner || 'Unknown learner'],
              ['Programme', event.programme || '--'],
              ['Review period', eventPeriodLabel(event)],
              ['Meeting', `${formatDateLabel(event.scheduledDate || event.targetDate)} · ${formatTimeLabel(event)}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-background-100 px-3.5 py-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-foreground-400">{label}</p>
                <p className="mt-1 text-xs font-bold text-foreground-800">{value}</p>
              </div>
            ))}
          </div>

          {PROGRESS_REVIEW_SECTIONS.map((section, sectionIndex) => {
            const isOpen = openSection === section.id;
            const requiredQuestions = section.questions.filter((question) => question.required !== false);
            const sectionAnswered = requiredQuestions.filter((question) => responses[question.id]?.trim()).length;
            const sectionComplete = sectionAnswered === requiredQuestions.length;
            const visibleQuestions = section.questions.filter((question) => (
              !question.showWhen
              || responses[question.showWhen.questionId] === question.showWhen.value
            ));
            return (
              <section key={section.id} className={`overflow-hidden rounded-2xl border bg-background-50 transition-all ${isOpen ? 'border-primary-300 shadow-sm' : 'border-background-200'}`}>
                <button type="button" onClick={() => setOpenSection(isOpen ? '' : section.id)} className="flex w-full items-center gap-3 p-4 text-left sm:px-5">
                  <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isOpen ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-700'}`}>
                    <i className={section.icon}></i>
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-primary-900 px-1 text-[8px] font-bold text-white">{sectionIndex + 1}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-foreground-400">Review section {sectionIndex + 1} of {PROGRESS_REVIEW_SECTIONS.length}</span>
                    <span className="mt-0.5 block text-sm font-bold text-foreground-900">{section.title}</span>
                    <span className="mt-1 hidden text-[10px] text-foreground-400 sm:block">{section.description}</span>
                  </span>
                  {sectionComplete && <i className="ri-checkbox-circle-fill text-lg text-emerald-500"></i>}
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full bg-background-100 text-foreground-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}><i className="ri-arrow-down-s-line"></i></span>
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-primary-100 bg-white p-4 sm:p-5">
                    {visibleQuestions.map((question, questionIndex) => (
                      <div key={question.id} className="rounded-2xl border border-background-200 bg-background-50 p-4 transition focus-within:border-primary-300 focus-within:shadow-sm">
                        <label className="mb-2 block text-xs font-bold text-foreground-800">
                          <span className="mr-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-100 px-1 text-[9px] text-primary-700">{questionIndex + 1}</span>
                          {question.label}
                          {(question.required !== false || question.showWhen) && <span className="ml-1 text-red-500">*</span>}
                        </label>
                        {question.helpText && <p className="mb-2 text-[10px] text-foreground-400">{question.helpText}</p>}
                        {question.type === 'text' && (
                          <textarea
                            value={responses[question.id] || ''}
                            onChange={(e) => updateResponse(question.id, e.target.value)}
                            rows={3}
                            maxLength={4000}
                            placeholder={question.placeholder}
                            className="w-full resize-y rounded-xl border border-background-300 bg-white px-3.5 py-3 text-sm text-foreground-800 outline-none transition placeholder:text-foreground-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-200"
                          />
                        )}
                        {question.type === 'yes-no' && (
                          <div className="grid max-w-sm grid-cols-2 gap-2">
                            {[
                              ['Yes', 'ri-check-line'],
                              ['No', 'ri-close-line'],
                            ].map(([value, icon]) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() => updateResponse(question.id, value)}
                                className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-xs font-bold transition ${
                                  responses[question.id] === value
                                    ? value === 'Yes'
                                      ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm'
                                      : 'border-foreground-700 bg-foreground-800 text-white shadow-sm'
                                    : 'border-background-300 bg-white text-foreground-600 hover:border-primary-300 hover:bg-primary-50'
                                }`}
                              >
                                <i className={icon}></i>{value}
                              </button>
                            ))}
                          </div>
                        )}
                        {question.type === 'rating' && (
                          <div>
                            <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
                              {Array.from({ length: 10 }, (_, index) => String(index + 1)).map((rating) => (
                                <button key={rating} type="button" onClick={() => updateResponse(question.id, rating)} className={`flex h-10 min-w-0 items-center justify-center rounded-xl border text-xs font-bold transition ${responses[question.id] === rating ? 'border-primary-600 bg-primary-600 text-white shadow-sm' : 'border-background-300 bg-white text-foreground-600 hover:border-primary-300 hover:bg-primary-50'}`}>
                                  {rating}
                                </button>
                              ))}
                            </div>
                            <div className="mt-2 flex justify-between text-[9px] font-medium text-foreground-400">
                              <span>1 · Significant support needed</span>
                              <span>10 · Excellent</span>
                            </div>
                          </div>
                        )}
                        {question.type === 'select' && (
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {(question.options || []).map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() => updateResponse(question.id, option)}
                                className={`min-h-10 rounded-xl border px-3 py-2 text-left text-[11px] font-semibold transition ${
                                  responses[question.id] === option
                                    ? 'border-primary-600 bg-primary-600 text-white shadow-sm'
                                    : 'border-background-300 bg-white text-foreground-600 hover:border-primary-300 hover:bg-primary-50'
                                }`}
                              >
                                <i className={`mr-2 ${responses[question.id] === option ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'}`}></i>
                                {option}
                              </button>
                            ))}
                          </div>
                        )}
                        {question.type === 'rag' && (
                          <div className="grid max-w-lg grid-cols-3 gap-2">
                            {[
                              ['Green', 'border-emerald-500 bg-emerald-500 text-white', 'bg-emerald-50 text-emerald-700'],
                              ['Amber', 'border-amber-500 bg-amber-500 text-white', 'bg-amber-50 text-amber-700'],
                              ['Red', 'border-red-500 bg-red-500 text-white', 'bg-red-50 text-red-700'],
                            ].map(([value, activeClass, idleClass]) => (
                              <button key={value} type="button" onClick={() => updateResponse(question.id, value)} className={`rounded-xl border px-4 py-2.5 text-xs font-bold transition ${responses[question.id] === value ? activeClass : `border-transparent ${idleClass}`}`}>
                                <i className="ri-circle-fill mr-1.5 text-[8px]"></i>{value}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}

          {(validationError || error) && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
              <i className="ri-error-warning-line mr-2"></i>{validationError || error}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-xl px-4 text-xs font-semibold text-foreground-500 transition hover:bg-background-100 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60">
            <i className={busy ? 'ri-loader-4-line animate-spin' : 'ri-check-double-line'}></i>
            {busy ? 'Submitting review...' : 'Submit for Manager Signature'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, label, count, description }: { active: boolean; onClick: () => void; label: string; count: number; description: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={description}
      aria-pressed={active}
      className={`group inline-flex min-h-10 cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 py-2 text-[11px] font-semibold transition-all duration-200 ${
        active
          ? 'border-primary-900 bg-primary-900 text-white shadow-[0_8px_20px_-12px_oklch(var(--primary-900)/0.9)]'
          : 'border-background-200 bg-background-50 text-foreground-500 hover:-translate-y-0.5 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-800'
      }`}
    >
      <span>{label}</span>
      <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[9px] font-bold ${
        active
          ? 'bg-white/15 text-white'
          : 'bg-background-100 text-foreground-500 group-hover:bg-white group-hover:text-primary-700'
      }`}>
        {count}
      </span>
    </button>
  );
}

function Pagination({ currentPage, pageCount, totalItems, onPageChange }: { currentPage: number; pageCount: number; totalItems: number; onPageChange: (page: number) => void }) {
  const visiblePages = Array.from(
    new Set([1, currentPage - 1, currentPage, currentPage + 1, pageCount]),
  ).filter(page => page > 0 && page <= pageCount).sort((a, b) => a - b);

  return (
    <nav className="flex flex-col items-center justify-between gap-3 border-t border-background-200 pt-4 sm:flex-row xl:col-span-2" aria-label="Review pages">
      <p className="text-[11px] font-medium text-foreground-400">
        Showing {(currentPage - 1) * REVIEWS_PER_PAGE + 1}–{Math.min(currentPage * REVIEWS_PER_PAGE, totalItems)} of {totalItems}
      </p>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} className="flex h-9 items-center gap-1 rounded-xl border border-background-200 bg-background-50 px-3 text-[11px] font-semibold text-foreground-600 transition-smooth hover:border-primary-200 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-40">
          <i className="ri-arrow-left-s-line"></i>Previous
        </button>
        {visiblePages.map((page, index) => (
          <div key={page} className="flex items-center gap-1">
            {index > 0 && page - visiblePages[index - 1] > 1 && <span className="px-1 text-xs text-foreground-300">…</span>}
            <button type="button" onClick={() => onPageChange(page)} aria-current={currentPage === page ? 'page' : undefined} className={`h-9 min-w-9 rounded-xl px-2 text-[11px] font-bold transition-smooth ${currentPage === page ? 'bg-primary-900 text-white shadow-sm' : 'border border-background-200 bg-background-50 text-foreground-500 hover:border-primary-200 hover:bg-primary-50'}`}>
              {page}
            </button>
          </div>
        ))}
        <button type="button" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === pageCount} className="flex h-9 items-center gap-1 rounded-xl border border-background-200 bg-background-50 px-3 text-[11px] font-semibold text-foreground-600 transition-smooth hover:border-primary-200 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-40">
          Next<i className="ri-arrow-right-s-line"></i>
        </button>
      </div>
    </nav>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-background-200/70 bg-background-50 p-3.5">
      <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-foreground-300">{label}</p>
      <p className="text-xs font-semibold text-foreground-700">{value}</p>
    </div>
  );
}

function ScheduleInput({ label, type, value, onChange }: { label: string; type: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[11px] text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-300" />
    </label>
  );
}

function EmptyState({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-background-300 bg-background-50 p-12 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-500">
        <i className={`${icon} text-xl ${icon.includes('loader') ? 'animate-spin' : ''}`}></i>
      </span>
      <p className="mt-3 text-sm font-semibold text-foreground-500">{title}</p>
    </div>
  );
}
