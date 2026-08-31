import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE, WEEKLY_LEARNING_COMPONENTS } from '@/mocks/learner-profile';
import { TRAINING_ACTIVITIES } from '@/mocks/training-plan';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { useLearnerWorkspaceAccess } from '@/hooks/useLearnerWorkspaceAccess';
import { useAuth } from '@/hooks/useAuth';
import { isInspectionDemoAccount } from '@/lib/learnerFlowAccess';
import { demoProgrammeFor, materialForModuleId, type DemoMaterialDef } from '@/lib/demoProgrammeMaterials';
import { buildDemoTimings, currentWeekStatus, summariseDemoTimings, timingsForModuleIds, useDemoTimeOverrides } from '@/lib/demoTime';
import { DemoMaterialCard } from '@/components/feature/DemoTimePanel';
import { SignOutConfirmModal } from '@/components/feature/Header';
import { buildLearnerJourney, completedComponentIds, componentTypeMeta, componentNoun, gradePercent, formatHoursMinutes, hasComponentContent, isOpenableComponent, parseHours, recordedKsbEvidenceCodes, type JourneyComponent } from '@/utils/learnerJourney';
import type {
  LearnerComponentProgress,
  LearnerDetail,
  LearnerKind,
  LearnerVideoProgress,
} from '@/api/learnerDetail';
import { learningReflectionStatusKey, loadLearningReflectionStatuses, type LearningReflectionStatusMap } from '@/api/reflectionSubmission';
import { buildStations, type ModuleStation } from '@/components/feature/RealLearningJourneyView';
import { fetchLearnerCalendarEvents, fetchLearnerCoach, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import { useFreshUserRedirect, useOnboardingRedirect } from '@/hooks/useOnboardingRedirect';
import { syncLearnerStatus } from '@/hooks/useLearnerNavGate';
import { fetchLearnerAttendance, type LearnerAttendance } from '@/api/learnerAttendance';
import { fetchEvidence, type EvidenceRecord } from '@/api/evidence';
import type React from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { PageContainer } from '@/components/ui/PageContainer';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ActionRow, RowAction } from '@/components/ui/ActionRow';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressBar } from '@/components/ui/ProgressMetric';
import { LearnerAvatar } from '@/pages/coach/shared/LearnerIdentity';
import { toneStyle, statusTone, type StatusTone } from '@/lib/statusTone';
import { displayValue, EMPTY_VALUE, ATTENDANCE_EXPECTED_RATE, ATTENDANCE_MINIMUM_RATE } from '@/lib/format';
import { fetchDemoMaterialSummaries, type DemoMaterialTable } from '@/api/demoMaterials';

/* ─────────────────────────────────────────────
   Real-learner component progress + current-week UI
   ───────────────────────────────────────────── */

type CompState = 'passed' | 'attempted' | 'watched' | 'completed' | 'todo';

/**
 * Derive a component's real progress from what the learner has recorded.
 *
 * Three kinds of completion, one per way a component can be finished: a quiz is
 * graded, a video is watched, and everything else (reading, slides, podcast,
 * assignment, reflection…) is completed through the component runner, which
 * writes its own `component` record. Reading only the first two left every
 * completed reading and slide deck showing "To do" — see LearnerComponentProgress.
 */
function componentProgress(
  c: JourneyComponent,
  videos: LearnerVideoProgress[],
  completions: LearnerComponentProgress[] = [],
): { state: CompState; label: string; percent: number; detail?: string } {
  if (c.isQuiz && c.quizAttempts && c.quizAttempts.length > 0) {
    const best = c.quizAttempts.reduce((b, a) => (gradePercent(a.grade) > gradePercent(b.grade) ? a : b));
    const pct = gradePercent(best.grade);
    return best.passed
      ? { state: 'passed', label: 'Passed', percent: 100, detail: `${pct}%` }
      : { state: 'attempted', label: 'Attempted', percent: pct, detail: `${pct}%` };
  }
  if (c.type === 'video' && c.componentId) {
    const watched = videos.some((v) => v.componentId === c.componentId);
    if (watched) return { state: 'watched', label: 'Completed', percent: 100 };
  }
  if (c.componentId) {
    const done = completions.filter((entry) => entry.componentId === c.componentId);
    if (done.length > 0) {
      // An explicit false is a recorded failure and never counts as done; an
      // absent `passed` is the normal ungraded completion.
      return done.some((entry) => entry.passed !== false)
        ? { state: 'completed', label: 'Completed', percent: 100 }
        : { state: 'attempted', label: 'Attempted', percent: 0 };
    }
  }
  return { state: 'todo', label: 'To do', percent: 0 };
}

const STATE_STYLE: Record<CompState, { pill: string; dot: string; bar: string }> = {
  passed:    { pill: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  attempted: { pill: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500', bar: 'bg-amber-500' },
  watched:   { pill: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  completed: { pill: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  todo:      { pill: 'bg-background-200 text-foreground-500', dot: 'bg-foreground-300', bar: 'bg-foreground-300' },
};

const REFLECTION_STATUS: Record<string, { label: string; style: string; icon: string }> = {
  accepted: { label: 'Reflection accepted', style: 'bg-emerald-100 text-emerald-700', icon: 'ri-check-double-line' },
  submitted_for_tutor_review: { label: 'Reflection awaiting review', style: 'bg-primary-100 text-primary-700', icon: 'ri-time-line' },
  pending: { label: 'Reflection awaiting review', style: 'bg-primary-100 text-primary-700', icon: 'ri-time-line' },
  referred: { label: 'Reflection needs changes', style: 'bg-amber-100 text-amber-700', icon: 'ri-arrow-go-back-line' },
  reject: { label: 'Reflection needs changes', style: 'bg-amber-100 text-amber-700', icon: 'ri-arrow-go-back-line' },
  rejected: { label: 'Reflection needs changes', style: 'bg-amber-100 text-amber-700', icon: 'ri-arrow-go-back-line' },
};

function formatProgrammeStartDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

/** Week names are authored as free text, but often include a UK date such as
 * 3/3/2026. Turn it into a clear seven-day learning period when available. */
function weekPeriodLabel(value: string): string | null {
  const match = value.match(/(?:^|\D)(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:\D|$)/);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const start = new Date(Date.UTC(year, month - 1, day));
  if (
    start.getUTCFullYear() !== year
    || start.getUTCMonth() !== month - 1
    || start.getUTCDate() !== day
  ) return null;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const format = (date: Date) => new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date);
  return `${format(start)} – ${format(end)}`;
}

/* ─────────────────────────────────────────────
   Scroll-triggered reveal component
   ───────────────────────────────────────────── */
function SectionReveal({ children, className = '', delay = 0, immediate = false }: { children: React.ReactNode; className?: string; delay?: number; immediate?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (immediate) return;
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
  }, [delay, immediate]);

  return (
    <div
      ref={ref}
      className={`transition-all duration-[500ms] ease-out ${className} ${
        immediate || visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      }`}
    >
      {children}
    </div>
  );
}

/* Small date helpers for the Upcoming panel — only what a list needs, not a grid. */
const MINI_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function miniEventYMD(s?: string | null): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}
function miniEventDate(ev: LearnerCalendarEvent) {
  return miniEventYMD(ev.scheduledDate) || miniEventYMD(ev.date) || miniEventYMD(ev.targetDate);
}

const learnerNav = roleNavMap.learner;

/* ── type → colour mapping (mock-mode "Continue Learning" list) ── */
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
   PAGE
   ───────────────────────────────────────────── */
export default function LearnerOverview() {
  const p = LEARNER_PROFILE;
  const navigate = useNavigate();

  /* ── Real-learner mode: /workspace/learner/:kind/:id ── */
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(urlKind, urlId);
  // Anyone but this learner reads the workspace: the plan is visible, nothing in
  // it can be progressed. Booking a session is unaffected — see the coach card.
  const { canProgress, showReadOnlyNotice } = useLearnerWorkspaceAccess(id);
  const { isRealMode, real, loading, loadError } = useLearnerDetailParam(kind, id);
  const isCommercialPreStart = isRealMode
    && kind === 'commercial'
    && real?.programmeStatus?.trim().toLowerCase() === 'delivery';
  const skipPreStartData = isRealMode && (real == null || isCommercialPreStart);
  const learnerKind: LearnerKind | null = kind === 'commercial' || kind === 'apprenticeship' ? kind : null;

  const [attendance, setAttendance] = useState<LearnerAttendance | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(isRealMode);
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [reflectionStatuses, setReflectionStatuses] = useState<LearningReflectionStatusMap>({});
  const [coach, setCoach] = useState<{ name: string; email: string } | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<LearnerCalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(isRealMode);

  useEffect(() => {
    if (!isRealMode || !kind || !id || skipPreStartData) {
      setAttendance(null);
      setAttendanceLoading(false);
      return;
    }

    let cancelled = false;
    setAttendance(null);
    setAttendanceLoading(true);
    fetchLearnerAttendance(kind, id)
      .then((record) => {
        if (!cancelled) setAttendance(record);
      })
      .catch(() => {
        if (!cancelled) setAttendance(null);
      })
      .finally(() => {
        if (!cancelled) setAttendanceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isRealMode, kind, id, skipPreStartData]);

  useEffect(() => {
    if (!isRealMode || !kind || !id || skipPreStartData) {
      setReflectionStatuses({});
      return;
    }

    let cancelled = false;
    loadLearningReflectionStatuses({ learnerKind: kind, learnerId: id })
      .then((statuses) => {
        if (!cancelled) setReflectionStatuses(statuses);
      })
      .catch(() => {
        if (!cancelled) setReflectionStatuses({});
      });
    return () => {
      cancelled = true;
    };
  }, [isRealMode, kind, id, skipPreStartData]);

  useEffect(() => {
    if (!isRealMode || !kind || !id || skipPreStartData) {
      setEvidence([]);
      return;
    }

    let cancelled = false;
    setEvidence([]);
    fetchEvidence(kind, id)
      .then((records) => {
        if (!cancelled) setEvidence(records);
      })
      .catch(() => {
        if (!cancelled) setEvidence([]);
      });

    return () => {
      cancelled = true;
    };
  }, [isRealMode, kind, id, skipPreStartData]);

  // Assigned coach — powers the "My Coach" card and the header's coach fact.
  useEffect(() => {
    if (!isRealMode || !id || skipPreStartData) {
      setCoach(null);
      return;
    }
    let cancelled = false;
    fetchLearnerCoach(id)
      .then((res) => { if (!cancelled && res.coachEmail) setCoach({ name: res.coachName || 'Your coach', email: res.coachEmail }); })
      .catch(() => { if (!cancelled) setCoach(null); });
    return () => { cancelled = true; };
  }, [isRealMode, id, skipPreStartData]);

  // Upcoming coaching/review sessions — read-only here; booking still lives on
  // the full calendar page, not duplicated on the Overview.
  useEffect(() => {
    if (!isRealMode || !learnerKind || !id || skipPreStartData) {
      setCalendarEvents([]);
      setCalendarLoading(false);
      return;
    }
    let cancelled = false;
    setCalendarLoading(true);
    fetchLearnerCalendarEvents(learnerKind, id)
      .then((res) => { if (!cancelled) setCalendarEvents(res.events.filter((e) => e.status !== 'cancelled')); })
      .catch(() => { if (!cancelled) setCalendarEvents([]); })
      .finally(() => { if (!cancelled) setCalendarLoading(false); });
    return () => { cancelled = true; };
  }, [isRealMode, learnerKind, id, skipPreStartData]);

  const evidenceStats = useMemo(() => {
    const approved = evidence.filter((record) => record.status === 'approved').length;
    const pending = evidence.filter((record) => record.status === 'pending').length;
    const rejected = evidence.filter((record) => record.status === 'rejected').length;
    const progress = evidence.length ? Math.round((approved / evidence.length) * 100) : 0;
    return { total: evidence.length, approved, pending, rejected, progress };
  }, [evidence]);

  /* ── Onboarding learners land on their enrolment wizard, not the overview ──
     Gated on `!loading` so a not-yet-loaded status never reads as "not onboarding". */
  const redirectingToOnboarding = useOnboardingRedirect(real?.programmeStatus, isRealMode && !loading, kind);

  /* ── A learner whose enrolment hasn't been started yet gets the waiting page ──
     Same gating as above: `!loading` so an unresolved status never reads as fresh. */
  const isFreshUser = useFreshUserRedirect(real?.programmeStatus, isRealMode && !loading);
  const isCommercialWaiting = isCommercialPreStart && !loading;

  /* The sidebar caches the programme status for the whole browser session and
     never expires it. This page has just fetched the real record, so it hands
     the live value back — otherwise a learner whose status staff changed today
     would keep the menu (and, at 'Fresh user', the waiting page) they had when
     the session started. */
  useEffect(() => {
    if (!isRealMode || loading) return;
    syncLearnerStatus(kind, id, real?.programmeStatus);
  }, [isRealMode, loading, kind, id, real?.programmeStatus]);

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

  const trainingPlanHref = kind && id ? `/learner/training-plan/${kind}/${id}` : '/learner/training-plan';
  const journeyHref = kind && id ? `/learner/modules/${kind}/${id}` : '/learner/modules';
  const displayLearnerName = isRealMode ? heroFullName : p.fullName;
  const displayCohort = isRealMode ? (heroCohort || EMPTY_VALUE) : p.cohort;
  const headerDescription = isRealMode
    ? ([heroProgramme, heroEmployer].filter(Boolean).join(' · ') || undefined)
    : `${p.programme} ${p.programmeLevel} · ${p.employer}`;
  const startDateDisplay = isRealMode
    ? (formatProgrammeStartDate(real?.programmeStartDate) || EMPTY_VALUE)
    : p.startDate;
  const plannedEndDisplay = isRealMode ? EMPTY_VALUE : p.plannedEndDate;
  const coachDisplayName = isRealMode ? (coach?.name || 'Not yet assigned') : p.coach.name;
  const coachDisplayEmail = isRealMode ? (coach?.email || '') : p.coach.email;

  /* ── Real learner's training-plan journey, grouped module -> week -> components ── */
  const journey = useMemo(() => (isRealMode ? buildLearnerJourney(real) : []), [isRealMode, real]);
  const { stations, overallPct, currentIndex, currentWeek: currentWeekLabel } = useMemo(() => buildStations(journey, real), [journey, real]);
  const currentStation = currentIndex >= 0 ? stations[currentIndex] : null;
  const journeyAllDone = currentIndex === -1 && stations.length > 0;
  const currentModuleLabel = isRealMode
    ? (currentStation ? currentStation.module.module : journeyAllDone ? 'Gateway ready' : EMPTY_VALUE)
    : p.currentModule;

  // Use the first incomplete week in the current module so Continue Learning
  // follows the learner's actual progress instead of remaining on week one.
  const currentWeek = useMemo(() => {
    if (currentStation) {
      const weekIndex = Math.max(0, currentStation.module.weeks.findIndex((week) => week.week === currentWeekLabel));
      const week = currentStation.module.weeks[weekIndex];
      if (week) return {
        module: currentStation.module.module,
        week,
        weekIndex,
        totalWeeks: currentStation.module.weeks.length,
      };
    }
    for (const mod of journey) {
      if (mod.weeks.length > 0) return { module: mod.module, week: mod.weeks[0], weekIndex: 0, totalWeeks: mod.weeks.length };
    }
    return null;
  }, [currentStation, currentWeekLabel, journey]);
  const evidencedKsbCodes = useMemo(() => recordedKsbEvidenceCodes(real), [real]);

  /* ── Inspection-demo time overlay — scoped to the 3 provisioned accounts ──
     Everything here is derived from data already fetched above (journey,
     videoProgress, componentProgress); see lib/demoTime.ts. The
     programme/material structure itself comes from the central config in
     lib/demoProgrammeMaterials.ts — nothing here string-matches a title. */
  const { auth, logout } = useAuth();
  const [demoSignOutOpen, setDemoSignOutOpen] = useState(false);
  const demoProgramme = useMemo(() => demoProgrammeFor(auth.account?.email), [auth.account?.email]);
  const isDemoAccount = isRealMode && isInspectionDemoAccount(auth.account?.email) && demoProgramme != null;
  const [demoMaterialTables, setDemoMaterialTables] = useState<DemoMaterialTable[]>([]);
  useEffect(() => {
    if (!isDemoAccount || !demoProgramme) {
      setDemoMaterialTables([]);
      return;
    }
    let cancelled = false;
    fetchDemoMaterialSummaries(demoProgramme.accountLabel)
      .then((tables) => { if (!cancelled) setDemoMaterialTables(tables); })
      .catch(() => { if (!cancelled) setDemoMaterialTables([]); });
    return () => { cancelled = true; };
  }, [demoProgramme, isDemoAccount]);
  const demoScopeKey = kind && id ? `${kind}:${id}` : '';
  const demoOverrides = useDemoTimeOverrides(demoScopeKey);
  const allJourneyComponents = useMemo(() => journey.flatMap((m) => m.weeks.flatMap((w) => w.components)), [journey]);
  const demoCompletedIds = useMemo(() => completedComponentIds(real), [real]);
  const demoTimings = useMemo(
    () => (isDemoAccount
      ? buildDemoTimings(allJourneyComponents, real?.videoProgress ?? [], real?.componentProgress ?? [], demoCompletedIds, demoOverrides)
      : []),
    [isDemoAccount, allJourneyComponents, real, demoCompletedIds, demoOverrides],
  );
  // Each material's constituent modules (by authored module id), its own
  // component-level rollup, and its "current week" — the same journey data
  // used everywhere else, grouped per lib/demoProgrammeMaterials.ts.
  const demoMaterialCards = useMemo(() => {
    if (!demoProgramme) return [];
    return demoProgramme.materials.map((materialDef: DemoMaterialDef) => {
      const modules = journey.filter((m) => m.weeks.some((w) => w.components.some((c) => materialForModuleId(demoProgramme, c.moduleId)?.key === materialDef.key)));
      const timings = timingsForModuleIds(demoTimings, materialDef.moduleIds);
      const weekStatus = currentWeekStatus(modules, demoCompletedIds);
      const table = demoMaterialTables.find((item) => item.key === materialDef.key) || null;
      const journeySummary = summariseDemoTimings(timings);
      const tableSummary = table && table.ready ? {
        expectedMinutes: table.expectedMinutes,
        completedMinutes: 0,
        remainingMinutes: table.expectedMinutes,
        materialsCompleted: 0,
        materialsTotal: table.count,
        completionPct: 0,
        quizzesPassed: 0,
        quizzesTotal: 0,
      } : null;
      return {
        def: materialDef,
        modules,
        table,
        summary: journeySummary.materialsTotal > 0 ? journeySummary : (tableSummary || journeySummary),
        weekStatus: journeySummary.materialsTotal > 0
          ? weekStatus
          : { label: table?.firstWeekTitle || null, complete: false },
        available: (table?.ready && table.count > 0) || (materialDef.moduleIds.length > 0 && modules.length > 0),
      };
    });
  }, [demoProgramme, journey, demoTimings, demoCompletedIds, demoMaterialTables]);
  /** Jump straight into a material's first unfinished activity. A fully
   * completed material reopens from its first activity for review. */
  const openDemoMaterial = useCallback((material: (typeof demoMaterialCards)[number]) => {
    if (kind && id && canProgress) {
      const activities = material.modules.flatMap((module) =>
        module.weeks.flatMap((week) =>
          week.components.map((component) => {
            const query = `?module=${encodeURIComponent(module.module)}&week=${encodeURIComponent(week.week)}`;
            let href: string | null = null;
            if (component.isQuiz && hasComponentContent(component)) {
              href = `/learner/quiz/${kind}/${id}/${component.quizMeta!.quizId}${query}`;
            } else if (component.type === 'video' && component.videoUrl && component.componentId) {
              href = `/learner/video/${kind}/${id}/${component.componentId}${query}`;
            } else if (isOpenableComponent(component)) {
              href = `/learner/component/${kind}/${id}/${component.componentId}${query}`;
            }
            const state = componentProgress(component, real?.videoProgress ?? [], real?.componentProgress ?? []).state;
            const complete = state === 'passed' || state === 'watched' || state === 'completed';
            return { href, complete };
          }),
        ),
      ).filter((activity): activity is { href: string; complete: boolean } => activity.href !== null);

      const next = activities.find((activity) => !activity.complete) || activities[0];
      if (next) {
        navigate(next.href);
        return;
      }
    }

    // A table-only material (currently AI in Marketing) has no authored journey
    // component to hand to the legacy runner, so retain the table reader as a
    // fallback instead of making the card unavailable.
    if (material.table?.ready && material.table.count > 0) {
      const materialPath = `/learner/material/${encodeURIComponent(material.def.key)}`;
      navigate(kind && id ? `${materialPath}/${kind}/${id}` : materialPath);
    }
  }, [canProgress, id, kind, navigate, real?.componentProgress, real?.videoProgress]);
  // OTJ hours: completed + planned come from the backend (stored in
  // Active_users.Completed_hours / planned_hours). "activities" counts every
  // completed item across kinds (distinct quizzes + videos + future types).
  const otj = useMemo(() => {
    const completedHours = parseHours(real?.completedHours);
    const plannedHours = parseHours(real?.plannedHours ?? real?.totalExpectedOtjh);
    const targetHours = parseHours(real?.targetHours);
    const distinctQuizzes = new Set((real?.quizAttempts ?? []).map((a) => a.quizId)).size;
    const videos = (real?.videoProgress ?? []).length;
    // Readings, slide decks, podcasts and the rest complete through the
    // component runner and count the same as a quiz or a video.
    const completions = new Set(
      (real?.componentProgress ?? []).map((entry) => entry.componentId),
    ).size;
    const activities = distinctQuizzes + videos + completions;
    const percent = plannedHours > 0 ? Math.round((completedHours / plannedHours) * 100) : 0;
    // Progress vs the current-week target (the "should have reached by now" bar).
    const variance = real?.progressVariance ? parseFloat(real.progressVariance) : null;   // decimal, e.g. -0.86
    const progressHours = parseHours(real?.progressHours);                                  // completed - target (signed)
    const status = real?.otjhStatus || null;   // "On track" | "Need attention" | "At risk"
    const targetPercent = targetHours > 0 ? Math.round((completedHours / targetHours) * 100) : 0;
    return { completedHours, plannedHours, targetHours, activities, percent, variance, progressHours, status, targetPercent };
  }, [real]);

  /* ── Compact progress cards ── */
  const modulesDone = stations.filter((s) => s.status === 'completed').length;

  const programmeProgressPercent = isRealMode ? (stations.length ? overallPct : null) : p.overallProgress;
  const programmeProgressValue = programmeProgressPercent == null ? EMPTY_VALUE : `${programmeProgressPercent}%`;
  const programmeProgressCaption = isRealMode
    ? (stations.length ? `${modulesDone}/${stations.length} modules complete` : 'No training plan yet')
    : `${p.currentWeek ? `Week ${p.currentWeek} · ` : ''}${p.currentModule}`;

  const attendancePercent = isRealMode ? (attendance ? attendance.attendanceRate : null) : p.attendanceRate;
  const attendanceValue = attendancePercent == null ? EMPTY_VALUE : `${attendancePercent}%`;
  const attendanceCaption = isRealMode
    ? (attendance ? `${attendance.present}/${attendance.sessions} sessions` : attendanceLoading ? 'Loading…' : 'No attendance record yet')
    : `${p.sessionsAttended}/${p.sessionsAttended + p.sessionsMissed} sessions`;
  const attendanceTone: StatusTone = attendancePercent == null
    ? 'neutral'
    : attendancePercent >= ATTENDANCE_EXPECTED_RATE ? 'positive' : attendancePercent >= ATTENDANCE_MINIMUM_RATE ? 'caution' : 'critical';

  const otjPercent = isRealMode ? (otj.targetHours > 0 ? otj.targetPercent : otj.percent) : Math.round((p.otjhCompleted / p.otjhTarget) * 100);
  const otjValue = isRealMode
    ? formatHoursMinutes(otj.activities > 0 ? otj.completedHours : otj.plannedHours)
    : `${p.otjhCompleted}h`;
  const otjCaption = isRealMode
    ? (otj.targetHours > 0 ? `Target ${formatHoursMinutes(otj.targetHours)}${otj.status ? ` · ${otj.status}` : ''}` : `${otj.activities} ${otj.activities === 1 ? 'activity' : 'activities'} logged`)
    : `${p.otjhCompleted}/${p.otjhTarget}h planned`;
  const otjTone: StatusTone = isRealMode ? (otj.status ? statusTone(otj.status) : 'brand') : 'brand';

  const ksbTotal = isRealMode ? (real?.ksbs.length || 0) : p.ksbTotal;
  const ksbPercent = isRealMode
    ? (ksbTotal ? Math.round((evidencedKsbCodes.size / ksbTotal) * 100) : null)
    : p.ksbProgress;
  const ksbValue = isRealMode ? `${evidencedKsbCodes.size}` : `${p.ksbProgress}%`;
  const ksbCaption = isRealMode ? `${evidencedKsbCodes.size} of ${ksbTotal} evidenced` : `${p.ksbValidated} of ${p.ksbTotal} validated`;
  const ksbTone: StatusTone = !isRealMode
    ? (p.ksbProgress >= 50 ? 'positive' : p.ksbProgress >= 30 ? 'caution' : 'critical')
    : ksbTotal === 0 ? 'neutral' : ksbPercent >= 50 ? 'positive' : ksbPercent >= 30 ? 'caution' : 'critical';

  /* ── Mark-as-complete state for the mock-mode timeline ── */
  const [userCompletions, setUserCompletions] = useState<Record<number, boolean>>({});

  const handleMarkComplete = useCallback((idx: number) => {
    setUserCompletions(prev => ({ ...prev, [idx]: true }));
  }, []);

  /* ── Continue Learning (mock mode) ── */
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

  /* ── Upcoming (mock mode) ── */
  const upcomingEvents = [
    { date: '14 Jun', title: 'Workplace Reflection Due', type: 'Evidence', urgent: true, countdown: '2 days' },
    { date: '18 Jun', title: 'Monthly Coaching', type: 'Coaching', urgent: false, countdown: '6 days' },
    { date: '22 Jun', title: 'Portfolio Submission', type: 'Portfolio', urgent: false, countdown: '10 days' },
    { date: '25 Jun', title: 'Progress Review', type: 'Review', urgent: false, countdown: '13 days' },
  ];

  const now = useMemo(() => new Date(), []);

  const upcomingReal = useMemo(() => {
    const floor = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return calendarEvents
      .map((ev) => ({ ev, dt: miniEventDate(ev) }))
      .filter((x): x is { ev: LearnerCalendarEvent; dt: { y: number; m: number; d: number } } =>
        x.dt !== null && new Date(x.dt.y, x.dt.m, x.dt.d).getTime() >= floor)
      .sort((a, b) => new Date(a.dt.y, a.dt.m, a.dt.d).getTime() - new Date(b.dt.y, b.dt.m, b.dt.d).getTime())
      .slice(0, 4)
      .map(({ ev, dt }) => ({
        id: ev.id,
        day: String(dt.d),
        month: MINI_MONTHS[dt.m].slice(0, 3),
        timeLabel: ev.scheduledTime || 'Time TBC',
        title: ev.sequence ? `${ev.title} ${ev.sequence}` : ev.title,
        subtitle: [ev.type === 'coaching' ? 'Coaching' : ev.type === 'review' ? 'Review' : ev.type, ev.coachName].filter(Boolean).join(' · '),
        tone: (ev.type === 'review' ? 'brand' : 'info') as StatusTone,
      }));
  }, [calendarEvents, now]);

  const upcomingMock = useMemo(() => upcomingEvents.slice(0, 4).map((e, i) => {
    const [day, month] = e.date.split(' ');
    return {
      id: `mock-${i}`,
      day: day || e.date,
      month: month || '',
      timeLabel: e.countdown,
      title: e.title,
      subtitle: e.type,
      tone: (e.urgent ? 'critical' : 'neutral') as StatusTone,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  /* ── My Tasks ── */
  const realTasks = useMemo(() => {
    if (!isRealMode) return [];
    const list: Array<{ id: string; title: string; subtitle?: string; tone: StatusTone; actionLabel: string; actionHref: string }> = [];
    const referredCount = Object.values(reflectionStatuses).filter((s) => s === 'referred' || s === 'reject' || s === 'rejected').length;
    if (referredCount > 0) {
      list.push({
        id: 'reflections',
        title: `${referredCount} reflection${referredCount === 1 ? '' : 's'} need changes`,
        subtitle: 'A coach or tutor asked for an update before this can be accepted.',
        tone: 'caution',
        actionLabel: 'Review',
        actionHref: trainingPlanHref,
      });
    }
    if (evidenceStats.rejected > 0) {
      list.push({
        id: 'evidence',
        title: `${evidenceStats.rejected} evidence item${evidenceStats.rejected === 1 ? '' : 's'} rejected`,
        subtitle: 'Resubmit with the changes your coach asked for.',
        tone: 'critical',
        actionLabel: 'View evidence',
        actionHref: '/learner/evidence',
      });
    }
    if (otj.status && /at risk|need/i.test(otj.status)) {
      list.push({
        id: 'otjh',
        title: /at risk/i.test(otj.status) ? 'Off-the-job hours are at risk' : 'Off-the-job hours need attention',
        subtitle: otj.progressHours < 0 ? `${formatHoursMinutes(Math.abs(otj.progressHours))} behind the current-week target.` : undefined,
        tone: statusTone(otj.status),
        actionLabel: 'Log hours',
        actionHref: '/learner/otjh',
      });
    }
    if (attendance && attendance.attendanceRate < ATTENDANCE_EXPECTED_RATE) {
      list.push({
        id: 'attendance',
        title: `Attendance is ${attendance.attendanceRate}%`,
        subtitle: `Target is ${ATTENDANCE_EXPECTED_RATE}% or above.`,
        tone: attendance.attendanceRate < ATTENDANCE_MINIMUM_RATE ? 'critical' : 'caution',
        actionLabel: 'View attendance',
        actionHref: '/learner/attendance',
      });
    }
    return list;
  }, [isRealMode, reflectionStatuses, evidenceStats, otj, attendance, trainingPlanHref]);

  const mockTasks = useMemo(() => TRAINING_ACTIVITIES
    .filter((a) => a.status === 'overdue' || a.status === 'Referred' || a.status === 'Evidence Required')
    .slice(0, 4)
    .map((a) => ({
      id: a.id,
      title: a.title,
      subtitle: a.status === 'overdue' ? `Was due ${a.dueDate}` : a.status === 'Referred' ? 'Needs changes before it can be accepted.' : 'Evidence required to complete this activity.',
      tone: (a.status === 'overdue' ? 'critical' : 'caution') as StatusTone,
      actionLabel: a.primaryAction || 'Open',
      actionHref: '/learner/training-plan',
    })), []);

  const tasks = isRealMode ? realTasks : mockTasks;

  // Nothing of the overview is rendered until the learner's programme status is
  // known. The onboarding redirect can only decide once the detail has loaded,
  // so painting the overview while the fetch is in flight showed an onboarding
  // learner the full delivery page for a moment before bouncing them to their
  // wizard. Waiting here is the whole fix — the redirect itself was correct.
  if (isRealMode && (loading || redirectingToOnboarding)) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[13px] text-foreground-400">
        <AppIcon className="ri-loader-4-line animate-spin mr-2" />
        {redirectingToOnboarding ? 'Opening your enrolment…' : 'Loading your workspace…'}
      </div>
    );
  }

  /* ================================================================
     Enrolment not started — the whole overview is replaced.
     ================================================================
     Everything below this point reads a training plan, KSB profile, evidence
     and attendance record that are only created once enrolment runs. For a
     fresh learner those queries return nothing (or, as the KSB one did, a raw
     "relation does not exist" error rendered into the page header), so the
     dashboard is not merely empty — it is misleading: 100% attendance from
     0 sessions, "1 Submitted" evidence belonging to nobody. One honest
     message beats a wall of figures that mean nothing yet. */
  if (isFreshUser || isCommercialWaiting) {
    const commercialWaiting = isCommercialWaiting;
    const startDate = formatProgrammeStartDate(real?.programmeStartDate);
    return (
      <WorkspaceShell
        role="learner"
        roleLabel={learnerNav.label}
        navItems={learnerNav.items}
        workspaceLabel={learnerNav.workspaceLabel}
        pageTitle={`Welcome, ${heroName}`}
        pageSubtitle={commercialWaiting ? 'Your programme has not started yet' : "Your enrolment hasn't started yet"}
        userName={heroFullName}
        userRole="Learner"
      >
        <div className="p-3 md:p-6">
          <div className="max-w-2xl mx-auto mt-6 md:mt-16">
            <div className="bg-background-50 rounded-2xl border border-foreground-200/60 overflow-hidden">
              <div className="px-6 md:px-10 pt-10 pb-8 text-center">
                <span className="w-16 h-16 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center mx-auto mb-5">
                  <AppIcon className="ri-time-line text-3xl"></AppIcon>
                </span>
                <h2 className="text-xl md:text-2xl font-heading font-bold text-foreground-900 mb-3">
                  {commercialWaiting ? 'Your programme starts soon' : <>Your enrolment hasn&apos;t started yet</>}
                </h2>
                <p className={commercialWaiting ? 'hidden' : 'text-[14px] text-foreground-500 leading-relaxed max-w-lg mx-auto'}>
                  Your account is set up and ready. The enrolment team will be in touch to begin
                  your enrolment — there is nothing you need to do right now.
                </p>
                <p className={commercialWaiting ? 'hidden' : 'text-[13px] text-foreground-400 leading-relaxed max-w-lg mx-auto mt-3'}>
                  Once they start the process, your training plan, learning materials and progress
                  will appear here automatically.
                </p>
                {commercialWaiting && (
                  <>
                    <p className="text-[14px] text-foreground-500 leading-relaxed max-w-lg mx-auto">
                      {startDate
                        ? <>Your programme is scheduled to start on <strong className="text-foreground-700">{startDate}</strong>.</>
                        : 'Your programme start date has not been set yet.'}
                    </p>
                    <p className="text-[13px] text-foreground-400 leading-relaxed max-w-lg mx-auto mt-3">
                      You will wait until the starting date of the programme to start. Your learning access will become active automatically when the programme begins.
                    </p>
                  </>
                )}
              </div>

              <div className="px-6 md:px-10 py-5 bg-background-100/60 border-t border-foreground-200/60">
                <p className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-3">
                  What happens next
                </p>
                <ol className="space-y-2.5">
                  {[
                    ...(commercialWaiting ? [
                      startDate ? `Your programme starts on ${startDate}.` : 'Your programme start date is confirmed by your programme team.',
                      'You will wait until the programme start date before beginning delivery.',
                      'Your commercial learning access will activate automatically when it starts.',
                    ] : [
                      'The enrolment team reviews your details and starts your enrolment.',
                      'You complete your enrolment form and book your onboarding reviews.',
                      'Your training plan is built and your programme begins.',
                    ]),
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-primary-100 text-primary-700 text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-[13px] text-foreground-600 leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <p className="text-[12px] text-foreground-400 text-center mt-5">
              Need help in the meantime? Use <strong className="text-foreground-500">Contact Support</strong> at
              the bottom of the sidebar.
            </p>
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={isDemoAccount ? 'Materials' : 'Overview'}
      pageSubtitle={isDemoAccount ? undefined : isRealMode ? subtitleParts.join(' · ') : `${p.programme} ${p.programmeLevel} · ${p.employer} · Cohort ${p.cohort}`}
      userName={isRealMode ? heroFullName : p.fullName}
      userRole={isRealMode ? (heroProgramme ? `${heroProgramme} Learner` : 'Learner') : `${p.programme} Apprentice`}
      hidePageChrome={isDemoAccount}
    >
      <PageContainer>

        {/* ================================================================
            PROFILE HEADER
            ================================================================ */}
        {!isDemoAccount && (
          <SectionReveal delay={0}>
            <header
              className="relative overflow-hidden rounded-2xl px-5 py-5 shadow-sm md:px-7 md:py-6"
              style={{ background: 'linear-gradient(108deg, oklch(var(--primary-700)) 0%, oklch(var(--primary-500)) 30%, oklch(var(--primary-100)) 66%, oklch(var(--background-50)) 100%)' }}
            >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-40"
              style={{ backgroundImage: 'radial-gradient(circle at 78% 22%, rgba(255,255,255,.34), transparent 22%), radial-gradient(circle at 60% 100%, rgba(255,255,255,.18), transparent 28%)' }}
            />
            <div className="relative z-10 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <LearnerAvatar
                  name={displayLearnerName}
                  size="lg"
                  className="h-16 w-16 bg-white/20 text-xl text-white ring-white/35"
                />
                <div className="min-w-0">
                  <h1 className="text-2xl font-heading font-bold tracking-tight text-white md:text-3xl">{displayLearnerName}</h1>
                  {headerDescription ? <p className="mt-1 text-[13px] text-white/85">{headerDescription}</p> : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate('/learner/messages')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/80 bg-white px-3 text-[12px] font-semibold text-primary-700 shadow-sm transition hover:bg-white/90"
                >
                  <AppIcon className="ri-chat-3-line" />
                  Message coach
                </button>
                <button
                  type="button"
                  onClick={() => navigate(trainingPlanHref)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-primary-700 shadow-sm transition hover:bg-white/90"
                >
                  <AppIcon className="ri-play-circle-line" />
                  Continue learning
                </button>
              </div>
            </div>
            <div className="relative z-10 mt-5 flex flex-wrap items-center gap-2">
              <ProfileFact icon="ri-stack-line" label="Cohort" value={displayCohort} />
              <ProfileFact icon="ri-flag-2-line" label="Module" value={currentModuleLabel} />
              <ProfileFact icon="ri-user-star-line" label="Coach" value={coachDisplayName} />
              <ProfileFact icon="ri-calendar-event-line" label="Start date" value={startDateDisplay} />
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-[12px] text-white/80">
                <AppIcon className="ri-checkbox-circle-line text-[13px] text-emerald-300" />
                <span className="text-white/65">Status</span>
                <span className="font-semibold text-white">{displayValue(isRealMode ? real?.programmeStatus : p.status)}</span>
              </div>
              <ProfileFact icon="ri-calendar-check-line" label="Planned end" value={plannedEndDisplay} />
            </div>
            </header>
          </SectionReveal>
        )}

        {/* ================================================================
            INSPECTION-DEMO: material cards
            ================================================================ */}
        {isDemoAccount && (
          <SectionReveal delay={0} immediate>
            <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-primary-800 via-primary-600 to-violet-400 px-6 py-7 text-white shadow-lg shadow-primary-950/10 md:px-8">
              <div className="flex flex-wrap items-center justify-between gap-5">
                <div className="flex min-w-0 items-center gap-4">
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/20">
                    <AppIcon className="ri-book-2-line text-2xl" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/65">Learning programme</p>
                    <h1 className="mt-1 text-2xl font-heading font-bold leading-tight text-white">Your Materials</h1>
                    <p className="mt-1 text-[13px] text-white/75">{demoProgramme?.programmeName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-white/10 px-5 py-3 text-right ring-1 ring-white/15">
                    <p className="text-2xl font-bold tabular-nums">{demoMaterialCards.length}</p>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-white/65">Materials</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDemoSignOutOpen(true)}
                    className="inline-flex h-12 items-center gap-2 rounded-2xl bg-white/10 px-4 text-[12px] font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/20"
                  >
                    <AppIcon className="ri-logout-box-r-line text-base" />
                    Logout
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
              {demoMaterialCards.map((material, index) => (
                <div
                  key={material.def.key}
                  className={demoMaterialCards.length % 2 === 1 && index === demoMaterialCards.length - 1 ? 'lg:col-span-2' : undefined}
                >
                  <DemoMaterialCard
                    name={material.def.name}
                    order={material.def.order}
                    summary={material.summary}
                    currentWeekLabel={material.weekStatus.label}
                    complete={material.weekStatus.complete}
                    available={material.available}
                    onContinue={() => openDemoMaterial(material)}
                  />
                </div>
              ))}
            </div>
          </SectionReveal>
        )}

        {/* ================================================================
            COMPACT PROGRESS CARDS
            ================================================================ */}
        {!isDemoAccount && (
          <SectionReveal delay={60}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <ProgressStat icon="ri-road-map-line" label="Programme Progress" value={programmeProgressValue} percent={programmeProgressPercent} caption={programmeProgressCaption} tone="brand" />
              <ProgressStat icon="ri-calendar-check-line" label="Attendance" value={attendanceValue} percent={attendancePercent} caption={attendanceCaption} tone={attendanceTone} />
              <ProgressStat icon="ri-time-line" label="OTJ Hours" value={otjValue} percent={otjPercent} caption={otjCaption} tone={otjTone} />
              <ProgressStat icon="ri-bar-chart-2-line" label="KSB Progress" value={ksbValue} percent={ksbPercent} caption={ksbCaption} tone={ksbTone} />
            </div>
          </SectionReveal>
        )}

        {/* ================================================================
            CONTINUE LEARNING + UPCOMING / MY COACH
            ================================================================ */}
        {!isDemoAccount && <SectionReveal delay={100}>
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Panel>
                <SectionHeader
                  title="Continue Learning"
                  icon="ri-play-circle-line"
                  description={isRealMode ? (currentWeek ? `${currentWeek.week.week} · ${currentWeek.module}` : undefined) : "This week's plan"}
                  actions={
                    (isRealMode && real && journey.length > 0) || !isRealMode ? (
                      <Link to={trainingPlanHref} className="text-[12px] font-semibold text-primary-600 hover:text-primary-700">
                        View full plan
                      </Link>
                    ) : undefined
                  }
                />
                <div className="mt-3">
                  {isRealMode ? (
                    journey.length === 0 ? (
                      loading ? <RowsSkeleton rows={4} /> : <EmptyState size="sm" title="No training plan yet" description="Your training plan will appear here once it's built." />
                    ) : !currentWeek ? (
                      <EmptyState size="sm" title="No training plan yet" description="Your training plan will appear here once it's built." />
                    ) : (
                      <CurrentWeekCard
                        moduleTitle={currentWeek.module}
                        weekLabel={currentWeek.week.week}
                        weekIndex={currentWeek.weekIndex}
                        totalWeeks={currentWeek.totalWeeks}
                        components={currentWeek.week.components}
                        videos={real?.videoProgress ?? []}
                        completions={real?.componentProgress ?? []}
                        kind={kind}
                        learnerId={id}
                        reflectionStatuses={reflectionStatuses}
                        canProgress={canProgress}
                        showReadOnlyNotice={showReadOnlyNotice}
                      />
                    )
                  ) : (
                    <div className="relative">
                      <div className="absolute left-[19px] top-3 bottom-3 w-px bg-background-200" />
                      <div className="space-y-0">
                        {timelineComponents.slice(0, 4).map((comp, i) => {
                          const effectiveStatus = userCompletions[i] ? 'completed' : comp.status;
                          return (
                            <TimelineCard
                              key={comp.id}
                              component={comp}
                              status={effectiveStatus}
                              canMarkComplete={comp.status.toLowerCase() !== 'completed' && !userCompletions[i]}
                              onMarkComplete={() => handleMarkComplete(i)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </Panel>

              <Panel>
                <SectionHeader
                  title="My Tasks"
                  count={tasks.length}
                  description="What needs your attention next"
                  icon="ri-list-check-3"
                  actions={<Link to="/tasks" className="text-[12px] font-semibold text-primary-600 hover:text-primary-700">View all tasks</Link>}
                />
                <div className="mt-3 space-y-2">
                  {tasks.length === 0 ? (
                    <div className="flex min-h-[112px] items-center justify-center gap-4 px-4 py-4 text-left">
                      <TaskEmptyIllustration />
                      <div>
                        <p className="text-[13px] font-semibold text-foreground-900">You&apos;re all caught up</p>
                        <p className="mt-1 text-[12px] text-foreground-500">Nothing needs your attention right now.</p>
                      </div>
                    </div>
                  ) : (
                    tasks.map((t) => (
                      <ActionRow
                        key={t.id}
                        title={t.title}
                        subtitle={t.subtitle}
                        tone={t.tone}
                        status={<StatusBadge tone={t.tone} label={t.tone === 'critical' ? 'Action needed' : 'Needs attention'} />}
                        actions={<RowAction label={t.actionLabel} emphasis="primary" onClick={() => navigate(t.actionHref)} />}
                      />
                    ))
                  )}
                </div>
              </Panel>

              <Panel>
                <SectionHeader
                  title="My Apprenticeship Journey"
                  icon="ri-road-map-line"
                  actions={
                    <Link to={journeyHref} className="text-[12px] font-semibold text-primary-600 hover:text-primary-700">
                      View full journey <AppIcon className="ri-arrow-right-line ml-0.5"></AppIcon>
                    </Link>
                  }
                />
                <div className="mt-4">
                  {isRealMode ? (
                    <MiniJourney real={real} loading={loading} loadError={loadError} journeyHref={journeyHref} />
                  ) : (
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[13px] font-semibold text-foreground-900">{p.overallProgress}% complete</span>
                        <span className="text-[12px] text-foreground-400">Currently on: <span className="font-semibold text-foreground-700">{p.currentModule}</span></span>
                      </div>
                      <ProgressBar percent={p.overallProgress} />
                    </div>
                  )}
                </div>
              </Panel>
            </div>

            <div className="space-y-4 lg:col-span-1">
              <Panel>
                <SectionHeader
                  title="Upcoming"
                  description="Sessions and reviews"
                  actions={<Link to="/learner/calendar" className="text-[12px] font-semibold text-primary-600 hover:text-primary-700">View calendar</Link>}
                />
                <div className="mt-3 space-y-2">
                  {isRealMode && calendarLoading ? (
                    <RowsSkeleton rows={3} avatar={false} />
                  ) : (isRealMode ? upcomingReal : upcomingMock).length === 0 ? (
                    <EmptyState
                      size="sm"
                      title="No upcoming sessions"
                      description={isRealMode ? 'Book a catch-up or support session with your coach.' : undefined}
                      action={<RowAction label="Book a session" icon="ri-calendar-check-line" emphasis="primary" onClick={() => navigate('/learner/calendar')} />}
                    />
                  ) : (
                    (isRealMode ? upcomingReal : upcomingMock).map((item) => (
                      <UpcomingRow key={item.id} {...item} onClick={() => navigate('/learner/calendar')} />
                    ))
                  )}
                </div>
              </Panel>

              <Panel padding="sm">
                <SectionHeader title="My Coach" />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <LearnerAvatar name={coachDisplayName} tone="brand" size="lg" />
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-foreground-900">{coachDisplayName}</p>
                      <p className="truncate text-[12px] text-foreground-500">{coachDisplayEmail || 'Contact your programme team'}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <RowAction label="Message" icon="ri-chat-3-line" onClick={() => navigate('/learner/messages')} />
                    <RowAction label="Book a session" icon="ri-check-line" emphasis="primary" onClick={() => navigate('/learner/calendar')} />
                  </div>
                </div>
              </Panel>

              <Panel>
                <SectionHeader title="Next steps" icon="ri-flashlight-line" />
                <div className="mt-3 space-y-2">
                  <DashboardNextStep icon="ri-book-open-line" label="Review your current module overview" href={trainingPlanHref} tone="brand" />
                  <DashboardNextStep icon="ri-calendar-check-line" label="Book your next coaching session" href="/learner/calendar" tone="positive" />
                  <DashboardNextStep icon="ri-time-line" label="Log an on-the-job activity" href="/learner/otjh" tone="upcoming" iconTone="otj" />
                </div>
              </Panel>
            </div>
          </div>
        </SectionReveal>}

        {/* ================================================================
            MY TASKS
            ================================================================ */}
        {!isDemoAccount && <SectionReveal delay={140}>
          <Panel>
            <SectionHeader title="My Tasks" count={tasks.length} description="What needs your attention next" icon="ri-list-check-3" />
            <div className="mt-3 space-y-2">
              {tasks.length === 0 ? (
                <EmptyState size="sm" icon="ri-checkbox-circle-line" title="You're all caught up" description="Nothing needs your attention right now." />
              ) : (
                tasks.map((t) => (
                  <ActionRow
                    key={t.id}
                    title={t.title}
                    subtitle={t.subtitle}
                    tone={t.tone}
                    status={<StatusBadge tone={t.tone} label={t.tone === 'critical' ? 'Action needed' : 'Needs attention'} />}
                    actions={<RowAction label={t.actionLabel} emphasis="primary" onClick={() => navigate(t.actionHref)} />}
                  />
                ))
              )}
            </div>
          </Panel>
        </SectionReveal>}

        {/* ================================================================
            MY APPRENTICESHIP JOURNEY
            ================================================================ */}
        {!isDemoAccount && <SectionReveal delay={180}>
          <Panel>
            <SectionHeader
              title="My Apprenticeship Journey"
              icon="ri-road-map-line"
              actions={
                <Link to={journeyHref} className="text-[12px] font-semibold text-primary-600 hover:text-primary-700">
                  Open <AppIcon className="ri-arrow-right-line ml-0.5"></AppIcon>
                </Link>
              }
            />
            <div className="mt-4">
              {isRealMode ? (
                <MiniJourney real={real} loading={loading} loadError={loadError} journeyHref={journeyHref} />
              ) : (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-foreground-900">{p.overallProgress}% complete</span>
                    <span className="text-[12px] text-foreground-400">Currently on: <span className="font-semibold text-foreground-700">{p.currentModule}</span></span>
                  </div>
                  <ProgressBar percent={p.overallProgress} />
                </div>
              )}
            </div>
          </Panel>
        </SectionReveal>}

      </PageContainer>
      {demoSignOutOpen && (
        <SignOutConfirmModal
          displayName={heroFullName}
          email={auth.user?.email || auth.account?.email || 'Signed in'}
          onClose={() => setDemoSignOutOpen(false)}
          onConfirm={() => {
            setDemoSignOutOpen(false);
            logout();
          }}
        />
      )}
    </WorkspaceShell>
  );
}

/* ─────────────────────────────────────────────
   SUB-COMPONENTS
   ───────────────────────────────────────────── */

/** One labelled fact in the profile header's meta row. */
function ProfileFact({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-[12px] text-white/80">
      <AppIcon className={`${icon} shrink-0 text-[13px] text-white/75`}></AppIcon>
      <span className="shrink-0 text-white/65">{label}</span>
      <span className="min-w-0 truncate font-semibold text-white">{value || EMPTY_VALUE}</span>
    </span>
  );
}

function LearningEmptyIllustration() {
  return (
    <span aria-hidden="true" className="relative flex h-12 w-16 items-center justify-center">
      <span className="absolute h-9 w-10 -translate-x-2 translate-y-1 rotate-[-8deg] rounded-lg bg-primary-50 shadow-sm ring-1 ring-primary-100" />
      <span className="absolute h-10 w-11 translate-x-1 -translate-y-1 rotate-[8deg] rounded-lg bg-primary-100 shadow-sm ring-1 ring-primary-200/70" />
      <span className="relative flex h-9 w-11 translate-x-1 items-center justify-center rounded-lg bg-primary-500 text-white shadow-md shadow-primary-300/30">
        <AppIcon className="ri-file-list-3-line text-xl" />
      </span>
    </span>
  );
}

function TaskEmptyIllustration() {
  return (
    <span aria-hidden="true" className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
      <span className="absolute top-1.5 h-2 w-5 rounded-full bg-primary-400" />
      <span className="flex h-10 w-9 items-center justify-center rounded-md bg-primary-100 shadow-sm ring-1 ring-primary-200/70">
        <AppIcon className="ri-list-check-3 text-2xl" />
      </span>
    </span>
  );
}

function DashboardNextStep({ icon, label, href, tone = 'brand', iconTone }: { icon: string; label: string; href: string; tone?: StatusTone; iconTone?: 'otj' }) {
  const style = toneStyle(tone);
  const iconClasses = iconTone === 'otj'
    ? 'bg-gradient-to-br from-[#d49a38] via-[#b27715] to-[#8f5e0e] text-white shadow-sm shadow-[#b27715]/35'
    : tone === 'positive'
      ? 'bg-gradient-to-br from-emerald-300 via-emerald-500 to-emerald-700 text-white shadow-sm shadow-emerald-500/30'
      : 'bg-gradient-to-br from-primary-300 via-primary-500 to-primary-700 text-white shadow-sm shadow-primary-500/30';
  return (
    <Link
      to={href}
      className="group flex items-center gap-2.5 rounded-xl border border-foreground-100 bg-background-50 px-3 py-2.5 transition hover:border-primary-200 hover:bg-primary-50/40"
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconClasses}`}>
        <AppIcon className={`${icon} text-[15px]`} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground-700">{label}</span>
      <AppIcon className="ri-arrow-right-s-line shrink-0 text-foreground-300 transition group-hover:translate-x-0.5 group-hover:text-primary-500" />
    </Link>
  );
}

/** A compact stat card: label, value, progress bar, caption. The four "quick health check" cards. */
function ProgressStat({ icon, label, value, percent, caption, tone = 'neutral' }: {
  icon: string; label: string; value: string; percent: number | null; caption?: string; tone?: StatusTone;
}) {
  const style = toneStyle(tone);
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${style.bg} ${tone === 'neutral' ? 'text-foreground-400' : style.text}`}>
        <AppIcon className={`${icon} text-xl`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-foreground-500">{label}</p>
        <p className={`mt-1 text-[22px] font-semibold leading-none tabular-nums ${tone === 'neutral' ? 'text-foreground-900' : style.text}`}>{value}</p>
        <ProgressBar percent={percent} tone={percent == null || tone === 'neutral' ? undefined : style.dot} className="mt-2.5" />
        {caption ? <p className="mt-1.5 truncate text-[12px] leading-snug text-foreground-500">{caption}</p> : null}
      </div>
    </div>
  );
}

/** One row in the Upcoming panel — a date chip, title, and time. */
function UpcomingRow({ day, month, timeLabel, title, subtitle, tone = 'neutral', onClick }: {
  day: string; month: string; timeLabel?: string; title: string; subtitle?: string; tone?: StatusTone; onClick?: () => void;
}) {
  const style = toneStyle(tone);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-foreground-200/60 bg-background-50 px-3 py-2.5 text-left transition hover:border-primary-300/60 hover:shadow-sm"
    >
      <span className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg ${style.bg}`}>
        <span className={`text-[13px] font-bold leading-none ${style.text}`}>{day}</span>
        <span className={`mt-0.5 text-[9px] font-semibold uppercase leading-none ${style.text}`}>{month}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-foreground-900">{title}</span>
        {subtitle ? <span className="block truncate text-[12px] text-foreground-400">{subtitle}</span> : null}
      </span>
      {timeLabel ? <span className="shrink-0 text-[12px] text-foreground-400">{timeLabel}</span> : null}
    </button>
  );
}

/** One component row inside the Continue Learning card. */
function CurrentWeekRow({ c, videos, completions, reflectionStatus, onOpen }: {
  c: JourneyComponent;
  videos: LearnerVideoProgress[];
  completions: LearnerComponentProgress[];
  reflectionStatus?: string;
  onOpen?: () => void;
  /** Inspection-demo accounts only — see isInspectionDemoAccount. */
}) {
  const meta = componentTypeMeta(c.title);
  const prog = componentProgress(c, videos, completions);
  const style = STATE_STYLE[prog.state];
  const actionable = !!onOpen;
  const reflection = REFLECTION_STATUS[reflectionStatus || ''];
  const completed = prog.state === 'watched' || prog.state === 'passed' || prog.state === 'completed';
  const unavailable = !hasComponentContent(c);
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!actionable}
      title={unavailable ? 'Content unavailable' : undefined}
      className={`group relative w-full flex items-center gap-3 overflow-hidden rounded-xl border px-3.5 py-3 text-left transition-smooth ${
        unavailable
          ? 'border-foreground-100 bg-background-100/70 opacity-55 grayscale'
          : completed
          ? 'border-emerald-200 bg-emerald-50/60 shadow-sm shadow-emerald-100/60'
          : 'border-foreground-100 bg-background-50'
      } ${
        actionable
          ? completed
            ? 'cursor-pointer hover:border-emerald-300 hover:bg-emerald-50 hover:shadow-md hover:shadow-emerald-100/70'
            : 'cursor-pointer hover:border-primary-300/70 hover:shadow-sm'
          : 'cursor-default'
      }`}
    >
      {completed && <span className="absolute inset-y-0 left-0 w-1 bg-emerald-500" aria-hidden="true" />}
      <span className={`relative w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${completed ? 'bg-emerald-100' : meta.bg}`}>
        <AppIcon className={`${completed ? 'ri-check-line text-emerald-700' : `${meta.icon} ${meta.color}`} text-[15px]`} />
        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ${completed ? 'ring-emerald-50' : 'ring-background-50'} ${style.dot}`} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-foreground-400">{meta.label}</span>
        <span className={`block text-[13px] font-semibold leading-snug truncate ${completed ? 'text-emerald-950' : 'text-foreground-900'}`}>{meta.detail || meta.label}</span>
        {(prog.state === 'attempted') && (
          <span className="mt-1 flex items-center gap-2">
            <span className="h-1 w-24 rounded-full bg-background-200 overflow-hidden">
              <span className={`block h-full rounded-full ${style.bar}`} style={{ width: `${prog.percent}%` }} />
            </span>
          </span>
        )}
      </span>
      <span className="shrink-0 flex flex-col items-end gap-1">
        {unavailable ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-background-200 px-2 py-0.5 text-[10px] font-semibold text-foreground-500">
            <AppIcon className="ri-lock-line text-[10px]" />Content unavailable
          </span>
        ) : (
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${style.pill}`}>
          {prog.state === 'passed' && <AppIcon className="ri-check-line text-[10px]" />}
          {prog.state === 'watched' && <AppIcon className="ri-check-line text-[10px]" />}
          {prog.state === 'completed' && <AppIcon className="ri-check-line text-[10px]" />}
          {prog.label}{prog.detail ? ` · ${prog.detail}` : ''}
        </span>
        )}
        {reflection && (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${reflection.style}`}>
            <AppIcon className={`${reflection.icon} text-[10px]`} />
            {reflection.label}
          </span>
        )}
        {c.expectedOtjh != null && c.expectedOtjh > 0 && (
          <span className="text-[10px] text-foreground-400 inline-flex items-center gap-1"><AppIcon className="ri-time-line text-[10px]" />{c.expectedOtjh}h</span>
        )}
      </span>
      {actionable && <AppIcon className="ri-arrow-right-s-line text-foreground-300 group-hover:text-primary-500 transition-smooth shrink-0" />}
    </button>
  );
}

/** The Continue Learning card body: progress + this week's components. */
function CurrentWeekCard({ moduleTitle, weekLabel, weekIndex, totalWeeks, components, videos, completions, kind, learnerId, reflectionStatuses, canProgress, showWeekHeading = false, hideHeader = false, showReadOnlyNotice = false }: {
  moduleTitle: string; weekLabel: string; weekIndex: number; totalWeeks: number; components: JourneyComponent[];
  videos: LearnerVideoProgress[]; completions: LearnerComponentProgress[];
  kind?: string; learnerId?: string;
  reflectionStatuses: LearningReflectionStatusMap;
  /** False for a staff/coach viewer: the rows still show progress, but none of
   *  them opens the runner that would record progress as the learner. */
  canProgress: boolean;
  /** Inspection-demo accounts only — see isInspectionDemoAccount. */
  showWeekHeading?: boolean;
  /** Suppress both built-in headings — the inspection-demo drill-down draws
   *  its own week header instead. */
  hideHeader?: boolean;
  /** Show a read-only notice for non-learner viewers. */
  showReadOnlyNotice?: boolean;
}) {
  const navigate = useNavigate();
  const availableComponents = components.filter(hasComponentContent);
  const total = availableComponents.length;
  const done = availableComponents.filter((c) => {
    const s = componentProgress(c, videos, completions).state;
    return s === 'passed' || s === 'watched' || s === 'completed';
  }).length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const period = weekPeriodLabel(weekLabel);

  const openFor = (c: JourneyComponent): (() => void) | undefined => {
    // Returning undefined leaves the row rendered but inert — CurrentWeekRow
    // already draws that state for components with nowhere to open.
    if (!kind || !learnerId || !canProgress) return undefined;
    const q = `?module=${encodeURIComponent(moduleTitle)}&week=${encodeURIComponent(weekLabel)}`;
    if (c.isQuiz && hasComponentContent(c)) return () => navigate(`/learner/quiz/${kind}/${learnerId}/${c.quizMeta!.quizId}${q}`);
    if (c.type === 'video' && c.videoUrl && c.componentId) return () => navigate(`/learner/video/${kind}/${learnerId}/${c.componentId}${q}`);
    if (isOpenableComponent(c)) return () => navigate(`/learner/component/${kind}/${learnerId}/${c.componentId}${q}`);
    return undefined;
  };

  const reflectionStatusFor = (c: JourneyComponent): string => {
    const activityId = c.isQuiz && c.quizMeta?.quizId != null
      ? `quiz-${c.quizMeta.quizId}`
      : c.componentId || '';
    if (!activityId) return '';
    return reflectionStatuses[
      learningReflectionStatusKey(c.isQuiz ? 'quiz' : componentNoun(c.type), activityId)
    ] || '';
  };

  return (
    <div>
      <LearningWeekStrip />
      {showReadOnlyNotice && (
        <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-primary-200/70 bg-primary-50/60 px-3.5 py-2.5">
          <AppIcon className="ri-eye-line mt-0.5 shrink-0 text-[15px] text-primary-600" />
          <p className="text-[12px] leading-snug text-foreground-600">
            <span className="font-semibold text-foreground-800">Viewing read-only.</span>{' '}
            Only the learner can complete activities, upload evidence or submit reflections. You can still book a session.
          </p>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary-100 bg-primary-50/50 px-3.5 py-2.5">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
            <AppIcon className="ri-calendar-event-line text-[15px]" />
          </span>
          <span className="shrink-0 rounded-full bg-background-50 px-2.5 py-1 text-[10px] font-semibold text-primary-700 ring-1 ring-primary-200">
            Week {weekIndex + 1} of {totalWeeks}
          </span>
        </span>
      </div>
      {!hideHeader && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-[13px] font-semibold text-foreground-900">{done}/{total} complete</span>
          <span className="text-[13px] font-semibold tabular-nums text-primary-700">{percent}%</span>
        </div>
      )}
      {!hideHeader && <ProgressBar percent={total ? percent : null} className="mb-4" />}
      {total === 0 ? (
        <div className="mt-3 flex min-h-[138px] flex-col items-center justify-center rounded-xl border border-dashed border-primary-200/70 bg-primary-50/10 px-5 py-5 text-center">
          <LearningEmptyIllustration />
          <p className="mt-2 text-[13px] font-semibold text-primary-700">No components in this week yet.</p>
          <p className="mt-1 text-[12px] text-foreground-400">Check back soon for learning activities.</p>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-foreground-900">{done}/{total} complete</span>
            <span className="text-[13px] font-semibold tabular-nums text-primary-700">{percent}%</span>
          </div>
          <ProgressBar percent={percent} className="mb-4" />
        <div className="space-y-2">
          {components.map((c, i) => (
            <CurrentWeekRow
              key={c.componentId || `${c.title}-${i}`}
              c={c}
              videos={videos}
              completions={completions}
              reflectionStatus={reflectionStatusFor(c)}
              onOpen={openFor(c)}
            />
          ))}
        </div>
        </>
      )}
    </div>
  );
}

function LearningWeekStrip() {
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  return (
    <div className="mb-4 flex items-start px-2 sm:px-5">
      {days.map((day, index) => (
        <Fragment key={day}>
          <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full border ${index === 0 ? 'border-primary-700 bg-primary-700 ring-4 ring-primary-100 text-white' : 'border-foreground-200 bg-background-50 text-transparent'}`}>
              {index === 0 ? <AppIcon className="ri-check-line text-[12px]" /> : null}
            </span>
            <span className={`text-[10px] font-semibold ${index === 0 ? 'text-foreground-700' : 'text-foreground-400'}`}>{day}</span>
          </div>
          {index < days.length - 1 ? <span className="mt-3 h-px flex-1 border-t border-dashed border-foreground-200" /> : null}
        </Fragment>
      ))}
    </div>
  );
}


/* ─────────────────────────────────────────────
   MiniJourney — the learner's journey as a milestone
   track (Start → modules → Gateway) with a progress
   ring on each node and a rich "current module" card.
   ───────────────────────────────────────────── */
type StationTone = 'done' | 'current' | 'upcoming';

/** A node with an SVG progress ring — the fill shows how far through the module the learner is. */
function JourneyNode({ icon, label, sub, tone, pct, href }: { icon: string; label: string; sub?: string; tone: StationTone; pct?: number; href?: string }) {
  const t = tone === 'done'
    ? { fill: '#10b981', bg: 'bg-emerald-500 text-white', label: 'text-foreground-700', shadow: 'shadow-emerald-500/25' }
    : tone === 'current'
      ? { fill: '#7c5cff', bg: 'bg-primary-500 text-white', label: 'text-primary-700 font-semibold', shadow: 'shadow-primary-500/30' }
      : { fill: '#cbd5e1', bg: 'bg-background-100 text-foreground-400', label: 'text-foreground-400', shadow: '' };
  const size = 48, stroke = 3, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  const ringPct = pct != null ? pct : tone === 'done' ? 100 : 0;
  const content = (
    <>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90 absolute inset-0">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="text-background-200" stroke="currentColor" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke={t.fill} strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ - (Math.min(100, ringPct) / 100) * circ} className="transition-all duration-700 ease-out" />
        </svg>
        <span className={`absolute inset-[6px] rounded-full flex items-center justify-center shadow-sm ${t.bg} ${t.shadow} ${tone === 'current' ? 'animate-pulse-slow' : ''}`}>
          <AppIcon className={`${icon} text-base`} />
        </span>
      </div>
      <span className={`text-[11px] leading-tight ${t.label}`}>{label}</span>
      {sub ? <span className="text-[10px] text-foreground-400 leading-none tabular-nums">{sub}</span> : null}
    </>
  );

  return href ? (
    <Link
      to={href}
      aria-label={`Open ${label}`}
      className="group flex w-[76px] shrink-0 cursor-pointer flex-col items-center gap-1.5 rounded-xl py-1 text-center transition-all duration-200 hover:-translate-y-1 hover:bg-primary-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
    >
      {content}
    </Link>
  ) : (
    <div className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 py-1 text-center">
      {content}
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

function MiniJourney({ real, loading, loadError, journeyHref }: { real: LearnerDetail | null; loading: boolean; loadError: string | null; journeyHref: string }) {
  const journey = useMemo(() => buildLearnerJourney(real), [real]);
  const { stations, overallPct, currentIndex } = useMemo(() => buildStations(journey, real), [journey, real]);

  if (loading) return <RowsSkeleton rows={4} className="py-2" />;
  if (loadError) return <EmptyState size="sm" title={loadError} />;
  if (journey.length === 0) return <EmptyState size="sm" title="No training plan built for this learner yet." />;

  const current = currentIndex >= 0 ? stations[currentIndex] : null;
  const allDone = currentIndex === -1 && stations.length > 0;
  const modulesDone = stations.filter((s) => s.status === 'completed').length;

  return (
    <div>
      {/* Overall progress banner */}
      <div className="rounded-xl bg-primary-50/60 border border-primary-100/60 p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-primary-600">Overall progress</span>
          <span className="text-[15px] font-heading font-bold text-foreground-900 tabular-nums">{overallPct}%</span>
        </div>
        <ProgressBar percent={overallPct} height="h-2" />
        <p className="text-[11px] text-foreground-500 mt-1.5">
          {modulesDone}/{stations.length} {stations.length === 1 ? 'module' : 'modules'} complete
          {current ? ` · currently on Module ${current.index + 1}` : allDone ? ' · Gateway ready' : ''}
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
                href={s.status === 'completed' || s.status === 'current' ? `${journeyHref}?module=${s.index + 1}` : undefined}
              />
            </Fragment>
          ))}
          <JourneyConnector filled={allDone} />
          <JourneyNode icon="ri-trophy-fill" label="Gateway" tone={allDone ? 'done' : 'upcoming'} />
        </div>
      </div>

      {/* Current-module card */}
      {current ? (
        <Link
          to={`${journeyHref}?module=${current.index + 1}`}
          aria-label={`Open Module ${current.index + 1}: ${current.module.module}`}
          className="group mt-4 block cursor-pointer rounded-xl border border-primary-200/60 bg-primary-50/30 p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary-300 hover:bg-primary-50/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <div className="flex items-center gap-2 mb-2.5">
            <span className="w-7 h-7 rounded-lg bg-primary-500 text-white flex items-center justify-center shrink-0"><AppIcon className="ri-flag-2-fill text-sm" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-primary-600 leading-none">You are here</p>
              <p className="text-[13px] font-semibold text-foreground-900 truncate leading-tight mt-0.5">{current.module.module}</p>
            </div>
            <span className="ml-auto text-[13px] font-heading font-bold text-primary-700 tabular-nums shrink-0">{current.pct ?? 0}%</span>
            <AppIcon className="ri-arrow-right-line text-primary-500 transition-transform duration-200 group-hover:translate-x-1" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <JourneyStat icon="ri-stack-line" label="Components" value={`${current.componentCount}`} />
            <JourneyStat icon="ri-questionnaire-line" label="Quizzes" value={current.quizTotal > 0 ? `${current.quizTaken}/${current.quizTotal}` : '—'} />
            <JourneyStat icon="ri-play-circle-line" label="Videos" value={current.videoTotal > 0 ? `${current.videoDone}/${current.videoTotal}` : '—'} />
          </div>
        </Link>
      ) : allDone ? (
        <div className="mt-4 rounded-xl border border-emerald-200/60 bg-emerald-50/40 p-3.5 flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center shrink-0"><AppIcon className="ri-trophy-fill" /></span>
          <p className="text-[13px] font-semibold text-emerald-700">All modules complete — you&apos;ve reached the Gateway!</p>
        </div>
      ) : null}
    </div>
  );
}

function JourneyStat({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background-50 border border-foreground-100 px-2 py-2 text-center">
      <AppIcon className={`${icon} text-primary-500 text-sm`} />
      <p className="text-[13px] font-heading font-bold text-foreground-900 leading-none mt-1">{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-foreground-400 mt-0.5">{label}</p>
    </div>
  );
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
            <AppIcon className={`${animating ? 'ri-check-line' : ''} text-white text-[8px]`}></AppIcon>
          </span>
        ) : canMarkComplete ? (
          <span className="flex items-center justify-center w-full h-full rounded-full border-2 border-dashed border-accent-400/60 bg-accent-50 group-hover:border-accent-500 group-hover:bg-accent-100 transition-smooth">
            <AppIcon className="ri-check-line text-accent-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200"></AppIcon>
          </span>
        ) : (
          <span className={`w-[10px] h-[10px] rounded-full block ${
            isToday ? 'bg-accent-500 ring-4 ring-accent-200' :
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
      <Link
        to={`/learner/training-plan`}
        className="flex-1 min-w-0 block"
      >
        <div className={`relative rounded-xl border p-4 transition-smooth cursor-pointer hover:border-primary-300/60 hover:shadow-sm ${isCompleted ? 'border-foreground-200/50 bg-background-50' : 'border-foreground-200/50 bg-background-50'}`}>
          <div className="flex items-start gap-4">
            {/* Type icon */}
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${ts.iconBg} ${ts.iconText}`}>
              <AppIcon className={`${component.typeIcon} text-lg`}></AppIcon>
            </div>

            <div className="flex-1 min-w-0">
              {/* Top row: type chip + status */}
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className={`text-xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${ts.chip}`}>{component.type}</span>
                {component.isLive && !isCompleted && (
                  <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">LIVE</span>
                )}
                {component.status === 'In Progress' && !component.isLive && !isCompleted && (
                  <span className="text-xs font-semibold text-accent-600 bg-accent-50 px-2 py-0.5 rounded-full">Active</span>
                )}
                {isCompleted && (
                  <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <AppIcon className="ri-check-line"></AppIcon> Done
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
                <span className="flex items-center gap-1"><AppIcon className="ri-timer-line"></AppIcon> {component.duration}</span>
                <span className="flex items-center gap-1"><AppIcon className="ri-time-line"></AppIcon> {component.plannedOTJH}h OTJH</span>
                {component.actualOTJH > 0 && (
                  <span className="flex items-center gap-1 text-emerald-600">
                    <AppIcon className="ri-check-line"></AppIcon> {component.actualOTJH}h logged
                  </span>
                )}
                <span className="flex items-center gap-1"><AppIcon className="ri-calendar-line"></AppIcon> {component.dueDate}</span>
                <span className="flex items-center gap-1 text-amber-600"><AppIcon className="ri-coin-line"></AppIcon> {component.points} pts</span>
              </div>
            </div>

            {/* Arrow */}
            <div className="w-9 h-9 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth shrink-0 mt-0.5">
              <AppIcon className="ri-arrow-right-line text-sm"></AppIcon>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}
