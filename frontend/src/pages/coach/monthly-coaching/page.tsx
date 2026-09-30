import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { openReviewInstanceForEvent } from '@/api/reviewInstances';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterSelect, SearchInput } from '@/components/ui/FilterToolbar';
import { PageContainer } from '@/components/ui/PageContainer';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { cn } from '@/lib/cn';
import type { StatusTone } from '@/lib/statusTone';
import { roleNavMap } from '@/mocks/navigation';
import { coachSessionKey, readCoachSessionCache, writeCoachSessionCache } from '@/features/coach/shared/coachSessionCache';
import { LearnerAvatar } from '../shared/LearnerIdentity';
import ProgressReviewPptxModal from '../progress-reviews/components/ProgressReviewPptxModal';
import { slidesTargetFromEvent } from '../progress-reviews/components/slidesTarget';
import { reviewInstancePath, reviewInstanceRouteState } from '../shared/reviewInstanceNavigation';
import {
  type CoachCalendarEvent,
  eventDisplayDate,
  eventIdentity,
  fetchCoachCalendarEvents,
  formatDateLabel,
  formatTimeRangeLabel,
  isAtRiskEvent,
  isCompletedEvent,
  isDueSoonEvent,
  isEventInMonth,
  isEventThisMonth,
  isInProgressEvent,
  isScheduledEvent,
  meetingUrl,
  needsScheduling,
  parseLocalDate,
  scheduleCoachCalendarEvent,
  sortEvents,
  statusLabel,
} from '../shared/calendarEvents';
import { normalizeResolvedReview, normalizeResolvedReviews, reviewActionMatrix } from '../shared/resolvedReviewRows';
import styles from '../shared/meetingTable.module.css';
import { MeetingActionsMenu } from './components/MeetingActionsMenu';
import { MeetingsHero } from './components/MeetingsHero';
import { MiniCalendar } from './components/MiniCalendar';
import { MonthlyStatsCard } from './components/MonthlyStatsCard';
import { MeetingStatusPill, StatusTabs, type StatusTabItem } from './components/StatusTabs';
import { formatMonthYear, getStatusCounts } from './meetingsView';

const coachNav = roleNavMap.coach;

type MeetingFilter = 'this-month' | 'at-risk' | 'due-soon' | 'needs-schedule' | 'scheduled' | 'in-progress' | 'awaiting-signature' | 'completed' | 'all';

const FILTER_COPY: Record<MeetingFilter, { label: string; description: string }> = {
  'this-month': { label: 'This Month', description: 'Monthly coaching meetings due or scheduled this month.' },
  'at-risk': { label: 'Overdue', description: 'Meetings whose target date has passed and still need scheduling.' },
  'due-soon': { label: 'Due Soon', description: 'Unscheduled meetings due within the next 14 days.' },
  'needs-schedule': { label: 'Not Scheduled', description: 'Meetings that still need their first calendar booking.' },
  scheduled: { label: 'Scheduled', description: 'Booked meetings waiting for confirmed attendance.' },
  'in-progress': { label: 'In Progress', description: 'Meetings with confirmed attendance or a manual start.' },
  'awaiting-signature': { label: 'Awaiting Signature', description: 'Meetings waiting for the learner or coach signature.' },
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
  const haystack = [event.learner, event.email, event.programme, event.cohort, event.group, event.learnerId, event.title, statusLabel(event.status)]
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
  return value && FILTER_VALUES.has(value as MeetingFilter) ? value as MeetingFilter : 'all';
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

function isoDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
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

function endOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0);
}

type MeetingView = 'list' | 'grid';

function viewFromQuery(value: string | null): MeetingView {
  return value === 'grid' ? 'grid' : 'list';
}

const actionButtonClass = 'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-primary-100 bg-white px-3 text-[12px] font-semibold text-primary-700 shadow-sm transition hover:border-primary-200 hover:bg-primary-50';

export default function CoachMonthlyCoaching() {
  const coach = useCoachIdentity();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<MeetingFilter>(() => filterFromQuery(searchParams.get('filter')));
  const [groupFilter, setGroupFilter] = useState(() => searchParams.get('group') || ALL_GROUPS_FILTER);
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('q') || '');
  const [selectedMonth, setSelectedMonth] = useState(() => monthFromQuery(searchParams.get('month')));
  const [currentPage, setCurrentPage] = useState(() => pageFromQuery(searchParams.get('page')));
  const [sortOrder, setSortOrder] = useState<'date-asc' | 'date-desc' | 'learner-asc'>('date-asc');
  const [viewMode, setViewMode] = useState<MeetingView>(() => viewFromQuery(searchParams.get('view')));
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleEventKey, setScheduleEventKey] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduleDuration, setScheduleDuration] = useState(60);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [slidesEvent, setSlidesEvent] = useState<CoachCalendarEvent | null>(null);
  const [slidesError, setSlidesError] = useState<string | null>(null);
  const cacheKey = coachSessionKey('monthly-coaching', coach.email, monthKey(selectedMonth));
  const initialCache = readCoachSessionCache<{ events: CoachCalendarEvent[]; ownerName: string }>(cacheKey);
  const [events, setEvents] = useState<CoachCalendarEvent[]>(() => initialCache?.events || []);
  const [ownerName, setOwnerName] = useState(() => initialCache?.ownerName || 'Coach');
  const [loading, setLoading] = useState(() => !initialCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('filter', filter);
    if (groupFilter !== ALL_GROUPS_FILTER) params.set('group', groupFilter);
    if (searchTerm.trim()) params.set('q', searchTerm.trim());
    if (monthKey(selectedMonth) !== monthKey(startOfMonth())) params.set('month', monthKey(selectedMonth));
    if (currentPage > 1) params.set('page', String(currentPage));
    if (viewMode === 'grid') params.set('view', 'grid');
    setSearchParams(params, { replace: true });
  }, [currentPage, filter, groupFilter, searchTerm, selectedMonth, setSearchParams, viewMode]);

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
    const cached = readCoachSessionCache<{ events: CoachCalendarEvent[]; ownerName: string }>(cacheKey);
    if (cached) {
      setEvents(cached.events);
      setOwnerName(cached.ownerName);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    fetchCoachCalendarEvents(controller.signal, {
        start: isoDate(startOfMonth(selectedMonth)),
        end: isoDate(endOfMonth(selectedMonth)),
        includeLiveSessions: false,
        includeSchedulerQueues: false,
      })
      .then((data) => {
        const nextEvents = sortEvents(normalizeResolvedReviews((data.events || []).filter(event => event.source === 'mcr')));
        const nextOwnerName = data.owner?.name || coach.name;
        writeCoachSessionCache(cacheKey, { events: nextEvents, ownerName: nextOwnerName });
        setEvents(nextEvents);
        setOwnerName(nextOwnerName);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (cached) return;
        setEvents([]);
        setError(err instanceof Error ? err.message : 'Unable to load coaching meetings.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cacheKey, coach.email, coach.isInitialized, coach.name, selectedMonth]);

  // selectedMonth is the single source for every month label, count, calendar
  // cell and table row on this page.
  const selectedMonthLabel = formatMonthYear(selectedMonth);
  const selectedMonthIsCurrent = monthKey(selectedMonth) === monthKey(startOfMonth());
  const monthEvents = events.filter(event => isEventInMonth(event, selectedMonth));
  const statusCounts = getStatusCounts(monthEvents);
  const learnerSuggestions = useMemo(() => Array.from(new Set(
    events.map(event => event.learner?.trim()).filter((learner): learner is string => Boolean(learner)),
  )).sort((a, b) => a.localeCompare(b)), [events]);
  const schedulableEvents = useMemo(
    () => events.filter(event => event.source === 'mcr' && !isCompletedEvent(event) && event.status !== 'cancelled'),
    [events],
  );
  const selectedScheduleEvent = schedulableEvents.find(event => eventIdentity(event) === scheduleEventKey) || null;

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
    if (!isEventInMonth(event, selectedMonth)) return false;
    if (filter === 'this-month') return isEventThisMonth(event, selectedMonth);
    if (filter === 'at-risk') return isAtRiskEvent(event);
    if (filter === 'due-soon') return isDueSoonEvent(event);
    if (filter === 'needs-schedule') return needsScheduling(event);
    if (filter === 'scheduled') return isScheduledEvent(event);
    if (filter === 'in-progress') return isInProgressEvent(event);
    if (filter === 'awaiting-signature') return event.status === 'awaiting-signature';
    if (filter === 'completed') return isCompletedEvent(event);
    return true;
  });
  const groupFiltered = groupFilter === ALL_GROUPS_FILTER
    ? tabFiltered
    : tabFiltered.filter(event => groupCohortFilterKey(event) === groupFilter);
  const filtered = searchTerm.trim()
    ? groupFiltered.filter(event => matchesMeetingSearch(event, searchTerm))
    : groupFiltered;
  const sortedFiltered = [...filtered].sort((a, b) => {
    if (sortOrder === 'learner-asc') return (a.learner || '').localeCompare(b.learner || '');
    const dateDifference = (parseLocalDate(eventDisplayDate(a))?.getTime() || 0) - (parseLocalDate(eventDisplayDate(b))?.getTime() || 0);
    return sortOrder === 'date-desc' ? -dateDifference : dateDifference;
  });
  const pageCount = Math.ceil(sortedFiltered.length / MEETINGS_PER_PAGE);
  const activePage = Math.min(currentPage, Math.max(pageCount, 1));
  const paginatedEvents = sortedFiltered.slice((activePage - 1) * MEETINGS_PER_PAGE, activePage * MEETINGS_PER_PAGE);

  useEffect(() => {
    if (!loading && activePage !== currentPage) setCurrentPage(activePage);
  }, [activePage, currentPage, loading]);

  const filterTabs: StatusTabItem[] = [
    { value: 'all', label: FILTER_COPY.all.label, count: statusCounts.total },
    { value: 'needs-schedule', label: FILTER_COPY['needs-schedule'].label, count: statusCounts['not-scheduled'], status: 'not-scheduled' },
    { value: 'scheduled', label: FILTER_COPY.scheduled.label, count: statusCounts.scheduled, status: 'scheduled' },
    { value: 'in-progress', label: FILTER_COPY['in-progress'].label, count: statusCounts['in-progress'], status: 'in-progress' },
    { value: 'awaiting-signature', label: FILTER_COPY['awaiting-signature'].label, count: statusCounts['awaiting-signature'], status: 'awaiting-signature' },
    { value: 'completed', label: FILTER_COPY.completed.label, count: statusCounts.completed, status: 'completed' },
  ];

  const changeFilter = (nextFilter: MeetingFilter) => {
    setFilter(nextFilter);
    setCurrentPage(1);
  };

  const changeMonth = (nextMonth: Date) => {
    setSelectedMonth(startOfMonth(nextMonth));
    setFilter('all');
    setCurrentPage(1);
  };

  const listUrl = () => {
    const query = new URLSearchParams();
    if (filter !== 'all') query.set('filter', filter);
    if (groupFilter !== ALL_GROUPS_FILTER) query.set('group', groupFilter);
    if (searchTerm.trim()) query.set('q', searchTerm.trim());
    if (monthKey(selectedMonth) !== monthKey(startOfMonth())) query.set('month', monthKey(selectedMonth));
    if (activePage > 1) query.set('page', String(activePage));
    if (viewMode === 'grid') query.set('view', 'grid');
    const queryString = query.toString();
    return `/coach/monthly-coaching${queryString ? `?${queryString}` : ''}`;
  };

  const openDetails = (event: CoachCalendarEvent) => {
    navigate(`/coach/meetings/${encodeURIComponent(eventIdentity(event))}`, { state: { returnTo: listUrl() } });
  };

  const openForm = async (event: CoachCalendarEvent) => {
    if (event.reviewInstanceId) {
      navigate(reviewInstancePath(event.reviewInstanceId), { state: reviewInstanceRouteState(event, listUrl()) });
      return;
    }
    if (event.aptemReviewId) {
      navigate(reviewInstancePath(eventIdentity(event)), { state: reviewInstanceRouteState(event, listUrl()) });
      return;
    }
    if (!event.reviewTemplateId) {
      openDetails(event);
      return;
    }
    try {
      const { instanceId } = await openReviewInstanceForEvent(eventIdentity(event));
      navigate(reviewInstancePath(instanceId), { state: reviewInstanceRouteState(event, listUrl()) });
    } catch {
      openDetails(event);
    }
  };

  const openMeeting = (event: CoachCalendarEvent) => {
    const url = meetingUrl(event);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  // The learner creates and edits their MCM slides; the coach views them.
  // enrolmentId, never learnerId: the slides API keys on the enrolment record.
  const viewSlides = (event: CoachCalendarEvent) => {
    if (!event.enrolmentId || !eventDisplayDate(event)) {
      setSlidesError('This meeting is missing its learner id or date, so slides cannot be generated yet.');
      return;
    }
    setSlidesError(null);
    setSlidesEvent(event);
  };

  const scheduleMeeting = (selectedEvent?: CoachCalendarEvent) => {
    const preferred = selectedEvent || schedulableEvents.find(event => needsScheduling(event)) || schedulableEvents[0];
    setScheduleEventKey(preferred ? eventIdentity(preferred) : '');
    setScheduleDate(preferred?.scheduledDate || preferred?.targetDate || isoDate(new Date()));
    setScheduleTime(preferred?.scheduledTime?.slice(0, 5) || '09:00');
    setScheduleDuration(preferred?.durationMinutes || 60);
    setScheduleError(null);
    setScheduleModalOpen(true);
  };

  const submitSchedule = async () => {
    if (!selectedScheduleEvent || !scheduleDate || !scheduleTime) return;
    setScheduleBusy(true);
    setScheduleError(null);
    try {
      const data = await scheduleCoachCalendarEvent(selectedScheduleEvent, {
        date: scheduleDate,
        time: scheduleTime,
        durationMinutes: scheduleDuration,
      });
      setEvents(current => current.map(event => eventIdentity(event) === eventIdentity(data.event) ? normalizeResolvedReview(data.event) : event));
      setScheduleModalOpen(false);
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Unable to schedule this meeting.');
    } finally {
      setScheduleBusy(false);
    }
  };

  // Cell renderers shared by the table rows and the grid cards.
  // Table rows keep the full email on one line; grid cards truncate it.
  const renderLearner = (event: CoachCalendarEvent, inTable = false) => (
    <div className="flex min-w-0 items-center gap-3"><LearnerAvatar name={event.learner} tone={meetingTone(event)} /><div className="min-w-0 text-left"><strong className={cn('block text-[13px] font-bold text-[#17113A]', !inTable && 'truncate')}>{event.learner || 'Unknown learner'}</strong><span title={event.email || undefined} className={cn('block text-[11px] text-[#6B6385]', inTable ? styles.learnerEmail : 'truncate')}>{event.email || 'Monthly coaching meeting'}</span></div></div>
  );

  // In the table the name is small and wraps to two lines so the actions fit.
  const renderProgramme = (event: CoachCalendarEvent, inTable = false) => (
    <span title={event.programme || undefined} className={cn('inline-flex gap-1.5', inTable ? 'max-w-[170px] items-start text-[12px] leading-snug' : 'items-center whitespace-nowrap')}><AppIcon className={cn('ri-book-open-line shrink-0 text-primary-500', inTable && 'mt-0.5')} /><span className={inTable ? 'line-clamp-2' : undefined}>{event.programme || '--'}</span></span>
  );

  const renderCohort = (event: CoachCalendarEvent) => (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><AppIcon className="ri-group-line text-primary-500" />{event.cohort || event.group || '--'}</span>
  );

  const renderDateTime = (event: CoachCalendarEvent) => (
    <span className="inline-flex min-w-[150px] flex-col gap-1"><span className="flex items-center gap-1.5 whitespace-nowrap font-semibold text-[#17113A]"><AppIcon className="ri-calendar-line shrink-0 text-primary-500" />{event.scheduledDate ? formatDateLabel(event.scheduledDate) : formatDateLabel(event.targetDate)}</span><span className="flex items-center gap-1.5 whitespace-nowrap text-foreground-500"><AppIcon className="ri-time-line shrink-0 text-primary-500" />{formatTimeRangeLabel(event)}</span></span>
  );

  const renderStatus = (event: CoachCalendarEvent) => (
    <div className="flex flex-wrap gap-1.5"><MeetingStatusPill event={event} />{isAtRiskEvent(event) ? <StatusBadge tone="critical" label="Overdue" dot={false} size="sm" /> : null}{isDueSoonEvent(event) ? <StatusBadge tone="upcoming" label="Due Soon" dot={false} size="sm" /> : null}</div>
  );

  const renderSchedule = (event: CoachCalendarEvent, hideEmpty = false) => {
    const { schedule } = reviewActionMatrix(event);
    if (schedule) return <button type="button" onClick={() => scheduleMeeting(event)} className={actionButtonClass}><AppIcon className="ri-calendar-schedule-line" />{schedule}</button>;
    return hideEmpty ? null : <span className="text-foreground-300" aria-hidden="true">—</span>;
  };

  const renderActionButtons = (event: CoachCalendarEvent, inTable = false) => {
    const actions = reviewActionMatrix(event);
    return (
      <div className={cn('flex items-center gap-1.5', inTable ? 'flex-nowrap justify-end' : 'flex-wrap', styles.rowActions)}>
        {actions.viewForm ? <button type="button" onClick={() => { void openForm(event); }} className={actionButtonClass}><AppIcon className="ri-file-edit-line" />View Form</button> : null}
        {actions.presentation ? <button type="button" onClick={() => viewSlides(event)} className={actionButtonClass}><AppIcon className="ri-slideshow-2-line" />View Slides</button> : null}
        {actions.join ? <button type="button" onClick={() => openMeeting(event)} className={cn(actionButtonClass, 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100')}><AppIcon className="ri-video-on-line" />Join</button> : null}
        <button type="button" aria-label="View" title="View" onClick={() => openDetails(event)} className={cn(actionButtonClass, 'justify-center', styles.iconAction)}><AppIcon className="ri-eye-line" /></button>
        <MeetingActionsMenu learner={event.learner || 'this learner'} meetingLink={meetingUrl(event) || undefined} onEdit={actions.schedule ? () => scheduleMeeting(event) : undefined} />
      </div>
    );
  };

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Monthly Coaching Meetings" pageSubtitle="Schedule and manage coaching sessions" userName={ownerName} userRole="Progress Coach">
      <PageContainer>
        {error ? <EmptyState variant="error" title="Unable to load coaching meetings." description={error} /> : null}

        <div className="space-y-4">
          <MeetingsHero monthLabel={selectedMonthLabel} />

          <section aria-label="Meeting controls" className="rounded-[20px] border border-primary-100 bg-white p-4 shadow-[0_10px_30px_-22px_rgb(76_29_149/0.4)] md:p-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2" aria-label="Meeting month">
                <button type="button" onClick={() => changeMonth(addMonths(selectedMonth, -1))} className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary-100 bg-white text-primary-700 shadow-sm transition hover:bg-primary-50" aria-label="Previous month"><AppIcon className="ri-arrow-left-s-line text-lg" /></button>
                <label className="relative inline-flex h-10 min-w-44 cursor-pointer items-center justify-center gap-2 rounded-xl border border-primary-100 bg-white px-3 text-[14px] font-bold text-primary-900 shadow-sm transition hover:bg-primary-50">
                  <AppIcon className="ri-calendar-line text-primary-600" />{selectedMonthLabel}<AppIcon className="ri-arrow-down-s-line text-foreground-400" />
                  <input type="month" aria-label="Choose month" value={monthKey(selectedMonth)}
                    onClick={(event) => { try { event.currentTarget.showPicker?.(); } catch { /* picker unsupported; typing still works */ } }}
                    onChange={(event) => { if (event.target.value) changeMonth(monthFromQuery(event.target.value)); }}
                    className="absolute inset-0 cursor-pointer opacity-0" />
                </label>
                <button type="button" onClick={() => changeMonth(addMonths(selectedMonth, 1))} className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary-100 bg-white text-primary-700 shadow-sm transition hover:bg-primary-50" aria-label="Next month"><AppIcon className="ri-arrow-right-s-line text-lg" /></button>
                {!selectedMonthIsCurrent ? <button type="button" onClick={() => changeMonth(startOfMonth())} className="h-10 rounded-xl border border-primary-200 bg-primary-50 px-3 text-[12px] font-semibold text-primary-700 transition hover:bg-primary-100">Today</button> : null}
              </div>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:flex-nowrap xl:justify-end">
                <div className="w-full sm:w-80"><SearchInput value={searchTerm} suggestions={learnerSuggestions} onChange={(value) => { setSearchTerm(value); setCurrentPage(1); }} placeholder="Search learner name, cohort or meeting type..." ariaLabel="Search coaching meetings by learner" /></div>
                <FilterSelect value={groupFilter} onChange={(value) => { setGroupFilter(value); setCurrentPage(1); }} options={groupFilterOptions} label="Group" icon="ri-group-line" widthClass="w-full sm:w-64" tone={groupFilter === ALL_GROUPS_FILTER ? 'default' : 'active'} />
                <button type="button" onClick={() => scheduleMeeting()} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary-700 px-5 text-[13px] font-bold text-white shadow-[0_10px_20px_-10px_rgb(76_29_149/0.8)] transition hover:-translate-y-px hover:bg-primary-800"><AppIcon className="ri-add-line text-lg" />Schedule meeting</button>
              </div>
            </div>
            <div className="mt-4 border-t border-primary-50 pt-4">
              <StatusTabs items={filterTabs} value={filter} onChange={(next) => changeFilter(next as MeetingFilter)} label="Filter coaching meetings by status" />
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <section aria-label="Coaching meetings" className="min-w-0 rounded-[20px] border border-primary-100 bg-white p-4 shadow-[0_10px_30px_-22px_rgb(76_29_149/0.4)] md:p-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div><h3 className="text-[17px] font-bold text-[#17113A]">{sortedFiltered.length} coaching meeting{sortedFiltered.length === 1 ? '' : 's'}</h3><p className="text-[12px] text-[#6B6385]">{filter === 'this-month' || filter === 'all' ? `Meetings due or scheduled in ${selectedMonthLabel}.` : FILTER_COPY[filter].description}</p></div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-[12px] font-semibold text-foreground-600">Sort by<select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)} className="h-10 rounded-xl border border-primary-100 bg-white px-3 font-semibold text-foreground-700 outline-none focus:border-primary-400"><option value="date-asc">Date (soonest first)</option><option value="date-desc">Date (latest first)</option><option value="learner-asc">Learner (A-Z)</option></select></label>
                  <div className="flex rounded-xl border border-primary-100 p-0.5" role="group" aria-label="Meeting layout">
                    {([['list', 'ri-list-check', 'List view'], ['grid', 'ri-layout-grid-line', 'Grid view']] as const).map(([mode, icon, label]) => (
                      <button key={mode} type="button" aria-label={label} aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}
                        className={cn('flex h-8 w-9 items-center justify-center rounded-lg text-[15px] transition', viewMode === mode ? 'bg-primary-700 text-white shadow-sm' : 'text-primary-700 hover:bg-primary-50')}><AppIcon className={icon} /></button>
                    ))}
                  </div>
                </div>
              </div>
              {loading ? <RowsSkeleton rows={6} /> : null}
              {!loading && !error && sortedFiltered.length === 0 ? (
                monthEvents.length === 0
                  ? <EmptyState variant="empty" icon="ri-calendar-check-line" title="No meetings found for this month." description="Try changing the filters or schedule a new meeting." />
                  : <EmptyState variant="no-matches" icon="ri-user-search-line" title="No matching meetings found." description="Try a different search, status or group." />
              ) : null}
              {!loading && sortedFiltered.length > 0 && viewMode === 'list' ? <div className="overflow-x-auto rounded-2xl border border-primary-100">
                <table className={cn('w-full min-w-[1080px] border-collapse text-left', styles.meetingTable)}>
                  <caption className="sr-only">Coaching meetings for {selectedMonthLabel}</caption>
                  <thead><tr className="bg-[#F7F4FF] text-[11px] font-bold uppercase tracking-wide text-[#6B6385]"><th className="whitespace-nowrap px-4 py-3 align-middle">Learner</th><th className="whitespace-nowrap px-4 py-3 align-middle">Programme</th><th className="whitespace-nowrap px-4 py-3 align-middle">Date &amp; time</th><th className="whitespace-nowrap px-4 py-3 align-middle">Status</th><th className="whitespace-nowrap px-4 py-3 align-middle">Schedule</th><th className="whitespace-nowrap px-4 py-3 text-right align-middle">Actions</th></tr></thead>
                  <tbody>{paginatedEvents.map(event => (
                    <tr key={eventIdentity(event)} className="ui-action-row cursor-pointer border-t border-primary-50 transition hover:bg-[#F7F4FF]" onClick={() => openDetails(event)}>
                      <td className="px-4 py-3 align-middle">{renderLearner(event, true)}</td>
                      <td className="px-4 py-3 align-middle text-[12px] text-foreground-700">{renderProgramme(event, true)}</td>
                      <td className="whitespace-nowrap px-4 py-3 align-middle text-[12px] text-foreground-700">{renderDateTime(event)}</td>
                      <td className="px-4 py-3 align-middle">{renderStatus(event)}</td>
                      <td className={cn('px-4 py-3 align-middle', styles.rowActions)} onClick={(clickEvent) => clickEvent.stopPropagation()}>{renderSchedule(event)}</td>
                      <td className="whitespace-nowrap px-4 py-3 align-middle" onClick={(clickEvent) => clickEvent.stopPropagation()}>{renderActionButtons(event, true)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div> : null}
              {!loading && sortedFiltered.length > 0 && viewMode === 'grid' ? <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-label={`Coaching meetings for ${selectedMonthLabel}`}>
                {paginatedEvents.map(event => (
                  <li key={eventIdentity(event)} className="ui-action-row flex cursor-pointer flex-col gap-3 rounded-2xl border border-primary-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md" onClick={() => openDetails(event)}>
                    <div className="flex items-start justify-between gap-2">{renderLearner(event)}{renderStatus(event)}</div>
                    <div className="grid gap-2 text-[12px] text-foreground-700">{renderProgramme(event)}{renderCohort(event)}{renderDateTime(event)}</div>
                    <div className={cn('flex flex-wrap items-center gap-1.5 border-t border-primary-50 pt-3', styles.rowActions)} onClick={(clickEvent) => clickEvent.stopPropagation()}>{renderSchedule(event, true)}{renderActionButtons(event)}</div>
                  </li>
                ))}
              </ul> : null}
              {!loading && sortedFiltered.length > 0 ? <div className="mt-4 flex flex-col gap-3 text-[12px] text-foreground-500 sm:flex-row sm:items-center sm:justify-between"><span>Showing {Math.min(sortedFiltered.length, paginatedEvents.length)} of {sortedFiltered.length} meetings</span>{pageCount > 1 ? <Pagination page={activePage} totalPages={pageCount} total={sortedFiltered.length} pageSize={MEETINGS_PER_PAGE} onPageChange={setCurrentPage} noun="meetings" /> : null}</div> : null}
              {slidesError ? <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">{slidesError}</p> : null}
            </section>

            <aside className="grid content-start gap-4 md:grid-cols-2 xl:grid-cols-1" aria-label="Monthly overview">
              <MiniCalendar month={selectedMonth} events={monthEvents} onMonthChange={(offset) => changeMonth(addMonths(selectedMonth, offset))} />
              <MonthlyStatsCard counts={statusCounts} monthLabel={selectedMonthLabel} showAllStatuses />
            </aside>
          </div>
        </div>
        {slidesEvent ? (
          <ProgressReviewPptxModal kind="mcm" access="viewer" open target={slidesTargetFromEvent(slidesEvent)} onClose={() => setSlidesEvent(null)} />
        ) : null}
      </PageContainer>
      {scheduleModalOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={() => { if (!scheduleBusy) setScheduleModalOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="schedule-meeting-title" className="w-full max-w-[620px] rounded-2xl border border-foreground-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-foreground-100 px-5 py-4">
              <div><p className="text-[11px] font-semibold uppercase tracking-wide text-primary-600">Microsoft Teams booking</p><h2 id="schedule-meeting-title" className="mt-1 text-[20px] font-bold text-foreground-900">Schedule meeting</h2><p className="mt-1 text-[12px] text-foreground-500">Choose the learner and meeting details. The Teams meeting will be created after saving.</p></div>
              <button type="button" aria-label="Close schedule meeting" disabled={scheduleBusy} onClick={() => setScheduleModalOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-400 hover:bg-foreground-50"><AppIcon className="ri-close-line text-lg" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <label className="block text-[12px] font-semibold text-foreground-700">Learner<select value={scheduleEventKey} onChange={(event) => { const next = schedulableEvents.find(item => eventIdentity(item) === event.target.value); setScheduleEventKey(event.target.value); setScheduleDate(next?.scheduledDate || next?.targetDate || isoDate(new Date())); setScheduleTime(next?.scheduledTime?.slice(0, 5) || '09:00'); setScheduleDuration(next?.durationMinutes || 60); }} className="mt-1 h-10 w-full rounded-lg border border-foreground-200 bg-white px-3 text-[13px] font-medium text-foreground-800 outline-none focus:border-primary-400"><option value="" disabled>Select learner</option>{schedulableEvents.map(event => <option key={eventIdentity(event)} value={eventIdentity(event)}>{event.learner || 'Unknown learner'}{event.group ? ` · ${event.group}` : ''}</option>)}</select></label>
              {selectedScheduleEvent ? <div className="rounded-lg border border-primary-100 bg-primary-50/60 px-3 py-2 text-[12px] text-primary-900"><span className="font-semibold">Meeting:</span> {selectedScheduleEvent.title || 'Monthly coaching meeting'}<span className="mx-2 text-primary-300">•</span><span>{selectedScheduleEvent.programme || 'Monthly coaching'}</span></div> : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><label className="text-[12px] font-semibold text-foreground-700">Date<input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-foreground-200 px-3 text-[13px] font-medium outline-none focus:border-primary-400" /></label><label className="text-[12px] font-semibold text-foreground-700">Start time<input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-foreground-200 px-3 text-[13px] font-medium outline-none focus:border-primary-400" /></label><label className="text-[12px] font-semibold text-foreground-700">Duration<select value={scheduleDuration} onChange={(event) => setScheduleDuration(Number(event.target.value))} className="mt-1 h-10 w-full rounded-lg border border-foreground-200 bg-white px-3 text-[13px] font-medium outline-none focus:border-primary-400"><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option><option value={90}>90 minutes</option><option value={120}>120 minutes</option></select></label></div>
              {scheduleError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">{scheduleError}</p> : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-foreground-100 px-5 py-4"><button type="button" disabled={scheduleBusy} onClick={() => setScheduleModalOpen(false)} className="h-10 rounded-lg border border-foreground-200 px-4 text-[12px] font-semibold text-foreground-700 hover:bg-foreground-50">Cancel</button><button type="button" disabled={scheduleBusy || !selectedScheduleEvent || !scheduleDate || !scheduleTime} onClick={() => { void submitSchedule(); }} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-700 px-4 text-[12px] font-bold text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60"><AppIcon className={scheduleBusy ? 'ri-loader-4-line animate-spin' : 'ri-calendar-check-line'} />{scheduleBusy ? 'Scheduling...' : 'Schedule meeting'}</button></div>
          </div>
        </div>
      ) : null}
    </WorkspaceShell>
  );
}
