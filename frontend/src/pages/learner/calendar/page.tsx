import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { type CalendarEvent } from '@/pages/learner/clubs/data';
import { downloadICS, downloadAllICS, createPublicFeedBlob, type ICSEvent } from '@/utils/ics-generator';
import { useMyLearner } from '@/hooks/useMyLearner';
import {
  fetchLearnerCalendarEvents, bookLearnerCalendarSession, fetchLearnerCoach,
  fetchCalendarConnections, startCalendarOAuth, connectCredentialCalendar,
  disconnectPersonalCalendar, fetchPersonalCalendarAvailability,
  type LearnerCalendarEvent, type BookableSessionType, type PersonalCalendarConnection,
  type PersonalCalendarProvider, type CalendarBusySlot,
} from '@/api/learnerCalendar';

const learnerNav = roleNavMap.learner;
const p = LEARNER_PROFILE;

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT_INDEX: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

const CALENDAR_PROVIDERS: Array<{ provider: PersonalCalendarProvider; title: string; subtitle: string; icon: string }> = [
  { provider: 'google', title: 'Continue with Google', subtitle: 'OAuth access to free/busy availability', icon: 'ri-google-fill' },
  { provider: 'microsoft', title: 'Continue with Microsoft', subtitle: 'Outlook or Microsoft 365 calendar', icon: 'ri-microsoft-fill' },
  { provider: 'ics', title: 'Connect ICS Calendar', subtitle: 'Private iCal feed URL', icon: 'ri-links-line' },
];

/** Resolve an event's calendar day — prefers the exact isoDate carried by DB-backed
 * events, falls back to parsing the "13 Jun" display date (year unknown → null). */
function parseEventDate(ev: CalendarEvent): { day: number; month: number; year: number | null } | null {
  if (ev.isoDate) {
    const [y, m, d] = ev.isoDate.split('-').map(Number);
    if (y && m && d) return { day: d, month: m - 1, year: y };
  }
  const parts = ev.date.split(' ');
  const day = parseInt(parts[0]);
  const month = MONTH_SHORT_INDEX[parts[1]];
  if (!day || month === undefined) return null;
  return { day, month, year: null };
}

/** Map a Coach.coach_calendar_event row (backend JSON) to the page's display shape. */
function mapCoachEvent(ev: LearnerCalendarEvent, learnerName: string): CalendarEvent | null {
  if (ev.status === 'cancelled') return null;
  const iso = ev.scheduledDate || ev.date || ev.targetDate;
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dateObj = new Date(y, m - 1, d);
  const dayName = DAYS_OF_WEEK[dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1];
  let time = '09:00–10:00';
  if (ev.scheduledTime) {
    const [h, min] = ev.scheduledTime.split(':').map(Number);
    const end = new Date(y, m - 1, d, h || 0, (min || 0) + (ev.durationMinutes || 60));
    time = `${ev.scheduledTime}–${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
  }
  const confirmed = ev.status === 'scheduled' || ev.status === 'in-progress' || ev.status === 'completed';
  const isLiveSession = ev.source === 'live-session';
  return {
    id: ev.id,
    title: !isLiveSession && ev.sequence ? `${ev.title} ${ev.sequence}` : ev.title,
    date: `${d} ${MONTH_NAMES[m - 1].substring(0, 3)}`,
    dayName,
    time,
    club: isLiveSession ? (ev.module || 'Live Session') : 'Coaching',
    clubId: '',
    type: isLiveSession ? 'Workshop' : ev.type === 'review' ? 'Assessment' : ev.type === 'welfare' ? 'Study Group' : 'Coaching',
    format: isLiveSession ? 'Live Teams session' : '1:1 Teams',
    location: ev.meetingLink ? 'Microsoft Teams' : ev.scheduledTime ? 'Online' : 'To be confirmed',
    host: ev.coachName || (isLiveSession ? 'Your tutor' : 'Your coach'),
    points: 0,
    status: confirmed ? 'confirmed' : 'pending',
    description: ev.notes || (isLiveSession
      ? `${ev.module || ev.title} live session${ev.group ? ` for ${ev.group}` : ''}.`
      : `${ev.title} session with ${ev.coachName || 'your coach'} for ${learnerName}.`),
    isoDate: iso,
    meetingLink: ev.meetingLink || undefined,
  };
}

function mapBusySlot(slot: CalendarBusySlot): CalendarEvent | null {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  const year = start.getFullYear();
  const month = start.getMonth();
  const day = start.getDate();
  const isoDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const time = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}–${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
  return {
    id: `personal-busy-${slot.provider}-${slot.start}-${slot.end}`,
    title: 'Busy',
    date: `${day} ${MONTH_NAMES[month].slice(0, 3)}`,
    dayName: DAYS_OF_WEEK[start.getDay() === 0 ? 6 : start.getDay() - 1],
    time,
    club: 'Personal',
    clubId: '',
    type: 'Busy',
    format: 'Connected personal calendar',
    location: 'Private event',
    host: 'Personal calendar',
    points: 0,
    status: 'confirmed',
    description: 'Busy time from your connected personal calendar. Event details stay private.',
    isoDate,
  };
}

const HOURS = Array.from({ length: 15 }, (_, i) => i + 7);

const PERSONAL_EVENT_COLORS = [
  { name: 'Sky', value: 'sky', bg: 'bg-sky-100', text: 'text-sky-700', border: 'border-l-sky-500', dot: 'bg-sky-500' },
  { name: 'Rose', value: 'rose', bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-l-rose-500', dot: 'bg-rose-500' },
  { name: 'Amber', value: 'amber', bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-l-amber-500', dot: 'bg-amber-500' },
  { name: 'Emerald', value: 'emerald', bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-l-emerald-500', dot: 'bg-emerald-500' },
  { name: 'Violet', value: 'violet', bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-l-violet-500', dot: 'bg-violet-500' },
  { name: 'Teal', value: 'teal', bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-l-teal-500', dot: 'bg-teal-500' },
  { name: 'Orange', value: 'orange', bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-l-orange-500', dot: 'bg-orange-500' },
  { name: 'Indigo', value: 'indigo', bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-l-indigo-500', dot: 'bg-indigo-500' },
];

function getMonthData(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOfWeek = firstDay.getDay();
  const mondayOffset = startOfWeek === 0 ? 6 : startOfWeek - 1;
  const totalDays = lastDay.getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < mondayOffset; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  return cells;
}

function getWeekDates(year: number, month: number, selectedDay: number) {
  const date = new Date(year, month, selectedDay);
  const dayOfWeek = date.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(date);
  monday.setDate(date.getDate() - mondayOffset);
  const week: { day: number; month: number; monthName: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    week.push({ day: d.getDate(), month: d.getMonth(), monthName: MONTH_NAMES[d.getMonth()] });
  }
  return week;
}

function getEventColorClass(type: string, customColor?: string) {
  if (customColor) {
    const color = PERSONAL_EVENT_COLORS.find((c) => c.value === customColor);
    if (color) return `${color.bg} ${color.text} ${color.border}`;
  }
  const map: Record<string, string> = {
    Workshop: 'bg-primary-100 text-primary-700 border-l-primary-500',
    'Hands-on Lab': 'bg-secondary-100 text-secondary-700 border-l-secondary-500',
    Masterclass: 'bg-accent-100 text-accent-700 border-l-accent-500',
    'Panel Discussion': 'bg-amber-100 text-amber-700 border-l-amber-500',
    'Case Study': 'bg-emerald-100 text-emerald-700 border-l-emerald-500',
    Showcase: 'bg-rose-100 text-rose-700 border-l-rose-500',
    'Study Group': 'bg-indigo-100 text-indigo-700 border-l-indigo-500',
    Coaching: 'bg-teal-100 text-teal-700 border-l-teal-500',
    Assessment: 'bg-red-100 text-red-700 border-l-red-500',
    'Networking Event': 'bg-violet-100 text-violet-700 border-l-violet-500',
    Personal: 'bg-sky-100 text-sky-700 border-l-sky-500',
    Busy: 'bg-slate-200 text-slate-700 border-l-slate-500',
  };
  return map[type] || 'bg-background-100 text-foreground-600 border-l-foreground-300';
}

function getEventDotColor(type: string, customColor?: string) {
  if (customColor) {
    const color = PERSONAL_EVENT_COLORS.find((c) => c.value === customColor);
    if (color) return color.dot;
  }
  const map: Record<string, string> = {
    Workshop: 'bg-primary-500', 'Hands-on Lab': 'bg-secondary-500', Masterclass: 'bg-accent-500',
    'Panel Discussion': 'bg-amber-500', 'Case Study': 'bg-emerald-500', Showcase: 'bg-rose-500',
    'Study Group': 'bg-indigo-500', Coaching: 'bg-teal-500', Assessment: 'bg-red-500',
    'Networking Event': 'bg-violet-500', Personal: 'bg-sky-500', Busy: 'bg-slate-500',
  };
  return map[type] || 'bg-foreground-400';
}

function getEventTimeRange(time: string): { start: number; end: number } {
  const parts = time.split('\u2013').map((s) => s.trim());
  const startStr = parts[0] || '00:00';
  const endStr = parts[1] || parts[0] || '00:00';
  const [startH, startM] = startStr.split(':').map(Number);
  const [endH, endM] = endStr.split(':').map(Number);
  return { start: (startH || 0) * 60 + (startM || 0), end: (endH || 0) * 60 + (endM || 0) };
}

function hasConflict(events: CalendarEvent[], newEvent: CalendarEvent): CalendarEvent | null {
  const newRange = getEventTimeRange(newEvent.time);
  const newDate = parseEventDate(newEvent);
  if (!newDate) return null;
  for (const ev of events) {
    if (ev.id === newEvent.id) continue;
    const evDate = parseEventDate(ev);
    if (!evDate || evDate.day !== newDate.day || evDate.month !== newDate.month) continue;
    if (evDate.year !== null && newDate.year !== null && evDate.year !== newDate.year) continue;
    const evRange = getEventTimeRange(ev.time);
    if (newRange.start < evRange.end && newRange.end > evRange.start) return ev;
  }
  return null;
}

const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'No repeat' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
];

function requestNotificationPermission(): Promise<'default' | 'granted' | 'denied'> {
  if (!('Notification' in window)) return Promise.resolve('denied' as const);
  return Notification.requestPermission();
}

function showNotification(title: string, body: string) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.ico', badge: '/favicon.ico' });
  }
}

function scheduleEventNotification(eventId: string, eventTitle: string, eventDate: string, eventTime: string, reminderMinutes: number) {
  const monthMap: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const parts = eventDate.split(' ');
  const day = parseInt(parts[0]);
  const month = monthMap[parts[1]] ?? 5;
  const year = new Date().getFullYear();
  const [hour, minute] = eventTime.split(':').map(Number);
  const eventDateTime = new Date(year, month, day, hour, minute);
  const reminderTime = new Date(eventDateTime.getTime() - reminderMinutes * 60000);
  const now = new Date();
  const delay = reminderTime.getTime() - now.getTime();
  if (delay > 0 && delay < 86400000 * 365) {
    const timerId = setTimeout(() => {
      showNotification('Event Reminder', `"${eventTitle}" starts in ${reminderMinutes} minutes!`);
      const scheduled = JSON.parse(localStorage.getItem('calendarNotifications') || '[]');
      const updated = scheduled.filter((n: { id: string }) => n.id !== eventId);
      localStorage.setItem('calendarNotifications', JSON.stringify(updated));
    }, delay);
    const scheduled = JSON.parse(localStorage.getItem('calendarNotifications') || '[]');
    const existing = scheduled.find((n: { id: string }) => n.id === eventId);
    if (existing) { if (existing.timerId) clearTimeout(existing.timerId); existing.timerId = timerId; existing.reminderMinutes = reminderMinutes; }
    else { scheduled.push({ id: eventId, timerId, eventTitle, eventDate, eventTime, reminderMinutes }); }
    localStorage.setItem('calendarNotifications', JSON.stringify(scheduled.map((n: { id: string; timerId: number; eventTitle: string; eventDate: string; eventTime: string; reminderMinutes: number }) => ({ id: n.id, eventTitle: n.eventTitle, eventDate: n.eventDate, eventTime: n.eventTime, reminderMinutes: n.reminderMinutes }))));
    return timerId;
  }
  return null;
}

function restoreNotifications() {
  const scheduled = JSON.parse(localStorage.getItem('calendarNotifications') || '[]');
  scheduled.forEach((n: { id: string; eventTitle: string; eventDate: string; eventTime: string; reminderMinutes: number }) => {
    scheduleEventNotification(n.id, n.eventTitle, n.eventDate, n.eventTime, n.reminderMinutes);
  });
}

type ViewMode = 'monthly' | 'weekly' | 'daily';

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function DonutRing({ pct, size = 64, stroke = 6, color, trackClass = 'text-background-200' }: { pct: number; size?: number; stroke?: number; color: string; trackClass?: string }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const colorMap: Record<string, string> = { primary: 'stroke-primary-500', accent: 'stroke-accent-500', secondary: 'stroke-secondary-500', emerald: 'stroke-emerald-500', amber: 'stroke-amber-500' };
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={trackClass} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={`${colorMap[color] || colorMap.primary} transition-all duration-700 ease-out`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} />
    </svg>
  );
}

export default function LearnerCalendarPage() {
  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Calendar" pageSubtitle="Your schedule, coaching sessions, club events — all in one professional view"
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      <LearnerCalendarContent />
    </WorkspaceShell>
  );
}

/** Calendar body without the page shell — reusable as an embedded section (e.g. on the learner overview page). */
export function LearnerCalendarContent() {
  const myLearner = useMyLearner();
  const [viewMode, setViewMode] = useState<ViewMode>('monthly');
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [selectedDay, setSelectedDay] = useState(() => new Date().getDate());
  const [myEvents, setMyEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [addToCalendarToast, setAddToCalendarToast] = useState<string | null>(null);
  const [showEventDetails, setShowEventDetails] = useState<CalendarEvent | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customDate, setCustomDate] = useState(() => todayISO());
  const [customStartTime, setCustomStartTime] = useState('14:00');
  const [customEndTime, setCustomEndTime] = useState('15:00');
  const [customReminder, setCustomReminder] = useState('15');
  const [customLocation, setCustomLocation] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customColor, setCustomColor] = useState('sky');
  const [notificationPermission, setNotificationPermission] = useState<'default' | 'granted' | 'denied'>('default');
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [showShareCalendar, setShowShareCalendar] = useState(false);
  const [publicFeedUrl, setPublicFeedUrl] = useState<string | null>(null);
  const [feedCopied, setFeedCopied] = useState(false);
  const [customRecurrence, setCustomRecurrence] = useState('none');
  const [conflictEvent, setConflictEvent] = useState<CalendarEvent | null>(null);
  const [showBookModal, setShowBookModal] = useState(false);
  const [bookType, setBookType] = useState<BookableSessionType>('catch-up');
  const [bookDate, setBookDate] = useState(() => todayISO());
  const [bookTime, setBookTime] = useState('10:00');
  const [bookDuration, setBookDuration] = useState('60');
  const [bookNotes, setBookNotes] = useState('');
  const [bookSubmitting, setBookSubmitting] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [coach, setCoach] = useState<{ name: string; email: string } | null>(null);
  const [showCalendarConnect, setShowCalendarConnect] = useState(false);
  const [calendarConnections, setCalendarConnections] = useState<PersonalCalendarConnection[]>([]);
  const [connectionProvider, setConnectionProvider] = useState<'icloud' | 'caldav' | 'ics' | null>(null);
  const [connectionUrl, setConnectionUrl] = useState('');
  const [connectionUsername, setConnectionUsername] = useState('');
  const [connectionPassword, setConnectionPassword] = useState('');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionSubmitting, setConnectionSubmitting] = useState(false);
  const [busySlots, setBusySlots] = useState<CalendarBusySlot[]>([]);
  const [visibleBusySlots, setVisibleBusySlots] = useState<CalendarBusySlot[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const today = new Date();
  const todayDay = today.getDate();
  const todayMonth = today.getMonth();
  const todayYear = today.getFullYear();
  const todayMonthLabel = MONTH_NAMES[todayMonth].slice(0, 3).toUpperCase();
  const todayWeekdayLabel = DAYS_OF_WEEK[today.getDay() === 0 ? 6 : today.getDay() - 1].toUpperCase();
  const isToday = useCallback((day: number, month: number, year: number) => {
    return day === todayDay && month === todayMonth && year === todayYear;
  }, [todayDay, todayMonth, todayYear]);

  const reloadCalendarConnections = useCallback(() => {
    return fetchCalendarConnections(myLearner.kind, myLearner.id)
      .then((result) => setCalendarConnections(result.connections));
  }, [myLearner.kind, myLearner.id]);

  const personalBusyEvents = useMemo(() => {
    const unique = new Map<string, CalendarBusySlot>();
    visibleBusySlots.forEach((slot) => unique.set(`${slot.start}-${slot.end}`, slot));
    return Array.from(unique.values()).map(mapBusySlot).filter((event): event is CalendarEvent => event !== null);
  }, [visibleBusySlots]);
  const displayedEvents = useMemo(() => [...myEvents, ...personalBusyEvents], [myEvents, personalBusyEvents]);

  const getEventsForDay = useCallback((day: number, month: number): CalendarEvent[] => {
    return displayedEvents.filter((ev) => {
      const evDate = parseEventDate(ev);
      if (!evDate) return false;
      return evDate.day === day && evDate.month === month && (evDate.year === null || evDate.year === viewYear);
    });
  }, [displayedEvents, viewYear]);

  const monthCells = useMemo(() => getMonthData(viewYear, viewMonth), [viewYear, viewMonth]);
  const weekDates = useMemo(() => getWeekDates(viewYear, viewMonth, selectedDay), [viewYear, viewMonth, selectedDay]);
  const selectedDayEvents = useMemo(() => getEventsForDay(selectedDay, viewMonth), [selectedDay, viewMonth, getEventsForDay]);
  const confirmedCount = myEvents.filter((ev) => ev.status === 'confirmed').length;
  const pendingCount = myEvents.filter((ev) => ev.status === 'pending').length;
  const totalPoints = myEvents.filter((ev) => ev.status === 'confirmed').reduce((s, ev) => s + ev.points, 0);

  useEffect(() => {
    if ('Notification' in window) { setNotificationPermission(Notification.permission); restoreNotifications(); }
  }, []);

  useEffect(() => {
    reloadCalendarConnections().catch(() => setCalendarConnections([]));
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('calendar_connected');
    const oauthError = params.get('calendar_error');
    if (connected) {
      setAddToCalendarToast(`${connected === 'google' ? 'Google' : 'Microsoft'} Calendar connected successfully.`);
      setShowCalendarConnect(true);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (oauthError) {
      setConnectionError(oauthError);
      setShowCalendarConnect(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [reloadCalendarConnections]);

  useEffect(() => {
    if (calendarConnections.length === 0) {
      setVisibleBusySlots([]);
      return;
    }
    const start = new Date(viewYear, viewMonth, 1).toISOString();
    const end = new Date(viewYear, viewMonth + 1, 1).toISOString();
    let cancelled = false;
    fetchPersonalCalendarAvailability(myLearner.kind, myLearner.id, start, end)
      .then((result) => { if (!cancelled) setVisibleBusySlots(result.busy); })
      .catch(() => { if (!cancelled) setVisibleBusySlots([]); });
    return () => { cancelled = true; };
  }, [calendarConnections.length, viewYear, viewMonth, myLearner.kind, myLearner.id]);

  useEffect(() => {
    if (!showBookModal || calendarConnections.length === 0 || !bookDate) {
      setBusySlots([]);
      return;
    }
    const start = new Date(`${bookDate}T00:00:00`).toISOString();
    const end = new Date(`${bookDate}T23:59:59`).toISOString();
    let cancelled = false;
    setAvailabilityLoading(true);
    fetchPersonalCalendarAvailability(myLearner.kind, myLearner.id, start, end)
      .then((result) => { if (!cancelled) setBusySlots(result.busy); })
      .catch(() => { if (!cancelled) setBusySlots([]); })
      .finally(() => { if (!cancelled) setAvailabilityLoading(false); });
    return () => { cancelled = true; };
  }, [showBookModal, calendarConnections.length, bookDate, myLearner.kind, myLearner.id]);

  // Load the learner's coaching sessions from Coach.coach_calendar_event.
  useEffect(() => {
    let cancelled = false;
    setCalendarLoading(true);
    fetchLearnerCalendarEvents(myLearner.kind, myLearner.id)
      .then((res) => {
        if (cancelled) return;
        const coachEvents = res.events
          .map((ev) => mapCoachEvent(ev, p.fullName))
          .filter((ev): ev is CalendarEvent => ev !== null);
        // Keep locally-created personal events; replace the DB-backed ones.
        setMyEvents((prev) => [...coachEvents, ...prev.filter((ev) => ev.id.startsWith('custom-'))]);
        setCalendarError(null);
      })
      .catch((err: Error) => { if (!cancelled) setCalendarError(err.message); })
      .finally(() => { if (!cancelled) setCalendarLoading(false); });
    // The assigned coach (Active_users mirror) — powers the "Book a session" panel.
    fetchLearnerCoach(myLearner.id)
      .then((res) => { if (!cancelled && res.coachEmail) setCoach({ name: res.coachName || 'Your coach', email: res.coachEmail }); })
      .catch(() => { /* no mirror row / no coach assigned — booking panel shows a hint */ });
    return () => { cancelled = true; };
  }, [myLearner.kind, myLearner.id]);

  const selectedSlotConflicts = useMemo(() => {
    if (!bookDate || !bookTime) return false;
    const start = new Date(`${bookDate}T${bookTime}:00`).getTime();
    const end = start + parseInt(bookDuration || '60') * 60_000;
    return busySlots.some((slot) => start < new Date(slot.end).getTime() && end > new Date(slot.start).getTime());
  }, [bookDate, bookTime, bookDuration, busySlots]);

  const handleCredentialConnect = async () => {
    if (!connectionProvider || connectionSubmitting) return;
    setConnectionSubmitting(true);
    setConnectionError(null);
    try {
      await connectCredentialCalendar(myLearner.kind, myLearner.id, connectionProvider, {
        url: connectionUrl.trim(), username: connectionUsername.trim(), password: connectionPassword,
      });
      await reloadCalendarConnections();
      setConnectionProvider(null); setConnectionUrl(''); setConnectionUsername(''); setConnectionPassword('');
      setAddToCalendarToast('Personal calendar connected successfully.');
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Calendar connection failed.');
    } finally {
      setConnectionSubmitting(false);
    }
  };

  const handleDisconnectCalendar = async (provider: PersonalCalendarProvider) => {
    try {
      await disconnectPersonalCalendar(myLearner.kind, myLearner.id, provider);
      await reloadCalendarConnections();
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Could not disconnect calendar.');
    }
  };

  const handleBookSession = async () => {
    if (bookSubmitting) return;
    if (selectedSlotConflicts) {
      setBookError('This time overlaps an event in your connected personal calendar. Please choose another time.');
      return;
    }
    setBookSubmitting(true);
    setBookError(null);
    try {
      const res = await bookLearnerCalendarSession(myLearner.kind, myLearner.id, {
        sessionType: bookType,
        scheduledDate: bookDate,
        scheduledTime: bookTime,
        durationMinutes: parseInt(bookDuration),
        notes: bookNotes.trim() || undefined,
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      });
      const mapped = mapCoachEvent(res.event, p.fullName);
      if (mapped) setMyEvents((prev) => [...prev.filter((ev) => ev.id !== mapped.id), mapped]);
      setShowBookModal(false);
      setBookNotes('');
      setAddToCalendarToast(res.warning
        ? `Session booked! (${res.warning})`
        : `"${mapped?.title || 'Session'}" booked with ${coach?.name || 'your coach'}!`);
      setTimeout(() => setAddToCalendarToast(null), 4000);
    } catch (err) {
      setBookError(err instanceof Error ? err.message : 'Booking failed.');
    } finally {
      setBookSubmitting(false);
    }
  };

  const handlePrev = () => {
    if (viewMode === 'daily') { const d = new Date(viewYear, viewMonth, selectedDay); d.setDate(d.getDate() - 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setSelectedDay(d.getDate()); }
    else { if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); } else setViewMonth(viewMonth - 1); }
  };
  const handleNext = () => {
    if (viewMode === 'daily') { const d = new Date(viewYear, viewMonth, selectedDay); d.setDate(d.getDate() + 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setSelectedDay(d.getDate()); }
    else { if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); } else setViewMonth(viewMonth + 1); }
  };
  const handleToday = () => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); setSelectedDay(today.getDate()); };

  const handleAddToCalendar = (event: CalendarEvent) => {
    const alreadyIn = myEvents.some((e) => e.id === event.id);
    if (alreadyIn) { setAddToCalendarToast(`${event.title} is already in your calendar`); }
    else {
      const newEvent: CalendarEvent = { ...event, status: 'confirmed' as const };
      const conflict = hasConflict(myEvents, newEvent);
      if (conflict) { setConflictEvent(conflict); return; }
      setMyEvents((prev) => [...prev, newEvent]);
      setAddToCalendarToast(`"${event.title}" added to your calendar!`);
    }
    setTimeout(() => setAddToCalendarToast(null), 2500);
  };

  const handleRemoveFromCalendar = (eventId: string) => {
    const ev = myEvents.find((e) => e.id === eventId);
    setMyEvents((prev) => prev.filter((e) => e.id !== eventId));
    if (timersRef.current[eventId]) { clearTimeout(timersRef.current[eventId]); delete timersRef.current[eventId]; }
    const scheduled = JSON.parse(localStorage.getItem('calendarNotifications') || '[]');
    localStorage.setItem('calendarNotifications', JSON.stringify(scheduled.filter((n: { id: string }) => n.id !== eventId)));
    if (ev) setAddToCalendarToast(`"${ev.title}" removed from calendar`);
    setShowEventDetails(null);
    setTimeout(() => setAddToCalendarToast(null), 2500);
  };

  const handleExportICS = (ev: CalendarEvent) => {
    const icsEvent: ICSEvent = { title: ev.title, description: ev.description, date: ev.date, time: ev.time, location: ev.location };
    downloadICS(icsEvent);
    setAddToCalendarToast(`"${ev.title}" exported!`);
    setTimeout(() => setAddToCalendarToast(null), 2500);
  };

  const handleExportAllICS = () => {
    const confirmedEvents = myEvents.filter((ev) => ev.status === 'confirmed');
    if (confirmedEvents.length === 0) { setAddToCalendarToast('No confirmed events to export'); setTimeout(() => setAddToCalendarToast(null), 2500); return; }
    const icsEvents: ICSEvent[] = confirmedEvents.map((ev) => ({ title: ev.title, description: ev.description, date: ev.date, time: ev.time, location: ev.location }));
    downloadAllICS(icsEvents);
    setAddToCalendarToast(`${confirmedEvents.length} events exported!`);
    setTimeout(() => setAddToCalendarToast(null), 2500);
  };

  const handleCreateCustomEvent = () => {
    if (!customTitle.trim()) return;
    const dateObj = new Date(customDate);
    const day = dateObj.getDate();
    const monthName = MONTH_NAMES[dateObj.getMonth()].substring(0, 3);
    const dayName = DAYS_OF_WEEK[dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1];
    const reminderMinutes = parseInt(customReminder);
    const newEvent: CalendarEvent = { id: `custom-${Date.now()}`, title: customTitle, date: `${day} ${monthName}`, dayName, time: `${customStartTime}\u2013${customEndTime}`, club: 'Personal', clubId: '', type: 'Personal', format: customLocation || 'Personal', location: customLocation || 'Personal Calendar', host: p.fullName, points: 0, status: 'confirmed', description: customDescription || `Reminder: ${customReminder} minutes before`, color: customColor, reminderMinutes, isoDate: customDate };
    const conflict = hasConflict(myEvents, newEvent);
    if (conflict) { setConflictEvent(conflict); return; }
    setMyEvents((prev) => [newEvent, ...prev]);
    if (notificationPermission === 'granted' && reminderMinutes > 0) { const timerId = scheduleEventNotification(newEvent.id, newEvent.title, newEvent.date, customStartTime, reminderMinutes); if (timerId) timersRef.current[newEvent.id] = timerId; }
    if (customRecurrence !== 'none') {
      const recurrenceCount = customRecurrence === 'monthly' ? 3 : 4;
      const dayIncrement = customRecurrence === 'weekly' ? 7 : customRecurrence === 'biweekly' ? 14 : 0;
      const monthIncrement = customRecurrence === 'monthly' ? 1 : 0;
      for (let i = 1; i <= recurrenceCount; i++) {
        const nextDate = new Date(dateObj);
        if (dayIncrement > 0) nextDate.setDate(nextDate.getDate() + dayIncrement * i);
        if (monthIncrement > 0) nextDate.setMonth(nextDate.getMonth() + monthIncrement * i);
        const recDay = nextDate.getDate();
        const recMonthName = MONTH_NAMES[nextDate.getMonth()].substring(0, 3);
        const recDayName = DAYS_OF_WEEK[nextDate.getDay() === 0 ? 6 : nextDate.getDay() - 1];
        const recEvent: CalendarEvent = { ...newEvent, id: `custom-${Date.now()}-${i}`, date: `${recDay} ${recMonthName}`, dayName: recDayName, isoDate: `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(recDay).padStart(2, '0')}` };
        const recConflict = hasConflict([newEvent, ...myEvents], recEvent);
        if (recConflict) { setConflictEvent(recConflict); break; }
        setMyEvents((prev) => [...prev, recEvent]);
        if (notificationPermission === 'granted' && reminderMinutes > 0) { const recTimerId = scheduleEventNotification(recEvent.id, recEvent.title, recEvent.date, customStartTime, reminderMinutes); if (recTimerId) timersRef.current[recEvent.id] = recTimerId; }
      }
    }
    setCustomTitle(''); setCustomDescription(''); setCustomLocation(''); setCustomDate(todayISO()); setCustomStartTime('14:00'); setCustomEndTime('15:00'); setCustomReminder('15'); setCustomColor('sky'); setCustomRecurrence('none'); setShowCreateModal(false);
    setAddToCalendarToast(`"${newEvent.title}" created${customRecurrence !== 'none' ? ` and ${customRecurrence === 'monthly' ? '3 monthly' : '4 recurring'} instances added` : ''}!`);
    setTimeout(() => setAddToCalendarToast(null), 3000);
  };

  const handleEnableNotifications = async () => { const result = await requestNotificationPermission(); setNotificationPermission(result); if (result === 'granted') { setAddToCalendarToast('Push notifications enabled!'); setTimeout(() => setAddToCalendarToast(null), 2500); } };
  const handleTestNotification = () => { if (Notification.permission === 'granted') { showNotification('Test Reminder', 'Test notification for event reminder.'); setAddToCalendarToast('Test notification sent!'); } else { setAddToCalendarToast('Enable notifications first.'); } setTimeout(() => setAddToCalendarToast(null), 3000); };
  const handleGeneratePublicFeed = () => { const confirmedEvents = myEvents.filter((ev) => ev.status === 'confirmed'); const icsEvents: ICSEvent[] = confirmedEvents.map((ev) => ({ title: ev.title, description: ev.description, date: ev.date, time: ev.time, location: ev.location })); const url = createPublicFeedBlob(icsEvents); setPublicFeedUrl(url); };
  const handleCopyFeedUrl = () => { if (publicFeedUrl) { navigator.clipboard.writeText(publicFeedUrl); setFeedCopied(true); setTimeout(() => setFeedCopied(false), 2000); } };

  const statusConfig: Record<string, { label: string; cls: string }> = { confirmed: { label: 'Confirmed', cls: 'bg-emerald-100 text-emerald-700' }, pending: { label: 'Pending', cls: 'bg-amber-100 text-amber-700' } };
  const now = today;
  const currentHour = now.getHours();

  const attPct = ((p.attendanceRate || 86) / 100);

  return (
    <>
      {/* Toast */}
      {addToCalendarToast && (
        <div className="fixed top-20 right-6 z-50 bg-background-50 rounded-xl border border-emerald-200/60 shadow-lg px-4 py-3 flex items-center gap-3 animate-in slide-in-from-right-4 duration-300">
          <span className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center"><AppIcon className="ri-calendar-check-line"></AppIcon></span>
          <p className="text-sm font-semibold text-foreground-900">{addToCalendarToast}</p>
        </div>
      )}

      {/* ═══════════ BOOK COACH SESSION MODAL ═══════════ */}
      {showCalendarConnect && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setShowCalendarConnect(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-background-50 p-6 shadow-xl animate-in zoom-in-95 duration-200" onClick={(event) => event.stopPropagation()}>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary-600">Calendar source</p>
                <h3 className="mt-1 text-xl font-heading font-bold text-foreground-900">Connect personal calendar</h3>
                <p className="mt-1 text-xs text-foreground-400">We only read free/busy times to prevent booking conflicts.</p>
              </div>
              <button type="button" onClick={() => setShowCalendarConnect(false)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-400 hover:bg-background-100"><AppIcon className="ri-close-line" /></button>
            </div>
            <div className="space-y-2.5">
              {CALENDAR_PROVIDERS.map((item) => {
                const connected = calendarConnections.find((connection) => connection.provider === item.provider);
                return (
                  <div key={item.provider} className={`rounded-xl border p-1 transition ${connected ? 'border-emerald-200 bg-emerald-50/30' : 'border-background-300'}`}>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${connected ? 'bg-emerald-100 text-emerald-600' : 'bg-primary-50 text-primary-600'}`}><AppIcon className={connected ? 'ri-check-line' : item.icon} /></span>
                      <button type="button" disabled={Boolean(connected)} onClick={async () => {
                        setConnectionError(null);
                        if (item.provider === 'google' || item.provider === 'microsoft') {
                          try { await startCalendarOAuth(myLearner.kind, myLearner.id, item.provider); }
                          catch (error) { setConnectionError(error instanceof Error ? error.message : 'Could not start calendar connection.'); }
                        } else {
                          setConnectionProvider(item.provider);
                          setConnectionUrl(item.provider === 'icloud' ? 'https://caldav.icloud.com' : '');
                        }
                      }} className="min-w-0 flex-1 text-left disabled:cursor-default">
                        <p className="text-sm font-semibold text-foreground-900">{connected ? `${item.title.replace('Continue with ', '').replace('Connect ', '')} connected` : item.title}</p>
                        <p className="truncate text-xs text-foreground-400">{connected?.accountEmail || item.subtitle}</p>
                      </button>
                      {connected && <button type="button" onClick={() => handleDisconnectCalendar(item.provider)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-red-600 hover:bg-red-50">Disconnect</button>}
                    </div>
                    {connectionProvider === item.provider && !connected && (
                      <div className="space-y-3 border-t border-background-200 px-3 pb-3 pt-3">
                        <div><label className="mb-1 block text-[10px] font-semibold text-foreground-500">{item.provider === 'ics' ? 'Private ICS feed URL' : 'Calendar server URL'}</label><input type="url" value={connectionUrl} onChange={(event) => setConnectionUrl(event.target.value)} placeholder="https://..." className="w-full rounded-lg border border-background-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary-400" /></div>
                        {item.provider !== 'ics' && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-[10px] font-semibold text-foreground-500">Calendar username</label><input value={connectionUsername} onChange={(event) => setConnectionUsername(event.target.value)} autoComplete="username" className="w-full rounded-lg border border-background-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary-400" /></div><div><label className="mb-1 block text-[10px] font-semibold text-foreground-500">App-specific password</label><input type="password" value={connectionPassword} onChange={(event) => setConnectionPassword(event.target.value)} autoComplete="new-password" className="w-full rounded-lg border border-background-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary-400" /></div></div>}
                        <div className="flex gap-2"><button type="button" onClick={() => setConnectionProvider(null)} className="flex-1 rounded-lg border border-background-300 px-3 py-2 text-xs font-semibold text-foreground-600">Cancel</button><button type="button" onClick={handleCredentialConnect} disabled={connectionSubmitting || !connectionUrl || (item.provider !== 'ics' && (!connectionUsername || !connectionPassword))} className="flex-1 rounded-lg bg-primary-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{connectionSubmitting ? 'Connecting…' : 'Connect'}</button></div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {connectionError && <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"><AppIcon className="ri-error-warning-line mt-0.5" /><span>{connectionError}</span></div>}
            <p className="mt-4 flex items-start gap-2 text-[10px] leading-relaxed text-foreground-400"><AppIcon className="ri-shield-keyhole-line mt-0.5 text-emerald-500" />OAuth tokens and calendar passwords are encrypted on the server and are never sent back to the browser.</p>
          </div>
        </div>
      )}

      {showBookModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowBookModal(false)}>
          <div className="bg-background-50 rounded-2xl p-6 max-w-lg w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-heading font-bold text-foreground-900 flex items-center gap-2"><AppIcon className="ri-user-star-line text-primary-500"></AppIcon>Book a Coach Session</h3>
              <button onClick={() => setShowBookModal(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button>
            </div>
            <p className="text-sm text-foreground-500 mb-5">
              {coach
                ? <>A Teams meeting will be booked with <strong className="text-foreground-700">{coach.name}</strong> and added to both your calendars.</>
                : 'No coach has been assigned to you yet — please contact your programme team.'}
            </p>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground-500 mb-1.5 block">Session Type <span className="text-red-400">*</span></label>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { value: 'catch-up' as BookableSessionType, label: 'Catch-up', icon: 'ri-chat-3-line', desc: 'Quick check-in on your progress' },
                    { value: 'student-support' as BookableSessionType, label: 'Student Support', icon: 'ri-heart-2-line', desc: 'Help with challenges or wellbeing' },
                  ]).map((t) => (
                    <button key={t.value} onClick={() => setBookType(t.value)}
                      className={`p-3 rounded-xl border-2 text-left transition-all cursor-pointer ${bookType === t.value ? 'border-primary-400 bg-primary-50/40' : 'border-background-300 hover:border-background-400'}`}>
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${bookType === t.value ? 'bg-primary-100 text-primary-600' : 'bg-background-100 text-foreground-500'}`}><AppIcon className={t.icon}></AppIcon></span>
                      <p className="text-sm font-semibold text-foreground-900">{t.label}</p>
                      <p className="text-xs text-foreground-400 mt-0.5">{t.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-foreground-500 mb-1.5 block">Date <span className="text-red-400">*</span></label><input type="date" value={bookDate} min={todayISO()} onChange={(e) => setBookDate(e.target.value)} className="w-full bg-background-100 border border-background-300 rounded-lg px-3 py-2 text-sm text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all" /></div>
                <div><label className="text-xs font-semibold text-foreground-500 mb-1.5 block">Time <span className="text-red-400">*</span></label><input type="time" value={bookTime} onChange={(e) => setBookTime(e.target.value)} className="w-full bg-background-100 border border-background-300 rounded-lg px-3 py-2 text-sm text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all" /></div>
              </div>
              {calendarConnections.length > 0 ? (
                <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 ${selectedSlotConflicts ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                  <AppIcon className={`${availabilityLoading ? 'ri-loader-4-line animate-spin' : selectedSlotConflicts ? 'ri-calendar-close-line' : 'ri-calendar-check-line'} mt-0.5`} />
                  <div><p className="text-xs font-semibold">{availabilityLoading ? 'Checking your personal calendar…' : selectedSlotConflicts ? 'This time is busy' : 'This time is available'}</p><p className="mt-0.5 text-[10px] opacity-75">Checked against {calendarConnections.length} connected calendar{calendarConnections.length === 1 ? '' : 's'}.</p></div>
                </div>
              ) : (
                <button type="button" onClick={() => { setShowBookModal(false); setShowCalendarConnect(true); }} className="flex w-full items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2.5 text-left text-xs font-semibold text-primary-700"><AppIcon className="ri-calendar-2-line" />Connect your personal calendar to prevent booking conflicts</button>
              )}
              <div>
                <label className="text-xs font-semibold text-foreground-500 mb-1.5 block">Duration</label>
                <select value={bookDuration} onChange={(e) => setBookDuration(e.target.value)} className="w-full bg-background-100 border border-background-300 rounded-lg px-3 py-2 text-sm text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all cursor-pointer">
                  <option value="30">30 minutes</option>
                  <option value="45">45 minutes</option>
                  <option value="60">1 hour</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground-500 mb-1.5 block">What would you like to cover? (optional)</label>
                <textarea value={bookNotes} onChange={(e) => setBookNotes(e.target.value)} placeholder="Add anything your coach should know before the session..." maxLength={500} rows={3} className="w-full bg-background-100 border border-background-300 rounded-lg px-3 py-2 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all resize-none" />
                <span className="text-[10px] text-foreground-400 mt-0.5 block">{bookNotes.length}/500</span>
              </div>
              {bookError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 flex items-center gap-2">
                  <AppIcon className="ri-error-warning-line text-red-500"></AppIcon>
                  <p className="text-xs text-red-700">{bookError}</p>
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowBookModal(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-background-300 text-sm font-semibold text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
              <button onClick={handleBookSession} disabled={bookSubmitting || availabilityLoading || selectedSlotConflicts || !bookDate || !bookTime} className="flex-1 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed">
                {bookSubmitting ? <><AppIcon className="ri-loader-4-line animate-spin mr-1"></AppIcon>Booking...</> : <><AppIcon className="ri-calendar-check-line mr-1"></AppIcon>Book Session</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ CREATE EVENT MODAL ═══════════ */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}>
          <div className="bg-background-50 rounded-2xl p-6 max-w-lg w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5"><h3 className="text-lg font-heading font-bold text-foreground-900 flex items-center gap-2"><AppIcon className="ri-add-circle-line text-primary-500"></AppIcon>Create New Event</h3><button onClick={() => setShowCreateModal(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button></div>
            <div className="space-y-4">
              <div><label className="text-xs font-semibold text-foreground-500 mb-1.5 block">Event Title <span className="text-red-400">*</span></label><input type="text" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} placeholder="e.g. Study session, Team meeting..." className="w-full bg-background-100 border border-background-300 rounded-lg px-3 py-2 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all" maxLength={100} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-foreground-500 mb-1.5 block">Date <span className="text-red-400">*</span></label><input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} className="w-full bg-background-100 border border-background-300 rounded-lg px-3 py-2 text-sm text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all" /></div>
                <div><label className="text-xs font-semibold text-foreground-500 mb-1.5 block">Reminder</label><select value={customReminder} onChange={(e) => setCustomReminder(e.target.value)} className="w-full bg-background-100 border border-background-300 rounded-lg px-3 py-2 text-sm text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all cursor-pointer"><option value="5">5 minutes before</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-foreground-500 mb-1.5 block">Recurrence</label><select value={customRecurrence} onChange={(e) => setCustomRecurrence(e.target.value)} className="w-full bg-background-100 border border-background-300 rounded-lg px-3 py-2 text-sm text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all cursor-pointer">{RECURRENCE_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}</select></div>
                <div></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-foreground-500 mb-1.5 block">Start Time <span className="text-red-400">*</span></label><input type="time" value={customStartTime} onChange={(e) => setCustomStartTime(e.target.value)} className="w-full bg-background-100 border border-background-300 rounded-lg px-3 py-2 text-sm text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all" /></div>
                <div><label className="text-xs font-semibold text-foreground-500 mb-1.5 block">End Time <span className="text-red-400">*</span></label><input type="time" value={customEndTime} onChange={(e) => setCustomEndTime(e.target.value)} className="w-full bg-background-100 border border-background-300 rounded-lg px-3 py-2 text-sm text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all" /></div>
              </div>
              <div><label className="text-xs font-semibold text-foreground-500 mb-1.5 block">Location (optional)</label><input type="text" value={customLocation} onChange={(e) => setCustomLocation(e.target.value)} placeholder="e.g. Microsoft Teams, Library..." className="w-full bg-background-100 border border-background-300 rounded-lg px-3 py-2 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all" /></div>
              <div><label className="text-xs font-semibold text-foreground-500 mb-1.5 block">Description (optional)</label><textarea value={customDescription} onChange={(e) => setCustomDescription(e.target.value)} placeholder="Add any notes, agenda..." maxLength={500} rows={3} className="w-full bg-background-100 border border-background-300 rounded-lg px-3 py-2 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all resize-none" /><span className="text-[10px] text-foreground-400 mt-0.5 block">{customDescription.length}/500</span></div>
            </div>
            <div className="flex gap-2 mt-5"><button onClick={() => setShowCreateModal(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-background-300 text-sm font-semibold text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button><button onClick={handleCreateCustomEvent} disabled={!customTitle.trim()} className="flex-1 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"><AppIcon className="ri-calendar-check-line mr-1"></AppIcon>Create Event</button></div>
          </div>
        </div>
      )}

      {/* ═══════════ EVENT DETAILS MODAL ═══════════ */}
      {showEventDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowEventDetails(null)}>
          <div className="bg-background-50 rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusConfig[showEventDetails.status].cls}`}>{statusConfig[showEventDetails.status].label}</span><button onClick={() => setShowEventDetails(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button></div>
            <h3 className="text-lg font-heading font-bold text-foreground-900 mb-2">{showEventDetails.title}</h3>
            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 text-sm text-foreground-600"><AppIcon className="ri-calendar-line text-foreground-400"></AppIcon><span className="font-semibold">{showEventDetails.date}, {showEventDetails.dayName} &middot; {showEventDetails.time}</span></div>
              <div className="flex items-center gap-2 text-sm text-foreground-600"><AppIcon className="ri-map-pin-line text-foreground-400"></AppIcon><span>{showEventDetails.location}</span></div>
              <div className="flex items-center gap-2 text-sm text-foreground-600"><AppIcon className="ri-team-line text-foreground-400"></AppIcon><span>{showEventDetails.club}</span></div>
            </div>
            <p className="text-sm text-foreground-500 leading-relaxed mb-5">{showEventDetails.description}</p>
            <div className="flex gap-2">
              {showEventDetails.meetingLink && (
                <a href={showEventDetails.meetingLink} target="_blank" rel="noreferrer" className="flex-1 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap text-center"><AppIcon className="ri-video-chat-line mr-1"></AppIcon>Join Meeting</a>
              )}
              <button onClick={() => handleExportICS(showEventDetails)} className="flex-1 px-4 py-2.5 rounded-xl border border-background-300 text-sm font-semibold text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-download-line mr-1"></AppIcon>Export .ics</button>
              {showEventDetails.id.startsWith('custom-') && (
                <button onClick={() => handleRemoveFromCalendar(showEventDetails.id)} className="px-4 py-2.5 rounded-xl border border-red-200 text-sm font-semibold text-red-600 hover:bg-red-50 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-calendar-close-line mr-1"></AppIcon>Remove</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ SHARE CALENDAR MODAL ═══════════ */}
      {showShareCalendar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowShareCalendar(false)}>
          <div className="bg-background-50 rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5"><h3 className="text-lg font-heading font-bold text-foreground-900 flex items-center gap-2"><AppIcon className="ri-share-line text-primary-500"></AppIcon>Share Calendar</h3><button onClick={() => setShowShareCalendar(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button></div>
            <p className="text-sm text-foreground-500 mb-4 leading-relaxed">Generate a public, read-only iCal feed URL for Google Calendar, Apple Calendar, or Outlook.</p>
            {!publicFeedUrl ? (<div className="text-center py-4"><button onClick={handleGeneratePublicFeed} className="px-5 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-link-m mr-1"></AppIcon>Generate Public Feed</button></div>) : (
              <div className="space-y-3"><div className="bg-background-100 rounded-xl p-3 break-all"><p className="text-xs text-foreground-400 mb-1">Public Feed URL</p><p className="text-xs font-mono text-foreground-600">{publicFeedUrl}</p></div><div className="flex gap-2"><button onClick={handleCopyFeedUrl} className="flex-1 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className={`${feedCopied ? 'ri-check-line' : 'ri-clipboard-line'} mr-1`}></AppIcon>{feedCopied ? 'Copied!' : 'Copy Link'}</button></div></div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ CONFLICT MODAL ═══════════ */}
      {conflictEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setConflictEvent(null)}>
          <div className="bg-background-50 rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4"><span className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center"><AppIcon className="ri-alert-line text-lg"></AppIcon></span><h3 className="text-lg font-heading font-bold text-foreground-900">Event Conflict</h3></div>
            <p className="text-sm text-foreground-500 mb-4"><strong className="text-foreground-700">{conflictEvent.title}</strong> already overlaps with this time slot.</p>
            <div className="flex gap-2"><button onClick={() => setConflictEvent(null)} className="flex-1 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Got it</button></div>
          </div>
        </div>
      )}

      {/* ═══════════ NOTIFICATION SETTINGS MODAL ═══════════ */}
      {showNotificationSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowNotificationSettings(false)}>
          <div className="bg-background-50 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h3 className="text-base font-heading font-bold text-foreground-900">Notification Settings</h3><button onClick={() => setShowNotificationSettings(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button></div>
            <div className="space-y-4"><div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-foreground-800">Event Reminders</p></div><div className={`w-10 h-6 rounded-full flex items-center px-0.5 transition-smooth cursor-pointer ${notificationPermission === 'granted' ? 'bg-primary-500' : 'bg-background-200'}`} onClick={() => { if (notificationPermission !== 'granted') handleEnableNotifications(); }}><div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${notificationPermission === 'granted' ? 'translate-x-4' : 'translate-x-0'}`}></div></div></div></div>
          </div>
        </div>
      )}

      <div className="space-y-5 p-3 sm:p-4 md:space-y-6 md:p-6">

        {calendarError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-3">
            <AppIcon className="ri-error-warning-line text-red-500"></AppIcon>
            <p className="text-sm text-red-700">Could not load your coaching sessions: {calendarError}</p>
          </div>
        )}
        {calendarLoading && !calendarError && (
          <div className="rounded-xl border border-background-300 bg-background-50 px-4 py-3 flex items-center gap-3">
            <AppIcon className="ri-loader-4-line animate-spin text-primary-500"></AppIcon>
            <p className="text-sm text-foreground-500">Loading your coaching sessions&hellip;</p>
          </div>
        )}

        {/* ═══════════ HERO BANNER ═══════════ */}
        <section className="relative overflow-hidden rounded-2xl animate-in fade-in duration-300" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
          </div>
          <div className="relative flex min-h-[190px] flex-row items-center md:min-h-[160px] lg:items-stretch">
            <div className="flex min-w-0 flex-1 flex-col justify-center px-5 py-6 md:px-7 md:py-6">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="max-w-full truncate rounded-md border border-accent-400/15 bg-accent-400/10 px-2.5 py-1 font-label text-[10px] font-semibold uppercase tracking-wider text-accent-300/80 sm:text-xs">{p.programme} &middot; Level {p.programmeLevel}</span>
              </div>
              <h1 className="mb-1.5 font-heading text-xl font-bold tracking-tight text-white md:text-xl">My Calendar</h1>
              <p className="max-w-lg text-xs leading-relaxed text-white/55 sm:text-sm">Your schedule, coaching sessions, club events &mdash; all in one professional view</p>
            </div>
            <div className="flex w-[130px] shrink-0 items-center justify-center px-3 py-4 sm:w-[155px] md:px-5 md:py-5 lg:w-[380px] lg:px-7 lg:py-6">
              <div className="rounded-[22px] border border-white/10 bg-white/10 p-2 shadow-[0_24px_55px_-30px_rgba(9,4,28,0.75)] backdrop-blur-md sm:rounded-[28px] sm:p-3">
                <div className="relative w-[96px] overflow-hidden rounded-[18px] bg-white shadow-[0_12px_28px_-20px_rgba(10,10,20,0.55)] sm:w-[120px] sm:rounded-[22px] md:w-[150px] md:rounded-[24px] lg:w-[168px]">
                  <div className="bg-[#ef4444] px-3 pb-3 pt-2.5">
                    <div className="flex items-center justify-between">
                      {[0, 1, 2, 3, 4, 5].map((index) => (
                        <span key={index} className="relative flex h-5 w-2.5 items-start justify-center">
                          <span className="absolute top-0 h-3.5 w-1 rounded-full bg-slate-700" />
                          <span className="absolute top-1 h-4.5 w-2 rounded-full border border-black/15 bg-white/85 shadow-sm" />
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="px-2 pb-3 pt-2 text-center sm:px-4 sm:pb-4 sm:pt-3">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-foreground-500 sm:text-[11px] sm:tracking-[0.34em]">{todayMonthLabel}</p>
                    <p className="mt-1 font-heading text-3xl font-bold leading-none text-foreground-950 sm:mt-2 sm:text-5xl md:text-6xl">
                      {String(todayDay).padStart(2, '0')}
                    </p>
                    <p className="mt-2 text-[8px] font-semibold uppercase tracking-[0.28em] text-foreground-500 sm:mt-2.5 sm:text-[10px] sm:tracking-[0.34em]">{todayWeekdayLabel}</p>
                  </div>
                  <div className="pointer-events-none absolute bottom-0 right-0 h-14 w-14 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.94),_rgba(226,232,240,0.82)_42%,_rgba(148,163,184,0.3)_72%,_transparent_74%)] opacity-95" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════ TOP BAR: VIEW TOGGLE + NAV ═══════════ */}
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="grid w-full grid-cols-3 items-center gap-1 rounded-xl bg-background-100 p-1 sm:flex sm:w-auto">
            {([{ key: 'monthly' as ViewMode, label: 'Month', icon: 'ri-calendar-2-line' },{ key: 'weekly' as ViewMode, label: 'Week', icon: 'ri-calendar-view' },{ key: 'daily' as ViewMode, label: 'Day', icon: 'ri-calendar-line' }]).map((v) => (
              <button key={v.key} onClick={() => setViewMode(v.key)} className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold transition-smooth whitespace-nowrap cursor-pointer sm:px-4 ${viewMode === v.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}><AppIcon className={`${v.icon} text-sm`}></AppIcon>{v.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            <button onClick={handleToday} className="px-3 py-1.5 text-xs font-semibold text-primary-600 bg-primary-100 rounded-lg hover:bg-primary-200 transition-smooth cursor-pointer whitespace-nowrap">Today</button>
            <div className="flex items-center gap-1">
              <button onClick={handlePrev} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer"><AppIcon className="ri-arrow-left-s-line"></AppIcon></button>
              <span className="text-sm font-heading font-bold text-foreground-900 min-w-[130px] text-center whitespace-nowrap">{viewMode === 'daily' ? `${DAYS_OF_WEEK[new Date(viewYear, viewMonth, selectedDay).getDay() === 0 ? 6 : new Date(viewYear, viewMonth, selectedDay).getDay() - 1]}, ${selectedDay} ${MONTH_NAMES[viewMonth]} ${viewYear}` : `${MONTH_NAMES[viewMonth]} ${viewYear}`}</span>
              <button onClick={handleNext} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer"><AppIcon className="ri-arrow-right-s-line"></AppIcon></button>
            </div>
          </div>
        </div>

        {/* ═══════════ MAIN CONTENT ═══════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-6">

          {/* ── CALENDAR VIEW AREA (2/3) ── */}
          <div className="lg:col-span-2 space-y-4">

            {/* MONTHLY VIEW */}
            {viewMode === 'monthly' && (
              <div className="overflow-hidden rounded-2xl border border-background-300 bg-background-50 sm:border-2">
                {/* Day headers */}
                <div className="grid grid-cols-7 border-b-2 border-background-300">
                  {DAYS_OF_WEEK.map((day, i) => (
                    <div key={day} className={`px-1 py-3 text-center sm:px-2 ${i >= 5 ? 'bg-background-100/60' : 'bg-background-100/30'}`}>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-500 sm:text-xs sm:tracking-wider">{day}</span>
                    </div>
                  ))}
                </div>
                {/* Day cells */}
                <div className="grid grid-cols-7">
                  {monthCells.map((day, idx) => {
                    if (day === null) return <div key={`empty-${idx}`} className="aspect-square border-b border-r border-background-300 bg-background-50/40 sm:aspect-[4/3] sm:border-b-2 sm:border-r-2" />;
                    const eventsForDay = getEventsForDay(day, viewMonth);
                    const isSel = day === selectedDay && viewMode === 'monthly';
                    const isTdy = isToday(day, viewMonth, viewYear);
                    const visibleEvents = eventsForDay.slice(0, 2);
                    const extraCount = eventsForDay.length - visibleEvents.length;
                    return (
                      <button
                        key={`d-${day}`}
                        onClick={() => { setSelectedDay(day); }}
                        className={`flex aspect-square cursor-pointer flex-col border-b border-r border-background-300 p-1 text-left transition-all duration-150 hover:z-10 hover:bg-primary-50/20 sm:aspect-[4/3] sm:border-b-2 sm:border-r-2 sm:p-1.5 ${isSel ? 'ring-2 ring-primary-400 ring-inset bg-primary-50/30 z-10' : isTdy ? 'bg-primary-50/15' : 'bg-background-50'}`}
                      >
                        <span className={`mb-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold sm:mb-1 sm:h-6 sm:w-6 sm:text-xs ${isTdy ? 'bg-primary-500 text-white' : isSel ? 'bg-primary-100 text-primary-700' : 'text-foreground-500'}`}>{day}</span>
                        <div className="flex-1 w-full overflow-hidden space-y-0.5 min-w-0">
                          {visibleEvents.map((ev) => {
                            const dotColor = getEventDotColor(ev.type, ev.color);
                            if (ev.type === 'Busy') {
                              return (
                                <div key={ev.id} className="flex w-full items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 text-slate-700" title={`Busy · ${ev.time}`}>
                                  <AppIcon className="ri-lock-line shrink-0 text-[9px]" />
                                  <span className="truncate text-[10px] font-semibold leading-tight">Busy · {ev.time.split('–')[0]}</span>
                                </div>
                              );
                            }
                            return (
                              <div key={ev.id} className="flex items-center gap-1 min-w-0" title={ev.title}>
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`}></span>
                                <span className="text-[10px] text-foreground-600 truncate leading-tight font-medium">{ev.title}</span>
                              </div>
                            );
                          })}
                          {extraCount > 0 && <span className="text-[10px] text-foreground-400 font-semibold pl-2.5">+{extraCount} more</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* WEEKLY VIEW */}
            {viewMode === 'weekly' && (
              <div className="overflow-x-auto rounded-2xl border border-background-300 bg-background-50 sm:border-2">
                {/* Week day headers */}
                <div className="grid min-w-[760px] grid-cols-8 border-b-2 border-background-300">
                  <div className="px-2 py-3 bg-background-100/30"></div>
                  {weekDates.map((wd, idx) => {
                    const isTdy = isToday(wd.day, wd.month, viewYear);
                    const isSel = wd.day === selectedDay && wd.month === viewMonth;
                    return (
                      <button key={`wh-${wd.day}-${wd.month}`} onClick={() => { setSelectedDay(wd.day); setViewMonth(wd.month); }}
                        className={`px-2 py-3 text-center cursor-pointer transition-smooth ${isSel ? 'bg-primary-50/40' : 'hover:bg-background-100/50'} ${idx >= 5 ? 'bg-background-100/20' : ''}`}>
                        <span className="text-[10px] font-semibold text-foreground-400 uppercase block">{DAYS_SHORT[idx]}</span>
                        <span className={`text-sm font-bold inline-flex items-center justify-center w-7 h-7 rounded-full mt-1 ${isTdy ? 'bg-primary-500 text-white' : isSel ? 'text-primary-700' : 'text-foreground-700'}`}>{wd.day}</span>
                      </button>
                    );
                  })}
                </div>
                {/* Time grid */}
                <div className="overflow-y-auto max-h-[600px]">
                  {HOURS.map((hour) => {
                    const isCurrentHourRow = viewMode === 'weekly' && currentHour === hour;
                    return (
                      <div key={`h-${hour}`} className={`grid min-w-[760px] grid-cols-8 border-b-2 border-background-300 ${isCurrentHourRow ? 'bg-primary-50/15' : ''}`}>
                        <div className="px-3 py-3 text-right border-r-2 border-background-300">
                          <span className="text-xs font-semibold text-foreground-400">{hour.toString().padStart(2, '0')}:00</span>
                        </div>
                        {weekDates.map((wd, wdi) => {
                          const eventsInSlot = getEventsForDay(wd.day, wd.month).filter((ev) => {
                            const startHour = parseInt(ev.time.split(':')[0]);
                            return startHour === hour;
                          });
                          const isSel = wd.day === selectedDay && wd.month === viewMonth;
                          return (
                            <div key={`ws-${wd.day}-${wd.month}-${hour}`}
                              className={`min-h-[48px] p-0.5 relative cursor-pointer transition-smooth hover:bg-primary-50/15 ${isSel ? 'bg-primary-50/25' : ''} ${wdi >= 5 ? 'bg-background-100/10' : ''}`}
                              onClick={() => { setSelectedDay(wd.day); setViewMonth(wd.month); }}>
                              {eventsInSlot.map((ev) => {
                                const typeColor = getEventColorClass(ev.type, ev.color);
                                const [bg, text, border] = typeColor.split(' ');
                                return (
                                  <div key={ev.id} className={`text-[10px] font-semibold px-1.5 py-1 rounded-md mb-0.5 truncate cursor-pointer border-l-2 hover:brightness-95 transition-all ${typeColor}`}
                                    onClick={(e) => { e.stopPropagation(); setShowEventDetails(ev); }} title={`${ev.title} (${ev.time})`}>
                                    <span className="text-[9px] text-foreground-400 block truncate">{ev.time.split('\u2013')[0]}</span>
                                    {ev.title}
                                  </div>
                                );
                              })}
                              {isCurrentHourRow && eventsInSlot.length === 0 && (
                                <div className="absolute inset-0 border-l-2 border-primary-400 opacity-40 rounded-full" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* DAILY VIEW */}
            {viewMode === 'daily' && (
              <div className="bg-background-50 rounded-2xl border-2 border-background-300 overflow-hidden">
                {/* Day header */}
                <div className="px-5 py-4 border-b-2 border-background-300 flex items-center gap-4 bg-background-100/30">
                  <span className={`w-12 h-12 rounded-2xl flex items-center justify-center text-base font-bold ${isToday(selectedDay, viewMonth, viewYear) ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-700'}`}>{selectedDay}</span>
                  <div>
                    <p className="text-sm font-heading font-bold text-foreground-900">{DAYS_OF_WEEK[new Date(viewYear, viewMonth, selectedDay).getDay() === 0 ? 6 : new Date(viewYear, viewMonth, selectedDay).getDay() - 1]}, {MONTH_NAMES[viewMonth]} {selectedDay}, {viewYear}</p>
                    <p className="text-xs text-foreground-400">{selectedDayEvents.length} event{selectedDayEvents.length !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                {/* Day timeline */}
                <div className="overflow-y-auto max-h-[600px]">
                  {HOURS.map((hour) => {
                    const eventsInSlot = selectedDayEvents.filter((ev) => {
                      const startHour = parseInt(ev.time.split(':')[0]);
                      return startHour === hour;
                    });
                    const isCurrentHourRow = currentHour === hour && isToday(selectedDay, viewMonth, viewYear);
                    return (
                      <div key={`dh-${hour}`} className={`flex items-start border-b-2 border-background-300 min-h-[64px] ${isCurrentHourRow ? 'bg-primary-50/15' : ''}`}>
                        <div className="w-[72px] shrink-0 px-4 py-3 text-right border-r-2 border-background-300">
                          <span className="text-xs font-semibold text-foreground-400">{hour.toString().padStart(2, '0')}:00</span>
                        </div>
                        <div className="flex-1 py-1.5 px-3 relative min-h-[64px]">
                          {isCurrentHourRow && <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-primary-400 rounded-full" />}
                          <div className="space-y-1">
                            {eventsInSlot.map((ev) => {
                              const typeColor = getEventColorClass(ev.type, ev.color);
                              return (
                                <div key={ev.id} className={`p-3 rounded-xl cursor-pointer hover:shadow-sm hover:brightness-95 transition-all duration-200 border-l-[3px] ${typeColor}`}
                                  onClick={() => setShowEventDetails(ev)}>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-semibold text-foreground-900">{ev.title}</span>
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[ev.status].cls}`}>{statusConfig[ev.status].label}</span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground-500">
                                    <span className="flex items-center gap-1"><AppIcon className="ri-time-line text-foreground-400 text-xs"></AppIcon>{ev.time}</span>
                                    <span className="flex items-center gap-1"><AppIcon className="ri-map-pin-line text-foreground-400 text-xs"></AppIcon>{ev.location}</span>
                                    {ev.club !== 'Personal' && <span className="flex items-center gap-1"><AppIcon className="ri-team-line text-foreground-400 text-xs"></AppIcon>{ev.club}</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Selected day events list (monthly mode only) */}
            {viewMode === 'monthly' && (
              <div className="rounded-2xl border border-background-300 bg-background-50 p-4 sm:border-2 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-heading font-bold text-foreground-900 flex items-center gap-2">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${isToday(selectedDay, viewMonth, viewYear) ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-600'}`}>{selectedDay}</span>
                    {DAYS_OF_WEEK[new Date(viewYear, viewMonth, selectedDay).getDay() === 0 ? 6 : new Date(viewYear, viewMonth, selectedDay).getDay() - 1]}, {MONTH_NAMES[viewMonth]} {selectedDay}
                  </h3>
                  <button onClick={() => setShowCreateModal(true)} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-add-line mr-1"></AppIcon>New Event</button>
                </div>
                {selectedDayEvents.length === 0 ? (
                  <div className="text-center py-10">
                    <span className="w-12 h-12 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-3"><AppIcon className="ri-calendar-2-line text-foreground-300 text-lg"></AppIcon></span>
                    <p className="text-sm text-foreground-500 mb-3">No events scheduled for this day</p>
                    <button onClick={() => setShowCreateModal(true)} className="px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-add-line mr-1"></AppIcon>Create Event</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedDayEvents.map((ev) => {
                      const typeColor = getEventColorClass(ev.type, ev.color);
                      return (
                        <div key={ev.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-background-100/60 transition-smooth cursor-pointer group" onClick={() => setShowEventDetails(ev)}>
                          <span className={`w-2 h-10 rounded-full shrink-0 ${getEventDotColor(ev.type, ev.color)}`}></span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground-900 group-hover:text-primary-700 transition-colors">{ev.title}</p>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-foreground-400">
                              <span className="flex items-center gap-1"><AppIcon className="ri-time-line text-[10px]"></AppIcon>{ev.time}</span>
                              <span className="flex items-center gap-1"><AppIcon className="ri-map-pin-line text-[10px]"></AppIcon>{ev.location}</span>
                            </div>
                          </div>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${statusConfig[ev.status].cls}`}>{statusConfig[ev.status].label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── SIDEBAR (1/3) ── */}
          <div className="space-y-4">

            {/* Quick Actions */}
            <div className="rounded-2xl border border-background-300 bg-background-50 p-4 sm:border-2 sm:p-5">
              <h3 className="text-sm font-heading font-bold text-foreground-900 mb-4 flex items-center gap-2"><AppIcon className="ri-flashlight-line text-accent-500"></AppIcon>Quick Actions</h3>
              <div className="space-y-2">
                <button onClick={() => setShowBookModal(true)}
                  className="group flex w-full cursor-pointer items-center gap-3 rounded-xl bg-accent-500 px-3.5 py-3 text-white transition-all duration-200 hover:scale-[1.01] hover:bg-accent-600 active:scale-[0.99] sm:px-4">
                  <span className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-200"><AppIcon className="ri-user-star-line text-white"></AppIcon></span>
                  <div className="text-left"><p className="text-sm font-semibold">Book Coach Session</p><p className="text-xs text-white/80">{coach ? `Catch-up or support with ${coach.name}` : 'Catch-up or student support'}</p></div>
                </button>
                <button onClick={() => setShowCreateModal(true)}
                  className="group flex w-full cursor-pointer items-center gap-3 rounded-xl bg-primary-500 px-3.5 py-3 text-white transition-all duration-200 hover:scale-[1.01] hover:bg-primary-600 active:scale-[0.99] sm:px-4">
                  <span className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-200"><AppIcon className="ri-add-line text-white"></AppIcon></span>
                  <div className="text-left"><p className="text-sm font-semibold">Create Event</p><p className="text-xs text-white/80">Add a custom personal event</p></div>
                </button>
                <button onClick={() => { setConnectionError(null); setShowCalendarConnect(true); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-background-300 hover:bg-background-100 transition-smooth cursor-pointer">
                  <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${calendarConnections.length ? 'bg-emerald-100 text-emerald-600' : 'bg-primary-100 text-primary-600'}`}><AppIcon className={calendarConnections.length ? 'ri-calendar-check-line' : 'ri-calendar-2-line'}></AppIcon></span>
                  <div className="min-w-0 text-left"><p className="text-sm font-semibold text-foreground-900">Connect Your Personal Calendar</p><p className="truncate text-xs text-foreground-400">{calendarConnections.length ? `${calendarConnections.length} calendar${calendarConnections.length === 1 ? '' : 's'} connected` : 'Connect Google, Microsoft, Apple or ICS'}</p></div>
                </button>
                <button onClick={() => setShowShareCalendar(true)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-background-300 hover:bg-background-100 transition-smooth cursor-pointer">
                  <span className="w-9 h-9 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center"><AppIcon className="ri-share-line"></AppIcon></span>
                  <div className="text-left"><p className="text-sm font-semibold text-foreground-900">Share Calendar</p><p className="text-xs text-foreground-400">Generate iCal feed link</p></div>
                </button>
                <button onClick={() => setShowNotificationSettings(true)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-background-300 hover:bg-background-100 transition-smooth cursor-pointer">
                  <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${notificationPermission === 'granted' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}><AppIcon className="ri-notification-3-line"></AppIcon></span>
                  <div className="text-left"><p className="text-sm font-semibold text-foreground-900">Notifications</p><p className="text-xs text-foreground-400">{notificationPermission === 'granted' ? 'Reminders enabled' : 'Set up reminders'}</p></div>
                </button>
                <button onClick={handleExportAllICS}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-background-300 hover:bg-background-100 transition-smooth cursor-pointer">
                  <span className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center"><AppIcon className="ri-google-line"></AppIcon></span>
                  <div className="text-left"><p className="text-sm font-semibold text-foreground-900">Export All Events</p><p className="text-xs text-foreground-400">Download .ics file</p></div>
                </button>
              </div>
            </div>

            {/* Upcoming Events */}
            <div className="rounded-2xl border border-background-300 bg-background-50 p-4 sm:border-2 sm:p-5">
              <h3 className="text-sm font-heading font-bold text-foreground-900 mb-4 flex items-center gap-2"><AppIcon className="ri-calendar-todo-line text-primary-500"></AppIcon>Upcoming</h3>
              <div className="space-y-2">
                {myEvents.filter((ev) => {
                  const evDate = parseEventDate(ev);
                  if (!evDate) return false;
                  const evDate2 = new Date(evDate.year ?? viewYear, evDate.month, evDate.day);
                  const todayDate = new Date(viewYear, viewMonth, selectedDay);
                  return evDate2 >= todayDate;
                }).slice(0, 5).map((ev) => (
                  <div key={ev.id} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-background-100 transition-smooth cursor-pointer group" onClick={() => setShowEventDetails(ev)}>
                    <div className="w-11 shrink-0 rounded-lg px-2 py-2 text-center bg-background-100">
                      <p className="text-[10px] font-bold text-foreground-500 leading-tight">{ev.date.split(' ')[0]}</p>
                      <p className="text-[9px] font-semibold text-foreground-400 leading-tight">{ev.date.split(' ')[1]}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground-900 group-hover:text-primary-700 transition-colors leading-tight truncate">{ev.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-foreground-400">{ev.time}</span>
                        <span className={`w-1.5 h-1.5 rounded-full ${getEventDotColor(ev.type, ev.color)}`}></span>
                      </div>
                    </div>
                  </div>
                ))}
                {myEvents.filter((ev) => {
                  const evDate = parseEventDate(ev);
                  if (!evDate) return false;
                  const evDate2 = new Date(evDate.year ?? viewYear, evDate.month, evDate.day);
                  const todayDate = new Date(viewYear, viewMonth, selectedDay);
                  return evDate2 >= todayDate;
                }).length === 0 && (
                  <div className="text-center py-6">
                    <span className="w-10 h-10 rounded-xl bg-background-100 flex items-center justify-center mx-auto mb-2"><AppIcon className="ri-calendar-2-line text-foreground-300"></AppIcon></span>
                    <p className="text-xs text-foreground-400">No upcoming events</p>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
