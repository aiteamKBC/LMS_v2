import type { LearnerDetail } from '@/api/learnerDetail';
import type { HomeEvent } from '@/pages/learner/home/homeData';
import { componentRoute } from '@/pages/learner/video-watch/componentRoute';
import { buildLearnerJourney } from '@/utils/learnerJourney';

type SessionRouteEvent = Pick<HomeEvent, 'date' | 'title' | 'moduleId'>;

const liveSessionType = (value?: string | null) => (
  (value || '').trim().toLowerCase().replace(/[\s-]+/g, '_') === 'live_session'
);

function sameDay(value: string | null | undefined, day: string): boolean {
  return !!value && (value.slice(0, 10) === day || (
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === day
  ));
}

/** Build the activity-runner URL for the scheduled session's authored component. */
export function learnerLiveSessionHref(
  detail: LearnerDetail | null,
  event: SessionRouteEvent,
  kind?: string,
  learnerId?: string,
): string | null {
  if (!detail || !event.date || !event.moduleId || !kind || !learnerId) return null;
  const day = event.date.slice(0, 10);
  const candidates = buildLearnerJourney(detail).flatMap((module) => (
    module.weeks.flatMap((week) => week.components
      .filter((component) => liveSessionType(component.type)
        && component.componentId
        && component.moduleId === event.moduleId)
      .map((component) => ({ module: module.module, week: week.week, component })))
  ));
  if (!candidates.length) return null;

  // Authored dates are the authoritative link when a module contains more
  // than one live session. A single undated legacy component remains a safe
  // fallback because it is the only live-session activity for this module.
  const dated = candidates.filter(({ component }) => (
    sameDay(component.sessionDate, day) || sameDay(component.sessionDateTimeUtc, day)
  ));
  const match = dated[0] || (candidates.length === 1 ? candidates[0] : null);
  if (!match) return null;
  return componentRoute(kind, learnerId, match.component, match.module, match.week);
}
