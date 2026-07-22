import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE, LEARNER_RECENT_FEEDBACK, LEARNER_MESSAGES, WEEKLY_LEARNING_COMPONENTS } from '@/mocks/learner-profile';
import { TRAINING_ACTIVITIES } from '@/mocks/training-plan';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { buildLearnerJourney, quizAggregateStats, componentTypeMeta, gradePercent, formatHoursMinutes, isOpenableComponent, parseHours, type JourneyComponent } from '@/utils/learnerJourney';
import type { LearnerDetail, LearnerVideoProgress, LearnerActivityEntry } from '@/api/learnerDetail';
import { EmptyState } from '@/pages/users/components/ui';
import { buildStations, type ModuleStation } from '@/components/feature/RealLearningJourneyView';
import { fetchLearnerCalendarEvents, bookLearnerCalendarSession, fetchLearnerCoach, type LearnerCalendarEvent, type BookableSessionType } from '@/api/learnerCalendar';
import type React from 'react';

/* ─────────────────────────────────────────────
   Real-learner component progress + current-week UI
   ───────────────────────────────────────────── */

type CompState = 'passed' | 'attempted' | 'watched' | 'todo';

/** Derive a component's real progress from the learner's attempts/watches. */
function componentProgress(c: JourneyComponent, videos: LearnerVideoProgress[]): {
  state: CompState; label: string; percent: number; detail?: string;
} {
  if (c.isQuiz && c.quizAttempts && c.quizAttempts.length > 0) {
    const best = c.quizAttempts.reduce((b, a) => (gradePercent(a.grade) > gradePercent(b.grade) ? a : b));
    const pct = gradePercent(best.grade);
    return best.passed
      ? { state: 'passed', label: 'Passed', percent: 100, detail: `${pct}%` }
      : { state: 'attempted', label: 'Attempted', percent: pct, detail: `${pct}%` };
  }
  if (c.type === 'video' && c.componentId) {
    const watched = videos.some((v) => v.componentId === c.componentId);
    if (watched) return { state: 'watched', label: 'Watched', percent: 100 };
  }
  return { state: 'todo', label: 'To do', percent: 0 };
}

const STATE_STYLE: Record<CompState, { pill: string; dot: string; bar: string }> = {
  passed:    { pill: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  attempted: { pill: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500', bar: 'bg-amber-500' },
  watched:   { pill: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  todo:      { pill: 'bg-background-200 text-foreground-500', dot: 'bg-foreground-300', bar: 'bg-foreground-300' },
};

/** One component row inside the current-week card. */
function CurrentWeekRow({ c, videos, onOpen }: {
  c: JourneyComponent; videos: LearnerVideoProgress[]; onOpen?: () => void;
}) {
  const meta = componentTypeMeta(c.title);
  const prog = componentProgress(c, videos);
  const style = STATE_STYLE[prog.state];
  const actionable = !!onOpen;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!actionable}
      className={`group w-full flex items-center gap-3 rounded-xl border border-foreground-100 bg-background-50 px-3.5 py-3 text-left transition-smooth ${
        actionable ? 'hover:border-primary-300/70 hover:shadow-sm cursor-pointer' : 'cursor-default'
      }`}
    >
      <span className={`relative w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.bg}`}>
        <i className={`${meta.icon} text-[15px] ${meta.color}`} />
        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-background-50 ${style.dot}`} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-foreground-400">{meta.label}</span>
        <span className="block text-[13px] font-semibold text-foreground-900 leading-snug truncate">{meta.detail || meta.label}</span>
        {(prog.state === 'attempted') && (
          <span className="mt-1 flex items-center gap-2">
            <span className="h-1 w-24 rounded-full bg-background-200 overflow-hidden">
              <span className={`block h-full rounded-full ${style.bar}`} style={{ width: `${prog.percent}%` }} />
            </span>
          </span>
        )}
      </span>
      <span className="shrink-0 flex flex-col items-end gap-1">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${style.pill}`}>
          {prog.state === 'passed' && <i className="ri-check-line text-[10px]" />}
          {prog.state === 'watched' && <i className="ri-check-line text-[10px]" />}
          {prog.label}{prog.detail ? ` · ${prog.detail}` : ''}
        </span>
        {c.expectedOtjh != null && c.expectedOtjh > 0 && (
          <span className="text-[10px] text-foreground-400 inline-flex items-center gap-1"><i className="ri-time-line text-[10px]" />{c.expectedOtjh}h</span>
        )}
      </span>
      {actionable && <i className="ri-arrow-right-s-line text-foreground-300 group-hover:text-primary-500 transition-smooth shrink-0" />}
    </button>
  );
}

/** The highlighted "current week" hero card with rich component list + progress. */
function CurrentWeekCard({ moduleTitle, weekLabel, components, videos, kind, learnerId }: {
  moduleTitle: string; weekLabel: string; components: JourneyComponent[];
  videos: LearnerVideoProgress[]; kind?: string; learnerId?: string;
}) {
  const navigate = useNavigate();
  const total = components.length;
  const done = components.filter((c) => {
    const s = componentProgress(c, videos).state;
    return s === 'passed' || s === 'watched';
  }).length;
  const percent = total ? Math.round((done / total) * 100) : 0;

  const openFor = (c: JourneyComponent): (() => void) | undefined => {
    if (!kind || !learnerId) return undefined;
    const q = `?module=${encodeURIComponent(moduleTitle)}&week=${encodeURIComponent(weekLabel)}`;
    if (c.isQuiz && c.quizMeta?.quizId != null) return () => navigate(`/learner/quiz/${kind}/${learnerId}/${c.quizMeta!.quizId}${q}`);
    if (c.type === 'video' && c.videoUrl && c.componentId) return () => navigate(`/learner/video/${kind}/${learnerId}/${c.componentId}${q}`);
    if (isOpenableComponent(c)) return () => navigate(`/learner/component/${kind}/${learnerId}/${c.componentId}${q}`);
    return undefined;
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary-200/70 shadow-sm">
      {/* Accent header band */}
      <div className="relative bg-gradient-to-r from-primary-600 to-primary-500 px-5 py-4 text-white">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Current week
            </span>
            <h3 className="mt-1 text-lg font-heading font-bold leading-tight truncate">Current Week</h3>
            <p className="text-[12px] text-white/75 truncate">{weekLabel} · {moduleTitle}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-2xl font-heading font-bold tabular-nums leading-none">{percent}%</p>
            <p className="text-[11px] text-white/75 mt-0.5">{done}/{total} done</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 w-full rounded-full bg-white/25 overflow-hidden">
          <div className="h-full rounded-full bg-white transition-all duration-700" style={{ width: `${percent}%` }} />
        </div>
      </div>

      {/* Component list */}
      <div className="bg-background-50 p-3 md:p-4">
        {total === 0 ? (
          <EmptyState text="No components in this week yet." />
        ) : (
          <div className="space-y-2">
            {components.map((c, i) => (
              <CurrentWeekRow key={c.componentId || `${c.title}-${i}`} c={c} videos={videos} onOpen={openFor(c)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Short relative time, e.g. "just now", "2h ago", "3d ago", else a date. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** One real activity-feed entry (quiz completed / video watched). */
function RealActivityItem({ entry }: { entry: LearnerActivityEntry }) {
  const isQuiz = entry.kind === 'quiz';
  const icon = isQuiz ? 'ri-questionnaire-line' : 'ri-play-circle-line';
  const tint = isQuiz
    ? (entry.passed === false ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600')
    : 'bg-red-100 text-red-600';
  return (
    <div className="flex items-start gap-3 rounded-xl border border-foreground-100 bg-background-50 px-3.5 py-3">
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${tint}`}>
        <i className={`${icon} text-[15px]`} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-foreground-900 leading-snug">
          {entry.action}
          {entry.title && <span className="text-foreground-500 font-normal"> · {entry.title}</span>}
        </p>
        <p className="text-[11px] text-foreground-400 mt-0.5 truncate">
          {[entry.detail, entry.week].filter(Boolean).join(' · ')}
        </p>
      </div>
      <span className="shrink-0 text-[11px] text-foreground-400 whitespace-nowrap">{relativeTime(entry.at)}</span>
    </div>
  );
}

const learnerNav = roleNavMap.learner;

/* ── type → colour mapping (mirror this-week page) ── */
const typeStyle: Record<string, { bg: string; iconBg: string; iconText: string; chip: string }> = {
  'Live Session': { bg: 'bg-emerald-50/80', iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', chip: 'bg-emerald-100 text-emerald-700' },
  'Video': { bg: 'bg-accent-50/80', iconBg: 'bg-accent-100', iconText: 'text-accent-600', chip: 'bg-accent-100 text-accent-700' },
  'Reading': { bg: 'bg-primary-50/80', iconBg: 'bg-primary-100', iconText: 'text-primary-600', chip: 'bg-primary-100 text-primary-700' },
  'Podcast': { bg: 'bg-secondary-50/80', iconBg: 'bg-secondary-100', iconText: 'text-secondary-600', chip: 'bg-secondary-100 text-secondary-700' },
  'Quiz': { bg: 'bg-amber-50/80', iconBg: 'bg-amber-100', iconText: 'text-amber-600', chip: 'bg-amber-100 text-amber-700' },
  'Activity': { bg: 'bg-accent-50/80', iconBg: 'bg-accent-100', iconText: 'text-accent-700', chip: 'bg-accent-100 text-accent-700' },
  'Reflection': { bg: 'bg-primary-50/80', iconBg: 'bg-primary-100', iconText: 'text-primary-600', chip: 'bg-primary-100 text-primary-700' },
  'Evidence': { bg: 'bg-secondary-50/80', iconBg: 'bg-secondary-100', iconText: 'text-secondary-600', chip: 'bg-secondary-100 text-secondary-700' },
};

const statusStyle: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  'Not Started': { bg: 'bg-background-50', text: 'text-foreground-500', dot: 'bg-foreground-300', border: 'border-foreground-200/60' },
  'In Progress': { bg: 'bg-accent-50/40', text: 'text-accent-800', dot: 'bg-accent-500', border: 'border-accent-300/50' },
  'Evidence Required': { bg: 'bg-amber-50/40', text: 'text-amber-700', dot: 'bg-amber-500', border: 'border-amber-200/60' },
  'Evidence Submitted': { bg: 'bg-primary-50/40', text: 'text-primary-700', dot: 'bg-primary-500', border: 'border-primary-200/60' },
  'Referred': { bg: 'bg-red-50/40', text: 'text-red-700', dot: 'bg-red-500', border: 'border-red-200/60' },
  'Completed': { bg: 'bg-emerald-50/40', text: 'text-emerald-700', dot: 'bg-emerald-500', border: 'border-emerald-200/60' },
};

/* ─────────────────────────────────────────────
   Scroll-triggered reveal component
   ───────────────────────────────────────────── */
function SectionReveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setVisible(true), delay);
          observer.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -30px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div
      ref={ref}
      className={`transition-all duration-[500ms] ease-out ${className} ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      }`}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────
   MiniCalendar — a compact, purpose-built month view
   (current month, session dots) + a short "next
   sessions" agenda. Pulls the learner's real coaching
   sessions from the same API the full calendar uses,
   but is designed natively to fit a dashboard cell.
   ───────────────────────────────────────────── */
const MINI_WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MINI_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MINI_TYPE_DOT: Record<string, string> = { coaching: 'bg-teal-500', review: 'bg-red-500', welfare: 'bg-amber-500' };

function miniEventYMD(s?: string | null): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}
function miniEventDate(ev: LearnerCalendarEvent) {
  return miniEventYMD(ev.scheduledDate) || miniEventYMD(ev.date) || miniEventYMD(ev.targetDate);
}
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function MiniCalendar({ kind, id }: { kind?: string; id?: string }) {
  const now = useMemo(() => new Date(), []);
  const [events, setEvents] = useState<LearnerCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [vy, setVy] = useState(now.getFullYear());
  const [vm, setVm] = useState(now.getMonth());

  /* ── Booking flow (real API) ── */
  const [coach, setCoach] = useState<{ name: string; email: string } | null>(null);
  const [showBook, setShowBook] = useState(false);
  const [bookType, setBookType] = useState<BookableSessionType>('catch-up');
  const [bookDate, setBookDate] = useState(() => isoOf(now));
  const [bookTime, setBookTime] = useState('10:00');
  const [bookDuration, setBookDuration] = useState('60');
  const [bookNotes, setBookNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [bookErr, setBookErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadEvents = useCallback(() => {
    if (!kind || !id) { setLoading(false); return () => {}; }
    let cancelled = false;
    setLoading(true);
    fetchLearnerCalendarEvents(kind, id)
      .then((res) => { if (!cancelled) { setEvents(res.events.filter((e) => e.status !== 'cancelled')); setErr(null); } })
      .catch((e: Error) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, id]);

  useEffect(() => loadEvents(), [loadEvents]);

  // Assigned coach — powers the booking panel copy.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchLearnerCoach(id)
      .then((res) => { if (!cancelled && res.coachEmail) setCoach({ name: res.coachName || 'your coach', email: res.coachEmail }); })
      .catch(() => { /* no coach assigned — panel shows a hint */ });
    return () => { cancelled = true; };
  }, [id]);

  const submitBooking = async () => {
    if (!kind || !id || submitting) return;
    setSubmitting(true);
    setBookErr(null);
    try {
      const res = await bookLearnerCalendarSession(kind, id, {
        sessionType: bookType,
        scheduledDate: bookDate,
        scheduledTime: bookTime,
        durationMinutes: parseInt(bookDuration),
        notes: bookNotes.trim() || undefined,
      });
      setShowBook(false);
      setBookNotes('');
      setToast(res.warning ? `Session booked (${res.warning})` : `Session booked with ${coach?.name || 'your coach'}!`);
      setTimeout(() => setToast(null), 4000);
      // Jump the view to the booked month and refresh from the server.
      const dt = miniEventYMD(bookDate);
      if (dt) { setVy(dt.y); setVm(dt.m); }
      loadEvents();
    } catch (e) {
      setBookErr(e instanceof Error ? e.message : 'Booking failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const cells = useMemo(() => {
    const offset = (new Date(vy, vm, 1).getDay() + 6) % 7; // Monday-first
    const days = new Date(vy, vm + 1, 0).getDate();
    const arr: (number | null)[] = [];
    for (let i = 0; i < offset; i++) arr.push(null);
    for (let d = 1; d <= days; d++) arr.push(d);
    return arr;
  }, [vy, vm]);

  const daysWithEvents = useMemo(() => {
    const set = new Set<number>();
    for (const ev of events) { const dt = miniEventDate(ev); if (dt && dt.y === vy && dt.m === vm) set.add(dt.d); }
    return set;
  }, [events, vy, vm]);

  const upcoming = useMemo(() => {
    const floor = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return events
      .map((ev) => ({ ev, dt: miniEventDate(ev) }))
      .filter((x): x is { ev: LearnerCalendarEvent; dt: { y: number; m: number; d: number } } =>
        x.dt !== null && new Date(x.dt.y, x.dt.m, x.dt.d).getTime() >= floor)
      .sort((a, b) => new Date(a.dt.y, a.dt.m, a.dt.d).getTime() - new Date(b.dt.y, b.dt.m, b.dt.d).getTime())
      .slice(0, 3);
  }, [events, now]);

  const isToday = (d: number) => d === now.getDate() && vm === now.getMonth() && vy === now.getFullYear();
  const prev = () => { if (vm === 0) { setVm(11); setVy(vy - 1); } else { setVm(vm - 1); } };
  const next = () => { if (vm === 11) { setVm(0); setVy(vy + 1); } else { setVm(vm + 1); } };
  const goToday = () => { setVy(now.getFullYear()); setVm(now.getMonth()); };

  if (loading) return <div className="py-8 text-center text-[13px] text-foreground-400"><i className="ri-loader-4-line animate-spin mr-1.5" />Loading…</div>;
  if (err) return <EmptyState text={err} />;

  return (
    <div>
      {/* Month nav */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-heading font-semibold text-foreground-900">{MINI_MONTHS[vm]} {vy}</span>
        <div className="flex items-center gap-1">
          <button onClick={goToday} className="text-[11px] font-medium px-2 py-1 rounded-md bg-background-100 text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer">Today</button>
          <button onClick={prev} aria-label="Previous month" className="w-7 h-7 rounded-md flex items-center justify-center text-foreground-500 hover:bg-background-100 transition-smooth cursor-pointer"><i className="ri-arrow-left-s-line" /></button>
          <button onClick={next} aria-label="Next month" className="w-7 h-7 rounded-md flex items-center justify-center text-foreground-500 hover:bg-background-100 transition-smooth cursor-pointer"><i className="ri-arrow-right-s-line" /></button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {MINI_WD.map((w, i) => <div key={i} className="text-center text-[10px] font-semibold text-foreground-400">{w}</div>)}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => (
          <div
            key={i}
            className={`h-9 rounded-lg flex flex-col items-center justify-center ${d == null ? '' : 'border border-foreground-100'} ${
              d != null && isToday(d) ? 'bg-primary-500 border-primary-500 text-white' : 'text-foreground-700'
            }`}
          >
            {d != null && (
              <>
                <span className="text-[11px] leading-none">{d}</span>
                {daysWithEvents.has(d) && <span className={`mt-0.5 w-1.5 h-1.5 rounded-full ${isToday(d) ? 'bg-white' : 'bg-teal-500'}`} />}
              </>
            )}
          </div>
        ))}
      </div>

      {/* Next sessions */}
      <div className="mt-4 pt-3 border-t border-foreground-100">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-400">Next sessions</p>
          <button
            onClick={() => { setShowBook((v) => !v); setBookErr(null); }}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-smooth cursor-pointer inline-flex items-center gap-1"
          >
            <i className={showBook ? 'ri-close-line' : 'ri-add-line'} />{showBook ? 'Cancel' : 'Book session'}
          </button>
        </div>

        {upcoming.length === 0 ? (
          <p className="text-[12px] text-foreground-400">No upcoming sessions.</p>
        ) : (
          <div className="space-y-2">
            {upcoming.map(({ ev, dt }) => (
              <div key={ev.id} className="flex items-center gap-2.5">
                <div className="w-9 shrink-0 rounded-lg bg-background-100 py-1 text-center">
                  <p className="text-[12px] font-bold leading-none text-foreground-800">{dt.d}</p>
                  <p className="text-[9px] uppercase text-foreground-400 mt-0.5">{MINI_MONTHS[dt.m].slice(0, 3)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-foreground-900 truncate">{ev.sequence ? `${ev.title} ${ev.sequence}` : ev.title}</p>
                  <p className="text-[11px] text-foreground-400 truncate">{ev.scheduledTime || 'Time TBC'}{ev.coachName ? ` · ${ev.coachName}` : ''}</p>
                </div>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${MINI_TYPE_DOT[ev.type] || 'bg-primary-500'}`} />
              </div>
            ))}
          </div>
        )}

        {/* Inline booking form */}
        {showBook && (
          <div className="mt-3 rounded-xl border border-foreground-100 bg-background-50 p-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
            <p className="text-[11px] text-foreground-500">
              {coach
                ? <>Books a Teams session with <span className="font-semibold text-foreground-700">{coach.name}</span> and adds it to both calendars.</>
                : 'No coach assigned yet — please contact your programme team.'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'catch-up' as BookableSessionType, label: 'Catch-up', icon: 'ri-chat-3-line' },
                { value: 'student-support' as BookableSessionType, label: 'Support', icon: 'ri-heart-2-line' },
              ]).map((t) => (
                <button
                  key={t.value}
                  onClick={() => setBookType(t.value)}
                  className={`px-2.5 py-2 rounded-lg border text-left transition-smooth cursor-pointer flex items-center gap-2 ${
                    bookType === t.value ? 'border-primary-400 bg-primary-50/50 text-primary-700' : 'border-foreground-200 text-foreground-600 hover:border-foreground-300'
                  }`}
                >
                  <i className={`${t.icon} text-sm`} /><span className="text-[12px] font-semibold">{t.label}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] font-semibold text-foreground-500 block mb-1">Date</span>
                <input type="date" value={bookDate} min={isoOf(now)} onChange={(e) => setBookDate(e.target.value)}
                  className="w-full bg-background-100 border border-foreground-200 rounded-lg px-2 py-1.5 text-[12px] text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40" />
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold text-foreground-500 block mb-1">Time</span>
                <input type="time" value={bookTime} onChange={(e) => setBookTime(e.target.value)}
                  className="w-full bg-background-100 border border-foreground-200 rounded-lg px-2 py-1.5 text-[12px] text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40" />
              </label>
            </div>
            <label className="block">
              <span className="text-[10px] font-semibold text-foreground-500 block mb-1">Duration</span>
              <select value={bookDuration} onChange={(e) => setBookDuration(e.target.value)}
                className="w-full bg-background-100 border border-foreground-200 rounded-lg px-2 py-1.5 text-[12px] text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40 cursor-pointer">
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">1 hour</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-foreground-500 block mb-1">Notes (optional)</span>
              <textarea value={bookNotes} onChange={(e) => setBookNotes(e.target.value)} rows={2} placeholder="What would you like to cover?"
                className="w-full bg-background-100 border border-foreground-200 rounded-lg px-2 py-1.5 text-[12px] text-foreground-800 resize-none focus:outline-none focus:ring-1 focus:ring-primary-400/40" />
            </label>
            {bookErr && <p className="text-[11px] text-red-600"><i className="ri-error-warning-line mr-1" />{bookErr}</p>}
            <button
              onClick={submitBooking}
              disabled={submitting || !coach}
              className="w-full py-2 rounded-lg bg-primary-500 text-white text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
            >
              {submitting ? <><i className="ri-loader-4-line animate-spin" />Booking…</> : <><i className="ri-calendar-check-line" />Confirm booking</>}
            </button>
          </div>
        )}

        {toast && (
          <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200/60 px-3 py-2 text-[12px] font-semibold text-emerald-700 inline-flex items-center gap-2">
            <i className="ri-checkbox-circle-line" />{toast}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   MiniJourney — the learner's journey as a milestone
   track (Start → modules → Gateway) with a progress
   ring on each node and a rich "current module" card.
   Reuses buildStations for the real progress data;
   the layout is purpose-built for the dashboard cell.
   ───────────────────────────────────────────── */
type StationTone = 'done' | 'current' | 'upcoming';

/** A node with an SVG progress ring — the fill shows how far through the module the learner is. */
function JourneyNode({ icon, label, sub, tone, pct }: { icon: string; label: string; sub?: string; tone: StationTone; pct?: number }) {
  const t = tone === 'done'
    ? { fill: '#10b981', bg: 'bg-emerald-500 text-white', label: 'text-foreground-700', shadow: 'shadow-emerald-500/25' }
    : tone === 'current'
      ? { fill: '#7c5cff', bg: 'bg-primary-500 text-white', label: 'text-primary-700 font-semibold', shadow: 'shadow-primary-500/30' }
      : { fill: '#cbd5e1', bg: 'bg-background-100 text-foreground-400', label: 'text-foreground-400', shadow: '' };
  const size = 48, stroke = 3, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  const ringPct = pct != null ? pct : tone === 'done' ? 100 : 0;
  return (
    <div className="flex flex-col items-center gap-1.5 w-[76px] shrink-0 text-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90 absolute inset-0">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="text-background-200" stroke="currentColor" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke={t.fill} strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ - (Math.min(100, ringPct) / 100) * circ} className="transition-all duration-700 ease-out" />
        </svg>
        <span className={`absolute inset-[6px] rounded-full flex items-center justify-center shadow-sm ${t.bg} ${t.shadow} ${tone === 'current' ? 'animate-pulse-slow' : ''}`}>
          <i className={`${icon} text-base`} />
        </span>
      </div>
      <span className={`text-[11px] leading-tight ${t.label}`}>{label}</span>
      {sub ? <span className="text-[10px] text-foreground-400 leading-none tabular-nums">{sub}</span> : null}
    </div>
  );
}
function JourneyConnector({ filled }: { filled: boolean }) {
  return (
    <div className="flex-1 min-w-[20px] h-1 mt-6 rounded-full bg-background-200 overflow-hidden">
      <div className={`h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-700 ${filled ? 'w-full' : 'w-0'}`} />
    </div>
  );
}
function stationTone(s: ModuleStation): StationTone {
  return s.status === 'completed' ? 'done' : s.status === 'current' ? 'current' : 'upcoming';
}

function MiniJourney({ real, loading, loadError }: { real: LearnerDetail | null; loading: boolean; loadError: string | null }) {
  const journey = useMemo(() => buildLearnerJourney(real), [real]);
  const { stations, overallPct, currentIndex } = useMemo(() => buildStations(journey, real), [journey, real]);

  if (loading) return <div className="py-8 text-center text-[13px] text-foreground-400"><i className="ri-loader-4-line animate-spin mr-1.5" />Loading…</div>;
  if (loadError) return <EmptyState text={loadError} />;
  if (journey.length === 0) return <EmptyState text="No training plan built for this learner yet." />;

  const current = currentIndex >= 0 ? stations[currentIndex] : null;
  const allDone = currentIndex === -1 && stations.length > 0;
  const modulesDone = stations.filter((s) => s.status === 'completed').length;

  return (
    <div>
      {/* Overall progress banner */}
      <div className="rounded-xl bg-gradient-to-r from-primary-50/80 to-background-50 border border-primary-100/60 p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-primary-600">Overall progress</span>
          <span className="text-[15px] font-heading font-bold text-foreground-900 tabular-nums">{overallPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-background-200 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-primary-400 to-primary-600 transition-all duration-700" style={{ width: `${overallPct}%` }} />
        </div>
        <p className="text-[11px] text-foreground-500 mt-1.5">
          {modulesDone}/{stations.length} {stations.length === 1 ? 'module' : 'modules'} complete
          {current ? ` · currently on Module ${current.index + 1}` : allDone ? ' · Gateway ready 🎉' : ''}
        </p>
      </div>

      {/* Milestone track */}
      <div className="overflow-x-auto pb-1">
        <div className="flex items-start min-w-max px-1">
          <JourneyNode icon="ri-flag-fill" label="Start" tone="done" />
          {stations.map((s) => (
            <Fragment key={s.index}>
              <JourneyConnector filled={s.status === 'completed'} />
              <JourneyNode
                icon={s.status === 'completed' ? 'ri-check-line' : s.status === 'current' ? 'ri-flag-2-fill' : 'ri-lock-2-line'}
                label={`Module ${s.index + 1}`}
                sub={s.pct == null ? '—' : `${s.pct}%`}
                tone={stationTone(s)}
                pct={s.pct ?? 0}
              />
            </Fragment>
          ))}
          <JourneyConnector filled={allDone} />
          <JourneyNode icon="ri-trophy-fill" label="Gateway" tone={allDone ? 'done' : 'upcoming'} />
        </div>
      </div>

      {/* Current-module card */}
      {current ? (
        <div className="mt-4 rounded-xl border border-primary-200/60 bg-primary-50/30 p-3.5">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="w-7 h-7 rounded-lg bg-primary-500 text-white flex items-center justify-center shrink-0"><i className="ri-flag-2-fill text-sm" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-primary-600 leading-none">You are here</p>
              <p className="text-[13px] font-semibold text-foreground-900 truncate leading-tight mt-0.5">{current.module.module}</p>
            </div>
            <span className="ml-auto text-[13px] font-heading font-bold text-primary-700 tabular-nums shrink-0">{current.pct ?? 0}%</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <JourneyStat icon="ri-stack-line" label="Components" value={`${current.componentCount}`} />
            <JourneyStat icon="ri-questionnaire-line" label="Quizzes" value={current.quizTotal > 0 ? `${current.quizTaken}/${current.quizTotal}` : '—'} />
            <JourneyStat icon="ri-play-circle-line" label="Videos" value={current.videoTotal > 0 ? `${current.videoDone}/${current.videoTotal}` : '—'} />
          </div>
        </div>
      ) : allDone ? (
        <div className="mt-4 rounded-xl border border-emerald-200/60 bg-emerald-50/40 p-3.5 flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center shrink-0"><i className="ri-trophy-fill" /></span>
          <p className="text-[13px] font-semibold text-emerald-700">All modules complete — you&apos;ve reached the Gateway!</p>
        </div>
      ) : null}
    </div>
  );
}

function JourneyStat({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background-50 border border-foreground-100 px-2 py-2 text-center">
      <i className={`${icon} text-primary-500 text-sm`} />
      <p className="text-[13px] font-heading font-bold text-foreground-900 leading-none mt-1">{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-foreground-400 mt-0.5">{label}</p>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Tiny SVG Donut Chart
   ───────────────────────────────────────────── */
function DonutRing({ progress, color, size = 40, stroke = 4.5 }: { progress: number; color: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (Math.min(progress, 100) / 100) * circumference;

  const colorMap: Record<string, string> = {
    emerald: '#10b981',
    amber: '#f59e0b',
    red: '#ef4444',
    primary: '#7c5cff',
    muted: '#9ca3af',
  };

  const strokeColor = colorMap[color] || '#10b981';

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-foreground-200"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={strokeColor}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-all duration-700 ease-out"
      />
    </svg>
  );
}

/* ─────────────────────────────────────────────
   PAGE
   ───────────────────────────────────────────── */
export default function LearnerOverview() {
  const p = LEARNER_PROFILE;

  /* ── Real-learner mode: /workspace/learner/:kind/:id ── */
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(urlKind, urlId);
  const { isRealMode, real, loading, loadError } = useLearnerDetailParam(kind, id);

  const heroName = isRealMode ? ((real?.name.split(' ')[0]) || real?.name || 'Learner') : p.firstName;
  const heroFullName = isRealMode ? (real?.name || 'Learner') : p.fullName;
  const heroProgramme = isRealMode ? (real?.programme || '') : p.programme;
  const heroEmployer = isRealMode ? (real?.employer || '') : p.employer;
  const heroCohort = isRealMode ? (real?.cohort || '') : p.cohort;
  const subtitleParts = isRealMode
    ? [
        heroProgramme ? `Programme: ${heroProgramme}` : '',
        heroEmployer ? `Employer: ${heroEmployer}` : '',
        heroCohort ? `Cohort: ${heroCohort}` : '',
      ].filter(Boolean)
    : [`${p.programme} ${p.programmeLevel}`, p.employer, `Cohort ${p.cohort}`];

  /* ── Real learner's training-plan journey, grouped module -> week -> components ── */
  const journey = useMemo(() => (isRealMode ? buildLearnerJourney(real) : []), [isRealMode, real]);

  // The "current week" — first week of the first module (test data for now;
  // swap for date-based scheduling once live sessions are wired).
  const currentWeek = useMemo(() => {
    for (const mod of journey) {
      if (mod.weeks.length > 0) return { module: mod.module, week: mod.weeks[0] };
    }
    return null;
  }, [journey]);
  // Weekly_Quizzes rollup: each quiz's best attempt -> summed chosen time + union of KSBs.
  const quizStats = useMemo(() => quizAggregateStats(real), [real]);

  // OTJ hours: completed + planned come from the backend (stored in
  // Active_users.Completed_hours / planned_hours). "activities" counts every
  // completed item across kinds (distinct quizzes + videos + future types).
  const otj = useMemo(() => {
    const completedHours = parseHours(real?.completedHours);
    const plannedHours = parseHours(real?.plannedHours ?? real?.totalExpectedOtjh);
    const targetHours = parseHours(real?.targetHours);
    const distinctQuizzes = new Set((real?.quizAttempts ?? []).map((a) => a.quizId)).size;
    const videos = (real?.videoProgress ?? []).length;
    const activities = distinctQuizzes + videos;
    const percent = plannedHours > 0 ? Math.round((completedHours / plannedHours) * 100) : 0;
    // Progress vs the current-week target (the "should have reached by now" bar).
    const variance = real?.progressVariance ? parseFloat(real.progressVariance) : null;   // decimal, e.g. -0.86
    const progressHours = parseHours(real?.progressHours);                                  // completed - target (signed)
    const status = real?.otjhStatus || null;   // "On track" | "Need attention" | "At risk"
    const targetPercent = targetHours > 0 ? Math.round((completedHours / targetHours) * 100) : 0;
    return { completedHours, plannedHours, targetHours, activities, percent, variance, progressHours, status, targetPercent };
  }, [real]);

  /* ── Mark-as-complete state for timeline ── */
  const [userCompletions, setUserCompletions] = useState<Record<number, boolean>>({});

  const handleMarkComplete = useCallback((idx: number) => {
    setUserCompletions(prev => ({ ...prev, [idx]: true }));
  }, []);

  /* ── Overdue count ── */
  const overdueCount = useMemo(() =>
    TRAINING_ACTIVITIES.filter(a => a.status === 'overdue' || a.status === 'Referred').length,
  []);

  /* ── Health score ── */
  const kpiBreakdown = useMemo(() => {
    const attendanceScore = Math.round((p.attendanceRate / 100) * 25);
    const otjhScore = Math.round((p.otjhCompleted / p.otjhTarget) * 25);
    const ksbScore = Math.round((p.ksbProgress / 100) * 25);
    const evidenceScore = Math.round(Math.min((p.evidenceValidated / 12) * 25, 25));
    return [
      { label: 'Attendance', score: attendanceScore, max: 25, icon: 'ri-calendar-check-line', progress: p.attendanceRate, detail: `${p.attendanceRate}%` },
      { label: 'OTJ Hours', score: otjhScore, max: 25, icon: 'ri-time-line', progress: Math.round((p.otjhCompleted / p.otjhTarget) * 100), detail: `${p.otjhCompleted}/${p.otjhTarget}` },
      { label: 'KSB Progress', score: ksbScore, max: 25, icon: 'ri-bar-chart-2-line', progress: p.ksbProgress, detail: `${p.ksbValidated}/${p.ksbTotal}` },
      { label: 'Evidence', score: evidenceScore, max: 25, icon: 'ri-folder-check-line', progress: Math.round(Math.min((p.evidenceValidated / 12) * 100, 100)), detail: `${p.evidenceValidated} approved` },
    ];
  }, [p]);

  /* ── Timeline data ── */
  const timelineComponents = useMemo(() => {
    const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const dateLabels = ['9 Jun', '10 Jun', '11 Jun', '12 Jun', '13 Jun'];
    const ids = ['w4-c4', 'w4-c2', 'w4-c1', 'w4-c6', 'w4-c5'];

    return ids.map((id, i) => {
      const comp = WEEKLY_LEARNING_COMPONENTS.find(c => c.id === id);
      if (!comp) return null;
      return {
        ...comp,
        dayLabel: dayOrder[i],
        dateLabel: dateLabels[i],
      };
    }).filter(Boolean);
  }, []);

  /* ── Upcoming events ── */
  const upcomingEvents = [
    { date: '14 Jun', title: 'Workplace Reflection Due', type: 'Evidence', urgent: true, countdown: '2 days', icon: 'ri-folder-check-line' },
    { date: '18 Jun', title: 'Monthly Coaching', type: 'Coaching', urgent: false, countdown: '6 days', icon: 'ri-chat-smile-2-line' },
    { date: '22 Jun', title: 'Portfolio Submission', type: 'Portfolio', urgent: false, countdown: '10 days', icon: 'ri-briefcase-line' },
    { date: '25 Jun', title: 'Progress Review', type: 'Review', urgent: false, countdown: '13 days', icon: 'ri-file-chart-line' },
    { date: '30 Jun', title: 'Checkpoint Assessment', type: 'Assessment', urgent: false, countdown: '18 days', icon: 'ri-clipboard-line' },
  ];

  /* ── Activity feed ── */
  const activityFeed = [
    ...LEARNER_RECENT_FEEDBACK.map(f => ({ ...f, kind: 'feedback' as const })),
    ...LEARNER_MESSAGES.filter(m => m.unread).map(m => ({ ...m, kind: 'message' as const })),
  ].slice(0, 3);

  /* ── Achievements ── */
  const achievements = [
    { icon: 'ri-vip-crown-line', label: 'Gold Club', color: 'accent' as const },
    { icon: 'ri-fire-line', label: '8 Week Streak', color: 'secondary' as const },
    { icon: 'ri-star-line', label: `${p.pointsBalance} Points`, color: 'primary' as const },
    { icon: 'ri-check-double-line', label: `${p.evidenceValidated} Approved`, color: 'emerald' as const },
    { icon: 'ri-medal-line', label: 'Top Performer', color: 'amber' as const },
  ];

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={isRealMode ? (loading ? 'Loading learner…' : `Good morning, ${heroName}`) : `Good morning, ${p.firstName}`}
      pageSubtitle={isRealMode ? subtitleParts.join(' · ') : `${p.programme} ${p.programmeLevel} · ${p.employer} · Cohort ${p.cohort}`}
      userName={isRealMode ? heroFullName : p.fullName}
      userRole={isRealMode ? (heroProgramme ? `${heroProgramme} Learner` : 'Learner') : `${p.programme} Apprentice`}
    >
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">

        {/* ================================================================
            SECTION 1 — HERO BANNER
            ================================================================ */}
        <SectionReveal delay={0}>
          <section className="relative rounded-2xl overflow-hidden h-36 md:h-40" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
            <div className="absolute top-0 left-0 right-0 h-px bg-white/10"></div>
            <div className="absolute bottom-0 left-0 right-0 h-px bg-black/10"></div>
            {/* blobs */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute opacity-20" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
              <div className="absolute opacity-10" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
            </div>
            {/* avatar */}
            <div className="absolute right-8 bottom-0 top-0 w-1/2 hidden md:flex items-end justify-end pointer-events-none">
              <img
                src="https://public.readdy.ai/ai/img_res/63cca6b6-155e-4d44-9b95-588ef15c4704.png"
                alt="Learner"
                className="h-full w-auto object-contain object-bottom"
                style={{ maxHeight: '115%', transform: 'translateY(8%)' }}
              />
            </div>
            <div className="relative h-full flex flex-col justify-center p-6 md:p-8">
              <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
                <div className="flex-1 min-w-0 max-w-xl">
                  <h1 className="text-2xl md:text-3xl font-heading font-bold text-white tracking-tight mb-1.5">
                    {isRealMode ? (loading ? 'Loading learner…' : `Good morning, ${heroName}`) : `Good morning, ${p.firstName}`}
                  </h1>
                  <p className="text-[13px] text-white/50 max-w-lg">
                    {isRealMode
                      ? (loadError ? loadError : subtitleParts.join(' · ') || 'No programme details yet')
                      : <>{p.programme} Level {p.programmeLevel} &middot; {p.employer} &middot; Cohort {p.cohort} &middot; Coach: {p.coach.name}</>}
                  </p>
                </div>
              </div>
            </div>
            {/* Roadmap Icon Button — links to the logged-in learner's own journey, not applicable when viewing another learner's read-only profile */}
            {!isRealMode && (
            <a
              href="/learner/modules"
              className="absolute top-4 right-4 lg:top-5 lg:right-5 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center transition-all duration-200 hover:scale-110 cursor-pointer group z-10"
              title="My Learning Journey"
            >
              <i className="ri-route-line text-white/80 text-lg group-hover:text-white transition-colors"></i>
            </a>
            )}
          </section>
        </SectionReveal>

        {/* ================================================================
            SECTION 2 — TODAY'S FOCUS
            ================================================================ */}
        <SectionReveal delay={80}>
          <section className="relative rounded-2xl overflow-hidden bg-background-50 border border-foreground-200/50 card-premium">
            <div className="absolute inset-0 bg-gradient-to-r from-background-100/60 via-transparent to-transparent pointer-events-none" />
            {isRealMode ? (
              <div className="relative p-5 md:p-6 flex items-center gap-5">
                <div className="w-14 h-14 rounded-2xl bg-background-100 flex items-center justify-center shrink-0">
                  <i className="ri-presentation-line text-foreground-400 text-2xl"></i>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground-400 uppercase tracking-widest mb-1 font-label">Today&apos;s Focus</p>
                  <h2 className="text-lg md:text-xl font-heading font-bold text-foreground-500 tracking-tight mb-1">Not tracked yet</h2>
                  <p className="text-sm text-foreground-400">Live session scheduling isn&apos;t wired up for this learner yet.</p>
                </div>
              </div>
            ) : (
            <div className="relative p-5 md:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-accent-500 flex items-center justify-center shrink-0 shadow-sm shadow-accent-500/20">
                <i className="ri-presentation-line text-foreground-950 text-2xl"></i>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-accent-600 uppercase tracking-widest mb-1 font-label">Today&apos;s Focus</p>
                <h2 className="text-lg md:text-xl font-heading font-bold text-foreground-900 tracking-tight mb-1">Live Session: Campaign Targeting</h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-foreground-500">
                  <span className="flex items-center gap-1.5">
                    <i className="ri-calendar-line text-accent-500"></i> {p.nextLiveSession.day}
                  </span>
                  <span className="text-foreground-300">&middot;</span>
                  <span className="flex items-center gap-1.5">
                    <i className="ri-time-line text-accent-500"></i> {p.nextLiveSession.time}
                  </span>
                  <span className="text-foreground-300">&middot;</span>
                  <span className="flex items-center gap-1.5">
                    <i className="ri-hourglass-line text-accent-500"></i> 2.0 OTJ Hours
                  </span>
                </div>
              </div>

              <a
                href="/learner/training-plan"
                className="shrink-0 px-6 py-3 rounded-xl bg-accent-500 text-foreground-950 text-sm font-semibold font-label hover:bg-accent-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 shadow-sm shadow-accent-500/15"
              >
                Join Session <i className="ri-arrow-right-line"></i>
              </a>
            </div>
            )}
          </section>
        </SectionReveal>

        {/* ================================================================
            SECTION 3 — LEARNING HEALTH DASHBOARD (donut charts)
            ================================================================ */}
        <SectionReveal delay={120}>
          <section className="space-y-4">
            <div className="flex items-center justify-between relative">
              <h2 className="text-base font-heading font-semibold text-foreground-900">Learning Health</h2>

              {/* ── View Overdue ── */}
              {!isRealMode && (
              <div className="flex items-center gap-2">
                <a
                  href="/learner/training-plan?highlight=overdue"
                  className="flex items-center gap-1.5 text-sm font-bold text-white whitespace-nowrap transition-smooth px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 shadow-sm shadow-red-500/15"
                >
                  <i className="ri-error-warning-line text-sm"></i>
                  View Overdue
                  <i className="ri-arrow-right-line text-xs"></i>
                </a>
              </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
              {isRealMode ? (
                <>
                  <HealthCard icon="ri-calendar-check-line" label="Attendance" value="—" detail="Not tracked yet" status="muted" progress={0} />
                  {otj.activities > 0 ? (
                    <HealthCard
                      icon="ri-time-line"
                      label="OTJ Hours"
                      value={formatHoursMinutes(otj.completedHours)}
                      detail={
                        otj.targetHours > 0
                          ? `Target ${formatHoursMinutes(otj.targetHours)} · ${
                              otj.progressHours < 0
                                ? `${formatHoursMinutes(Math.abs(otj.progressHours))} behind`
                                : otj.progressHours > 0 ? `${formatHoursMinutes(otj.progressHours)} ahead` : 'on target'
                            }${otj.variance != null ? ` (${Math.round(otj.variance * 100)}%)` : ''} · ${formatHoursMinutes(otj.plannedHours)} planned`
                          : `From ${otj.activities} ${otj.activities === 1 ? 'activity' : 'activities'} · ${formatHoursMinutes(otj.plannedHours)} planned`
                      }
                      status="primary"
                      progress={otj.targetHours > 0 ? otj.targetPercent : otj.percent}
                      showBar
                      badgeLabel="Logged"
                      ragStatus={otj.status ?? undefined}
                    />
                  ) : (
                    <HealthCard
                      icon="ri-time-line"
                      label="OTJ Hours"
                      value={formatHoursMinutes(otj.plannedHours)}
                      detail={otj.targetHours > 0 ? `Target ${formatHoursMinutes(otj.targetHours)} · ${formatHoursMinutes(otj.plannedHours)} planned` : 'Planned from saved training plan'}
                      status="primary"
                      progress={0}
                      showBar
                      badgeLabel="Planned"
                      ragStatus={otj.status ?? undefined}
                    />
                  )}
                  {quizStats.quizzesTaken > 0 ? (
                    <HealthCard
                      icon="ri-bar-chart-2-line"
                      label="KSB Progress"
                      value={`${quizStats.ksbCount} evidenced`}
                      detail={`Via quizzes · ${real?.ksbs.length || 0} defined`}
                      status="emerald"
                      progress={real?.ksbs.length ? Math.round((quizStats.ksbCount / real.ksbs.length) * 100) : 0}
                      showBar
                      badgeLabel="From quizzes"
                    />
                  ) : (
                    <HealthCard icon="ri-bar-chart-2-line" label="KSB Progress" value={`${real?.ksbs.length || 0} defined`} detail="Validation not tracked yet" status="emerald" progress={0} badgeLabel="Defined" />
                  )}
                  <HealthCard icon="ri-folder-check-line" label="Evidence" value="—" detail="Not tracked yet" status="muted" progress={0} />
                </>
              ) : (
                <>
                  <HealthCard
                    icon="ri-calendar-check-line"
                    label="Attendance"
                    value={`${p.attendanceRate}%`}
                    detail={`${p.sessionsAttended}/${(p.sessionsAttended + p.sessionsMissed)} sessions`}
                    status={p.attendanceRate >= 90 ? 'green' : p.attendanceRate >= 80 ? 'amber' : 'red'}
                    progress={p.attendanceRate}
                    href="/learner/attendance"
                  />
                  <HealthCard
                    icon="ri-time-line"
                    label="OTJ Hours"
                    value={`${p.otjhCompleted} / ${p.otjhTarget}`}
                    detail={`${p.otjhValidated} validated · ${p.otjhPending} pending`}
                    status={p.otjhCompleted / p.otjhTarget >= 0.7 ? 'green' : p.otjhCompleted / p.otjhTarget >= 0.5 ? 'amber' : 'red'}
                    progress={(p.otjhCompleted / p.otjhTarget) * 100}
                    href="/learner/otjh"
                  />
                  <HealthCard
                    icon="ri-bar-chart-2-line"
                    label="KSB Progress"
                    value={`${p.ksbProgress}%`}
                    detail={`${p.ksbValidated} of ${p.ksbTotal} validated`}
                    status={p.ksbProgress >= 50 ? 'green' : p.ksbProgress >= 30 ? 'amber' : 'red'}
                    progress={p.ksbProgress}
                    href="/learner/ksbs"
                  />
                  <HealthCard
                    icon="ri-folder-check-line"
                    label="Evidence"
                    value={`${p.evidenceCount} Submitted`}
                    detail={`${p.evidenceValidated} approved · ${p.evidenceSubmitted} pending`}
                    status="green"
                    progress={Math.min((p.evidenceValidated / 12) * 100, 100)}
                    href="/learner/evidence"
                  />
                </>
              )}
            </div>
          </section>
        </SectionReveal>

        {/* ================================================================
            SECTION 4 — REAL MODE: 2×2 GRID (Training Plan · Calendar ·
            Activity Feed · Trail).  MOCK MODE: original two-column layout.
            ================================================================ */}
        {isRealMode ? (
          <SectionReveal delay={160}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5 items-stretch">

              {/* ── Training Plan ── */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-heading font-semibold text-foreground-900">Training Plan</h2>
                  {real && journey.length > 0 && (
                  <a href={`/learner/training-plan/${kind}/${id}`} className="text-sm text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap transition-smooth">
                    View full plan <i className="ri-arrow-right-line ml-0.5"></i>
                  </a>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto" style={{ maxHeight: 620 }}>
                  {journey.length === 0 || !currentWeek ? (
                    <EmptyState text={loading ? 'Loading…' : 'No training plan built for this learner yet.'} />
                  ) : (
                    <CurrentWeekCard
                      moduleTitle={currentWeek.module}
                      weekLabel={currentWeek.week.week}
                      components={currentWeek.week.components}
                      videos={real?.videoProgress ?? []}
                      kind={kind}
                      learnerId={id}
                    />
                  )}
                </div>
              </div>

              {/* ── My Calendar ── */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-heading font-semibold text-foreground-900">My Calendar</h2>
                  <a href="/learner/calendar" className="text-sm text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap transition-smooth">
                    Open <i className="ri-arrow-right-line ml-0.5"></i>
                  </a>
                </div>
                <MiniCalendar kind={kind} id={id} />
              </div>

              {/* ── Activity Feed ── */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-heading font-semibold text-foreground-900">Activity Feed</h2>
                </div>
                <div className="flex-1 overflow-y-auto" style={{ maxHeight: 620 }}>
                  {(real?.activityFeed && real.activityFeed.length > 0) ? (
                    <div className="space-y-2">
                      {real.activityFeed.slice(0, 12).map((entry, i) => (
                        <RealActivityItem key={`${entry.at}-${i}`} entry={entry} />
                      ))}
                    </div>
                  ) : (
                    <EmptyState text="No activity yet — finish a component to see it here." />
                  )}
                </div>
              </div>

              {/* ── Learner Journey ── */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-heading font-semibold text-foreground-900">Learner Journey</h2>
                  <a href={`/learner/modules/${kind}/${id}`} className="text-sm text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap transition-smooth">
                    Open <i className="ri-arrow-right-line ml-0.5"></i>
                  </a>
                </div>
                <MiniJourney real={real} loading={loading} loadError={loadError} />
              </div>

            </div>
          </SectionReveal>
        ) : (
          <>
          {/* ── MOCK MODE — original two-column sections ── */}
          <SectionReveal delay={160}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
              <div className="lg:col-span-2 bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                <div className="flex items-center justify-between mb-4 md:mb-5">
                  <h2 className="text-base font-heading font-semibold text-foreground-900">This Week's Learning Journey</h2>
                  <a href="/learner/training-plan" className="text-sm text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap transition-smooth">
                    View full plan <i className="ri-arrow-right-line ml-0.5"></i>
                  </a>
                </div>
                <div className="relative">
                  <div className="absolute left-[19px] top-3 bottom-3 w-px bg-background-200" />
                  <div className="space-y-0">
                    {timelineComponents.map((comp, i) => {
                      const effectiveStatus = userCompletions[i] ? 'completed' : comp.status;
                      return (
                        <TimelineCard
                          key={comp.id}
                          component={comp}
                          status={effectiveStatus}
                          canMarkComplete={comp.status !== 'completed' && !userCompletions[i]}
                          onMarkComplete={() => handleMarkComplete(i)}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-1 bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-heading font-semibold text-foreground-900">Upcoming</h2>
                  <a href="/learner/calendar" className="text-sm text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap transition-smooth">
                    View Calendar <i className="ri-arrow-right-line ml-0.5"></i>
                  </a>
                </div>
                <div className="space-y-3">
                  {upcomingEvents.map((event, i) => (
                    <UpcomingEventCard key={i} {...event} />
                  ))}
                </div>
              </div>
            </div>
          </SectionReveal>

          <SectionReveal delay={200}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
              <div className="lg:col-span-2 bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-heading font-semibold text-foreground-900">Activity Feed</h2>
                  <a href="/learner/monthly-coaching" className="text-sm text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap transition-smooth">
                    View All Activity <i className="ri-arrow-right-line ml-0.5"></i>
                  </a>
                </div>
                <div className="space-y-3">
                  {activityFeed.map((item, i) => (
                    <ActivityFeedItem key={i} item={item} index={i} />
                  ))}
                </div>
              </div>

              <div className="lg:col-span-1 bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-heading font-semibold text-foreground-900">Achievements</h2>
                  <a href="/learner/rewards" className="text-sm text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap transition-smooth">
                    View Rewards <i className="ri-arrow-right-line ml-0.5"></i>
                  </a>
                </div>
                <div className="space-y-2.5">
                  {achievements.map((ach, i) => (
                    <AchievementBadge key={i} {...ach} />
                  ))}
                </div>
              </div>
            </div>
          </SectionReveal>
          </>
        )}

        {/* ================================================================
            SECTION 6 — SUPPORT PANEL
            ================================================================ */}
        <SectionReveal delay={240}>
          <section className="bg-background-50 rounded-xl border border-foreground-200/50 p-5 md:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                  <i className="ri-customer-service-2-line text-primary-600 text-lg"></i>
                </div>
                <div>
                  <h2 className="text-base font-heading font-semibold text-foreground-900">Need Help?</h2>
                  <p className="text-sm text-foreground-500">
                    {isRealMode
                      ? 'The support team is here to help this learner succeed.'
                      : <>Your coach {p.coach.name} and the support team are here to help you succeed.</>}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <a href="/learner/messages?contact=med-maher" className="px-4 py-2 rounded-lg border border-foreground-200 text-sm font-medium text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-chat-smile-2-line mr-1.5"></i> Contact Coach
                </a>
                <a href="/learner/support?action=new-ticket&category=wellbeing" className="px-4 py-2 rounded-lg border border-foreground-200 text-sm font-medium text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-heart-pulse-line mr-1.5"></i> Wellbeing Support
                </a>
                <a href="/learner/messages?contact=learner-support" className="px-5 py-2 rounded-lg bg-primary-500 text-white text-sm font-semibold font-label hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap shadow-sm shadow-primary-500/15">
                  <i className="ri-customer-service-2-line mr-1.5"></i> Talk With Us
                </a>
              </div>
            </div>
          </section>
        </SectionReveal>

      </div>
    </WorkspaceShell>
  );
}

/* ─────────────────────────────────────────────
   SUB-COMPONENTS
   ───────────────────────────────────────────── */

function HealthCard({ icon, label, value, detail, status, progress, href, badgeLabel, showBar, ragStatus }: {
  icon: string;
  label: string;
  value: string;
  detail: string;
  status: 'green' | 'amber' | 'red' | 'muted' | 'primary' | 'emerald';
  progress: number;
  href?: string;
  badgeLabel?: string;
  showBar?: boolean;   // render a linear completed/planned bar under the value
  ragStatus?: string;  // "On track"/"Need attention"/"At risk" -> semantic-coloured badge (overrides badgeLabel)
}) {
  // Colour tokens per status. 'primary'/'emerald' are the "alive" accented looks
  // used by the OTJ Hours / KSB Progress cards.
  const S = {
    green:   { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'bg-emerald-100 text-emerald-600', ring: 'emerald', bar: 'bg-emerald-500', tint: '' },
    emerald: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: 'bg-emerald-500 text-white', ring: 'emerald', bar: 'bg-emerald-500', tint: 'bg-gradient-to-br from-emerald-50/60 to-transparent' },
    primary: { bg: 'bg-primary-100', text: 'text-primary-700', icon: 'bg-primary-500 text-white', ring: 'primary', bar: 'bg-primary-500', tint: 'bg-gradient-to-br from-primary-50/70 to-transparent' },
    amber:   { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'bg-amber-100 text-amber-600', ring: 'amber', bar: 'bg-amber-500', tint: '' },
    red:     { bg: 'bg-red-50', text: 'text-red-700', icon: 'bg-red-100 text-red-600', ring: 'red', bar: 'bg-red-500', tint: '' },
    muted:   { bg: 'bg-background-100', text: 'text-foreground-400', icon: 'bg-background-100 text-foreground-400', ring: 'muted', bar: 'bg-foreground-300', tint: '' },
  }[status];
  const statusLabel = badgeLabel ?? (status === 'green' ? 'On Track' : status === 'amber' ? 'Needs Attention' : status === 'red' ? 'Action Required' : 'Not Tracked');
  // A RAG status paints its own semantic-coloured badge (green/amber/red) so the
  // "On track / Need attention / At risk" reads at a glance regardless of the
  // card's accent colour.
  const rag = ragStatus
    ? (/at risk/i.test(ragStatus) ? { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' }
      : /attention/i.test(ragStatus) ? { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' }
      : { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' })
    : null;

  const Card = (
    <div className={`relative overflow-hidden rounded-xl border border-foreground-200/60 p-4 hover:border-primary-300/60 hover:shadow-sm transition-smooth cursor-pointer ${S.tint || 'bg-background-50'}`}>
      {S.tint && <div className="absolute inset-0 bg-background-50 -z-10" />}
      {/* Top row: icon + status badge */}
      <div className="flex items-center justify-between mb-3">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${S.icon}`}>
          <i className={`${icon} text-sm`}></i>
        </span>
        {rag ? (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${rag.bg} ${rag.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${rag.dot}`} />{ragStatus}
          </span>
        ) : (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${S.bg} ${S.text}`}>{statusLabel}</span>
        )}
      </div>

      {/* Middle: donut + value side by side */}
      <div className="flex items-center gap-3">
        <DonutRing progress={progress} color={S.ring} size={42} stroke={4.5} />
        <div className="min-w-0">
          <p className="text-xs text-foreground-400 mb-0.5">{label}</p>
          <p className="text-lg font-heading font-semibold text-foreground-900 leading-tight">{value}</p>
        </div>
      </div>

      {showBar && (
        <div className="mt-3">
          <div className="h-1.5 w-full rounded-full bg-background-200 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${S.bar}`} style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
          </div>
          <p className="text-[10px] text-foreground-400 mt-1 text-right">{Math.round(progress)}% complete</p>
        </div>
      )}

      <p className="text-xs text-foreground-400 mt-2">{detail}</p>
    </div>
  );

  if (href) {
    return (
      <a href={href} className="block">
        {Card}
      </a>
    );
  }

  return Card;
}

function TimelineCard({ component, status, canMarkComplete, onMarkComplete }: {
  component: (typeof WEEKLY_LEARNING_COMPONENTS[number]) & { dayLabel: string; dateLabel: string };
  status: string;
  canMarkComplete: boolean;
  onMarkComplete: () => void;
}) {
  const [animating, setAnimating] = useState(false);
  const isCompleted = status === 'completed';
  const isToday = status === 'In Progress';

  const ts = typeStyle[component.type] || typeStyle['Evidence'];
  const ss = statusStyle[status] || statusStyle['Not Started'];

  const handleClick = () => {
    if (!canMarkComplete || animating) return;
    setAnimating(true);
    onMarkComplete();
    setTimeout(() => setAnimating(false), 500);
  };

  return (
    <div className={`relative flex items-start gap-4 py-3 group`}>
      {/* Timeline dot */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleClick();
        }}
        disabled={!canMarkComplete}
        className={`relative z-10 shrink-0 rounded-full flex items-center justify-center transition-all duration-[350ms] ease-out mt-3 ${
          canMarkComplete
            ? 'cursor-pointer hover:scale-125'
            : 'cursor-default'
        }`}
        style={{ width: canMarkComplete ? '22px' : '10px', height: canMarkComplete ? '22px' : '10px' }}
        aria-label={canMarkComplete ? `Mark "${component.title}" as complete` : undefined}
        title={canMarkComplete ? `Mark "${component.title}" as complete` : isCompleted ? 'Completed' : isToday ? 'Today' : 'Upcoming'}
      >
        {isCompleted ? (
          <span className="flex items-center justify-center w-full h-full rounded-full bg-emerald-400 ring-2 ring-emerald-100">
            <i className={`${animating ? 'ri-check-line' : ''} text-white text-[8px]`}></i>
          </span>
        ) : canMarkComplete ? (
          <span className="flex items-center justify-center w-full h-full rounded-full border-2 border-dashed border-accent-400/60 bg-accent-50 group-hover:border-accent-500 group-hover:bg-accent-100 transition-smooth">
            <i className="ri-check-line text-accent-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200"></i>
          </span>
        ) : (
          <span className={`w-[10px] h-[10px] rounded-full block ${
            isToday ? 'bg-accent-500 ring-4 ring-accent-200 animate-pulse-slow' :
            'bg-foreground-200 ring-2 ring-background-100'
          }`} />
        )}
      </button>

      {/* Day label */}
      <div className="text-center shrink-0 w-12 mt-2">
        <p className="text-xs text-foreground-400 uppercase font-semibold tracking-wider">{component.dayLabel}</p>
        <p className="text-xs text-foreground-600 font-medium">{component.dateLabel}</p>
      </div>

      {/* Card content */}
      <a
        href={`/learner/training-plan`}
        className="flex-1 min-w-0 block"
      >
        <div className={`relative rounded-xl border p-4 transition-smooth card-premium cursor-pointer hover:border-primary-300/60 hover:shadow-sm ${isCompleted ? 'border-foreground-200/50 bg-background-50' : 'border-foreground-200/50 bg-background-50'}`}>
          <div className="flex items-start gap-4">
            {/* Type icon */}
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${ts.iconBg} ${ts.iconText}`}>
              <i className={`${component.typeIcon} text-lg`}></i>
            </div>

            <div className="flex-1 min-w-0">
              {/* Top row: type chip + status */}
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className={`text-xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${ts.chip}`}>{component.type}</span>
                {component.isLive && !isCompleted && (
                  <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full animate-pulse">LIVE</span>
                )}
                {component.status === 'In Progress' && !component.isLive && !isCompleted && (
                  <span className="text-xs font-semibold text-accent-600 bg-accent-50 px-2 py-0.5 rounded-full">Active</span>
                )}
                {isCompleted && (
                  <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <i className="ri-check-line"></i> Done
                  </span>
                )}
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ml-auto ${ss.bg} ${ss.text}`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${ss.dot} mr-1 align-middle`}></span>
                  {status}
                </span>
              </div>

              {/* Title */}
              <p className={`text-sm font-semibold mb-2 ${isCompleted ? 'text-foreground-400 line-through' : 'text-foreground-900'}`}>{component.title}</p>

              {/* Compact meta row */}
              <div className="flex items-center gap-x-4 gap-y-1 text-xs text-foreground-400 flex-wrap">
                <span className="flex items-center gap-1"><i className="ri-timer-line"></i> {component.duration}</span>
                <span className="flex items-center gap-1"><i className="ri-time-line"></i> {component.plannedOTJH}h OTJH</span>
                {component.actualOTJH > 0 && (
                  <span className="flex items-center gap-1 text-emerald-600">
                    <i className="ri-check-line"></i> {component.actualOTJH}h logged
                  </span>
                )}
                <span className="flex items-center gap-1"><i className="ri-calendar-line"></i> {component.dueDate}</span>
                <span className="flex items-center gap-1 text-amber-600"><i className="ri-coin-line"></i> {component.points} pts</span>
              </div>
            </div>

            {/* Arrow */}
            <div className="w-9 h-9 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth shrink-0 mt-0.5">
              <i className="ri-arrow-right-line text-sm"></i>
            </div>
          </div>
        </div>
      </a>
    </div>
  );
}

function UpcomingEventCard({ date, title, type, urgent, countdown, icon }: {
  date: string;
  title: string;
  type: string;
  urgent: boolean;
  countdown: string;
  icon: string;
}) {
  return (
    <a href="/learner/calendar" className="block">
      <div className={`flex items-start gap-3 p-3 rounded-lg transition-smooth cursor-pointer relative overflow-hidden ${
        urgent
          ? 'bg-background-50 border border-foreground-200/50'
          : 'hover:bg-background-100 border border-transparent'
      }`}>
        {/* Animated shimmer overlay for urgent items */}
        {urgent && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground-100/30 to-transparent animate-urgent-shimmer pointer-events-none" />
        )}

        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 relative z-[1] ${
          urgent ? 'bg-red-100 text-red-600' :
          type === 'Coaching' ? 'bg-accent-100 text-accent-700' :
          type === 'Review' ? 'bg-primary-100 text-primary-700' :
          type === 'Assessment' ? 'bg-secondary-100 text-secondary-700' :
          'bg-background-100 text-foreground-500'
        }`}>
          <i className={`${icon} text-sm`}></i>
        </div>

        <div className="flex-1 min-w-0 relative z-[1]">
          <div className="flex items-center justify-between mb-0.5">
            <span className={`text-xs font-semibold uppercase tracking-wider ${
              urgent ? 'text-red-600' : 'text-foreground-400'
            }`}>{date}</span>
            {urgent && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse-slow shrink-0"></span>
            )}
          </div>
          <p className="text-sm font-semibold text-foreground-900 leading-snug mb-1">{title}</p>
          <div className="flex items-center gap-1.5">
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
              urgent ? 'bg-red-100 text-red-600' : 'bg-background-100 text-foreground-500'
            }`}>{type}</span>
            <span className={`text-xs flex items-center gap-1 ${
              urgent ? 'text-red-500 font-semibold animate-countdown-pulse' : 'text-foreground-400'
            }`}>
              <i className={`${urgent ? 'ri-timer-flash-line' : 'ri-timer-line'} text-xs`}></i>
              {countdown}
            </span>
          </div>
        </div>
      </div>
    </a>
  );
}

/* ─────────────────────────────────────────────
   ACTIVITY FEED — Professional Item
   ───────────────────────────────────────────── */
function ActivityFeedItem({ item, index }: { item: any; index: number }) {
  const roleTheme: Record<string, { accent: string; iconBg: string; iconText: string; border: string; avatar: string }> = {
    Coach: {
      accent: 'bg-primary-500',
      iconBg: 'bg-primary-100',
      iconText: 'text-primary-700',
      border: 'border-primary-200/40',
      avatar: 'bg-primary-100 text-primary-700',
    },
    Tutor: {
      accent: 'bg-accent-500',
      iconBg: 'bg-accent-100',
      iconText: 'text-accent-700',
      border: 'border-accent-200/40',
      avatar: 'bg-accent-100 text-accent-700',
    },
    'Line Manager': {
      accent: 'bg-emerald-500',
      iconBg: 'bg-emerald-100',
      iconText: 'text-emerald-700',
      border: 'border-emerald-200/40',
      avatar: 'bg-emerald-100 text-emerald-700',
    },
    message: {
      accent: 'bg-secondary-500',
      iconBg: 'bg-secondary-100',
      iconText: 'text-secondary-700',
      border: 'border-secondary-200/40',
      avatar: 'bg-secondary-100 text-secondary-700',
    },
  };

  const theme = roleTheme[item.role] || roleTheme[item.kind === 'message' ? 'message' : 'Coach'];
  const isUnread = item.kind === 'message';

  return (
    <div className={`relative flex gap-3.5 rounded-xl border border-foreground-200/60 bg-background-50 p-4 hover:border-background-300/70 hover:bg-background-100/50 transition-all duration-300 group`}>
      {/* Left accent bar */}
      <div className={`absolute left-0 top-4 bottom-4 w-1 rounded-r-full ${theme.accent} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />

      {/* Avatar */}
      <div className="shrink-0 mt-0.5">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${theme.avatar} ring-2 ring-white shadow-sm`}>
          {isUnread ? (
            <i className={`ri-mail-unread-line ${theme.iconText} text-sm`}></i>
          ) : (
            <span className={`text-sm font-bold ${theme.iconText}`}>{item.from.charAt(0)}</span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="text-sm font-semibold text-foreground-900">{item.from}</span>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${theme.iconBg} ${theme.iconText}`}>
            {item.role}
          </span>
          {isUnread && (
            <span className="text-[11px] font-bold text-secondary-600 bg-secondary-50 px-2 py-0.5 rounded-full border border-secondary-200/40">
              Unread
            </span>
          )}
          <span className="text-xs text-foreground-400 ml-auto whitespace-nowrap">{item.date}</span>
        </div>

        {/* Message text */}
        <p className="text-sm text-foreground-600 leading-relaxed line-clamp-2 group-hover:line-clamp-none transition-all duration-300">
          {item.text}
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   ACHIEVEMENTS — Professional Badge
   ───────────────────────────────────────────── */
function AchievementBadge({ icon, label, color }: { icon: string; label: string; color: 'accent' | 'primary' | 'secondary' | 'emerald' | 'amber' }) {
  const colorMap: Record<string, { iconBg: string; iconText: string; text: string; ring: string; gradientFrom: string; gradientTo: string }> = {
    accent: {
      iconBg: 'bg-accent-100',
      iconText: 'text-accent-700',
      text: 'text-accent-900',
      ring: 'ring-accent-200/40',
      gradientFrom: 'from-accent-50/60',
      gradientTo: 'to-accent-50/20',
    },
    primary: {
      iconBg: 'bg-primary-100',
      iconText: 'text-primary-700',
      text: 'text-primary-900',
      ring: 'ring-primary-200/40',
      gradientFrom: 'from-primary-50/60',
      gradientTo: 'to-primary-50/20',
    },
    secondary: {
      iconBg: 'bg-secondary-100',
      iconText: 'text-secondary-700',
      text: 'text-secondary-900',
      ring: 'ring-secondary-200/40',
      gradientFrom: 'from-secondary-50/60',
      gradientTo: 'to-secondary-50/20',
    },
    emerald: {
      iconBg: 'bg-emerald-100',
      iconText: 'text-emerald-700',
      text: 'text-emerald-900',
      ring: 'ring-emerald-200/40',
      gradientFrom: 'from-emerald-50/60',
      gradientTo: 'to-emerald-50/20',
    },
    amber: {
      iconBg: 'bg-amber-100',
      iconText: 'text-amber-700',
      text: 'text-amber-900',
      ring: 'ring-amber-200/40',
      gradientFrom: 'from-amber-50/60',
      gradientTo: 'to-amber-50/20',
    },
  };
  const c = colorMap[color];

  return (
    <div className={`relative flex items-center gap-3.5 px-4 py-3.5 rounded-xl border border-foreground-200 bg-gradient-to-r ${c.gradientFrom} ${c.gradientTo} hover:border-background-300/80 hover:shadow-sm transition-all duration-300 cursor-pointer group overflow-hidden`}>
      {/* Subtle decorative ring behind icon */}
      <span className={`absolute left-3 w-12 h-12 rounded-full ring-1 ${c.ring} opacity-0 group-hover:opacity-100 transition-opacity duration-300 -z-10`} />

      {/* Icon */}
      <span className={`w-11 h-11 rounded-xl flex items-center justify-center ${c.iconBg} ${c.iconText} shrink-0 ring-1 ring-inset ring-white/40 shadow-sm`}>
        <i className={`${icon} text-base`}></i>
      </span>

      {/* Text */}
      <span className={`text-sm font-semibold ${c.text} whitespace-nowrap leading-snug`}>{label}</span>

      {/* Subtle arrow on hover */}
      <i className="ri-arrow-right-s-line text-foreground-300 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ml-auto text-base"></i>
    </div>
  );
}
