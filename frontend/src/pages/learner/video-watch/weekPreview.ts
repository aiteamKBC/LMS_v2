// ============================================================================
// The week list beside an open activity.
//
// Picking a week there used to navigate straight into one of its components, so
// a learner looking ahead was dropped into an activity they never chose. It now
// expands in place, and this module decides what each expanded week shows.
// ============================================================================
import {
  buildLearnerJourney,
  hasComponentContent,
  isComponentComplete,
  isOpenableComponent,
  type JourneyComponent,
} from '@/utils/learnerJourney';
import type { LearnerDetail } from '@/api/learnerDetail';

/** One week as the sidebar lists it. */
export interface SidebarWeek {
  week: string;
  count: number;
  completed: number;
  active: boolean;
  components: JourneyComponent[];
}

export interface WeekComponentRow {
  component: JourneyComponent;
  /** Whether opening it would show the learner something. */
  openable: boolean;
  complete: boolean;
}

/** True when a sidebar row leads somewhere: a quiz, or any openable component. */
export function isNavigableComponent(component: JourneyComponent): boolean {
  return (component.isQuiz && hasComponentContent(component)) || isOpenableComponent(component);
}

/**
 * The rows for one expanded week, in plan order.
 *
 * Everything the week holds is listed, including what cannot be opened yet —
 * the point of looking ahead is to see what is coming, and hiding half of it
 * would make the count in the row above disagree with the list under it.
 */
export function weekComponentRows(
  week: SidebarWeek | null | undefined,
  completedIds: Set<string>,
): WeekComponentRow[] {
  return (week?.components ?? []).map((component) => ({
    component,
    openable: hasComponentContent(component) && isNavigableComponent(component),
    complete: isComponentComplete(component, completedIds),
  }));
}

/**
 * Which week is expanded after clicking `week`, given what is expanded now.
 *
 * Clicking the open one closes it, so the list always returns to the plain
 * overview the learner started from.
 */
export function toggleExpandedWeek(current: string | null, week: string): string | null {
  return current === week ? null : week;
}


/** Where one activity sits in the plan: its week, its module, its siblings. */
export interface ActivityPlacement {
  moduleTitle: string;
  weekTitle: string;
  weekComponents: JourneyComponent[];
  weeks: SidebarWeek[];
}

/**
 * Find an activity in the learner's plan and describe where it sits.
 *
 * `match` is what identifies it — a component id for everything the component
 * runner opens, a quiz id for a quiz, which has no component id of its own.
 * Returns null when the activity is not in the plan at all, which is the case
 * the sidebar treats as "nothing to list".
 */
export function placeActivity(
  detail: LearnerDetail | null,
  match: { componentId?: string | null; quizId?: number | string | null },
  completedIds: Set<string>,
): ActivityPlacement | null {
  if (!detail) return null;
  const wantedComponent = match.componentId ? String(match.componentId) : '';
  const wantedQuiz = match.quizId != null && match.quizId !== '' ? String(match.quizId) : '';
  if (!wantedComponent && !wantedQuiz) return null;

  for (const module of buildLearnerJourney(detail)) {
    for (const week of module.weeks) {
      const found = week.components.some((component) => (
        wantedComponent
          ? component.componentId === wantedComponent
          : String(component.quizMeta?.quizId ?? '') === wantedQuiz
      ));
      if (!found) continue;
      return {
        moduleTitle: module.module,
        weekTitle: week.week,
        weekComponents: week.components,
        weeks: module.weeks.map((w) => ({
          week: w.week,
          count: w.components.length,
          completed: w.components.filter((c) => isComponentComplete(c, completedIds)).length,
          active: w.week === week.week,
          components: w.components,
        })),
      };
    }
  }
  return null;
}
