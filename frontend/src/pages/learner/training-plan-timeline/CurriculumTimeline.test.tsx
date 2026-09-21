import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlanCurriculumSlot, PlanSession } from '@/api/trainingPlanDashboard';
import type { ModuleSessionSlot } from '@/pages/curriculum/module-builder/moduleAuthoringData';
import { buildCurriculumTimeline, groupCurriculumTimeline } from './model';
import { CurriculumTimeline } from './CurriculumTimeline';

/**
 * The learner reads the curriculum's own timeline, holidays included.
 *
 * The slots below are exactly what `build_module_session_plan` serves for a
 * Monday module starting 13 April 2026 with Monday 4 May ticked as a holiday —
 * the backend half of the same scenario is pinned in
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
  sessionNumber: number | null,
  holidays: PlanCurriculumSlot['holidays'] = [],
): PlanCurriculumSlot {
  return { slotNumber, date, day: 'Monday', type: 'live-session', cause: holidays.length ? 'holiday' : '', sessionNumber, holidays };
}

/** Six taught weeks, one of them flagged for a ticked holiday. Nothing moves. */
const SLOTS: PlanCurriculumSlot[] = [
  slot(1, '2026-04-13', 1),
  slot(2, '2026-04-20', 2),
  slot(3, '2026-04-27', 3),
  slot(4, '2026-05-04', 4, [EARLY_MAY]),
  slot(5, '2026-05-11', 5),
  slot(6, '2026-05-18', 6),
];

function session(id: string, day: string, title: string, overrides: Partial<PlanSession> = {}): PlanSession {
  return {
    id, moduleId: 'MOD-1', title, start: `${day}T09:00:00+01:00`, end: `${day}T11:00:00+01:00`,
    minutes: 120, joinUrl: null, status: 'scheduled', attended: null, ...overrides,
  };
}

afterEach(cleanup);

describe('building the learner curriculum timeline', () => {
  it('keeps the curriculum slot order, holiday included, and delivers every slot', () => {
    const rows = buildCurriculumTimeline(SLOTS, []);

    expect(rows.map(row => [row.kind, row.date])).toEqual([
      ['session', '2026-04-13'],
      ['session', '2026-04-20'],
      ['session', '2026-04-27'],
      ['session', '2026-05-04'],
      ['session', '2026-05-11'],
      ['session', '2026-05-18'],
    ]);
  });

  it('carries the holiday on the session whose own day it falls on', () => {
    const rows = buildCurriculumTimeline(SLOTS, []);
    const flagged = rows[3];

    expect(flagged.kind === 'session' && flagged.holidays).toEqual([EARLY_MAY]);
    expect(rows.filter(row => row.kind === 'session' && row.holidays.length)).toHaveLength(1);
  });

  it('matches each taught slot to the real booked session on that date', () => {
    const rows = buildCurriculumTimeline(SLOTS, [
      session('S1', '2026-04-13', 'Research methods'),
      session('S4', '2026-05-04', 'Data ethics', { attended: false, minutes: 90 }),
    ]);

    const first = rows[0];
    const onHoliday = rows[3];
    expect(first.kind === 'session' && first.title).toBe('Research methods');
    expect(onHoliday.kind === 'session' && onHoliday.title).toBe('Data ethics');
    expect(onHoliday.kind === 'session' && onHoliday.attended).toBe(false);
    expect(onHoliday.kind === 'session' && onHoliday.minutes).toBe(90);
  });

  it('still dates and numbers a slot with no Teams meeting booked yet', () => {
    const rows = buildCurriculumTimeline(SLOTS, []);
    const row = rows[3];

    expect(row.kind === 'session' && row.sessionNumber).toBe(4);
    expect(row.kind === 'session' && row.title).toBe('Session 4');
    expect(row.kind === 'session' && row.start).toBeNull();
  });

  it('keeps the authored week identity and outcomes for the weekly learning view', () => {
    const rows = buildCurriculumTimeline([
      { ...slot(6, '2026-09-11', 6), weekId: 'W6', weekTitle: 'Campaign planning',
        learningOutcomes: ['Plan a campaign', 'Measure results'] },
    ], []);
    const row = rows[0];

    expect(row.kind === 'session' && row.weekId).toBe('W6');
    expect(row.kind === 'session' && row.weekTitle).toBe('Campaign planning');
    expect(row.kind === 'session' && row.learningOutcomes).toEqual(['Plan a campaign', 'Measure results']);
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

describe('month grouping around a holiday', () => {
  it('reads every session under the month it is actually delivered in', () => {
    const crossing: PlanCurriculumSlot[] = [
      slot(1, '2026-05-11', 1),
      slot(2, '2026-05-18', 2),
      slot(3, '2026-05-25', 3, [{ id: 'h', label: 'Spring bank holiday', startDate: '2026-05-25', endDate: '2026-05-25', type: 'Bank holiday' }]),
      slot(4, '2026-06-01', 4),
      slot(5, '2026-06-08', 5),
    ];
    const groups = groupCurriculumTimeline(buildCurriculumTimeline(crossing, []));

    expect(groups.map(group => [group.key, group.rows.length])).toEqual([['2026-05', 3], ['2026-06', 2]]);
    expect(groups[0].rows.at(-1)?.kind).toBe('session');
    expect(groups[1].rows[0].kind).toBe('session');
  });

  it('keeps the curriculum sequence rather than sorting the groups', () => {
    const groups = groupCurriculumTimeline(buildCurriculumTimeline(SLOTS, []));

    expect(groups.map(group => group.key)).toEqual(['2026-04', '2026-05']);
  });
});

describe('what the learner sees for a session on a holiday', () => {
  it('names the holiday, its date and its type, next to the session that still runs', () => {
    render(<CurriculumTimeline slots={SLOTS} sessions={[]} />);

    const flagged = screen.getByTestId('learner-holiday-session');
    expect(within(flagged).getByText('Week 4')).toBeVisible();
    expect(within(flagged).getByText('Week title to be confirmed')).toBeVisible();
    const text = flagged.textContent || '';
    expect(text).toContain('Early May bank holiday');
    expect(text).toContain('Bank holiday');
    expect(text).toContain('4 May');
    // The session is not cancelled.
    expect(text).not.toContain('No live session scheduled');
  });

  it('shows the note a holiday record carries', () => {
    render(<CurriculumTimeline
      slots={[slot(1, '2026-12-28', 1, [{ ...EARLY_MAY, label: 'Boxing Day', startDate: '2026-12-28', endDate: '2026-12-28', notes: 'Substitute day' }])]}
      sessions={[]} />);

    expect(screen.getByTestId('learner-holiday-session').textContent).toContain('Substitute day');
  });

  it('renders an ordinary session row when nothing is flagged', () => {
    render(<CurriculumTimeline slots={[slot(1, '2026-05-11', 1)]} sessions={[]} />);

    expect(screen.queryByTestId('learner-holiday-session')).not.toBeInTheDocument();
  });

  it('lists the taught weeks in order with the flagged week among them', () => {
    render(<CurriculumTimeline slots={SLOTS} sessions={[session('S1', '2026-04-13', 'Research methods')]} />);

    const rows = [...screen.getByTestId('curriculum-timeline').querySelectorAll('li')];
    expect(rows).toHaveLength(6);
    expect(rows[0].textContent).toContain('Week title to be confirmed');
    expect(rows[0].textContent).not.toContain('Research methods');
    expect(rows[3].textContent).not.toContain('Session 4');
    expect(rows[3].textContent).toContain('Early May bank holiday');
  });

  it('shows the authored week name instead of the booked session name', () => {
    render(<CurriculumTimeline
      slots={[{ ...slot(1, '2026-10-08', 1), weekTitle: 'Understanding customer needs' }]}
      sessions={[session('S1', '2026-10-08', 'Session 1')]} />);

    const row = screen.getByText('Understanding customer needs').closest('li')!;
    expect(row).toHaveTextContent('8 Oct, 09:00 · 120 min');
    expect(row).not.toHaveTextContent('UK time');
    expect(row.textContent?.match(/8 Oct/g)).toHaveLength(1);
    expect(screen.queryByText('Session 1')).not.toBeInTheDocument();
  });

  it('keeps an unbooked week date with the time status on the right', () => {
    render(<CurriculumTimeline
      slots={[{ ...slot(2, '2026-08-14', 2), weekTitle: 'Planning the campaign' }]}
      sessions={[]} />);

    const row = screen.getByText('Planning the campaign').closest('li')!;
    expect(row).toHaveTextContent(/14 Aug(?: 2026)? · Time to be confirmed/);
    expect(row.textContent?.match(/14 Aug/g)).toHaveLength(1);
  });

  it('counts the sessions on a holiday separately from the taught total', () => {
    render(<CurriculumTimeline slots={SLOTS} sessions={[]} />);

    expect(screen.getByText('6 sessions · 1 on a holiday')).toBeVisible();
  });

  it('renders nothing at all for a module with no spine', () => {
    const { container } = render(<CurriculumTimeline slots={[]} sessions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('caps a long module and says how much is left', () => {
    render(<CurriculumTimeline slots={SLOTS} sessions={[]} limit={3} />);

    expect(screen.queryByTestId('learner-holiday-session')).not.toBeInTheDocument();
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
      slotNumber: 4, date: '2026-05-04', day: 'Monday', type: 'live-session',
      cause: 'holiday', sessionNumber: 4, holidays: [EARLY_MAY],
    };
    const asLearner: PlanCurriculumSlot = fromCurriculum;

    expect(buildCurriculumTimeline([asLearner], [])).toHaveLength(1);
  });
});
