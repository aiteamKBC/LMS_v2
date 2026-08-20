import { useEffect, useRef, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { roleNavMap } from '@/mocks/navigation';
import type { ProgressReviewResponses } from '@/pages/shared/progressReviewForm';
import { MonthlyCoachingCompletionModal } from './MonthlyCoachingCompletionModal';
import {
  type CalendarAction,
  type CoachCalendarEvent,
  type ScheduleFormState,
  avatarClass,
  eventDisplayDate,
  eventIdentity,
  fetchCoachCalendarEvents,
  formatDateLabel,
  formatTimeLabel,
  initialsFor,
  isAtRiskEvent,
  isCompletedEvent,
  isDueSoonEvent,
  isEventThisMonth,
  isInProgressEvent,
  isScheduledEvent,
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

type MeetingFilter = 'this-month' | 'at-risk' | 'due-soon' | 'needs-schedule' | 'scheduled' | 'in-progress' | 'completed' | 'all';

const FILTER_COPY: Record<MeetingFilter, { label: string; description: string }> = {
  'this-month': {
    label: 'This Month',
    description: 'Monthly coaching meetings with a target or scheduled date inside the current month, excluding completed meetings.',
  },
  'at-risk': {
    label: 'Overdue',
    description: 'Monthly coaching meetings where the target date has passed and the meeting is still not scheduled.',
  },
  'due-soon': {
    label: 'Due Soon',
    description: 'Monthly coaching meetings not scheduled yet and due within the next 14 days.',
  },
  'needs-schedule': {
    label: 'Not Scheduled',
    description: 'Monthly coaching meetings that still need a first calendar booking.',
  },
  scheduled: {
    label: 'Scheduled',
    description: 'Monthly coaching meetings that are booked and waiting to start.',
  },
  'in-progress': {
    label: 'In Progress',
    description: 'Monthly coaching meetings that have already been started by the coach.',
  },
  completed: {
    label: 'Completed',
    description: 'Monthly coaching meetings marked as completed or confirmed.',
  },
  all: {
    label: 'All',
    description: 'Every generated monthly coaching meeting for this coach across the learner programme dates.',
  },
};

const EMPTY_SCHEDULE_FORM: ScheduleFormState = {
  date: '',
  time: '09:00',
  durationMinutes: 60,
};

const MEETINGS_PER_PAGE = 10;

export default function CoachMeetings() {
  const coach = useCoachIdentity();
  const [filter, setFilter] = useState<MeetingFilter>('this-month');
  const [currentPage, setCurrentPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [events, setEvents] = useState<CoachCalendarEvent[]>([]);
  const [ownerName, setOwnerName] = useState('Coach');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(EMPTY_SCHEDULE_FORM);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [completionEvent, setCompletionEvent] = useState<CoachCalendarEvent | null>(null);

  useEffect(() => {
    if (!coach.isInitialized) return;
    if (!coach.email) {
      setEvents([]);
      setOwnerName(coach.name);
      setError('Coach access is required to load coaching meetings.');
      setLoading(false);
      return;
    }
    const controller = new AbortController();

    const loadEvents = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchCoachCalendarEvents(controller.signal);
        const mcrEvents = sortEvents((data.events || []).filter(event => event.source === 'mcr'));
        setEvents(mcrEvents);
        setOwnerName(data.owner?.name || coach.name);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setEvents([]);
        setError(err instanceof Error ? err.message : 'Unable to load coaching meetings.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    loadEvents();
    return () => controller.abort();
  }, [coach.email, coach.isInitialized, coach.name]);

  const thisMonthEvents = events.filter(event => isEventThisMonth(event));
  const atRiskEvents = events.filter(event => isAtRiskEvent(event));
  const dueSoonEvents = events.filter(event => isDueSoonEvent(event));
  const needsScheduleEvents = events.filter(needsScheduling);
  const scheduledEvents = events.filter(event => isScheduledEvent(event));
  const inProgressEvents = events.filter(event => isInProgressEvent(event));
  const completedEvents = events.filter(event => isCompletedEvent(event));
  const filtered = events.filter(event => {
    if (filter === 'this-month') return isEventThisMonth(event);
    if (filter === 'at-risk') return isAtRiskEvent(event);
    if (filter === 'due-soon') return isDueSoonEvent(event);
    if (filter === 'needs-schedule') return needsScheduling(event);
    if (filter === 'scheduled') return isScheduledEvent(event);
    if (filter === 'in-progress') return isInProgressEvent(event);
    if (filter === 'completed') return isCompletedEvent(event);
    return true;
  });
  const pageCount = Math.ceil(filtered.length / MEETINGS_PER_PAGE);
  const activePage = Math.min(currentPage, Math.max(pageCount, 1));
  const paginatedEvents = filtered.slice(
    (activePage - 1) * MEETINGS_PER_PAGE,
    activePage * MEETINGS_PER_PAGE,
  );

  const changeFilter = (nextFilter: MeetingFilter) => {
    setFilter(nextFilter);
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
      setActionError(err instanceof Error ? err.message : 'Unable to schedule meeting.');
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
      setActionError(err instanceof Error ? err.message : 'Unable to update meeting.');
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

  const handleCompleteMeeting = async (responses: ProgressReviewResponses) => {
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
      setActionError(err instanceof Error ? err.message : 'Unable to complete monthly coaching meeting.');
    } finally {
      setBusyEventId(null);
    }
  };

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Coaching Meetings" pageSubtitle="Schedule and manage coaching sessions" userName={ownerName} userRole="Progress Coach">
      <div className="min-h-screen w-full space-y-4 bg-[#f7f6fb] p-3 md:p-5">
        <section
          className="rounded-2xl border border-white/10 px-5 py-5 text-white shadow-[0_14px_32px_rgba(20,4,46,0.16)] md:px-6"
          style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-xl text-white"><AppIcon className="ri-calendar-event-line"></AppIcon></span>
              <div>
                <h1 className="text-2xl font-heading font-bold tracking-[-0.02em] text-white">Coaching Meetings</h1>
                <p className="mt-1 max-w-xl text-[12px] leading-5 text-white/70">
                  Plan, run and follow up on monthly coaching meetings for {ownerName}'s active learners.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => changeFilter(atRiskEvents.length > 0 ? 'at-risk' : 'this-month')}
              className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl border border-white/15 bg-white px-4 text-[11px] font-semibold text-primary-800 shadow-sm transition hover:bg-primary-50 lg:self-center"
            >
              <AppIcon className={atRiskEvents.length > 0 ? 'ri-alarm-warning-line text-red-600' : 'ri-checkbox-circle-line text-emerald-600'}></AppIcon>
              {atRiskEvents.length > 0
                ? `${atRiskEvents.length} overdue meeting${atRiskEvents.length === 1 ? '' : 's'}`
                : 'Everything is on track'}
            </button>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MeetingSummaryCard label="This month" value={thisMonthEvents.length} icon="ri-calendar-line" active={filter === 'this-month'} onClick={() => changeFilter('this-month')} />
          <MeetingSummaryCard label="Overdue" value={atRiskEvents.length} icon="ri-alarm-warning-line" tone="red" active={filter === 'at-risk'} onClick={() => changeFilter('at-risk')} />
          <MeetingSummaryCard label="Needs scheduling" value={needsScheduleEvents.length} icon="ri-calendar-2-line" tone="amber" active={filter === 'needs-schedule'} onClick={() => changeFilter('needs-schedule')} />
          <MeetingSummaryCard label="Scheduled" value={scheduledEvents.length} icon="ri-calendar-check-line" tone="emerald" active={filter === 'scheduled'} onClick={() => changeFilter('scheduled')} />
        </section>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="rounded-2xl border border-background-200 bg-background-50 shadow-[0_12px_40px_-30px_oklch(var(--foreground-950)/0.35)]">
          <div className="border-b border-background-200 px-4 pt-5 sm:px-6">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-base font-bold text-foreground-900">{FILTER_COPY[filter].label} coaching meetings</h3>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-foreground-400">{FILTER_COPY[filter].description}</p>
              </div>
              <span className="w-fit rounded-full bg-primary-50 px-3 py-1 text-[11px] font-bold text-primary-700">
                {filtered.length} {filtered.length === 1 ? 'meeting' : 'meetings'}
              </span>
            </div>
            <div className="-mx-1 flex flex-wrap items-center gap-1 px-1 pb-3">
              <FilterButton active={filter === 'this-month'} onClick={() => changeFilter('this-month')} label={FILTER_COPY['this-month'].label} count={thisMonthEvents.length} description={FILTER_COPY['this-month'].description} />
              <FilterButton active={filter === 'at-risk'} onClick={() => changeFilter('at-risk')} label={FILTER_COPY['at-risk'].label} count={atRiskEvents.length} description={FILTER_COPY['at-risk'].description} />
              <FilterButton active={filter === 'due-soon'} onClick={() => changeFilter('due-soon')} label={FILTER_COPY['due-soon'].label} count={dueSoonEvents.length} description={FILTER_COPY['due-soon'].description} />
              <FilterButton active={filter === 'needs-schedule'} onClick={() => changeFilter('needs-schedule')} label={FILTER_COPY['needs-schedule'].label} count={needsScheduleEvents.length} description={FILTER_COPY['needs-schedule'].description} />
              <FilterButton active={filter === 'scheduled'} onClick={() => changeFilter('scheduled')} label={FILTER_COPY.scheduled.label} count={scheduledEvents.length} description={FILTER_COPY.scheduled.description} />
              <FilterButton active={filter === 'in-progress'} onClick={() => changeFilter('in-progress')} label={FILTER_COPY['in-progress'].label} count={inProgressEvents.length} description={FILTER_COPY['in-progress'].description} />
              <FilterButton active={filter === 'completed'} onClick={() => changeFilter('completed')} label={FILTER_COPY.completed.label} count={completedEvents.length} description={FILTER_COPY.completed.description} />
              <FilterButton active={filter === 'all'} onClick={() => changeFilter('all')} label={FILTER_COPY.all.label} count={events.length} description={FILTER_COPY.all.description} />
            </div>
          </div>
          <div className="grid gap-3 bg-background-100/55 p-3 sm:p-5 xl:grid-cols-2">
          {loading && <EmptyState icon="ri-loader-4-line" title="Loading coaching meetings..." />}
          {!loading && !error && filtered.length === 0 && <EmptyState icon="ri-calendar-check-line" title="No coaching meetings found." />}

          {!loading && paginatedEvents.map(event => {
            const isOpen = expanded === eventIdentity(event);
            const isBusy = busyEventId === eventIdentity(event);
            const url = meetingUrl(event);
            return (
              <article key={eventIdentity(event)} className={`group rounded-2xl border bg-background-50 transition-all duration-200 ${isOpen ? 'overflow-visible border-primary-300 shadow-[0_12px_32px_-22px_oklch(var(--primary-700)/0.5)] xl:col-span-2' : 'overflow-hidden border-background-200 hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-sm'}`}>
                <div className="flex cursor-pointer items-center gap-3 p-4 sm:gap-4 sm:p-5" onClick={() => toggleExpanded(event)}>
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-background-50 ${avatarClass(event)}`}>
                    <span className="text-sm font-bold">{initialsFor(event.learner)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold text-foreground-900">{event.learner || 'Unknown learner'}</p>
                      <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold ${statusPillClass(event.status)}`}>{statusLabel(event.status)}</span>
                      {isAtRiskEvent(event) && <span className="rounded-full bg-red-50 px-2.5 py-1 text-[9px] font-bold text-red-700">Overdue</span>}
                      {isDueSoonEvent(event) && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[9px] font-bold text-amber-700">Due Soon</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-400">
                      <span><AppIcon className="ri-calendar-line mr-1 text-primary-500"></AppIcon>{formatDateLabel(eventDisplayDate(event))}</span>
                      <span><AppIcon className="ri-time-line mr-1 text-primary-500"></AppIcon>{formatTimeLabel(event)}</span>
                      <span><AppIcon className="ri-video-chat-line mr-1 text-primary-500"></AppIcon>{event.platform || 'Microsoft Teams'}</span>
                      {event.cohort && <span className="hidden lg:inline"><AppIcon className="ri-group-line mr-1 text-primary-500"></AppIcon>{event.cohort}</span>}
                    </div>
                  </div>
                  <div className="hidden shrink-0 items-center gap-2 lg:flex">
                    {url && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); handleJoin(event); }} disabled={isBusy} className="cursor-pointer whitespace-nowrap rounded-xl bg-primary-600 px-4 py-2.5 text-[11px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-700 disabled:opacity-60">
                        <AppIcon className="ri-video-on-line mr-1.5"></AppIcon>Join Meeting
                      </button>
                    )}
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleExpanded(event); }} className="cursor-pointer whitespace-nowrap rounded-xl border border-background-200 bg-background-50 px-4 py-2.5 text-[11px] font-semibold text-foreground-600 transition-smooth hover:border-primary-200 hover:bg-primary-50">
                      {needsScheduling(event) ? 'Schedule' : 'Manage'}
                    </button>
                  </div>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background-100 text-foreground-400 transition-transform ${isOpen ? 'rotate-180 bg-primary-50 text-primary-600' : ''}`}>
                    <AppIcon className="ri-arrow-down-s-line"></AppIcon>
                  </span>
                </div>

                {isOpen && (
                  <div className="space-y-4 border-t border-background-200 bg-white/60 p-4 sm:p-5" onClick={(e) => e.stopPropagation()}>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <InfoBox label="Target date" value={formatDateLabel(event.targetDate)} />
                      <InfoBox label="Scheduled date" value={event.scheduledDate ? formatDateLabel(event.scheduledDate) : '--'} />
                      <InfoBox label="Cohort" value={event.cohort || '--'} />
                    </div>
                    {event.notes && (
                      <div className="bg-background-100/60 rounded-lg p-3">
                        <p className="text-[11px] font-semibold text-foreground-700 mb-1">Notes</p>
                        <p className="text-[12px] text-foreground-600">{event.notes}</p>
                      </div>
                    )}
                    {(actionError || actionNotice) && (
                      <div className={`rounded-lg border px-3 py-2 text-[11px] ${actionError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                        {actionError || actionNotice}
                      </div>
                    )}
                    {event.status !== 'completed' && (
                      <div className="rounded-xl border border-background-200/60 bg-background-100/60 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500 mb-3">Schedule Meeting</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <ScheduleInput label="Date" type="date" value={scheduleForm.date} onChange={(value) => setScheduleForm(prev => ({ ...prev, date: value }))} />
                          <ScheduleInput label="Time" type="time" value={scheduleForm.time} onChange={(value) => setScheduleForm(prev => ({ ...prev, time: value }))} />
                          <div className="block">
                            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Duration</span>
                            <ModernDurationPicker value={scheduleForm.durationMinutes} onChange={(durationMinutes) => setScheduleForm(prev => ({ ...prev, durationMinutes }))} />
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-3">
                          <button type="button" onClick={() => handleSchedule(event)} disabled={isBusy} className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap">
                            <AppIcon className="ri-calendar-check-line mr-1"></AppIcon>{event.status === 'scheduled' || event.status === 'in-progress' ? 'Reschedule' : 'Schedule'}
                          </button>
                          {(event.status === 'scheduled' || event.status === 'in-progress') && (
                            <button type="button" onClick={() => handleAction(event, 'start')} disabled={isBusy || !url} className="px-3 py-2 bg-emerald-500 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap">
                              <AppIcon className="ri-play-circle-line mr-1"></AppIcon>Start
                            </button>
                          )}
                          {event.status === 'in-progress' && (
                            <button type="button" onClick={() => openCompletionForm(event)} disabled={isBusy} className="px-3 py-2 bg-secondary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-secondary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap">
                              <AppIcon className="ri-check-double-line mr-1"></AppIcon>Complete
                            </button>
                          )}
                        </div>
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
                totalItems={filtered.length}
                onPageChange={(page) => {
                  setCurrentPage(page);
                  setExpanded(null);
                }}
              />
            )}
          </div>
        </section>
        {completionEvent && (
          <MonthlyCoachingCompletionModal
            key={eventIdentity(completionEvent)}
            event={completionEvent}
            busy={busyEventId === eventIdentity(completionEvent)}
            error={actionError}
            onClose={() => {
              if (!busyEventId) setCompletionEvent(null);
            }}
            onSubmit={handleCompleteMeeting}
          />
        )}
      </div>
    </WorkspaceShell>
  );
}

function MeetingSummaryCard({
  label,
  value,
  icon,
  tone = 'primary',
  active,
  onClick,
}: {
  label: string;
  value: number;
  icon: string;
  tone?: 'primary' | 'red' | 'amber' | 'emerald';
  active: boolean;
  onClick: () => void;
}) {
  const toneClass = tone === 'red'
    ? 'bg-red-50 text-red-600'
    : tone === 'amber'
      ? 'bg-amber-50 text-amber-600'
      : tone === 'emerald'
        ? 'bg-emerald-50 text-emerald-600'
        : 'bg-primary-50 text-primary-700';
  const valueClass = tone === 'red'
    ? 'text-red-600'
    : tone === 'amber'
      ? 'text-amber-600'
      : tone === 'emerald'
        ? 'text-emerald-600'
        : 'text-primary-800';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-3 rounded-xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
        active ? 'border-primary-300 ring-2 ring-primary-100' : 'border-foreground-200/60 hover:border-primary-200'
      }`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneClass}`}><AppIcon className={icon}></AppIcon></span>
      <span className="min-w-0 flex-1">
        <span className={`block text-xl font-bold ${valueClass}`}>{value}</span>
        <span className="block truncate text-[10px] font-medium text-foreground-500">{label}</span>
      </span>
      <AppIcon className="ri-arrow-right-s-line text-foreground-300 transition group-hover:translate-x-0.5 group-hover:text-primary-600"></AppIcon>
    </button>
  );
}

function FilterButton({ active, onClick, label, count, description }: { active: boolean; onClick: () => void; label: string; count: number; description: string }) {
  return (
    <button type="button" onClick={onClick} title={description} className={`cursor-pointer whitespace-nowrap rounded-xl px-3.5 py-2 text-[11px] font-semibold transition-smooth ${active ? 'bg-primary-900 text-white shadow-sm' : 'text-foreground-400 hover:bg-background-100 hover:text-foreground-700'}`}>
      {label} <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] ${active ? 'bg-white/15 text-white' : 'bg-background-100 text-foreground-400'}`}>{count}</span>
    </button>
  );
}

function Pagination({ currentPage, pageCount, totalItems, onPageChange }: { currentPage: number; pageCount: number; totalItems: number; onPageChange: (page: number) => void }) {
  const visiblePages = Array.from(
    new Set([1, currentPage - 1, currentPage, currentPage + 1, pageCount]),
  ).filter(page => page > 0 && page <= pageCount).sort((a, b) => a - b);

  return (
    <nav className="flex flex-col items-center justify-between gap-3 border-t border-background-200 pt-4 sm:flex-row xl:col-span-2" aria-label="Meeting pages">
      <p className="text-[11px] font-medium text-foreground-400">
        Showing {(currentPage - 1) * MEETINGS_PER_PAGE + 1}–{Math.min(currentPage * MEETINGS_PER_PAGE, totalItems)} of {totalItems}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="flex h-9 items-center gap-1 rounded-xl border border-background-200 bg-background-50 px-3 text-[11px] font-semibold text-foreground-600 transition-smooth hover:border-primary-200 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <AppIcon className="ri-arrow-left-s-line"></AppIcon>Previous
        </button>
        {visiblePages.map((page, index) => (
          <div key={page} className="flex items-center gap-1">
            {index > 0 && page - visiblePages[index - 1] > 1 && <span className="px-1 text-xs text-foreground-300">…</span>}
            <button
              type="button"
              onClick={() => onPageChange(page)}
              aria-current={currentPage === page ? 'page' : undefined}
              className={`h-9 min-w-9 rounded-xl px-2 text-[11px] font-bold transition-smooth ${currentPage === page ? 'bg-primary-900 text-white shadow-sm' : 'border border-background-200 bg-background-50 text-foreground-500 hover:border-primary-200 hover:bg-primary-50'}`}
            >
              {page}
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === pageCount}
          className="flex h-9 items-center gap-1 rounded-xl border border-background-200 bg-background-50 px-3 text-[11px] font-semibold text-foreground-600 transition-smooth hover:border-primary-200 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next<AppIcon className="ri-arrow-right-s-line"></AppIcon>
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
    <div className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">{label}</span>
      {type === 'date' ? (
        <ModernDatePicker value={value} onChange={onChange} />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border border-background-200 bg-background-50 px-3 py-2.5 text-[11px] text-foreground-900 transition focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100" />
      )}
    </div>
  );
}

function parseCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function calendarIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function ModernDatePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedDate = value ? parseCalendarDate(value) : null;
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const initial = parseCalendarDate(value);
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });

  useEffect(() => {
    if (!value) return;
    const next = parseCalendarDate(value);
    setViewMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  const firstVisibleDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1 - viewMonth.getDay());
  const calendarDays = Array.from({ length: 42 }, (_, index) => (
    new Date(firstVisibleDay.getFullYear(), firstVisibleDay.getMonth(), firstVisibleDay.getDate() + index)
  ));
  const todayIso = calendarIso(new Date());
  const selectedIso = selectedDate ? calendarIso(selectedDate) : '';
  const displayValue = selectedDate
    ? selectedDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Select a date';

  const moveMonth = (offset: number) => {
    setViewMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const chooseDate = (date: Date) => {
    onChange(calendarIso(date));
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between rounded-xl border bg-background-50 px-3 py-2.5 text-left text-[11px] transition ${
          open ? 'border-primary-300 ring-2 ring-primary-100' : 'border-background-200 hover:border-primary-200'
        }`}
      >
        <span className={`flex items-center gap-2 ${selectedDate ? 'font-semibold text-foreground-800' : 'text-foreground-400'}`}>
          <AppIcon className="ri-calendar-line text-primary-600"></AppIcon>
          {displayValue}
        </span>
        <AppIcon className={`ri-arrow-down-s-line text-foreground-400 transition ${open ? 'rotate-180' : ''}`}></AppIcon>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-[80] mt-2 w-[310px] rounded-2xl border border-foreground-200/70 bg-white p-4 shadow-[0_20px_60px_-18px_rgba(30,14,62,0.35)]">
          <div className="mb-4 flex items-center justify-between">
            <button type="button" onClick={() => moveMonth(-1)} className="flex h-9 w-9 items-center justify-center rounded-xl text-foreground-500 hover:bg-primary-50 hover:text-primary-700" aria-label="Previous month">
              <AppIcon className="ri-arrow-left-s-line text-lg"></AppIcon>
            </button>
            <div className="text-center">
              <p className="text-[12px] font-bold text-foreground-900">{viewMonth.toLocaleDateString('en-GB', { month: 'long' })}</p>
              <p className="text-[9px] text-foreground-400">{viewMonth.getFullYear()}</p>
            </div>
            <button type="button" onClick={() => moveMonth(1)} className="flex h-9 w-9 items-center justify-center rounded-xl text-foreground-500 hover:bg-primary-50 hover:text-primary-700" aria-label="Next month">
              <AppIcon className="ri-arrow-right-s-line text-lg"></AppIcon>
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
              <span key={day} className="py-1 text-center text-[8px] font-bold uppercase text-foreground-300">{day}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map(day => {
              const iso = calendarIso(day);
              const inCurrentMonth = day.getMonth() === viewMonth.getMonth();
              const selected = iso === selectedIso;
              const today = iso === todayIso;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => chooseDate(day)}
                  className={`flex h-9 w-9 items-center justify-center rounded-xl text-[10px] font-semibold transition ${
                    selected
                      ? 'bg-primary-700 text-white shadow-sm'
                      : today
                        ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200'
                        : inCurrentMonth
                          ? 'text-foreground-700 hover:bg-primary-50 hover:text-primary-700'
                          : 'text-foreground-300 hover:bg-background-100'
                  }`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-foreground-100 pt-3">
            <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="rounded-lg px-2 py-1.5 text-[9px] font-semibold text-foreground-400 hover:bg-background-100 hover:text-foreground-700">Clear</button>
            <button type="button" onClick={() => chooseDate(new Date())} className="rounded-lg bg-primary-50 px-3 py-1.5 text-[9px] font-bold text-primary-700 hover:bg-primary-100">Today</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModernDurationPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const options = [
    { value: 30, label: '30 minutes', hint: 'Quick check-in' },
    { value: 45, label: '45 minutes', hint: 'Focused session' },
    { value: 60, label: '60 minutes', hint: 'Standard meeting' },
    { value: 90, label: '90 minutes', hint: 'Extended review' },
  ];

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  const selected = options.find(option => option.value === value) || options[2];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between rounded-xl border bg-background-50 px-3 py-2.5 text-left transition ${
          open ? 'border-primary-300 ring-2 ring-primary-100' : 'border-background-200 hover:border-primary-200'
        }`}
      >
        <span className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><AppIcon className="ri-timer-line text-[12px]"></AppIcon></span>
          <span>
            <span className="block text-[11px] font-semibold text-foreground-800">{selected.label}</span>
            <span className="block text-[8px] text-foreground-400">{selected.hint}</span>
          </span>
        </span>
        <AppIcon className={`ri-arrow-down-s-line text-foreground-400 transition ${open ? 'rotate-180' : ''}`}></AppIcon>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-[80] mt-2 w-full min-w-[230px] overflow-hidden rounded-2xl border border-foreground-200/70 bg-white p-1.5 shadow-[0_18px_50px_-18px_rgba(30,14,62,0.35)]">
          {options.map(option => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => { onChange(option.value); setOpen(false); }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  active ? 'bg-primary-50 text-primary-800' : 'text-foreground-700 hover:bg-background-100'
                }`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${
                  active ? 'bg-primary-700 text-white' : 'bg-background-100 text-foreground-500'
                }`}>{option.value}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-semibold">{option.label}</span>
                  <span className="block text-[8px] text-foreground-400">{option.hint}</span>
                </span>
                {active && <AppIcon className="ri-check-line text-primary-700"></AppIcon>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-background-300 bg-background-50 p-12 text-center xl:col-span-2">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-500">
        <AppIcon className={`${icon} text-xl ${icon.includes('loader') ? 'animate-spin' : ''}`}></AppIcon>
      </span>
      <p className="mt-3 text-sm font-semibold text-foreground-500">{title}</p>
    </div>
  );
}
