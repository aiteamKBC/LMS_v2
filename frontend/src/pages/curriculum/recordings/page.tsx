import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadRecordingsLibrary, type RecordingsLibrary } from '@/api/sessionResults';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import DayGrid from './components/DayGrid';
import CalendarTimeline from './components/CalendarTimeline';
import CalendarMatchesPanel from './components/CalendarMatchesPanel';
import { useCalendarMatches } from './calendarMatches';
import LectureDetailsPanel from './components/LectureDetailsPanel';
import MiniCalendar from './components/MiniCalendar';
import SearchAndFilters from './components/SearchAndFilters';
import SummaryChips from './components/SummaryChips';
import RecordingDownloadButton from './components/RecordingDownloadButton';
import ModuleDirectory from './components/ModuleDirectory';
import { buildCalendarLectures } from './model';
import { agendaMatches, matchesLectureQuery, periodBounds, type AgendaFilter, type Period } from './filters';
import type { Lecture, RecordingFilter } from './types';
import { addDays, CALENDAR_TIME_ZONES, formatCompactDate, formatFullDate, formatMonthLabel, lectureNeedsAttention, lectureReadyCount, parseIsoDate, TIME_ZONE_LABEL, todayIso } from './utils';

const TIME_ZONE_STORAGE_KEY = 'lms-recordings-calendar-zone';
function savedTimeZone() {
  try {
    const saved = window.localStorage.getItem(TIME_ZONE_STORAGE_KEY);
    return saved && CALENDAR_TIME_ZONES.includes(saved) ? saved : TIME_ZONE_LABEL;
  } catch {
    return TIME_ZONE_LABEL;
  }
}

/** Read-only calendar: every session and status comes from persisted LMS results. */
export default function CurriculumRecordingsPage() {
  const [library, setLibrary] = useState<RecordingsLibrary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [timeZone, setTimeZone] = useState(savedTimeZone);
  const [selectedDate, setSelectedDate] = useState(() => todayIso(savedTimeZone()));
  const [view, setView] = useState(() => { const { year, month } = parseIsoDate(todayIso(savedTimeZone())); return { year, month }; });
  const lastLoad = useRef(0);
  const [selectedLectureId, setSelectedLectureId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [programme, setProgramme] = useState('all');
  const [agendaFilter, setAgendaFilter] = useState<AgendaFilter>('ready');
  const statusFilter: RecordingFilter = agendaFilter === 'ready' || agendaFilter === 'attention' ? agendaFilter : 'all';
  const periodOnly = agendaFilter === 'ended' || agendaFilter === 'notEnded';
  const [includeInactive, setIncludeInactive] = useState(true);
  const [mobileCalendarOpen, setMobileCalendarOpen] = useState(false);
  const [period, setPeriod] = useState<Period>('day');
  const [searchEverywhere, setSearchEverywhere] = useState(false);
  const [expandedCalendar, setExpandedCalendar] = useState(false);
  const [cohort, setCohort] = useState('all');
  const [group, setGroup] = useState('all');
  const [moduleId, setModuleId] = useState('all');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const [viewMode, setViewMode] = useState<'calendar' | 'modules'>('calendar');

  const load = useCallback((signal?: AbortSignal) => {
    lastLoad.current = Date.now();
    setLoading(true);
    setError('');
    void loadRecordingsLibrary(signal).then(setLibrary)
      .catch(caught => { if (!signal?.aborted) setError(caught instanceof Error ? caught.message : 'Recordings could not be loaded.'); })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoad.current >= 30000) load();
    };
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    const timer = window.setInterval(refreshIfVisible, 5 * 60 * 1000);
    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
      window.clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSelectedLectureId(null); setPlayingId(null); setExpandedCalendar(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const bounds = periodBounds(selectedDate, period);
  const allDateSearch = searchEverywhere && Boolean(query.trim());
  const match = useCalendarMatches(bounds.start, bounds.end, timeZone, viewMode === 'calendar' && !allDateSearch);
  const matchData = match.data?.start === bounds.start && match.data?.end === bounds.end && match.data?.timeZone === timeZone ? match.data : null;
  const calendar = useMemo(() => library ? buildCalendarLectures(library, timeZone, now) : { lectures: [], undated: [] }, [library, timeZone, now]);
  const visible = calendar.lectures.filter(item => item.source !== 'authored' && item.status !== 'planned' && item.source !== 'recording-review'
    && (includeInactive || (item.programmeActive && !item.archived)));
  const undated = useMemo(() => calendar.undated.filter(item => includeInactive || (item.programmeActive && !item.archived)), [calendar, includeInactive]);
  const programmes = useMemo(() => [...new Set([...(library?.modules ?? []).map(item => item.programme), ...visible.map(item => item.programme)].filter(Boolean))].sort(), [library, visible]);

  const periodName = period === 'workWeek' ? 'work week' : period;
  const inPeriod = (lecture: Lecture) => lecture.date >= bounds.start && lecture.date <= bounds.end;
  const programmeLectures = visible.filter(item => programme === 'all' || item.programme === programme);
  const cohorts = [...new Set(programmeLectures.map(item => item.cohort).filter(Boolean))].sort();
  const cohortLectures = programmeLectures.filter(item => cohort === 'all' || item.cohort === cohort);
  const groups = [...new Set(cohortLectures.map(item => item.group).filter(Boolean))].sort();
  const groupLectures = cohortLectures.filter(item => group === 'all' || item.group === group);
  const modules = [...new Map(groupLectures.map(item => [item.moduleId, item.module])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const scopedLectures = groupLectures.filter(item => moduleId === 'all' || item.moduleId === moduleId);
  const rawPeriodLectures = scopedLectures.filter(inPeriod);
  const searchPool = viewMode === 'modules' || allDateSearch ? scopedLectures : rawPeriodLectures;
  const countPool = searchPool.filter(item => matchesLectureQuery(item, query));
  const resultLectures = countPool.filter(item => agendaMatches(item, agendaFilter, now));
  const lectureDates = new Set(scopedLectures.filter(item => agendaMatches(item, agendaFilter, now) && matchesLectureQuery(item, query)).map(item => item.date));
  const searchResults = query.trim() ? resultLectures : [];
  const resultDates = [...new Set(resultLectures.map(item => item.date))].sort();
  const selectedLecture = visible.find(item => item.id === selectedLectureId) ?? calendar.lectures.find(item => item.id === selectedLectureId) ?? null;
  const selectedParts = parseIsoDate(selectedDate);
  const startYear = bounds.start.slice(0, 4), endYear = bounds.end.slice(0, 4);
  const rangeLabel = period === 'day' ? formatFullDate(selectedDate)
    : period === 'month' ? formatMonthLabel(selectedParts.year, selectedParts.month)
      : `${formatCompactDate(bounds.start)}${startYear !== endYear ? ` ${startYear}` : ''} - ${formatCompactDate(bounds.end)} ${endYear}`;
  const filterCounts = Object.fromEntries((['all', 'ready', 'attention', 'ended', 'notEnded'] as const).map(value =>
    [value, countPool.filter(item => agendaMatches(item, value, now)).length])) as Record<AgendaFilter, number>;
  const readyCount = filterCounts.ready;
  const attentionCount = filterCounts.attention;
  const chooseFilter = (value: AgendaFilter) => {
    setAgendaFilter(value);
    if (value === 'ended' || value === 'notEnded') setSearchEverywhere(false);
    closePanel();
  };
  const movePeriod = (direction: number) => {
    if (period !== 'month') { goToDate(addDays(selectedDate, direction * (period === 'day' ? 1 : 7))); return; }
    const parts = parseIsoDate(selectedDate);
    goToDate(new Date(Date.UTC(parts.year, parts.month - 1 + direction, 1)).toISOString().slice(0, 10));
  };

  const goToDate = useCallback((iso: string) => {
    const parts = parseIsoDate(iso);
    setSelectedDate(iso);
    setSearchEverywhere(false);
    setView({ year: parts.year, month: parts.month });
    setSelectedLectureId(null);
    setPlayingId(null);
    setMobileCalendarOpen(false);
  }, []);
  const moveMonth = useCallback((delta: number) => setView(current => {
    const date = new Date(Date.UTC(current.year, current.month - 1 + delta, 1));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
  }), []);
  const selectResult = (lecture: Lecture) => {
    setQuery('');
    setPeriod('day');
    goToDate(lecture.date);
    setViewMode('calendar');
    setSelectedLectureId(lecture.id);
  };
  const clearFilters = () => { setQuery(''); setProgramme('all'); setAgendaFilter('all'); setCohort('all'); setGroup('all'); setModuleId('all'); setSearchEverywhere(false); closePanel(); };
  const changeTimeZone = (zone: string) => {
    setTimeZone(zone);
    setSelectedLectureId(null);
    setPlayingId(null);
    try { window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, zone); } catch { /* Storage may be disabled. */ }
  };
  const nextLectureDay = () => {
    const dates = [...lectureDates].sort();
    const next = dates.find(date => date > selectedDate) ?? dates[0];
    if (next) goToDate(next);
  };
  const closePanel = () => { setSelectedLectureId(null); setPlayingId(null); };

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio" pageTitle="Session Recordings"
      pageSubtitle="Find a lecture and download its saved recordings">
      <main className="min-h-full bg-background-100 px-4 py-5 sm:px-6 lg:px-7">
        <div className="mx-auto w-full">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="font-heading text-2xl font-extrabold tracking-tight text-foreground-950 md:text-3xl">Session Recordings</h1>
              <p className="mt-1.5 max-w-2xl text-sm text-foreground-600">Find a lecture, review its recordings, and download the saved files. Jump to any day to see what was captured.</p>
            </div>
            {<SummaryChips dayIso={selectedDate} isToday={selectedDate === todayIso(timeZone)} lecturesToday={countPool.length} periodLabel={viewMode === 'modules' || allDateSearch ? 'Lectures across all dates' : `Lectures in selected ${periodName}`}
              readyCount={readyCount} attentionCount={attentionCount} />}
          </div>

          {loading && !library && <p role="status" className="mt-5 rounded-lg border border-background-200 bg-background-50 p-4 text-sm text-foreground-600">Loading sessions and recordings…</p>}
          {error && <div role="alert" className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <span>{error}</span><button type="button" onClick={() => { load(); match.retry(); }} className="font-semibold underline">Retry</button>
          </div>}
          {library && !library.attentionChecked && library.calendarAvailable !== false && <p role="status" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">The session status check could not be loaded. Saved recordings are still listed.</p>}
          {library && library.calendarAvailable === false && <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
            <span>The LMS calendar could not be loaded. Sessions may be missing.</span>
            <button type="button" onClick={() => { load(); match.retry(); }} className="font-semibold underline">Retry calendar</button>
          </div>}

          {library && <>
            <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Recordings view">
              <button type="button" aria-pressed={viewMode === 'calendar'} onClick={() => setViewMode('calendar')}
                className={`rounded-md px-4 py-2 text-sm font-semibold ${viewMode === 'calendar' ? 'bg-primary-600 text-white' : 'border border-background-200 bg-background-50 text-foreground-700'}`}>Calendar</button>
              <button type="button" aria-pressed={viewMode === 'modules'} onClick={() => { closePanel(); setViewMode('modules'); setAgendaFilter(statusFilter); setCohort('all'); setGroup('all'); setModuleId('all'); }}
                className={`rounded-md px-4 py-2 text-sm font-semibold ${viewMode === 'modules' ? 'bg-primary-600 text-white' : 'border border-background-200 bg-background-50 text-foreground-700'}`}>All LMS modules ({library.modules?.length ?? 0})</button>
            </div>
            <div className="mt-5">
              <SearchAndFilters query={query} onQueryChange={setQuery} programmes={programmes} programme={programme}
                onProgrammeChange={value => { setProgramme(value); setCohort('all'); setGroup('all'); setModuleId('all'); closePanel(); }} statusFilter={statusFilter} onStatusFilterChange={chooseFilter}
                results={searchResults} searchScope={viewMode === 'modules' || allDateSearch ? 'all dates' : `selected ${periodName}`} onSelectResult={selectResult} />
              <label className="mt-2.5 inline-flex items-center gap-2 text-xs font-medium text-foreground-700">
                <input type="checkbox" checked={includeInactive} onChange={event => { setIncludeInactive(event.target.checked); closePanel(); }} />
                Include draft programmes and archived modules
              </label>
            </div>

            {viewMode === 'calendar' && !allDateSearch && <CalendarMatchesPanel data={matchData} error={match.error} onChoose={value => { match.chooseMailbox(value); closePanel(); }} onRetry={match.retry} />}
            {allDateSearch && <p role="status" className="mt-3 text-sm text-foreground-600">All dates search uses saved LMS meetings from all organizers.</p>}
            {viewMode === 'calendar' && <div className="mt-3 space-y-3 rounded-lg border border-background-200 bg-background-50 p-3">
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Lecture status">
                {(['all', 'ready', 'ended', 'notEnded', 'attention'] as const).map(value => <button key={value} type="button" aria-pressed={agendaFilter === value}
                  onClick={() => chooseFilter(value)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${agendaFilter === value ? 'border-primary-600 bg-primary-600 text-white' : 'border-background-200 text-foreground-700'}`}>
                  {value === 'all' ? 'All lectures' : value === 'ready' ? 'Ready to download' : value === 'ended' ? 'Ended' : value === 'notEnded' ? 'Not ended' : 'Needs attention'} ({filterCounts[value]})
                </button>)}
                <span className="text-xs text-foreground-500">{allDateSearch ? 'Counts across all search dates' : `Counts in selected ${periodName}`}; select one filter</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-foreground-700">Search in
                  <select aria-label="Search date scope" value={searchEverywhere ? 'all' : 'period'} onChange={event => { setSearchEverywhere(event.target.value === 'all'); closePanel(); }} className="rounded-md border border-background-200 bg-background-50 px-2 py-1.5">
                    <option value="period">Selected {periodName}</option><option value="all" disabled={periodOnly}>All dates</option>
                  </select>
                </label>
                <details className="w-full min-w-0 sm:w-auto sm:flex-1">
                  <summary className="cursor-pointer text-xs font-semibold text-primary-700">More filters ({[cohort, group, moduleId].filter(value => value !== 'all').length})</summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <label className="text-xs">Cohort<select aria-label="Filter by cohort" value={cohort} onChange={event => { setCohort(event.target.value); setGroup('all'); setModuleId('all'); closePanel(); }} className="mt-1 w-full rounded-md border bg-background-50 p-2"><option value="all">All cohorts</option>{cohorts.map(value => <option key={value}>{value}</option>)}</select></label>
                    <label className="text-xs">Group<select aria-label="Filter by group" value={group} onChange={event => { setGroup(event.target.value); setModuleId('all'); closePanel(); }} className="mt-1 w-full rounded-md border bg-background-50 p-2"><option value="all">All groups</option>{groups.map(value => <option key={value}>{value}</option>)}</select></label>
                    <label className="text-xs">Module<select aria-label="Filter by module" value={moduleId} onChange={event => { setModuleId(event.target.value); closePanel(); }} className="mt-1 w-full rounded-md border bg-background-50 p-2"><option value="all">All modules</option>{modules.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
                  </div>
                </details>
                <button type="button" onClick={clearFilters} className="text-xs font-semibold text-primary-700 underline">Clear all filters</button>
              </div>
            </div>}

            {viewMode === 'modules' ? <ModuleDirectory modules={library.modules ?? []} deliveries={library.deliveries}
              lectures={calendar.lectures} query={query} programme={programme} statusFilter={statusFilter} includeInactive={includeInactive}
              onOpenLecture={selectResult} /> : <div className={expandedCalendar ? "fixed inset-0 z-30 flex gap-4 overflow-auto bg-background-100 p-3" : "mt-4 flex items-start gap-5"}>
              <aside className="sticky top-4 hidden w-[252px] shrink-0 lg:block" aria-label="Choose lecture date">
                <MiniCalendar selectedDate={selectedDate} viewYear={view.year} viewMonth={view.month} lectureDates={lectureDates}
                  timeZone={timeZone} onSelectDate={iso => { setPeriod('day'); goToDate(iso); }} onMonthChange={moveMonth} onToday={() => { setPeriod('day'); goToDate(todayIso(timeZone)); }}
                  onPrevDay={() => goToDate(addDays(selectedDate, -1))} onNextDay={() => goToDate(addDays(selectedDate, 1))} compact />
              </aside>
              <section className={`min-w-0 flex-1 ${expandedCalendar ? "flex min-h-0 flex-col" : ""}`} aria-label="Recordings calendar">
                <div className="rounded-lg border border-background-200 bg-background-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">{periodName} agenda</p>
                      <h2 title={`${formatFullDate(bounds.start)} - ${formatFullDate(bounds.end)}`} className="mt-1 font-heading text-lg font-bold text-foreground-950 md:text-xl">{rangeLabel}</h2>
                      <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-foreground-600">
                        Calendar time zone
                        <select aria-label="Calendar time zone" value={timeZone} onChange={event => changeTimeZone(event.target.value)}
                          className="rounded-md border border-background-200 bg-background-50 px-2 py-1 text-xs text-foreground-900">
                          {CALENDAR_TIME_ZONES.map(zone => <option key={zone} value={zone}>{zone}{zone === TIME_ZONE_LABEL ? ' (device)' : ''}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {expandedCalendar && <select aria-label="Lecture filter" value={agendaFilter} onChange={event => chooseFilter(event.target.value as AgendaFilter)} className="rounded-md border border-background-200 bg-background-50 px-3 py-2 text-sm font-semibold">
                        {(['all', 'ready', 'ended', 'notEnded', 'attention'] as const).map(value => <option key={value} value={value}>{value === 'all' ? 'All lectures' : value === 'ready' ? 'Ready to download' : value === 'ended' ? 'Ended' : value === 'notEnded' ? 'Not ended' : 'Needs attention'} ({filterCounts[value]})</option>)}
                      </select>}
                      <button type="button" aria-pressed={expandedCalendar} onClick={() => setExpandedCalendar(value => !value)} className="rounded-md border border-background-200 px-3 py-2 text-sm font-semibold">{expandedCalendar ? 'Exit full screen' : 'Full screen'}</button>
                      <button type="button" onClick={() => { setPeriod('day'); goToDate(todayIso(timeZone)); }}
                        className="rounded-md border border-background-200 bg-background-50 px-3 py-2 text-sm font-semibold text-foreground-800 shadow-none hover:bg-background-100">Today</button>
                      <div className="flex items-center" role="group" aria-label="Navigate calendar period">
                        <button type="button" aria-label={`Previous ${periodName}`} onClick={() => movePeriod(-1)} className="flex h-9 w-9 items-center justify-center rounded-md text-xl text-foreground-700 shadow-none hover:bg-background-100">&lsaquo;</button>
                        <button type="button" aria-label={`Next ${periodName}`} onClick={() => movePeriod(1)} className="flex h-9 w-9 items-center justify-center rounded-md text-xl text-foreground-700 shadow-none hover:bg-background-100">&rsaquo;</button>
                      </div>
                      <label className="inline-flex items-center gap-2 border-l border-background-200 pl-3 text-xs text-foreground-600">
                        <span className="sr-only">Calendar view</span>
                        <select aria-label="Calendar view" value={period} onChange={event => { setPeriod(event.target.value as Period); setSearchEverywhere(false); closePanel(); }}
                          className="rounded-md border border-background-200 bg-background-50 px-3 py-2 text-sm font-semibold text-foreground-800 shadow-none focus:ring-2 focus:ring-primary-200">
                          <option value="day">Day</option><option value="workWeek">Work week</option><option value="week">Week</option><option value="month">Month</option>
                        </select>
                      </label>
                    </div>
                  </div>
                </div>
                <div className="mt-3 lg:hidden">
                  <button type="button" aria-expanded={mobileCalendarOpen} onClick={() => setMobileCalendarOpen(open => !open)}
                    className="w-full rounded-lg border border-background-200 bg-background-50 px-4 py-3 text-left text-sm font-semibold">
                    {mobileCalendarOpen ? 'Hide calendar' : 'Change date'}
                  </button>
                  {mobileCalendarOpen && <div className="mt-3"><MiniCalendar selectedDate={selectedDate} viewYear={view.year} viewMonth={view.month}
                    lectureDates={lectureDates} timeZone={timeZone} onSelectDate={iso => { setPeriod('day'); goToDate(iso); }} onMonthChange={moveMonth} onToday={() => { setPeriod('day'); goToDate(todayIso(timeZone)); }}
                    onPrevDay={() => goToDate(addDays(selectedDate, -1))} onNextDay={() => goToDate(addDays(selectedDate, 1))} /></div>}
                </div>
                <div className={`mt-3 ${expandedCalendar ? "flex min-h-0 flex-1 flex-col" : ""}`}>
                  {library.calendarAvailable !== false && <>
                    <p role="status" className="mb-3 text-xs text-foreground-600">{resultLectures.length} lectures{allDateSearch ? ' across all dates' : ` in selected ${periodName}`}{query.trim() ? ` matching "${query.trim()}"` : ''}</p>
                    {!allDateSearch && period !== 'month' ? <CalendarTimeline startDate={bounds.start} endDate={bounds.end} lectures={resultLectures}
                      selectedLectureId={selectedLectureId} onSelectLecture={lecture => setSelectedLectureId(lecture.id)} expanded={expandedCalendar}
                      emptyMessage={searchPool.length ? 'No lectures match your filters' : 'No linked LMS meetings in this period'} /> : resultDates.length ? resultDates.map(date => <section key={date} className="mb-4" aria-label={`Lectures on ${date}`}>
                      <h3 className="mb-2 font-heading text-sm font-bold text-foreground-900">{formatFullDate(date)}</h3>
                      <DayGrid date={date} lectures={resultLectures.filter(item => item.date === date)} selectedLectureId={selectedLectureId}
                        emptyReason="none" onSelectLecture={lecture => setSelectedLectureId(lecture.id)} onFindNextLectureDay={nextLectureDay} onClearFilters={clearFilters} timeZone={timeZone} />
                    </section>) : <div className="rounded-lg border border-background-200 bg-background-50 p-6 text-center">
                      <h3 className="font-semibold">{searchPool.length ? 'No lectures match your filters' : 'No lectures scheduled in this period'}</h3>
                      <p className="mt-2 text-sm text-foreground-600">{allDateSearch ? 'Try a different search or clear the filters.' : `Select another ${periodName}, search all dates, or clear the filters.`}</p>
                      <button type="button" onClick={clearFilters} className="mt-3 font-semibold text-primary-700 underline">Clear search and filters</button>
                    </div>}
                  </>}
                </div>
              </section>
              {selectedLecture && <>
                <div className="fixed inset-0 z-40 bg-foreground-950/40" onClick={closePanel} aria-hidden="true" />
                <LectureDetailsPanel lecture={selectedLecture} timeZone={timeZone} playingId={playingId} onClose={closePanel}
                  onPlay={(_lecture, recording) => setPlayingId(current => current === recording.id ? null : recording.id)} />
              </>}
            </div>}

            {viewMode === 'calendar' && undated.length > 0 && <section className="mt-5 rounded-lg border border-background-200 bg-background-50 p-4" aria-label="Undated recordings">
              <h2 className="font-heading text-sm font-bold text-foreground-950">Recordings without a session date</h2>
              <ul className="mt-2 space-y-2 text-sm">{undated.map(({ recording }) => <li key={recording.id} className="flex items-center justify-between gap-3">
                <span>Recording {recording.id}</span>
                {recording.state === 'ready' ? <RecordingDownloadButton seriesId={recording.seriesId} artifactId={recording.id}
                  className="inline-flex items-center gap-1 font-semibold text-primary-700 underline disabled:opacity-60" /> : <span>Not ready</span>}
              </li>)}</ul>
            </section>}
          </>}
        </div>
      </main>
    </WorkspaceShell>
  );
}
