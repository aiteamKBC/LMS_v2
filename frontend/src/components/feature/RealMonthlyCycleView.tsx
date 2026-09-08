import { useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import type {
  LearnerActivityEntry,
  LearnerDetail,
  LearnerKind,
} from '@/api/learnerDetail';
import {
  fetchLearnerCalendarEvents,
  type LearnerCalendarEvent,
} from '@/api/learnerCalendar';
import { MetricCard } from '@/components/ui/MetricCard';
import { MonthlyReportWizard } from '@/components/feature/MonthlyReportWizard';
import {
  fetchMonthlyReports,
  type MonthlyReport,
  type MonthlyReportActivity,
  type MonthlyReportAttachment,
} from '@/api/monthlyReports';
import { downloadMonthlyReportPdf } from '@/lib/monthlyReportPdf';
import { canOpenAttachment, openMonthlyReportAttachment } from '@/lib/monthlyReportAttachments';
import { useKsbProgress } from '@/hooks/useKsbProgress';

const learnerNav = roleNavMap.learner;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type ActivityType = 'quiz' | 'video' | 'learning' | 'coaching' | 'review';

interface MonthActivity {
  id: string;
  at: string;
  type: ActivityType;
  title: string;
  action: string;
  detail?: string;
  module?: string | null;
  week?: string | null;
  duration?: string | null;
  reportedTime?: string | null;
  ksbs: string[];
  feedback?: string | null;
  status?: string;
  score?: number;
  passed?: boolean;
  coach?: string;
  notes?: string;
}

const TYPE_META: Record<ActivityType, { label: string; icon: string; colour: string; soft: string; line: string }> = {
  quiz: { label: 'Quizzes', icon: 'ri-questionnaire-line', colour: 'text-amber-700', soft: 'bg-amber-50', line: 'border-l-amber-400' },
  video: { label: 'Videos', icon: 'ri-play-circle-line', colour: 'text-rose-700', soft: 'bg-rose-50', line: 'border-l-rose-400' },
  learning: { label: 'Learning', icon: 'ri-checkbox-circle-line', colour: 'text-emerald-700', soft: 'bg-emerald-50', line: 'border-l-emerald-400' },
  coaching: { label: 'Coaching', icon: 'ri-user-voice-line', colour: 'text-primary-700', soft: 'bg-primary-50', line: 'border-l-primary-500' },
  review: { label: 'Reviews', icon: 'ri-file-list-3-line', colour: 'text-secondary-700', soft: 'bg-secondary-50', line: 'border-l-secondary-500' },
};

const FILTER_DESCRIPTIONS: Record<'all' | ActivityType, string> = {
  all: 'Everything the student has already done during the selected month. Sessions still to come, and cancelled ones, are not listed.',
  learning: 'Completed learning activities such as readings, podcasts, reflections and uploaded resources.',
  video: 'Videos the student finished watching, including repeat views and time spent.',
  quiz: 'Every submitted quiz attempt, including score, pass status, duration and evidenced KSBs.',
  coaching: 'Coaching sessions with the student’s coach that have already taken place.',
  review: 'Formal progress-review meetings that have already taken place in the selected month.',
};

function monthKey(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string, short = false) {
  const [year, month] = key.split('-').map(Number);
  const name = MONTHS[month - 1] || '';
  return `${short ? name.slice(0, 3) : name} ${year}`;
}

function eventDate(event: LearnerCalendarEvent) {
  return event.scheduledDate || event.date || event.targetDate;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function durationLabel(value?: string | null) {
  if (!value) return null;
  if (value.includes(':')) {
    const [minutes, seconds] = value.split(':').map(Number);
    if (!Number.isNaN(minutes) && !Number.isNaN(seconds)) {
      return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
    }
  }
  return value;
}

function minutesFromText(value?: string | null) {
  if (!value) return 0;
  const hours = Number(value.match(/([\d.]+)\s*(?:hours?|hrs?|h)\b/i)?.[1] || 0);
  const minutes = Number(value.match(/([\d.]+)\s*(?:minutes?|mins?|m)\b/i)?.[1] || 0);
  if (hours || minutes) return (hours * 60) + minutes;
  const numeric = Number(value.match(/[\d.]+/)?.[0] || 0);
  return Number.isFinite(numeric) ? numeric * 60 : 0;
}

function formatMinutes(total: number) {
  if (!total) return '0m';
  const rounded = Math.round(total);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return hours ? `${hours}h${minutes ? ` ${minutes}m` : ''}` : `${minutes}m`;
}

function findFeed(
  feed: LearnerActivityEntry[],
  kind: LearnerActivityEntry['kind'],
  id: string | number,
  at: string,
) {
  return feed.find((item) => item.kind === kind
    && (kind === 'quiz' ? item.quizId === Number(id) : item.componentId === String(id))
    && item.at === at);
}

function buildActivities(real: LearnerDetail | null, events: LearnerCalendarEvent[]): MonthActivity[] {
  if (!real) return [];
  const result: MonthActivity[] = [];
  const feed = real.activityFeed || [];
  const componentMap = new Map((real.components || []).map((item) => [item.componentId, item]));

  for (const attempt of real.quizAttempts || []) {
    const item = findFeed(feed, 'quiz', attempt.quizId, attempt.submittedAt);
    result.push({
      id: `quiz-${attempt.quizId}-${attempt.attempt || attempt.submittedAt}`,
      at: attempt.submittedAt,
      type: 'quiz',
      title: item?.title || `Quiz ${attempt.quizId}`,
      action: attempt.attempt ? `Completed attempt ${attempt.attempt}` : 'Completed quiz',
      detail: item?.detail || `${Math.round(attempt.grade * 100)}%${attempt.achievedScore != null && attempt.totalScore != null ? ` · ${attempt.achievedScore}/${attempt.totalScore}` : ''}`,
      module: item?.module,
      week: item?.week,
      duration: durationLabel(attempt.timeTaken),
      reportedTime: attempt.reportedTime,
      ksbs: attempt.ksbs || [],
      feedback: attempt.feedback,
      score: Math.round(attempt.grade * 100),
      passed: attempt.passed,
    });
  }

  for (const video of real.videoProgress || []) {
    const item = findFeed(feed, 'video', video.componentId, video.submittedAt);
    const component = componentMap.get(video.componentId);
    result.push({
      id: `video-${video.componentId}-${video.attempt || video.submittedAt}`,
      at: video.submittedAt,
      type: 'video',
      title: item?.title || component?.component || 'Video',
      action: video.attempt && video.attempt > 1 ? `Watched again · attempt ${video.attempt}` : 'Watched video',
      detail: item?.detail,
      module: item?.module || component?.module,
      week: item?.week || component?.week,
      duration: durationLabel(video.timeTaken),
      reportedTime: video.reportedTime,
      ksbs: video.ksbs || [],
      feedback: video.feedback,
    });
  }

  for (const progress of real.componentProgress || []) {
    const item = findFeed(feed, 'component', progress.componentId, progress.submittedAt);
    const component = componentMap.get(progress.componentId);
    result.push({
      id: `component-${progress.componentId}-${progress.attempt || progress.submittedAt}`,
      at: progress.submittedAt,
      type: 'learning',
      title: item?.title || component?.component || progress.componentType || 'Learning activity',
      action: item?.action || `Completed ${progress.componentType || 'activity'}`,
      detail: item?.detail || component?.description,
      module: item?.module || component?.module,
      week: item?.week || component?.week,
      duration: durationLabel(progress.timeTaken),
      reportedTime: progress.reportedTime,
      ksbs: progress.ksbs || [],
      feedback: progress.feedback,
    });
  }

  // Keep feed-only actions too. This prevents a future backend activity type from
  // silently disappearing before the richer progress payload is extended.
  for (const item of feed) {
    const alreadyIncluded = result.some((entry) => entry.at === item.at && (
      (item.kind === 'quiz' && entry.type === 'quiz')
      || (item.kind === 'video' && entry.type === 'video')
      || (item.kind === 'component' && entry.type === 'learning')
    ));
    if (!alreadyIncluded) {
      result.push({
        id: `feed-${item.kind}-${item.at}-${item.componentId || item.quizId || ''}`,
        at: item.at,
        type: item.kind === 'quiz' ? 'quiz' : item.kind === 'video' ? 'video' : 'learning',
        title: item.title,
        action: item.action,
        detail: item.detail,
        module: item.module,
        week: item.week,
        ksbs: [],
        passed: item.passed,
      });
    }
  }

  // This page is a record of what the learner HAS done, so a calendar session
  // only earns a place once it has happened. A session still in the diary — or
  // one that was cancelled and so never took place — is not activity, and
  // counting either inflated the month's totals and active days.
  const now = Date.now();
  for (const event of events) {
    const at = eventDate(event);
    if (!at) continue;
    if (event.status === 'cancelled') continue;
    const startedAt = event.scheduledTime && /^\d{2}:\d{2}/.test(event.scheduledTime)
      ? `${at.slice(0, 10)}T${event.scheduledTime.slice(0, 5)}:00`
      : at;
    const startedTime = new Date(startedAt).getTime();
    if (Number.isNaN(startedTime) || startedTime > now) continue;
    result.push({
      id: `event-${event.id}`,
      at: startedAt,
      type: event.type === 'review' ? 'review' : 'coaching',
      title: `${event.title}${event.sequence ? ` ${event.sequence}` : ''}`,
      // Only a session the coach marked complete may be described as completed.
      // A past session still sitting at 'scheduled' has no attendance record
      // behind it, and calling it attended would be a false claim about the
      // learner's own activity in what is an audit trail for OTJH hours.
      action: event.status === 'completed' ? 'Session completed' : 'Calendar session',
      detail: event.durationMinutes ? `${event.durationMinutes} minute session${event.meetingProvider ? ` · ${event.meetingProvider}` : ''}` : undefined,
      ksbs: [],
      status: event.status,
      coach: event.coachName,
      notes: event.notes,
    });
  }

  // Completed work is dated when it was submitted, so a future timestamp means a
  // clock or data problem rather than something the learner has done.
  return result
    .filter((activity) => {
      const time = new Date(activity.at).getTime();
      return !Number.isNaN(time) && time <= now;
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function statusLabel(status: string) {
  return status.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function ActivityCard({ activity }: { activity: MonthActivity }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TYPE_META[activity.type];
  const hasExtra = activity.module || activity.week || activity.duration || activity.reportedTime
    || activity.ksbs.length || activity.feedback || activity.coach || activity.notes;
  const visibleKsbs = expanded ? activity.ksbs : activity.ksbs.slice(0, 7);
  const hiddenKsbCount = activity.ksbs.length - visibleKsbs.length;
  return (
    <article className={`rounded-2xl border border-l-[3px] border-foreground-200/70 ${meta.line} bg-background-50 p-3 shadow-[0_2px_10px_rgba(25,12,56,0.035)] hover:-translate-y-0.5 hover:border-foreground-300 hover:shadow-md transition-all sm:p-4`}>
      <div className="flex items-start gap-2.5 sm:gap-3">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl sm:h-9 sm:w-9 ${meta.soft} ${meta.colour}`}>
          <AppIcon className={`${meta.icon} text-base`}></AppIcon>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-wide ${meta.colour}`}>{meta.label}</span>
                <span className="text-xs text-foreground-400">{activity.action}</span>
              </div>
              <h3 className="mt-0.5 text-sm font-semibold text-foreground-900">{activity.title}</h3>
            </div>
            <div className="flex w-full shrink-0 items-center justify-between gap-2 sm:w-auto sm:justify-start">
              {typeof activity.passed === 'boolean' && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${activity.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {activity.passed ? 'Passed' : 'Not passed'}
                </span>
              )}
              {activity.status && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${activity.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : activity.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-background-200 text-foreground-600'}`}>
                  {statusLabel(activity.status)}
                </span>
              )}
              <time className="text-xs font-medium text-foreground-500">{formatTime(activity.at)}</time>
            </div>
          </div>

          {activity.detail && <p className="mt-1 text-xs leading-5 text-foreground-500">{activity.detail}</p>}

          {hasExtra && (
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 border-t border-background-200 pt-3 text-xs text-foreground-500 sm:gap-x-4 sm:gap-y-1.5">
              {activity.module && <span><AppIcon className="ri-stack-line mr-1 text-foreground-400"></AppIcon>{activity.module}</span>}
              {activity.week && <span><AppIcon className="ri-calendar-line mr-1 text-foreground-400"></AppIcon>{activity.week}</span>}
              {activity.duration && <span><AppIcon className="ri-timer-line mr-1 text-foreground-400"></AppIcon>Actual: {activity.duration}</span>}
              {activity.reportedTime && <span><AppIcon className="ri-time-line mr-1 text-foreground-400"></AppIcon>Logged: {activity.reportedTime}</span>}
              {activity.coach && <span><AppIcon className="ri-user-line mr-1 text-foreground-400"></AppIcon>{activity.coach}</span>}
              {visibleKsbs.map((ksb) => <span key={ksb} className="rounded-md border border-secondary-100 bg-secondary-50 px-1.5 py-0.5 font-semibold text-secondary-700">{ksb}</span>)}
              {hiddenKsbCount > 0 && (
                <button onClick={() => setExpanded(true)} className="rounded-md bg-background-100 px-1.5 py-0.5 font-semibold text-foreground-600 hover:bg-background-200">
                  +{hiddenKsbCount} more
                </button>
              )}
              {activity.feedback && <span className="basis-full"><AppIcon className="ri-chat-quote-line mr-1 text-foreground-400"></AppIcon>{activity.feedback}</span>}
              {activity.notes && <span className="basis-full"><AppIcon className="ri-sticky-note-line mr-1 text-foreground-400"></AppIcon>{activity.notes}</span>}
            </div>
          )}

          {expanded && activity.ksbs.length > 7 && (
            <button onClick={() => setExpanded(false)} className="mt-2 text-[11px] font-semibold text-primary-600 hover:text-primary-700">Show less</button>
          )}

          {/* No join link here. This page lists only what has already
              happened, so every session on it is in the past — offering to
              open the meeting invites a click that leads nowhere. The join
              link belongs on the calendar and This Week, where a session is
              still ahead of the learner. */}
        </div>
      </div>
    </article>
  );
}

export function RealMonthlyCycleView({
  real, loading, loadError, learnerKind, learnerId,
}: {
  real: LearnerDetail | null;
  loading: boolean;
  loadError: string | null;
  learnerKind: LearnerKind;
  learnerId: string;
}) {
  const [events, setEvents] = useState<LearnerCalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | ActivityType>('all');
  const [query, setQuery] = useState('');
  const [monthMenuOpen, setMonthMenuOpen] = useState(false);
  const [reports, setReports] = useState<MonthlyReport[]>([]);
  const [savedSignature, setSavedSignature] = useState('');
  const [savedSignatureName, setSavedSignatureName] = useState('');
  const [reportsError, setReportsError] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [buildingPdf, setBuildingPdf] = useState(false);
  const monthMenuRef = useRef<HTMLDivElement>(null);

  /** Build and save the month's report. Async because any attached documents
   *  are fetched and converted into it, which takes a moment. */
  const downloadReport = async (report: MonthlyReport) => {
    if (buildingPdf) return;
    setBuildingPdf(true);
    setAttachmentError('');
    try {
      await downloadMonthlyReportPdf(report, { learnerKind, learnerId });
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'The report could not be built.');
    } finally {
      setBuildingPdf(false);
    }
  };

  const openAttachment = async (attachment: MonthlyReportAttachment) => {
    if (openingAttachmentId) return;
    setOpeningAttachmentId(attachment.id);
    setAttachmentError('');
    try {
      await openMonthlyReportAttachment(learnerKind, learnerId, attachment);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'That document could not be opened.');
    } finally {
      setOpeningAttachmentId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setEventsLoading(true);
    fetchLearnerCalendarEvents(learnerKind, learnerId)
      .then((response) => { if (!cancelled) setEvents(response.events || []); })
      .catch(() => { if (!cancelled) setEvents([]); })
      .finally(() => { if (!cancelled) setEventsLoading(false); });
    return () => { cancelled = true; };
  }, [learnerKind, learnerId]);

  // Which months already have a submitted report — that is what turns the hero
  // button from "Monthly report" into "Download report".
  useEffect(() => {
    let cancelled = false;
    setReportsError('');
    fetchMonthlyReports(learnerKind, learnerId)
      .then((response) => {
        if (cancelled) return;
        setReports(response.reports);
        setSavedSignature(response.savedSignature);
        setSavedSignatureName(response.savedSignatureName);
      })
      .catch((error) => {
        if (cancelled) return;
        setReports([]);
        setReportsError(error instanceof Error ? error.message : 'Could not load your monthly reports.');
      });
    return () => { cancelled = true; };
  }, [learnerKind, learnerId]);

  useEffect(() => {
    if (!monthMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!monthMenuRef.current?.contains(event.target as Node)) setMonthMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMonthMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [monthMenuOpen]);

  // Every KSB on the learner's programme, with its progress — the same
  // derivation the KSB page and progress overview use, so the wizard's list
  // agrees with what the learner sees elsewhere.
  const programmeKsbs = useKsbProgress(real);
  const allActivities = useMemo(() => buildActivities(real, events), [real, events]);
  const currentMonth = monthKey(new Date().toISOString())!;
  const months = useMemo(() => {
    const keys = new Set<string>([currentMonth]);
    allActivities.forEach((activity) => {
      const key = monthKey(activity.at);
      if (key) keys.add(key);
    });
    return Array.from(keys).sort().reverse();
  }, [allActivities, currentMonth]);
  const activeMonth = selectedMonth && months.includes(selectedMonth) ? selectedMonth : currentMonth;

  const monthActivities = useMemo(
    () => allActivities.filter((activity) => monthKey(activity.at) === activeMonth),
    [allActivities, activeMonth],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return monthActivities.filter((activity) => {
      if (filter !== 'all' && activity.type !== filter) return false;
      if (!needle) return true;
      return [activity.title, activity.action, activity.detail, activity.module, activity.week, activity.coach, activity.notes, ...activity.ksbs]
        .some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [monthActivities, filter, query]);

  const grouped = useMemo(() => {
    const groups = new Map<string, MonthActivity[]>();
    visible.forEach((activity) => {
      const key = activity.at.slice(0, 10);
      groups.set(key, [...(groups.get(key) || []), activity]);
    });
    return Array.from(groups.entries());
  }, [visible]);

  const counts = useMemo(() => ({
    all: monthActivities.length,
    quiz: monthActivities.filter((item) => item.type === 'quiz').length,
    video: monthActivities.filter((item) => item.type === 'video').length,
    learning: monthActivities.filter((item) => item.type === 'learning').length,
    coaching: monthActivities.filter((item) => item.type === 'coaching').length,
    review: monthActivities.filter((item) => item.type === 'review').length,
  }), [monthActivities]);

  const loggedMinutes = monthActivities.reduce((total, activity) => total + minutesFromText(activity.reportedTime), 0);
  const ksbCodes = Array.from(new Set(monthActivities.flatMap((activity) => activity.ksbs))).sort();
  const ksbCount = ksbCodes.length;
  const activeDays = new Set(monthActivities.map((activity) => activity.at.slice(0, 10))).size;
  const busy = loading || eventsLoading;

  // The report always covers the whole selected month, never the filtered or
  // searched subset — a filter is a way of reading the page, not of choosing
  // what the month's report says.
  const reportForActiveMonth = reports.find((report) => report.monthKey === activeMonth) || null;
  const reportSnapshot: MonthlyReportActivity[] = monthActivities.map((activity) => ({
    at: activity.at,
    type: activity.type,
    title: activity.title,
    action: activity.action,
    detail: activity.detail ?? null,
    module: activity.module ?? null,
    week: activity.week ?? null,
    duration: activity.duration ?? null,
    reportedTime: activity.reportedTime ?? null,
    ksbs: activity.ksbs,
    status: activity.status ?? null,
    score: activity.score ?? null,
    passed: activity.passed ?? null,
  }));
  const reportMetrics = {
    totalEvents: monthActivities.length,
    activeDays,
    loggedMinutes: Math.round(loggedMinutes),
    loggedLabel: formatMinutes(loggedMinutes),
    ksbCount,
    ksbCodes,
  };
  const summaryMetrics = [
    { label: 'Total events', value: monthActivities.length, icon: 'ri-pulse-line', tone: 'brand' as const, iconClassName: 'bg-violet-100 text-violet-700' },
    { label: 'Active days', value: activeDays, icon: 'ri-calendar-check-line', tone: 'positive' as const, iconClassName: 'bg-emerald-100 text-emerald-700' },
    { label: 'Time logged', value: formatMinutes(loggedMinutes), icon: 'ri-time-line', tone: 'neutral' as const, iconClassName: 'bg-amber-100 text-amber-700' },
    { label: 'KSBs evidenced', value: ksbCount, icon: 'ri-award-line', tone: 'upcoming' as const, iconClassName: 'bg-pink-100 text-pink-700' },
  ];

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Monthly activity"
      pageSubtitle="A complete record of what happened this month"
      userName={real?.name || 'Learner'}
      userRole={real?.programme ? `${real.programme} Apprentice` : 'Apprentice'}
    >
      <main className="w-full space-y-5 p-3 sm:p-4 md:p-6">
        <section className="learner-super-admin-hero relative z-20 rounded-2xl bg-gradient-to-br from-[#17052f] via-[#2d0b57] to-[#54208a] p-4 text-white shadow-xl shadow-primary-950/10 sm:rounded-3xl sm:p-5 md:p-7">
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl" aria-hidden="true">
            <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-secondary-400/15 blur-2xl"></div>
            <div className="absolute -bottom-24 left-1/3 h-52 w-52 rounded-full bg-primary-400/15 blur-3xl"></div>
          </div>
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="relative">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-secondary-100 backdrop-blur">
                <AppIcon className="ri-sparkling-2-line text-secondary-300"></AppIcon>Student month story
              </div>
              <h1 className="font-heading text-[22px] font-bold leading-tight text-white sm:text-2xl md:text-3xl">Everything you did in {monthLabel(activeMonth)}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/65">One clear timeline for every lesson, attempt, watched video, logged minute, KSB and session.</p>
            </div>
            <div className="flex w-full flex-col gap-2.5 sm:flex-row sm:items-center lg:w-auto">
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              {/* Solid white, not translucent: at 10% white on the purple hero
                  this read as a disabled control beside the green download. */}
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                disabled={busy}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-4 text-sm font-bold text-primary-900 shadow-lg shadow-primary-950/20 transition-all hover:-translate-y-0.5 hover:bg-primary-50 focus:outline-none focus:ring-4 focus:ring-white/50 disabled:translate-y-0 disabled:opacity-60"
              >
                <AppIcon className="ri-file-text-line text-base"></AppIcon>
                {reportForActiveMonth ? 'Update report' : 'Monthly report'}
              </button>
              {reportForActiveMonth && (
                <button
                  type="button"
                  onClick={() => void downloadReport(reportForActiveMonth)}
                  disabled={buildingPdf}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 text-sm font-bold text-emerald-950 shadow-lg shadow-emerald-900/20 transition-all hover:-translate-y-0.5 hover:bg-emerald-300 focus:outline-none focus:ring-4 focus:ring-emerald-200/50 disabled:translate-y-0 disabled:opacity-60"
                >
                  <AppIcon className={`text-base ${buildingPdf ? 'ri-loader-4-line animate-spin' : 'ri-download-2-line'}`}></AppIcon>
                  {buildingPdf
                    ? reportForActiveMonth.attachments.length
                      ? 'Building report…'
                      : 'Preparing…'
                    : 'Download report'}
                </button>
              )}
            </div>
            <div ref={monthMenuRef} className="relative z-20 w-full sm:min-w-56 lg:w-auto">
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={monthMenuOpen}
                onClick={() => setMonthMenuOpen((open) => !open)}
                className={`flex h-12 w-full items-center gap-3 rounded-2xl border bg-white px-3.5 text-left text-sm font-bold text-primary-950 shadow-xl shadow-black/10 outline-none transition-all hover:-translate-y-0.5 hover:shadow-2xl focus:ring-4 focus:ring-secondary-300/40 ${monthMenuOpen ? 'border-secondary-300 ring-4 ring-secondary-300/25' : 'border-white/40'}`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
                  <AppIcon className="ri-calendar-2-line text-base"></AppIcon>
                </span>
                <span className="min-w-0 flex-1 truncate">{monthLabel(activeMonth)}</span>
                {activeMonth === currentMonth && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-extrabold uppercase tracking-wide text-emerald-700">Current</span>}
                <AppIcon className={`ri-arrow-down-s-line text-lg text-foreground-500 transition-transform duration-200 ${monthMenuOpen ? 'rotate-180' : ''}`}></AppIcon>
              </button>

              {monthMenuOpen && (
                <div className="absolute right-0 top-[calc(100%+8px)] w-full origin-top-right overflow-hidden rounded-2xl border border-foreground-200/80 bg-white p-1.5 text-foreground-900 shadow-[0_18px_50px_rgba(20,7,43,0.24)] animate-in fade-in zoom-in-95">
                  <div className="px-3 pb-1.5 pt-2 text-[9px] font-bold uppercase tracking-[0.15em] text-foreground-400">Choose a month</div>
                  <div role="listbox" aria-label="Choose month" className="max-h-64 overflow-y-auto">
                    {months.map((key) => {
                      const selected = key === activeMonth;
                      const current = key === currentMonth;
                      return (
                        <button
                          key={key}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            setSelectedMonth(key);
                            setFilter('all');
                            setMonthMenuOpen(false);
                          }}
                          className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${selected ? 'bg-primary-50 text-primary-800' : 'hover:bg-background-100'}`}
                        >
                          <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${selected ? 'bg-primary-600 text-white' : 'bg-background-100 text-foreground-500 group-hover:bg-white'}`}>
                            {MONTHS[Number(key.split('-')[1]) - 1].slice(0, 3)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">{monthLabel(key)}</span>
                            {current && <span className="block text-[10px] font-medium text-emerald-600">Current month</span>}
                          </span>
                          {selected && <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-white"><AppIcon className="ri-check-line text-xs"></AppIcon></span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            </div>
          </div>

          <div className="relative z-0 mt-5 grid grid-cols-2 gap-2 border-t border-white/10 pt-4 sm:mt-6 sm:grid-cols-2 sm:pt-5 md:gap-3 lg:grid-cols-4">
            {summaryMetrics.map((metric) => <MetricCard key={metric.label} {...metric} className="progress-review-hero-metric" />)}
          </div>

          {reportForActiveMonth && (
            <div className="relative z-0 mt-3 space-y-2">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/70">
                <AppIcon className="ri-checkbox-circle-line text-emerald-300"></AppIcon>
                <span>
                  Report submitted for {monthLabel(activeMonth)}
                  {reportForActiveMonth.submittedAt
                    ? ` on ${new Date(reportForActiveMonth.submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
                    : ''}
                </span>
              </p>
              {/* The documents the learner attached, openable straight from here
                  so fetching one does not mean re-entering the update flow. */}
              {reportForActiveMonth.attachments.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {reportForActiveMonth.attachments.map((attachment) => {
                    const openable = canOpenAttachment(attachment);
                    return (
                      <button
                        key={attachment.id}
                        type="button"
                        disabled={!openable || openingAttachmentId === attachment.id}
                        onClick={() => void openAttachment(attachment)}
                        title={openable ? `Open ${attachment.filename}` : 'Security scan in progress'}
                        className={`inline-flex max-w-[15rem] items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold ring-1 ring-inset transition ${
                          openable
                            ? 'bg-white/10 text-white ring-white/25 hover:bg-white/20'
                            : 'cursor-not-allowed bg-white/5 text-white/45 ring-white/10'
                        }`}
                      >
                        <AppIcon className={openingAttachmentId === attachment.id ? 'ri-loader-4-line animate-spin' : openable ? 'ri-attachment-2' : 'ri-shield-check-line'}></AppIcon>
                        <span className="truncate">{attachment.filename}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {attachmentError && (
                <p className="text-[11px] font-semibold text-red-200">
                  <AppIcon className="ri-error-warning-line mr-1"></AppIcon>{attachmentError}
                </p>
              )}
            </div>
          )}
        </section>

        {(busy || loadError) && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${loadError ? 'border-red-200 bg-red-50 text-red-700' : 'border-background-300 bg-background-50 text-foreground-500'}`}>
            <AppIcon className={`${loadError ? 'ri-error-warning-line' : 'ri-loader-4-line animate-spin'} mr-2`}></AppIcon>
            {loadError || 'Loading the complete monthly record…'}
          </div>
        )}

        {reportsError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AppIcon className="ri-error-warning-line mr-2"></AppIcon>{reportsError}
          </div>
        )}

        <section className="z-10 rounded-2xl border border-foreground-200/70 bg-background-50/95 p-3 shadow-[0_8px_30px_rgba(31,14,59,0.08)] backdrop-blur-xl sm:sticky sm:top-2">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:overflow-visible lg:pb-0">
              {(['all', 'learning', 'video', 'quiz', 'coaching', 'review'] as const).map((type) => {
                const label = type === 'all' ? 'All' : TYPE_META[type].label;
                return (
                  <button
                    key={type}
                    onClick={() => setFilter(type)}
                    aria-label={`${label}: ${FILTER_DESCRIPTIONS[type]}`}
                    className={`group relative flex snap-start items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold transition-all ${filter === type ? 'bg-gradient-to-r from-primary-700 to-secondary-600 text-white shadow-md shadow-primary-500/15' : 'bg-background-100 text-foreground-600 hover:bg-primary-50 hover:text-primary-700'}`}
                  >
                    {label} <span className={filter === type ? 'text-white/70' : 'text-foreground-400'}>{counts[type]}</span>
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full ${filter === type ? 'bg-white/15 text-white/80' : 'bg-white text-foreground-400'}`}>
                      <AppIcon className="ri-information-line text-[10px]"></AppIcon>
                    </span>
                    <span role="tooltip" className="pointer-events-none absolute left-1/2 top-[calc(100%+10px)] z-30 hidden w-64 -translate-x-1/2 whitespace-normal rounded-xl bg-foreground-900 px-3 py-2 text-left text-[11px] font-normal leading-4 text-white shadow-xl sm:group-hover:block sm:group-focus-visible:block">
                      {FILTER_DESCRIPTIONS[type]}
                      <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-foreground-900"></span>
                    </span>
                  </button>
                );
              })}
            </div>
            <label className="relative block lg:w-64">
              <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400"></AppIcon>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search this month…"
                className="h-10 w-full rounded-xl border border-foreground-200 bg-background-50 pl-9 pr-3 text-sm outline-none transition-shadow focus:border-primary-400 focus:ring-4 focus:ring-primary-100"
              />
            </label>
          </div>
          <div className="mt-2 flex items-start gap-2 rounded-xl bg-primary-50/70 px-3 py-2 text-xs text-primary-800">
            <AppIcon className="ri-information-line mt-0.5 shrink-0 text-primary-600"></AppIcon>
            <p><span className="font-semibold">{filter === 'all' ? 'All activity' : TYPE_META[filter].label}:</span> {FILTER_DESCRIPTIONS[filter]}</p>
          </div>
        </section>

        <section aria-label="Monthly timeline">
          {grouped.length === 0 && !busy ? (
            <div className="rounded-2xl border border-dashed border-foreground-300 bg-background-50 px-6 py-16 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-background-100 text-foreground-400"><AppIcon className="ri-calendar-line text-xl"></AppIcon></span>
              <h2 className="mt-3 text-sm font-semibold text-foreground-800">No matching activity</h2>
              <p className="mt-1 text-xs text-foreground-500">Try another filter, search, or month.</p>
            </div>
          ) : (
            <div className="space-y-5 sm:space-y-6">
              {grouped.map(([day, activities]) => (
                <div key={day} className="grid gap-3 md:grid-cols-[175px_1fr]">
                  <div className="pt-1 md:sticky md:top-24 md:self-start">
                    <div className="inline-flex items-center gap-3 rounded-2xl border border-foreground-200/60 bg-background-50 px-3 py-2 shadow-sm">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-lg font-bold text-primary-700">{new Date(`${day}T12:00:00`).getDate()}</span>
                      <div>
                        <p className="text-xs font-semibold text-foreground-800">{formatDay(day).split(' ')[0]}</p>
                        <p className="text-[11px] font-medium text-foreground-600">{new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                        <p className="mt-0.5 text-[10px] text-foreground-400">{activities.length} {activities.length === 1 ? 'event' : 'events'}</p>
                      </div>
                    </div>
                  </div>
                  <div className="relative space-y-3 border-l-2 border-primary-100 pl-3 before:absolute before:-left-[5px] before:top-4 before:h-2 before:w-2 before:rounded-full before:bg-primary-500 before:ring-4 before:ring-primary-100 sm:pl-4">
                    {activities.map((activity) => <ActivityCard key={activity.id} activity={activity} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <MonthlyReportWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onSubmitted={(report, signatureWasSaved) => {
            // Replace the month's row in place so the hero switches to
            // "Download report" without a refetch.
            setReports((current) => [
              report,
              ...current.filter((item) => item.monthKey !== report.monthKey),
            ]);
            // Only a signature the learner asked to keep becomes the saved one,
            // so the next month offers it without a refetch.
            if (signatureWasSaved && report.signature) {
              setSavedSignature(report.signature);
              setSavedSignatureName(report.signedName || real?.name || '');
            }
            setWizardOpen(false);
          }}
          learnerKind={learnerKind}
          learnerId={learnerId}
          learnerName={real?.name || 'Learner'}
          programmeName={real?.programme || ''}
          monthKey={activeMonth}
          monthLabel={monthLabel(activeMonth)}
          activities={reportSnapshot}
          metrics={reportMetrics}
          existing={reportForActiveMonth}
          programmeKsbs={programmeKsbs}
          savedSignature={savedSignature}
          savedSignatureName={savedSignatureName}
        />
      </main>
    </WorkspaceShell>
  );
}
