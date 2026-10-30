import { buildLearnerJourney, hasComponentContent, isOpenableComponent, type JourneyComponent } from '@/utils/learnerJourney';
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
  weeks: { week: string; count: number; active: boolean; components: JourneyComponent[] }[];
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
  return (c.isQuiz && hasComponentContent(c)) || isOpenableComponent(c);
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
          weeks: mod.weeks.map((w) => ({ week: w.week, count: w.components.length, active: w.week === wk.week, components: w.components })),
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
          weeks: mod.weeks.map((w) => ({ week: w.week, count: w.components.length, active: w.week === wk.week, components: w.components })),
        };
      }
    }
  }
  return null;
}
