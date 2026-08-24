import { useEffect, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { CardSkeleton } from '@/components/feature/Skeletons';
import { RowAction } from '@/components/ui/ActionRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterToolbar, SearchInput } from '@/components/ui/FilterToolbar';
import { MetricCard } from '@/components/ui/MetricCard';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageTabs, type PageTabItem } from '@/components/ui/PageTabs';
import { Pagination } from '@/components/ui/Pagination';
import { Panel } from '@/components/ui/Panel';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { cn } from '@/lib/cn';
import { roleNavMap } from '@/mocks/navigation';
import type { ProgressReviewResponses } from '@/pages/shared/progressReviewForm';
import { MonthlyCoachingCompletionModal } from './MonthlyCoachingCompletionModal';
import { CalendarEventMeta, CalendarEventRow } from '../shared/CalendarEventRow';
import { InfoTile, ModernDatePicker, ModernDurationPicker, ScheduleFieldLabel, ScheduleTimeInput } from '../shared/ScheduleControls';
import {
  type CalendarAction,
  type CoachCalendarEvent,
  type ScheduleFormState,
  eventDisplayDate,
  eventIdentity,
  fetchCoachCalendarEvents,
  formatDateLabel,
  formatTimeLabel,
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

function matchesMeetingSearch(event: CoachCalendarEvent, searchTerm: string) {
  const normalized = searchTerm.trim().toLowerCase();
  if (!normalized) return true;

  const haystack = [event.learner, event.email, event.programme, event.cohort, event.group, event.learnerId]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .every(token => haystack.includes(token));
}

export default function CoachMeetings() {
  const coach = useCoachIdentity();
  const [filter, setFilter] = useState<MeetingFilter>('this-month');
  const [searchTerm, setSearchTerm] = useState('');
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
  const tabFiltered = events.filter(event => {
    if (filter === 'this-month') return isEventThisMonth(event);
    if (filter === 'at-risk') return isAtRiskEvent(event);
    if (filter === 'due-soon') return isDueSoonEvent(event);
    if (filter === 'needs-schedule') return needsScheduling(event);
    if (filter === 'scheduled') return isScheduledEvent(event);
    if (filter === 'in-progress') return isInProgressEvent(event);
    if (filter === 'completed') return isCompletedEvent(event);
    return true;
  });
  const normalizedSearchTerm = searchTerm.trim();
  const filtered = normalizedSearchTerm
    ? tabFiltered.filter(event => matchesMeetingSearch(event, normalizedSearchTerm))
    : tabFiltered;
  const pageCount = Math.ceil(filtered.length / MEETINGS_PER_PAGE);
  const activePage = Math.min(currentPage, Math.max(pageCount, 1));
  const paginatedEvents = filtered.slice(
    (activePage - 1) * MEETINGS_PER_PAGE,
    activePage * MEETINGS_PER_PAGE,
  );

  const filterTabs: PageTabItem[] = [
    { value: 'this-month', label: FILTER_COPY['this-month'].label, count: thisMonthEvents.length },
    { value: 'at-risk', label: FILTER_COPY['at-risk'].label, count: atRiskEvents.length, tone: 'critical' },
    { value: 'due-soon', label: FILTER_COPY['due-soon'].label, count: dueSoonEvents.length, tone: 'upcoming' },
    { value: 'needs-schedule', label: FILTER_COPY['needs-schedule'].label, count: needsScheduleEvents.length, tone: 'caution' },
    { value: 'scheduled', label: FILTER_COPY.scheduled.label, count: scheduledEvents.length, tone: 'info' },
    { value: 'in-progress', label: FILTER_COPY['in-progress'].label, count: inProgressEvents.length, tone: 'info' },
    { value: 'completed', label: FILTER_COPY.completed.label, count: completedEvents.length, tone: 'positive' },
    { value: 'all', label: FILTER_COPY.all.label, count: events.length },
  ];

  const changeFilter = (nextFilter: MeetingFilter) => {
    setFilter(nextFilter);
    setCurrentPage(1);
    setExpanded(null);
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
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
      <PageContainer>
        <PageHeader
          title="Coaching Meetings"
          description={`Plan, run and follow up on monthly coaching meetings for ${ownerName}'s active learners.`}
          icon="ri-calendar-event-line"
          actions={(
            <button
              type="button"
              onClick={() => changeFilter(atRiskEvents.length > 0 ? 'at-risk' : 'this-month')}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[12px] font-semibold transition',
                atRiskEvents.length > 0
                  ? 'border-red-200 bg-red-50 text-red-700 hover:border-red-300'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300',
              )}
            >
              <AppIcon className={atRiskEvents.length > 0 ? 'ri-alarm-warning-line' : 'ri-checkbox-circle-line'}></AppIcon>
              {atRiskEvents.length > 0
                ? `${atRiskEvents.length} overdue meeting${atRiskEvents.length === 1 ? '' : 's'}`
                : 'Everything is on track'}
            </button>
          )}
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="This month" value={thisMonthEvents.length} icon="ri-calendar-line" tone="neutral" active={filter === 'this-month'} onClick={() => changeFilter('this-month')} />
          <MetricCard label="Overdue" value={atRiskEvents.length} icon="ri-alarm-warning-line" tone="critical" active={filter === 'at-risk'} onClick={() => changeFilter('at-risk')} />
          <MetricCard label="Due soon" value={dueSoonEvents.length} icon="ri-calendar-event-line" tone="upcoming" active={filter === 'due-soon'} onClick={() => changeFilter('due-soon')} />
          <MetricCard label="Not scheduled" value={needsScheduleEvents.length} icon="ri-calendar-2-line" tone="caution" active={filter === 'needs-schedule'} onClick={() => changeFilter('needs-schedule')} />
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-[13px] text-red-700">
            {error}
          </div>
        ) : null}

        <Panel padding="none">
          <div className="border-b border-foreground-100 p-4">
            <div className="mb-3">
              <h3 className="text-[15px] font-semibold text-foreground-900">{FILTER_COPY[filter].label} coaching meetings</h3>
              <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-foreground-500">{FILTER_COPY[filter].description}</p>
            </div>

            <FilterToolbar
              className="mb-3 border-0 bg-transparent p-0 shadow-none"
              search={(
                <SearchInput
                  value={searchTerm}
                  onChange={handleSearchChange}
                  placeholder="Search learner name..."
                  ariaLabel="Search coaching meetings by learner"
                />
              )}
              trailing={(
                <span className="whitespace-nowrap rounded-md bg-primary-50 px-3 py-1 text-[12px] font-bold text-primary-700">
                  {normalizedSearchTerm ? `${filtered.length} of ${tabFiltered.length}` : filtered.length} {filtered.length === 1 ? 'meeting' : 'meetings'}
                </span>
              )}
            />

            <PageTabs items={filterTabs} value={filter} onChange={(next) => changeFilter(next as MeetingFilter)} label="Filter coaching meetings by status" />
          </div>

          <div className="grid gap-3 bg-background-100/55 p-3 sm:p-5 xl:grid-cols-2">
            {/* Cards straight into the surrounding grid, so the placeholders sit
                where the meetings themselves will. */}
            {loading && Array.from({ length: 4 }).map((_, index) => <CardSkeleton key={index} />)}
            {!loading && !error && filtered.length === 0 ? (
              <div className="xl:col-span-2">
                <EmptyState
                  variant={tabFiltered.length === 0 ? 'empty' : 'no-matches'}
                  icon={tabFiltered.length === 0 ? 'ri-calendar-check-line' : 'ri-user-search-line'}
                  title={tabFiltered.length === 0 ? 'No coaching meetings found.' : 'No learner matches this search.'}
                />
              </div>
            ) : null}

            {!loading && paginatedEvents.map(event => {
              const isOpen = expanded === eventIdentity(event);
              const isBusy = busyEventId === eventIdentity(event);
              const url = meetingUrl(event);
              return (
                <CalendarEventRow
                  key={eventIdentity(event)}
                  event={event}
                  isOpen={isOpen}
                  onToggle={() => toggleExpanded(event)}
                  meta={(
                    <>
                      <CalendarEventMeta icon="ri-calendar-line">{formatDateLabel(eventDisplayDate(event))}</CalendarEventMeta>
                      <CalendarEventMeta icon="ri-time-line">{formatTimeLabel(event)}</CalendarEventMeta>
                      <CalendarEventMeta icon="ri-video-chat-line">{event.platform || 'Microsoft Teams'}</CalendarEventMeta>
                      {event.cohort ? (
                        <span className="hidden lg:inline">
                          <CalendarEventMeta icon="ri-group-line">{event.cohort}</CalendarEventMeta>
                        </span>
                      ) : null}
                    </>
                  )}
                  actions={(
                    <div className="hidden shrink-0 items-center gap-2 lg:flex">
                      {url ? (
                        <RowAction
                          label="Join Meeting"
                          icon="ri-video-on-line"
                          emphasis="primary"
                          disabled={isBusy}
                          onClick={() => { handleJoin(event); }}
                        />
                      ) : null}
                      <RowAction
                        label={needsScheduling(event) ? 'Schedule' : 'Manage'}
                        onClick={() => toggleExpanded(event)}
                      />
                    </div>
                  )}
                >
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <InfoTile label="Target date" value={formatDateLabel(event.targetDate)} />
                      <InfoTile label="Scheduled date" value={event.scheduledDate ? formatDateLabel(event.scheduledDate) : '--'} />
                      <InfoTile label="Cohort" value={event.cohort || '--'} />
                    </div>

                    {event.notes ? (
                      <div className="rounded-lg bg-background-100/60 p-3">
                        <p className="mb-1 text-[12px] font-semibold text-foreground-700">Notes</p>
                        <p className="text-[13px] text-foreground-600">{event.notes}</p>
                      </div>
                    ) : null}

                    {(actionError || actionNotice) ? (
                      <div className={cn('rounded-lg border px-3 py-2 text-[12px]', actionError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800')}>
                        {actionError || actionNotice}
                      </div>
                    ) : null}

                    {event.status !== 'completed' ? (
                      <div className="rounded-lg border border-background-200/60 bg-background-100/60 p-3">
                        <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-foreground-500">Schedule Meeting</p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <div>
                            <ScheduleFieldLabel>Date</ScheduleFieldLabel>
                            <ModernDatePicker value={scheduleForm.date} onChange={(value) => setScheduleForm(prev => ({ ...prev, date: value }))} />
                          </div>
                          <div>
                            <ScheduleFieldLabel>Time</ScheduleFieldLabel>
                            <ScheduleTimeInput value={scheduleForm.time} onChange={(value) => setScheduleForm(prev => ({ ...prev, time: value }))} />
                          </div>
                          <div>
                            <ScheduleFieldLabel>Duration</ScheduleFieldLabel>
                            <ModernDurationPicker value={scheduleForm.durationMinutes} onChange={(durationMinutes) => setScheduleForm(prev => ({ ...prev, durationMinutes }))} />
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <RowAction
                            label={event.status === 'scheduled' || event.status === 'in-progress' ? 'Reschedule' : 'Schedule'}
                            icon="ri-calendar-check-line"
                            emphasis="primary"
                            disabled={isBusy}
                            onClick={() => { handleSchedule(event); }}
                          />
                          {(event.status === 'scheduled' || event.status === 'in-progress') ? (
                            <RowAction
                              label="Start"
                              icon="ri-play-circle-line"
                              disabled={isBusy || !url}
                              onClick={() => { handleAction(event, 'start'); }}
                            />
                          ) : null}
                          {event.status === 'in-progress' ? (
                            <RowAction
                              label="Complete"
                              icon="ri-check-double-line"
                              disabled={isBusy}
                              onClick={() => openCompletionForm(event)}
                            />
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </CalendarEventRow>
              );
            })}

            {!loading && pageCount > 1 ? (
              <div className="xl:col-span-2">
                <Pagination
                  page={activePage}
                  totalPages={pageCount}
                  total={filtered.length}
                  pageSize={MEETINGS_PER_PAGE}
                  onPageChange={(page) => {
                    setCurrentPage(page);
                    setExpanded(null);
                  }}
                  noun="meetings"
                />
              </div>
            ) : null}
          </div>
        </Panel>

        {completionEvent ? (
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
        ) : null}
      </PageContainer>
    </WorkspaceShell>
  );
}
