import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { applyModuleWeekSessionPlan, createEmptyComponent, createLocalModuleDraft, liveSessionSlotOverflow,
  moduleWeekSessionSlots, moduleTeamsPlannedSessions, weeksTouchedByHoliday, type ModuleWeekSessionPlan } from '../moduleAuthoringData';
import { WeekHolidayNotice } from '../../shared/entities/sessionShiftPreview';

const holiday = { id: 'HOL-SYNTHETIC', label: 'Campus holiday', startDate: '2026-11-25', endDate: '2026-11-25' };
const plan: ModuleWeekSessionPlan = {
  sessions: [{ sessionNumber: 1, weekNumber: 1, date: '2026-11-19', day: 'Thursday', skippedHolidays: [], startTime: '09:00', durationMinutes: 60 },
    { sessionNumber: 2, weekNumber: 3, date: '2026-12-03', day: 'Thursday', skippedHolidays: [], startTime: '09:00', durationMinutes: 60 }],
  weeks: [{ weekNumber: 1, startDate: '2026-11-19', endDate: '2026-11-22', holidayWeek: false, holidays: [] },
    { weekNumber: 2, startDate: '2026-11-23', endDate: '2026-11-29', holidayWeek: true, holidays: [holiday] },
    { weekNumber: 3, startDate: '2026-11-30', endDate: '2026-12-06', holidayWeek: false, holidays: [] }],
  slots: [], skippedHolidays: ['2026-11-25'], finalEndDate: '2026-12-03', warnings: [],
};

function moduleDraft() {
  return { ...createLocalModuleDraft({ title: 'Synthetic module', programme: 'Synthetic programme', description: '', weeks: 3,
    status: 'draft', startDate: '2026-11-19', endDate: '2026-12-06' }),
    weekBoundaryMode: 'calendar' as const, weekStartsOn: 'Monday',
    weeklySchedule: [{ day: 'Thursday', startTime: '09:00', endTime: '10:00' }] };
}

describe('explicit study weeks', () => {
  it('sends every authored session for1-7 days and1,2,16 weeks without truncating shared calendars', () => {
    const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayAt = (offset: number) => new Date(Date.UTC(2027, 2, 1 + offset)).toISOString().slice(0, 10);
    for (const weeks of [1, 2, 16]) {
      for (let count = 1; count <= 7; count += 1) {
        const draft = { ...createLocalModuleDraft({ title: 'Calendar matrix', programme: 'Synthetic programme',
          description: '', weeks, status: 'draft', startDate: dayAt(0), endDate: dayAt(weeks * 7 - 1) }),
        weekBoundaryMode: 'calendar' as const, weekStartsOn: 'Monday',
        weeklySchedule: names.slice(0, count).map(day => ({ day, startTime: '09:00', endTime: '10:00' })) };
        draft.weekStructure.forEach(week => {
          week.components = names.slice(0, count).map((_, index) => createEmptyComponent(week.id, 'live-session', index + 1));
        });
        const dates = Array.from({ length: weeks * 7 }, (_, index) => index).filter(index => index % 7 < count);
        const matrix: ModuleWeekSessionPlan = {
          sessions: dates.map((offset, index) => ({ sessionNumber: index + 1, weekNumber: Math.floor(offset / 7) + 1,
            date: dayAt(offset), day: names[offset % 7], startTime: '09:00', durationMinutes: 60, skippedHolidays: [] })),
          weeks: draft.weekStructure.map((_, index) => ({ weekNumber: index + 1, startDate: dayAt(index * 7),
            endDate: dayAt(index * 7 + 6), holidays: [], holidayWeek: false })), slots: [], warnings: [],
          skippedHolidays: [], finalEndDate: dayAt(dates[dates.length - 1]),
        };
        const dated = applyModuleWeekSessionPlan(draft, matrix);
        const sent = moduleTeamsPlannedSessions(dated, matrix);
        expect(sent).toHaveLength(weeks * count);
        expect(new Set(sent.map(session => session.componentId)).size).toBe(weeks * count);
        expect(sent.map(session => session.date)).toEqual(dates.map(dayAt));
        expect(sent.every(session => session.startTime === '09:00' && session.endTime === '10:00')).toBe(true);
        expect(dated.endDate).toBe(dayAt(weeks * 7 - 1));
      }
    }
  });

  it('keeps three week containers and one holiday notice even when the holiday is before the live day', () => {
    const module = applyModuleWeekSessionPlan(moduleDraft(), plan);
    expect(module.weekStructure).toHaveLength(3);
    expect(module.endDate).toBe('2026-12-06');
    expect(module.weekStructure[1]).toMatchObject({ studyWeekStartDate: '2026-11-23', studyWeekEndDate: '2026-11-29', studyWeekHolidays: [holiday] });
    expect(moduleWeekSessionSlots(module, plan.sessions)).toEqual([1, 0, 1]);
    const notices = weeksTouchedByHoliday(module, plan);
    expect(notices.size).toBe(1);
    expect(notices.get(module.weekStructure[1].id)).toHaveLength(1);
    render(<WeekHolidayNotice slot={notices.get(module.weekStructure[1].id)![0]} />);
    expect(screen.getAllByTestId('week-holiday-notice')).toHaveLength(1);
    expect(screen.getByText('Holiday week · materials remain available')).toBeInTheDocument();
  });

  it('keeps reading and quizzes while refusing new manual Live in a holiday week', () => {
    const draft = moduleDraft();
    const week = draft.weekStructure[1];
    const reading = createEmptyComponent(week.id, 'reading', 1);
    const quiz = createEmptyComponent(week.id, 'quiz', 2);
    const live = { ...createEmptyComponent(week.id, 'live-session', 3), settings: { sessionDate: '2026-11-26', sessionTime: '14:00', durationMinutes: 60 } };
    week.components = [reading, quiz, live];
    const module = applyModuleWeekSessionPlan(draft, plan);
    expect(module.weekStructure[1].components).toEqual([reading, quiz]);
    expect(draft.weekStructure[1].components).toEqual([reading, quiz, live]);
    expect(liveSessionSlotOverflow(module, 1, 1, plan.sessions)).toBeNull();
    expect(moduleTeamsPlannedSessions(module, plan)).toEqual([]);
    expect(module.endDate).toBe(draft.endDate);
  });

  it('still enriches holiday weeks when every automatic live session is paused', () => {
    const module = applyModuleWeekSessionPlan(moduleDraft(), { ...plan, sessions: [], weeks: plan.weeks!.map(w => ({ ...w, holidayWeek: true, holidays: [holiday] })) });
    expect(moduleWeekSessionSlots(module, [])).toEqual([0, 0, 0]);
    expect(weeksTouchedByHoliday(module, undefined).size).toBe(3);
    expect(module.weekStructure.every(w => w.components.length === 0)).toBe(true);
  });

  it('does not apply future metadata to a legacy module', () => {
    const { weekBoundaryMode: _mode, ...legacy } = moduleDraft();
    const module = applyModuleWeekSessionPlan(legacy, plan);
    expect(module.weekStructure.every(w => w.studyWeekStartDate === undefined)).toBe(true);
    expect(weeksTouchedByHoliday(module, plan).size).toBe(0);
  });
});
