import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { EVENTS, CLUBS } from '@/pages/learner/clubs/data';

const learnerNav = roleNavMap.learner;
const p = LEARNER_PROFILE;

const monthMap: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parseDate(dateStr: string): Date {
  const parts = dateStr.split(' ');
  const day = parseInt(parts[0], 10);
  const month = monthMap[parts[1]] ?? 5;
  return new Date(2026, month, day);
}

function getStatus(ev: typeof EVENTS[0]): 'completed' | 'today' | 'upcoming' {
  const now = new Date();
  const d = parseDate(ev.date);
  const sameDay = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (sameDay) return 'today';
  if (d < now) return 'completed';
  return 'upcoming';
}

const typeColorMap: Record<string, string> = {
  'Workshop': 'bg-primary-100 text-primary-700',
  'Panel Discussion': 'bg-accent-100 text-accent-700',
  'Hands-on Lab': 'bg-secondary-100 text-secondary-700',
  'Masterclass': 'bg-amber-100 text-amber-700',
  'Networking Event': 'bg-emerald-100 text-emerald-700',
  'Showcase': 'bg-rose-100 text-rose-700',
  'Study Group': 'bg-indigo-100 text-indigo-700',
  'Case Study': 'bg-orange-100 text-orange-700',
};

const statusConfig = {
  completed: { label: 'Completed', icon: 'ri-check-double-line', dot: 'bg-emerald-400', bar: 'bg-emerald-500', text: 'text-emerald-600' },
  today: { label: 'Today', icon: 'ri-live-line', dot: 'bg-amber-400 animate-pulse', bar: 'bg-amber-400', text: 'text-amber-600' },
  upcoming: { label: 'Upcoming', icon: 'ri-calendar-todo-line', dot: 'bg-background-300', bar: 'bg-background-200', text: 'text-foreground-400' },
};

export default function MySchedulePage() {
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const joinedEvents = useMemo(
    () => EVENTS.filter((e) => e.joined).sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime()),
    []
  );

  const completedCount = joinedEvents.filter((e) => getStatus(e) === 'completed').length;
  const totalJoined = joinedEvents.length;
  const progressPct = totalJoined > 0 ? Math.round((completedCount / totalJoined) * 100) : 0;
  const totalPoints = joinedEvents.reduce((s, e) => s + e.points, 0);
  const earnedPoints = joinedEvents.filter((e) => getStatus(e) === 'completed').reduce((s, e) => s + e.points, 0);

  // Group by month
  const groupedByMonth = useMemo(() => {
    const groups: Record<string, typeof EVENTS> = {};
    joinedEvents.forEach((ev) => {
      const d = parseDate(ev.date);
      const key = `${d.toLocaleString('en-GB', { month: 'long' })} 2026`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(ev);
    });
    return groups;
  }, [joinedEvents]);

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="My Schedule" pageSubtitle="Your personalised timeline of joined events with progress tracking"
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      <div className="p-6 space-y-6">
        {/* Back */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/learner/clubs/events')}
            className="flex items-center gap-1.5 text-xs text-foreground-400 hover:text-foreground-700 transition-smooth cursor-pointer whitespace-nowrap"
          >
            <AppIcon className="ri-arrow-left-s-line"></AppIcon> Back to Events
          </button>
        </div>

        {/* Progress Tracker Header */}
        <div className="bg-background-50 rounded-2xl border border-background-200/50 p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 mb-5">
            <div>
              <h2 className="text-lg font-heading font-bold text-foreground-900">My Event Progress</h2>
              <p className="text-sm text-foreground-500 mt-0.5">Track your journey through all joined events</p>
            </div>
            <Link
              to="/learner/clubs/events"
              className="px-4 py-2 bg-primary-500 text-white rounded-xl text-xs font-bold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-1.5"
            >
              <AppIcon className="ri-compass-line"></AppIcon> Discover More Events
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <div className="bg-background-100 rounded-xl p-3 text-center">
              <p className="text-xl font-heading font-bold text-primary-600">{totalJoined}</p>
              <p className="text-xs text-foreground-400 mt-0.5">Events Joined</p>
            </div>
            <div className="bg-background-100 rounded-xl p-3 text-center">
              <p className="text-xl font-heading font-bold text-emerald-600">{completedCount}</p>
              <p className="text-xs text-foreground-400 mt-0.5">Completed</p>
            </div>
            <div className="bg-background-100 rounded-xl p-3 text-center">
              <p className="text-xl font-heading font-bold text-foreground-600">{totalJoined - completedCount}</p>
              <p className="text-xs text-foreground-400 mt-0.5">Upcoming</p>
            </div>
            <div className="bg-background-100 rounded-xl p-3 text-center">
              <p className="text-xl font-heading font-bold text-accent-600">{earnedPoints}</p>
              <p className="text-xs text-foreground-400 mt-0.5">Points Earned</p>
            </div>
          </div>

          {/* Progress bar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground-600">Overall Completion</span>
              <span className="text-xs font-bold text-primary-600">{progressPct}%</span>
            </div>
            <div className="h-3 bg-background-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-all duration-1000"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[10px] text-foreground-400">{completedCount} completed</span>
              <span className="text-[10px] text-foreground-400">{earnedPoints}/{totalPoints} pts earned</span>
            </div>
          </div>
        </div>

        {/* Empty state */}
        {joinedEvents.length === 0 && (
          <div className="text-center py-20 bg-background-50 rounded-2xl border border-background-200/50">
            <span className="w-16 h-16 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-4">
              <AppIcon className="ri-calendar-todo-line text-foreground-300 text-2xl"></AppIcon>
            </span>
            <h3 className="text-base font-heading font-bold text-foreground-900 mb-1">No events joined yet</h3>
            <p className="text-sm text-foreground-400 mb-4">Browse events and RSVP to build your schedule</p>
            <Link
              to="/learner/clubs/events"
              className="px-5 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-bold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap inline-flex items-center gap-2"
            >
              <AppIcon className="ri-calendar-event-line"></AppIcon> Browse Events
            </Link>
          </div>
        )}

        {/* Timeline grouped by month */}
        {Object.entries(groupedByMonth).map(([monthLabel, events]) => {
          const monthCompleted = events.filter((e) => getStatus(e) === 'completed').length;
          return (
            <div key={monthLabel}>
              {/* Month header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-primary-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap">
                  {monthLabel}
                </div>
                <div className="flex-1 h-px bg-background-200" />
                <span className="text-xs text-foreground-400 whitespace-nowrap">{monthCompleted}/{events.length} done</span>
              </div>

              {/* Timeline */}
              <div className="relative pl-10">
                {/* Vertical line */}
                <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-background-200 rounded-full" />

                <div className="space-y-4">
                  {events.map((ev, idx) => {
                    const status = getStatus(ev);
                    const sc = statusConfig[status];
                    const club = CLUBS.find((c) => c.id === ev.clubId);
                    const typeColor = typeColorMap[ev.type] || 'bg-background-100 text-foreground-500';
                    const isExpanded = expandedId === ev.id;

                    return (
                      <div key={ev.id} className="relative">
                        {/* Timeline dot */}
                        <div className={`absolute -left-6 top-5 w-4 h-4 rounded-full border-2 border-background-50 ${sc.dot} z-10`} />

                        {/* Card */}
                        <div
                          className={`bg-background-50 rounded-xl border transition-smooth overflow-hidden ${
                            status === 'completed'
                              ? 'border-emerald-200/50'
                              : status === 'today'
                              ? 'border-amber-300/60 shadow-amber-100'
                              : 'border-background-200/50'
                          }`}
                        >
                          {/* Card header — clickable */}
                          <button
                            className="w-full text-left p-4 cursor-pointer"
                            onClick={() => setExpandedId(isExpanded ? null : ev.id)}
                          >
                            <div className="flex items-start gap-3">
                              {/* Date box */}
                              <div className={`rounded-lg px-3 py-2 text-center shrink-0 min-w-[56px] ${
                                status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                                status === 'today' ? 'bg-amber-100 text-amber-700' :
                                'bg-background-100 text-foreground-500'
                              }`}>
                                <p className="text-sm font-bold leading-tight">{ev.date.split(' ')[0]}</p>
                                <p className="text-[9px] font-medium uppercase mt-0.5">{ev.dayName}</p>
                              </div>

                              {/* Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <h4 className="text-sm font-semibold text-foreground-900">{ev.title}</h4>
                                  {status === 'today' && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-0.5 animate-pulse">
                                      <AppIcon className="ri-live-line text-[9px]"></AppIcon> Today
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                  <span className="text-xs text-foreground-400"><AppIcon className="ri-time-line mr-0.5 text-xs"></AppIcon>{ev.time}</span>
                                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${typeColor}`}>{ev.type}</span>
                                  {club && (
                                    <span className="text-xs text-foreground-400">{club.title}</span>
                                  )}
                                </div>
                              </div>

                              {/* Right side */}
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs font-bold text-accent-600 bg-accent-50 px-2 py-0.5 rounded-full">+{ev.points} pts</span>
                                <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${sc.text}`}>
                                  <AppIcon className={`${sc.icon} text-[10px]`}></AppIcon>{sc.label}
                                </span>
                                <AppIcon className={`ri-arrow-down-s-line text-foreground-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}></AppIcon>
                              </div>
                            </div>

                            {/* Mini progress bar */}
                            {status !== 'upcoming' && (
                              <div className="mt-3">
                                <div className="h-1.5 bg-background-200 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${status === 'completed' ? 'bg-emerald-400' : 'bg-amber-400'}`}
                                    style={{ width: status === 'completed' ? '100%' : '50%' }}
                                  />
                                </div>
                              </div>
                            )}
                          </button>

                          {/* Expanded panel */}
                          {isExpanded && (
                            <div className="border-t border-background-200/50 p-4 bg-background-100/30 space-y-3">
                              {/* Image */}
                              {ev.image && (
                                <div className="w-full h-[160px] rounded-lg overflow-hidden">
                                  <img src={ev.image} alt={ev.title} className="w-full h-full object-cover object-top" />
                                </div>
                              )}

                              <p className="text-sm text-foreground-600 leading-relaxed">{ev.description}</p>

                              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-foreground-500">
                                <span className="flex items-center gap-1"><AppIcon className="ri-user-line text-xs"></AppIcon>{ev.host} — {ev.hostRole}</span>
                                <span className="flex items-center gap-1"><AppIcon className="ri-map-pin-line text-xs"></AppIcon>{ev.location}</span>
                                <span className="flex items-center gap-1"><AppIcon className="ri-group-line text-xs"></AppIcon>{ev.rsvpCount}/{ev.capacity} registered</span>
                              </div>

                              <div className="flex items-center gap-2 pt-1">
                                <Link
                                  to={`/learner/clubs/events/${ev.id}`}
                                  className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                                >
                                  <AppIcon className="ri-external-link-line mr-1"></AppIcon>View Full Details
                                </Link>
                                {status === 'completed' && (
                                  <span className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold whitespace-nowrap">
                                    <AppIcon className="ri-checkbox-circle-line mr-1"></AppIcon>+{ev.points} pts earned
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}

        {/* Points summary card at bottom */}
        {joinedEvents.length > 0 && (
          <div className="bg-gradient-to-r from-primary-50 to-accent-50 rounded-2xl border border-primary-200/30 p-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-heading font-bold text-foreground-900">Points Summary</h3>
                <p className="text-xs text-foreground-500 mt-0.5">Keep attending events to earn all available points</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-2xl font-heading font-bold text-accent-600">{earnedPoints}</p>
                  <p className="text-[10px] text-foreground-400">Earned so far</p>
                </div>
                <div className="text-foreground-300 text-xl">/</div>
                <div className="text-center">
                  <p className="text-2xl font-heading font-bold text-foreground-500">{totalPoints}</p>
                  <p className="text-[10px] text-foreground-400">Total available</p>
                </div>
              </div>
            </div>
            <div className="mt-4 h-2.5 bg-white/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent-400 to-primary-400 rounded-full transition-all duration-1000"
                style={{ width: `${totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}