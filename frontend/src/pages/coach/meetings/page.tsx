import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { ActionRow, RowAction } from '@/components/ui/ActionRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterChip, FilterSelect, FilterToolbar, SearchInput } from '@/components/ui/FilterToolbar';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageTabs, type PageTabItem } from '@/components/ui/PageTabs';
import { Pagination } from '@/components/ui/Pagination';
import { Panel } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { cn } from '@/lib/cn';
import { statusTone, type StatusTone } from '@/lib/statusTone';
import { roleNavMap } from '@/mocks/navigation';
import { LearnerAvatar } from '../shared/LearnerIdentity';
import { CalendarEventMeta } from '../shared/CalendarEventRow';
import {
  type CoachCalendarEvent,
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
  sortEvents,
  statusLabel,
} from '../shared/calendarEvents';

const coachNav = roleNavMap.coach;

type MeetingFilter = 'this-month' | 'at-risk' | 'due-soon' | 'needs-schedule' | 'scheduled' | 'in-progress' | 'completed' | 'all';

const FILTER_COPY: Record<MeetingFilter, { label: string; description: string }> = {
  'this-month': { label: 'This Month', description: 'Monthly coaching meetings due or scheduled this month.' },
  'at-risk': { label: 'Overdue', description: 'Meetings whose target date has passed and still need scheduling.' },
  'due-soon': { label: 'Due Soon', description: 'Unscheduled meetings due within the next 14 days.' },
  'needs-schedule': { label: 'Not Scheduled', description: 'Meetings that still need their first calendar booking.' },
  scheduled: { label: 'Scheduled', description: 'Booked meetings waiting for confirmed attendance.' },
  'in-progress': { label: 'In Progress', description: 'Meetings with confirmed attendance or a manual start.' },
  completed: { label: 'Completed', description: 'Finished monthly coaching meetings.' },
  all: { label: 'All', description: 'Every generated monthly coaching meeting for this coach.' },
};

const MEETINGS_PER_PAGE = 10;
const ALL_GROUPS_FILTER = 'all-groups';
const FILTER_VALUES = new Set<MeetingFilter>(Object.keys(FILTER_COPY) as MeetingFilter[]);

function groupCohortFilterKey(event: CoachCalendarEvent) {
  const value = event.group?.trim() || event.cohort?.trim();
  if (!value) return '';
  return `${event.group?.trim() ? 'group' : 'cohort'}:${value.toLowerCase()}`;
}

function groupCohortFilterLabel(event: CoachCalendarEvent) {
  if (event.group?.trim()) return `Group: ${event.group.trim()}`;
  if (event.cohort?.trim()) return `Cohort: ${event.cohort.trim()}`;
  return '';
}

function matchesMeetingSearch(event: CoachCalendarEvent, searchTerm: string) {
  const haystack = [event.learner, event.email, event.programme, event.cohort, event.group, event.learnerId]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return searchTerm.trim().toLowerCase().split(/\s+/).filter(Boolean).every(token => haystack.includes(token));
}

function meetingTone(event: CoachCalendarEvent): StatusTone {
  if (isAtRiskEvent(event)) return 'critical';
  if (isDueSoonEvent(event)) return 'caution';
  if (event.status === 'scheduled' || event.status === 'in-progress') return 'info';
  if (isCompletedEvent(event)) return 'positive';
  return 'neutral';
}

function filterFromQuery(value: string | null): MeetingFilter {
  return value && FILTER_VALUES.has(value as MeetingFilter) ? value as MeetingFilter : 'this-month';
}

function pageFromQuery(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function startOfMonth(value = new Date()) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function monthKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

function monthFromQuery(value: string | null) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return startOfMonth();
  const [year, month] = value.split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return startOfMonth();
  return new Date(year, month - 1, 1);
}

function addMonths(value: Date, offset: number) {
  return new Date(value.getFullYear(), value.getMonth() + offset, 1);
}

function monthLabel(value: Date) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(value);
}

export default function CoachMeetings() {
  const coach = useCoachIdentity();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<MeetingFilter>(() => filterFromQuery(searchParams.get('filter')));
  const [groupFilter, setGroupFilter] = useState(() => searchParams.get('group') || ALL_GROUPS_FILTER);
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('q') || '');
  const [selectedMonth, setSelectedMonth] = useState(() => monthFromQuery(searchParams.get('month')));
  const [currentPage, setCurrentPage] = useState(() => pageFromQuery(searchParams.get('page')));
  const [events, setEvents] = useState<CoachCalendarEvent[]>([]);
  const [ownerName, setOwnerName] = useState('Coach');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filter !== 'this-month') params.set('filter', filter);
    if (groupFilter !== ALL_GROUPS_FILTER) params.set('group', groupFilter);
    if (searchTerm.trim()) params.set('q', searchTerm.trim());
    if (monthKey(selectedMonth) !== monthKey(startOfMonth())) params.set('month', monthKey(selectedMonth));
    if (currentPage > 1) params.set('page', String(currentPage));
    setSearchParams(params, { replace: true });
  }, [currentPage, filter, groupFilter, searchTerm, selectedMonth, setSearchParams]);

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
    setLoading(true);
    setError(null);
    fetchCoachCalendarEvents(controller.signal)
      .then((data) => {
        setEvents(sortEvents((data.events || []).filter(event => event.source === 'mcr')));
        setOwnerName(data.owner?.name || coach.name);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setEvents([]);
        setError(err instanceof Error ? err.message : 'Unable to load coaching meetings.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [coach.email, coach.isInitialized, coach.name]);

  const selectedMonthLabel = monthLabel(selectedMonth);
  const selectedMonthIsCurrent = monthKey(selectedMonth) === monthKey(startOfMonth());
  const monthFilterLabel = selectedMonthIsCurrent ? FILTER_COPY['this-month'].label : selectedMonthLabel;
  const monthFilterDescription = `Monthly coaching meetings due or scheduled in ${selectedMonthLabel}.`;
  const selectedMonthEvents = events.filter(event => isEventThisMonth(event, selectedMonth));
  const atRiskEvents = events.filter(event => isAtRiskEvent(event));
  const dueSoonEvents = events.filter(event => isDueSoonEvent(event));
  const needsScheduleEvents = events.filter(needsScheduling);
  const scheduledEvents = events.filter(event => isScheduledEvent(event));
  const inProgressEvents = events.filter(event => isInProgressEvent(event));
  const completedEvents = events.filter(event => isCompletedEvent(event));

  const groupFilterOptions = useMemo(() => {
    const seen = new Set<string>();
    const options = events.reduce<{ value: string; label: string }[]>((items, event) => {
      const value = groupCohortFilterKey(event);
      const label = groupCohortFilterLabel(event);
      if (!value || !label || seen.has(value)) return items;
      seen.add(value);
      items.push({ value, label });
      return items;
    }, []);
    return [
      { value: ALL_GROUPS_FILTER, label: 'All groups / cohorts' },
      ...options.sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [events]);

  useEffect(() => {
    if (groupFilter === ALL_GROUPS_FILTER || loading) return;
    if (!groupFilterOptions.some(option => option.value === groupFilter)) setGroupFilter(ALL_GROUPS_FILTER);
  }, [groupFilter, groupFilterOptions, loading]);

  const tabFiltered = events.filter(event => {
    if (filter === 'this-month') return isEventThisMonth(event, selectedMonth);
    if (filter === 'at-risk') return isAtRiskEvent(event);
    if (filter === 'due-soon') return isDueSoonEvent(event);
    if (filter === 'needs-schedule') return needsScheduling(event);
    if (filter === 'scheduled') return isScheduledEvent(event);
    if (filter === 'in-progress') return isInProgressEvent(event);
    if (filter === 'completed') return isCompletedEvent(event);
    return true;
  });
  const groupFiltered = groupFilter === ALL_GROUPS_FILTER
    ? tabFiltered
    : tabFiltered.filter(event => groupCohortFilterKey(event) === groupFilter);
  const filtered = searchTerm.trim()
    ? groupFiltered.filter(event => matchesMeetingSearch(event, searchTerm))
    : groupFiltered;
  const pageCount = Math.ceil(filtered.length / MEETINGS_PER_PAGE);
  const activePage = Math.min(currentPage, Math.max(pageCount, 1));
  const paginatedEvents = filtered.slice((activePage - 1) * MEETINGS_PER_PAGE, activePage * MEETINGS_PER_PAGE);

  useEffect(() => {
    if (!loading && activePage !== currentPage) setCurrentPage(activePage);
  }, [activePage, currentPage, loading]);

  const filterTabs: PageTabItem[] = [
    { value: 'this-month', label: monthFilterLabel, count: selectedMonthEvents.length },
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
  };

  const changeMonth = (nextMonth: Date) => {
    setSelectedMonth(startOfMonth(nextMonth));
    setFilter('this-month');
    setCurrentPage(1);
  };

  const listUrl = () => {
    const query = new URLSearchParams();
    if (filter !== 'this-month') query.set('filter', filter);
    if (groupFilter !== ALL_GROUPS_FILTER) query.set('group', groupFilter);
    if (searchTerm.trim()) query.set('q', searchTerm.trim());
    if (monthKey(selectedMonth) !== monthKey(startOfMonth())) query.set('month', monthKey(selectedMonth));
    if (activePage > 1) query.set('page', String(activePage));
    const queryString = query.toString();
    return `/coach/meetings${queryString ? `?${queryString}` : ''}`;
  };

  const openDetails = (event: CoachCalendarEvent) => {
    navigate(`/coach/meetings/${encodeURIComponent(eventIdentity(event))}`, { state: { returnTo: listUrl() } });
  };

  const openLearnerReviews = (event: CoachCalendarEvent) => {
    const params = new URLSearchParams({ tab: 'reviews' });
    if (event.learnerId) params.set('id', event.learnerId);
    if (event.learnerType) params.set('kind', event.learnerType);
    if (event.enrolmentId) params.set('enrolmentId', event.enrolmentId);
    navigate(`/coach/learner-case-file?${params.toString()}`, {
      state: {
        learnerId: event.learnerId,
        learnerName: event.learner,
        kind: event.learnerType,
        enrolmentId: event.enrolmentId,
        tab: 'reviews',
      },
    });
  };

  const openEventInCalendar = (event: CoachCalendarEvent) => {
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

  const openMeeting = (event: CoachCalendarEvent) => {
    const url = meetingUrl(event);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
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
              {atRiskEvents.length > 0 ? `${atRiskEvents.length} overdue meeting${atRiskEvents.length === 1 ? '' : 's'}` : 'Everything is on track'}
            </button>
          )}
        />

        {error ? <EmptyState variant="error" title="Unable to load coaching meetings." description={error} /> : null}

        <Panel padding="none">
          <div className="border-b border-foreground-100 p-4">
            <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h3 className="text-[15px] font-semibold text-foreground-900">
                  {filter === 'this-month' ? selectedMonthLabel : FILTER_COPY[filter].label} coaching meetings
                </h3>
                <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-foreground-500">
                  {filter === 'this-month' ? monthFilterDescription : FILTER_COPY[filter].description}
                </p>
              </div>
              <div className="inline-flex w-full flex-wrap items-center gap-2 rounded-xl border border-foreground-100 bg-white p-1.5 shadow-sm sm:w-auto">
                <button
                  type="button"
                  onClick={() => changeMonth(addMonths(selectedMonth, -1))}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-primary-700 transition hover:bg-primary-50"
                  aria-label="Previous month"
                >
                  <AppIcon className="ri-arrow-left-s-line text-lg"></AppIcon>
                </button>
                <button
                  type="button"
                  onClick={() => changeMonth(startOfMonth())}
                  className={cn(
                    'inline-flex h-9 items-center justify-center rounded-lg px-3 text-[12px] font-bold transition',
                    selectedMonthIsCurrent ? 'bg-primary-600 text-white shadow-sm' : 'bg-primary-50 text-primary-700 hover:bg-primary-100',
                  )}
                >
                  Today
                </button>
                <span className="inline-flex h-9 min-w-36 items-center justify-center gap-2 rounded-lg px-3 text-[12px] font-bold text-foreground-900">
                  {selectedMonthLabel}
                </span>
                <button
                  type="button"
                  onClick={() => changeMonth(addMonths(selectedMonth, 1))}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-primary-700 transition hover:bg-primary-50"
                  aria-label="Next month"
                >
                  <AppIcon className="ri-arrow-right-s-line text-lg"></AppIcon>
                </button>
              </div>
            </div>
            <FilterToolbar
              className="mb-3 border-0 bg-transparent p-0 shadow-none"
              search={<SearchInput value={searchTerm} onChange={(value) => { setSearchTerm(value); setCurrentPage(1); }} placeholder="Search learner name..." ariaLabel="Search coaching meetings by learner" />}
              filters={<FilterSelect value={groupFilter} onChange={(value) => { setGroupFilter(value); setCurrentPage(1); }} options={groupFilterOptions} label="Group" icon="ri-group-line" widthClass="w-full sm:w-64" tone={groupFilter === ALL_GROUPS_FILTER ? 'default' : 'active'} />}
              trailing={<span className="whitespace-nowrap rounded-md bg-primary-50 px-3 py-1 text-[12px] font-bold text-primary-700">{filtered.length} {filtered.length === 1 ? 'meeting' : 'meetings'}</span>}
              chips={groupFilter !== ALL_GROUPS_FILTER ? <FilterChip label="Group/Cohort" value={groupFilterOptions.find(option => option.value === groupFilter)?.label.replace(/^(Group|Cohort):\s*/, '') || 'Selected'} onRemove={() => { setGroupFilter(ALL_GROUPS_FILTER); setCurrentPage(1); }} /> : null}
            />
            <PageTabs items={filterTabs} value={filter} onChange={(next) => changeFilter(next as MeetingFilter)} label="Filter coaching meetings by status" />
          </div>

          <div className="space-y-2 bg-background-100/55 p-3 sm:p-5">
            {loading ? <RowsSkeleton rows={6} /> : null}
            {!loading && !error && filtered.length === 0 ? (
              <EmptyState variant={tabFiltered.length === 0 ? 'empty' : 'no-matches'} icon={tabFiltered.length === 0 ? 'ri-calendar-check-line' : 'ri-user-search-line'} title={tabFiltered.length === 0 ? 'No coaching meetings found.' : 'No learner matches this search.'} />
            ) : null}

            {!loading && paginatedEvents.map(event => {
              const url = meetingUrl(event);
              return (
                <ActionRow
                  key={eventIdentity(event)}
                  tone={meetingTone(event)}
                  onClick={() => openDetails(event)}
                  leading={<LearnerAvatar name={event.learner} tone={meetingTone(event)} />}
                  title={event.learner || 'Unknown learner'}
                  subtitle={event.programme || event.email || 'Monthly coaching meeting'}
                  status={(
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge tone={statusTone(event.status)} label={statusLabel(event.status)} size="sm" />
                      {isAtRiskEvent(event) ? <StatusBadge tone="critical" label="Overdue" dot={false} size="sm" /> : null}
                      {isDueSoonEvent(event) ? <StatusBadge tone="upcoming" label="Due Soon" dot={false} size="sm" /> : null}
                    </span>
                  )}
                  meta={(
                    <>
                      <CalendarEventMeta icon="ri-calendar-line">{event.scheduledDate ? formatDateLabel(event.scheduledDate) : `Target ${formatDateLabel(event.targetDate)}`}</CalendarEventMeta>
                      <CalendarEventMeta icon="ri-time-line">{formatTimeLabel(event)}</CalendarEventMeta>
                      <CalendarEventMeta icon="ri-group-line">{event.group || event.cohort || '--'}</CalendarEventMeta>
                    </>
                  )}
                  actions={(
                    <div className="flex flex-wrap items-center gap-2" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                      <RowAction label="Calendar" icon="ri-calendar-schedule-line" emphasis="calendar" onClick={() => openEventInCalendar(event)} />
                      <RowAction label="Profile reviews" icon="ri-user-search-line" onClick={() => openLearnerReviews(event)} />
                      {url ? <RowAction label="Join" icon="ri-video-on-line" emphasis="meeting" onClick={() => openMeeting(event)} /> : null}
                      <RowAction label="View details" icon="ri-arrow-right-line" emphasis="primary" onClick={() => openDetails(event)} />
                    </div>
                  )}
                />
              );
            })}

            {!loading && pageCount > 1 ? (
              <Pagination page={activePage} totalPages={pageCount} total={filtered.length} pageSize={MEETINGS_PER_PAGE} onPageChange={setCurrentPage} noun="meetings" />
            ) : null}
          </div>
        </Panel>
      </PageContainer>
    </WorkspaceShell>
  );
}
