// ============================================================================
// Sending a module's own session plan to the Teams calendar it drifted from.
//
// The Teams Meetings page sends the module's *stored* session dates. Once a
// series exists those dates and the tracked occurrences describe each other --
// the structure reader leaves a component's date alone when it carries a
// tracked occurrence, and the occurrence was written from that same date -- so
// neither side moves when the delivery days change, and re-sending them would
// only put the old dates back.
//
// The dates here come from the module's plan instead: the backend's own walk
// over the new delivery days and the cohort's ticked holidays, which is the
// only source that has actually moved. Asking the server for it rather than
// deriving it here is what keeps the pushed dates identical to the ones every
// other screen shows.
// ============================================================================

import { fetchModuleSessionPlan, updateTeamsMeetingSchedule, zonedNaiveToUtcIso } from '../../module-builder/moduleAuthoringData';
import { fetchCurriculumTeamsMeetingSummaries } from '@/lib/curriculumApi';

/** The group's own hour, when a series has none of its own to keep. */
const FALLBACK_START_TIME = '09:00';
const FALLBACK_DURATION_MINUTES = 60;

function minutesBetween(startTime: string, endTime: string): number {
  const [startHour, startMinute] = String(startTime || '').split(':').map(Number);
  const [endHour, endMinute] = String(endTime || '').split(':').map(Number);
  if ([startHour, startMinute, endHour, endMinute].some(value => !Number.isFinite(value))) return 0;
  return (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
}

export interface TeamsCalendarPushResult {
  /** How many dates the calendar was sent. */
  sessionCount: number;
  /** Graph's own complaint, when it took the series but not every instance. */
  warning: string;
}

/**
 * Put a module's Teams series onto the dates its plan now says.
 *
 * `weeks` is the authored week count when the caller knows it. The endpoint
 * multiplies it by the delivery days itself, and passing it keeps the plan
 * right for a module whose stored session count has not been re-derived.
 *
 * Throws when there is no tracked series, no plan, or Graph refuses the write:
 * a push that quietly did nothing would leave the reader believing the
 * invitations had moved.
 */
export async function pushModulePlanToTeams({
  moduleCatalogueId,
  moduleName,
  weeks,
  startTime,
  endTime,
}: {
  moduleCatalogueId: string;
  moduleName?: string;
  weeks?: number;
  startTime?: string;
  endTime?: string;
}): Promise<TeamsCalendarPushResult> {
  const catalogueId = String(moduleCatalogueId || '').trim();
  if (!catalogueId) throw new Error('This module has no catalogue id to plan from.');

  const [plan, summaries] = await Promise.all([
    fetchModuleSessionPlan(catalogueId, weeks),
    fetchCurriculumTeamsMeetingSummaries(undefined, { moduleCatalogueIds: [catalogueId], skipCache: true }),
  ]);

  const planned = (plan?.sessions || []).filter(session => String(session?.date || '').trim());
  if (!planned.length) throw new Error('This module has no planned session dates to send.');

  const summary = summaries.find(item => String(item.moduleCatalogueId || '').trim() === catalogueId);
  if (!summary?.liveSessionId) throw new Error('This module has no Teams meeting to update.');

  const time = String(startTime || '').slice(0, 5) || FALLBACK_START_TIME;
  const duration = Math.max(
    15,
    minutesBetween(time, String(endTime || '')) || summary.durationMinutes || FALLBACK_DURATION_MINUTES,
  );
  const occurrences = planned.map((session, index) => ({
    sessionNumber: index + 1,
    startDateTimeUtc: zonedNaiveToUtcIso(`${session.date}T${time}`),
    durationMinutes: duration,
  }));

  const result = await updateTeamsMeetingSchedule(summary.liveSessionId, {
    title: String(moduleName || summary.moduleTitle || '').trim() || 'Live session',
    organizerEmail: summary.organizerEmail,
    eventId: summary.eventId,
    localStartDateTime: `${planned[0].date}T${time}`,
    startDateTimeUtc: occurrences[0].startDateTimeUtc,
    durationMinutes: duration,
    repeat: occurrences.length > 1 ? 'weekly' : 'none',
    repeatOccurrences: occurrences.length,
    scheduledOccurrences: occurrences,
  });

  return {
    sessionCount: occurrences.length,
    warning: String(result?.warnings?.[0]?.message || '').trim(),
  };
}
