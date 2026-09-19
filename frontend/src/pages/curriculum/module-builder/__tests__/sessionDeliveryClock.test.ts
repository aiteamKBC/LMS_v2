import { describe, expect, it } from 'vitest';
import {
  applyModuleWeekSessionPlan, moduleAuthoredLiveSessions, moduleTeamsPlannedSessions,
  zonedNaiveToUtcIso, type ModuleCatalogueItem, type ModuleWeekSessionPlan,
} from '../moduleAuthoringData';

const dates = ['2026-10-23', '2026-10-30'];
function moduleWithDefaults(): ModuleCatalogueItem {
  return {
    catalogueId: 'MOD-CLOCK', weeks: 2, sessionsNumber: 2,
    deliveryMetadata: { groupId: 'GROUP-CLOCK', startTime: '09:00', endTime: '11:00' },
    weekStructure: dates.map((date, index) => ({
      id: `WEEK-${index}`, weekNumber: index + 1, sessionDate: date,
      components: [{ id: `COMP-${index}`, type: 'live-session', settings: {
        sessionDate: date, sessionDay: 'Friday', sessionTime: '12:00', durationMinutes: 60,
        sessionPurpose: 'Keep this outline', teamsRecording: 'record-transcribe',
      } }],
    })),
  } as unknown as ModuleCatalogueItem;
}
function plan(): ModuleWeekSessionPlan {
  return { sessions: dates.map((date, index) => ({
    sessionNumber: index + 1, weekNumber: index + 1, date, day: 'Friday',
    startTime: '09:00', endTime: '11:00', durationMinutes: 120, skippedHolidays: [],
  })), skippedHolidays: [], finalEndDate: dates[1], warnings: [] };
}

describe('unbooked live-session delivery clocks', () => {
  it('uses the assigned delivery window in the module and Teams preview across DST', () => {
    const module = moduleWithDefaults();
    const before = structuredClone(module);
    expect(moduleAuthoredLiveSessions(module).map(session => [session.startTime, session.durationMinutes]))
      .toEqual([['09:00', 120], ['09:00', 120]]);
    const sessions = moduleTeamsPlannedSessions(module, plan());
    expect(sessions.map(session => [session.startTime, session.endTime]))
      .toEqual([['09:00', '11:00'], ['09:00', '11:00']]);
    expect(sessions.map(session => zonedNaiveToUtcIso(`${session.date}T${session.startTime}`, 'Europe/London')))
      .toEqual(['2026-10-23T08:00:00.000Z', '2026-10-30T09:00:00.000Z']);
    expect(module).toEqual(before);
  });

  it('refreshes stale component clocks even when the dates already match, and is idempotent', () => {
    const result = applyModuleWeekSessionPlan(moduleWithDefaults(), plan(), { followEndDate: false });
    for (const week of result.weekStructure) {
      expect(week.components[0].settings).toMatchObject({ sessionTime: '09:00', durationMinutes: 120,
        teamsDurationMinutes: 120, sessionPurpose: 'Keep this outline', teamsRecording: 'record-transcribe' });
    }
    expect(applyModuleWeekSessionPlan(result, plan(), { followEndDate: false })).toBe(result);
  });

  it('resolves each delivery day separately without applying Monday to Thursday', () => {
    const module = moduleWithDefaults();
    module.weeklySchedule = [
      { day: 'Monday', startTime: '09:00', endTime: '11:00' },
      { day: 'Thursday', startTime: '19:00', endTime: '20:30' },
    ];
    module.weekStructure = [{ ...module.weekStructure[0], sessionDate: '2026-09-07',
      sessionStartTime: '09:00', sessionDurationMinutes: 120,
      components: module.weekStructure.map((week, index) => ({ ...week.components[0], settings: {
        ...week.components[0].settings, sessionDate: index ? '2026-09-10' : '2026-09-07',
      } })),
    }];
    expect(moduleTeamsPlannedSessions(module).map(session => [session.startTime, session.endTime]))
      .toEqual([['09:00', '11:00'], ['19:00', '20:30']]);
  });

  it('preserves a confirmed meeting clock, duration and identity while its neighbour inherits', () => {
    const module = moduleWithDefaults();
    Object.assign(module.weekStructure[0].components[0].settings, {
      teamsLiveSessionId: 'LIVE-EXISTING', teamsSessionNumber: 1, teamsEventId: 'EVENT-EXISTING',
      sessionTime: '11:00', durationMinutes: 90,
    });
    const before = structuredClone(module.weekStructure[0].components[0]);
    expect(moduleTeamsPlannedSessions(module, plan()).map(session => [session.startTime, session.endTime]))
      .toEqual([['11:00', '12:30'], ['09:00', '11:00']]);
    expect(applyModuleWeekSessionPlan(module, plan()).weekStructure[0].components[0]).toEqual(before);
  });

  it('uses a dated session exception from the plan before the recurring delivery clock', () => {
    const schedule = plan();
    Object.assign(schedule.sessions[1], { startTime: '11:00', endTime: '12:30', durationMinutes: 90, rescheduled: true });
    expect(moduleTeamsPlannedSessions(moduleWithDefaults(), schedule)[1])
      .toMatchObject({ startTime: '11:00', endTime: '12:30' });
    const applied = applyModuleWeekSessionPlan(moduleWithDefaults(), schedule);
    expect(moduleAuthoredLiveSessions(applied)[1]).toMatchObject({ startTime: '11:00', durationMinutes: 90 });
  });

  it('normalizes inherited AM/PM values and leaves a different module independent', () => {
    const module = moduleWithDefaults();
    module.deliveryMetadata = { startTime: '11:00 AM', endTime: '1:00 PM' };
    expect(moduleTeamsPlannedSessions(module)[0]).toMatchObject({ startTime: '11:00', endTime: '13:00' });
    expect(moduleTeamsPlannedSessions(moduleWithDefaults())[0]).toMatchObject({ startTime: '09:00', endTime: '11:00' });
  });

  it('retains component times for a legacy module with no delivery window', () => {
    const module = moduleWithDefaults();
    module.deliveryMetadata = {};
    expect(moduleTeamsPlannedSessions(module)[0]).toMatchObject({ startTime: '12:00', endTime: '13:00' });
  });

  it('keeps a session without stored delivery data incomplete in the module', () => {
    const module = moduleWithDefaults();
    module.deliveryMetadata = {};
    module.weekStructure[0].components[0].settings = {};
    expect(moduleAuthoredLiveSessions(module)[0]).toMatchObject({ date: '', startTime: '', durationMinutes: 0 });
  });
});
