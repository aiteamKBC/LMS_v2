import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AssignmentLearner } from '@/api/curriculumLearnerAssignments';
import { assignmentCohortOptions, assignmentFilter, assignmentOptions, toggleIn } from './selection';
import { LearnerRows } from './LearnerRows';

const learner: AssignmentLearner = {
  id: 'registration-7', name: 'Ada Example', email: 'ada@example.test',
  programme: 'Programme A', company: 'Company A', cohort: 'Cohort A', group: '',
  programmeStatus: 'Active', lifecycleStatus: 'withdrawn', learnerType: '', assigned: false, moduleCount: 0,
};
const filters = {
  query: '', programme: '', company: '', cohort: '', status: '',
  target: { scope: 'module' as const, id: 'MOD-synthetic', name: 'Synthetic' },
};

describe('assignment selection contracts', () => {
  it('matches every search term across name/email with whitespace and case normalization', () => {
    expect(assignmentFilter({ ...filters, query: '  ADA   example.test ' })(learner)).toBe(true);
    expect(assignmentFilter({ ...filters, query: 'Ada absent' })(learner)).toBe(false);
  });
  it('uses cohort in module scope and company in cohort scope', () => {
    expect(assignmentFilter({ ...filters, cohort: 'Cohort A', company: 'Other' })(learner)).toBe(true);
    expect(assignmentFilter({ ...filters, cohort: 'Other' })(learner)).toBe(false);
    expect(assignmentFilter({ ...filters, cohort: 'Other', company: 'Company A', target: { ...filters.target, scope: 'cohort' } })(learner)).toBe(true);
    expect(assignmentFilter({ ...filters, company: 'Other', target: { ...filters.target, scope: 'cohort' } })(learner)).toBe(false);
  });
  it('uses exact programme/status labels without adding lifecycle filtering', () => {
    expect(assignmentFilter({ ...filters, programme: 'Programme A', status: 'Active' })(learner)).toBe(true);
    expect(assignmentFilter({ ...filters, programme: 'programme a' })(learner)).toBe(false);
    expect(assignmentFilter({ ...filters, status: 'withdrawn' })(learner)).toBe(false);
  });
  it('deduplicates options and scopes cohort options to the selected programme', () => {
    const other = { ...learner, programme: 'Programme B', cohort: 'Cohort B' };
    expect(assignmentOptions([other, learner, learner]).programmes).toEqual(['Programme A', 'Programme B']);
    expect(assignmentCohortOptions([other, learner, learner], 'Programme A')).toEqual(['Cohort A']);
    expect(assignmentCohortOptions([other, learner], '')).toEqual(['Cohort A', 'Cohort B']);
    expect(assignmentOptions([])).toEqual({ programmes: [], companies: [], statuses: [] });
  });
  it('toggles exact IDs immutably, retaining string zero and set semantics', () => {
    const original = new Set(['registration-7']);
    const next = toggleIn(original, '0');
    expect(original).toEqual(new Set(['registration-7']));
    expect(next).toEqual(new Set(['registration-7', '0']));
    expect(toggleIn(next, 'registration-7')).toEqual(new Set(['0']));
  });
});

describe('assignment rows contract', () => {
  const props = { visible: [learner], tab: 'available' as const, toAdd: new Set<string>(), toRemove: new Set<string>(), canUnassign: true, saving: false };
  it('passes the supplied registration ID unchanged and preserves selected/disabled state', () => {
    const toggleAdd = vi.fn();
    const { rerender } = render(<LearnerRows {...props} toggleAdd={toggleAdd} toggleRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(toggleAdd).toHaveBeenCalledExactlyOnceWith('registration-7');
    rerender(<LearnerRows {...props} saving toAdd={new Set([learner.id])} toggleAdd={toggleAdd} toggleRemove={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByText('Will be added')).toBeInTheDocument();
  });
  it('retains remove/keep callbacks and hides removal without permission', () => {
    const toggleRemove = vi.fn();
    const { rerender } = render(<LearnerRows {...props} tab="assigned" toggleAdd={vi.fn()} toggleRemove={toggleRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(toggleRemove).toHaveBeenCalledExactlyOnceWith(learner.id);
    rerender(<LearnerRows {...props} tab="assigned" toRemove={new Set([learner.id])} toggleAdd={vi.fn()} toggleRemove={toggleRemove} />);
    expect(screen.getByRole('button', { name: 'Keep Ada' })).toBeInTheDocument();
    rerender(<LearnerRows {...props} tab="assigned" canUnassign={false} toggleAdd={vi.fn()} toggleRemove={toggleRemove} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('distinguishes available and assigned empty states', () => {
    const { rerender } = render(<LearnerRows {...props} visible={[]} toggleAdd={vi.fn()} toggleRemove={vi.fn()} />);
    expect(screen.getByText('No unassigned learners match these filters.')).toBeInTheDocument();
    rerender(<LearnerRows {...props} visible={[]} tab="assigned" toggleAdd={vi.fn()} toggleRemove={vi.fn()} />);
    expect(screen.getByText('No assigned learners match these filters.')).toBeInTheDocument();
  });
});
