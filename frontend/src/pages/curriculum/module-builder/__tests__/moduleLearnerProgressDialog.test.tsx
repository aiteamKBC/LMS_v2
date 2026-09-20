import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModuleLearnerProgressDialog } from '../ModuleLearnerProgressDialog';
import type { CurriculumScopeLearnerKsbImpactResponse } from '@/lib/curriculumApi';

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
  it('shows assigned learners with OTJH and achieved KSB weight progress', () => {
    const assignMore = vi.fn();
    render(<ModuleLearnerProgressDialog moduleName="Definition of Project Management" impact={impact} onClose={vi.fn()} onAssignMore={assignMore} />);

    expect(screen.getByRole('dialog', { name: 'Definition of Project Management learner progress' })).toBeInTheDocument();
    expect(screen.getByText('A Learner')).toBeInTheDocument();
    expect(screen.getByText('2h / 4h')).toBeInTheDocument();
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
      />,
    );

    expect(screen.getByText('2 learners assigned to this module')).toBeInTheDocument();
    expect(screen.getByText('Recently assigned learner')).toBeInTheDocument();
    expect(screen.getByText('0h / 0h')).toBeInTheDocument();
  });
});
