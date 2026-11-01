import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModuleLearnerProgressDialog } from '../ModuleLearnerProgressDialog';
import { MemoryRouter } from 'react-router-dom';
import type { CurriculumScopeLearnerKsbImpactResponse } from '@/lib/curriculumApi';

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumConfirm: vi.fn(async ({ onConfirm }: { onConfirm: () => void | Promise<void> }) => {
    await onConfirm();
    return true;
  }),
}));

const impact = {
  assignedLearnerCount: 1,
  assignedLearners: [{
    id: 'learner-1',
    name: 'A Learner',
    email: 'learner@example.com',
    programme: 'Programme',
    programmeStatus: 'active',
    cohort: 'October 2026',
    group: 'Group A',
    lifecycleStatus: 'active',
  }],
  otjhAchievement: {
    achievedTotal: 2,
    plannedTotal: 4,
    progressPercentage: 50,
    learners: [{
      learnerId: 'learner-1',
      learnerName: 'A Learner',
      email: 'learner@example.com',
      cohort: 'October 2026',
      group: 'Group A',
      plannedOtjh: 4,
      achievedOtjh: 2,
      declaredOtjh: 0,
      completedActivityCount: 1,
      reflectionCount: 0,
      progressPercentage: 50,
    }],
  },
  ksbAchievement: {
    achievedWeightTotal: 1.5,
    expectedWeightTotal: 3,
    progressPercentage: 50,
  },
  learnerKsbConsumption: [{
    learnerId: 'learner-1',
    learnerName: 'A Learner',
    email: 'learner@example.com',
    cohort: 'October 2026',
    group: 'Group A',
    consumedWeightTotal: 1.5,
    expectedWeightTotal: 3,
    cappedConsumedWeightTotal: 1.5,
    progressPercentage: 50,
    ksbs: [],
  }],
} as unknown as CurriculumScopeLearnerKsbImpactResponse;

describe('ModuleLearnerProgressDialog', () => {
  it('shows recorded hours and missing allocations without hiding the learner or module total', () => {
    const enriched = { ...impact, activityLogOtjh: {
      learners: [{ learnerId: 'learner-1', plannedOtjh: 4, achievedOtjh: 1.25, unallocatedAcceptedRecords: 2 }],
      achievedTotal: 1.25, plannedTotal: 4, source: 'Activity Log', unallocatedAcceptedRecords: 2,
    } };
    render(<ModuleLearnerProgressDialog moduleName="Digital Leadership" impact={enriched} onClose={vi.fn()} onAssignMore={vi.fn()} onRemoveLearner={vi.fn()} />);
    expect(screen.getByText('01:15:00 / 04:00:00')).toBeInTheDocument();
    expect(screen.getByText('01:15:00')).toBeInTheDocument();
    expect(screen.getByText('2 accepted records without allocated time.')).toBeInTheDocument();
    expect(screen.getByText(/2 accepted records without allocated time; recorded hours are included/)).toBeInTheDocument();
    expect(screen.getByText(/N\/A.*of assigned planned hours/)).toBeInTheDocument();
  });
  it('uses the same accepted Activity Log hours as the learner page when available', () => {
    const enriched = { ...impact, activityLogOtjh:{ learners:[{ learnerId:'learner-1',plannedOtjh:4,achievedOtjh:1.25 }],achievedTotal:1.25,plannedTotal:4,source:'Activity Log' } };
    render(<ModuleLearnerProgressDialog moduleName="Digital Leadership" impact={enriched} onClose={vi.fn()} onAssignMore={vi.fn()} onRemoveLearner={vi.fn()} />);
    expect(screen.getByText('01:15:00 / 04:00:00')).toBeInTheDocument();
    expect(screen.getByText('1.5 / 3')).toBeInTheDocument();
    expect(screen.getByText(/Activity Log accepted hours/)).toBeInTheDocument();
  });
  it('links enrolment assignments through the explicit profile bridge', () => {
    const directoryLearner = { ...impact.assignedLearners[0], id: 91, enrolmentId: 91 };
    const enriched = { ...impact, assignedLearners: [{ ...impact.assignedLearners[0], enrolmentId: 91 }] };
    render(<MemoryRouter><ModuleLearnerProgressDialog moduleId="MOD-1" moduleName="Digital Leadership"
      impact={enriched} assignedLearners={[directoryLearner]} onClose={vi.fn()} onAssignMore={vi.fn()} onRemoveLearner={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'View progress' })).toHaveAttribute('href', '/curriculum/learner-module-progress?moduleId=MOD-1&enrolmentId=91');
    expect(screen.getByText('02:00:00 / 04:00:00')).toBeInTheDocument();
  });
  it('shows assigned learners with OTJH and achieved KSB weight progress', () => {
    const assignMore = vi.fn();
    render(<ModuleLearnerProgressDialog moduleName="Definition of Project Management" impact={impact} onClose={vi.fn()} onAssignMore={assignMore} onRemoveLearner={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Definition of Project Management learner progress' })).toBeInTheDocument();
    expect(screen.getByText('A Learner')).toBeInTheDocument();
    expect(screen.getByText('02:00:00 / 04:00:00')).toBeInTheDocument();
    expect(screen.getByText('1.5 / 3')).toBeInTheDocument();
    expect(screen.getByText('KSB weights achieved')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Assign more learners' }).click();
    expect(assignMore).toHaveBeenCalledTimes(1);
  });

  it('keeps every learner from the assignment directory visible when impact omits one', () => {
    render(
      <ModuleLearnerProgressDialog
        moduleName="Definition of Project Management"
        impact={impact}
        assignedLearners={[
          ...impact.assignedLearners,
          {
            id: 'learner-2',
            name: 'Recently assigned learner',
            email: 'new@example.com',
            programme: 'Programme',
            programmeStatus: 'active',
            cohort: 'October 2026',
            group: 'Group A',
            lifecycleStatus: 'active',
          },
        ]}
        onClose={vi.fn()}
        onAssignMore={vi.fn()}
        onRemoveLearner={vi.fn()}
      />,
    );

    expect(screen.getByText('2 learners assigned to this module')).toBeInTheDocument();
    expect(screen.getByText('Recently assigned learner')).toBeInTheDocument();
    expect(screen.getByText('00:00:00 / 00:00:00')).toBeInTheDocument();
  });

  it('offers removal from each learner card and waits for the server result', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    render(
      <ModuleLearnerProgressDialog
        moduleName="Definition of Project Management"
        impact={impact}
        onClose={vi.fn()}
        onAssignMore={vi.fn()}
        onRemoveLearner={remove}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(impact.assignedLearners[0]));
  });

  it.each([
    ['active', 'Active'], ['withdrawn', 'Withdrawn'], ['on break', 'On_break'],
    ['completed', 'Completed'], ['enteredepa', 'EnteredEpa'],
  ])('filters %s learners and recomputes the visible totals without changing assignment identity', async (selectedStatus, savedStatus) => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const onStatusChange = vi.fn();
    const selected = { ...impact.assignedLearners[0], id: 92, enrolmentId: 92,
      name: 'Selected learner', lifecycleStatus: savedStatus, programmeStatus: savedStatus };
    const other = { ...selected, id: 93, enrolmentId: 93, name: 'Other learner',
      lifecycleStatus: 'Delivery', programmeStatus: 'Delivery' };
    const filteredImpact = { ...impact, assignedLearners: [selected, other],
      otjhAchievement: { ...impact.otjhAchievement, learners: [
        { ...impact.otjhAchievement.learners[0], learnerId: 92, achievedOtjh: 1 },
        { ...impact.otjhAchievement.learners[0], learnerId: 93, achievedOtjh: 2 },
      ] },
      learnerKsbConsumption: [
        { ...impact.learnerKsbConsumption[0], learnerId: 92, expectedWeightTotal: 100, cappedConsumedWeightTotal: 20 },
        { ...impact.learnerKsbConsumption[0], learnerId: 93, expectedWeightTotal: 100, cappedConsumedWeightTotal: 30 },
      ],
    };
    render(<MemoryRouter><ModuleLearnerProgressDialog moduleName="Digital Leadership" moduleId="MOD-1"
      impact={filteredImpact} assignedLearners={[selected, other]} onClose={vi.fn()} onAssignMore={vi.fn()}
      onStatusChange={onStatusChange} onRemoveLearner={remove} /></MemoryRouter>);
    expect(screen.getByLabelText('Learner status')).toHaveValue('all');
    expect(screen.getAllByRole('article')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Learner status'), { target: { value: selectedStatus } });
    expect(onStatusChange).toHaveBeenCalledWith(selectedStatus);
    expect(screen.getByText('Selected learner')).toBeInTheDocument();
    expect(screen.queryByText('Other learner')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 assigned learners shown')).toBeInTheDocument();
    // The selected learner supplies both the numerator and denominator.
    const totals = within(screen.getByRole('group', { name: 'Shown learner progress totals' }));
    expect(totals.getByText('01:00:00')).toBeInTheDocument();
    expect(totals.getByText('20')).toBeInTheDocument();
    expect(totals.getByText(/20% of current expected KSB weight/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View progress' })).toHaveAttribute('href',
      `/curriculum/learner-module-progress?moduleId=MOD-1&enrolmentId=92&learnerStatus=${encodeURIComponent(selectedStatus)}`);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(selected));
    fireEvent.change(screen.getByLabelText('Learner status'), { target: { value: 'all' } });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(totals.getByText('03:00:00')).toBeInTheDocument();
    expect(totals.getByText(/25% of current expected KSB weight/)).toBeInTheDocument();
  });

  it('uses the profile lifecycle status through the enrolment bridge and retains learners absent from the impact read', () => {
    const directoryLearner = { ...impact.assignedLearners[0], id: 91, enrolmentId: 91, programmeStatus: 'Active', lifecycleStatus: 'Active' };
    const enriched = { ...impact, assignedLearners: [{ ...impact.assignedLearners[0], enrolmentId: 91, lifecycleStatus: 'Withdrawn' }] };
    const missing = { ...directoryLearner, id: 92, enrolmentId: 92, name: 'No profile progress', lifecycleStatus: 'On break' };
    render(<ModuleLearnerProgressDialog moduleName="Digital Leadership" impact={enriched}
      assignedLearners={[directoryLearner, missing]} initialStatus="withdrawn"
      onClose={vi.fn()} onAssignMore={vi.fn()} onRemoveLearner={vi.fn()} />);
    expect(screen.getByText('A Learner')).toBeInTheDocument();
    expect(screen.queryByText('No profile progress')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Learner status'), { target: { value: 'on break' } });
    expect(screen.getByText('No profile progress')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Learner status'), { target: { value: 'completed' } });
    expect(screen.getByText('No assigned learners match this status.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign more learners' })).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Entered EPA' })).toBeInTheDocument();
  });
});
