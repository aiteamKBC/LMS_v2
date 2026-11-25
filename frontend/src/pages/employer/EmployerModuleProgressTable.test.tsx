import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import type { DashboardOverviewPayload } from '@/api/dashboardTabs';
import { dashboardOverviewFixture } from '@/test/dashboardOverviewFixture';
import { EmployerModuleProgressTable } from './EmployerModuleProgressTable';
import type { EmployerLearningRecords } from './useEmployerLearningSummary';

afterEach(cleanup);
const learners: EmployerLearnerCard[] = [
  { id: '11', kind: 'apprenticeship', name: 'Alex Learner', email: 'alex@example.test', programme: 'Data', cohort: '', programmeStatus: '', onboardingStatus: '', isActive: true, outstandingCount: 0, documentsTotal: 0, otjhProgress: null },
  { id: '11', kind: 'commercial', name: 'Morgan Learner', email: 'morgan@example.test', programme: 'Marketing', cohort: '', programmeStatus: '', onboardingStatus: '', isActive: true, outstandingCount: 0, documentsTotal: 0, otjhProgress: null },
];
function ready(programme: DashboardOverviewPayload['programme']) {
  return { status: 'ready' as const, data: { ...dashboardOverviewFixture(), programme } };
}
const records: EmployerLearningRecords = {
  'apprenticeship:11': ready([
    { id: 'current:shared', title: 'Shared module', percent: 0 },
    { id: 'current:A', title: 'Analysis', percent: 81.25 },
  ]),
  'commercial:11': ready([
    { id: 'current:shared', title: 'Shared module', percent: 100 },
    { id: 'legacy:A', title: 'Analysis', percent: null },
  ]),
};
function Destination() {
  const location = useLocation();
  return <div data-testid="destination">{location.pathname}{location.search}|{JSON.stringify(location.state)}</div>;
}
function show(data = records, list = learners, moduleId?: string) {
  const retry = vi.fn();
  render(<MemoryRouter initialEntries={[{ pathname: '/employers/8', state: { employerReturnTo: '/users?tab=employers' } }]}>
    <EmployerModuleProgressTable employerId="8" learners={list} records={data} moduleId={moduleId} onRetry={retry} /><Destination />
  </MemoryRouter>);
  return { retry, get table() { return within(screen.getByRole('table')); } };
}

describe('employer learner-by-module progress', () => {
  it('uses canonical percentages independently for both learner kinds, current and historical module identities', () => {
    const { table } = show();
    expect(table.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Learner', 'Analysis', 'Analysis', 'Shared module']);
    const alex = within(table.getByRole('rowheader', { name: 'Alex Learner Data' }).closest('tr')!);
    const morgan = within(table.getByRole('rowheader', { name: 'Morgan Learner Marketing' }).closest('tr')!);
    expect(alex.getByRole('link', { name: /Shared module: 0%/ })).toHaveTextContent('0%');
    expect(morgan.getByRole('link', { name: /Shared module: 100%/ })).toHaveTextContent('100%');
    expect(alex.getByRole('link', { name: /Analysis: 81.25%/ })).toHaveTextContent('81.25%');
    expect(alex.getByText('Not enrolled')).toBeInTheDocument();
    expect(morgan.getByText('Not enrolled')).toBeInTheDocument();
    expect(morgan.getByText('Progress unavailable')).toBeInTheDocument();
    expect(morgan.queryByRole('link', { name: /Analysis:/ })).not.toBeInTheDocument();
  });

  it('opens the correct learner plan and preserves the employer return context', async () => {
    show();
    await userEvent.click(screen.getByRole('link', { name: /Morgan Learner · Shared module: 100%/ }));
    expect(screen.getByTestId('destination')).toHaveTextContent('/employers/8/learner/commercial/11?tab=plan|{"employerReturnTo":"/users?tab=employers"}');
  });

  it('keeps all learners without pagination, searches by email and leaves columns stable while searching', async () => {
    const many = Array.from({ length: 35 }, (_, index) => ({ ...learners[0], id: String(index), name: `Learner ${index}`, email: `learner${index}@example.test` }));
    const data = Object.fromEntries(many.map(learner => [`apprenticeship:${learner.id}`, records['apprenticeship:11']]));
    const { table } = show(data, many);
    expect(table.getAllByRole('rowheader')).toHaveLength(35);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter progress learners' }), 'learner34@');
    expect(table.getAllByRole('rowheader')).toHaveLength(1);
    expect(table.getByRole('link', { name: 'Learner 34' })).toBeVisible();
    expect(table.getAllByRole('columnheader')).toHaveLength(3);
    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.type(screen.getByRole('searchbox'), 'missing');
    expect(screen.getByText('No learners match your search.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Clear learner search' }));
    expect(screen.getAllByRole('rowheader')).toHaveLength(35);
  });

  it('shows pending and failed reads as row states, retains successful percentages and retries failures', async () => {
    const failedLearner = { ...learners[0], id: '99', name: 'Failed Learner' };
    const { retry, table } = show({
      ...records,
      'commercial:11': { status: 'loading', data: records['commercial:11'].data },
      'apprenticeship:99': { status: 'error', data: records['apprenticeship:11'].data },
    }, [...learners, failedLearner]);
    expect(screen.getByRole('status')).toHaveTextContent('Loading learner module progress');
    expect(screen.getByRole('alert')).toHaveTextContent('unavailable for 1 learner');
    expect(table.getByRole('cell', { name: 'Loading…' })).toHaveAttribute('colspan', '2');
    expect(table.getByRole('cell', { name: 'Unavailable' })).toHaveAttribute('colspan', '2');
    expect(table.getByRole('link', { name: /Alex Learner · Analysis: 81.25%/ })).toBeVisible();
    expect(table.queryByRole('link', { name: /Morgan Learner · Shared module/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry progress' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('honours the overview module filter and does not mix same-title modules', () => {
    const { table } = show(records, learners, 'legacy:A');
    expect(table.getAllByRole('columnheader')).toHaveLength(2);
    expect(table.getByRole('columnheader', { name: 'Analysis' })).toBeVisible();
    expect(table.queryByRole('link', { name: /81.25%/ })).not.toBeInTheDocument();
    expect(table.getByText('Not enrolled')).toBeInTheDocument();
    expect(table.getByText('Progress unavailable')).toBeInTheDocument();
  });

  it('treats nonfinite percentages as unavailable and deduplicates module identities without changing zero', () => {
    const { table } = show({ 'apprenticeship:11': ready([
      { id: 'A', title: 'Module A', percent: 0 }, { id: 'A', title: 'Module A', percent: 90 },
      { id: 'B', title: 'Module B', percent: NaN }, { id: 'C', title: 'Module C', percent: Infinity },
    ]) }, [learners[0]]);
    expect(table.getAllByRole('columnheader')).toHaveLength(4);
    expect(table.getByRole('link', { name: /Module A: 0%/ })).toBeVisible();
    expect(table.getAllByText('Progress unavailable')).toHaveLength(2);
  });

  it('distinguishes no assigned modules from reads that have not finished', () => {
    const { table } = show({ 'apprenticeship:11': ready([]) });
    expect(table.getByRole('cell', { name: 'No assigned modules' })).toBeVisible();
    expect(table.getByRole('cell', { name: 'Loading…' })).toBeVisible();
    expect(table.getAllByRole('rowheader')).toHaveLength(2);
  });

  it('shows an empty state when no linked learners match the overview filters', () => {
    show({}, []);
    expect(screen.getByText(/No learners to show/)).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
