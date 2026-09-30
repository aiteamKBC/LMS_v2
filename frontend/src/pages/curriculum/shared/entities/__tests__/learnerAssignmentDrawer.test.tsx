import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LearnerAssignmentDrawer } from '../LearnerAssignmentDrawer';
import {
  applyCurriculumLearnerAssignments, fetchLearnerAssignments,
  type LearnerAssignmentDirectory,
} from '@/api/curriculumLearnerAssignments';

vi.mock('@/api/curriculumLearnerAssignments', () => ({
  applyCurriculumLearnerAssignments: vi.fn(), fetchLearnerAssignments: vi.fn(),
}));

const target = { id: 'COHORT-1', name: 'September intake', scope: 'cohort' as const };
const module = { id: 'MOD-1', name: 'Leadership', scope: 'module' as const };
const learners = [
  { id: '1', name: 'Ahmed Ali', email: 'ahmed@example.com', programme: 'Business', company: 'Al Fanar', programmeStatus: 'Active', assigned: false },
  { id: '2', name: 'Mona Hassan', email: 'mona@example.com', programme: 'Business', company: 'Al Fanar', programmeStatus: 'Delivery', assigned: false },
  { id: '3', name: 'Sara Omar', email: 'sara@example.com', programme: 'Data', company: 'Acme', programmeStatus: 'Active', assigned: false },
  { id: '4', name: 'Already Enrolled', email: 'enrolled@example.com', programme: 'Business', company: 'Al Fanar', programmeStatus: 'Active', assigned: true },
].map(row => ({ ...row, cohort: '', group: '', learnerType: 'commercial', moduleCount: 0 }));
const directory: LearnerAssignmentDirectory = {
  target: { ...target, programmeName: 'Business', moduleCount: 3 }, learners,
  totals: { learnerCount: 4, assignedCount: 1 },
};
const applied = (over: Partial<Awaited<ReturnType<typeof applyCurriculumLearnerAssignments>>> = {}) => ({
  added: [], removed: [], failed: [], failureMessage: null, abandoned: false,
  changedCount: 0, moduleCount: 3, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchLearnerAssignments).mockResolvedValue(directory);
  vi.mocked(applyCurriculumLearnerAssignments).mockResolvedValue(applied({ added: ['1', '2'], changedCount: 2 }));
});

describe('learner assignment', () => {
  it('keeps assigned learners out of the available tab and on their own tab', async () => {
    const user = userEvent.setup();
    render(<LearnerAssignmentDrawer target={target} onClose={vi.fn()} onAssigned={vi.fn()} />);
    await screen.findByText('Ahmed Ali');

    expect(screen.queryByText('Already Enrolled')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Currently assigned \(1\)/ }));
    expect(screen.getByText('Already Enrolled')).toBeInTheDocument();
    expect(screen.queryByText('Ahmed Ali')).not.toBeInTheDocument();
  });

  it('filters the directory and selects every matching available learner', async () => {
    const user = userEvent.setup();
    const onAssigned = vi.fn();
    const onClose = vi.fn();
    render(<LearnerAssignmentDrawer target={target} onClose={onClose} onAssigned={onAssigned} />);
    await screen.findByText('Ahmed Ali');
    expect(screen.getByRole('note')).toHaveTextContent('all 3 modules');
    await user.selectOptions(screen.getByLabelText('Programme', { exact: true }), 'Business');
    await user.selectOptions(screen.getByLabelText('Company', { exact: true }), 'Al Fanar');
    expect(screen.queryByText('Sara Omar')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Select all filtered learners (2 available)'));
    await user.click(screen.getByRole('button', { name: 'Add 2' }));
    await waitFor(() => expect(applyCurriculumLearnerAssignments).toHaveBeenCalledWith(
      target, { add: ['1', '2'], remove: [] }, expect.any(Function),
    ));
    expect(onAssigned).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('names every pending selection, including the ones a filter hides', async () => {
    const user = userEvent.setup();
    render(<LearnerAssignmentDrawer target={target} onClose={vi.fn()} onAssigned={vi.fn()} />);
    await screen.findByText('Ahmed Ali');
    await user.click(screen.getByLabelText('Select Ahmed Ali'));
    await user.type(screen.getByRole('searchbox'), 'mona@');
    await user.click(screen.getByLabelText('Select Mona Hassan'));

    await user.click(screen.getByRole('button', { name: 'Review selection (2)' }));
    expect(screen.getByText(/Add · Ahmed Ali/)).toBeInTheDocument();
    expect(screen.getByText(/Add · Mona Hassan/)).toBeInTheDocument();

    await user.click(screen.getByLabelText('Undo add Ahmed Ali'));
    expect(screen.getByRole('button', { name: 'Add 1' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('removes an assigned learner from a module and sends both directions together', async () => {
    const user = userEvent.setup();
    vi.mocked(applyCurriculumLearnerAssignments).mockResolvedValue(applied({ added: ['1'], removed: ['4'], changedCount: 2 }));
    render(<LearnerAssignmentDrawer target={module} onClose={vi.fn()} onAssigned={vi.fn()} />);
    await screen.findByText('Ahmed Ali');
    await user.click(screen.getByLabelText('Select Ahmed Ali'));

    await user.click(screen.getByRole('tab', { name: /Currently assigned/ }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText('Will be removed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add 1 · Remove 1' }));
    await waitFor(() => expect(applyCurriculumLearnerAssignments).toHaveBeenCalledWith(
      module, { add: ['1'], remove: ['4'] }, expect.any(Function),
    ));
  });

  it('offers no removal control on a cohort target', async () => {
    const user = userEvent.setup();
    render(<LearnerAssignmentDrawer target={target} onClose={vi.fn()} onAssigned={vi.fn()} />);
    await screen.findByText('Ahmed Ali');
    await user.click(screen.getByRole('tab', { name: /Currently assigned/ }));
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.getByText(/Cohort membership is not removed here/)).toBeInTheDocument();
  });

  it('resets selection when another target is opened', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LearnerAssignmentDrawer target={target} onClose={vi.fn()} onAssigned={vi.fn()} />);
    await screen.findByText('Ahmed Ali');
    await user.click(screen.getByLabelText('Select Ahmed Ali'));
    rerender(<LearnerAssignmentDrawer target={module} onClose={vi.fn()} onAssigned={vi.fn()} />);
    await screen.findByText('Ahmed Ali');
    expect(screen.getByLabelText('Select Ahmed Ali')).not.toBeChecked();
    expect(screen.getByRole('note')).toHaveTextContent('this module only');
  });

  it('supports loading retry and keeps the selection when the save fails outright', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchLearnerAssignments).mockRejectedValueOnce(new Error('Directory unavailable'));
    vi.mocked(applyCurriculumLearnerAssignments).mockRejectedValueOnce(new Error('Save unavailable'));
    const onClose = vi.fn();
    render(<LearnerAssignmentDrawer target={target} onClose={onClose} onAssigned={vi.fn()} />);
    await screen.findByText('Directory unavailable');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Ahmed Ali');
    await user.click(screen.getByLabelText('Select Ahmed Ali'));
    await user.click(screen.getByRole('button', { name: 'Add 1' }));
    await screen.findByText('Save unavailable');
    expect(screen.getByLabelText('Select Ahmed Ali')).toBeChecked();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reports a partial save and leaves only the unsaved learners selected', async () => {
    const user = userEvent.setup();
    vi.mocked(applyCurriculumLearnerAssignments).mockResolvedValue(applied({
      added: ['1'], failed: ['2'], failureMessage: 'Unable to save learner assignments.', changedCount: 1,
    }));
    const onAssigned = vi.fn();
    const onClose = vi.fn();
    render(<LearnerAssignmentDrawer target={target} onClose={onClose} onAssigned={onAssigned} />);
    await screen.findByText('Ahmed Ali');
    await user.click(screen.getByLabelText('Select Ahmed Ali'));
    await user.click(screen.getByLabelText('Select Mona Hassan'));
    await user.click(screen.getByRole('button', { name: 'Add 2' }));

    await screen.findByText('Saved part of this change.');
    expect(screen.getByText(/1 added · 0 removed · 1 not saved/)).toBeInTheDocument();
    expect(onAssigned).toHaveBeenCalledWith(expect.objectContaining({ learnerCount: 2 }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add 1' })).toBeEnabled();
    expect(screen.getByLabelText('Select Ahmed Ali')).not.toBeChecked();
    expect(screen.getByLabelText('Select Mona Hassan')).toBeChecked();
  });

  it('prevents a duplicate save while the first one is pending', async () => {
    const user = userEvent.setup();
    vi.mocked(applyCurriculumLearnerAssignments).mockReturnValue(new Promise(() => {}));
    render(<LearnerAssignmentDrawer target={target} onClose={vi.fn()} onAssigned={vi.fn()} />);
    await screen.findByText('Ahmed Ali');
    await user.click(screen.getByLabelText('Select Ahmed Ali'));
    await user.dblClick(screen.getByRole('button', { name: 'Add 1' }));
    expect(applyCurriculumLearnerAssignments).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  });
});
