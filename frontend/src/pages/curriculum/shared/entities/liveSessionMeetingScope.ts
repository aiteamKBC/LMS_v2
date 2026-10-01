// ============================================================================
// Which calendar delivers a live session: the module's own Teams series, or an
// additional meeting of its own. Never both.
//
// A week delivered by both is the failure this guards: the series books the
// same date as the additional meeting, and the next Update writes the series'
// link over the additional meeting's. So each live session belongs to exactly
// one, chosen by its author and stored on the component (`teamsMeetingScope`),
// and every path that sends the module calendar's dates sends only 'main'.
//
// The backend reads the same rule in `live_session_meeting_scope` (views.py).
// ============================================================================

import type { ModuleCatalogueItem, ModuleWeekSessionPlan } from '../../module-builder/moduleAuthoringData';

export type LiveSessionMeetingScope = 'main' | 'additional' | 'pending';

export const LIVE_SESSION_MEETING_SCOPE_KEY = 'teamsMeetingScope';

type Settings = Record<string, unknown> | undefined | null;

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim());

/**
 * Whether the module's own series already holds a booked occurrence for it.
 *
 * `teamsOccurrenceId`/`teamsSessionNumber` are written only when a real Graph
 * occurrence was paired to the component, unlike `liveSessionUrl`, which the
 * series stamps on every live session regardless.
 */
export function bookedOnModuleSeries(settings: Settings): boolean {
  return Boolean(text(settings?.teamsOccurrenceId) || Number(settings?.teamsSessionNumber || 0) > 0);
}

/** Whether any live session of a module is already booked on its own calendar. */
export function moduleHasBookedSeries(components: Array<{ settings?: Settings }>): boolean {
  return components.some(component => bookedOnModuleSeries(component.settings));
}

/**
 * Which calendar delivers this live session.
 *
 * A booking is the fact and outranks the stored choice. Otherwise the author's
 * choice decides. With neither, a module with no calendar yet delivers it on
 * its own series (there is nothing to overwrite); a module that already has one
 * leaves it 'pending' -- a week added since -- until someone chooses.
 */
export function liveSessionMeetingScope(settings: Settings, moduleHasSeries = true): LiveSessionMeetingScope {
  if (text(settings?.extraTeamsMeetingUrl)) return 'additional';
  if (bookedOnModuleSeries(settings)) return 'main';
  const chosen = text(settings?.[LIVE_SESSION_MEETING_SCOPE_KEY]).toLowerCase();
  if (chosen === 'main' || chosen === 'additional') return chosen;
  return moduleHasSeries ? 'pending' : 'main';
}

/**
 * Whether the author has already given this live session to the module's own
 * calendar, before it was booked there.
 *
 * Just as final as a booking: the next Update books it, and an additional
 * meeting on the same week would then lose its link to the series'. Each week
 * is delivered by one calendar only, so the additional-meeting form refuses it
 * until the choice is changed under "Which calendar runs each week". The
 * server refuses it too (`reserved_for_module_calendar`).
 */
export function reservedForModuleCalendar(settings: Settings): boolean {
  return !bookedOnModuleSeries(settings) && text(settings?.[LIVE_SESSION_MEETING_SCOPE_KEY]).toLowerCase() === 'main';
}

/** Whether the choice can still be changed: nothing has been booked for it on either calendar. */
export function meetingScopeIsOpen(settings: Settings): boolean {
  return !text(settings?.extraTeamsMeetingUrl) && !bookedOnModuleSeries(settings);
}

/**
 * A booked occurrence keeps its historical date in `curriculum.sessions`.
 * The detail modal must still show the current plan that will be sent when a
 * group day/time changes, so overlay the fresh planner result without mutating
 * historical session rows or their Teams identity.
 *
 * Only the dates of the module's own calendar: the Teams Meetings page and the
 * shared plan push (`teamsCalendarPush`) both send what this returns, so a week
 * that is not 'main' can reach Microsoft through neither.
 */
export function liveSessionPlan(module: ModuleCatalogueItem | null, plan: ModuleWeekSessionPlan): ModuleWeekSessionPlan['sessions'] {
  if (!module?.weekStructure?.length) return plan.sessions || [];
  const selected: ModuleWeekSessionPlan['sessions'] = [];
  const hasSeries = moduleHasBookedSeries((module.weekStructure || []).flatMap(
    week => (week.components || []).filter(component => component.type === 'live-session'),
  ));
  let fallbackIndex = 0;
  module.weekStructure.forEach(week => {
    const liveSessions = (week.components || []).filter(component => component.type === 'live-session');
    const liveCount = liveSessions.length;
    if (!liveCount) return;
    const byWeek = (plan.sessions || []).filter(session => Number(session.weekNumber) === Number(week.weekNumber));
    const candidates = byWeek.length
      ? byWeek.slice(0, liveCount)
      : (plan.sessions || []).slice(fallbackIndex, fallbackIndex + liveCount);
    // A live session delivered by its own additional meeting -- or not yet
    // assigned to either calendar -- is not part of this calendar: it is not
    // shown among these dates, not counted among them, and not sent when they
    // are. Its slot is still CONSUMED rather than skipped — the dates are taken
    // in order, so dropping one from the middle without consuming it would pull
    // every later session a slot early.
    candidates.forEach((candidate, index) => {
      if (liveSessionMeetingScope(liveSessions[index]?.settings, hasSeries) !== 'main') return;
      selected.push(candidate);
    });
    fallbackIndex += candidates.length;
  });
  return selected;
}
