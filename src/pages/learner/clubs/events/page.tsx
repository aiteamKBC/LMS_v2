import { useState, useMemo, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { EVENTS, CLUBS, EVENT_FEEDBACKS, getFeedbackByEventId, getAverageRating, type EventFeedback } from '@/pages/learner/clubs/data';

const learnerNav = roleNavMap.learner;
const p = LEARNER_PROFILE;

type EventFilter = 'all' | 'joined' | 'available' | 'workshop' | 'networking' | 'panel';
type TimeFilter = 'all' | 'upcoming' | 'past' | 'ongoing';

const FILTER_TABS: { key: EventFilter; label: string; icon: string }[] = [
  { key: 'all', label: 'All Events', icon: 'ri-calendar-event-line' },
  { key: 'joined', label: 'My Events', icon: 'ri-user-line' },
  { key: 'available', label: 'Available', icon: 'ri-compass-line' },
  { key: 'workshop', label: 'Workshops', icon: 'ri-tools-line' },
  { key: 'networking', label: 'Networking', icon: 'ri-user-heart-line' },
  { key: 'panel', label: 'Panels', icon: 'ri-presentation-line' },
];

const TIME_FILTERS: { key: TimeFilter; label: string; icon: string }[] = [
  { key: 'all', label: 'All Time', icon: 'ri-time-line' },
  { key: 'upcoming', label: 'Upcoming', icon: 'ri-calendar-todo-line' },
  { key: 'ongoing', label: 'Ongoing', icon: 'ri-live-line' },
  { key: 'past', label: 'Past', icon: 'ri-history-line' },
];

const statusConfig = {
  attending: { label: 'Attending', cls: 'bg-emerald-100 text-emerald-700' },
  'not-attending': { label: 'Not Attending', cls: 'bg-background-100 text-foreground-400' },
  available: { label: 'Available', cls: 'bg-amber-100 text-amber-700' },
};

function parseEventDate(dateStr: string): Date {
  const monthMap: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const parts = dateStr.split(' ');
  const day = parseInt(parts[0], 10);
  const month = monthMap[parts[1]] ?? 5;
  return new Date(2026, month, day);
}

function isEventOngoing(ev: typeof EVENTS[0]): boolean {
  const now = new Date();
  const eventDate = parseEventDate(ev.date);
  const sameDay = now.getDate() === eventDate.getDate() && now.getMonth() === eventDate.getMonth() && now.getFullYear() === eventDate.getFullYear();
  if (!sameDay) return false;
  const timeRange = ev.time;
  const match = timeRange.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
  if (!match) return false;
  const startHour = parseInt(match[1], 10);
  const startMin = parseInt(match[2], 10);
  const endHour = parseInt(match[3], 10);
  const endMin = parseInt(match[4], 10);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
}

function getEventTimeStatus(ev: typeof EVENTS[0]): 'upcoming' | 'past' | 'ongoing' {
  const now = new Date();
  const eventDate = parseEventDate(ev.date);
  const timeRange = ev.time;
  const match = timeRange.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
  let endMinutes = 23 * 60 + 59;
  if (match) {
    const endHour = parseInt(match[3], 10);
    const endMin = parseInt(match[4], 10);
    endMinutes = endHour * 60 + endMin;
  }
  const eventEnd = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate(), Math.floor(endMinutes / 60), endMinutes % 60);
  if (isEventOngoing(ev)) return 'ongoing';
  if (now > eventEnd) return 'past';
  return 'upcoming';
}

export default function ClubEventsPage() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<EventFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [showConfirmModal, setShowConfirmModal] = useState<string | null>(null);
  const [addToCalendarToast, setAddToCalendarToast] = useState<string | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<Set<string>>(new Set(EVENTS.filter((e) => e.joined).map((e) => e.id)));
  const [joinedEventIds, setJoinedEventIds] = useState<Set<string>>(new Set(EVENTS.filter((e) => e.joined).map((e) => e.id)));

  // RSVP / Waitlist
  const [eventWaitlists, setEventWaitlists] = useState<Record<string, string[]>>({});
  const [eventRsvpCounts, setEventRsvpCounts] = useState<Record<string, number>>({});

  // QR Code modal
  const [qrModalEvent, setQrModalEvent] = useState<typeof EVENTS[0] | null>(null);

  // Feedback system
  const [feedbackModalEvent, setFeedbackModalEvent] = useState<typeof EVENTS[0] | null>(null);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackHoverRating, setFeedbackHoverRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [eventFeedbacks, setEventFeedbacks] = useState<EventFeedback[]>(EVENT_FEEDBACKS);
  const [showFeedbackList, setShowFeedbackList] = useState<string | null>(null);
  const [feedbackSubmittedToast, setFeedbackSubmittedToast] = useState(false);

  // Sync with localStorage on mount
  useEffect(() => {
    const savedCalendar = JSON.parse(localStorage.getItem('kbc_calendar_events') || '[]');
    const savedJoined = JSON.parse(localStorage.getItem('kbc_joined_events') || '[]');
    if (savedCalendar.length > 0) {
      setCalendarEvents((prev) => new Set([...prev, ...savedCalendar]));
    }
    if (savedJoined.length > 0) {
      setJoinedEventIds((prev) => new Set([...prev, ...savedJoined]));
    }
  }, []);

  // Save to localStorage on changes
  useEffect(() => {
    localStorage.setItem('kbc_calendar_events', JSON.stringify([...calendarEvents]));
  }, [calendarEvents]);

  useEffect(() => {
    localStorage.setItem('kbc_joined_events', JSON.stringify([...joinedEventIds]));
  }, [joinedEventIds]);

  const filteredEvents = useMemo(() => {
    let filtered = EVENTS;
    if (activeFilter === 'joined') filtered = filtered.filter((e) => e.joined);
    if (activeFilter === 'available') filtered = filtered.filter((e) => !e.joined);
    if (activeFilter === 'workshop') filtered = filtered.filter((e) => e.type === 'Workshop' || e.type === 'Hands-on Lab' || e.type === 'Masterclass');
    if (activeFilter === 'networking') filtered = filtered.filter((e) => e.type === 'Networking Event' || e.format.includes('In-Person'));
    if (activeFilter === 'panel') filtered = filtered.filter((e) => e.type === 'Panel Discussion');
    if (timeFilter !== 'all') {
      filtered = filtered.filter((e) => getEventTimeStatus(e) === timeFilter);
    }
    return filtered;
  }, [activeFilter, timeFilter]);

  const totalJoined = EVENTS.filter((e) => e.joined).length;
  const totalPoints = EVENTS.filter((e) => e.joined).reduce((s, ev) => s + ev.points, 0);

  const upcomingCount = EVENTS.filter((e) => getEventTimeStatus(e) === 'upcoming').length;
  const pastCount = EVENTS.filter((e) => getEventTimeStatus(e) === 'past').length;
  const ongoingCount = EVENTS.filter((e) => getEventTimeStatus(e) === 'ongoing').length;

  const handleJoinEvent = (eventId: string) => {
    setShowConfirmModal(eventId);
  };

  const handleConfirmJoin = (eventId: string) => {
    setJoinedEventIds((prev) => new Set(prev).add(eventId));
    setShowConfirmModal(null);
    const ev = EVENTS.find((e) => e.id === eventId);
    if (ev) {
      // Also add to calendar automatically
      setCalendarEvents((prev) => {
        const next = new Set(prev);
        next.add(eventId);
        return next;
      });
      setAddToCalendarToast(`You joined "${ev.title}"! Added to your calendar.`);
    }
    setTimeout(() => setAddToCalendarToast(null), 3000);
  };

  const handleAddToCalendar = (ev: typeof EVENTS[0]) => {
    if (calendarEvents.has(ev.id)) {
      setAddToCalendarToast(`${ev.title} is already in your calendar`);
    } else {
      setCalendarEvents((prev) => {
        const next = new Set(prev);
        next.add(ev.id);
        return next;
      });
      setAddToCalendarToast(`"${ev.title}" added to your calendar · ${ev.date} at ${ev.time}`);
    }
    setTimeout(() => setAddToCalendarToast(null), 2500);
  };

  const handleJoinWaitlist = (ev: typeof EVENTS[0]) => {
    const currentWaitlist = eventWaitlists[ev.id] || ev.waitlist;
    if (currentWaitlist.includes('Sophie Williams')) {
      setAddToCalendarToast(`You are already on the waitlist for "${ev.title}"`);
    } else {
      const updated = [...currentWaitlist, 'Sophie Williams'];
      setEventWaitlists((prev) => ({ ...prev, [ev.id]: updated }));
      setAddToCalendarToast(`Added to waitlist for "${ev.title}" — you are #${updated.length} in line`);
    }
    setTimeout(() => setAddToCalendarToast(null), 3000);
  };

  const handleRSVP = (ev: typeof EVENTS[0]) => {
    const currentCount = eventRsvpCounts[ev.id] || ev.rsvpCount;
    const isFull = currentCount >= ev.capacity;
    if (isFull) {
      handleJoinWaitlist(ev);
      return;
    }
    const newCount = currentCount + 1;
    setEventRsvpCounts((prev) => ({ ...prev, [ev.id]: newCount }));
    setJoinedEventIds((prev) => new Set(prev).add(ev.id));
    setCalendarEvents((prev) => new Set(prev).add(ev.id));
    const spotsLeft = ev.capacity - newCount;
    const msg = spotsLeft <= 2
      ? `You joined "${ev.title}"! Only ${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left — hurry!`
      : `You joined "${ev.title}"! Added to your calendar.`;
    setAddToCalendarToast(msg);
    setTimeout(() => setAddToCalendarToast(null), 3000);
  };

  const handleShowQRCode = (ev: typeof EVENTS[0]) => {
    setQrModalEvent(ev);
  };

  const handleOpenFeedback = (ev: typeof EVENTS[0]) => {
    setFeedbackModalEvent(ev);
    setFeedbackRating(0);
    setFeedbackHoverRating(0);
    setFeedbackComment('');
  };

  const handleSubmitFeedback = () => {
    if (!feedbackModalEvent || feedbackRating === 0) return;
    const newFeedback: EventFeedback = {
      id: `fb-${Date.now()}`,
      eventId: feedbackModalEvent.id,
      eventTitle: feedbackModalEvent.title,
      clubName: feedbackModalEvent.club,
      eventDate: `${feedbackModalEvent.date} 2026`,
      rating: feedbackRating,
      comment: feedbackComment.trim() || 'No written feedback provided.',
      submittedBy: 'Sophie Williams',
      submittedDate: '13 Jun 2026',
      timeAgo: 'Just now',
    };
    setEventFeedbacks((prev) => [newFeedback, ...prev]);
    setFeedbackModalEvent(null);
    setFeedbackSubmittedToast(true);
    setTimeout(() => setFeedbackSubmittedToast(false), 3000);
  };

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Club Events" pageSubtitle="Browse, join and manage all community and club events — earn points for attending"
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      {/* Add to Calendar Toast */}
      {addToCalendarToast && (
        <div className="fixed top-20 right-6 z-50 bg-background-50 rounded-xl border border-emerald-200/60 shadow-lg px-4 py-3 flex items-center gap-3 animate-in slide-in-from-right-4 duration-300">
          <span className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
            <i className="ri-calendar-check-line"></i>
          </span>
          <p className="text-sm font-semibold text-foreground-900">{addToCalendarToast}</p>
        </div>
      )}

      {/* Feedback Submitted Toast */}
      {feedbackSubmittedToast && (
        <div className="fixed top-20 right-6 z-50 bg-background-50 rounded-xl border border-accent-200/60 shadow-lg px-4 py-3 flex items-center gap-3 animate-in slide-in-from-right-4 duration-300">
          <span className="w-8 h-8 rounded-full bg-accent-100 text-accent-600 flex items-center justify-center">
            <i className="ri-star-fill"></i>
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground-900">Feedback Submitted!</p>
            <p className="text-xs text-foreground-500">Thank you for your review — +25 points earned</p>
          </div>
        </div>
      )}

      {/* Join Confirmation Modal */}
      {showConfirmModal && (() => {
        const ev = EVENTS.find((e) => e.id === showConfirmModal);
        if (!ev) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowConfirmModal(null)}>
            <div className="bg-background-50 rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
              <div className="text-center mb-4">
                <span className="w-16 h-16 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center mx-auto mb-3">
                  <i className="ri-calendar-check-line text-2xl"></i>
                </span>
                <h3 className="text-lg font-heading font-bold text-foreground-900">Join Event?</h3>
                <p className="text-sm text-foreground-500 mt-1">You are about to join <strong>{ev.title}</strong></p>
              </div>
              <div className="bg-background-100 rounded-xl p-4 mb-4 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-foreground-500">Date</span>
                  <span className="font-semibold text-foreground-800">{ev.date} at {ev.time}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-foreground-500">Club</span>
                  <span className="font-semibold text-foreground-800">{ev.club}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-foreground-500">Points</span>
                  <span className="font-bold text-accent-600">+{ev.points} pts</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowConfirmModal(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-background-200 text-sm font-semibold text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleConfirmJoin(showConfirmModal)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-check-line mr-1"></i> Confirm
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="p-6 space-y-6">
        {/* Stats Banner */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className="text-2xl font-heading font-bold text-primary-600">{totalJoined}</p>
              <p className="text-xs text-foreground-400 mt-0.5">Events Joined</p>
            </div>
            <div className="w-px h-10 bg-background-200"></div>
            <div className="text-center">
              <p className="text-2xl font-heading font-bold text-accent-600">{totalPoints}</p>
              <p className="text-xs text-foreground-400 mt-0.5">Points Available</p>
            </div>
            <div className="w-px h-10 bg-background-200"></div>
            <div className="text-center">
              <p className="text-2xl font-heading font-bold text-foreground-700">{EVENTS.length}</p>
              <p className="text-xs text-foreground-400 mt-0.5">Total Events</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('list')}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-smooth cursor-pointer ${viewMode === 'list' ? 'bg-primary-100 text-primary-600' : 'text-foreground-400 hover:bg-background-100'}`}
            >
              <i className="ri-list-check"></i>
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-smooth cursor-pointer ${viewMode === 'grid' ? 'bg-primary-100 text-primary-600' : 'text-foreground-400 hover:bg-background-100'}`}
            >
              <i className="ri-layout-grid-line"></i>
            </button>
            <Link
              to="/learner/clubs/events/schedule"
              className="px-3 py-1.5 bg-background-100 text-foreground-600 rounded-lg text-xs font-semibold hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap ml-1 border border-background-200"
            >
              <i className="ri-calendar-todo-line mr-1"></i> My Schedule
            </Link>
            <Link
              to="/learner/calendar"
              className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
            >
              <i className="ri-calendar-2-line mr-1"></i> View Calendar
            </Link>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto sticky top-0 z-10">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                activeFilter === tab.key
                  ? 'bg-background-50 text-foreground-900 shadow-sm'
                  : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              <i className={`${tab.icon} text-sm`}></i>
              {tab.label}
              {tab.key === 'joined' && (
                <span className="bg-primary-500 text-white text-xs px-1.5 py-0.5 rounded-full leading-none">{totalJoined}</span>
              )}
            </button>
          ))}
        </div>

        {/* Time Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground-400 font-medium">Filter by time:</span>
          <div className="flex items-center gap-1 bg-background-100 rounded-full p-1">
            {TIME_FILTERS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTimeFilter(t.key)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                  timeFilter === t.key
                    ? 'bg-primary-500 text-white'
                    : 'text-foreground-500 hover:text-foreground-700 hover:bg-background-50'
                }`}
              >
                <i className={`${t.icon} text-xs`}></i>
                {t.label}
                {t.key === 'upcoming' && (
                  <span className="bg-background-50 text-primary-600 text-[10px] px-1.5 py-0.5 rounded-full leading-none">{upcomingCount}</span>
                )}
                {t.key === 'past' && (
                  <span className="bg-background-50 text-foreground-600 text-[10px] px-1.5 py-0.5 rounded-full leading-none">{pastCount}</span>
                )}
                {t.key === 'ongoing' && (
                  <span className="bg-background-50 text-rose-500 text-[10px] px-1.5 py-0.5 rounded-full leading-none">{ongoingCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Events Display */}
        {filteredEvents.length === 0 ? (
          <div className="text-center py-16 bg-background-50 rounded-xl border border-background-200/50">
            <span className="w-16 h-16 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-4">
              <i className="ri-calendar-event-line text-foreground-300 text-2xl"></i>
            </span>
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-1">No Events Found</h3>
            <p className="text-xs text-foreground-400">No events match your current filter. Try a different category.</p>
          </div>
        ) : viewMode === 'list' ? (
          <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
            <div className="divide-y divide-background-200/30">
              {filteredEvents.map((ev) => {
                const status = statusConfig[ev.attendanceStatus];
                const club = CLUBS.find((c) => c.id === ev.clubId);
                const effectiveRsvp = eventRsvpCounts[ev.id] || ev.rsvpCount;
                const effectiveWaitlist = eventWaitlists[ev.id] || ev.waitlist;
                const isFull = effectiveRsvp >= ev.capacity;
                const spotsLeft = ev.capacity - effectiveRsvp;
                const fillPercent = Math.min(100, (effectiveRsvp / ev.capacity) * 100);
                const avgRating = getAverageRating(ev.id);
                const feedbackCount = getFeedbackByEventId(ev.id).length;
                const userAlreadyJoined = joinedEventIds.has(ev.id) || ev.joined;
                return (
                  <div key={ev.id} className={`p-4 flex flex-col sm:flex-row sm:items-center gap-4 transition-smooth ${ev.joined ? 'hover:bg-primary-50/30' : 'hover:bg-background-100/50'}`}>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {/* Event Image */}
                      {ev.image && (
                        <div className="shrink-0 w-[80px] h-[60px] rounded-lg overflow-hidden hidden sm:block">
                          <img src={ev.image} alt={ev.title} className="w-full h-full object-cover" />
                        </div>
                      )}
                      <div className={`rounded-xl px-4 py-3 text-center shrink-0 min-w-[60px] ${ev.joined ? 'bg-primary-100 text-primary-700' : 'bg-background-100 text-foreground-500'}`}>
                        <p className="text-sm font-bold leading-tight">{ev.date.split(' ')[0]}</p>
                        <p className="text-[9px] font-medium uppercase tracking-wide mt-0.5">{ev.dayName}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link to={`/learner/clubs/events/${ev.id}`} className="text-sm font-semibold text-foreground-900 hover:text-primary-600 transition-smooth">{ev.title}</Link>
                          {ev.hasQrCode && (
                            <span className="text-[9px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                              <i className="ri-qr-code-line text-[9px]"></i> Check-in
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                          <span className="text-xs text-foreground-400"><i className="ri-time-line mr-0.5 text-xs"></i>{ev.time}</span>
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{ev.type}</span>
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{ev.format}</span>
                          {club && (
                            <Link
                              to={`/learner/clubs/${club.id}`}
                              className="text-xs text-primary-500 hover:text-primary-700 font-medium transition-smooth"
                            >
                              {club.title}
                            </Link>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="text-xs text-foreground-400"><i className="ri-user-line mr-0.5"></i>{ev.host}</span>
                          <span className="text-xs text-foreground-400"><i className="ri-map-pin-line mr-0.5"></i>{ev.location}</span>
                          <span className="text-xs font-bold text-accent-600 bg-accent-50 px-2 py-0.5 rounded-full">+{ev.points} pts</span>
                        </div>
                        {/* Capacity bar */}
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex-1 max-w-[200px] h-1.5 bg-background-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${isFull ? 'bg-rose-400' : spotsLeft <= 3 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                              style={{ width: `${fillPercent}%` }}
                            ></div>
                          </div>
                          <span className={`text-[10px] font-semibold ${isFull ? 'text-rose-600' : spotsLeft <= 3 ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {isFull ? 'Full' : `${effectiveRsvp}/${ev.capacity} spots`}
                          </span>
                          {effectiveWaitlist.length > 0 && (
                            <span className="text-[10px] text-amber-600 font-medium">
                              <i className="ri-hourglass-line mr-0.5"></i>{effectiveWaitlist.length} waiting
                            </span>
                          )}
                        </div>
                        {/* Rating & feedback */}
                        {avgRating > 0 && (
                          <div className="flex items-center gap-1 mt-1">
                            <div className="flex">
                              {[1,2,3,4,5].map((s) => (
                                <i key={s} className={`text-[9px] ${s <= Math.round(avgRating) ? 'ri-star-fill text-amber-400' : 'ri-star-line text-foreground-300'}`}></i>
                              ))}
                            </div>
                            <span className="text-[10px] font-semibold text-foreground-500">{avgRating}</span>
                            <button
                              onClick={() => setShowFeedbackList(showFeedbackList === ev.id ? null : ev.id)}
                              className="text-[10px] text-primary-500 hover:text-primary-700 cursor-pointer whitespace-nowrap"
                            >
                              ({feedbackCount} reviews)
                            </button>
                          </div>
                        )}
                        {/* Feedback expandable */}
                        {showFeedbackList === ev.id && (
                          <div className="mt-2 bg-background-100 rounded-xl p-3 space-y-2 max-h-[160px] overflow-y-auto">
                            <p className="text-xs font-semibold text-foreground-700">Feedback ({feedbackCount})</p>
                            {getFeedbackByEventId(ev.id).map((fb) => (
                              <div key={fb.id} className="bg-background-50 rounded-lg p-2">
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className="text-[10px] font-semibold text-foreground-700">{fb.submittedBy}</span>
                                  <div className="flex">
                                    {[1,2,3,4,5].map((s) => (
                                      <i key={s} className={`text-[8px] ${s <= fb.rating ? 'ri-star-fill text-amber-400' : 'ri-star-line text-foreground-300'}`}></i>
                                    ))}
                                  </div>
                                </div>
                                <p className="text-[10px] text-foreground-500 leading-relaxed">{fb.comment}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-foreground-400 mt-1.5 leading-relaxed line-clamp-2">{ev.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${status.cls}`}>{status.label}</span>
                      {/* QR Code */}
                      {ev.hasQrCode && (
                        <button
                          onClick={() => handleShowQRCode(ev)}
                          className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center hover:bg-emerald-200 transition-smooth cursor-pointer"
                          title="Check-in QR Code"
                        >
                          <i className="ri-qr-code-line text-sm"></i>
                        </button>
                      )}
                      {/* Add to Calendar */}
                      <button
                        onClick={() => handleAddToCalendar(ev)}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold transition-smooth cursor-pointer whitespace-nowrap ${
                          calendarEvents.has(ev.id)
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-background-100 text-foreground-500 hover:bg-emerald-50 hover:text-emerald-600'
                        }`}
                      >
                        <i className={`${calendarEvents.has(ev.id) ? 'ri-calendar-check-fill' : 'ri-calendar-2-line'} mr-1`}></i>
                        {calendarEvents.has(ev.id) ? 'In Calendar' : 'Add to Calendar'}
                      </button>
                      {/* RSVP / Join / Waitlist */}
                      {userAlreadyJoined ? (
                        <div className="flex items-center gap-1.5">
                          <span className="px-3 py-2 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold whitespace-nowrap">
                            <i className="ri-check-line mr-1"></i> Joined
                          </span>
                          <button
                            onClick={() => handleOpenFeedback(ev)}
                            className="px-3 py-2 bg-accent-100 text-accent-700 rounded-lg text-xs font-semibold hover:bg-accent-200 transition-smooth cursor-pointer whitespace-nowrap"
                          >
                            <i className="ri-star-line mr-1"></i> Rate
                          </button>
                        </div>
                      ) : isFull ? (
                        <span className="px-3 py-2 bg-rose-100 text-rose-600 rounded-lg text-xs font-semibold whitespace-nowrap cursor-not-allowed">
                          <i className="ri-lock-line mr-1"></i> Full
                        </span>
                      ) : ev.attendanceStatus === 'available' ? (
                        <button
                          onClick={() => handleRSVP(ev)}
                          className="px-4 py-2 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                        >
                          <i className="ri-add-line mr-1"></i> RSVP
                        </button>
                      ) : (
                        <Link
                          to="/learner/calendar"
                          className="px-3 py-2 bg-background-100 text-foreground-600 rounded-lg text-xs font-semibold hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap"
                        >
                          <i className="ri-calendar-2-line mr-1"></i> Calendar
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredEvents.map((ev) => {
              const status = statusConfig[ev.attendanceStatus];
              const club = CLUBS.find((c) => c.id === ev.clubId);
              const effectiveRsvp = eventRsvpCounts[ev.id] || ev.rsvpCount;
              const isFull = effectiveRsvp >= ev.capacity;
              const spotsLeft = ev.capacity - effectiveRsvp;
              const fillPercent = Math.min(100, (effectiveRsvp / ev.capacity) * 100);
              const avgRating = getAverageRating(ev.id);
              const feedbackCount = getFeedbackByEventId(ev.id).length;
              const userAlreadyJoined = joinedEventIds.has(ev.id) || ev.joined;
              return (
                <div key={ev.id} className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden hover:border-primary-200/50 transition-smooth flex flex-col">
                  {/* Event Image */}
                  {ev.image && (
                    <div className="w-full h-[160px] overflow-hidden">
                      <img src={ev.image} alt={ev.title} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="p-5 flex flex-col flex-1">
                    <div className="flex items-start justify-between mb-3">
                      <div className={`rounded-xl px-3 py-2 text-center shrink-0 ${ev.joined ? 'bg-primary-100 text-primary-700' : 'bg-background-100 text-foreground-500'}`}>
                        <p className="text-sm font-bold leading-tight">{ev.date.split(' ')[0]}</p>
                        <p className="text-[9px] font-medium uppercase mt-0.5">{ev.dayName}</p>
                      </div>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
                    </div>
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    <Link to={`/learner/clubs/events/${ev.id}`} className="text-sm font-semibold text-foreground-900 hover:text-primary-600 transition-smooth">{ev.title}</Link>
                    {ev.hasQrCode && (
                      <span className="text-[8px] font-semibold bg-emerald-100 text-emerald-700 px-1 py-0.5 rounded-full">
                        <i className="ri-qr-code-line text-[8px]"></i>
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{ev.type}</span>
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{ev.format}</span>
                  </div>
                  {/* Capacity bar */}
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex-1 h-1 bg-background-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${isFull ? 'bg-rose-400' : spotsLeft <= 3 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                        style={{ width: `${fillPercent}%` }}
                      ></div>
                    </div>
                    <span className={`text-[10px] font-semibold whitespace-nowrap ${isFull ? 'text-rose-600' : spotsLeft <= 3 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {isFull ? 'Full' : `${effectiveRsvp}/${ev.capacity}`}
                    </span>
                  </div>
                  {/* Rating */}
                  {avgRating > 0 && (
                    <div className="flex items-center gap-1 mb-2">
                      {[1,2,3,4,5].map((s) => (
                        <i key={s} className={`text-[10px] ${s <= Math.round(avgRating) ? 'ri-star-fill text-amber-400' : 'ri-star-line text-foreground-300'}`}></i>
                      ))}
                      <span className="text-[10px] text-foreground-500 ml-0.5">{avgRating} ({feedbackCount})</span>
                    </div>
                  )}
                  <p className="text-xs text-foreground-400 leading-relaxed mb-3 line-clamp-3">{ev.description}</p>
                  <div className="mt-auto space-y-1.5">
                    <div className="flex items-center gap-1 text-xs text-foreground-400">
                      <i className="ri-time-line text-xs"></i>
                      <span>{ev.time}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-foreground-400">
                      <i className="ri-user-line text-xs"></i>
                      <span>{ev.host}</span>
                    </div>
                    {club && (
                      <div className="flex items-center gap-1 text-xs text-primary-500">
                        <i className="ri-team-line text-xs"></i>
                        <Link to={`/learner/clubs/${club.id}`} className="hover:underline">{club.title}</Link>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-background-200/30">
                    <span className="text-xs font-bold text-accent-600">+{ev.points} pts</span>
                    <div className="flex items-center gap-1.5">
                      {ev.hasQrCode && (
                        <button
                          onClick={() => handleShowQRCode(ev)}
                          className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center hover:bg-emerald-200 transition-smooth cursor-pointer"
                          title="Check-in QR Code"
                        >
                          <i className="ri-qr-code-line text-xs"></i>
                        </button>
                      )}
                      <button
                        onClick={() => handleAddToCalendar(ev)}
                        className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${
                          calendarEvents.has(ev.id)
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-background-100 text-foreground-500 hover:bg-emerald-50 hover:text-emerald-600'
                        }`}
                      >
                        <i className={`${calendarEvents.has(ev.id) ? 'ri-calendar-check-fill' : 'ri-calendar-2-line'} mr-0.5`}></i>
                        {calendarEvents.has(ev.id) ? 'Added' : 'Calendar'}
                      </button>
                      {userAlreadyJoined ? (
                        <div className="flex items-center gap-1">
                          <span className="px-2.5 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg text-[10px] font-semibold whitespace-nowrap">
                            <i className="ri-check-line mr-0.5"></i> Joined
                          </span>
                          <button
                            onClick={() => handleOpenFeedback(ev)}
                            className="px-2 py-1.5 bg-accent-100 text-accent-700 rounded-lg text-[10px] font-semibold hover:bg-accent-200 transition-smooth cursor-pointer whitespace-nowrap"
                          >
                            <i className="ri-star-line"></i>
                          </button>
                        </div>
                      ) : isFull ? (
                        <span className="px-2.5 py-1.5 bg-rose-100 text-rose-600 rounded-lg text-[10px] font-semibold whitespace-nowrap cursor-not-allowed">
                          <i className="ri-lock-line mr-0.5"></i> Full
                        </span>
                      ) : ev.attendanceStatus === 'available' ? (
                        <button
                          onClick={() => handleRSVP(ev)}
                          className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                        >
                          <i className="ri-add-line mr-1"></i> RSVP
                        </button>
                      ) : (
                        <Link
                          to="/learner/calendar"
                          className="px-3 py-1.5 bg-background-100 text-foreground-600 rounded-lg text-xs font-semibold hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap"
                        >
                          <i className="ri-calendar-2-line mr-1"></i> Calendar
                        </Link>
                      )}
                    </div>
                  </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* QR Code Modal */}
      {qrModalEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setQrModalEvent(null)}>
          <div className="bg-background-50 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-heading font-bold text-foreground-900 flex items-center gap-2">
                <i className="ri-qr-code-line text-emerald-600"></i>
                Check-in QR Code
              </h3>
              <button onClick={() => setQrModalEvent(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer">
                <i className="ri-close-line"></i>
              </button>
            </div>
            <p className="text-xs text-foreground-500 mb-1">{qrModalEvent.title}</p>
            <p className="text-xs text-foreground-400 mb-4">{qrModalEvent.date}, {qrModalEvent.time} · {qrModalEvent.location}</p>
            <div className="bg-white rounded-xl p-4 inline-block mb-4 border border-background-200/50">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(`KBC-EVENT:${qrModalEvent.id}|${qrModalEvent.title}|${qrModalEvent.date}|${qrModalEvent.location}`)}`}
                alt="Event Check-in QR Code"
                className="w-[180px] h-[180px]"
              />
            </div>
            <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200/50 mb-4">
              <p className="text-xs text-emerald-700 flex items-start gap-2">
                <i className="ri-information-line mt-0.5"></i>
                <span>Present this QR code at the venue entrance for contactless check-in.</span>
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const img = new Image();
                  img.crossOrigin = 'anonymous';
                  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(`KBC-EVENT:${qrModalEvent.id}|${qrModalEvent.title}|${qrModalEvent.date}|${qrModalEvent.location}`)}`;
                  img.onload = () => {
                    const link = document.createElement('a');
                    link.download = `checkin-${qrModalEvent.id}.png`;
                    link.href = img.src;
                    link.click();
                  };
                  setAddToCalendarToast('QR code downloaded!');
                  setTimeout(() => setAddToCalendarToast(null), 2500);
                }}
                className="flex-1 px-4 py-2.5 rounded-xl border border-background-200 text-sm font-semibold text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"
              >
                <i className="ri-download-line mr-1"></i> Download QR
              </button>
              <button
                onClick={() => setQrModalEvent(null)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Modal */}
      {feedbackModalEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setFeedbackModalEvent(null)}>
          <div className="bg-background-50 rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-heading font-bold text-foreground-900 flex items-center gap-2">
                <i className="ri-star-line text-accent-500"></i>
                Rate This Event
              </h3>
              <button onClick={() => setFeedbackModalEvent(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer">
                <i className="ri-close-line"></i>
              </button>
            </div>

            <div className="bg-background-100 rounded-xl p-3 mb-4">
              <p className="text-sm font-semibold text-foreground-900">{feedbackModalEvent.title}</p>
              <p className="text-xs text-foreground-400 mt-0.5">{feedbackModalEvent.club} · {feedbackModalEvent.date}</p>
            </div>

            <div className="text-center mb-4">
              <p className="text-xs font-semibold text-foreground-500 mb-2">How would you rate this event?</p>
              <div className="flex items-center justify-center gap-1.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => setFeedbackRating(star)}
                    onMouseEnter={() => setFeedbackHoverRating(star)}
                    onMouseLeave={() => setFeedbackHoverRating(0)}
                    className="cursor-pointer transition-transform hover:scale-110"
                  >
                    <i
                      className={`text-2xl ${
                        star <= (feedbackHoverRating || feedbackRating)
                          ? 'ri-star-fill text-amber-400'
                          : 'ri-star-line text-foreground-300'
                      }`}
                    ></i>
                  </button>
                ))}
              </div>
              {feedbackRating > 0 && (
                <p className="text-xs text-foreground-500 mt-1.5">
                  {feedbackRating === 5 ? 'Excellent!' : feedbackRating === 4 ? 'Very good!' : feedbackRating === 3 ? 'Good' : feedbackRating === 2 ? 'Okay' : 'Poor'}
                </p>
              )}
            </div>

            <div className="mb-4">
              <label className="text-xs font-semibold text-foreground-500 mb-1.5 block">Your feedback (optional)</label>
              <textarea
                value={feedbackComment}
                onChange={(e) => setFeedbackComment(e.target.value)}
                placeholder="Share your experience — what worked well? What could be improved?"
                maxLength={500}
                rows={4}
                className="w-full bg-background-100 border border-background-200/50 rounded-lg px-3 py-2 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-accent-400/40 focus:border-accent-300/50 transition-all resize-none"
              />
              <span className="text-[10px] text-foreground-400 mt-0.5 block">{feedbackComment.length}/500</span>
            </div>

            <div className="bg-accent-50 rounded-xl p-3 border border-accent-200/50 mb-4">
              <p className="text-xs text-accent-700 flex items-center gap-2">
                <i className="ri-coins-line"></i>
                <span>Submitting feedback earns you <strong>+25 community points</strong></span>
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setFeedbackModalEvent(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-background-200 text-sm font-semibold text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitFeedback}
                disabled={feedbackRating === 0}
                className="flex-1 px-4 py-2.5 rounded-xl bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <i className="ri-send-plane-line mr-1"></i> Submit Feedback
              </button>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}