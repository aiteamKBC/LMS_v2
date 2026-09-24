import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { PlanModule, TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { barPosition, buildPlanModules, moduleVisualEnd } from './model';
import { dateLabel } from './presentation';
import { ModuleTimeline } from './ModuleTimeline';

/**
 * The learner's module bar has to cover the delivery that actually happens.
 *
 * A cohort holiday closes a delivery slot, the scheduler moves the last session
 * past the module's stored `end_date`, and a bar drawn to the stored date stops
 * before the final session it is meant to contain. The delivery end is read
 * from `effectiveEndDate`, which `attach_curriculum_slots` copies straight off
 * `build_module_session_plan` -- no holiday is read here and no date is
 * recomputed. The stored value is display-only input: nothing is written back.
 */
const EMPTY: TrainingPlanDashboard = {
  months: {}, actual: [], actualAvailable: true, modules: [], moduleLinks: {}, sessions: [],
  reviews: [], coach: { name: 'Coach', bookingUrl: null }, contractStatus: 'ready', generatedAt: '',
};

function planModule(overrides: Partial<PlanModule> = {}): PlanModule {
  return {
    id: 'module-1', title: 'Research Methods', description: null, tutor_name: null, coach_name: null,
    programme_name: null, cohort_name: null, group_name: null, session_week_day: 'Monday',
    session_start_time: null, session_end_time: null, total_otjh: null, weeks_number: 6,
    sessions_number: 6, learning_outcomes: [], start_date: '2026-04-13', end_date: '2026-05-18',
    ...overrides,
  } as PlanModule;
}

/** One learner module built through the real pipeline, not hand-assembled. */
function learnerModule(detail: PlanModule) {
  const data: TrainingPlanDashboard = { ...EMPTY, modules: [detail], moduleLinks: { 'legacy:1': { id: detail.id, title: detail.title || '' } } };
  return buildPlanModules([{ id: 'legacy:1', title: 'Research Methods', source: 'legacy', activities: [] }], data)[0];
}

const caption = (from: string, to: string) => `${dateLabel(from)} – ${dateLabel(to)}`;

function renderTimeline(module: ReturnType<typeof learnerModule>) {
  return render(<MemoryRouter><ModuleTimeline data={EMPTY} modules={[module]} kind="commercial" learnerId="125"
    today="2026-05-01" selectedMonth="2026-05" onMonthChange={vi.fn()} onModuleSelect={vi.fn()} /></MemoryRouter>);
}

afterEach(cleanup);

describe('Case 1 — a holiday moved the last session past the stored end date', () => {
  const module = learnerModule(planModule({ effectiveEndDate: '2026-05-25', originalEndDate: '2026-05-18' }));

  it('draws the bar to the delivery end, not the stored end', () => {
    expect(moduleVisualEnd(module)).toBe('2026-05-25');
  });

  it('captions the bar with the date the module actually finishes teaching', () => {
    renderTimeline(module);
    expect(screen.getByText(caption('2026-04-13', '2026-05-25'))).toBeVisible();
  });

  it('leaves the stored end date on the module untouched', () => {
    // `end` is what every header, fact list and review-window check still reads.
    expect(module.end).toBe('2026-05-18');
    expect(module.detail?.end_date).toBe('2026-05-18');
  });

  it('makes the bar wider than the stored dates would have', () => {
    const stored = barPosition(module.start, module.end, 2026, 0);
    const drawn = barPosition(module.start, moduleVisualEnd(module), 2026, 0);
    expect(drawn!.width).toBeGreaterThan(stored!.width);
    expect(drawn!.left).toBe(stored!.left);
  });
});

describe('Case 2 — no shift', () => {
  it('draws exactly the stored end when delivery agrees with it', () => {
    const module = learnerModule(planModule({ effectiveEndDate: '2026-05-18', originalEndDate: '2026-05-18' }));

    expect(moduleVisualEnd(module)).toBe('2026-05-18');
    expect(moduleVisualEnd(module)).toBe(module.end);
  });

  it('renders the unchanged range', () => {
    renderTimeline(learnerModule(planModule({ effectiveEndDate: '2026-05-18' })));
    expect(screen.getByText(caption('2026-04-13', '2026-05-18'))).toBeVisible();
  });
});

describe('Case 3 — no delivery end on the payload', () => {
  it('falls back to the stored end when effectiveEndDate is missing', () => {
    expect(moduleVisualEnd(learnerModule(planModule()))).toBe('2026-05-18');
  });

  it('falls back when it is null, empty or not a date', () => {
    for (const value of [null, undefined, '', 'not-a-date', '2026-13-45']) {
      const module = learnerModule(planModule({ effectiveEndDate: value as unknown as string }));
      expect(moduleVisualEnd(module)).toBe('2026-05-18');
    }
  });

  it('still falls back for a module carrying no detail at all', () => {
    const module = buildPlanModules([{ id: 'current:x', title: 'No detail', source: 'current', activities: [] }], EMPTY)[0];
    expect(moduleVisualEnd(module)).toBe(module.end);
  });
});

describe('Case 4 — display only', () => {
  it('never writes: the module and its detail are the same objects afterwards', () => {
    const detail = planModule({ effectiveEndDate: '2026-05-25' });
    const before = JSON.stringify(detail);
    const module = learnerModule(detail);

    moduleVisualEnd(module);
    renderTimeline(module);

    expect(JSON.stringify(detail)).toBe(before);
    expect(detail.end_date).toBe('2026-05-18');
  });

  it('issues no request of any kind while rendering the shifted bar', () => {
    // A save, PATCH or refetch would show up here; drawing a bar must do none.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderTimeline(learnerModule(planModule({ effectiveEndDate: '2026-05-25' })));

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('Case 5 — the shift crosses a month boundary', () => {
  const module = learnerModule(planModule({
    start_date: '2026-04-13', end_date: '2026-05-25',
    originalEndDate: '2026-05-25', effectiveEndDate: '2026-06-01',
  }));

  it('extends the visual end into June', () => {
    expect(moduleVisualEnd(module)).toBe('2026-06-01');
  });

  it('widens the bar into the June column', () => {
    const may = barPosition(module.start, '2026-05-25', 2026, 0)!;
    const june = barPosition(module.start, '2026-06-01', 2026, 0)!;
    // Where the June column begins on a twelve-month track, taken from the same
    // helper the track itself uses rather than assumed.
    const juneColumn = barPosition('2026-06-01', '2026-06-01', 2026, 0)!.left;

    expect(may.left + may.width).toBeLessThanOrEqual(juneColumn);
    expect(june.left + june.width).toBeGreaterThan(juneColumn);
  });

  it('captions the bar across the boundary', () => {
    renderTimeline(module);
    expect(screen.getByText(caption('2026-04-13', '2026-06-01'))).toBeVisible();
  });
});

describe('the delivery end can only ever push the bar later', () => {
  it('ignores a delivery end that falls before the stored end', () => {
    // Real data: a module authored to run to October while teaching its last
    // session in June. That gap is authoring, not a closure, and shortening the
    // bar to it would collapse bars no holiday ever moved.
    const module = learnerModule(planModule({ end_date: '2028-10-12', effectiveEndDate: '2028-06-08' }));

    expect(moduleVisualEnd(module)).toBe('2028-10-12');
  });

  it('keeps the bar at the stored end for such a module when rendered', () => {
    renderTimeline(learnerModule(planModule({ start_date: '2026-04-13', end_date: '2026-10-12', effectiveEndDate: '2026-06-08' })));
    expect(screen.getByText(caption('2026-04-13', '2026-10-12'))).toBeVisible();
  });
});

describe('the module header dates stay on the stored value', () => {
  it('separates the bar range from the end date the learner is told', () => {
    const module = learnerModule(planModule({ effectiveEndDate: '2026-05-25' }));

    expect(module.end).toBe('2026-05-18');            // header / fact list / review window
    expect(moduleVisualEnd(module)).toBe('2026-05-25'); // bar only
  });
});

describe('curriculum notes on the module timeline', () => {
  it('marks the note date and exposes the note on focus', () => {
    const note = 'From your curriculum team: Workshop moved to 3 October.';
    const module = learnerModule(planModule({
      start_date: '2026-09-07', end_date: '2026-10-12',
      curriculumSlots: [{
        slotNumber: 9, date: '2026-10-02', day: 'Friday', type: 'live-session',
        sessionNumber: 9, holidays: [{ label: 'Workshop Oct', startDate: '2026-09-27', endDate: '2026-10-03' }],
        weekId: 'week-9', weekTitle: 'Week 9', holidayNote: note,
      }],
    }));

    renderTimeline(module);

    const marker = screen.getByRole('img', { name: 'Week 9 note' });
    expect(marker).toBeVisible();
    fireEvent.focus(marker);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Reading Week');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Week 9');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Heads up, holiday:');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Workshop Oct');
    expect(screen.getByRole('tooltip')).toHaveTextContent(note);
  });
});
