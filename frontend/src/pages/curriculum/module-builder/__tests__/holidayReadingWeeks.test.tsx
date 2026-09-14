import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  createLocalModuleDraft,
  holidayReadingWeeksByWeekId,
  moduleWeekIdBySessionNumber,
  recalculateModule,
  type ModuleCatalogueItem,
  type ModuleWeekSessionPlan,
  type ModuleSessionSlot,
} from '../moduleAuthoringData';
import { HolidayReadingWeekCard } from '../../shared/entities/sessionShiftPreview';

/**
 * A holiday that lands on a delivery day consumes that slot. The curriculum
 * week stays where it is — as a READING WEEK with no live session — and the
 * session that was due there moves down to the next open slot, taking every
 * session behind it with it, in order.
 *
 * The slot spine below is exactly what `build_module_session_plan` serves for a
 * Monday module starting 5 April 2027 with Monday 3 May closed; the backend
 * side of the same scenario is pinned in
 * backend/curriculum_api/tests_holiday_reading_weeks.py.
 */
const EARLY_MAY = {
  id: 'england-and-wales:2027-05-03',
  label: 'Early May bank holiday',
  startDate: '2027-05-03',
  endDate: '2027-05-03',
  type: 'Bank holiday',
};

function slot(overrides: Partial<ModuleSessionSlot> & Pick<ModuleSessionSlot, 'slotNumber' | 'date' | 'type'>): ModuleSessionSlot {
  return {
    day: 'Monday',
    cause: overrides.type === 'reading-week' ? 'holiday' : '',
    sessionNumber: null,
    holidays: [],
    ...overrides,
  };
}

/** The spine and sessions for a six-session Monday module with 3 May closed. */
function planWithOneClosure(): ModuleWeekSessionPlan {
  const delivered = ['2027-04-05', '2027-04-12', '2027-04-19', '2027-04-26', '2027-05-10', '2027-05-17'];
  return {
    sessions: delivered.map((date, index) => ({
      sessionNumber: index + 1,
      date,
      day: 'Monday',
      // Session 5 was due on the closed Monday.
      slotDate: index === 4 ? '2027-05-03' : date,
      slotDay: 'Monday',
      skippedHolidays: index === 4 ? ['2027-05-03'] : [],
    })),
    slots: [
      slot({ slotNumber: 1, date: '2027-04-05', type: 'live-session', sessionNumber: 1 }),
      slot({ slotNumber: 2, date: '2027-04-12', type: 'live-session', sessionNumber: 2 }),
      slot({ slotNumber: 3, date: '2027-04-19', type: 'live-session', sessionNumber: 3 }),
      slot({ slotNumber: 4, date: '2027-04-26', type: 'live-session', sessionNumber: 4 }),
      slot({ slotNumber: 5, date: '2027-05-03', type: 'reading-week', holidays: [EARLY_MAY] }),
      slot({ slotNumber: 6, date: '2027-05-10', type: 'live-session', sessionNumber: 5 }),
      slot({ slotNumber: 7, date: '2027-05-17', type: 'live-session', sessionNumber: 6 }),
    ],
    skippedHolidays: ['2027-05-03'],
    finalEndDate: '2027-05-17',
    originalEndDate: '2027-05-10',
    warnings: [],
  };
}

/** A plan with nothing closed: six open slots, six sessions. */
function planWithNoClosure(): ModuleWeekSessionPlan {
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
      type: 'live-session',
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

describe('placing holiday reading weeks among the authored weeks', () => {
  it('hangs the closed slot above the week that now delivers the displaced session', () => {
    const module = mondayModule();
    const plan = planWithOneClosure();

    const { before, trailing } = holidayReadingWeeksByWeekId(module, plan);

    // Session 5 is the fifth authored week, and the reading week sits above it.
    const fifthWeek = module.weekStructure[4];
    expect(before.get(fifthWeek.id)?.map(item => item.date)).toEqual(['2027-05-03']);
    expect(trailing).toEqual([]);
    // Nothing hangs above any other week.
    expect([...before.keys()]).toEqual([fifthWeek.id]);
  });

  it('inserts nothing when no delivery slot was closed', () => {
    const { before, trailing } = holidayReadingWeeksByWeekId(mondayModule(), planWithNoClosure());

    expect(before.size).toBe(0);
    expect(trailing).toEqual([]);
  });

  it('is inert for a payload that carries no slot spine', () => {
    const plan = planWithOneClosure();
    const { before, trailing } = holidayReadingWeeksByWeekId(mondayModule(), { ...plan, slots: undefined });

    expect(before.size).toBe(0);
    expect(trailing).toEqual([]);
  });

  it('keeps two closures against the two weeks that absorbed them', () => {
    const module = mondayModule(8, 8);
    const plan = planWithOneClosure();
    const twoClosures: ModuleWeekSessionPlan = {
      ...plan,
      sessions: [
        ...plan.sessions,
        { sessionNumber: 7, date: '2027-06-07', day: 'Monday', slotDate: '2027-05-31', slotDay: 'Monday', skippedHolidays: ['2027-05-31'] },
        { sessionNumber: 8, date: '2027-06-14', day: 'Monday', slotDate: '2027-06-07', slotDay: 'Monday', skippedHolidays: [] },
      ],
      slots: [
        ...(plan.slots || []),
        slot({ slotNumber: 8, date: '2027-05-24', type: 'live-session', sessionNumber: 6 }),
        slot({
          slotNumber: 9,
          date: '2027-05-31',
          type: 'reading-week',
          holidays: [{ id: 'england-and-wales:2027-05-31', label: 'Spring bank holiday', startDate: '2027-05-31', endDate: '2027-05-31', type: 'Bank holiday' }],
        }),
        slot({ slotNumber: 10, date: '2027-06-07', type: 'live-session', sessionNumber: 7 }),
        slot({ slotNumber: 11, date: '2027-06-14', type: 'live-session', sessionNumber: 8 }),
      ],
    };

    const { before } = holidayReadingWeeksByWeekId(module, twoClosures);

    expect(before.get(module.weekStructure[4].id)?.map(item => item.date)).toEqual(['2027-05-03']);
    // Session 7 belongs to the seventh authored week, which is where the second
    // closure hangs. No week carries both, and neither closure is dropped.
    expect(before.get(module.weekStructure[6].id)?.map(item => item.date)).toEqual(['2027-05-31']);
    expect([...before.values()].flat()).toHaveLength(2);
  });

  it('keeps consecutive closures together above the week that follows them', () => {
    const module = mondayModule(4, 4);
    const backToBack: ModuleWeekSessionPlan = {
      sessions: [
        { sessionNumber: 1, date: '2027-04-05', day: 'Monday', slotDate: '2027-04-05', skippedHolidays: [] },
        { sessionNumber: 2, date: '2027-04-12', day: 'Monday', slotDate: '2027-04-12', skippedHolidays: [] },
        { sessionNumber: 3, date: '2027-05-03', day: 'Monday', slotDate: '2027-04-19', skippedHolidays: ['2027-04-19', '2027-04-26'] },
        { sessionNumber: 4, date: '2027-05-10', day: 'Monday', slotDate: '2027-04-26', skippedHolidays: [] },
      ],
      slots: [
        slot({ slotNumber: 1, date: '2027-04-05', type: 'live-session', sessionNumber: 1 }),
        slot({ slotNumber: 2, date: '2027-04-12', type: 'live-session', sessionNumber: 2 }),
        slot({ slotNumber: 3, date: '2027-04-19', type: 'reading-week', holidays: [{ id: 'h-1', label: 'First closure', startDate: '2027-04-19', endDate: '2027-04-19' }] }),
        slot({ slotNumber: 4, date: '2027-04-26', type: 'reading-week', holidays: [{ id: 'h-2', label: 'Second closure', startDate: '2027-04-26', endDate: '2027-04-26' }] }),
        slot({ slotNumber: 5, date: '2027-05-03', type: 'live-session', sessionNumber: 3 }),
        slot({ slotNumber: 6, date: '2027-05-10', type: 'live-session', sessionNumber: 4 }),
      ],
      skippedHolidays: ['2027-04-19', '2027-04-26'],
      finalEndDate: '2027-05-10',
      originalEndDate: '2027-04-26',
      warnings: [],
    };

    const { before } = holidayReadingWeeksByWeekId(module, backToBack);

    expect(before.get(module.weekStructure[2].id)?.map(item => item.date)).toEqual(['2027-04-19', '2027-04-26']);
  });

  it('pairs a twice-weekly module with the week that owns each session number', () => {
    // Two delivery days per authored week, so week 2 owns sessions 3 and 4.
    const module = mondayModule(3, 6);
    const byNumber = moduleWeekIdBySessionNumber(module, planWithOneClosure().sessions);

    expect(byNumber.get(1)).toBe(module.weekStructure[0].id);
    expect(byNumber.get(2)).toBe(module.weekStructure[0].id);
    expect(byNumber.get(3)).toBe(module.weekStructure[1].id);
    expect(byNumber.get(5)).toBe(module.weekStructure[2].id);
  });
});

describe('what a holiday reading week shows', () => {
  it('names the holiday, its date and its type, and says no session runs', () => {
    render(
      <HolidayReadingWeekCard
        slot={{ slotNumber: 5, date: '2027-05-03', day: 'Monday', holidays: [{ ...EARLY_MAY, notes: 'Substitute day' }] }}
      />,
    );

    expect(screen.getByText('Week 5')).toBeInTheDocument();
    expect(screen.getByText('Reading week')).toBeInTheDocument();
    expect(screen.getByText('No live session scheduled')).toBeInTheDocument();
    const detail = screen.getByTestId('holiday-reading-week').textContent || '';
    expect(detail).toContain('Holiday:');
    expect(detail).toContain('Early May bank holiday');
    expect(detail).toContain('Bank holiday');
    expect(detail).toContain('Substitute day');
    // Its own date, in the same words the rest of the curriculum reads dates in.
    expect(detail).toContain('3 May 2027');
  });

  it('still explains itself when the holiday record carries no name', () => {
    render(<HolidayReadingWeekCard slot={{ slotNumber: 2, date: '2027-05-03', holidays: [] }} />);

    expect(screen.getByText('No live session scheduled')).toBeInTheDocument();
    expect(screen.getByTestId('holiday-reading-week').textContent).toContain('Holiday');
  });
});
