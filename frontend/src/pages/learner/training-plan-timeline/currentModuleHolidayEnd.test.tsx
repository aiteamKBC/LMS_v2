import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { PlanModule, TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { buildPlanModules, moduleVisualEnd } from './model';
import { ModuleTimeline } from './ModuleTimeline';

/**
 * "Currently in progress" has to mean the same thing as the bar on the chart.
 *
 * The Gantt already draws to `moduleVisualEnd`, so a closure that pushes the last
 * session past the stored end date leaves the bar running while the stored date
 * has passed. Deciding "current" from the stored date alone made the timeline
 * disagree with itself: the bar said the module was still being delivered and the
 * Current module button said nothing was. Both now read the one helper, which
 * only ever pushes the end later -- a delivery end that lands EARLIER than the
 * stored end is authoring slack, not a finished module.
 */
const TODAY = '2026-06-10';
const EMPTY: TrainingPlanDashboard = {
  months: {}, actual: [], actualAvailable: true, modules: [], moduleLinks: {}, sessions: [],
  reviews: [], coach: { name: 'Coach', bookingUrl: null }, contractStatus: 'ready', generatedAt: '',
};

function planModule(overrides: Partial<PlanModule> = {}): PlanModule {
  return {
    id: 'module-1', title: 'Research Methods', description: null, tutor_name: null, coach_name: null,
    programme_name: null, cohort_name: null, group_name: null, session_week_day: 'Monday',
    session_start_time: null, session_end_time: null, total_otjh: null, weeks_number: 6,
    sessions_number: 6, learning_outcomes: [], start_date: '2026-02-02', end_date: '2026-05-20',
    ...overrides,
  } as PlanModule;
}

/** Learner modules built through the real pipeline, not hand-assembled. */
function learnerModules(...details: PlanModule[]) {
  const data: TrainingPlanDashboard = { ...EMPTY, modules: details,
    moduleLinks: Object.fromEntries(details.map(detail => [`legacy:${detail.id}`, { id: detail.id, title: detail.title || '' }])) };
  return buildPlanModules(details.map(detail => ({ id: `legacy:${detail.id}`, title: detail.title || '', source: 'legacy' as const, activities: [] })), data);
}

function renderTimeline(modules: ReturnType<typeof learnerModules>) {
  return render(<MemoryRouter><ModuleTimeline data={EMPTY} modules={modules} kind="commercial" learnerId="125"
    today={TODAY} selectedMonth="2026-06" onMonthChange={vi.fn()} onModuleSelect={vi.fn()} /></MemoryRouter>);
}

/** What the learner actually gets from the one button derived from `currentModules`. */
function jumpToCurrent() {
  fireEvent.click(screen.getByRole('button', { name: 'Current module' }));
  const panel = screen.queryByRole('complementary', { name: 'Timeline module details' });
  return panel ? within(panel).getByRole('heading', { level: 3 }).textContent : null;
}

afterEach(cleanup);

describe('Case 1 — a holiday extended delivery past the stored end', () => {
  // stored end 20 May, delivery runs to 8 July, today is 10 June.
  const detail = planModule({ end_date: '2026-05-20', originalEndDate: '2026-05-20', effectiveEndDate: '2026-07-08' });

  it('still counts the module as current', () => {
    const [module] = learnerModules(detail);
    expect(module.end).toBe('2026-05-20');
    expect(moduleVisualEnd(module)).toBe('2026-07-08');
    expect(moduleVisualEnd(module) >= TODAY).toBe(true);
  });

  it('resolves it from the Current module button instead of reporting none', () => {
    renderTimeline(learnerModules(detail));
    expect(jumpToCurrent()).toBe('Research Methods');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('agrees with the bar it draws: both run to the delivery end', () => {
    renderTimeline(learnerModules(detail));
    expect(screen.getByRole('button', { name: 'Show Research Methods overview' }))
      .toHaveAttribute('title', expect.stringContaining('8 Jul'));
  });
});

describe('Case 2 — an ordinary current module', () => {
  it('stays current when today sits inside the stored range and delivery agrees', () => {
    const detail = planModule({ end_date: '2026-07-20', effectiveEndDate: '2026-07-20' });
    const [module] = learnerModules(detail);

    expect(moduleVisualEnd(module)).toBe(module.end);
    renderTimeline([module]);
    expect(jumpToCurrent()).toBe('Research Methods');
  });
});

describe('Case 3 — a module that truly finished', () => {
  it('is not current when both the stored end and the delivery end have passed', () => {
    const detail = planModule({ end_date: '2026-05-20', originalEndDate: '2026-05-06', effectiveEndDate: '2026-05-20' });
    const [module] = learnerModules(detail);

    expect(moduleVisualEnd(module)).toBe('2026-05-20');
    renderTimeline([module]);
    expect(jumpToCurrent()).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('No unfinished module is scheduled for today.');
  });
});

describe('Case 4 — the delivery end falls before the stored end', () => {
  it('stays current, because the visual end never shrinks the stored range', () => {
    // Real shape: authored to run to October while teaching its last session in
    // June. Today sits between the two; the bar still runs, so this is current.
    const detail = planModule({ end_date: '2026-10-12', originalEndDate: '2026-06-08', effectiveEndDate: '2026-06-08' });
    const [module] = learnerModules(detail);

    expect(moduleVisualEnd(module)).toBe('2026-10-12');
    renderTimeline([module]);
    expect(jumpToCurrent()).toBe('Research Methods');
  });
});

describe('Case 5 — no usable delivery end on the payload', () => {
  it('falls back to the stored end, current or not', () => {
    for (const value of [null, undefined, '', 'not-a-date', '2026-13-45']) {
      const running = learnerModules(planModule({ end_date: '2026-07-20', effectiveEndDate: value as unknown as string }));
      expect(moduleVisualEnd(running[0])).toBe('2026-07-20');

      const finished = learnerModules(planModule({ end_date: '2026-05-20', effectiveEndDate: value as unknown as string }));
      expect(moduleVisualEnd(finished[0])).toBe('2026-05-20');
    }
  });

  it('keeps the button on the stored range when the delivery end is missing', () => {
    renderTimeline(learnerModules(planModule({ end_date: '2026-07-20' })));
    expect(jumpToCurrent()).toBe('Research Methods');
    cleanup();

    renderTimeline(learnerModules(planModule({ end_date: '2026-05-20' })));
    expect(jumpToCurrent()).toBeNull();
  });
});

describe('Case 6 — a module that has not started', () => {
  it('is not current even when its delivery end is far ahead', () => {
    renderTimeline(learnerModules(planModule({ start_date: '2026-09-01', end_date: '2026-12-01', effectiveEndDate: '2027-01-12' })));
    expect(jumpToCurrent()).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('No unfinished module is scheduled for today.');
  });
});

describe('Case 7 — nothing is mutated', () => {
  it('leaves the module row and its detail exactly as they were', () => {
    const detail = planModule({ end_date: '2026-05-20', effectiveEndDate: '2026-07-08' });
    const before = JSON.stringify(detail);
    const [module] = learnerModules(detail);
    const rowBefore = { start: module.start, end: module.end };

    renderTimeline([module]);
    jumpToCurrent();

    expect(JSON.stringify(detail)).toBe(before);
    expect(detail.end_date).toBe('2026-05-20');
    expect({ start: module.start, end: module.end }).toEqual(rowBefore);
  });
});

describe('Case 8 — no side effects', () => {
  it('issues no request while resolving the current module', () => {
    // A save, PATCH or refetch would show up here; choosing a module must do none.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderTimeline(learnerModules(planModule({ end_date: '2026-05-20', effectiveEndDate: '2026-07-08' })));
    jumpToCurrent();

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('the extended module is the one every current-module affordance lands on', () => {
  it('picks the holiday-extended module over a finished one, and highlights that row', () => {
    const modules = learnerModules(
      planModule({ id: 'done', title: 'Finished Module', end_date: '2026-04-20', effectiveEndDate: '2026-04-20' }),
      planModule({ id: 'running', title: 'Extended Module', end_date: '2026-05-20', effectiveEndDate: '2026-07-08' }),
    );
    const onModuleSelect = vi.fn();
    render(<MemoryRouter><ModuleTimeline data={EMPTY} modules={modules} kind="commercial" learnerId="125"
      today={TODAY} selectedMonth="2026-06" onMonthChange={vi.fn()} onModuleSelect={onModuleSelect} /></MemoryRouter>);

    expect(jumpToCurrent()).toBe('Extended Module');
    // The inspector, the selection callback and the scroll target are all the
    // same module, so the notice, the highlight and the jump cannot disagree.
    expect(onModuleSelect).toHaveBeenCalledTimes(1);
    expect(onModuleSelect.mock.calls[0][0].moduleId).toBe('running');
  });
});
