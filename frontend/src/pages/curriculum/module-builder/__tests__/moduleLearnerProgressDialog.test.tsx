import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumProgrammeAssignedLearner, CurriculumScopeLearnerKsbImpactResponse } from '@/lib/curriculumApi';
import { ModuleLearnerProgressDialog } from '../ModuleLearnerProgressDialog';

const fixtures = vi.hoisted(() => ({ programme: vi.fn(), attendance: vi.fn() }));

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumConfirm: vi.fn(async ({ onConfirm }: { onConfirm: () => void | Promise<void> }) => {
    await onConfirm();
    return true;
  }),
}));
vi.mock('@/lib/curriculumApi', async original => ({
  ...(await original<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumScopeLearnerKsbImpact: fixtures.programme,
}));
vi.mock('@/api/learnerAttendance', () => ({ fetchLearnerAttendance: fixtures.attendance }));

const TODAY = '2026-10-22T08:14:00Z';
const LAST_MONTH = '2026-09-25T10:00:00Z';

const plan = (learnerId: string, componentId: string, module: string, moduleCatalogueId: string, status: 'completed' | 'not_started', extra: Record<string, unknown> = {}) => ({
  activityPlanId: `${learnerId}:${componentId}`, learnerId, learnerName: '', email: '', cohort: '', group: '',
  componentId, componentTitle: `Activity ${componentId}`, componentType: 'assignment',
  moduleCatalogueId, module, weekId: 'W1', week: 'Week 1', displayOrder: 1, expectedOtjh: 2, points: 0,
  calculatedStatus: status, displayStatus: status, statusSource: 'calculated', progressId: null, progressIds: [],
  progressStatus: '', submittedAt: '', countsTowardAchievement: null, source: 'curriculum_component', ...extra,
});

const roster = [
  { id: 'p1', enrolmentId: 11, name: 'Alice Ferreira', email: 'alice@example.com', programme: 'Operations Manager', programmeStatus: 'active', cohort: 'Cohort 24-B', group: 'Group North', lifecycleStatus: 'active', otjhStatus: 'On track' },
  { id: 'p2', enrolmentId: 12, name: 'Aaron Chesworth', email: 'aaron@example.com', programme: 'Operations Manager', programmeStatus: 'active', cohort: 'Cohort 24-B', group: 'Group North', lifecycleStatus: 'active' },
] as CurriculumProgrammeAssignedLearner[];

// The assignment directory hands out enrolment ids; the impact roster bridges them to profiles.
const directory = roster.map(row => ({ ...row, id: row.enrolmentId!, enrolmentId: row.enrolmentId })) as CurriculumProgrammeAssignedLearner[];

const moduleImpact = {
  lineage: { moduleCatalogueId: 'MOD-1', programmeId: 'PROG-FROM-LINEAGE' },
  assignedLearners: roster,
  otjhAchievement: { achievedTotal: 2, plannedTotal: 8, learners: [
    { learnerId: 'p1', plannedOtjh: 4, achievedOtjh: 2 },
    { learnerId: 'p2', plannedOtjh: 4, achievedOtjh: 0 },
  ] },
  ksbAchievement: { achievedWeightTotal: 3, expectedWeightTotal: 8, progressPercentage: 38 },
  learnerKsbConsumption: [
    { learnerId: 'p1', consumedWeightTotal: 3, cappedConsumedWeightTotal: 3, expectedWeightTotal: 4, progressPercentage: 75, ksbs: [
      { code: 'K1', consumedWeight: 2, expectedWeight: 2, progressPercentage: 100, status: 'complete' },
      { code: 'S4', consumedWeight: 1, expectedWeight: 2, progressPercentage: 50, status: 'in_progress' },
    ] },
    { learnerId: 'p2', consumedWeightTotal: 0, cappedConsumedWeightTotal: 0, expectedWeightTotal: 4, progressPercentage: 0, ksbs: [
      { code: 'K1', consumedWeight: 0, expectedWeight: 2, progressPercentage: 0, status: 'not_started' },
      { code: 'S4', consumedWeight: 0, expectedWeight: 2, progressPercentage: 0, status: 'not_started' },
    ] },
  ],
  learnerActivities: [],
  learnerActivityPlan: [
    plan('p1', 'C1', 'Module One', 'MOD-1', 'completed', { submittedAt: TODAY }),
    plan('p1', 'C2', 'Module One', 'MOD-1', 'not_started'),
    plan('p2', 'C1', 'Module One', 'MOD-1', 'completed', { submittedAt: LAST_MONTH }),
    plan('p2', 'C2', 'Module One', 'MOD-1', 'not_started'),
  ],
  coverage: { items: [{ code: 'K1', title: 'Operational strategy' }, { code: 'S4', title: 'Leading process improvement' }] },
} as unknown as CurriculumScopeLearnerKsbImpactResponse;

const history = (progressId: number, componentId: string, module: string, actualOtjh: number, submittedAt: string) => ({
  progressId, learnerId: 'p1', kind: 'assignment', componentId, componentTitle: `Activity ${componentId}`, componentType: 'assignment',
  module, week: 'Week 1', scopeStatus: 'in_scope', submittedAt, progressStatus: 'achieved', passed: true,
  expectedOtjh: 2, actualOtjh, ksbSnapshot: [], evidence: [], evidenceCount: 0,
});

const programmeImpact = {
  assignedLearners: [roster[0]],
  otjhAchievement: { learners: [{ learnerId: 'p1', plannedOtjh: 10, achievedOtjh: 6 }] },
  learnerKsbConsumption: [{ learnerId: 'p1', cappedConsumedWeightTotal: 6, expectedWeightTotal: 8, ksbs: [
    { code: 'K1', status: 'complete' }, { code: 'K2', status: 'complete' }, { code: 'S4', status: 'in_progress' },
  ] }],
  learnerActivities: [
    history(103, 'C3', 'Finance', 2, '2026-10-15T10:00:00Z'),
    history(104, 'C4', 'Finance', 2, '2026-10-16T10:00:00Z'),
  ],
  learnerActivityPlan: [
    plan('p1', 'C1', 'Module One', 'MOD-1', 'completed', { submittedAt: TODAY }),
    plan('p1', 'C2', 'Module One', 'MOD-1', 'not_started'),
    plan('p1', 'C3', 'Finance', 'MOD-2', 'completed', { progressId: 103 }),
    plan('p1', 'C4', 'Finance', 'MOD-2', 'completed', { progressId: 104 }),
    plan('p1', 'C5', 'Stakeholders', 'MOD-3', 'not_started'),
  ],
  coverage: { items: [] },
};

function renderDialog(props: Partial<Parameters<typeof ModuleLearnerProgressDialog>[0]> = {}) {
  const handlers = { onClose: vi.fn(), onAssignMore: vi.fn(), onRemoveLearner: vi.fn().mockResolvedValue(undefined) };
  render(
    <MemoryRouter>
      <ModuleLearnerProgressDialog moduleName="Module One" moduleId="MOD-1" impact={moduleImpact} assignedLearners={directory}
        programmes={[{ id: 'P-ID', sourceId: 'PROG-1', name: 'Operations Manager' }]} {...handlers} {...props} />
    </MemoryRouter>,
  );
  return handlers;
}

const list = () => within(screen.getByRole('list', { name: 'Learners' }));
const details = () => within(screen.getByRole('region', { name: /progress$/ }));

describe('ModuleLearnerProgressDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    fixtures.programme.mockReset().mockResolvedValue(programmeImpact);
    fixtures.attendance.mockReset().mockResolvedValue({ sessions: 20, present: 15, attendanceRate: 75, lastSessionDate: '2026-09-25' });
  });
  afterEach(() => vi.useRealTimers());

  it('lists every learner with their module progress, KSBs, hours and last activity', () => {
    renderDialog();

    expect(screen.getByRole('dialog', { name: 'Module One learner progress' })).toBeInTheDocument();
    expect(screen.getByText('Module One · 2 learners · average progress 38%')).toBeInTheDocument();
    const alice = list().getByRole('button', { name: /Alice Ferreira/ });
    // Hours 2/4, KSB weight 3/4 and 1 of 2 activities average to 58%.
    expect(alice).toHaveTextContent('58%');
    expect(alice).toHaveTextContent('1/2 KSBs · 2 hrs');
    expect(alice).toHaveTextContent('Last active today, 09:14');
    expect(list().getByRole('button', { name: /Aaron Chesworth/ })).toHaveTextContent('Last active 27 days ago');
    expect(screen.getByText(/2 learners on this module/)).toHaveTextContent('2 learners on this module · average progress 38%');
  });

  it('shows the first learner’s programme-wide progress, read for that learner only', async () => {
    renderDialog();

    await waitFor(() => expect(fixtures.programme).toHaveBeenCalledWith('programme', 'PROG-1', { learnerStatus: 'all', learnerId: 'p1' }));
    expect(fixtures.attendance).toHaveBeenCalledWith('apprenticeship', '11');
    const panel = details();
    expect(panel.getByRole('heading', { name: 'Alice Ferreira' })).toBeInTheDocument();
    expect(panel.getByText('Operations Manager · Cohort 24-B · Group North')).toBeInTheDocument();
    // Programme: hours 6/10, KSB weight 6/8 and 3 of 5 activities average to 65%.
    expect(await panel.findByText('65%')).toBeInTheDocument();
    expect(panel.getByText('3 of 5 activities')).toBeInTheDocument();
    expect(panel.getByText('2/3')).toBeInTheDocument();
    expect(panel.getByText('of 10 planned · On track')).toBeInTheDocument();
    expect(panel.getByText('75%')).toBeInTheDocument();
    expect(panel.getByText('15 of 20 sessions')).toBeInTheDocument();
  });

  it('breaks the programme down by module and marks this one', async () => {
    renderDialog();

    const panel = details();
    const finance = (await panel.findByText('Finance')).parentElement!.parentElement!;
    expect(finance).toHaveTextContent('Complete');
    expect(finance).toHaveTextContent('100%');
    expect(finance).toHaveTextContent('4/4 hrs');
    const current = panel.getByText('This module').parentElement!.parentElement!;
    expect(current).toHaveTextContent('Module One');
    expect(current).toHaveTextContent('In progress');
    // This module's row uses the module read's own hours, not the programme trace.
    expect(current).toHaveTextContent('1/2 activities · 2/4 hrs');
    expect(finance).toHaveTextContent('2/2 activities · 4/4 hrs');
    expect(panel.getByText('Stakeholders').parentElement).toHaveTextContent('Not started');
    expect(panel.getByText('Activity C4')).toBeInTheDocument();
  });

  it('shows module KSB evidence with titles and the full progress link through the enrolment bridge', () => {
    renderDialog();

    const panel = details();
    expect(panel.getByText('Operational strategy')).toBeInTheDocument();
    expect(panel.getByText('Leading process improvement')).toBeInTheDocument();
    expect(panel.getByText('1/2')).toBeInTheDocument();
    expect(panel.getByText('1 of 2 KSBs evidenced')).toBeInTheDocument();
    expect(panel.getByRole('link', { name: /View full progress/ })).toHaveAttribute('href', '/curriculum/learner-module-progress?moduleId=MOD-1&enrolmentId=11');
  });

  it('selects another learner and reads their programme progress', async () => {
    renderDialog();

    fireEvent.click(list().getByRole('button', { name: /Aaron Chesworth/ }));
    expect(details().getByRole('heading', { name: 'Aaron Chesworth' })).toBeInTheDocument();
    await waitFor(() => expect(fixtures.programme).toHaveBeenCalledWith('programme', 'PROG-1', { learnerStatus: 'all', learnerId: 'p2' }));
    expect(fixtures.attendance).toHaveBeenCalledWith('apprenticeship', '12');
  });

  it('filters by name and by last activity date', () => {
    renderDialog();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search learners' }), { target: { value: 'aaron' } });
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1 of 2');
    expect(list().queryByRole('button', { name: /Alice Ferreira/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search learners' }), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    expect(list().getByRole('button', { name: /Alice Ferreira/ })).toBeInTheDocument();
    expect(list().queryByRole('button', { name: /Aaron Chesworth/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } });
    expect(list().getByRole('button', { name: /Aaron Chesworth/ })).toBeInTheDocument();
    expect(list().queryByRole('button', { name: /Alice Ferreira/ })).not.toBeInTheDocument();
  });

  it('uses accepted Activity Log hours and reports records without allocated time', () => {
    const enriched = { ...moduleImpact, activityLogOtjh: {
      learners: [{ learnerId: 'p1', plannedOtjh: 4, achievedOtjh: 1.25, unallocatedAcceptedRecords: 2 }],
      achievedTotal: 1.25, plannedTotal: 4, source: 'Activity Log', unallocatedAcceptedRecords: 2,
    } } as CurriculumScopeLearnerKsbImpactResponse;
    renderDialog({ impact: enriched });

    expect(list().getByRole('button', { name: /Alice Ferreira/ })).toHaveTextContent('1/2 KSBs · 1.3 hrs');
    expect(details().getByText('1.3 of 4 hrs')).toBeInTheDocument();
    expect(details().getByText('2 accepted records without allocated time; recorded hours are included.')).toBeInTheDocument();
  });

  it('keeps every learner from the assignment directory visible when impact omits one', () => {
    renderDialog({ assignedLearners: [...directory, { id: 99, name: 'Recently assigned learner', email: 'new@example.com', programme: 'Operations Manager', programmeStatus: 'active', cohort: '', group: '', lifecycleStatus: 'active' }] });

    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 3 of 3');
    expect(list().getByRole('button', { name: /Recently assigned learner/ })).toHaveTextContent('0/0 KSBs · 0 hrs');
  });

  it('explains when the programme read fails and retries it', async () => {
    fixtures.programme.mockRejectedValueOnce(new Error('Programme read timed out.'));
    renderDialog();

    expect(await details().findByText(/Programme progress could not be loaded. Programme read timed out./)).toBeInTheDocument();
    await act(async () => { fireEvent.click(details().getByRole('button', { name: 'Try again' })); });
    expect(await details().findByText('Finance')).toBeInTheDocument();
    expect(fixtures.programme).toHaveBeenCalledTimes(2);
  });

  it('adds learners from the list and removes the selected learner after confirmation', async () => {
    const handlers = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Add learner manually' }));
    expect(handlers.onAssignMore).toHaveBeenCalledTimes(1);

    fireEvent.click(details().getByRole('button', { name: 'Remove from module' }));
    await waitFor(() => expect(handlers.onRemoveLearner).toHaveBeenCalledWith(directory[0]));
  });

  it('offers to add learners when the module has none', () => {
    const handlers = renderDialog({ impact: null, assignedLearners: [] });

    expect(screen.getByText('No learners are assigned to this module yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add learners' }));
    expect(handlers.onAssignMore).toHaveBeenCalledTimes(1);
    expect(fixtures.programme).not.toHaveBeenCalled();
  });
});
