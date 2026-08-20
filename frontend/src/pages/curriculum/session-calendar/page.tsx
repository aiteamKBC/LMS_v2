import { type CSSProperties, type FormEvent, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { SkeletonBlock } from '@/components/feature/CurriculumSkeletons';
import { curriculumNavItems } from '@/mocks/navigation';
import { useCurriculumSessions } from '@/hooks/useCurriculumSessions';
import { fetchCurriculumHolidays, tutorConflictMessage, updateCurriculumSession, type CurriculumHoliday, type CurriculumSession } from '@/lib/curriculumApi';

interface CalSession {
  id: string;
  trainingPlanId: number | string;
  programmeId?: string;
  cohortId?: string;
  groupId?: string;
  moduleId?: string;
  moduleCatalogueId?: string;
  weekId?: string;
  title: string;
  type: 'Live Session' | 'Workshop' | 'Self-study' | 'Assignment' | 'Quiz' | 'OTJH' | 'Collaboration' | 'Review';
  date: string;
  day: string;
  startTime: string;
  endTime: string;
  tutor: string;
  group: string;
  cohort: string;
  programme: string;
  venue: string;
  module: string;
  week: number;
  status: 'scheduled' | 'completed' | 'cancelled' | 'pending';
  ksbCodes: string[];
}

type CalendarView = 'day' | 'week' | 'month';

interface SessionPlacement {
  session: CalSession;
  column: number;
  totalColumns: number;
}

interface MeetingTooltipState {
  session: CalSession;
  x: number;
  y: number;
}

interface CalendarHoliday {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  type?: string;
  color?: string;
}

const validSessionTypes = new Set<CalSession['type']>([
  'Live Session',
  'Workshop',
  'Self-study',
  'Assignment',
  'Quiz',
  'OTJH',
  'Collaboration',
  'Review',
]);

const validSessionStatuses = new Set<CalSession['status']>(['scheduled', 'completed', 'cancelled', 'pending']);

const eventAccent: Record<string, string> = {
  'Live Session': '#8b86ff',
  Workshop: '#d59b00',
  'Self-study': '#7b6bd6',
  Assignment: '#f59e0b',
  Quiz: '#f43f5e',
  OTJH: '#10b981',
  Collaboration: '#8b5cf6',
  Review: '#0ea5e9',
};

function normalizeApiSession(session: CurriculumSession): CalSession {
  return {
    id: session.id,
    trainingPlanId: session.trainingPlanId || '',
    programmeId: session.programmeId,
    cohortId: session.cohortId,
    groupId: session.groupId,
    moduleId: session.moduleId,
    moduleCatalogueId: session.moduleCatalogueId,
    weekId: session.weekId,
    title: session.title || 'Untitled session',
    type: validSessionTypes.has(session.type as CalSession['type']) ? session.type as CalSession['type'] : 'Live Session',
    date: session.date,
    day: session.day,
    startTime: session.startTime || '09:00',
    endTime: session.endTime || '10:00',
    tutor: session.tutor || 'Unassigned',
    group: session.group || 'All groups',
    cohort: session.cohort || 'Unassigned cohort',
    programme: session.programme || 'Unassigned programme',
    venue: session.venue || 'LMS',
    module: session.module || 'Unassigned module',
    week: session.week || 1,
    status: validSessionStatuses.has(session.status as CalSession['status']) ? session.status as CalSession['status'] : 'scheduled',
    ksbCodes: Array.isArray(session.ksbCodes) ? session.ksbCodes : [],
  };
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatDate(d: Date) {
  return d.toISOString().split('T')[0];
}

function addDays(d: Date, n: number) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

function addWeeks(d: Date, n: number) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n * 7);
  return nd;
}

function formatDateShort(d: Date) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function normalizeHoliday(holiday: CurriculumHoliday): CalendarHoliday {
  return {
    id: String(holiday.id),
    label: holiday.label || 'Holiday',
    startDate: holiday.startDate,
    endDate: holiday.endDate || holiday.startDate,
    type: holiday.type,
    color: holiday.color,
  };
}

function dateInHoliday(date: Date, holiday: CalendarHoliday) {
  const dateValue = formatDate(date);
  const start = holiday.startDate || holiday.endDate;
  const end = holiday.endDate || holiday.startDate;
  return Boolean(start && end && dateValue >= start && dateValue <= end);
}

function buildMiniMonthDays(date: Date) {
  const monthStart = getMonthStart(date);
  const start = new Date(monthStart);
  start.setDate(monthStart.getDate() - monthStart.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function timeToMinutes(value: string) {
  const [hours, minutes] = String(value || '09:00').split(':').map(part => Number(part) || 0);
  return hours * 60 + minutes;
}

function formatHourLabel(hour: number) {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12} ${suffix}`;
}

function sessionTooltipRows(session: CalSession) {
  return [
    ['Programme', session.programme],
    ['Cohort', session.cohort],
    ['Group', session.group],
    ['Module', session.module],
    ['Week', `Week ${session.week}`],
    ['Date', `${session.date} (${session.day})`],
    ['Tutor', session.tutor],
    ['Venue', session.venue],
    ['KSBs', session.ksbCodes.length ? session.ksbCodes.join(', ') : 'None mapped'],
  ].filter(([, value]) => Boolean(value));
}

function layoutOverlappingSessions(sessions: CalSession[]): SessionPlacement[] {
  const sorted = [...sessions].sort((a, b) => {
    const startDelta = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    if (startDelta !== 0) return startDelta;
    return timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
  });
  const placements: SessionPlacement[] = [];
  let active: Array<{ session: CalSession; column: number; end: number }> = [];

  sorted.forEach(session => {
    const start = timeToMinutes(session.startTime);
    const end = timeToMinutes(session.endTime);
    active = active.filter(item => item.end > start);
    const usedColumns = new Set(active.map(item => item.column));
    let column = 0;
    while (usedColumns.has(column)) column += 1;
    active.push({ session, column, end });

    const overlapGroup = active.map(item => item.session.id);
    const totalColumns = Math.max(active.length, ...placements.filter(item => overlapGroup.includes(item.session.id)).map(item => item.totalColumns), 1);
    placements
      .filter(item => overlapGroup.includes(item.session.id))
      .forEach(item => {
        item.totalColumns = totalColumns;
      });
    placements.push({ session, column, totalColumns });
  });

  return placements;
}

function teamsEventStyle(session: CalSession, column: number, totalColumns: number): CSSProperties {
  const dayStart = 4 * 60;
  const dayEnd = 20 * 60;
  const pixelsPerMinute = 72 / 60;
  const start = Math.max(dayStart, Math.min(dayEnd - 15, timeToMinutes(session.startTime)));
  const end = Math.max(start + 30, Math.min(dayEnd, timeToMinutes(session.endTime)));
  const gap = 4;
  const outerPadding = 6;
  const availableWidth = 100 - outerPadding * 2;
  const eventWidth = availableWidth / totalColumns;
  const durationHeight = Math.max(28, (end - start) * pixelsPerMinute - 4);
  return {
    top: (start - dayStart) * pixelsPerMinute + 2,
    height: Math.max(28, durationHeight * 0.72),
    left: `calc(${outerPadding + eventWidth * column}% + ${gap / 2}px)`,
    width: `calc(${eventWidth}% - ${gap}px)`,
    borderLeftColor: eventAccent[session.type] || '#8b86ff',
  };
}

export default function SessionCalendarPage() {
  const { sessions: apiSessions, loading, error, reload } = useCurriculumSessions();
  const [sessions, setSessions] = useState<CalSession[]>([]);
  const [view, setView] = useState<CalendarView>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [draggedSession, setDraggedSession] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<CalSession | null>(null);
  const [editingSession, setEditingSession] = useState<CalSession | null>(null);
  const [sessionForm, setSessionForm] = useState({ startTime: '', endTime: '', tutor: '' });
  const [savingSession, setSavingSession] = useState(false);
  const [filters, setFilters] = useState({ cohort: 'all', group: 'all', type: 'all', tutor: 'all' });
  const [showFilters, setShowFilters] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [meetingTooltip, setMeetingTooltip] = useState<MeetingTooltipState | null>(null);
  const [holidays, setHolidays] = useState<CalendarHoliday[]>([]);
  const [showUkHolidays, setShowUkHolidays] = useState(true);

  useEffect(() => {
    if (!apiSessions.length) return;
    setSessions(apiSessions.map(normalizeApiSession));
  }, [apiSessions]);

  useEffect(() => {
    const controller = new AbortController();
    fetchCurriculumHolidays(controller.signal)
      .then(items => setHolidays(items.map(normalizeHoliday).filter(holiday => holiday.startDate)))
      .catch(() => setHolidays([]));
    return () => controller.abort();
  }, []);

  const weekStart = getWeekStart(currentDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const monthStart = getMonthStart(currentDate);
  const monthOffset = monthStart.getDay() === 0 ? 6 : monthStart.getDay() - 1;
  const monthDays = Array.from({ length: 42 }, (_, index) => addDays(monthStart, index - monthOffset));
  const visibleDays = view === 'day' ? [currentDate] : view === 'week' ? weekDays : monthDays;
  const miniMonthDays = buildMiniMonthDays(currentDate);
  const timelineHours = Array.from({ length: 16 }, (_, index) => index + 4);

  const filteredSessions = sessions.filter(session => {
    if (filters.cohort !== 'all' && session.cohort !== filters.cohort) return false;
    if (filters.group !== 'all' && !session.group.includes(filters.group)) return false;
    if (filters.type !== 'all' && session.type !== filters.type) return false;
    if (filters.tutor !== 'all' && session.tutor !== filters.tutor) return false;
    return true;
  });

  const getSessionsForDay = (date: Date) => {
    const dateString = formatDate(date);
    return filteredSessions.filter(session => session.date === dateString);
  };

  const getHolidaysForDay = (date: Date) => {
    if (!showUkHolidays) return [];
    return holidays.filter(holiday => dateInHoliday(date, holiday));
  };

  const uniqueCohorts = useMemo(() => [...new Set(sessions.map(s => s.cohort))], [sessions]);
  const uniqueGroups = useMemo(() => [...new Set(sessions.flatMap(s => s.group.split(', ').map(g => g.trim())))], [sessions]);
  const uniqueTypes = useMemo(() => [...new Set(sessions.map(s => s.type))], [sessions]);
  const uniqueTutors = useMemo(() => [...new Set(sessions.map(s => s.tutor))], [sessions]);

  const isToday = (date: Date) => formatDate(date) === formatDate(new Date());
  const isCurrentMonth = (date: Date) => date.getMonth() === currentDate.getMonth();
  const activeFilterCount = Object.values(filters).filter(value => value !== 'all').length;
  const calendarTitle = view === 'day'
    ? currentDate.toLocaleDateString('en-GB', { month: 'long', day: 'numeric', year: 'numeric' })
    : view === 'week'
      ? `${formatDateShort(weekDays[0])} - ${formatDateShort(weekDays[6])}, ${weekDays[0].getFullYear()}`
      : currentDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const navigate = (direction: -1 | 1) => {
    setCurrentDate(previous => {
      if (view === 'day') return addDays(previous, direction);
      if (view === 'week') return addWeeks(previous, direction);
      const next = new Date(previous);
      next.setMonth(next.getMonth() + direction);
      return next;
    });
  };

  const goToday = () => setCurrentDate(new Date());

  const handleDragStart = (event: React.DragEvent, sessionId: string) => {
    setDraggedSession(sessionId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', sessionId);
  };

  const handleDropSlot = (event: React.DragEvent, date: Date) => {
    event.preventDefault();
    const sessionId = event.dataTransfer.getData('text/plain') || draggedSession;
    const session = sessions.find(item => item.id === sessionId);
    setDragOverDate(null);
    setDraggedSession(null);
    if (!session || formatDate(date) === session.date) return;
    setNotification({ type: 'error', message: `"${session.title}" is generated from a module allocation. Drag/drop rescheduling is disabled to avoid changing the wider delivery series.` });
    setTimeout(() => setNotification(null), 3500);
  };

  const openEditSession = (session: CalSession) => {
    setEditingSession(session);
    setSessionForm({ startTime: session.startTime, endTime: session.endTime, tutor: session.tutor });
  };

  const saveSession = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingSession) return;
    setSavingSession(true);
    try {
      await updateCurriculumSession(editingSession.id, sessionForm);
      setNotification({ type: 'success', message: `"${editingSession.title}" was updated.` });
      setEditingSession(null);
      reload();
    } catch (err) {
      // Editing a session moves its whole module, so the tutor can end up
      // double-booked; that refusal names the module already in the slot.
      setNotification({
        type: 'error',
        message: tutorConflictMessage(err) || (err instanceof Error ? err.message : 'Unable to update session.'),
      });
    } finally {
      setSavingSession(false);
      setTimeout(() => setNotification(null), 3500);
    }
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Session Calendar" pageSubtitle={loading ? 'Loading live LMS sessions...' : `${filteredSessions.length} module sessions`} userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="h-[calc(100vh-96px)] min-h-[720px] overflow-auto bg-[#f6f4f8] text-slate-950">
        <div className="grid h-full min-w-[1460px] border border-slate-200 bg-white" style={{ gridTemplateColumns: '280px minmax(1180px, 1fr)' }}>
          <TeamsSidebar currentDate={currentDate} miniMonthDays={miniMonthDays} isToday={isToday} isCurrentMonth={isCurrentMonth} holidaysAvailable={holidays.length > 0} showUkHolidays={showUkHolidays} onToggleUkHolidays={setShowUkHolidays} onPickDate={setCurrentDate} onMonthNavigate={direction => {
            const next = new Date(currentDate);
            next.setMonth(next.getMonth() + direction);
            setCurrentDate(next);
          }} />

            <main className="flex min-w-0 flex-col bg-white">
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
              <div className="flex min-w-0 items-center gap-2">
                <Link to="/workspace/curriculum" className="grid h-8 w-8 place-items-center rounded-md text-slate-600 hover:bg-slate-100" title="Curriculum Studio">
                  <AppIcon className="ri-side-bar-line"></AppIcon>
                </Link>
                <button onClick={goToday} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-bold text-slate-800 hover:bg-slate-100">
                  <AppIcon className="ri-calendar-line"></AppIcon>
                  Today
                </button>
                <button onClick={() => navigate(-1)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100" aria-label="Previous"><AppIcon className="ri-arrow-left-s-line"></AppIcon></button>
                <button onClick={() => navigate(1)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100" aria-label="Next"><AppIcon className="ri-arrow-right-s-line"></AppIcon></button>
                <h3 className="truncate px-2 text-[16px] font-bold text-slate-950">{calendarTitle}</h3>
              </div>

              <div className="flex items-center gap-2">
                <ViewMenu view={view} onChange={setView} />
                <button onClick={() => setShowFilters(!showFilters)} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-semibold ${activeFilterCount ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-700 hover:bg-slate-100'}`}>
                  <AppIcon className="ri-filter-3-line"></AppIcon>
                  {activeFilterCount ? 'Filter applied' : 'Filter'}
                  {activeFilterCount > 0 && <span className="rounded bg-primary-600 px-1.5 text-[10px] text-white">{activeFilterCount}</span>}
                  <AppIcon className="ri-arrow-down-s-line"></AppIcon>
                </button>
              </div>
            </header>

            {notification && (
              <div className={`mx-4 mt-3 rounded-md border px-3 py-2 text-[12px] font-semibold ${notification.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                <AppIcon className={`${notification.type === 'success' ? 'ri-check-line' : 'ri-close-line'} mr-2`}></AppIcon>
                {notification.message}
              </div>
            )}

            {error && (
              <div className="mx-4 mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-700">
                <AppIcon className="ri-wifi-off-line mr-2"></AppIcon>
                Live LMS data is unavailable, so no generated session schedule is shown.
              </div>
            )}

            {showFilters && (
              <div className="mx-4 mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-sm">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <TeamsFilterSelect label="Cohort" value={filters.cohort} options={uniqueCohorts} onChange={value => setFilters(previous => ({ ...previous, cohort: value }))} />
                  <TeamsFilterSelect label="Group" value={filters.group} options={uniqueGroups} onChange={value => setFilters(previous => ({ ...previous, group: value }))} />
                  <TeamsFilterSelect label="Type" value={filters.type} options={uniqueTypes} onChange={value => setFilters(previous => ({ ...previous, type: value }))} />
                  <TeamsFilterSelect label="Tutor" value={filters.tutor} options={uniqueTutors} onChange={value => setFilters(previous => ({ ...previous, tutor: value }))} />
                </div>
              </div>
            )}

            <section className="min-h-0 flex-1 overflow-hidden">
              {loading ? (
                <CalendarGridSkeleton view={view} />
              ) : view === 'month' ? (
                <TeamsMonthView days={visibleDays} currentDate={currentDate} isToday={isToday} isCurrentMonth={isCurrentMonth} getSessionsForDay={getSessionsForDay} getHolidaysForDay={getHolidaysForDay} onPickDate={setCurrentDate} onSelectSession={setSelectedSession} onTooltipChange={setMeetingTooltip} />
              ) : (
                <TeamsTimelineView
                  days={visibleDays}
                  hours={timelineHours}
                  selectedSession={selectedSession}
                  draggedSession={draggedSession}
                  dragOverDate={dragOverDate}
                  isToday={isToday}
                  getSessionsForDay={getSessionsForDay}
                  getHolidaysForDay={getHolidaysForDay}
                  onDragStart={handleDragStart}
                  onDragOver={(event, date) => {
                    event.preventDefault();
                    setDragOverDate(formatDate(date));
                  }}
                  onDragLeave={() => setDragOverDate(null)}
                  onDrop={handleDropSlot}
                  onSelectSession={session => setSelectedSession(selectedSession?.id === session.id ? null : session)}
                  onTooltipChange={setMeetingTooltip}
                />
              )}
            </section>

            {selectedSession && (
              <TeamsSessionPanel session={selectedSession} onClose={() => setSelectedSession(null)} onEdit={() => openEditSession(selectedSession)} />
            )}
          </main>
        </div>

        {editingSession && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setEditingSession(null)}>
            <form onSubmit={saveSession} className="w-full max-w-md rounded-lg bg-white text-slate-950 shadow-2xl" onClick={event => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                <h3 className="text-sm font-heading font-semibold">Edit Session</h3>
                <button type="button" onClick={() => setEditingSession(null)} className="grid h-8 w-8 place-items-center rounded-md bg-slate-100 hover:bg-slate-200"><AppIcon className="ri-close-line text-slate-700"></AppIcon></button>
              </div>
              <div className="space-y-4 p-6">
                <SessionField label="Start time" type="time" value={sessionForm.startTime} onChange={value => setSessionForm(previous => ({ ...previous, startTime: value }))} />
                <SessionField label="End time" type="time" value={sessionForm.endTime} onChange={value => setSessionForm(previous => ({ ...previous, endTime: value }))} />
                <SessionField label="Tutor" value={sessionForm.tutor} onChange={value => setSessionForm(previous => ({ ...previous, tutor: value }))} />
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
                <button type="button" onClick={() => setEditingSession(null)} disabled={savingSession} className="rounded-md border border-slate-200 px-4 py-2 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={savingSession} className="rounded-md bg-primary-600 px-4 py-2 text-[12px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50">{savingSession ? 'Saving...' : 'Save Session'}</button>
              </div>
            </form>
          </div>
        )}
        <MeetingTooltipOverlay tooltip={meetingTooltip} />
      </div>
    </WorkspaceShell>
  );
}

function TeamsSidebar({ currentDate, miniMonthDays, isToday, isCurrentMonth, holidaysAvailable, showUkHolidays, onToggleUkHolidays, onPickDate, onMonthNavigate }: {
  currentDate: Date;
  miniMonthDays: Date[];
  isToday: (date: Date) => boolean;
  isCurrentMonth: (date: Date) => boolean;
  holidaysAvailable: boolean;
  showUkHolidays: boolean;
  onToggleUkHolidays: (checked: boolean) => void;
  onPickDate: (date: Date) => void;
  onMonthNavigate: (direction: -1 | 1) => void;
}) {
  return (
    <aside className="min-w-0 border-r border-slate-200 bg-white">
      <div className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4">
        <h2 className="text-[15px] font-bold text-slate-950">Calendar</h2>
        <Link to="/workspace/curriculum" className="grid h-8 w-8 place-items-center rounded-md text-slate-600 hover:bg-white" title="Curriculum Studio">
          <AppIcon className="ri-arrow-go-back-line"></AppIcon>
        </Link>
      </div>
      <div className="space-y-5 bg-slate-50/70 p-4">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <button onClick={() => onMonthNavigate(-1)} className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-white" aria-label="Previous month"><AppIcon className="ri-arrow-up-s-line"></AppIcon></button>
            <p className="text-[12px] font-bold text-slate-800">{currentDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</p>
            <button onClick={() => onMonthNavigate(1)} className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-white" aria-label="Next month"><AppIcon className="ri-arrow-down-s-line"></AppIcon></button>
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}-${index}`} className="text-[10px] font-bold text-slate-500">{day}</span>)}
            {miniMonthDays.map(day => {
              const selected = formatDate(day) === formatDate(currentDate);
              return (
                <button key={day.toISOString()} onClick={() => onPickDate(day)} className={`mx-auto grid h-7 w-7 place-items-center rounded-full text-[11px] font-semibold ${selected ? 'bg-primary-600 text-white shadow-sm' : isToday(day) ? 'text-primary-700 ring-1 ring-primary-200' : isCurrentMonth(day) ? 'text-slate-700 hover:bg-white' : 'text-slate-400'}`}>
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
        <button disabled className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-[12px] font-semibold text-primary-700">
          <AppIcon className="ri-calendar-add-line text-base"></AppIcon>
          Add calendar
        </button>
        <div className="border-t border-slate-200 pt-4">
          <div className="mb-3 flex items-center gap-2 text-[12px] font-bold text-slate-800">
            <AppIcon className="ri-arrow-down-s-line"></AppIcon>
            My calendars
          </div>
          <label className="flex items-center gap-3 rounded px-1 py-2 text-[12px] font-semibold text-slate-700">
            <input type="checkbox" checked readOnly className="h-3.5 w-3.5 accent-primary-600" />
            Calendar
          </label>
          <label className={`flex items-center gap-3 rounded px-1 py-2 text-[12px] font-semibold ${holidaysAvailable ? 'text-slate-700' : 'text-slate-400'}`} title={holidaysAvailable ? 'Show or hide holidays on the calendar.' : 'No holidays found.'}>
            <input type="checkbox" checked={showUkHolidays && holidaysAvailable} disabled={!holidaysAvailable} onChange={event => onToggleUkHolidays(event.target.checked)} className="h-3.5 w-3.5 accent-primary-600 disabled:opacity-40" />
            Holidays
          </label>
        </div>
      </div>
    </aside>
  );
}

function ViewMenu({ view, onChange }: { view: CalendarView; onChange: (view: CalendarView) => void }) {
  return (
    <div className="flex h-9 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-0.5">
      {(['day', 'week', 'month'] as CalendarView[]).map(option => (
        <button key={option} onClick={() => onChange(option)} className={`rounded-md px-3 text-[12px] font-semibold capitalize ${view === option ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-600 hover:bg-white'}`}>
          {option}
        </button>
      ))}
    </div>
  );
}

function TeamsTimelineView({ days, hours, selectedSession, draggedSession, dragOverDate, isToday, getSessionsForDay, getHolidaysForDay, onDragStart, onDragOver, onDragLeave, onDrop, onSelectSession, onTooltipChange }: {
  days: Date[];
  hours: number[];
  selectedSession: CalSession | null;
  draggedSession: string | null;
  dragOverDate: string | null;
  isToday: (date: Date) => boolean;
  getSessionsForDay: (date: Date) => CalSession[];
  getHolidaysForDay: (date: Date) => CalendarHoliday[];
  onDragStart: (event: React.DragEvent, sessionId: string) => void;
  onDragOver: (event: React.DragEvent, date: Date) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent, date: Date) => void;
  onSelectSession: (session: CalSession) => void;
  onTooltipChange: (tooltip: MeetingTooltipState | null) => void;
}) {
  const gridColumns = days.length === 1 ? '56px minmax(0,1fr)' : `56px repeat(${days.length}, minmax(150px, 1fr))`;
  const timelineHeight = hours.length * 72;
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="grid min-w-[1110px] border-b border-slate-200 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.04)]" style={{ gridTemplateColumns: gridColumns }}>
        <div className="border-r border-slate-200"></div>
          {days.map(day => (
          <div key={day.toISOString()} className={`h-[78px] border-r border-slate-200 px-4 py-3 text-left ${isToday(day) ? 'bg-primary-50/70' : ''}`}>
            <p className={`text-[20px] font-bold leading-tight ${isToday(day) ? 'text-primary-700' : 'text-slate-950'}`}>{day.getDate()}</p>
            <p className={`text-[11px] font-semibold ${isToday(day) ? 'text-primary-700' : 'text-slate-600'}`}>{day.toLocaleDateString('en-GB', { weekday: 'long' })}</p>
            {getHolidaysForDay(day).slice(0, 1).map(holiday => (
              <span key={holiday.id} className="mt-1 block truncate rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200" title={holiday.label}>{holiday.label}</span>
            ))}
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid min-w-[1110px]" style={{ gridTemplateColumns: gridColumns }}>
          <div className="relative border-r border-slate-200 bg-white" style={{ height: timelineHeight }}>
            {hours.map(hour => (
              <div key={hour} className="h-[72px] border-b border-slate-200 pr-2 pt-1 text-right text-[11px] font-semibold text-slate-500">
                {formatHourLabel(hour)}
              </div>
            ))}
          </div>
          {days.map(day => {
            const dateString = formatDate(day);
            const placements = layoutOverlappingSessions(getSessionsForDay(day));
            const dayHolidays = getHolidaysForDay(day);
            return (
              <div key={day.toISOString()} onDragOver={event => onDragOver(event, day)} onDragLeave={onDragLeave} onDrop={event => onDrop(event, day)} className={`relative border-r border-slate-200 bg-white ${isToday(day) ? 'bg-primary-50/30' : ''} ${dragOverDate === dateString ? 'ring-1 ring-inset ring-primary-500' : ''}`} style={{ height: timelineHeight }}>
                {hours.map(hour => <div key={hour} className="h-[72px] border-b border-slate-100 bg-[linear-gradient(to_bottom,transparent_0,transparent_35px,rgba(148,163,184,0.15)_36px,transparent_37px)]"></div>)}
                {dayHolidays.length > 0 && (
                  <div className="absolute left-2 right-2 top-2 z-10 rounded-md border border-amber-200 bg-amber-50/95 px-2 py-1 text-[10px] font-bold text-amber-800 shadow-sm">
                    <AppIcon className="ri-suitcase-line mr-1"></AppIcon>
                    {dayHolidays[0].label}{dayHolidays.length > 1 ? ` +${dayHolidays.length - 1}` : ''}
                  </div>
                )}
                {placements.map(({ session, column, totalColumns }) => (
                  <button
                    key={session.id}
                    type="button"
                    draggable={false}
                    onMouseEnter={event => onTooltipChange({ session, x: event.clientX, y: event.clientY })}
                    onMouseMove={event => onTooltipChange({ session, x: event.clientX, y: event.clientY })}
                    onMouseLeave={() => onTooltipChange(null)}
                    onDragStart={event => onDragStart(event, session.id)}
                    onClick={() => onSelectSession(session)}
                    className={`absolute overflow-hidden rounded-lg border border-primary-200 border-l-4 bg-primary-50 px-2 py-1 text-left text-[11px] text-primary-900 shadow-[0_4px_12px_rgba(91,45,187,0.10)] hover:z-20 hover:border-primary-400 ${selectedSession?.id === session.id ? 'z-10 ring-2 ring-primary-300' : ''} ${draggedSession === session.id ? 'opacity-50' : ''}`}
                    style={teamsEventStyle(session, column, totalColumns)}
                  >
                    <span className="block truncate font-bold">{session.title}</span>
                    <span className="block truncate text-[10px] text-primary-700/80">{session.group} - {session.tutor}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TeamsMonthView({ days, currentDate, isToday, isCurrentMonth, getSessionsForDay, getHolidaysForDay, onPickDate, onSelectSession, onTooltipChange }: {
  days: Date[];
  currentDate: Date;
  isToday: (date: Date) => boolean;
  isCurrentMonth: (date: Date) => boolean;
  getSessionsForDay: (date: Date) => CalSession[];
  getHolidaysForDay: (date: Date) => CalendarHoliday[];
  onPickDate: (date: Date) => void;
  onSelectSession: (session: CalSession) => void;
  onTooltipChange: (tooltip: MeetingTooltipState | null) => void;
}) {
  return (
    <div className="h-full overflow-auto bg-white p-4">
      <div className="grid min-w-[900px] grid-cols-7 overflow-hidden rounded-md border border-slate-200">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <div key={day} className="border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase text-slate-500">{day}</div>)}
        {days.map(day => {
          const daySessions = getSessionsForDay(day);
          const dayHolidays = getHolidaysForDay(day);
          return (
            <div key={day.toISOString()} className={`min-h-[118px] border-r border-t border-slate-100 p-2 ${isCurrentMonth(day) ? 'bg-white' : 'bg-slate-50/70'} ${isToday(day) ? 'ring-1 ring-inset ring-primary-300' : ''}`}>
              <button onClick={() => onPickDate(day)} className={`mb-2 inline-grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${formatDate(day) === formatDate(currentDate) ? 'bg-primary-600 text-white' : isCurrentMonth(day) ? 'text-slate-700' : 'text-slate-400'}`}>{day.getDate()}</button>
              <div className="space-y-1">
                {dayHolidays.slice(0, 2).map(holiday => (
                  <div key={holiday.id} className="truncate rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800">
                    <AppIcon className="ri-suitcase-line mr-1"></AppIcon>{holiday.label}
                  </div>
                ))}
                {daySessions.slice(0, 4).map(session => (
                  <button
                    key={session.id}
                    onMouseEnter={event => onTooltipChange({ session, x: event.clientX, y: event.clientY })}
                    onMouseMove={event => onTooltipChange({ session, x: event.clientX, y: event.clientY })}
                    onMouseLeave={() => onTooltipChange(null)}
                    onClick={() => onSelectSession(session)}
                    className="relative block w-full overflow-hidden rounded-md border border-primary-200 bg-primary-50 px-2 py-1 text-left text-[10px] font-semibold text-primary-800"
                  >
                    <span className="block truncate">{session.startTime} {session.title}</span>
                  </button>
                ))}
                {daySessions.length > 4 && <p className="text-[10px] font-semibold text-primary-700">+{daySessions.length - 4} more</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MeetingTooltipOverlay({ tooltip }: { tooltip: MeetingTooltipState | null }) {
  if (!tooltip || typeof document === 'undefined') return null;
  const { session } = tooltip;
  const rows = sessionTooltipRows(session);
  const statusClass = session.status === 'completed'
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : session.status === 'cancelled'
      ? 'bg-red-50 text-red-700 ring-red-200'
      : session.status === 'pending'
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : 'bg-primary-50 text-primary-700 ring-primary-200';
  const width = 320;
  const heightEstimate = 340;
  const viewportWidth = window.innerWidth || 1200;
  const viewportHeight = window.innerHeight || 800;
  const left = Math.min(Math.max(tooltip.x + 16, 12), viewportWidth - width - 12);
  const top = tooltip.y + heightEstimate > viewportHeight
    ? Math.max(tooltip.y - heightEstimate - 16, 12)
    : tooltip.y + 16;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999] w-[320px] rounded-lg border border-slate-200 bg-white text-left text-[11px] text-slate-700 shadow-[0_18px_45px_rgba(15,23,42,0.18)] ring-1 ring-slate-900/5"
      style={{ left, top }}
    >
      <span className="block rounded-t-lg bg-slate-50 px-3 py-2.5">
        <span className="block truncate text-[13px] font-bold text-slate-950">{session.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ring-1 ${statusClass}`}>{session.status}</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-primary-700 ring-1 ring-primary-100">{session.type}</span>
          <span className="text-[10px] font-semibold text-slate-500">{session.startTime} - {session.endTime}</span>
        </span>
      </span>
      <span className="grid gap-1.5 px-3 py-3">
        {rows.map(([label, value]) => (
          <span key={label} className="grid grid-cols-[94px_minmax(0,1fr)] gap-3">
            <span className="font-bold text-slate-500">{label}</span>
            <span className="min-w-0 break-words font-semibold text-slate-900">{value}</span>
          </span>
        ))}
      </span>
    </div>,
    document.body,
  );
}

function TeamsSessionPanel({ session, onClose, onEdit }: { session: CalSession; onClose: () => void; onEdit: () => void }) {
  return (
    <div className="mx-4 mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[9px] font-semibold text-primary-700">{session.type}</span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">{session.status}</span>
          </div>
          <h3 className="text-sm font-heading font-semibold text-slate-950">{session.title}</h3>
        </div>
        <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200"><AppIcon className="ri-close-line text-sm"></AppIcon></button>
      </div>
      <div className="grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
        <TeamsDetail label="Date" value={`${session.date} (${session.day})`} />
        <TeamsDetail label="Time" value={`${session.startTime} - ${session.endTime}`} />
        <TeamsDetail label="Group" value={session.group} />
        <TeamsDetail label="Tutor" value={session.tutor} />
        <TeamsDetail label="Cohort" value={session.cohort} />
        <TeamsDetail label="Programme" value={session.programme} />
        <TeamsDetail label="Module / Week" value={`${session.module} - Week ${session.week}`} />
        <TeamsDetail label="Venue" value={session.venue} />
      </div>
      <div className="mt-4 flex items-center gap-2 border-t border-slate-200 pt-3">
        <button onClick={onEdit} className="rounded-md bg-primary-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-primary-700"><AppIcon className="ri-edit-line mr-1"></AppIcon>Edit Session</button>
        <button disabled className="cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-400"><AppIcon className="ri-delete-bin-line mr-1"></AppIcon>Cancel Session</button>
      </div>
    </div>
  );
}

function TeamsDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-slate-500">{label}</span>
      <p className="font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function TeamsFilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const allLabel = `All ${label}s`;
  const selectedLabel = value === 'all' ? allLabel : value;
  const selectOptions = [{ value: 'all', label: allLabel }, ...options.map(option => ({ value: option, label: option }))];

  return (
    <div className="relative" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <span className="mb-1 block text-[10px] font-bold uppercase text-slate-500">{label}</span>
      <button
        type="button"
        onClick={() => setOpen(previous => !previous)}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left text-[12px] font-semibold shadow-sm outline-none transition ${open ? 'border-primary-400 ring-2 ring-primary-100' : 'border-slate-200 hover:border-primary-200 hover:bg-primary-50/30'}`}
      >
        <span className={value === 'all' ? 'truncate text-slate-600' : 'truncate text-slate-950'}>{selectedLabel}</span>
        <AppIcon className={`ri-arrow-down-s-line text-base text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}></AppIcon>
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.16)] ring-1 ring-slate-900/5">
          <div className="max-h-64 overflow-y-auto py-1 scrollbar-thin scrollbar-track-primary-50 scrollbar-thumb-primary-300 hover:scrollbar-thumb-primary-400 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-primary-50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-primary-300 hover:[&::-webkit-scrollbar-thumb]:bg-primary-400">
            {selectOptions.map(option => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12px] font-semibold transition ${selected ? 'bg-primary-50 text-primary-700' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="truncate">{option.label}</span>
                  {selected && <AppIcon className="ri-check-line text-sm text-primary-700"></AppIcon>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase text-slate-500">{label}</span>
      <input type={type} value={value} onChange={event => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 outline-none focus:border-primary-400" />
    </label>
  );
}

function CalendarGridSkeleton({ view }: { view: CalendarView }) {
  const days = view === 'day' ? 1 : view === 'week' ? 7 : 42;
  if (view === 'month') {
    return (
      <div className="h-full overflow-hidden p-4">
        <div className="grid grid-cols-7 overflow-hidden rounded-md border border-slate-200">
          {Array.from({ length: days + 7 }).map((_, index) => (
            <div key={index} className="min-h-[80px] border border-slate-100 bg-white p-2">
              <SkeletonBlock className="h-3 w-8 bg-slate-200" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-full" style={{ gridTemplateColumns: view === 'day' ? '48px 1fr' : '48px repeat(7, minmax(120px, 1fr))' }}>
      {Array.from({ length: (view === 'day' ? 2 : 8) * 8 }).map((_, index) => <div key={index} className="border border-slate-100 bg-white p-2"><SkeletonBlock className="h-4 w-full bg-slate-200" /></div>)}
    </div>
  );
}
