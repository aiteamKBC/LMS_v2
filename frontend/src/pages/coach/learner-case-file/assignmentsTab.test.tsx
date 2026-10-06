import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detail: { real: {} as unknown, loading: false, loadError: null as string | null, refresh: vi.fn() },
  plan: {
    metadata: null, contract: null, statuses: {}, loading: false, submissionCounts: {},
    errors: [] as string[], retry: vi.fn(),
  },
  groups: [] as unknown[],
  groupMonthlyAssignments: vi.fn(),
}));

vi.mock('@/hooks/useLearnerDetailParam', () => ({ useLearnerDetailParam: () => mocks.detail }));
vi.mock('@/pages/learner/monthly-submission/useMonthlyAssignmentPlan', () => ({ useMonthlyAssignmentPlan: () => mocks.plan }));
vi.mock('@/pages/learner/monthly-submission/model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pages/learner/monthly-submission/model')>();
  return { ...actual, groupMonthlyAssignments: (...args: unknown[]) => mocks.groupMonthlyAssignments(...args) };
});
vi.mock('@/pages/learner/monthly-submission/AssignmentSubmissions', () => ({
  AssignmentSubmissions: (props: { kind: string; learnerId: string; activityId: string; status: string; submissionCount?: number; month?: string }) =>
    <div data-testid="submissions">{`${props.kind}:${props.learnerId}:${props.activityId}:${props.status}:${props.submissionCount}:${props.month}`}</div>,
}));

const { default: AssignmentsTab } = await import('./components/AssignmentsTab');
const { hasSubmission } = await import('./components/assignmentSubmitted');

function row(id: string, status: string, submissionCount?: number) {
  return { id, component: `Assignment ${id}`, module: 'Module A', week: 'Week 1', status, submissionCount, marking: undefined };
}

beforeEach(() => {
  mocks.detail = { real: {}, loading: false, loadError: null, refresh: vi.fn() };
  mocks.plan = { ...mocks.plan, loading: false, errors: [], retry: vi.fn() };
  mocks.groups = [
    { month: '2026-08', label: 'August 2026', topics: [], submitted: 1, assignments: [row('a1', 'accepted', 1), row('a2', 'todo'), row('a3', 'draft')] },
    { month: '2026-09', label: 'Month 2: Data', topics: [], submitted: 0, assignments: [row('b1', 'referred', 2), row('b2', 'submitted_for_tutor_review', 1)] },
    { month: '2026-10', label: 'October 2026', topics: [], submitted: 0, assignments: [row('c1', 'todo', 0)] },
  ];
  mocks.groupMonthlyAssignments.mockImplementation(() => mocks.groups);
});

describe('hasSubmission', () => {
  it('counts anything submitted at least once, including work sent back', () => {
    expect(hasSubmission({ status: 'accepted', submissionCount: undefined })).toBe(true);
    expect(hasSubmission({ status: 'referred', submissionCount: undefined })).toBe(true);
    expect(hasSubmission({ status: 'submitted_for_tutor_review', submissionCount: undefined })).toBe(true);
    expect(hasSubmission({ status: 'todo', submissionCount: 1 })).toBe(true);
    expect(hasSubmission({ status: 'todo', submissionCount: 0 })).toBe(false);
    expect(hasSubmission({ status: 'draft', submissionCount: undefined })).toBe(false);
    expect(hasSubmission({ status: '', submissionCount: undefined })).toBe(false);
  });
});

describe('Coach case file Assignments tab', () => {
  it('lists only submitted assignments, latest month first', () => {
    render(<AssignmentsTab kind="apprenticeship" learnerId="125" />);
    expect(screen.getByText('3 submitted')).toBeInTheDocument();
    const months = screen.getAllByRole('region').filter(region => region.getAttribute('aria-label')?.startsWith('Assignments for'));
    expect(months.map(region => region.getAttribute('aria-label'))).toEqual(['Assignments for September 2026', 'Assignments for August 2026']);
    expect(within(months[0]).getByRole('heading', { name: 'September 2026 — Month 2: Data' })).toBeInTheDocument();
    for (const name of ['Assignment a1', 'Assignment b1', 'Assignment b2']) expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
    for (const name of ['Assignment a2', 'Assignment a3', 'Assignment c1']) expect(screen.queryByText(name)).not.toBeInTheDocument();
    expect(within(months[0]).getByText('Changes requested')).toBeInTheDocument();
  });

  it('loads submission history and the PDF report only for the opened assignment', () => {
    render(<AssignmentsTab kind="apprenticeship" learnerId="125" />);
    expect(screen.queryByTestId('submissions')).not.toBeInTheDocument();

    const first = screen.getByRole('button', { name: /Assignment b1/ });
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('submissions')).toHaveTextContent('apprenticeship:125:b1:referred:2:2026-09');

    fireEvent.click(screen.getByRole('button', { name: /Assignment a1/ }));
    expect(screen.getAllByTestId('submissions')).toHaveLength(1);
    expect(screen.getByTestId('submissions')).toHaveTextContent('apprenticeship:125:a1:accepted:1:2026-08');
    expect(first).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: /Assignment a1/ }));
    expect(screen.queryByTestId('submissions')).not.toBeInTheDocument();
  });

  it('says so when nothing has been submitted', () => {
    mocks.groups = [{ month: '2026-08', label: 'August 2026', topics: [], submitted: 0, assignments: [row('a2', 'todo')] }];
    render(<AssignmentsTab kind="commercial" learnerId="9" />);
    expect(screen.getByText('This learner has not submitted any assignments yet.')).toBeInTheDocument();
    expect(screen.getByText('0 submitted')).toBeInTheDocument();
  });

  it('shows a load failure with retry instead of an empty list', () => {
    mocks.detail = { real: null, loading: false, loadError: 'Could not load learner', refresh: vi.fn() };
    render(<AssignmentsTab kind="apprenticeship" learnerId="125" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load learner');
    expect(screen.queryByText('This learner has not submitted any assignments yet.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry assignments' }));
    expect(mocks.detail.refresh).toHaveBeenCalled();
  });

  it('warns that the list may be incomplete when submission statuses failed', () => {
    mocks.plan = { ...mocks.plan, errors: ['Submission statuses could not be loaded. You can still open saved work.'], retry: vi.fn() };
    render(<AssignmentsTab kind="apprenticeship" learnerId="125" />);
    expect(screen.getByRole('alert')).toHaveTextContent('may be missing');
    fireEvent.click(screen.getByRole('button', { name: 'Retry details' }));
    expect(mocks.plan.retry).toHaveBeenCalled();
  });

  it('shows loading while the learner or plan is loading', () => {
    mocks.plan = { ...mocks.plan, loading: true };
    render(<AssignmentsTab kind="apprenticeship" learnerId="125" />);
    expect(screen.getByRole('status', { name: 'Loading assignments' })).toBeInTheDocument();
  });

  it('isolates marking loading and failure inside Assignments', () => {
    const retry = vi.fn();
    const { rerender } = render(<AssignmentsTab kind="apprenticeship" learnerId="125" markingState={{
      data: null, loading: true, error: null, retry, invalidate: retry,
    }} />);
    expect(screen.getByRole('status', { name: 'Loading assignments' })).toBeInTheDocument();

    rerender(<AssignmentsTab kind="apprenticeship" learnerId="125" markingState={{
      data: null, loading: false, error: 'Marking unavailable', retry, invalidate: retry,
    }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Marking unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry marking' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
