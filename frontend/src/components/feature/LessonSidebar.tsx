import { useNavigate } from 'react-router-dom';
import {
  buildLearnerJourney, componentTypeMeta, isOpenableComponent, gradePercent,
  type JourneyComponent,
} from '@/utils/learnerJourney';
import type { LearnerDetail } from '@/api/learnerDetail';

/* ═══════════════════════════════════════════════════════
   LessonSidebar — the shared "this week's components + other
   weeks" rail used by every lesson page (video, article/
   component, quiz) so they all present an identical layout:
   main content on the left, this vertical rail on the right.
   ═══════════════════════════════════════════════════════ */

export interface LessonContext {
  moduleTitle: string;
  weekTitle: string;
  weekComponents: JourneyComponent[];
  weeks: { week: string; count: number; active: boolean }[];
}

/** Route a component to the right learner page (video and quiz keep their own routes). */
export function componentRoute(kind: string | undefined, id: string | undefined, c: JourneyComponent, module: string, week: string): string {
  const q = `?module=${encodeURIComponent(module)}&week=${encodeURIComponent(week)}`;
  if (c.isQuiz && c.quizMeta?.quizId != null) {
    return `/learner/quiz/${kind}/${id}/${c.quizMeta.quizId}${q}`;
  }
  const base = (c.type || '').toLowerCase() === 'video' ? 'video' : 'component';
  return `/learner/${base}/${kind}/${id}/${c.componentId}${q}`;
}

/** Can this sidebar row be clicked (a quiz, or any other openable component)? */
export function isNavigableComponent(c: JourneyComponent): boolean {
  return (c.isQuiz && c.quizMeta?.quizId != null) || isOpenableComponent(c);
}

/** Locate a component (by its curriculum id) + its week/module context in the journey. */
export function locateComponent(detail: LearnerDetail | null, componentId: string): LessonContext | null {
  if (!detail) return null;
  const journey = buildLearnerJourney(detail);
  for (const mod of journey) {
    for (const wk of mod.weeks) {
      if (wk.components.some((c) => c.componentId === componentId)) {
        return {
          moduleTitle: mod.module,
          weekTitle: wk.week,
          weekComponents: wk.components,
          weeks: mod.weeks.map((w) => ({ week: w.week, count: w.components.length, active: w.week === wk.week })),
        };
      }
    }
  }
  return null;
}

/** Locate a quiz (by its quizId) + its week/module context in the journey. */
export function locateQuiz(detail: LearnerDetail | null, quizId: number): LessonContext | null {
  if (!detail) return null;
  const journey = buildLearnerJourney(detail);
  for (const mod of journey) {
    for (const wk of mod.weeks) {
      if (wk.components.some((c) => c.isQuiz && c.quizMeta?.quizId === quizId)) {
        return {
          moduleTitle: mod.module,
          weekTitle: wk.week,
          weekComponents: wk.components,
          weeks: mod.weeks.map((w) => ({ week: w.week, count: w.components.length, active: w.week === wk.week })),
        };
      }
    }
  }
  return null;
}

interface LessonSidebarProps {
  ctx: LessonContext | null;
  kind: string | undefined;
  id: string | undefined;
  /** The currently-open lesson, so its row is highlighted (not clickable). */
  activeComponentId?: string | null;
  activeQuizId?: number | null;
  /** Where a week row / other-weeks navigation should go. */
  backHref: string;
}

export function LessonSidebar({ ctx, kind, id, activeComponentId, activeQuizId, backHref }: LessonSidebarProps) {
  const navigate = useNavigate();
  const moduleTitle = ctx?.moduleTitle ?? '';
  const weekTitle = ctx?.weekTitle ?? '';

  const isActiveRow = (c: JourneyComponent): boolean => {
    if (c.isQuiz) return activeQuizId != null && c.quizMeta?.quizId === activeQuizId;
    return activeComponentId != null && c.componentId === activeComponentId;
  };

  return (
    <aside className="space-y-4 lg:sticky lg:top-4">
      <div className="rounded-xl border border-background-300 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-background-300">
          <h2 className="text-sm font-heading font-bold text-foreground-800">{weekTitle || 'This week'}</h2>
          <p className="text-[11px] text-foreground-400 mt-0.5">{ctx?.weekComponents.length ?? 0} components</p>
        </div>
        <ul className="divide-y divide-background-300">
          {(ctx?.weekComponents ?? []).map((c) => {
            const cm = componentTypeMeta(c.title);
            const isCurrent = isActiveRow(c);
            const clickable = isNavigableComponent(c) && !isCurrent;
            const attempts = c.isQuiz ? (c.quizAttempts || []) : [];
            const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
            return (
              <li key={c.componentId || (c.isQuiz ? `quiz-${c.quizMeta?.quizId}` : c.title)}>
                <button
                  disabled={!clickable}
                  onClick={() => clickable && navigate(componentRoute(kind, id, c, moduleTitle, weekTitle))}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                    isCurrent ? 'bg-primary-50' : clickable ? 'hover:bg-background-50 cursor-pointer' : 'cursor-default'
                  }`}
                >
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${cm.bg}`}>
                    <AppIcon className={`${cm.icon} text-[12px] ${cm.color}`} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[9px] font-semibold uppercase tracking-wider text-foreground-400">{cm.label}</span>
                    <span className={`block text-[13px] font-semibold leading-snug truncate ${isCurrent ? 'text-primary-700' : 'text-foreground-800'}`}>
                      {cm.detail || cm.label}
                    </span>
                  </span>
                  {c.isQuiz && lastAttempt && (
                    <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      lastAttempt.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {gradePercent(lastAttempt.grade)}%
                    </span>
                  )}
                  {isCurrent ? (
                    <AppIcon className="ri-focus-3-line text-primary-600 text-sm shrink-0" />
                  ) : clickable ? (
                    <AppIcon className="ri-arrow-right-s-line text-foreground-400 text-sm shrink-0" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {(ctx?.weeks?.length ?? 0) > 1 && (
        <div className="rounded-xl border border-background-300 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-background-300">
            <h2 className="text-sm font-heading font-bold text-foreground-800">{moduleTitle || 'Module'}</h2>
            <p className="text-[11px] text-foreground-400 mt-0.5">{ctx?.weeks.length} weeks</p>
          </div>
          <ul className="divide-y divide-background-300">
            {(ctx?.weeks ?? []).map((w) => (
              <li key={w.week}>
                <button
                  onClick={() => navigate(backHref)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                    w.active ? 'bg-background-100' : 'hover:bg-background-50 cursor-pointer'
                  }`}
                >
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-background-100 text-foreground-500">
                    <AppIcon className="ri-calendar-line text-[12px]" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-[13px] font-semibold leading-snug truncate ${w.active ? 'text-foreground-900' : 'text-foreground-700'}`}>
                      {w.week}
                    </span>
                    <span className="block text-[10px] text-foreground-400">{w.count} components</span>
                  </span>
                  {w.active && <span className="text-[10px] font-semibold text-primary-600 shrink-0">Current</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
