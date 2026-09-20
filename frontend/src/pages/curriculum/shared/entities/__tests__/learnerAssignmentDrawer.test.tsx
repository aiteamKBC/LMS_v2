import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LearnerAssignmentDrawer } from '../LearnerAssignmentDrawer';
import { assignCurriculumLearners, fetchLearnerAssignments, type LearnerAssignmentDirectory } from '@/api/curriculumLearnerAssignments';

vi.mock('@/api/curriculumLearnerAssignments', () => ({
  assignCurriculumLearners: vi.fn(), fetchLearnerAssignments: vi.fn(),
}));

const target = { id: 'COHORT-1', name: 'September intake', scope: 'cohort' as const };
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchLearnerAssignments).mockResolvedValue(directory);
  vi.mocked(assignCurriculumLearners).mockResolvedValue({ assignedCount: 2, changedCount: 2, moduleCount: 3 });
});

describe('learner assignment', () => {
  it('bubbles already assigned learners to the top of the filtered list', async () => {
    render(<LearnerAssignmentDrawer target={target} onClose={vi.fn()} onAssigned={vi.fn()} />);
    await screen.findByText('Ahmed Ali');

    const assignedRow = screen.getByText('Already Enrolled').closest('label');
    const availableRow = screen.getByText('Ahmed Ali').closest('label');
    expect(assignedRow).not.toBeNull();
    expect(availableRow).not.toBeNull();
    expect(Boolean(assignedRow!.compareDocumentPosition(availableRow!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('filters the real directory and selects all matching unassigned learners only', async () => {
    const user = userEvent.setup();
    const onAssigned = vi.fn();
    const onClose = vi.fn();
    render(<LearnerAssignmentDrawer target={target} onClose={onClose} onAssigned={onAssigned} />);
    await screen.findByText('Ahmed Ali');
    expect(screen.getByRole('note')).toHaveTextContent('all 3 modules');
    await user.selectOptions(screen.getByLabelText('Programme', { exact: true }), 'Business');
    await user.selectOptions(screen.getByLabelText('Company', { exact: true }), 'Al Fanar');
    expect(screen.queryByText('Sara Omar')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select Already Enrolled')).toBeDisabled();
    await user.click(screen.getByLabelText('Select all filtered learners (2 available)'));
    await user.click(screen.getByRole('button', { name: 'Assign 2 learners' }));
    await waitFor(() => expect(assignCurriculumLearners).toHaveBeenCalledWith(target, ['1', '2']));
    expect(onAssigned).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('preserves individual selections across name/email and assignment filters', async () => {
    const user = userEvent.setup();
    render(<LearnerAssignmentDrawer target={target} onClose={vi.fn()} onAssigned={vi.fn()} />);
    await screen.findByText('Ahmed Ali');
    await user.click(screen.getByLabelText('Select Ahmed Ali'));
    await user.type(screen.getByRole('searchbox'), 'mona@');
    await user.click(screen.getByLabelText('Select Mona Hassan'));
    expect(screen.getByText(/2 selected \(1 outside these filters\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByLabelText('Select Ahmed Ali')).toBeChecked();
    expect(screen.getByLabelText('Select Mona Hassan')).toBeChecked();
    await user.selectOptions(screen.getByLabelText('Assignment', { exact: true }), 'assigned');
    expect(screen.queryByText('Ahmed Ali')).not.toBeInTheDocument();
    expect(screen.getByText('Already Enrolled')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByRole('button', { name: /Assign .*learners/ })).toBeDisabled();
  });

  it('resets selection when another module is opened and submits only that target', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LearnerAssignmentDrawer target={target} onClose={vi.fn()} onAssigned={vi.fn()} />);
    await screen.findByText('Ahmed Ali');
    await user.click(screen.getByLabelText('Select Ahmed Ali'));
    const module = { id: 'MOD-1', name: 'Leadership', scope: 'module' as const };
    rerender(<LearnerAssignmentDrawer target={module} onClose={vi.fn()} onAssigned={vi.fn()} />);
    await screen.findByText('Ahmed Ali');
    expect(screen.getByLabelText('Select Ahmed Ali')).not.toBeChecked();
    expect(screen.getByRole('note')).toHaveTextContent('this module only');
    await user.click(screen.getByLabelText('Select Mona Hassan'));
    await user.click(screen.getByRole('button', { name: 'Assign 1 learner' }));
    await waitFor(() => expect(assignCurriculumLearners).toHaveBeenCalledWith(module, ['2']));
  });

  it('supports loading retry and retains selection when saving fails', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchLearnerAssignments).mockRejectedValueOnce(new Error('Directory unavailable'));
    vi.mocked(assignCurriculumLearners).mockRejectedValueOnce(new Error('Save unavailable'));
    const onClose = vi.fn();
    render(<LearnerAssignmentDrawer target={target} onClose={onClose} onAssigned={vi.fn()} />);
    await screen.findByText('Directory unavailable');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Ahmed Ali');
    await user.click(screen.getByLabelText('Select Ahmed Ali'));
    await user.click(screen.getByRole('button', { name: 'Assign 1 learner' }));
    await screen.findByText('Save unavailable');
    expect(screen.getByLabelText('Select Ahmed Ali')).toBeChecked();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('prevents a duplicate save while the first assignment is pending', async () => {
    const user = userEvent.setup();
    vi.mocked(assignCurriculumLearners).mockReturnValue(new Promise(() => {}));
    render(<LearnerAssignmentDrawer target={target} onClose={vi.fn()} onAssigned={vi.fn()} />);
    await screen.findByText('Ahmed Ali');
    await user.click(screen.getByLabelText('Select Ahmed Ali'));
    await user.dblClick(screen.getByRole('button', { name: 'Assign 1 learner' }));
    expect(assignCurriculumLearners).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Assigning…' })).toBeDisabled();
  });
});
