import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { openReviewInstanceForEvent } from '@/api/reviewInstances';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterSelect, SearchInput } from '@/components/ui/FilterToolbar';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageTabs, type PageTabItem } from '@/components/ui/PageTabs';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { cn } from '@/lib/cn';
import { type StatusTone } from '@/lib/statusTone';
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
import { MeetingActionsMenu } from './components/MeetingActionsMenu';
import styles from './monthlyCoaching.module.css';

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
const CALENDAR_IMAGE_URL = `${import.meta.env.BASE_URL}coach-meetings-calendar.webp`;
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

function monthLabel(value: Date) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(value);
}

export default function CoachMonthlyCoaching() {
  const coach = useCoachIdentity();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<MeetingFilter>(() => filterFromQuery(searchParams.get('filter')));
  const [groupFilter, setGroupFilter] = useState(() => searchParams.get('group') || ALL_GROUPS_FILTER);
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('q') || '');
  const [selectedMonth, setSelectedMonth] = useState(() => monthFromQuery(searchParams.get('month')));
  const [allMonths, setAllMonths] = useState(() => searchParams.get('months') === 'all');
  const [currentPage, setCurrentPage] = useState(() => pageFromQuery(searchParams.get('page')));
  const [sortOrder, setSortOrder] = useState<'date-asc' | 'date-desc' | 'learner-asc'>('date-desc');
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleEventKey, setScheduleEventKey] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduleDuration, setScheduleDuration] = useState(60);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [slidesEvent, setSlidesEvent] = useState<CoachCalendarEvent | null>(null);
  const [slidesError, setSlidesError] = useState<string | null>(null);
  const cacheKey = coachSessionKey('monthly-coaching', coach.email, 'all-months');
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
    if (allMonths) params.set('months', 'all');
    else if (monthKey(selectedMonth) !== monthKey(startOfMonth())) params.set('month', monthKey(selectedMonth));
    if (currentPage > 1) params.set('page', String(currentPage));
    setSearchParams(params, { replace: true });
  }, [allMonths, currentPage, filter, groupFilter, searchTerm, selectedMonth, setSearchParams]);

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
  }, [cacheKey, coach.email, coach.isInitialized, coach.name]);

  const selectedMonthLabel = allMonths ? 'All months' : monthLabel(selectedMonth);
  const selectedMonthIsCurrent = !allMonths && monthKey(selectedMonth) === monthKey(startOfMonth());
  const monthFilterDescription = `Monthly coaching meetings due or scheduled in ${selectedMonthLabel}.`;
  const monthEvents = allMonths ? events : events.filter(event => isEventInMonth(event, selectedMonth));
  const needsScheduleEvents = monthEvents.filter(needsScheduling);
  const scheduledEvents = monthEvents.filter(event => isScheduledEvent(event));
  const inProgressEvents = monthEvents.filter(event => isInProgressEvent(event));
  const awaitingSignatureEvents = monthEvents.filter(event => event.status === 'awaiting-signature');
  const completedEvents = monthEvents.filter(event => isCompletedEvent(event));
  const learnerSuggestions = useMemo(() => Array.from(new Set(
    events.map(event => event.learner?.trim()).filter((learner): learner is string => Boolean(learner)),
  )).sort((a, b) => a.localeCompare(b)), [events]);
  const schedulableEvents = useMemo(
    () => events.filter(event => event.source === 'mcr' && event.reviewSource !== 'aptem' && !event.aptemReviewId && !isCompletedEvent(event) && event.status !== 'cancelled'),
    [events],
  );
  const selectedScheduleEvent = schedulableEvents.find(event => eventIdentity(event) === scheduleEventKey) || null;
  // Each learner can have many future MCR occurrences still needing a slot; without
  // this, the "+Schedule meeting" dropdown lists every one of them and the same
  // learner name repeats many times, looking like duplicate entries. Collapse to
  // the one occurrence per learner a coach would pick next (the soonest one still
  // needing scheduling), while keeping a row's own "Schedule" action -- which can
  // target a later occurrence directly -- selectable even if it isn't that pick.
  const scheduleDropdownOptions = useMemo(() => {
    const byLearner = new Map<string, CoachCalendarEvent>();
    for (const event of schedulableEvents) {
      const key = event.learnerId || event.learner || eventIdentity(event);
      const current = byLearner.get(key);
      if (!current) {
        byLearner.set(key, event);
        continue;
      }
      const currentNeeds = needsScheduling(current);
      const eventNeeds = needsScheduling(event);
      if (eventNeeds !== currentNeeds) {
        if (eventNeeds) byLearner.set(key, event);
        continue;
      }
      const currentDate = parseLocalDate(eventDisplayDate(current));
      const eventDate = parseLocalDate(eventDisplayDate(event));
      if (eventDate && (!currentDate || eventDate < currentDate)) byLearner.set(key, event);
    }
    const options = Array.from(byLearner.values());
    if (scheduleEventKey && !options.some(event => eventIdentity(event) === scheduleEventKey)) {
      const selected = schedulableEvents.find(event => eventIdentity(event) === scheduleEventKey);
      if (selected) options.push(selected);
    }
    return options.sort((a, b) => (a.learner || '').localeCompare(b.learner || ''));
  }, [schedulableEvents, scheduleEventKey]);

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
    if (!allMonths && !isEventInMonth(event, selectedMonth)) return false;
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
    const aDate = parseLocalDate(eventDisplayDate(a))?.getTime();
    const bDate = parseLocalDate(eventDisplayDate(b))?.getTime();
    if (aDate == null) return bDate == null ? 0 : 1;
    if (bDate == null) return -1;
    return sortOrder === 'date-desc' ? bDate - aDate : aDate - bDate;
  });
  const pageCount = Math.ceil(sortedFiltered.length / MEETINGS_PER_PAGE);
  const activePage = Math.min(currentPage, Math.max(pageCount, 1));
  const paginatedEvents = sortedFiltered.slice((activePage - 1) * MEETINGS_PER_PAGE, activePage * MEETINGS_PER_PAGE);

  useEffect(() => {
    if (!loading && activePage !== currentPage) setCurrentPage(activePage);
  }, [activePage, currentPage, loading]);

  const filterTabs: PageTabItem[] = [
    { value: 'all', label: FILTER_COPY.all.label, count: monthEvents.length },
    { value: 'needs-schedule', label: FILTER_COPY['needs-schedule'].label, count: needsScheduleEvents.length, tone: 'caution' },
    { value: 'scheduled', label: FILTER_COPY.scheduled.label, count: scheduledEvents.length, tone: 'info' },
    { value: 'in-progress', label: FILTER_COPY['in-progress'].label, count: inProgressEvents.length, tone: 'info' },
    { value: 'awaiting-signature', label: FILTER_COPY['awaiting-signature'].label, count: awaitingSignatureEvents.length, tone: 'upcoming' },
    { value: 'completed', label: FILTER_COPY.completed.label, count: completedEvents.length, tone: 'positive' },
  ];

  const changeFilter = (nextFilter: MeetingFilter) => {
    setFilter(nextFilter);
    setCurrentPage(1);
  };

  const changeMonth = (nextMonth: Date) => {
    setAllMonths(false);
    setSelectedMonth(startOfMonth(nextMonth));
    setFilter('all');
    setCurrentPage(1);
  };

  const showAllMonths = () => {
    setAllMonths(true);
    setFilter('all');
    setCurrentPage(1);
  };

  const listUrl = () => {
    const query = new URLSearchParams();
    if (filter !== 'all') query.set('filter', filter);
    if (groupFilter !== ALL_GROUPS_FILTER) query.set('group', groupFilter);
    if (searchTerm.trim()) query.set('q', searchTerm.trim());
    if (allMonths) query.set('months', 'all');
    else if (monthKey(selectedMonth) !== monthKey(startOfMonth())) query.set('month', monthKey(selectedMonth));
    if (activePage > 1) query.set('page', String(activePage));
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

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Monthly Coaching Meetings" pageSubtitle="Schedule and manage coaching sessions" userName={ownerName} userRole="Progress Coach">
      <PageContainer className={styles.page}>
        <section className={styles.banner} aria-label="Monthly coaching support">
          <span aria-hidden="true" className={styles.dots} />
          <svg aria-hidden="true" className={styles.waves} viewBox="0 0 800 200" preserveAspectRatio="none">
            <defs>
              <linearGradient id="monthly-coaching-wave-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--banner-wave-a)" stopOpacity="0" /><stop offset="1" stopColor="var(--banner-wave-a)" stopOpacity=".28" /></linearGradient>
              <linearGradient id="monthly-coaching-wave-b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="var(--banner-wave-b)" stopOpacity="0" /><stop offset="1" stopColor="var(--banner-wave-b)" stopOpacity=".24" /></linearGradient>
              <linearGradient id="monthly-coaching-wave-c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="var(--banner-wave-c)" stopOpacity="0" /><stop offset="1" stopColor="var(--banner-wave-c)" stopOpacity=".22" /></linearGradient>
            </defs>
            <path d="M0 200 C 180 200 260 60 430 70 S 650 170 800 120 L 800 200 Z" fill="url(#monthly-coaching-wave-a)" />
            <path d="M120 200 C 300 190 380 20 560 30 S 720 110 800 60 L 800 200 Z" fill="url(#monthly-coaching-wave-b)" />
            <path d="M340 200 C 470 170 560 110 680 130 S 770 170 800 150 L 800 200 Z" fill="url(#monthly-coaching-wave-c)" />
            <path d="M60 170 C 240 160 330 40 500 50 S 700 140 800 95" fill="none" stroke="var(--banner-wave-line)" strokeWidth="1.5" />
          </svg>
          <span aria-hidden="true" className={styles.glow} />
          <div>
            <h2>Support. Progress. Succeed.</h2>
            <p>Meaningful conversations help learners stay on track and reach their goals.</p>
          </div>
          <img src={CALENDAR_IMAGE_URL} alt="" aria-hidden="true" width={312} height={312} />
        </section>
        {error ? <EmptyState variant="error" title="Unable to load coaching meetings." description={error} /> : null}
        <section className={styles.controlsCard} aria-label="Coaching meeting filters and summary">
          <div className={styles.toolbar}>
          <div className={styles.monthNav} aria-label="Meeting month">
            <button type="button" onClick={() => changeMonth(addMonths(selectedMonth, -1))} aria-label="Previous month"><AppIcon className="ri-arrow-left-s-line text-xl" /></button>
            <span>{monthLabel(selectedMonth)}</span>
            <button type="button" onClick={() => changeMonth(addMonths(selectedMonth, 1))} aria-label="Next month"><AppIcon className="ri-arrow-right-s-line text-xl" /></button>
          </div>
          <button type="button" onClick={showAllMonths} aria-pressed={allMonths} className={styles.control}>All months<AppIcon className="ri-arrow-down-s-line" /></button>
          {!selectedMonthIsCurrent ? <button type="button" onClick={() => changeMonth(startOfMonth())} className={styles.control}>Today</button> : null}
          <SearchInput className={styles.search} value={searchTerm} suggestions={learnerSuggestions} onChange={(value) => { setSearchTerm(value); setCurrentPage(1); }} placeholder="Search learners..." ariaLabel="Search coaching meetings by learner" />
          <FilterSelect value={groupFilter} onChange={(value) => { setGroupFilter(value); setCurrentPage(1); }} options={groupFilterOptions} label="Group" widthClass={styles.group} tone={groupFilter === ALL_GROUPS_FILTER ? 'default' : 'active'} />
          <button type="button" onClick={() => scheduleMeeting()} className={cn(styles.control, styles.primary)}><AppIcon className="ri-add-line text-xl" />Schedule meeting</button>
          </div>
          <PageTabs className={styles.tabs} items={filterTabs} value={filter} onChange={(next) => changeFilter(next as MeetingFilter)} label="Filter coaching meetings by status" />
          <div className={styles.listMeta}>
            <div><h3>{sortedFiltered.length} coaching meeting{sortedFiltered.length === 1 ? '' : 's'}</h3><p>{allMonths && filter === 'all' ? 'Past and upcoming coaching meetings across all months.' : filter === 'this-month' || filter === 'all' ? monthFilterDescription : FILTER_COPY[filter].description}</p></div>
            <label className="flex items-center gap-2 text-[13px] text-foreground-500">Sort by<select value={sortOrder} onChange={(event) => { setSortOrder(event.target.value as typeof sortOrder); setCurrentPage(1); }} className="rounded-lg border border-foreground-200 bg-white px-3 font-semibold text-foreground-700"><option value="date-asc">Date (earliest first)</option><option value="date-desc">Date (latest first)</option><option value="learner-asc">Learner (A-Z)</option></select></label>
          </div>
        </section>
        <div>
          {loading ? <RowsSkeleton rows={6} /> : null}
          {!loading && !error && sortedFiltered.length === 0 ? <EmptyState variant={tabFiltered.length === 0 ? 'empty' : 'no-matches'} icon={tabFiltered.length === 0 ? 'ri-calendar-check-line' : 'ri-user-search-line'} title={tabFiltered.length === 0 ? 'No coaching meetings found.' : 'No learner matches this search.'} /> : null}
          {!loading && sortedFiltered.length > 0 ? (
            <div className={styles.tableScroll} role="region" aria-label="Coaching meetings table; scroll horizontally on smaller screens" tabIndex={0}>
              <table className={styles.table}>
                <caption className="sr-only">Coaching meetings for {selectedMonthLabel}</caption>
                <colgroup><col /><col /><col /><col /><col /><col /></colgroup>
                <thead><tr><th scope="col">Learner</th><th scope="col">Programme</th><th scope="col">Cohort</th><th scope="col">Date &amp; time</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
                <tbody>{paginatedEvents.map(event => {
                  const actions = reviewActionMatrix(event);
                  const statusIcon = event.status === 'completed' ? 'ri-checkbox-circle-line' : event.status === 'scheduled' ? 'ri-calendar-line' : event.status === 'awaiting-signature' ? 'ri-edit-line' : 'ri-time-line';
                  return (
                    <tr key={eventIdentity(event)} className="ui-action-row" onClick={() => openDetails(event)}>
                      <td><div className={styles.identity}><LearnerAvatar name={event.learner} tone={meetingTone(event)} size="lg" /><div><strong className={styles.learnerName}>{event.learner || 'Unknown learner'}</strong><span className={styles.learnerEmail}>{event.email || '--'}</span></div></div></td>
                      <td>{event.programme || '--'}</td>
                      <td>{event.cohort || event.group || '--'}</td>
                      <td><span className={styles.date}><span>{formatDateLabel(event.scheduledDate || event.targetDate)}</span><span>{formatTimeRangeLabel(event)}</span></span></td>
                      <td>
                        <span className={styles.status} data-status={event.status}><AppIcon className={statusIcon} />{statusLabel(event.status)}</span>
                        {isAtRiskEvent(event) || isDueSoonEvent(event) ? <div className={styles.alerts}>{isAtRiskEvent(event) ? <StatusBadge tone="critical" label="Overdue" dot={false} size="sm" /> : null}{isDueSoonEvent(event) ? <StatusBadge tone="upcoming" label="Due Soon" dot={false} size="sm" /> : null}</div> : null}
                      </td>
                      <td onClick={(clickEvent) => clickEvent.stopPropagation()}>
                        <div className={styles.actions}>
                          {actions.viewForm ? <button type="button" onClick={() => { void openForm(event); }} className={cn(styles.control, styles.primary, styles.formButton)}>View form</button> : null}
                          <MeetingActionsMenu learner={event.learner || 'Unknown learner'} actions={[
                            ...(actions.view ? [{ label: 'View details', icon: 'ri-eye-line', onSelect: () => openDetails(event) }] : []),
                            ...(actions.presentation && eventDisplayDate(event) ? [{ label: 'View slides', icon: 'ri-file-text-line', onSelect: () => viewSlides(event) }] : []),
                            ...(actions.schedule ? [{ label: actions.schedule, icon: 'ri-calendar-line', onSelect: () => scheduleMeeting(event) }] : []),
                            ...(actions.join ? [{ label: 'Join', icon: 'ri-video-on-line', onSelect: () => openMeeting(event) }] : []),
                          ]} />
                        </div>
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          ) : null}
          {!loading && sortedFiltered.length > 0 ? <div className={styles.footer}><span>Showing {Math.min(sortedFiltered.length, paginatedEvents.length)} of {sortedFiltered.length} meetings</span>{pageCount > 1 ? <Pagination page={activePage} totalPages={pageCount} total={sortedFiltered.length} pageSize={MEETINGS_PER_PAGE} onPageChange={setCurrentPage} noun="meetings" /> : null}</div> : null}
          {slidesError ? <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">{slidesError}</p> : null}
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
              <label className="block text-[12px] font-semibold text-foreground-700">Learner<select value={scheduleEventKey} onChange={(event) => { const next = schedulableEvents.find(item => eventIdentity(item) === event.target.value); setScheduleEventKey(event.target.value); setScheduleDate(next?.scheduledDate || next?.targetDate || isoDate(new Date())); setScheduleTime(next?.scheduledTime?.slice(0, 5) || '09:00'); setScheduleDuration(next?.durationMinutes || 60); }} className="mt-1 h-10 w-full rounded-lg border border-foreground-200 bg-white px-3 text-[13px] font-medium text-foreground-800 outline-none focus:border-primary-400"><option value="" disabled>Select learner</option>{scheduleDropdownOptions.map(event => <option key={eventIdentity(event)} value={eventIdentity(event)}>{event.learner || 'Unknown learner'}{event.group ? ` · ${event.group}` : ''}</option>)}</select></label>
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
