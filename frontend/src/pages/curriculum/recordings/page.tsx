import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadRecordingsLibrary, type RecordingsLibrary } from '@/api/sessionResults';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import DayGrid from './components/DayGrid';
import LectureDetailsPanel from './components/LectureDetailsPanel';
import MiniCalendar from './components/MiniCalendar';
import SearchAndFilters from './components/SearchAndFilters';
import SummaryChips from './components/SummaryChips';
import RecordingDownloadButton from './components/RecordingDownloadButton';
import ModuleDirectory from './components/ModuleDirectory';
import { buildCalendarLectures } from './model';
import type { Lecture, RecordingFilter } from './types';
import { addDays, CALENDAR_TIME_ZONES, formatFullDate, lectureNeedsAttention, lectureReadyCount, parseIsoDate, TIME_ZONE_LABEL, todayIso } from './utils';

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
  const [statusFilter, setStatusFilter] = useState<RecordingFilter>('all');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [mobileCalendarOpen, setMobileCalendarOpen] = useState(false);
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
      if (event.key === 'Escape') { setSelectedLectureId(null); setPlayingId(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const calendar = useMemo(() => library ? buildCalendarLectures(library, timeZone) : { lectures: [], undated: [] }, [library, timeZone]);
  const visible = useMemo(() => calendar.lectures.filter(item => includeInactive || (item.programmeActive && !item.archived)), [calendar, includeInactive]);
  const undated = useMemo(() => calendar.undated.filter(item => includeInactive || (item.programmeActive && !item.archived)), [calendar, includeInactive]);
  const programmes = useMemo(() => [...new Set([...(library?.modules ?? []).map(item => item.programme), ...visible.map(item => item.programme)].filter(Boolean))].sort(), [library, visible]);
  const lectureDates = useMemo(() => new Set(visible.map(item => item.date)), [visible]);

  const matchesFilters = useCallback((lecture: Lecture) => {
    if (programme !== 'all' && lecture.programme !== programme) return false;
    if (statusFilter === 'ready' && lectureReadyCount(lecture) === 0) return false;
    if (statusFilter === 'attention' && !lectureNeedsAttention(lecture)) return false;
    return true;
  }, [programme, statusFilter]);
  const matchesQuery = useCallback((lecture: Lecture, value: string) => {
    const needle = value.trim().toLocaleLowerCase();
    return !needle || `${lecture.title} ${lecture.module} ${lecture.programme} ${lecture.group} ${lecture.cohort} ${lecture.weekTitle}`.toLocaleLowerCase().includes(needle);
  }, []);
  const rawDayLectures = useMemo(() => visible.filter(item => item.date === selectedDate), [visible, selectedDate]);
  const dayLectures = useMemo(() => rawDayLectures.filter(item => matchesFilters(item) && matchesQuery(item, query)), [rawDayLectures, matchesFilters, matchesQuery, query]);
  const searchResults = useMemo(() => query.trim()
    ? visible.filter(item => matchesFilters(item) && matchesQuery(item, query)).slice(0, 8) : [], [query, visible, matchesFilters, matchesQuery]);
  const selectedLecture = visible.find(item => item.id === selectedLectureId) ?? null;
  const readyCount = rawDayLectures.reduce((sum, item) => sum + lectureReadyCount(item), 0);
  const attentionCount = rawDayLectures.filter(lectureNeedsAttention).length;

  const goToDate = useCallback((iso: string) => {
    const parts = parseIsoDate(iso);
    setSelectedDate(iso);
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
    goToDate(lecture.date);
    setViewMode('calendar');
    setSelectedLectureId(lecture.id);
  };
  const clearFilters = () => { setQuery(''); setProgramme('all'); setStatusFilter('all'); };
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
        <div className="mx-auto max-w-[1500px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="font-heading text-2xl font-extrabold tracking-tight text-foreground-950 md:text-3xl">Session Recordings</h1>
              <p className="mt-1.5 max-w-2xl text-sm text-foreground-600">Find a lecture, review its recordings, and download the saved files. Jump to any day to see what was captured.</p>
            </div>
            <SummaryChips dayIso={selectedDate} isToday={selectedDate === todayIso(timeZone)} lecturesToday={rawDayLectures.length}
              readyCount={readyCount} attentionCount={attentionCount} />
          </div>

          {loading && !library && <p role="status" className="mt-5 rounded-lg border border-background-200 bg-background-50 p-4 text-sm text-foreground-600">Loading sessions and recordings…</p>}
          {error && <div role="alert" className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <span>{error}</span><button type="button" onClick={() => load()} className="font-semibold underline">Retry</button>
          </div>}
          {library && !library.attentionChecked && library.calendarAvailable !== false && <p role="status" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">The session status check could not be loaded. Saved recordings are still listed.</p>}
          {library && library.calendarAvailable === false && <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
            <span>The LMS calendar could not be loaded. Sessions may be missing.</span>
            <button type="button" onClick={() => load()} className="font-semibold underline">Retry calendar</button>
          </div>}

          {library && <>
            <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Recordings view">
              <button type="button" aria-pressed={viewMode === 'calendar'} onClick={() => setViewMode('calendar')}
                className={`rounded-md px-4 py-2 text-sm font-semibold ${viewMode === 'calendar' ? 'bg-primary-600 text-white' : 'border border-background-200 bg-background-50 text-foreground-700'}`}>Calendar</button>
              <button type="button" aria-pressed={viewMode === 'modules'} onClick={() => { closePanel(); setViewMode('modules'); }}
                className={`rounded-md px-4 py-2 text-sm font-semibold ${viewMode === 'modules' ? 'bg-primary-600 text-white' : 'border border-background-200 bg-background-50 text-foreground-700'}`}>All LMS modules ({library.modules?.length ?? 0})</button>
            </div>
            <div className="mt-5">
              <SearchAndFilters query={query} onQueryChange={setQuery} programmes={programmes} programme={programme}
                onProgrammeChange={setProgramme} statusFilter={statusFilter} onStatusFilterChange={setStatusFilter}
                results={searchResults} onSelectResult={selectResult} />
              <label className="mt-2.5 inline-flex items-center gap-2 text-xs font-medium text-foreground-700">
                <input type="checkbox" checked={includeInactive} onChange={event => { setIncludeInactive(event.target.checked); closePanel(); }} />
                Include draft programmes and archived modules
              </label>
            </div>

            {viewMode === 'modules' ? <ModuleDirectory modules={library.modules ?? []} deliveries={library.deliveries}
              lectures={calendar.lectures} query={query} programme={programme} statusFilter={statusFilter} includeInactive={includeInactive}
              onOpenLecture={selectResult} /> : <div className="mt-4 flex items-start gap-5">
              <div className="hidden w-[252px] shrink-0 xl:block">
                <MiniCalendar selectedDate={selectedDate} viewYear={view.year} viewMonth={view.month} lectureDates={lectureDates}
                  timeZone={timeZone} onSelectDate={goToDate} onMonthChange={moveMonth} onToday={() => goToDate(todayIso(timeZone))}
                  onPrevDay={() => goToDate(addDays(selectedDate, -1))} onNextDay={() => goToDate(addDays(selectedDate, 1))} />
              </div>
              <section className="min-w-0 flex-1" aria-label="Recordings calendar">
                <div className="rounded-lg border border-background-200 bg-background-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">Day view</p>
                      <h2 className="mt-1 font-heading text-lg font-bold text-foreground-950 md:text-xl">{formatFullDate(selectedDate)}</h2>
                      <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-foreground-600">
                        Calendar time zone
                        <select aria-label="Calendar time zone" value={timeZone} onChange={event => changeTimeZone(event.target.value)}
                          className="rounded-md border border-background-200 bg-background-50 px-2 py-1 text-xs text-foreground-900">
                          {CALENDAR_TIME_ZONES.map(zone => <option key={zone} value={zone}>{zone}{zone === TIME_ZONE_LABEL ? ' (device)' : ''}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="flex gap-2 xl:hidden">
                      <button type="button" aria-label="Previous day" onClick={() => goToDate(addDays(selectedDate, -1))} className="rounded-md border border-background-200 px-3 py-2">‹</button>
                      <button type="button" onClick={() => goToDate(todayIso(timeZone))} className="rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white">Today</button>
                      <button type="button" aria-label="Next day" onClick={() => goToDate(addDays(selectedDate, 1))} className="rounded-md border border-background-200 px-3 py-2">›</button>
                    </div>
                  </div>
                </div>
                <div className="mt-3 xl:hidden">
                  <button type="button" aria-expanded={mobileCalendarOpen} onClick={() => setMobileCalendarOpen(open => !open)}
                    className="w-full rounded-lg border border-background-200 bg-background-50 px-4 py-3 text-left text-sm font-semibold">
                    {mobileCalendarOpen ? 'Hide calendar' : 'Change date'}
                  </button>
                  {mobileCalendarOpen && <div className="mt-3"><MiniCalendar selectedDate={selectedDate} viewYear={view.year} viewMonth={view.month}
                    lectureDates={lectureDates} timeZone={timeZone} onSelectDate={goToDate} onMonthChange={moveMonth} onToday={() => goToDate(todayIso(timeZone))}
                    onPrevDay={() => goToDate(addDays(selectedDate, -1))} onNextDay={() => goToDate(addDays(selectedDate, 1))} /></div>}
                </div>
                <div className="mt-3">
                  {library.calendarAvailable !== false && <DayGrid date={selectedDate} lectures={dayLectures} selectedLectureId={selectedLectureId}
                    emptyReason={rawDayLectures.length ? 'filtered' : 'none'} onSelectLecture={lecture => setSelectedLectureId(lecture.id)}
                    onFindNextLectureDay={nextLectureDay} onClearFilters={clearFilters} />}
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
