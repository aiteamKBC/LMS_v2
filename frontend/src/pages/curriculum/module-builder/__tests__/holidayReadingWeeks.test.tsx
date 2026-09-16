import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  createLocalModuleDraft,
  weeksTouchedByHoliday,
  moduleWeekIdBySessionNumber,
  recalculateModule,
  type ModuleCatalogueItem,
  type ModuleWeekSessionPlan,
  type ModuleSessionSlot,
} from '../moduleAuthoringData';
import { WeekHolidayNotice } from '../../shared/entities/sessionShiftPreview';

/**
 * A ticked holiday landing on a delivery day moves nothing. The week keeps its
 * own date, its own place in the run and its own live session -- the plan
 * simply flags that day so the author can see the clash and decide what the
 * week becomes.
 *
 * The slot spine below is exactly what `build_module_session_plan` serves for a
 * Monday module starting 5 April 2027 with Monday 3 May ticked as a holiday;
 * the backend side of the same scenario is pinned in
 * backend/curriculum_api/tests_holiday_reading_weeks.py.
 */
const EARLY_MAY = {
  id: 'england-and-wales:2027-05-03',
  label: 'Early May bank holiday',
  startDate: '2027-05-03',
  endDate: '2027-05-03',
  type: 'Bank holiday',
};

function slot(overrides: Partial<ModuleSessionSlot> & Pick<ModuleSessionSlot, 'slotNumber' | 'date' | 'sessionNumber'>): ModuleSessionSlot {
  return {
    day: 'Monday',
    type: 'live-session',
    cause: (overrides.holidays?.length ?? 0) > 0 ? 'holiday' : '',
    holidays: [],
    ...overrides,
  };
}

/** The spine and sessions for a six-session Monday module with 3 May a holiday. */
function planWithOneHoliday(): ModuleWeekSessionPlan {
  const delivered = ['2027-04-05', '2027-04-12', '2027-04-19', '2027-04-26', '2027-05-03', '2027-05-10'];
  return {
    sessions: delivered.map((date, index) => ({
      sessionNumber: index + 1,
      date,
      day: 'Monday',
      slotDate: date,
      slotDay: 'Monday',
      // Session 5's own day is the ticked holiday.
      skippedHolidays: index === 4 ? ['2027-05-03'] : [],
    })),
    slots: delivered.map((date, index) => slot({
      slotNumber: index + 1,
      date,
      sessionNumber: index + 1,
      holidays: index === 4 ? [EARLY_MAY] : [],
    })),
    skippedHolidays: ['2027-05-03'],
    finalEndDate: '2027-05-10',
    originalEndDate: '2027-05-10',
    warnings: [],
  };
}

/** A plan with no holiday ticked: six ordinary open slots. */
function planWithNoHoliday(): ModuleWeekSessionPlan {
  const delivered = ['2027-04-05', '2027-04-12', '2027-04-19', '2027-04-26', '2027-05-03', '2027-05-10'];
  return {
    sessions: delivered.map((date, index) => ({
      sessionNumber: index + 1,
      date,
      day: 'Monday',
      slotDate: date,
      slotDay: 'Monday',
      skippedHolidays: [],
    })),
    slots: delivered.map((date, index) => slot({
      slotNumber: index + 1,
      date,
      sessionNumber: index + 1,
    })),
    skippedHolidays: [],
    finalEndDate: '2027-05-10',
    originalEndDate: '2027-05-10',
    warnings: [],
  };
}

function mondayModule(weeks = 6, sessionsNumber = weeks): ModuleCatalogueItem {
  return recalculateModule(createLocalModuleDraft({
    programme: 'MSN',
    title: 'Monday module',
    description: '',
    weeks,
    sessionsNumber,
    status: 'draft',
    catalogueId: 'MOD-HOLIDAY',
    startDate: '2027-04-05',
  }));
}

describe('flagging which authored week sits on a ticked holiday', () => {
  it('names the week whose own delivery day the holiday falls on -- nothing moves', () => {
    const module = mondayModule();
    const plan = planWithOneHoliday();

    const touched = weeksTouchedByHoliday(module, plan);

    // Session 5 is the fifth authored week, and it keeps its own date.
    const fifthWeek = module.weekStructure[4];
    expect(touched.get(fifthWeek.id)?.map(item => item.date)).toEqual(['2027-05-03']);
    // The plan's own dates are unmoved: every session runs on its own delivery
    // day, ticked holiday or not.
    expect(plan.sessions.map(session => session.date)).toEqual(
      ['2027-04-05', '2027-04-12', '2027-04-19', '2027-04-26', '2027-05-03', '2027-05-10'],
    );
    // Nothing else is flagged.
    expect([...touched.keys()]).toEqual([fifthWeek.id]);
  });

  it('flags nothing when no delivery slot is a holiday', () => {
    const touched = weeksTouchedByHoliday(mondayModule(), planWithNoHoliday());

    expect(touched.size).toBe(0);
  });

  it('is inert for a payload that carries no slot spine', () => {
    const plan = planWithOneHoliday();
    const touched = weeksTouchedByHoliday(mondayModule(), { ...plan, slots: undefined });

    expect(touched.size).toBe(0);
  });

  it('pairs a twice-weekly module with the week that owns each session number', () => {
    // Two delivery days per authored week, so week 2 owns sessions 3 and 4.
    const module = mondayModule(3, 6);
    const byNumber = moduleWeekIdBySessionNumber(module, planWithOneHoliday().sessions);

    expect(byNumber.get(1)).toBe(module.weekStructure[0].id);
    expect(byNumber.get(2)).toBe(module.weekStructure[0].id);
    expect(byNumber.get(3)).toBe(module.weekStructure[1].id);
    expect(byNumber.get(5)).toBe(module.weekStructure[2].id);
  });
});

describe('what the holiday notice shows', () => {
  it('names the holiday, its date and its type, on the week\'s own date', () => {
    render(
      <WeekHolidayNotice
        slot={{ slotNumber: 5, date: '2027-05-03', day: 'Monday', holidays: [{ ...EARLY_MAY, notes: 'Substitute day' }] }}
      />,
    );

    expect(screen.getByText(/falls on a holiday/i)).toBeInTheDocument();
    const detail = screen.getByTestId('week-holiday-notice').textContent || '';
    expect(detail).toContain('Early May bank holiday');
    expect(detail).toContain('Bank holiday');
    expect(detail).toContain('Substitute day');
    // Its own date, in the same words the rest of the curriculum reads dates in.
    expect(detail).toContain('3 May 2027');
  });
});
