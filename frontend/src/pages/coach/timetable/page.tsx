import { useState, useMemo, useCallback, useEffect } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;
const API_ENDPOINT = '/coach_api/coach/timetable';
const SCHEDULE_ENDPOINT = '/coach_api/coach/timetable/events/schedule';
const ACTION_ENDPOINT = '/coach_api/coach/timetable/events/action';

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Types
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
interface TimetableEvent {
  id: string;
  eventKey?: string;
  title: string;
  type: 'coaching' | 'live-session' | 'review' | 'employer-meeting' | 'welfare' | 'admin' | 'personal';
  date?: string;
  year: number;
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  dayOfMonth: number;
  month: number;
  startHour: number;
  endHour: number;
  timeLabel?: string;
  isTimeEstimated?: boolean;
  learner?: string;
  email?: string;
  employer?: string;
  managerEmail?: string;
  programme?: string;
  tutor?: string;
  location?: string;
  platform?: string;
  priority: 'normal' | 'urgent' | 'high';
  status: 'completed' | 'scheduled' | 'in-progress' | 'confirmed' | 'pending' | 'cancelled' | 'not-scheduled';
  source?: 'mcr' | 'progress-review' | string;
  sourceStatus?: string;
  sequence?: number;
  rawPlanned?: string;
  rawStatus?: string;
  notes?: string;
  cohort?: string;
  learnerId?: string;
  ownerEmail?: string;
  ownerName?: string;
  targetDate?: string;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  durationMinutes?: number;
  meetingProvider?: string;
  meetingLink?: string;
  graphWebLink?: string;
  syncWarning?: string;
}

interface TimetableSummaryMetrics {
  totalEvents: number;
  completedEvents: number;
  scheduledEvents: number;
  inProgressEvents: number;
  needsScheduling: number;
  completionRate: number;
  coachingEvents: number;
  reviewEvents: number;
  supportEvents: number;
}

interface TimetableSummary extends TimetableSummaryMetrics {
  timeAvailability?: string;
  sourceBreakdown?: {
    mcr: TimetableSummaryMetrics;
    progressReview: TimetableSummaryMetrics;
  };
}

interface TimetableResponse {
  owner?: {
    name?: string;
    email?: string;
  };
  summary?: TimetableSummary;
  events?: TimetableEvent[];
}

const EMPTY_SUMMARY_METRICS: TimetableSummaryMetrics = {
  totalEvents: 0,
  completedEvents: 0,
  scheduledEvents: 0,
  inProgressEvents: 0,
  needsScheduling: 0,
  completionRate: 0,
  coachingEvents: 0,
  reviewEvents: 0,
  supportEvents: 0,
};

const EMPTY_SUMMARY: TimetableSummary = {
  ...EMPTY_SUMMARY_METRICS,
  sourceBreakdown: {
    mcr: { ...EMPTY_SUMMARY_METRICS },
    progressReview: { ...EMPTY_SUMMARY_METRICS },
  },
};

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Data â€” June 2026 (spans 4 weeks)
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 07:00 â€“ 20:00

function typeConfig(type: TimetableEvent['type']) {
  const map: Record<TimetableEvent['type'], { label: string; bg: string; border: string; text: string; icon: string; dot: string; barBg: string }> = {
    coaching: { label: 'Coaching', bg: 'bg-primary-100', border: 'border-primary-300', text: 'text-primary-800', icon: 'ri-chat-smile-2-line', dot: 'bg-primary-500', barBg: 'bg-primary-500' },
    'live-session': { label: 'Live Session', bg: 'bg-accent-100', border: 'border-accent-300', text: 'text-accent-800', icon: 'ri-video-line', dot: 'bg-accent-500', barBg: 'bg-accent-500' },
    review: { label: 'Review', bg: 'bg-secondary-100', border: 'border-secondary-300', text: 'text-secondary-800', icon: 'ri-file-chart-line', dot: 'bg-secondary-500', barBg: 'bg-secondary-500' },
    'employer-meeting': { label: 'Employer', bg: 'bg-amber-100', border: 'border-amber-300', text: 'text-amber-800', icon: 'ri-building-2-line', dot: 'bg-amber-500', barBg: 'bg-amber-500' },
    welfare: { label: 'Welfare', bg: 'bg-red-100', border: 'border-red-300', text: 'text-red-800', icon: 'ri-heart-pulse-line', dot: 'bg-red-500', barBg: 'bg-red-500' },
    admin: { label: 'Admin', bg: 'bg-background-100', border: 'border-background-300', text: 'text-foreground-700', icon: 'ri-settings-3-line', dot: 'bg-foreground-400', barBg: 'bg-foreground-400' },
    personal: { label: 'Personal', bg: 'bg-emerald-100', border: 'border-emerald-300', text: 'text-emerald-800', icon: 'ri-user-line', dot: 'bg-emerald-500', barBg: 'bg-emerald-500' },
  };
  return map[type];
}

function eventConfig(event: TimetableEvent) {
  const base = typeConfig(event.type);
  const statusThemeMap: Partial<Record<TimetableEvent['status'], Pick<ReturnType<typeof typeConfig>, 'bg' | 'border' | 'text' | 'dot' | 'barBg'>>> = {
    completed: {
      bg: 'bg-emerald-50',
      border: 'border-emerald-300',
      text: 'text-emerald-800',
      dot: 'bg-emerald-500',
      barBg: 'bg-emerald-500',
    },
    confirmed: {
      bg: 'bg-emerald-50',
      border: 'border-emerald-300',
      text: 'text-emerald-800',
      dot: 'bg-emerald-500',
      barBg: 'bg-emerald-500',
    },
    scheduled: {
      bg: 'bg-amber-50',
      border: 'border-amber-300',
      text: 'text-amber-800',
      dot: 'bg-amber-500',
      barBg: 'bg-amber-500',
    },
    pending: {
      bg: 'bg-amber-50',
      border: 'border-amber-300',
      text: 'text-amber-800',
      dot: 'bg-amber-500',
      barBg: 'bg-amber-500',
    },
    'not-scheduled': {
      bg: 'bg-amber-50',
      border: 'border-amber-300',
      text: 'text-amber-800',
      dot: 'bg-amber-500',
      barBg: 'bg-amber-500',
    },
    'in-progress': {
      bg: 'bg-secondary-50',
      border: 'border-secondary-300',
      text: 'text-secondary-800',
      dot: 'bg-secondary-500',
      barBg: 'bg-secondary-500',
    },
    cancelled: {
      bg: 'bg-red-50',
      border: 'border-red-300',
      text: 'text-red-800',
      dot: 'bg-red-500',
      barBg: 'bg-red-500',
    },
  };

  const statusTheme = statusThemeMap[event.status];
  if (statusTheme) {
    return {
      ...base,
      ...statusTheme,
    };
  }
  return base;
}

function priorityBadge(p: TimetableEvent['priority']) {
  if (p === 'urgent') return 'bg-red-100 text-red-700 border-red-200';
  if (p === 'high') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-background-100 text-foreground-500 border-background-200';
}

function formatTime(h: number) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function parseEventDate(event: Pick<TimetableEvent, 'date' | 'year' | 'month' | 'dayOfMonth'>) {
  if (event.date) {
    const parsed = new Date(event.date);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(event.year, event.month, event.dayOfMonth);
}

function formatEventDateLabel(event: TimetableEvent) {
  return `${DAYS_OF_WEEK[event.dayOfWeek]}, ${event.dayOfMonth} ${MONTH_NAMES[event.month]}`;
}

function getPreferredDisplayDate(events: TimetableEvent[], now: Date) {
  if (!events.length) return now;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sortedEvents = [...events].sort((a, b) => parseEventDate(a).getTime() - parseEventDate(b).getTime());
  const upcomingEvent = sortedEvents.find(event => parseEventDate(event).getTime() >= today.getTime());
  return parseEventDate(upcomingEvent || sortedEvents[sortedEvents.length - 1]);
}

function statusBadge(status: TimetableEvent['status']) {
  if (status === 'completed' || status === 'confirmed') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'scheduled' || status === 'pending' || status === 'not-scheduled') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'in-progress') return 'bg-primary-50 text-primary-700 border-primary-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

function statusLabel(status: TimetableEvent['status']) {
  if (status === 'completed') return 'Completed';
  if (status === 'scheduled') return 'Scheduled';
  if (status === 'not-scheduled') return 'Not Scheduled';
  if (status === 'in-progress') return 'In Progress';
  if (status === 'confirmed') return 'Confirmed';
  if (status === 'pending') return 'Pending';
  return 'Cancelled';
}

function buildSummaryMetrics(events: TimetableEvent[]): TimetableSummaryMetrics {
  const totalEvents = events.length;
  const completedEvents = events.filter(event => event.status === 'completed' || event.status === 'confirmed').length;
  const scheduledEvents = events.filter(event => event.status === 'scheduled').length;
  const inProgressEvents = events.filter(event => event.status === 'in-progress').length;
  const needsScheduling = events.filter(event => event.status === 'pending' || event.status === 'not-scheduled').length;

  return {
    totalEvents,
    completedEvents,
    scheduledEvents,
    inProgressEvents,
    needsScheduling,
    completionRate: totalEvents > 0 ? Math.round((completedEvents / totalEvents) * 100) : 0,
    coachingEvents: events.filter(event => event.type === 'coaching').length,
    reviewEvents: events.filter(event => event.type === 'review').length,
    supportEvents: events.filter(event => event.type === 'welfare').length,
  };
}

function buildFallbackSummary(events: TimetableEvent[]): TimetableSummary {
  return {
    ...buildSummaryMetrics(events),
    sourceBreakdown: {
      mcr: buildSummaryMetrics(events.filter(event => event.source === 'mcr')),
      progressReview: buildSummaryMetrics(events.filter(event => event.source === 'progress-review')),
    },
  };
}

function normalizeSummary(summary: TimetableSummary, events: TimetableEvent[]): TimetableSummary {
  if (summary.sourceBreakdown) return summary;
  return {
    ...summary,
    sourceBreakdown: buildFallbackSummary(events).sourceBreakdown,
  };
}

type HeroMetricTone = 'emerald' | 'amber' | 'secondary' | 'accent' | 'red' | 'white';
type HeroMetricItem = { label: string; value: number; tone: HeroMetricTone };

const HERO_METRIC_TONES: Record<HeroMetricTone, string> = {
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
  secondary: 'text-secondary-300',
  accent: 'text-accent-300',
  red: 'text-red-300',
  white: 'text-white',
};

function HeroMetric({ label, value, tone }: { label: string; value: number; tone: HeroMetricTone }) {
  return (
    <div className="min-w-0 rounded-lg bg-white/8 px-3 py-2 text-center backdrop-blur-sm">
      <p className={`font-heading text-lg font-bold leading-none ${HERO_METRIC_TONES[tone]}`}>{value}</p>
      <p className="mt-1 truncate text-[10px] font-medium leading-tight text-white/55">{label}</p>
    </div>
  );
}

function HeroSourcePanel({ title, summary, typeMetrics }: { title: string; summary: TimetableSummaryMetrics; typeMetrics: HeroMetricItem[] }) {
  const statusMetrics: HeroMetricItem[] = [
    { label: 'Completed', value: summary.completedEvents, tone: 'emerald' },
    { label: 'Scheduled', value: summary.scheduledEvents, tone: 'amber' },
    { label: 'In Progress', value: summary.inProgressEvents, tone: 'secondary' },
    { label: 'Needs Plan', value: summary.needsScheduling, tone: 'amber' },
  ];

  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-white/55">{title}</p>
        <p className="shrink-0 font-heading text-sm font-bold text-white">
          {summary.totalEvents}<span className="ml-1 text-[10px] font-normal text-white/35">events</span>
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[...statusMetrics, ...typeMetrics].map(metric => (
          <HeroMetric key={`${title}-${metric.label}`} {...metric} />
        ))}
      </div>
    </div>
  );
}

/* â”€â”€â”€ Month calendar helpers â”€â”€â”€ */
function getMonthData(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  const mondayOffset = startDow === 0 ? 6 : startDow - 1;
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
  const week: { day: number; month: number; year: number; monthName: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    week.push({ day: d.getDate(), month: d.getMonth(), year: d.getFullYear(), monthName: MONTH_NAMES[d.getMonth()] });
  }
  return week;
}

/* â”€â”€â”€ Donut Ring â”€â”€â”€ */
function DonutRing({ pct, size = 64, stroke = 6, color, trackClass = 'text-white/10' }: { pct: number; size?: number; stroke?: number; color: string; trackClass?: string }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const colorMap: Record<string, string> = { primary: 'stroke-primary-400', accent: 'stroke-accent-400', emerald: 'stroke-emerald-400', amber: 'stroke-amber-400', red: 'stroke-red-400' };
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={trackClass} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={`${colorMap[color] || colorMap.primary} transition-all duration-700 ease-out`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} />
    </svg>
  );
}

type ViewMode = 'month' | 'week' | 'day';

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Page
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export default function CoachTimetablePage() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState(now.getDate());
  const [selectedEvent, setSelectedEvent] = useState<TimetableEvent | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [events, setEvents] = useState<TimetableEvent[]>([]);
  const [summary, setSummary] = useState<TimetableSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduleDuration, setScheduleDuration] = useState(60);
  const [eventActionBusy, setEventActionBusy] = useState(false);
  const [eventActionError, setEventActionError] = useState<string | null>(null);
  const [eventActionNotice, setEventActionNotice] = useState<string | null>(null);

  const todayDay = now.getDate();
  const todayMonth = now.getMonth();
  const todayYear = now.getFullYear();
  const currentHour = now.getHours();

  const isToday = useCallback((day: number, month: number, year: number) => {
    return day === todayDay && month === todayMonth && year === todayYear;
  }, [todayDay, todayMonth, todayYear]);

  const applyEventsUpdate = useCallback((nextEvents: TimetableEvent[], nextSelectedEventId?: string | null) => {
    setEvents(nextEvents);
    setSummary(buildFallbackSummary(nextEvents));
    if (nextSelectedEventId) {
      const nextSelectedEvent = nextEvents.find(event => event.id === nextSelectedEventId) || null;
      setSelectedEvent(nextSelectedEvent);
      return nextSelectedEvent;
    }
    return null;
  }, []);

  const updateSingleEvent = useCallback((updatedEvent: TimetableEvent) => {
    const nextEvents = events.map(event => event.id === updatedEvent.id ? updatedEvent : event);
    const nextSelectedEvent = applyEventsUpdate(nextEvents, updatedEvent.id);
    return nextSelectedEvent || updatedEvent;
  }, [applyEventsUpdate, events]);

  const loadTimetable = useCallback(async () => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(API_ENDPOINT);
        if (!response.ok) throw new Error(`Request failed with ${response.status}`);

        const data: TimetableResponse = await response.json();
        if (cancelled) return;

        const nextEvents = data.events || [];
        const nextSummary = data.summary ? normalizeSummary(data.summary, nextEvents) : buildFallbackSummary(nextEvents);
        const anchorDate = getPreferredDisplayDate(nextEvents, new Date());

        setEvents(nextEvents);
        setSummary(nextSummary);
        setViewYear(anchorDate.getFullYear());
        setViewMonth(anchorDate.getMonth());
        setSelectedDay(anchorDate.getDate());
        setSelectedEvent(null);
      } catch (err) {
        if (cancelled) return;

        setError(err instanceof Error ? err.message : 'Unable to load timetable data');
        setEvents([]);
        setSummary(EMPTY_SUMMARY);
        setSelectedEvent(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    await run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    loadTimetable().then(result => {
      cleanup = result;
    });
    return () => {
      if (cleanup) cleanup();
    };
  }, [loadTimetable]);

  useEffect(() => {
    if (!selectedEvent) {
      setScheduleDate('');
      setScheduleTime('09:00');
      setScheduleDuration(60);
      setEventActionError(null);
      setEventActionNotice(null);
      return;
    }

    setScheduleDate(selectedEvent.scheduledDate || selectedEvent.targetDate || selectedEvent.date || '');
    setScheduleTime(selectedEvent.scheduledTime || '09:00');
    setScheduleDuration(selectedEvent.durationMinutes || 60);
    setEventActionError(null);
    setEventActionNotice(selectedEvent.syncWarning || null);
  }, [selectedEvent]);

  const getEventsForDay = useCallback((day: number, month: number, year: number): TimetableEvent[] => {
    return events.filter(ev => ev.dayOfMonth === day && ev.month === month && ev.year === year);
  }, [events]);

  const filteredEvents = events.filter(e => {
    if (filterType !== 'all' && e.type !== filterType) return false;
    if (searchTerm && !(
      e.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.learner?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.employer?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.tutor?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.programme?.toLowerCase().includes(searchTerm.toLowerCase())
    )) return false;
    return true;
  });

  const monthCells = useMemo(() => getMonthData(viewYear, viewMonth), [viewYear, viewMonth]);
  const weekDates = useMemo(() => getWeekDates(viewYear, viewMonth, selectedDay), [viewYear, viewMonth, selectedDay]);
  const selectedDayEvents = useMemo(() => getEventsForDay(selectedDay, viewMonth, viewYear), [selectedDay, viewMonth, viewYear, getEventsForDay]);

  const totalEvents = summary.totalEvents;
  const completionRate = summary.completionRate;
  const mcrSummary = summary.sourceBreakdown?.mcr || EMPTY_SUMMARY_METRICS;
  const progressReviewSummary = summary.sourceBreakdown?.progressReview || EMPTY_SUMMARY_METRICS;

  const handlePrev = () => {
    if (viewMode === 'month') { if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); } else setViewMonth(viewMonth - 1); }
    else if (viewMode === 'day') { const d = new Date(viewYear, viewMonth, selectedDay); d.setDate(d.getDate() - 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setSelectedDay(d.getDate()); }
    else { const d = new Date(viewYear, viewMonth, selectedDay); d.setDate(d.getDate() - 7); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setSelectedDay(d.getDate()); }
  };
  const handleNext = () => {
    if (viewMode === 'month') { if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); } else setViewMonth(viewMonth + 1); }
    else if (viewMode === 'day') { const d = new Date(viewYear, viewMonth, selectedDay); d.setDate(d.getDate() + 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setSelectedDay(d.getDate()); }
    else { const d = new Date(viewYear, viewMonth, selectedDay); d.setDate(d.getDate() + 7); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setSelectedDay(d.getDate()); }
  };
  const handleToday = () => { setViewYear(todayYear); setViewMonth(todayMonth); setSelectedDay(todayDay); };

  const handleDayClick = (day: number) => {
    setSelectedDay(day);
    if (viewMode === 'month') setViewMode('day');
  };

  const handleScheduleSave = useCallback(async () => {
    if (!selectedEvent?.eventKey || !selectedEvent.ownerEmail) return;

    setEventActionBusy(true);
    setEventActionError(null);
    setEventActionNotice(null);
    try {
      const response = await fetch(SCHEDULE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventKey: selectedEvent.eventKey,
          ownerEmail: selectedEvent.ownerEmail,
          scheduledDate: scheduleDate,
          scheduledTime: scheduleTime,
          durationMinutes: scheduleDuration,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Request failed with ${response.status}`);
      const updatedEvent = data.event as TimetableEvent;
      updateSingleEvent(updatedEvent);
      if (data.warning) setEventActionNotice(data.warning as string);
    } catch (err) {
      setEventActionError(err instanceof Error ? err.message : 'Unable to schedule event');
    } finally {
      setEventActionBusy(false);
    }
  }, [scheduleDate, scheduleDuration, scheduleTime, selectedEvent, updateSingleEvent]);

  const handleEventAction = useCallback(async (action: 'start' | 'complete' | 'cancel') => {
    if (!selectedEvent?.eventKey || !selectedEvent.ownerEmail) return;

    setEventActionBusy(true);
    setEventActionError(null);
    setEventActionNotice(null);
    try {
      const response = await fetch(ACTION_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventKey: selectedEvent.eventKey,
          ownerEmail: selectedEvent.ownerEmail,
          action,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Request failed with ${response.status}`);
      const updatedEvent = data.event as TimetableEvent;
      const nextSelectedEvent = updateSingleEvent(updatedEvent);
      if (data.warning) setEventActionNotice(data.warning as string);
      if (action === 'start' && (nextSelectedEvent.meetingLink || nextSelectedEvent.graphWebLink)) {
        window.open(nextSelectedEvent.meetingLink || nextSelectedEvent.graphWebLink, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setEventActionError(err instanceof Error ? err.message : 'Unable to update event');
    } finally {
      setEventActionBusy(false);
    }
  }, [selectedEvent, updateSingleEvent]);

  const titleLabel = viewMode === 'month'
    ? `${MONTH_NAMES[viewMonth]} ${viewYear}`
    : viewMode === 'week'
      ? `${weekDates[0].monthName} ${weekDates[0].day} - ${weekDates[6].monthName} ${weekDates[6].day}, ${viewYear}`
      : `${selectedDay} ${MONTH_NAMES[viewMonth]} ${viewYear}`;

  return (
    <WorkspaceShell
      role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Calendar" pageSubtitle="Your coaching schedule, sessions, and meetings - all in one place"
      userName="Med Maher" userRole="Progress Coach"
    >
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">

        {/* â•â•â•â•â•â•â•â•â•â•â• HERO BANNER â•â•â•â•â•â•â•â•â•â•â• */}
        <section className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute opacity-20" style={{ width: '50%', height: '40%', left: '-5%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute opacity-15" style={{ width: '60%', height: '30%', right: '-10%', top: '20%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
          </div>
          <div className="relative flex flex-col xl:flex-row items-stretch min-h-[150px]">
            <div className="flex-1 px-5 md:px-7 py-5 md:py-6 flex flex-col justify-center min-w-0">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="text-xs font-semibold text-accent-300/80 uppercase tracking-wider bg-accent-400/10 px-2.5 py-1 rounded-md font-label border border-accent-400/15">Progress Coach</span>
                <span className="text-xs font-medium text-white/40">{MONTH_NAMES[viewMonth]} {viewYear}</span>
              </div>
              <h1 className="text-lg md:text-xl font-heading font-bold text-white tracking-tight mb-1">My Calendar</h1>
              <p className="text-sm text-white/40 max-w-lg">Manage your coaching sessions, live classes, reviews, and employer meetings</p>
            </div>
            <div className="xl:w-[860px] shrink-0 px-5 md:px-7 py-5 md:py-6 border-t xl:border-t-0 xl:border-l border-accent-400/10 flex items-center">
              <div className="flex w-full flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:gap-5">
                <div className="flex items-center gap-3 shrink-0">
                  <div className="relative">
                    <DonutRing pct={completionRate} size={68} stroke={6} color="emerald" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-lg font-heading font-bold text-white leading-none">{completionRate}%</span></div>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-white/40 mb-0.5">Completion</p>
                    <p className="text-base font-heading font-bold text-white leading-tight">{totalEvents}<span className="text-white/30 text-sm font-normal"> events</span></p>
                  </div>
                </div>
                <div className="hidden h-28 w-px shrink-0 bg-accent-400/10 2xl:block" />
                <div className="grid w-full flex-1 grid-cols-1 gap-3 md:grid-cols-2">
                  <HeroSourcePanel
                    title="MCR"
                    summary={mcrSummary}
                    typeMetrics={[{ label: 'Coaching', value: mcrSummary.coachingEvents, tone: 'accent' }]}
                  />
                  <HeroSourcePanel
                    title="Progress Reviews"
                    summary={progressReviewSummary}
                    typeMetrics={[
                      { label: 'Reviews', value: progressReviewSummary.reviewEvents, tone: 'secondary' },
                      { label: 'Support', value: progressReviewSummary.supportEvents, tone: 'red' },
                    ]}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* â•â•â•â•â•â•â•â•â•â•â• CONTROLS BAR â•â•â•â•â•â•â•â•â•â•â• */}
        {loading && (
          <div className="rounded-xl border border-primary-200/60 bg-primary-50 px-4 py-3 text-sm text-primary-700">
            Loading timetable data...
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200/70 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {([
              { key: 'month' as ViewMode, label: 'Month', icon: 'ri-calendar-2-line' },
              { key: 'week' as ViewMode, label: 'Week', icon: 'ri-calendar-view' },
              { key: 'day' as ViewMode, label: 'Day', icon: 'ri-calendar-line' },
            ]).map(v => (
              <button
                key={v.key}
                onClick={() => { setViewMode(v.key); if (v.key === 'month') setSelectedDay(todayDay); }}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${viewMode === v.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}
              >
                <i className={`${v.icon} text-xs`}></i>{v.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrev} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer"><i className="ri-arrow-left-s-line"></i></button>
            <button onClick={handleToday} className="px-3 py-1.5 text-[11px] font-semibold text-primary-600 bg-primary-100 rounded-lg hover:bg-primary-200 transition-smooth cursor-pointer whitespace-nowrap">Today</button>
            <span className="text-sm font-heading font-bold text-foreground-900 min-w-[150px] text-center whitespace-nowrap">{titleLabel}</span>
            <button onClick={handleNext} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer"><i className="ri-arrow-right-s-line"></i></button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <i className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-400 text-xs"></i>
              <input
                type="text" placeholder="Search..." value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-xs text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300 w-32 sm:w-44 transition-all"
              />
            </div>
            <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
              {(['all', 'coaching', 'live-session', 'review', 'employer-meeting', 'welfare'] as const).map(type => {
                const isAll = type === 'all';
                const label = isAll ? 'All' : typeConfig(type).label;
                const dot = isAll ? 'bg-foreground-400' : typeConfig(type).dot;
                const isActive = filterType === type;
                return (
                  <button
                    key={type}
                    onClick={() => setFilterType(isActive ? 'all' : type)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-1 ${isActive ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${dot}`}></span>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* â•â•â•â•â•â•â•â•â•â•â• MAIN CONTENT â•â•â•â•â•â•â•â•â•â•â• */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* â”€â”€ Calendar Area (2/3) â”€â”€ */}
          <div className="lg:col-span-2 space-y-4">

            {/* MONTH VIEW */}
            {viewMode === 'month' && (
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="grid grid-cols-7 border-b border-foreground-200/60">
                  {DAYS_OF_WEEK.map(d => (
                    <div key={d} className="px-2 py-3 text-center bg-background-100/50">
                      <span className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wide">{d}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {monthCells.map((day, idx) => {
                    if (day === null) return <div key={`empty-${idx}`} className="aspect-[4/3] bg-background-50/30 border-b border-r border-background-100/50" />;
                    const eventsForDay = filteredEvents.filter(e => e.dayOfMonth === day && e.month === viewMonth && e.year === viewYear);
                    const isSel = day === selectedDay;
                    const isTdy = isToday(day, viewMonth, viewYear);
                    return (
                      <button
                        key={`d-${day}`}
                        onClick={() => handleDayClick(day)}
                        className={`aspect-[4/3] border-b border-r border-background-100/50 p-1.5 flex flex-col items-start cursor-pointer transition-all duration-200 ease-out hover:bg-background-50 hover:shadow-sm hover:z-10 text-left ${isSel ? 'ring-2 ring-primary-400 ring-inset bg-primary-50/40 z-10 rounded-lg shadow-sm' : ''}`}
                      >
                        <span className={`text-xs font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full transition-all duration-200 ${isTdy ? 'bg-primary-500 text-white' : isSel ? 'bg-primary-100 text-primary-700' : 'text-foreground-600'}`}>
                          {day}
                        </span>
                        <div className="flex-1 w-full overflow-hidden space-y-0.5">
                          {eventsForDay.slice(0, 3).map(ev => {
                            const tc = eventConfig(ev);
                            return (
                              <div
                                key={ev.id}
                                onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev); }}
                                className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-sm border-l-2 truncate leading-tight transition-all duration-150 hover:brightness-95 cursor-pointer ${tc.bg} ${tc.border} ${tc.text}`}
                                title={ev.title}
                              >
                                {formatTime(ev.startHour)} {ev.title}
                              </div>
                            );
                          })}
                          {eventsForDay.length > 3 && (
                            <span className="text-[9px] text-foreground-400 font-semibold pl-1">+{eventsForDay.length - 3} more</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* WEEK VIEW */}
            {viewMode === 'week' && (
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="grid grid-cols-8 border-b border-foreground-200/60">
                  <div className="px-2 py-2.5 bg-background-100/50"></div>
                  {weekDates.map(wd => {
                    const isTdy = isToday(wd.day, wd.month, wd.year);
                    const isSel = wd.day === selectedDay && wd.month === viewMonth && wd.year === viewYear;
                    const weekdayIdx = new Date(wd.year, wd.month, wd.day).getDay();
                    const mappedDow = weekdayIdx === 0 ? 6 : weekdayIdx - 1;
                    return (
                      <button
                        key={`wh-${wd.day}-${wd.month}`}
                        onClick={() => { setSelectedDay(wd.day); setViewMonth(wd.month); setViewYear(wd.year); }}
                        className={`px-2 py-2.5 text-center cursor-pointer transition-smooth ${isSel ? 'bg-primary-50/60' : 'hover:bg-background-100/50'}`}
                      >
                        <span className="text-xs font-semibold text-foreground-400 block">{DAYS_OF_WEEK[mappedDow]}</span>
                        <span className={`text-sm font-bold inline-flex items-center justify-center w-7 h-7 rounded-full mt-0.5 ${isTdy ? 'bg-primary-500 text-white' : isSel ? 'text-primary-700' : 'text-foreground-700'}`}>
                          {wd.day}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="overflow-y-auto max-h-[600px]">
                  {HOURS.map(hour => {
                    const isCurrentRow = currentHour === hour && weekDates.some(wd => isToday(wd.day, wd.month, wd.year));
                    return (
                      <div key={`h-${hour}`} className={`grid grid-cols-8 border-b border-background-100/50 min-h-[56px] ${isCurrentRow ? 'bg-primary-50/20' : ''}`}>
                        <div className="px-3 py-2 text-right border-r border-background-100/50">
                          <span className="text-[11px] font-semibold text-foreground-400">{hour.toString().padStart(2, '0')}:00</span>
                        </div>
                        {weekDates.map(wd => {
                          const eventsInSlot = getEventsForDay(wd.day, wd.month, wd.year).filter(ev => {
                            const startH = ev.startHour;
                            return startH >= hour && startH < hour + 1;
                          });
                          const isSel = wd.day === selectedDay && wd.month === viewMonth && wd.year === viewYear;
                          return (
                            <div
                              key={`ws-${wd.day}-${wd.month}-${hour}`}
                              className={`p-1 border-r border-background-100/50 cursor-pointer transition-smooth hover:bg-primary-50/15 ${isSel ? 'bg-primary-50/30' : ''}`}
                              onClick={() => { setSelectedDay(wd.day); setViewMonth(wd.month); setViewYear(wd.year); }}
                            >
                              {eventsInSlot.map(ev => {
                                const tc = eventConfig(ev);
                                const duration = ev.endHour - ev.startHour;
                                const heightPx = Math.max(24, duration * 48);
                                return (
                                  <div
                                    key={ev.id}
                                    onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev); }}
                                    className={`${tc.bg} ${tc.border} border rounded-md px-1.5 py-1 mb-0.5 cursor-pointer transition-all duration-150 hover:brightness-95`}
                                    style={{ minHeight: `${heightPx}px` }}
                                  >
                                    <p className={`text-[9px] font-semibold leading-tight truncate ${tc.text}`}>{ev.title}</p>
                                    <p className="text-[8px] text-foreground-400 truncate">{formatTime(ev.startHour)} - {formatTime(ev.endHour)}</p>
                                    {ev.learner && <p className="text-[8px] text-foreground-400 truncate font-medium">{ev.learner}</p>}
                                    {ev.priority !== 'normal' && (
                                      <span className={`text-[7px] px-1 py-0.5 rounded-full border font-semibold ${priorityBadge(ev.priority)}`}>
                                        {ev.priority === 'urgent' ? '!' : 'High'}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* DAY VIEW */}
            {viewMode === 'day' && (
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="px-4 py-3 border-b border-foreground-200/60 flex items-center gap-3">
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${isToday(selectedDay, viewMonth, viewYear) ? 'bg-primary-500 text-white' : 'bg-primary-100 text-primary-700'}`}>
                    {selectedDay}
                  </span>
                  <div>
                    <p className="text-sm font-heading font-bold text-foreground-900">
                      {DAYS_OF_WEEK[new Date(viewYear, viewMonth, selectedDay).getDay() === 0 ? 6 : new Date(viewYear, viewMonth, selectedDay).getDay() - 1]}, {MONTH_NAMES[viewMonth]} {selectedDay}
                    </p>
                    <p className="text-[11px] text-foreground-400">{selectedDayEvents.length} events</p>
                  </div>
                </div>
                <div className="overflow-y-auto max-h-[600px]">
                  {HOURS.map(hour => {
                    const eventsInSlot = selectedDayEvents.filter(ev => {
                      const startH = ev.startHour;
                      return startH >= hour && startH < hour + 1;
                    });
                    const isCurrentRow = currentHour === hour && isToday(selectedDay, viewMonth, viewYear);
                    return (
                      <div key={`dh-${hour}`} className={`flex items-start border-b border-background-100/50 min-h-[64px] ${isCurrentRow ? 'bg-primary-50/20' : ''}`}>
                        <div className="w-16 shrink-0 px-3 py-3 text-right border-r border-background-100/50">
                          <span className="text-[11px] font-semibold text-foreground-400">{hour.toString().padStart(2, '0')}:00</span>
                        </div>
                        <div className="flex-1 py-2 px-3 relative">
                          {isCurrentRow && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary-400 rounded-full" />}
                          <div className="space-y-1.5">
                            {eventsInSlot.map(ev => {
                              const tc = eventConfig(ev);
                              return (
                                <div
                                  key={ev.id}
                                  onClick={() => setSelectedEvent(ev)}
                                  className={`p-3 rounded-lg border-l-[3px] cursor-pointer transition-smooth hover:shadow-sm hover:brightness-95 ${tc.bg} ${tc.border} ${selectedEvent?.id === ev.id ? 'ring-2 ring-primary-400 ring-offset-1' : ''}`}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <span className={`text-sm font-semibold ${tc.text}`}>{ev.title}</span>
                                    <div className="flex items-center gap-1.5">
                                      {ev.priority !== 'normal' && (
                                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${priorityBadge(ev.priority)}`}>
                                          {ev.priority === 'urgent' ? 'Urgent' : 'High'}
                                        </span>
                                      )}
                                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${statusBadge(ev.status)}`}>
                                        {statusLabel(ev.status)}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-500">
                                    <span><i className="ri-time-line mr-0.5"></i>{formatTime(ev.startHour)} - {formatTime(ev.endHour)}</span>
                                    {ev.platform && <span><i className="ri-video-line mr-0.5"></i>{ev.platform}</span>}
                                    {ev.location && <span><i className="ri-map-pin-line mr-0.5"></i>{ev.location}</span>}
                                    {ev.learner && <span className="font-medium text-foreground-600">{ev.learner}</span>}
                                    {ev.employer && <span className="font-medium text-foreground-600">{ev.employer}</span>}
                                    {ev.cohort && <span className="text-foreground-400">{ev.cohort}</span>}
                                  </div>
                                </div>
                              );
                            })}
                            {eventsInSlot.length === 0 && isCurrentRow && (
                              <div className="py-1 px-2">
                                <span className="text-[10px] text-primary-500 font-medium">Now</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* â”€â”€ Day events list when in month view â”€â”€ */}
            {viewMode === 'month' && (
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">
                    {DAYS_OF_WEEK[new Date(viewYear, viewMonth, selectedDay).getDay() === 0 ? 6 : new Date(viewYear, viewMonth, selectedDay).getDay() - 1]}, {selectedDay} {MONTH_NAMES[viewMonth]}
                  </h3>
                  <button onClick={() => setViewMode('day')} className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 cursor-pointer whitespace-nowrap">
                    Day view <i className="ri-arrow-right-line ml-0.5"></i>
                  </button>
                </div>
                {selectedDayEvents.length === 0 ? (
                  <div className="text-center py-8">
                    <span className="w-10 h-10 rounded-xl bg-background-100 flex items-center justify-center mx-auto mb-2">
                      <i className="ri-calendar-2-line text-foreground-300"></i>
                    </span>
                    <p className="text-sm text-foreground-400">No events for this day</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedDayEvents.sort((a, b) => a.startHour - b.startHour).map(ev => {
                      const tc = eventConfig(ev);
                      return (
                        <div
                          key={ev.id}
                          onClick={() => setSelectedEvent(ev)}
                          className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-smooth hover:shadow-sm hover:brightness-95 ${tc.bg} ${tc.border} ${selectedEvent?.id === ev.id ? 'ring-2 ring-primary-400 ring-offset-1' : ''}`}
                        >
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tc.bg} ${tc.text}`}>
                            <i className={tc.icon}></i>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${tc.text}`}>{ev.title}</p>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-foreground-500">
                              <span>{formatTime(ev.startHour)} - {formatTime(ev.endHour)}</span>
                              {ev.learner && <span className="text-foreground-400">- {ev.learner}</span>}
                              {ev.employer && <span className="text-foreground-400">- {ev.employer}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {ev.priority !== 'normal' && (
                              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${priorityBadge(ev.priority)}`}>
                                {ev.priority === 'urgent' ? 'Urgent' : 'High'}
                              </span>
                            )}
                            <span className={`w-2 h-2 rounded-full ${tc.dot}`}></span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* â”€â”€ Sidebar (1/3) â”€â”€ */}
          <div className="space-y-4">
            {/* Event Detail */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              {selectedEvent ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Event Details</h3>
                    <button onClick={() => setSelectedEvent(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 cursor-pointer">
                      <i className="ri-close-line"></i>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mb-4">
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${eventConfig(selectedEvent).bg}`}>
                      <i className={`${eventConfig(selectedEvent).icon} ${eventConfig(selectedEvent).text} text-sm`}></i>
                    </span>
                    <div>
                      <h4 className="text-sm font-heading font-semibold text-foreground-900">{selectedEvent.title}</h4>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${priorityBadge(selectedEvent.priority)}`}>
                        {selectedEvent.priority === 'urgent' ? 'Urgent' : selectedEvent.priority === 'high' ? 'High Priority' : 'Normal'}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                      <i className="ri-calendar-line text-foreground-400 w-4 text-center"></i>
                      <span className="font-medium">{formatEventDateLabel(selectedEvent)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                      <i className="ri-time-line text-foreground-400 w-4 text-center"></i>
                      <span className="font-medium">{formatTime(selectedEvent.startHour)} - {formatTime(selectedEvent.endHour)}</span>
                      <span className="text-foreground-300">({selectedEvent.endHour - selectedEvent.startHour}h)</span>
                    </div>
                    {selectedEvent.targetDate && (
                      <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                        <i className="ri-flag-line text-foreground-400 w-4 text-center"></i>
                        <span className="font-medium">Target date: {selectedEvent.targetDate}</span>
                      </div>
                    )}
                    {selectedEvent.scheduledDate && selectedEvent.scheduledTime && (
                      <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                        <i className="ri-calendar-schedule-line text-foreground-400 w-4 text-center"></i>
                        <span className="font-medium">Scheduled for {selectedEvent.scheduledDate} at {selectedEvent.scheduledTime}</span>
                      </div>
                    )}
                    {selectedEvent.learner && (
                      <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                        <i className="ri-user-line text-foreground-400 w-4 text-center"></i>
                        <span className="font-medium">{selectedEvent.learner}</span>
                        {selectedEvent.programme && <span className="text-foreground-300">- {selectedEvent.programme}</span>}
                      </div>
                    )}
                    {selectedEvent.employer && (
                      <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                        <i className="ri-building-2-line text-foreground-400 w-4 text-center"></i>
                        <span className="font-medium">{selectedEvent.employer}</span>
                      </div>
                    )}
                    {selectedEvent.tutor && (
                      <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                        <i className="ri-user-settings-line text-foreground-400 w-4 text-center"></i>
                        <span className="font-medium">Tutor: {selectedEvent.tutor}</span>
                      </div>
                    )}
                    {selectedEvent.platform && selectedEvent.platform !== '--' && (
                      <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                        <i className="ri-video-line text-foreground-400 w-4 text-center"></i>
                        <span className="font-medium">{selectedEvent.platform}</span>
                        {selectedEvent.location && selectedEvent.location !== '--' && <span className="text-foreground-300">/ {selectedEvent.location}</span>}
                      </div>
                    )}
                    {selectedEvent.cohort && (
                      <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                        <i className="ri-group-line text-foreground-400 w-4 text-center"></i>
                        <span className="font-medium">{selectedEvent.cohort}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                      <i className="ri-checkbox-circle-line text-foreground-400 w-4 text-center"></i>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusBadge(selectedEvent.status)}`}>
                        {statusLabel(selectedEvent.status)}
                      </span>
                    </div>
                    {selectedEvent.meetingLink && (
                      <div className="flex items-center gap-2 text-[11px] text-foreground-500">
                        <i className="ri-links-line text-foreground-400 w-4 text-center"></i>
                        <a
                          href={selectedEvent.meetingLink}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-primary-600 hover:text-primary-700 hover:underline"
                        >
                          Open meeting link
                        </a>
                      </div>
                    )}
                    {selectedEvent.notes && (
                      <div className="bg-background-100 rounded-lg p-3 mt-2">
                        <p className="text-[10px] text-foreground-400 uppercase font-semibold mb-1">Notes</p>
                        <p className="text-[11px] text-foreground-600 leading-relaxed">{selectedEvent.notes}</p>
                      </div>
                    )}
                  </div>
                  {(eventActionError || eventActionNotice) && (
                    <div className={`mt-4 rounded-lg border px-3 py-2 text-[11px] ${eventActionError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                      {eventActionError || eventActionNotice}
                    </div>
                  )}
                  {selectedEvent.status !== 'completed' && (
                    <div className="mt-4 rounded-xl border border-background-200/60 bg-background-100/60 p-3">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Schedule Meeting</h4>
                        {selectedEvent.status === 'not-scheduled' && (
                          <span className="text-[10px] font-medium text-amber-700">Needs scheduling</span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Date</span>
                          <input
                            type="date"
                            value={scheduleDate}
                            onChange={(e) => setScheduleDate(e.target.value)}
                            className="w-full rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[11px] text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-300"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Time</span>
                          <input
                            type="time"
                            value={scheduleTime}
                            onChange={(e) => setScheduleTime(e.target.value)}
                            className="w-full rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[11px] text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-300"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Duration</span>
                          <select
                            value={scheduleDuration}
                            onChange={(e) => setScheduleDuration(Number(e.target.value))}
                            className="w-full rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[11px] text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-300"
                          >
                            {[30, 45, 60, 90].map(minutes => (
                              <option key={minutes} value={minutes}>{minutes} min</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        <button
                          onClick={handleScheduleSave}
                          disabled={eventActionBusy}
                          className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap"
                        >
                          <i className="ri-calendar-check-line mr-1"></i>
                          {selectedEvent.status === 'cancelled' ? 'Schedule Again' : selectedEvent.status === 'scheduled' || selectedEvent.status === 'in-progress' ? 'Reschedule' : 'Schedule'}
                        </button>
                        {(selectedEvent.status === 'scheduled' || selectedEvent.status === 'in-progress') && (
                          <button
                            onClick={() => handleEventAction('start')}
                            disabled={eventActionBusy || !(selectedEvent.meetingLink || selectedEvent.graphWebLink)}
                            className="px-3 py-2 bg-emerald-500 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap"
                          >
                            <i className="ri-play-circle-line mr-1"></i>Start
                          </button>
                        )}
                        {selectedEvent.status === 'in-progress' && (
                          <button
                            onClick={() => handleEventAction('complete')}
                            disabled={eventActionBusy}
                            className="px-3 py-2 bg-secondary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-secondary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap"
                          >
                            <i className="ri-check-double-line mr-1"></i>Complete
                          </button>
                        )}
                        {(selectedEvent.status === 'scheduled' || selectedEvent.status === 'in-progress') && (
                          <button
                            onClick={() => handleEventAction('cancel')}
                            disabled={eventActionBusy}
                            className="px-3 py-2 bg-background-50 border border-red-200 text-red-700 rounded-lg text-[11px] font-medium hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap"
                          >
                            <i className="ri-close-circle-line mr-1"></i>Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4 flex items-center gap-2">
                    <i className="ri-information-line text-foreground-400"></i>Event Details
                  </h3>
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <span className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mb-3">
                      <i className="ri-calendar-event-line text-foreground-300 text-lg"></i>
                    </span>
                    <p className="text-sm font-semibold text-foreground-400">Select an event</p>
                    <p className="text-[11px] text-foreground-300 mt-1">Click on any event in the calendar to view details here</p>
                  </div>
                </div>
              )}
            </div>

            {/* Upcoming Events */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3 flex items-center gap-2">
                <i className="ri-calendar-todo-line text-accent-500"></i>Upcoming
              </h3>
              <div className="space-y-2">
                {events
                  .filter(ev => {
                    const evDate = parseEventDate(ev);
                    return evDate >= todayStart && ev.status !== 'completed' && ev.status !== 'cancelled';
                  })
                  .slice(0, 5)
                  .map(ev => {
                    const tc = eventConfig(ev);
                    return (
                      <div
                        key={ev.id}
                        onClick={() => { setSelectedDay(ev.dayOfMonth); setViewMonth(ev.month); setViewYear(ev.year); setSelectedEvent(ev); }}
                        className="flex items-start gap-2.5 p-2 -mx-2 rounded-lg cursor-pointer transition-smooth hover:bg-background-100"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${tc.dot}`}></span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold text-foreground-800 leading-tight truncate">{ev.title}</p>
                          <p className="text-[10px] text-foreground-400">
                            {ev.dayOfMonth} {MONTH_NAMES[ev.month]} - {formatTime(ev.startHour)}
                            {ev.learner && <span> - {ev.learner}</span>}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                {events.filter(ev => {
                  const evDate = parseEventDate(ev);
                  return evDate >= todayStart && ev.status !== 'completed' && ev.status !== 'cancelled';
                }).length === 0 && (
                  <p className="text-[11px] text-foreground-400 text-center py-3">No upcoming events</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}

