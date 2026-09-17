import { describe, expect, it } from 'vitest';
import { allowedSettingKeysForType, validateComponentAuthoring } from '../componentAuthoringModel';

// A live-session component must be saveable in exactly the shape the rest of the
// system stores on it. The settings schema is both the default shape and the
// save allowlist, so a key the code writes but the schema omits is reported as
// an unsupported setting and blocks the save outright — on a module the backend
// itself had just served, because its session planner stamps two of these keys
// onto every live session it dates.
//
// This is the failure that produced "Save failed — 28 issues: Unsupported
// setting "sessionDay" / "teamsStartDateTimeUtc" for live-session", one pair per
// live session in the module, with no way past it from the UI.

/** Every key the curriculum code actually writes into a live session's settings. */
const KEYS_THE_CODE_WRITES = {
  // Stamped by the session planner, on both sides, for every dated live session:
  // `apply_module_session_plan_to_weeks` and `applyModuleWeekSessionPlan`.
  planner: ['sessionDate', 'sessionDay', 'sessionTime', 'sessionDateTimeUtc', 'teamsStartDateTimeUtc', 'durationMinutes'],
  // Written back by `applyModuleTeamsSeries` when a calendar is created from the
  // Course structure rail, and read by the schedule editor afterwards.
  teamsCalendar: [
    'liveSessionUrl', 'teamsMeetingUrl', 'teamsCalendarSeries', 'teamsEventId', 'teamsOnlineMeetingId',
    'teamsLiveSessionId', 'teamsSessionNumber', 'teamsDurationMinutes', 'teamsMeetingOptionsUrl',
    'teamsOrganizerEmail', 'teamsAttendees', 'teamsPresenters', 'teamsCoOrganizers', 'teamsProvider',
    'teamsRepeat', 'teamsRepeatOccurrences', 'teamsLobbyBypass', 'teamsRecording', 'teamsSpokenLanguage',
    'teamsMeetingType',
  ],
};

describe('the live-session settings schema covers what the code stores', () => {
  it.each(Object.entries(KEYS_THE_CODE_WRITES))('accepts every key the %s writes', (_group, keys) => {
    const allowed = allowedSettingKeysForType('live-session');
    expect(keys.filter(key => !allowed.has(key))).toEqual([]);
  });

  it('saves a live session carrying a stamped plan without an unsupported-setting issue', () => {
    // The exact shape the backend serves after dating a module: the two keys
    // below are the ones it adds, and the ones that used to come straight back
    // as a save failure.
    const issues = validateComponentAuthoring({
      id: 'COMP-1', title: 'Live Teams Session 1', type: 'live-session',
      expectedOtjh: 2.5, points: 30, ksbMappings: [],
      settings: {
        sessionDate: '2026-10-09', sessionDay: 'Friday', sessionTime: '09:00',
        sessionDateTimeUtc: '2026-10-09T08:00:00+00:00',
        teamsStartDateTimeUtc: '2026-10-09T08:00:00+00:00',
        durationMinutes: 150, contentStatus: 'Draft', version: '0.1',
      },
    } as never);
    expect(issues.filter(issue => issue.message.includes('Unsupported setting'))).toEqual([]);
  });

  it('still rejects a key nothing writes, so the allowlist stays an allowlist', () => {
    // The point of the schema is that it catches a typo or a stale key. Widening
    // it for the keys above must not have turned it into a pass-through.
    const issues = validateComponentAuthoring({
      id: 'COMP-1', title: 'Live Teams Session 1', type: 'live-session',
      expectedOtjh: 2.5, points: 30, ksbMappings: [],
      settings: { contentStatus: 'Draft', version: '0.1', sessionDayy: 'Friday' },
    } as never);
    expect(issues.some(issue => issue.message.includes('Unsupported setting "sessionDayy"'))).toBe(true);
  });
});
