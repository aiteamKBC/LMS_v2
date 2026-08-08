import { useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const misNav = roleNavMap.mis;

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface CalendarEvent {
  id: string;
  date: string;
  time: string;
  title: string;
  type: 'Session' | 'Deadline' | 'Review' | 'Holiday' | 'Event' | 'Coaching';
  cohort: string;
  tutor: string;
  description: string;
  duration: string;
  priority: 'High' | 'Medium' | 'Low';
}

const EVENTS: CalendarEvent[] = [
  { id: 'ce-1', date: '2026-06-08', time: '09:00', title: 'Business Communication', type: 'Session', cohort: 'Cohort A — BA', tutor: 'Rachel Myers', description: 'Live Teams session', duration: '2h', priority: 'Medium' },
  { id: 'ce-2', date: '2026-06-08', time: '11:00', title: 'Data Analysis & Visualisation', type: 'Session', cohort: 'Cohort D — DT', tutor: 'Dr. Helen Park', description: 'Live Teams session', duration: '2h', priority: 'Medium' },
  { id: 'ce-3', date: '2026-06-09', time: '09:00', title: 'Child Development', type: 'Session', cohort: 'Cohort E — EYE', tutor: 'Louise Baker', description: 'Live Teams session', duration: '2h', priority: 'Medium' },
  { id: 'ce-4', date: '2026-06-09', time: '14:00', title: 'Marketing Principles', type: 'Session', cohort: 'Cohort B — DM', tutor: 'Dr. Helen Park', description: 'Live Teams session', duration: '2h', priority: 'Medium' },
  { id: 'ce-5', date: '2026-06-10', time: '09:00', title: 'Customer Segmentation', type: 'Session', cohort: 'Cohort C — BA', tutor: 'Crispin Jones', description: 'Live Teams session', duration: '2h', priority: 'Medium' },
  { id: 'ce-6', date: '2026-06-10', time: '11:00', title: '1:1 Coaching', type: 'Coaching', cohort: 'Mixed', tutor: 'Med Maher', description: 'Individual coaching sessions', duration: '1h', priority: 'High' },
  { id: 'ce-7', date: '2026-06-10', time: '14:00', title: 'Progress Review Deadline', type: 'Deadline', cohort: 'Cohort A — BA', tutor: 'Rachel Myers', description: 'Monthly progress review submission', duration: '1h', priority: 'High' },
  { id: 'ce-8', date: '2026-06-11', time: '09:00', title: 'Programming Fundamentals', type: 'Session', cohort: 'Cohort F — SWE', tutor: 'Mike Harrison', description: 'Live Teams session', duration: '2h', priority: 'Medium' },
  { id: 'ce-9', date: '2026-06-12', time: '09:00', title: 'Business Admin Practice', type: 'Session', cohort: 'Cohort A — BA', tutor: 'Rachel Myers', description: 'Live Teams session', duration: '2h', priority: 'Medium' },
  { id: 'ce-10', date: '2026-06-12', time: '14:00', title: 'Marketing Planning', type: 'Session', cohort: 'Cohort C — BA', tutor: 'Crispin Jones', description: 'Live Teams session', duration: '2h', priority: 'Medium' },
  { id: 'ce-11', date: '2026-06-15', time: '10:00', title: 'Bank Holiday', type: 'Holiday', cohort: '-', tutor: '-', description: 'Public holiday - no sessions', duration: '1d', priority: 'Low' },
  { id: 'ce-12', date: '2026-06-18', time: '10:00', title: 'Cohort E Start Date', type: 'Event', cohort: 'Cohort E — EYE', tutor: 'Louise Baker', description: 'Programme start date', duration: '1d', priority: 'High' },
  { id: 'ce-13', date: '2026-06-22', time: '14:00', title: 'Gateway Review', type: 'Review', cohort: 'Cohort A — BA', tutor: 'Rachel Myers', description: 'Gateway readiness assessment', duration: '2h', priority: 'High' },
  { id: 'ce-14', date: '2026-06-25', time: '09:00', title: 'ILR Submission Deadline', type: 'Deadline', cohort: 'All', tutor: 'MIS Team', description: 'ILR data submission deadline', duration: '1d', priority: 'High' },
  { id: 'ce-15', date: '2026-06-26', time: '10:00', title: 'Team Away Day', type: 'Event', cohort: 'All', tutor: 'All', description: 'Staff development day', duration: '1d', priority: 'Medium' },
];

const typeBadge = (t: CalendarEvent['type']) => {
  switch (t) {
    case 'Session': return 'bg-primary-100 text-primary-700';
    case 'Deadline': return 'bg-rose-100 text-rose-700';
    case 'Review': return 'bg-accent-100 text-accent-700';
    case 'Holiday': return 'bg-foreground-100 text-foreground-500';
    case 'Event': return 'bg-secondary-100 text-secondary-700';
    case 'Coaching': return 'bg-emerald-100 text-emerald-700';
    default: return '';
  }
};

const typeDot = (t: CalendarEvent['type']) => {
  switch (t) {
    case 'Session': return 'bg-primary-500';
    case 'Deadline': return 'bg-rose-500';
    case 'Review': return 'bg-accent-500';
    case 'Holiday': return 'bg-foreground-300';
    case 'Event': return 'bg-secondary-500';
    case 'Coaching': return 'bg-emerald-500';
    default: return 'bg-foreground-300';
  }
};

export default function MisCalendarPage() {
  const [view, setView] = useState<'week' | 'month'>('month');
  const [monthOffset, setMonthOffset] = useState(0);
  const [showEvent, setShowEvent] = useState<CalendarEvent | null>(null);
  const [filterType, setFilterType] = useState('All');

  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const monthName = `${MONTHS[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = (currentMonth.getDay() + 6) % 7;

  const filtered = EVENTS.filter(e => filterType === 'All' || e.type === filterType);

  const getEventsForDate = (day: number) => {
    const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return filtered.filter(e => e.date === dateStr);
  };

  const weekEvents = filtered.filter(e => {
    const eventDate = new Date(e.date);
    const weekStart = new Date(currentMonth);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return eventDate >= weekStart && eventDate < weekEnd;
  });

  return (
    <WorkspaceShell
      role="mis" roleLabel={misNav.label} navItems={misNav.items} workspaceLabel={misNav.workspaceLabel}
      pageTitle="Calendar" pageSubtitle="Organisation-wide calendar view of all sessions, deadlines, and events"
      userName="Priya Sharma" userRole="MIS Operations Lead"
    >
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'This Month', value: String(EVENTS.filter(e => e.date.startsWith(`${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`)).length), icon: 'ri-calendar-line', color: 'primary' },
            { label: 'Sessions', value: String(EVENTS.filter(e => e.type === 'Session').length), icon: 'ri-video-line', color: 'accent' },
            { label: 'Deadlines', value: String(EVENTS.filter(e => e.type === 'Deadline').length), icon: 'ri-timer-line', color: 'secondary' },
            { label: 'High Priority', value: String(EVENTS.filter(e => e.priority === 'High').length), icon: 'ri-alert-line', color: 'primary' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'primary' ? 'bg-primary-100 text-primary-600' : s.color === 'accent' ? 'bg-accent-100 text-accent-700' : 'bg-secondary-100 text-secondary-600'}`}>
                <AppIcon className={`${s.icon} text-sm`}></AppIcon>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1">
              <button onClick={() => setView('week')} className={`px-3 py-1.5 rounded-md text-[12px] font-medium cursor-pointer whitespace-nowrap ${view === 'week' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500'}`}>Week</button>
              <button onClick={() => setView('month')} className={`px-3 py-1.5 rounded-md text-[12px] font-medium cursor-pointer whitespace-nowrap ${view === 'month' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500'}`}>Month</button>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setMonthOffset(monthOffset - 1)} className="w-8 h-8 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer">
                <AppIcon className="ri-arrow-left-s-line text-foreground-500"></AppIcon>
              </button>
              <span className="text-sm font-semibold text-foreground-900 min-w-[140px] text-center">{monthName}</span>
              <button onClick={() => setMonthOffset(monthOffset + 1)} className="w-8 h-8 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer">
                <AppIcon className="ri-arrow-right-s-line text-foreground-500"></AppIcon>
              </button>
              <button onClick={() => setMonthOffset(0)} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 cursor-pointer whitespace-nowrap">Today</button>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 cursor-pointer">
              {['All', 'Session', 'Deadline', 'Review', 'Holiday', 'Event', 'Coaching'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Month View */}
        {view === 'month' && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="grid grid-cols-7 border-b border-foreground-400/50">
              {DAYS.map(d => (
                <div key={d} className="p-2 text-center text-[10px] font-bold text-foreground-400 uppercase tracking-wider">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} className="min-h-[100px] border-r border-b border-foreground-300/50 p-1"></div>
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const events = getEventsForDate(day);
                const isToday = now.getDate() === day && now.getMonth() === currentMonth.getMonth() && now.getFullYear() === currentMonth.getFullYear();
                return (
                  <div key={day} className={`min-h-[100px] border-r border-b border-foreground-300/50 p-1 ${isToday ? 'bg-primary-50/30' : ''}`}>
                    <div className={`text-[11px] font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-primary-500 text-white' : 'text-foreground-600'}`}>{day}</div>
                    <div className="space-y-0.5">
                      {events.slice(0, 3).map(e => (
                        <div key={e.id} onClick={() => setShowEvent(e)} className="flex items-center gap-1 cursor-pointer hover:opacity-80">
                          <div className={`w-1.5 h-1.5 rounded-full ${typeDot(e.type)} shrink-0`}></div>
                          <span className="text-[9px] text-foreground-700 truncate">{e.title}</span>
                        </div>
                      ))}
                      {events.length > 3 && (
                        <span className="text-[9px] text-foreground-400">+{events.length - 3} more</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Week View */}
        {view === 'week' && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="divide-y divide-background-200/30">
              {DAYS.map(day => {
                const dayEvents = weekEvents.filter(e => {
                  const eventDay = new Date(e.date).toLocaleDateString('en-GB', { weekday: 'short' });
                  return eventDay === day;
                });
                return (
                  <div key={day} className="p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-[11px] font-bold text-foreground-700 w-10">{day}</span>
                      <span className="text-[10px] text-foreground-400">{dayEvents.length} events</span>
                    </div>
                    <div className="space-y-1 ml-10">
                      {dayEvents.map(e => (
                        <div key={e.id} onClick={() => setShowEvent(e)} className="flex items-center gap-2 p-2 rounded-lg hover:bg-background-100 cursor-pointer">
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${typeBadge(e.type)}`}>{e.type}</span>
                          <span className="text-[11px] text-foreground-500 w-12">{e.time}</span>
                          <span className="text-[12px] text-foreground-800 font-medium">{e.title}</span>
                          <span className="text-[10px] text-foreground-400">{e.cohort}</span>
                        </div>
                      ))}
                      {dayEvents.length === 0 && (
                        <span className="text-[11px] text-foreground-400 italic">No events scheduled</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Upcoming Events List */}
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Upcoming Events</h3>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden divide-y divide-background-200/30">
            {filtered.slice(0, 8).map(e => (
              <div key={e.id} onClick={() => setShowEvent(e)} className="p-3.5 flex items-center gap-4 hover:bg-background-100/50 cursor-pointer">
                <div className="text-center shrink-0 w-14">
                  <p className="text-[10px] text-foreground-400 uppercase font-semibold">{new Date(e.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
                  <p className="text-[11px] text-foreground-600 font-medium">{e.time}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[13px] font-medium text-foreground-900">{e.title}</p>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${typeBadge(e.type)}`}>{e.type}</span>
                    {e.priority === 'High' && <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">High</span>}
                  </div>
                  <p className="text-[11px] text-foreground-400 mt-0.5">{e.cohort} &middot; {e.tutor} &middot; {e.duration}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Event Modal */}
      {showEvent && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowEvent(null)}>
          <div className="bg-background-50 rounded-2xl border border-background-200 w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-heading font-semibold text-foreground-900">{showEvent.title}</h2>
              <button onClick={() => setShowEvent(null)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-background-100 hover:bg-background-200 cursor-pointer">
                <AppIcon className="ri-close-line text-foreground-500"></AppIcon>
              </button>
            </div>
            <div className="space-y-3 text-[12px] text-foreground-600">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Date</p>
                  <p className="font-semibold text-foreground-800">{showEvent.date}</p>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Time</p>
                  <p className="font-semibold text-foreground-800">{showEvent.time} ({showEvent.duration})</p>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Type</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeBadge(showEvent.type)}`}>{showEvent.type}</span>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Priority</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${showEvent.priority === 'High' ? 'bg-rose-100 text-rose-700' : showEvent.priority === 'Medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{showEvent.priority}</span>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Cohort</p>
                  <p className="font-semibold text-foreground-800">{showEvent.cohort}</p>
                </div>
                <div className="bg-background-100/50 rounded-lg p-3">
                  <p className="text-[10px] text-foreground-400 uppercase mb-1">Tutor</p>
                  <p className="font-semibold text-foreground-800">{showEvent.tutor}</p>
                </div>
              </div>
              <div className="bg-background-100/50 rounded-lg p-3">
                <p className="text-[10px] text-foreground-400 uppercase mb-1">Description</p>
                <p className="text-[12px] text-foreground-700">{showEvent.description}</p>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <Link to="/mis/timetables" className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer text-center whitespace-nowrap">
                  <AppIcon className="ri-calendar-line mr-1"></AppIcon> View Timetable
                </Link>
                <button className="flex-1 px-3 py-2 border border-background-300 bg-background-50 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer whitespace-nowrap">
                  <AppIcon className="ri-notification-3-line mr-1"></AppIcon> Remind Me
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}