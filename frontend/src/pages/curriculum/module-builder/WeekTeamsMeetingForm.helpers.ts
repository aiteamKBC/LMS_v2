import { type TeamsCalendarForm } from '../teams-meetings/createCalendarForm';
import { cleanText } from '../shared/entities/model';
import { bookedOnModuleSeries, reservedForModuleCalendar } from '../shared/entities/liveSessionMeetingScope';
import { type ComponentSettings, type ModuleWeek } from './moduleAuthoringData';


// ============================================================================
// An additional Teams meeting on one week — the second door of the Teams
// dialog, and a different record from the first.
//
// The module's own calendar (the other tab) is one series over every live
// session the module delivers, with one organiser and one invitation list. This
// books a single meeting on a single week for the case that has neither: a
// guest speaker, an employer panel, a resit briefing. It has its own organiser,
// its own co-organisers and its own guests, and it is created, stored and read
// back entirely separately — nothing here creates, updates, reuses, redirects
// to or cancels the module's own meeting, in either direction.
//
// The fields are deliberately the module calendar's own fields, rendered from
// the same components (`TeamsMeetingOptionFields`, `TeamsPeopleFields`,
// `EntraPeopleInput`), so an author books this the way they book that one. What
// is different is only what genuinely differs: a week to attach it to and one
// date of its own, instead of the module's stored session dates.
// ============================================================================

/** The form, in the shape the shared Teams field components already read. */
export interface WeekTeamsMeetingForm extends Pick<TeamsCalendarForm,
  'lobbyBypass' | 'recording' | 'spokenLanguage' | 'presenters' | 'coOrganizers' | 'attendees'> {
  weekId: string;
  title: string;
  organizerEmail: string;
  date: string;
  startTime: string;
  durationMinutes: string;
  details: string;
  scheduleTimeZone: 'Africa/Cairo' | 'Europe/London';
}


export function emptyWeekTeamsMeetingForm(weekId = ''): WeekTeamsMeetingForm {
  return {
    weekId,
    title: '',
    organizerEmail: '',
    date: '',
    startTime: '09:00',
    durationMinutes: '60',
    details: '',
    // England, for the same reason the module calendar defaults to it: the
    // people invited read the hour in their own invitation and turn up for it.
    scheduleTimeZone: 'Europe/London',
    lobbyBypass: 'everyone',
    recording: 'record-transcribe',
    spokenLanguage: 'en-GB',
    presenters: '',
    coOrganizers: '',
    attendees: '',
  };
}


/** The live-session components of a week, in the order the week runs them. */
export function liveSessionsOf(week: ModuleWeek | undefined) {
  return (week?.components || []).filter(component => component.type === 'live-session');
}


/**
 * The ADDITIONAL meeting a live session already holds, if any.
 *
 * Deliberately not `liveSessionUrl`/`teamsMeetingUrl`: those two are the
 * MODULE's calendar, and `attach_teams_meeting_to_module_weeks` stamps them
 * onto every live-session component each time a module with a calendar is
 * saved. Reading them here would mean that the moment the module's own Teams
 * calendar exists — the normal case — every week reported itself as taken and
 * no additional meeting could ever be booked. The module's link is inherited
 * context; it is not an additional meeting and never blocks one.
 */
export function heldAdditionalMeeting(settings: ComponentSettings | undefined): string {
  return cleanText(settings?.extraTeamsMeetingUrl);
}


/**
 * Whether the module's own calendar has already BOOKED this live session.
 *
 * `teamsOccurrenceId`/`teamsSessionNumber` are written only when a real Graph
 * occurrence was paired to the component, unlike `liveSessionUrl`, which the
 * series stamps on every live session regardless. An additional meeting takes
 * the week out of the module series, so a session Microsoft already holds
 * cannot take one — that would strand the occurrence or cancel a meeting people
 * are invited to. The server refuses it too.
 */
export function bookedOnModuleCalendar(settings: ComponentSettings | undefined): boolean {
  return bookedOnModuleSeries(settings);
}


/**
 * The additional meeting already booked on a week, as it was created.
 *
 * Everything the author typed on this form is stored on the component and comes
 * straight back, so choosing a week that already has one shows the meeting
 * rather than a dead end. The backend keeps these values across module saves
 * (`preserve_additional_meeting_settings`), so they survive a builder tab that
 * never saw the booking.
 */
export function existingWeekMeeting(week: ModuleWeek | undefined): ComponentSettings | undefined {
  return liveSessionsOf(week).map(component => component.settings)
    .find(settings => heldAdditionalMeeting(settings));
}


/**
 * Why this week cannot take an additional meeting, in the author's words.
 *
 * Both of these are refusals, not warnings, and the backend enforces the same
 * two before it calls Microsoft — this is the message shown before the click,
 * not the check that protects the data.
 *
 * 1. No live-session component: the link has nowhere to live. A meeting must
 *    never author a component to hold itself; adding live sessions is the
 *    builder's job.
 * 2. Every live session in the week already has an ADDITIONAL meeting of its
 *    own. Nothing here may replace one of those. A week whose live sessions
 *    carry the module's own calendar link is still free: that link belongs to
 *    the other tab and is left exactly as it is.
 */
export function weekMeetingBlock(week: ModuleWeek | undefined): { reason: string; componentId: string } {
  if (!week) return { reason: 'Choose the week this meeting belongs to.', componentId: '' };
  const label = `Week ${week.weekNumber}`;
  const liveSessions = liveSessionsOf(week);
  if (!liveSessions.length) {
    return {
      componentId: '',
      reason: `${label} has no Live Teams Session component, so there is nowhere to keep this meeting’s link. `
        + 'Add a live session to the week and save the module, then book the meeting here.',
    };
  }
  const free = liveSessions.find(component => !heldAdditionalMeeting(component.settings)
    && !bookedOnModuleCalendar(component.settings) && !reservedForModuleCalendar(component.settings));
  if (!free) {
    const spare = liveSessions.filter(component => !heldAdditionalMeeting(component.settings));
    if (!spare.length) {
      const held = liveSessions.length === 1
        ? `${label}’s live session already has an additional meeting.`
        : `Every live session in ${label} already has an additional meeting.`;
      return {
        componentId: '',
        reason: `${held} A live session can hold one, so that no additional meeting is ever replaced. Choose another `
          + 'week, or add another live session to this one. This module’s own Teams calendar is unaffected either way.',
      };
    }
    if (!spare.every(component => bookedOnModuleCalendar(component.settings))) {
      return {
        componentId: '',
        reason: `${label} is set to run on this module’s own Teams calendar. A week is delivered by one calendar `
          + 'only, so it cannot also take an additional meeting. Move it to “Additional meeting” under “Which calendar '
          + 'runs each week” first, or choose another week.',
      };
    }
    const booked = spare.length === 1
      ? `${label}’s live session is already booked on this module’s own Teams calendar.`
      : `Every remaining live session in ${label} is already booked on this module’s own Teams calendar.`;
    return {
      componentId: '',
      reason: `${booked} An additional meeting replaces the week’s module session rather than running alongside it, `
        + 'so it can only be added to a live session that has not been sent to Teams yet. Cancel that session on the '
        + 'Module Teams calendar tab first, or choose another week.',
    };
  }
  return { reason: '', componentId: free.id };
}
