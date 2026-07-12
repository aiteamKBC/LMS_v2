<<<<<<< HEAD
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { SkeletonBlock } from '@/components/feature/CurriculumSkeletons';
import { curriculumNavItems } from '@/mocks/navigation';
import { useCurriculumSessions } from '@/hooks/useCurriculumSessions';
import { updateCurriculumSession, type CurriculumSession } from '@/lib/curriculumApi';
=======
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)

// ─────────────────── Types ───────────────────

interface CalSession {
  id: string;
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
}

<<<<<<< HEAD
=======
// ─────────────────── Mock Data ───────────────────

const ALL_SESSIONS: CalSession[] = [
  // Cohort A — Group A1 sessions
  { id: 'sc-1', title: 'Welcome & Cohort Induction', type: 'Live Session', date: '2024-09-02', day: 'Mon', startTime: '09:30', endTime: '11:00', tutor: 'James Thompson', group: 'A1, A2', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'Teams', module: 'M1', week: 1, status: 'completed' },
  { id: 'sc-2', title: 'Marketing Environment & PESTLE', type: 'Workshop', date: '2024-09-04', day: 'Wed', startTime: '09:30', endTime: '11:30', tutor: 'James Thompson', group: 'A1', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'Room 302', module: 'M1', week: 1, status: 'completed' },
  { id: 'sc-3', title: 'Self-study: Marketing Frameworks', type: 'Self-study', date: '2024-09-05', day: 'Thu', startTime: '14:00', endTime: '15:30', tutor: 'Self-directed', group: 'A1', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'LMS', module: 'M1', week: 1, status: 'completed' },
  { id: 'sc-4', title: 'Weekly OTJH Log & Reflection', type: 'OTJH', date: '2024-09-06', day: 'Fri', startTime: '16:00', endTime: '16:30', tutor: 'Sarah Mitchell', group: 'A1', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'LMS', module: 'M1', week: 1, status: 'completed' },
  { id: 'sc-5', title: 'Quiz — Marketing Foundations', type: 'Quiz', date: '2024-09-06', day: 'Fri', startTime: '11:00', endTime: '11:30', tutor: 'Auto-marked', group: 'A1', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'LMS', module: 'M1', week: 1, status: 'completed' },
  { id: 'sc-6', title: 'Customer Journey Mapping', type: 'Live Session', date: '2024-09-09', day: 'Mon', startTime: '09:30', endTime: '11:00', tutor: 'Emily Roberts', group: 'A2', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'Teams', module: 'M1', week: 2, status: 'completed' },
  { id: 'sc-7', title: 'Segmentation Workshop', type: 'Workshop', date: '2024-09-11', day: 'Wed', startTime: '09:30', endTime: '12:00', tutor: 'Emily Roberts', group: 'A2', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'Room 305', module: 'M1', week: 2, status: 'completed' },
  { id: 'sc-8', title: 'Research Methods & Data Collection', type: 'Live Session', date: '2024-09-30', day: 'Mon', startTime: '09:30', endTime: '11:00', tutor: 'Mark Williams', group: 'A1', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'Teams', module: 'M2', week: 5, status: 'completed' },
  { id: 'sc-9', title: 'Survey Design Workshop', type: 'Workshop', date: '2024-10-02', day: 'Wed', startTime: '09:30', endTime: '11:30', tutor: 'Mark Williams', group: 'A1, A2', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'Room 302', module: 'M2', week: 5, status: 'completed' },
  // Cohort B
  { id: 'sc-10', title: 'Welcome & Cohort Induction (B)', type: 'Live Session', date: '2025-03-03', day: 'Mon', startTime: '09:30', endTime: '11:00', tutor: 'James Thompson', group: 'B1, B2', cohort: 'Cohort B', programme: 'Marketing Executive L4', venue: 'Teams', module: 'M1', week: 1, status: 'completed' },
  { id: 'sc-11', title: 'Marketing Environment & PESTLE', type: 'Workshop', date: '2025-03-05', day: 'Wed', startTime: '09:30', endTime: '11:30', tutor: 'James Thompson', group: 'B1', cohort: 'Cohort B', programme: 'Marketing Executive L4', venue: 'Room 302', module: 'M1', week: 1, status: 'completed' },
  { id: 'sc-12', title: 'Campaign Planning Overview', type: 'Live Session', date: '2025-05-19', day: 'Mon', startTime: '09:30', endTime: '11:00', tutor: 'James Thompson', group: 'B1', cohort: 'Cohort B', programme: 'Marketing Executive L4', venue: 'Teams', module: 'M3', week: 9, status: 'scheduled' },
  { id: 'sc-13', title: 'Campaign Planning Workshop', type: 'Workshop', date: '2025-05-21', day: 'Wed', startTime: '09:30', endTime: '11:30', tutor: 'James Thompson', group: 'B1', cohort: 'Cohort B', programme: 'Marketing Executive L4', venue: 'Room 310', module: 'M3', week: 9, status: 'scheduled' },
  // Upcoming — Cohort A
  { id: 'sc-14', title: 'Digital Channels Strategy', type: 'Live Session', date: '2026-06-15', day: 'Mon', startTime: '09:30', endTime: '11:00', tutor: 'Emily Roberts', group: 'A2', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'Teams', module: 'M3', week: 10, status: 'scheduled' },
  { id: 'sc-15', title: 'Channel Strategy Workshop', type: 'Workshop', date: '2026-06-17', day: 'Wed', startTime: '09:30', endTime: '11:30', tutor: 'Emily Roberts', group: 'A2', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'Room 305', module: 'M3', week: 10, status: 'scheduled' },
  { id: 'sc-16', title: 'Content Strategy Principles', type: 'Live Session', date: '2026-06-22', day: 'Mon', startTime: '09:30', endTime: '11:00', tutor: 'James Thompson', group: 'A1', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'Teams', module: 'M3', week: 11, status: 'scheduled' },
  { id: 'sc-17', title: 'Content Planning Workshop', type: 'Workshop', date: '2026-06-24', day: 'Wed', startTime: '09:30', endTime: '11:30', tutor: 'James Thompson', group: 'A1', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'Room 302', module: 'M3', week: 11, status: 'scheduled' },
  { id: 'sc-18', title: 'Evaluation Frameworks', type: 'Live Session', date: '2026-06-29', day: 'Mon', startTime: '09:30', endTime: '11:00', tutor: 'Mark Williams', group: 'A1, A2', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'Teams', module: 'M4', week: 13, status: 'scheduled' },
  { id: 'sc-19', title: 'KPI Workshop', type: 'Workshop', date: '2026-07-01', day: 'Wed', startTime: '09:30', endTime: '11:30', tutor: 'Mark Williams', group: 'A1, A2', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'Room 302', module: 'M4', week: 13, status: 'scheduled' },
  { id: 'sc-20', title: 'Improvement Methodologies', type: 'Live Session', date: '2026-07-06', day: 'Mon', startTime: '09:30', endTime: '11:00', tutor: 'James Thompson', group: 'A1', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'Teams', module: 'M4', week: 14, status: 'scheduled' },
  { id: 'sc-21', title: 'A/B Testing Workshop', type: 'Workshop', date: '2026-07-08', day: 'Wed', startTime: '09:30', endTime: '11:30', tutor: 'James Thompson', group: 'A1', cohort: 'Cohort A', programme: 'Marketing Executive L4', venue: 'Room 302', module: 'M4', week: 14, status: 'scheduled' },
];

>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
// ─────────────────── Colour maps ───────────────────

const typeColors: Record<string, string> = {
  'Live Session': 'bg-primary-100 text-primary-700 border-primary-300',
  'Workshop': 'bg-accent-100 text-accent-700 border-accent-300',
  'Self-study': 'bg-secondary-100 text-secondary-700 border-secondary-300',
  'Assignment': 'bg-amber-100 text-amber-700 border-amber-300',
  'Quiz': 'bg-rose-100 text-rose-700 border-rose-300',
  'OTJH': 'bg-emerald-100 text-emerald-700 border-emerald-300',
  'Collaboration': 'bg-violet-100 text-violet-700 border-violet-300',
  'Review': 'bg-sky-100 text-sky-700 border-sky-300',
};

const typeDotColors: Record<string, string> = {
  'Live Session': 'bg-primary-500',
  'Workshop': 'bg-accent-500',
  'Self-study': 'bg-secondary-500',
  'Assignment': 'bg-amber-500',
  'Quiz': 'bg-rose-500',
  'OTJH': 'bg-emerald-500',
  'Collaboration': 'bg-violet-500',
  'Review': 'bg-sky-500',
};

const statusColors: Record<string, string> = {
  scheduled: 'bg-primary-100 text-primary-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
};

<<<<<<< HEAD
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

const validSessionStatuses = new Set<CalSession['status']>([
  'scheduled',
  'completed',
  'cancelled',
  'pending',
]);

function normalizeApiSession(session: CurriculumSession): CalSession {
  return {
    id: session.id,
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
  };
}

=======
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
// ─────────────────── Helpers ───────────────────

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function addDays(d: Date, n: number): Date {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

function addWeeks(d: Date, n: number): Date {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n * 7);
  return nd;
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatDateFull(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// ─────────────────── Component ───────────────────

export default function SessionCalendarPage() {
<<<<<<< HEAD
  const { sessions: apiSessions, loading, error, reload } = useCurriculumSessions();
  const [sessions, setSessions] = useState<CalSession[]>([]);
  const [view, setView] = useState<'week' | 'month'>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [draggedSession, setDraggedSession] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<CalSession | null>(null);
  const [editingSession, setEditingSession] = useState<CalSession | null>(null);
  const [sessionForm, setSessionForm] = useState({ startTime: '', endTime: '', tutor: '' });
  const [savingSession, setSavingSession] = useState(false);
=======
  const [sessions, setSessions] = useState<CalSession[]>(ALL_SESSIONS);
  const [view, setView] = useState<'week' | 'month'>('week');
  const [currentDate, setCurrentDate] = useState(new Date('2026-06-10'));
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [draggedSession, setDraggedSession] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<CalSession | null>(null);
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
  const [filters, setFilters] = useState<{ cohort: string; group: string; type: string; tutor: string }>({ cohort: 'all', group: 'all', type: 'all', tutor: 'all' });
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Filter state
  const [showFilters, setShowFilters] = useState(false);

<<<<<<< HEAD
  useEffect(() => {
    if (!apiSessions.length) return;

    const liveSessions = apiSessions.map(normalizeApiSession);
    setSessions(liveSessions);

    const firstSession = liveSessions.find(session => session.date);
    if (firstSession) {
      setCurrentDate(new Date(firstSession.date));
    }
  }, [apiSessions]);

=======
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
  const weekStart = view === 'week' ? getWeekStart(currentDate) : getMonthStart(currentDate);
  const daysInWeek = 7;
  const weeksToShow = view === 'week' ? 1 : 5;

  // Build day grid
  const dayHeaders: Date[] = [];
  if (view === 'week') {
    for (let i = 0; i < daysInWeek; i++) {
      dayHeaders.push(addDays(weekStart, i));
    }
  } else {
    const monthStart = getMonthStart(currentDate);
    const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    const totalDays = lastDay.getDate();
    const startDow = monthStart.getDay();
    const adjustedStart = startDow === 0 ? 6 : startDow - 1;
    for (let i = -adjustedStart; i < totalDays; i++) {
      dayHeaders.push(addDays(monthStart, i));
      if (dayHeaders.length >= 42) break;
    }
  }

  const timeSlots = view === 'week' ? ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'] : [];

  // Filter sessions
  const filteredSessions = sessions.filter(s => {
    if (filters.cohort !== 'all' && s.cohort !== filters.cohort) return false;
    if (filters.group !== 'all' && !s.group.includes(filters.group)) return false;
    if (filters.type !== 'all' && s.type !== filters.type) return false;
    if (filters.tutor !== 'all' && s.tutor !== filters.tutor) return false;
    return true;
  });

  const getSessionsForDay = (date: Date) => {
    const ds = formatDate(date);
    return filteredSessions.filter(s => s.date === ds);
  };

  const getSessionsForDayAndSlot = (date: Date, hour: string) => {
    return getSessionsForDay(date).filter(s => s.startTime.startsWith(hour.split(':')[0]));
  };

  const handleDragStart = (e: React.DragEvent, sessionId: string) => {
    setDraggedSession(sessionId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sessionId);
  };

  const handleDragOverSlot = (e: React.DragEvent, date: Date) => {
    e.preventDefault();
    setDragOverDate(formatDate(date));
  };

  const handleDragLeaveSlot = () => {
    setDragOverDate(null);
  };

  const handleDropSlot = (e: React.DragEvent, date: Date) => {
    e.preventDefault();
    setDragOverDate(null);
    const sessionId = e.dataTransfer.getData('text/plain') || draggedSession;
    if (!sessionId) return;
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    const newDate = formatDate(date);
    if (newDate === session.date) return;

<<<<<<< HEAD
    setNotification({ type: 'error', message: `"${session.title}" is generated from a training-plan row. Drag/drop rescheduling is disabled to avoid changing the wider delivery series.` });
=======
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, date: newDate } : s));
    setNotification({ type: 'success', message: `"${session.title}" rescheduled to ${formatDateFull(date)}` });
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
    setDraggedSession(null);
    setTimeout(() => setNotification(null), 3500);
  };

  const navigateWeek = (dir: -1 | 1) => {
    setCurrentDate(prev => addWeeks(prev, dir));
  };

  const navigateMonth = (dir: -1 | 1) => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + dir);
      return d;
    });
  };

  const goToday = () => {
<<<<<<< HEAD
    setCurrentDate(new Date());
    setView('week');
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
      setNotification({ type: 'error', message: err instanceof Error ? err.message : 'Unable to update session.' });
    } finally {
      setSavingSession(false);
      setTimeout(() => setNotification(null), 3500);
    }
  };

=======
    setCurrentDate(new Date('2026-06-10'));
    setView('week');
  };

>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
  // Get unique filter options
  const uniqueCohorts = useMemo(() => [...new Set(sessions.map(s => s.cohort))], [sessions]);
  const uniqueGroups = useMemo(() => [...new Set(sessions.flatMap(s => s.group.split(', ').map(g => g.trim())))], [sessions]);
  const uniqueTypes = useMemo(() => [...new Set(sessions.map(s => s.type))], [sessions]);
  const uniqueTutors = useMemo(() => [...new Set(sessions.map(s => s.tutor))], [sessions]);

  const isToday = (d: Date) => {
<<<<<<< HEAD
    const today = new Date();
=======
    const today = new Date('2026-06-10');
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
    return formatDate(d) === formatDate(today);
  };

  const isCurrentMonth = (d: Date) => {
    return d.getMonth() === currentDate.getMonth();
  };

  return (
<<<<<<< HEAD
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Session Calendar" pageSubtitle={loading ? 'Loading live LMS sessions...' : `${filteredSessions.length} sessions · Drag & drop to reschedule`} userName="Rachel Myers" userRole="Curriculum Designer">
=======
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Session Calendar" pageSubtitle={`${filteredSessions.length} sessions · Drag & drop to reschedule`} userName="Rachel Myers" userRole="Curriculum Designer">
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
      <div className="p-6 space-y-5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[12px] text-foreground-400">
          <Link to="/workspace/curriculum" className="hover:text-foreground-700 transition-smooth">Curriculum Studio</Link>
          <i className="ri-arrow-right-s-line text-[10px]"></i>
          <span className="text-foreground-900 font-medium">Session Calendar</span>
        </div>

        {/* Notification */}
        {notification && (
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-medium ${notification.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50' : 'bg-red-50 text-red-700 border border-red-200/50'}`}>
            <i className={`${notification.type === 'success' ? 'ri-check-line' : 'ri-close-line'} text-sm`}></i>
            {notification.message}
          </div>
        )}

<<<<<<< HEAD
        {error && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-medium bg-amber-50 text-amber-700 border border-amber-200/50">
            <i className="ri-wifi-off-line text-sm"></i>
            Live LMS data is unavailable, so no generated session schedule is shown.
          </div>
        )}

=======
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
        {/* Controls Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1">
              <button onClick={() => setView('week')} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${view === 'week' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                <i className="ri-calendar-line mr-1"></i> Week
              </button>
              <button onClick={() => setView('month')} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${view === 'month' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                <i className="ri-calendar-2-line mr-1"></i> Month
              </button>
            </div>

            <button onClick={goToday} className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
              Today
            </button>

            <div className="flex items-center gap-1">
              <button onClick={() => view === 'week' ? navigateWeek(-1) : navigateMonth(-1)} className="w-8 h-8 rounded-lg bg-background-50 border border-background-200 flex items-center justify-center hover:bg-background-100 transition-smooth cursor-pointer">
                <i className="ri-arrow-left-s-line text-sm"></i>
              </button>
              <button onClick={() => view === 'week' ? navigateWeek(1) : navigateMonth(1)} className="w-8 h-8 rounded-lg bg-background-50 border border-background-200 flex items-center justify-center hover:bg-background-100 transition-smooth cursor-pointer">
                <i className="ri-arrow-right-s-line text-sm"></i>
              </button>
            </div>

            <h3 className="text-sm font-heading font-semibold text-foreground-900 ml-1">
              {view === 'week'
                ? `${formatDateShort(dayHeaders[0])} — ${formatDateShort(dayHeaders[dayHeaders.length - 1])}, ${dayHeaders[0].getFullYear()}`
                : currentDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
              }
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setShowFilters(!showFilters)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap border ${showFilters || Object.values(filters).some(v => v !== 'all') ? 'bg-primary-50 text-primary-700 border-primary-200/50' : 'bg-background-50 text-foreground-500 border-background-200'}`}>
              <i className="ri-filter-line mr-1"></i> Filters
              {Object.values(filters).filter(v => v !== 'all').length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary-500 text-white text-[9px]">{Object.values(filters).filter(v => v !== 'all').length}</span>
              )}
            </button>
<<<<<<< HEAD
            <button disabled title="Sessions are generated from scoped training-plan allocations. Create the parent cohort/group/module allocation first." className="px-3 py-1.5 bg-background-100 text-foreground-400 border border-background-200 rounded-lg text-[11px] font-semibold cursor-not-allowed whitespace-nowrap">
=======
            <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
              <i className="ri-add-line mr-1"></i> New Session
            </button>
          </div>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <FilterSelect label="Cohort" value={filters.cohort} options={uniqueCohorts} onChange={v => setFilters(prev => ({ ...prev, cohort: v }))} />
              <FilterSelect label="Group" value={filters.group} options={uniqueGroups} onChange={v => setFilters(prev => ({ ...prev, group: v }))} />
              <FilterSelect label="Type" value={filters.type} options={uniqueTypes} onChange={v => setFilters(prev => ({ ...prev, type: v }))} />
              <FilterSelect label="Tutor" value={filters.tutor} options={uniqueTutors} onChange={v => setFilters(prev => ({ ...prev, tutor: v }))} />
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-semibold text-foreground-400 uppercase">Types:</span>
          {Object.entries(typeDotColors).map(([type, dotClass]) => (
            <span key={type} className="flex items-center gap-1.5 text-[10px] text-foreground-500">
              <span className={`w-2 h-2 rounded-full ${dotClass}`}></span>
              {type}
            </span>
          ))}
<<<<<<< HEAD
          <span className="text-[10px] text-foreground-300 ml-2"><i className="ri-lock-line mr-1"></i>Generated sessions cannot be drag-rescheduled individually</span>
=======
          <span className="text-[10px] text-foreground-300 ml-2"><i className="ri-drag-move-line mr-1"></i>Drag sessions to reschedule</span>
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
        </div>

        {/* Calendar Grid */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
<<<<<<< HEAD
          {loading ? (
            <CalendarGridSkeleton view={view} />
          ) : view === 'week' ? (
=======
          {view === 'week' ? (
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
            /* ── WEEK VIEW ── */
            <div>
              {/* Day Headers */}
              <div className="grid grid-cols-[70px_1fr_1fr_1fr_1fr_1fr_1fr_1fr] border-b border-foreground-300/50">
                <div className="py-3 px-2 text-[10px] font-semibold text-foreground-400 uppercase"></div>
                {dayHeaders.map(d => (
                  <div key={d.toISOString()} className={`py-3 px-2 text-center border-l border-background-200/30 ${isToday(d) ? 'bg-primary-50/50' : ''}`}>
                    <p className="text-[10px] font-semibold text-foreground-400 uppercase">{d.toLocaleDateString('en-GB', { weekday: 'short' })}</p>
                    <p className={`text-sm font-bold ${isToday(d) ? 'text-primary-600' : 'text-foreground-900'}`}>{d.getDate()}</p>
                  </div>
                ))}
              </div>

              {/* Time Slots */}
              <div className="max-h-[550px] overflow-y-auto">
                {timeSlots.map(hour => (
                  <div key={hour} className="grid grid-cols-[70px_1fr_1fr_1fr_1fr_1fr_1fr_1fr] border-b border-background-200/20">
                    <div className="py-3 px-2 text-[10px] text-foreground-400 font-medium border-r border-background-200/20">{hour}</div>
                    {dayHeaders.map(d => {
                      const slotSessions = getSessionsForDayAndSlot(d, hour);
                      const dateStr = formatDate(d);
                      return (
                        <div
                          key={d.toISOString()}
                          onDragOver={(e) => handleDragOverSlot(e, d)}
                          onDragLeave={handleDragLeaveSlot}
                          onDrop={(e) => handleDropSlot(e, d)}
                          className={`py-1 px-1 border-l border-background-200/20 min-h-[50px] transition-smooth ${isToday(d) ? 'bg-primary-50/20' : ''} ${dragOverDate === dateStr ? 'bg-primary-50 ring-1 ring-primary-300' : ''}`}
                        >
                          {slotSessions.map(s => (
                            <div
                              key={s.id}
<<<<<<< HEAD
                              draggable={false}
=======
                              draggable
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                              onDragStart={(e) => handleDragStart(e, s.id)}
                              onClick={() => setSelectedSession(selectedSession?.id === s.id ? null : s)}
                              className={`p-1.5 rounded-md border text-[9px] leading-tight mb-1 cursor-pointer hover:shadow-sm transition-smooth ${typeColors[s.type] || 'bg-foreground-100 border-foreground-200 text-foreground-700'} ${draggedSession === s.id ? 'opacity-40' : ''}`}
                            >
                              <div className="flex items-center gap-1 mb-0.5">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${typeDotColors[s.type] || 'bg-foreground-400'}`}></span>
                                <p className="font-semibold truncate">{s.title}</p>
                              </div>
                              <p className="opacity-70 truncate">{s.startTime}—{s.endTime} · {s.group} · {s.tutor}</p>
                              {s.status === 'completed' && <span className="text-[8px] font-semibold text-emerald-600 mt-0.5 block"><i className="ri-check-line mr-0.5"></i>Completed</span>}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* ── MONTH VIEW ── */
            <div>
              {/* Day-of-week headers */}
              <div className="grid grid-cols-7 border-b border-foreground-300/50">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                  <div key={d} className="py-3 text-center text-[10px] font-semibold text-foreground-400 uppercase border-l border-background-200/30 first:border-l-0">{d}</div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7">
                {dayHeaders.map((d, i) => {
                  const daySessions = getSessionsForDay(d);
                  const dateStr = formatDate(d);
                  const inMonth = isCurrentMonth(d);
                  return (
                    <div
                      key={i}
                      onDragOver={(e) => handleDragOverSlot(e, d)}
                      onDragLeave={handleDragLeaveSlot}
                      onDrop={(e) => handleDropSlot(e, d)}
                      className={`min-h-[90px] border border-background-200/20 p-1.5 transition-smooth ${!inMonth ? 'bg-background-100/50' : ''} ${isToday(d) ? 'bg-primary-50/30 ring-1 ring-primary-200' : ''} ${dragOverDate === dateStr ? 'bg-primary-50 ring-1 ring-primary-300' : ''}`}
                    >
                      <p className={`text-[11px] font-semibold mb-1 ${!inMonth ? 'text-foreground-300' : isToday(d) ? 'text-primary-600' : 'text-foreground-700'}`}>
                        {d.getDate()}
                      </p>
                      <div className="space-y-0.5">
                        {daySessions.slice(0, 3).map(s => (
                          <div
                            key={s.id}
<<<<<<< HEAD
                              draggable={false}
=======
                            draggable
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                            onDragStart={(e) => handleDragStart(e, s.id)}
                            onClick={() => setSelectedSession(selectedSession?.id === s.id ? null : s)}
                            className={`px-1.5 py-0.5 rounded text-[8px] font-medium truncate cursor-pointer border ${typeColors[s.type] || 'bg-foreground-100 border-foreground-200 text-foreground-700'} ${draggedSession === s.id ? 'opacity-40' : ''}`}
                          >
                            <span className={`inline-block w-1 h-1 rounded-full mr-1 ${typeDotColors[s.type] || 'bg-foreground-400'}`}></span>
                            {s.startTime} {s.title}
                          </div>
                        ))}
                        {daySessions.length > 3 && (
                          <p className="text-[8px] text-foreground-400 font-medium pl-1">+{daySessions.length - 3} more</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Session Detail Panel */}
        {selectedSession && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${typeColors[selectedSession.type]?.split(' ')[0]} ${typeColors[selectedSession.type]?.split(' ')[1]}`}>{selectedSession.type}</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusColors[selectedSession.status]}`}>{selectedSession.status}</span>
                </div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">{selectedSession.title}</h3>
              </div>
              <button onClick={() => setSelectedSession(null)} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center hover:bg-background-200 transition-smooth cursor-pointer">
                <i className="ri-close-line text-sm"></i>
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
              <div><span className="text-foreground-400">Date</span><p className="font-semibold text-foreground-800">{selectedSession.date} ({selectedSession.day})</p></div>
              <div><span className="text-foreground-400">Time</span><p className="font-semibold text-foreground-800">{selectedSession.startTime} — {selectedSession.endTime}</p></div>
              <div><span className="text-foreground-400">Group</span><p className="font-semibold text-foreground-800">{selectedSession.group}</p></div>
              <div><span className="text-foreground-400">Tutor</span><p className="font-semibold text-foreground-800">{selectedSession.tutor}</p></div>
              <div><span className="text-foreground-400">Cohort</span><p className="font-semibold text-foreground-800">{selectedSession.cohort}</p></div>
              <div><span className="text-foreground-400">Programme</span><p className="font-semibold text-foreground-800">{selectedSession.programme}</p></div>
              <div><span className="text-foreground-400">Module / Week</span><p className="font-semibold text-foreground-800">{selectedSession.module} · Week {selectedSession.week}</p></div>
              <div><span className="text-foreground-400">Venue</span><p className="font-semibold text-foreground-800">{selectedSession.venue}</p></div>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-background-200/30">
<<<<<<< HEAD
              <button onClick={() => openEditSession(selectedSession)} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <i className="ri-edit-line mr-1"></i> Edit Session
              </button>
              <button disabled title="Individual generated sessions cannot be cancelled safely without a stored session row." className="px-3 py-1.5 bg-background-100 text-foreground-400 border border-background-200 rounded-lg text-[11px] font-medium cursor-not-allowed whitespace-nowrap">
=======
              <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <i className="ri-edit-line mr-1"></i> Edit Session
              </button>
              <button className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200/50 rounded-lg text-[11px] font-medium hover:bg-red-100 transition-smooth cursor-pointer whitespace-nowrap">
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                <i className="ri-delete-bin-line mr-1"></i> Cancel Session
              </button>
            </div>
          </div>
        )}
<<<<<<< HEAD

        {editingSession && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEditingSession(null)}>
            <form onSubmit={saveSession} className="bg-background-50 rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="px-6 py-4 border-b border-foreground-400/50 flex items-center justify-between">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Edit Session</h3>
                <button type="button" onClick={() => setEditingSession(null)} className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center hover:bg-background-200 transition-smooth cursor-pointer"><i className="ri-close-line text-foreground-500"></i></button>
              </div>
              <div className="p-6 space-y-4">
                <SessionField label="Start time" type="time" value={sessionForm.startTime} onChange={value => setSessionForm(prev => ({ ...prev, startTime: value }))} />
                <SessionField label="End time" type="time" value={sessionForm.endTime} onChange={value => setSessionForm(prev => ({ ...prev, endTime: value }))} />
                <SessionField label="Tutor" value={sessionForm.tutor} onChange={value => setSessionForm(prev => ({ ...prev, tutor: value }))} />
              </div>
              <div className="px-6 py-4 border-t border-background-200/60 flex justify-end gap-2">
                <button type="button" onClick={() => setEditingSession(null)} disabled={savingSession} className="px-4 py-2 rounded-lg border border-background-200 text-[12px] font-semibold text-foreground-600 hover:bg-background-100 disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={savingSession} className="px-4 py-2 rounded-lg bg-primary-500 text-white text-[12px] font-semibold hover:bg-primary-600 disabled:opacity-50">{savingSession ? 'Saving...' : 'Save Session'}</button>
              </div>
            </form>
          </div>
        )}
=======
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
      </div>
    </WorkspaceShell>
  );
}

// ─────────────────── Helper Components ───────────────────

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-foreground-400 uppercase mb-1 block">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-background-200 bg-background-50 text-[12px] text-foreground-900 outline-none cursor-pointer"
      >
        <option value="all">All {label}s</option>
        {options.map(o => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
<<<<<<< HEAD
}

function SessionField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} className="mt-1 w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 focus:outline-none focus:border-primary-300" />
    </label>
  );
}

function CalendarGridSkeleton({ view }: { view: 'week' | 'month' }) {
  if (view === 'month') {
    return (
      <div className="animate-pulse">
        <div className="grid grid-cols-7 border-b border-foreground-300/50">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="py-3 px-2 border-l border-background-200/30 first:border-l-0">
              <SkeletonBlock className="h-2.5 w-8 mx-auto" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: 35 }).map((_, index) => (
            <div key={index} className="min-h-[90px] border border-background-200/20 p-2 space-y-2">
              <SkeletonBlock className="h-3 w-5" />
              <SkeletonBlock className="h-4 w-full" />
              <SkeletonBlock className="h-4 w-4/5" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-pulse">
      <div className="grid grid-cols-[70px_1fr_1fr_1fr_1fr_1fr_1fr_1fr] border-b border-foreground-300/50">
        <div className="py-3 px-2"></div>
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="py-3 px-2 border-l border-background-200/30">
            <SkeletonBlock className="h-2.5 w-8 mx-auto mb-2" />
            <SkeletonBlock className="h-4 w-5 mx-auto" />
          </div>
        ))}
      </div>
      {Array.from({ length: 8 }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid grid-cols-[70px_1fr_1fr_1fr_1fr_1fr_1fr_1fr] border-b border-background-200/20">
          <div className="py-3 px-2"><SkeletonBlock className="h-2.5 w-9" /></div>
          {Array.from({ length: 7 }).map((_, columnIndex) => (
            <div key={columnIndex} className="py-2 px-1 border-l border-background-200/20 min-h-[54px]">
              {(rowIndex + columnIndex) % 3 === 0 && <SkeletonBlock className="h-9 w-full rounded-md" />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
=======
}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
