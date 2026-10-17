import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { dashboardOverviewFixture } from '@/test/dashboardOverviewFixture';
import { OverviewCharts } from '../OverviewCharts';
import { overviewMeasures, overviewModulesForDisplay } from '../overviewFacts';
import { moduleMeasures } from '@/pages/learner/training-plan-timeline/progress';
import type { TimelineModule } from '@/pages/learner/training-plan-timeline/model';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';

afterEach(cleanup);
describe('compact Overview chart parity', () => {
  it('preserves the existing independent module measures', () => {
    const facts = dashboardOverviewFixture().modules[0];
    const legacy = { sessions: [], attendanceProgress: facts.attendance, done: facts.activities.completed,
      activityCount: facts.activities.total, actual: facts.hours.actual, detail: { total_otjh: facts.hours.planned }, ksbProgress: facts.ksb } as TimelineModule;
    expect(overviewMeasures(facts)).toEqual(moduleMeasures(legacy, {} as TrainingPlanDashboard));
    expect(overviewMeasures({ ...facts, attendance: null })).toEqual(moduleMeasures({ ...legacy, attendanceProgress: undefined } as TimelineModule, {} as TrainingPlanDashboard));
  });
  it('preserves browser locale duplicate ownership without transferring activity history or making another request', () => {
    const facts = dashboardOverviewFixture().modules[0];
    const input = ['Zulu', 'éclair'].map((title, i) => ({ ...facts, id: `M${i}`, title, start: '2026-10-02', end: '2026-10-02',
      activities: { completed: 1, total: 1 }, duplicates: [{ key: 'component:C1', completed: true, date: '2026-10-02' }],
      dateBounds: { startFixed: false, endFixed: false, first: '', last: '' } }));
    const rows = overviewModulesForDisplay(input);
    expect(rows[0].title).toBe('éclair');
    expect(rows[0].activities).toEqual({ completed: 1, total: 1 });
    expect(rows[1].activities).toEqual({ completed: 0, total: 0 });
    expect(rows[1].start).toBe('');
    expect(rows[1].end).toBe('');
    expect(input[0].activities.total).toBe(1);
  });
  it('retains chart labels, module selection, pagination and submitted-hour tooltip', () => {
    const payload = dashboardOverviewFixture();
    payload.modules = Array.from({ length: 6 }, (_, i) => ({ ...payload.modules[0], id: `M${i}`, title: `Module ${i}` }));
    payload.programme = payload.modules.map(module => ({ id: module.id, title: module.title, percent: 50 }));
    render(<MemoryRouter><OverviewCharts payload={payload} targetAsOfToday={40} /></MemoryRouter>);
    expect(screen.getByRole('region', { name: /Monthly off-the-job hours chart/ })).toBeVisible();
    expect(screen.getByRole('combobox')).toHaveValue('M0');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'M2' } });
    expect(screen.getByRole('combobox')).toHaveValue('M2');
    fireEvent.click(screen.getByRole('button', { name: 'Next module page' }));
    expect(screen.getByRole('button', { name: 'Module 5: 50% overall progress' })).toBeVisible();
    fireEvent.focus(screen.getByRole('button', { name: /October 2026: target 20 hours, submitted 3 hours, completed 12 hours/ }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('15% (3 hours)');
  });
});
