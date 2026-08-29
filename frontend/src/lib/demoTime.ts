import { useEffect, useState } from 'react';
import type { LearnerComponentProgress, LearnerQuizAttempt, LearnerVideoProgress } from '@/api/learnerDetail';
import { formatHoursMinutes, gradePercent, hasComponentContent, type JourneyComponent, type JourneyModule } from '@/utils/learnerJourney';

// ============================================================================
// Inspection-demo time layer.
//
// Scoped entirely to the 9 accounts gated by `isInspectionDemoAccount` — see
// learnerFlowAccess.ts. Every figure here is DERIVED from the component/week
// data and progress records the normal learner workspace already fetches
// (expectedOtjh/durationMinutes, quizAttempts, videoProgress,
// componentProgress); nothing here talks to a new endpoint or duplicates the
// real completion logic in learnerJourney.ts.
//
// The one genuinely new piece of state is the "demo time" override: a manual
// edit an authorised demo account can make to the time shown for one
// material, for demonstration purposes. It is stored client-side (browser
// storage), keyed per learner and component, and never changes the learner's
// real recorded progress — it only changes what this inspection layer
// displays on top of it.
// ============================================================================

const OVERRIDE_STORAGE_PREFIX = 'demo_time_override:';
const OVERRIDE_EVENT = 'demo-time-override-changed';

type OverrideMap = Record<string, number>;

function storageKey(scopeKey: string): string {
  return `${OVERRIDE_STORAGE_PREFIX}${scopeKey}`;
}

function readOverrides(scopeKey: string): OverrideMap {
  if (!scopeKey) return {};
  try {
    const raw = localStorage.getItem(storageKey(scopeKey));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as OverrideMap) : {};
  } catch {
    return {};
  }
}

/** A stable key naming one piece of learning content, whichever kind it is —
 * shared by the summary builder, the week/component rows and the runner
 * pages so an edit made in one place is found by every other. */
export function demoTimeKey(input: { isQuiz?: boolean; quizId?: number | string | null; componentId?: string | null }): string {
  if (input.isQuiz) return `quiz-${input.quizId ?? ''}`;
  return input.componentId || '';
}

/** Read the current demo-time override (minutes) for one material, if any. */
export function getDemoTimeOverride(scopeKey: string, key: string): number | null {
  const value = readOverrides(scopeKey)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Set (or, with `null`, clear) the demo-time override for one material. */
export function setDemoTimeOverride(scopeKey: string, key: string, minutes: number | null): void {
  if (!scopeKey || !key) return;
  try {
    const overrides = readOverrides(scopeKey);
    if (minutes == null || !Number.isFinite(minutes)) {
      delete overrides[key];
    } else {
      // Keep second-level precision for the HH:MM:SS editor while retaining
      // minutes as the shared unit used by material/programme summaries.
      overrides[key] = Math.max(0, Math.round(minutes * 60) / 60);
    }
    localStorage.setItem(storageKey(scopeKey), JSON.stringify(overrides));
  } catch {
    /* storage unavailable — the edit only lasts this render */
  }
  window.dispatchEvent(new CustomEvent(OVERRIDE_EVENT, { detail: { scopeKey } }));
}

/** Live overrides for one learner, re-read whenever `setDemoTimeOverride` runs
 * (this tab) or another tab changes the same storage key. */
export function useDemoTimeOverrides(scopeKey: string): OverrideMap {
  const [overrides, setOverrides] = useState<OverrideMap>(() => readOverrides(scopeKey));

  useEffect(() => {
    setOverrides(readOverrides(scopeKey));
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ scopeKey: string }>).detail;
      if (!detail || detail.scopeKey === scopeKey) setOverrides(readOverrides(scopeKey));
    };
    window.addEventListener(OVERRIDE_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(OVERRIDE_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, [scopeKey]);

  return overrides;
}

/** First number in a free-text time label ("about 25 minutes" -> 25). */
function parseFreeTextMinutes(text: string | null | undefined): number | null {
  const match = String(text ?? '').match(/\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

/** "MM:SS" -> minutes, one decimal place. */
function parseClockMinutes(clock: string | null | undefined): number | null {
  const match = String(clock ?? '').match(/^(\d+):(\d{2})$/);
  if (!match) return null;
  return Math.round(((parseInt(match[1], 10) * 60 + parseInt(match[2], 10)) / 60) * 10) / 10;
}

/** The authored expected time for a component, in whole minutes. Tries the
 * component's OTJ hours first (the figure used everywhere else in the
 * workspace), then an authored duration, then a quiz's time limit. */
export function expectedMinutesFor(c: Pick<JourneyComponent, 'expectedOtjh' | 'durationMinutes' | 'quizMeta'>): number | null {
  if (c.expectedOtjh != null && c.expectedOtjh > 0) return Math.round(c.expectedOtjh * 60);
  if (c.durationMinutes != null && c.durationMinutes > 0) return Math.round(c.durationMinutes);
  if (c.quizMeta?.duration != null && c.quizMeta.duration > 0) {
    return c.quizMeta.timeUnit === 'hours' ? Math.round(c.quizMeta.duration * 60) : Math.round(c.quizMeta.duration);
  }
  return null;
}

/** The learner's actual/self-reported time for one completion record, in
 * minutes. Prefers the auto-tracked clock over the free-text label. */
export function actualMinutesFor(record: { timeTaken?: string | null; reportedTime?: string | null } | null | undefined): number | null {
  if (!record) return null;
  return parseClockMinutes(record.timeTaken) ?? parseFreeTextMinutes(record.reportedTime);
}

export function formatDemoMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return '—';
  return formatHoursMinutes(minutes / 60);
}

export type DemoMaterialType = 'video' | 'quiz' | 'powerpoint' | 'reading' | 'podcast' | 'reflection' | 'other';

export function demoMaterialType(type: string | null | undefined, isQuiz?: boolean): DemoMaterialType {
  if (isQuiz) return 'quiz';
  const t = (type || '').trim().toLowerCase();
  if (t === 'video' || t === 'powerpoint' || t === 'reading' || t === 'podcast' || t === 'reflection') return t;
  return 'other';
}

export type DemoCompletionState = 'completed' | 'in-progress' | 'not-started';

/** Mirrors `isComponentComplete`/`progressCountsAsAchieved` in learnerJourney.ts
 * (completed / not), adding the "in progress" state a quiz attempt-without-a-pass
 * already represents but that helper doesn't need to distinguish. */
export function demoCompletionState(c: JourneyComponent, completedIds: Set<string>): DemoCompletionState {
  if (c.isQuiz) {
    const attempts = c.quizAttempts || [];
    if (attempts.some((a) => a.passed)) return 'completed';
    if (attempts.length > 0) return 'in-progress';
    return 'not-started';
  }
  if (c.componentId && completedIds.has(c.componentId)) return 'completed';
  return 'not-started';
}

function latestRecordFor(
  c: JourneyComponent,
  videos: LearnerVideoProgress[],
  completions: LearnerComponentProgress[],
): LearnerQuizAttempt | LearnerVideoProgress | LearnerComponentProgress | null {
  if (c.isQuiz) {
    const attempts = c.quizAttempts || [];
    if (!attempts.length) return null;
    return attempts.reduce((best, a) => (gradePercent(a.grade) > gradePercent(best.grade) ? a : best));
  }
  if (!c.componentId) return null;
  if (c.type === 'video') {
    const matches = videos.filter((v) => v.componentId === c.componentId);
    return matches.length ? matches[matches.length - 1] : null;
  }
  const matches = completions.filter((entry) => entry.componentId === c.componentId);
  return matches.length ? matches[matches.length - 1] : null;
}

export interface DemoComponentTiming {
  key: string;
  title: string;
  materialType: DemoMaterialType;
  expectedMinutes: number | null;
  /** Override when the demo account has set one, otherwise the recorded value. */
  actualMinutes: number | null;
  recordedMinutes: number | null;
  overridden: boolean;
  state: DemoCompletionState;
  quizPassed?: boolean;
  /** The authored curriculum module this component belongs to — used to group
   * rows into a "material" (see demoProgrammeMaterials.ts). Not every legacy
   * row carries one. */
  moduleId?: string | null;
}

/** One row per openable material in the plan, with expected/actual time and
 * completion state — the component-level data the programme summary totals
 * are built from (never a single stored programme total). */
export function buildDemoTimings(
  components: JourneyComponent[],
  videos: LearnerVideoProgress[],
  completions: LearnerComponentProgress[],
  completedIds: Set<string>,
  overrides: OverrideMap,
): DemoComponentTiming[] {
  return components.filter(hasComponentContent).map((c) => {
    const key = demoTimeKey({ isQuiz: c.isQuiz, quizId: c.quizMeta?.quizId, componentId: c.componentId });
    const record = latestRecordFor(c, videos, completions);
    const recordedMinutes = actualMinutesFor(record);
    const override = key ? overrides[key] : undefined;
    return {
      key,
      title: c.title,
      materialType: demoMaterialType(c.type, c.isQuiz),
      expectedMinutes: expectedMinutesFor(c),
      actualMinutes: override ?? recordedMinutes,
      recordedMinutes,
      overridden: override != null,
      state: demoCompletionState(c, completedIds),
      quizPassed: c.isQuiz ? (c.quizAttempts || []).some((a) => a.passed) : undefined,
      moduleId: c.moduleId ?? null,
    };
  });
}

export interface DemoProgrammeSummary {
  expectedMinutes: number;
  completedMinutes: number;
  remainingMinutes: number;
  materialsCompleted: number;
  materialsTotal: number;
  completionPct: number;
  quizzesPassed: number;
  quizzesTotal: number;
}

/** Programme-level totals, always summed from the component rows above —
 * never read from (or written to) a single stored programme-time figure. */
export function summariseDemoTimings(timings: DemoComponentTiming[]): DemoProgrammeSummary {
  const expectedMinutes = timings.reduce((n, t) => n + (t.expectedMinutes || 0), 0);
  const completedMinutes = timings
    .filter((t) => t.state === 'completed')
    .reduce((n, t) => n + (t.actualMinutes ?? t.expectedMinutes ?? 0), 0);
  const materialsTotal = timings.length;
  const materialsCompleted = timings.filter((t) => t.state === 'completed').length;
  const quizzes = timings.filter((t) => t.materialType === 'quiz');
  return {
    expectedMinutes,
    completedMinutes,
    remainingMinutes: Math.max(0, expectedMinutes - completedMinutes),
    materialsCompleted,
    materialsTotal,
    completionPct: materialsTotal ? Math.round((materialsCompleted / materialsTotal) * 100) : 0,
    quizzesPassed: quizzes.filter((t) => t.quizPassed).length,
    quizzesTotal: quizzes.length,
  };
}

// ============================================================================
// Material-level grouping — Component -> Material -> Programme.
//
// A "material" bundles one or more authored curriculum modules (see
// lib/demoProgrammeMaterials.ts). These helpers never introduce a new time
// figure: they partition/aggregate the exact same component-level rows
// `buildDemoTimings`/`summariseDemoTimings` already produce for the whole
// programme, so a material's total is always a subset sum of the programme
// total, never a separately-tracked number.
// ============================================================================

/** Every timing row whose component belongs to one of the given module ids. */
export function timingsForModuleIds(timings: DemoComponentTiming[], moduleIds: string[]): DemoComponentTiming[] {
  if (moduleIds.length === 0) return [];
  const ids = new Set(moduleIds);
  return timings.filter((t) => t.moduleId != null && ids.has(t.moduleId));
}

export interface DemoMaterialWeekStatus {
  /** The first week with incomplete openable content, or null once every
   * week's content is done (or there is none). */
  label: string | null;
  complete: boolean;
}

/** The material's "current week" — the first week (in authored order, across
 * all of the material's constituent modules) that still has incomplete
 * openable content. Mirrors the learner overview's own "first incomplete
 * week" rule, scoped to just this material's modules. */
export function currentWeekStatus(modules: JourneyModule[], completedIds: Set<string>): DemoMaterialWeekStatus {
  for (const mod of modules) {
    for (const week of mod.weeks) {
      const openable = week.components.filter(hasComponentContent);
      if (openable.length === 0) continue;
      const allDone = openable.every((c) => demoCompletionState(c, completedIds) === 'completed');
      if (!allDone) return { label: week.week, complete: false };
    }
  }
  return { label: null, complete: true };
}
