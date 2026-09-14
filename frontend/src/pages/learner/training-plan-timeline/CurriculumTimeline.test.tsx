import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlanCurriculumSlot, PlanSession } from '@/api/trainingPlanDashboard';
import type { ModuleSessionSlot } from '@/pages/curriculum/module-builder/moduleAuthoringData';
import { buildCurriculumTimeline, groupCurriculumTimeline } from './model';
import { CurriculumTimeline } from './CurriculumTimeline';

/**
 * The learner reads the curriculum's own timeline, closures included.
 *
 * The slots below are exactly what `build_module_session_plan` serves for a
 * Monday module starting 13 April 2026 with Monday 4 May closed — the backend
 * half of the same scenario is pinned in
 * backend/learner_api/tests_learner_reading_weeks.py, which additionally asserts
 * the learner payload is byte-identical to the planner's.
 */
const EARLY_MAY = {
  id: 'england-and-wales:2026-05-04',
  label: 'Early May bank holiday',
  startDate: '2026-05-04',
  endDate: '2026-05-04',
  type: 'Bank holiday',
};

function slot(
  slotNumber: number,
  date: string,
  type: PlanCurriculumSlot['type'],
  sessionNumber: number | null,
  holidays: PlanCurriculumSlot['holidays'] = [],
): PlanCurriculumSlot {
  return { slotNumber, date, day: 'Monday', type, cause: type === 'reading-week' ? 'holiday' : '', sessionNumber, holidays };
}

/** Four taught weeks, a holiday, then the two weeks it pushed forward. */
const SLOTS: PlanCurriculumSlot[] = [
  slot(1, '2026-04-13', 'live-session', 1),
  slot(2, '2026-04-20', 'live-session', 2),
  slot(3, '2026-04-27', 'live-session', 3),
  slot(4, '2026-05-04', 'reading-week', null, [EARLY_MAY]),
  slot(5, '2026-05-11', 'live-session', 4),
  slot(6, '2026-05-18', 'live-session', 5),
];

function session(id: string, day: string, title: string, overrides: Partial<PlanSession> = {}): PlanSession {
  return {
    id, moduleId: 'MOD-1', title, start: `${day}T09:00:00+01:00`, end: `${day}T11:00:00+01:00`,
    minutes: 120, joinUrl: null, status: 'scheduled', attended: null, ...overrides,
  };
}

afterEach(cleanup);

describe('building the learner curriculum timeline', () => {
  it('keeps the curriculum slot order, holiday included', () => {
    const rows = buildCurriculumTimeline(SLOTS, []);

    expect(rows.map(row => [row.kind, row.date])).toEqual([
      ['session', '2026-04-13'],
      ['session', '2026-04-20'],
      ['session', '2026-04-27'],
      ['reading-week', '2026-05-04'],
      ['session', '2026-05-11'],
      ['session', '2026-05-18'],
    ]);
  });

  it('never invents a reading week from a gap between session dates', () => {
    // Two sessions a fortnight apart, with no closed slot between them: the
    // gap is not a holiday, and nothing may claim it is.
    const sparse = [slot(1, '2026-04-13', 'live-session', 1), slot(2, '2026-04-27', 'live-session', 2)];

    expect(buildCurriculumTimeline(sparse, []).filter(row => row.kind === 'reading-week')).toEqual([]);
  });

  it('matches each taught slot to the real booked session on that date', () => {
    const rows = buildCurriculumTimeline(SLOTS, [
      session('S1', '2026-04-13', 'Research methods'),
      session('S4', '2026-05-11', 'Data ethics', { attended: false, minutes: 90 }),
    ]);

    const first = rows[0];
    const shifted = rows[4];
    expect(first.kind === 'session' && first.title).toBe('Research methods');
    expect(shifted.kind === 'session' && shifted.title).toBe('Data ethics');
    expect(shifted.kind === 'session' && shifted.attended).toBe(false);
    expect(shifted.kind === 'session' && shifted.minutes).toBe(90);
  });

  it('still dates and numbers a slot with no Teams meeting booked yet', () => {
    const rows = buildCurriculumTimeline(SLOTS, []);
    const row = rows[4];

    expect(row.kind === 'session' && row.sessionNumber).toBe(4);
    expect(row.kind === 'session' && row.title).toBe('Session 4');
    expect(row.kind === 'session' && row.start).toBeNull();
  });

  it('returns nothing for a module with no plannable schedule', () => {
    expect(buildCurriculumTimeline(undefined, [])).toEqual([]);
    expect(buildCurriculumTimeline([], [])).toEqual([]);
  });

  it('never matches one booked session to two slots', () => {
    const rows = buildCurriculumTimeline(SLOTS, [session('S1', '2026-04-13', 'Research methods')]);
    const titled = rows.filter(row => row.kind === 'session' && row.title === 'Research methods');

    expect(titled).toHaveLength(1);
  });
});

describe('month grouping around a holiday shift', () => {
  it('reads a shifted session under the month it is actually delivered in', () => {
    // 25 May closed pushes session 3 from May into June; the reading week stays
    // in May at its own curriculum position.
    const crossing: PlanCurriculumSlot[] = [
      slot(1, '2026-05-11', 'live-session', 1),
      slot(2, '2026-05-18', 'live-session', 2),
      slot(3, '2026-05-25', 'reading-week', null, [{ id: 'h', label: 'Spring bank holiday', startDate: '2026-05-25', endDate: '2026-05-25', type: 'Bank holiday' }]),
      slot(4, '2026-06-01', 'live-session', 3),
      slot(5, '2026-06-08', 'live-session', 4),
    ];
    const groups = groupCurriculumTimeline(buildCurriculumTimeline(crossing, []));

    expect(groups.map(group => [group.key, group.rows.length])).toEqual([['2026-05', 3], ['2026-06', 2]]);
    expect(groups[0].rows.at(-1)?.kind).toBe('reading-week');
    expect(groups[1].rows[0].kind).toBe('session');
  });

  it('keeps the curriculum sequence rather than sorting the groups', () => {
    const groups = groupCurriculumTimeline(buildCurriculumTimeline(SLOTS, []));

    expect(groups.map(group => group.key)).toEqual(['2026-04', '2026-05']);
  });
});

describe('what the learner sees for a holiday reading week', () => {
  it('names the holiday, its date and its type, and says no session runs', () => {
    render(<CurriculumTimeline slots={SLOTS} sessions={[]} />);

    const reading = screen.getByTestId('learner-reading-week');
    expect(within(reading).getByText('Reading Week')).toBeVisible();
    expect(within(reading).getByText('Week 4')).toBeVisible();
    expect(within(reading).getByText('No live session scheduled')).toBeVisible();
    const text = reading.textContent || '';
    expect(text).toContain('Holiday:');
    expect(text).toContain('Early May bank holiday');
    expect(text).toContain('Bank holiday');
    expect(text).toContain('4 May');
  });

  it('shows the note a holiday record carries', () => {
    render(<CurriculumTimeline
      slots={[slot(1, '2026-12-28', 'reading-week', null, [{ ...EARLY_MAY, label: 'Boxing Day', startDate: '2026-12-28', endDate: '2026-12-28', notes: 'Substitute day' }])]}
      sessions={[]} />);

    expect(screen.getByTestId('learner-reading-week').textContent).toContain('Substitute day');
  });

  it('still explains itself when the holiday record carries no name', () => {
    render(<CurriculumTimeline slots={[slot(1, '2026-05-04', 'reading-week', null, [])]} sessions={[]} />);

    const reading = screen.getByTestId('learner-reading-week');
    expect(within(reading).getByText('No live session scheduled')).toBeVisible();
    expect(reading.textContent).toContain('Holiday');
  });

  it('lists the taught weeks in order with the reading week between them', () => {
    render(<CurriculumTimeline slots={SLOTS} sessions={[session('S1', '2026-04-13', 'Research methods')]} />);

    const rows = [...screen.getByTestId('curriculum-timeline').querySelectorAll('li')];
    expect(rows.map(row => row.textContent?.includes('Reading Week'))).toEqual([false, false, false, true, false, false]);
    expect(rows[0].textContent).toContain('Research methods');
    expect(rows[4].textContent).toContain('Session 4');
  });

  it('counts the taught weeks and the reading weeks separately', () => {
    render(<CurriculumTimeline slots={SLOTS} sessions={[]} />);

    expect(screen.getByText('5 sessions · 1 reading week')).toBeVisible();
  });

  it('renders nothing at all for a module with no spine', () => {
    const { container } = render(<CurriculumTimeline slots={[]} sessions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('caps a long module and says how much is left', () => {
    render(<CurriculumTimeline slots={SLOTS} sessions={[]} limit={3} />);

    expect(screen.queryByTestId('learner-reading-week')).not.toBeInTheDocument();
    expect(screen.getByText('3 more weeks in this module.')).toBeVisible();
  });
});

describe('the learner and curriculum slot shapes are one contract', () => {
  it('accepts a curriculum ModuleSessionSlot wherever a PlanCurriculumSlot is expected', () => {
    // A compile-time check, not a runtime one: if either side's slot shape is
    // changed without the other, this file stops type-checking. The two
    // describe the same `build_module_session_plan` output, so they must not
    // be allowed to drift.
    const fromCurriculum: ModuleSessionSlot = {
      slotNumber: 4, date: '2026-05-04', day: 'Monday', type: 'reading-week',
      cause: 'holiday', sessionNumber: null, holidays: [EARLY_MAY],
    };
    const asLearner: PlanCurriculumSlot = fromCurriculum;

    expect(buildCurriculumTimeline([asLearner], [])).toHaveLength(1);
  });
});
