import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { buildPlanModules } from './model';
import { ModuleTimeline } from './ModuleTimeline';

const data: TrainingPlanDashboard = { months: {}, actual: [], actualAvailable: true, modules: [], moduleLinks: {}, sessions: [], reviews: [], coach: { name: 'Coach', bookingUrl: null }, contractStatus: 'ready', generatedAt: '' };
const subjects = Array.from({ length: 36 }, (_, index) => ({ id: `current:${index}`, title: `Module ${index + 1}`, source: 'current' as const, activities: [] }));
const modules = buildPlanModules(subjects, data).map((module, index) => ({ ...module, start: index === 35 ? '2026-09-01' : '2026-01-01', end: index === 35 ? '2026-10-31' : '2026-02-28' }));
function Harness({ rows = modules, onSelect = vi.fn() }: { rows?: typeof modules; onSelect?: (...args: unknown[]) => void }) {
  const [month, setMonth] = useState('2026-09');
  const [id, setId] = useState('');
  return <MemoryRouter><ModuleTimeline data={data} modules={rows} kind="commercial" learnerId="125" today="2026-09-12" selectedMonth={month} selectedId={id}
    onMonthChange={setMonth} onModuleSelect={module => { setId(module.id); onSelect(module); }} /></MemoryRouter>;
}
afterEach(cleanup);

describe('Compact Gantt', () => {
  it('starts its twelve-month window at the learner start month and places next-year modules within it', () => {
    const onMonthChange = vi.fn();
    const row = { ...modules[0], start: '2027-02-01', end: '2027-08-31' };
    render(<MemoryRouter><ModuleTimeline data={data} modules={[row]} kind="commercial" learnerId="125" today="2026-09-12"
      selectedMonth="2026-09" programmeStartDate="2026-08-03" onMonthChange={onMonthChange} onModuleSelect={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'August 2026' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'July 2027' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'January 2026' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show Module 1 overview' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'February 2027' }));
    expect(onMonthChange).toHaveBeenCalledWith('2027-02');
    fireEvent.change(screen.getByRole('combobox', { name: 'Timeline year' }), { target: { value: '2027' } });
    expect(onMonthChange).toHaveBeenCalledWith('2027-08');
  });
  it('keeps all four assigned modules visible across years and opens a future module schedule', () => {
    const rows = modules.slice(0, 4).map((module, index) => ({ ...module,
      title: ['Aya Modual', 'Marketing Impact and Planning', 'Social Media', 'Martech'][index],
      start: ['2026-08-03', '2026-10-05', '2027-02-15', '2027-06-10'][index],
      end: ['2026-10-23', '2027-02-11', '2027-05-20', '2027-09-23'][index],
    }));
    render(<Harness rows={rows} />);
    expect(screen.getByText('4 assigned modules · 2 scheduled in 2026')).toBeVisible();
    expect(screen.getAllByRole('progressbar')).toHaveLength(4);
    for (const row of rows) expect(screen.getByRole('link', { name: row.title })).toBeVisible();
    expect(screen.getByRole('link', { name: 'View all modules' })).toHaveAttribute('href', '/learner/modules/commercial/125');
    fireEvent.click(screen.getByRole('button', { name: 'Show Social Media schedule in 2027' }));
    expect(screen.getByRole('combobox', { name: 'Timeline year' })).toHaveValue('2027');
    expect(screen.getAllByRole('progressbar')).toHaveLength(4);
    expect(within(screen.getByRole('complementary')).getByRole('heading', { name: 'Social Media' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show Social Media overview' })).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Timeline year' }), { target: { value: '2026' } });
    expect(screen.getAllByRole('progressbar')).toHaveLength(4);
  });

  it('keeps every module in the year when selecting another month', () => {
    render(<Harness />);
    expect(screen.getAllByRole('progressbar')).toHaveLength(36);
    fireEvent.click(screen.getByRole('button', { name: 'October 2026' }));
    expect(screen.getAllByRole('progressbar')).toHaveLength(36);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next module page/ })).not.toBeInTheDocument();
  });
  it('opens an inspector with the correct module and content link', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show Module 36 overview' }));
    const panel = within(screen.getByRole('complementary', { name: 'Timeline module details' }));
    expect(panel.getByRole('heading', { name: 'Module 36' })).toBeVisible();
    expect(panel.getByRole('link', { name: 'Open module' })).toHaveAttribute('href', '/learner/modules/commercial/125?subject=current%3A35');
    expect(onSelect).toHaveBeenCalledWith(modules[35]);
    fireEvent.click(panel.getByRole('button', { name: 'Close module details' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
  it('finds the current unfinished module even when it is the final row', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Current module' }));
    expect(within(screen.getByRole('complementary')).getByRole('heading', { name: 'Module 36' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'September 2026' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('does not invent a current module when none is scheduled', () => {
    render(<Harness rows={modules.slice(0, 3)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Current module' }));
    expect(screen.getByRole('status')).toHaveTextContent('No unfinished module is scheduled for today.');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
  it('preserves selection and scroll across full-screen entry and exit', () => {
    render(<Harness />);
    const plot = screen.getByLabelText('Scroll module timeline');
    plot.scrollTop = 520; plot.scrollLeft = 130;
    fireEvent.click(screen.getByRole('button', { name: 'Show Module 36 overview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(screen.getByRole('dialog', { name: 'Programme timeline' })).toBeVisible();
    expect(screen.getByLabelText('Scroll module timeline').scrollTop).toBe(520);
    expect(screen.getAllByRole('progressbar')).toHaveLength(36);
    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Scroll module timeline').scrollLeft).toBe(130);
    expect(within(screen.getByRole('complementary')).getByRole('heading', { name: 'Module 36' })).toBeVisible();
  });
  it('closes the inspector with Escape without changing the selected month', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Show Module 1 overview' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close module details' }), { key: 'Escape' });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'September 2026' })).toHaveAttribute('aria-pressed', 'true');
  });
});
