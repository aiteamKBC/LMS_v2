import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AssignmentsTab, assignmentMonth } from './AssignmentsTab';
import type { LearnerDetail } from '@/api/learnerDetail';
import { clearAllCachedResources } from '@/api/cachedRequest';

afterEach(() => { cleanup(); clearAllCachedResources(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const assignedDetail = {
  id: '92', modules: ['Project'], components: [
    { componentId: 'ASSIGN-1', component: 'Project report', type: 'assignment', moduleId: 'M1', module: 'Project', week: 'Week 5', assignmentBrief: 'Describe your project.' },
    { componentId: 'READ-1', component: 'Read the chapter', type: 'reading', moduleId: 'M1', module: 'Project', week: 'Week 5' },
    { componentId: 'QUIZ-1', component: 'Project quiz', type: 'quiz', moduleId: 'M1', module: 'Project', week: 'Week 5' },
  ],
} as LearnerDetail;

function assignedRequests(options: { statuses?: Array<{ activityType?: string; activityId: string; status: string }>; failHistory?: boolean; failStatuses?: boolean } = {}) {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/subject-covers/')) return { ok: true, json: async () => ({ covers: {}, activity_dates: {
      'ASSIGN-1': { date: '2026-11-05', month: '2026-11', date_source: 'builder_week' },
    } }) };
    const history = url.includes('view=assignments');
    const failed = history ? options.failHistory : options.failStatuses;
    return { ok: !failed, json: async () => failed ? { error: 'Service unavailable' }
      : history ? { assignments: [] }
        : { statuses: (options.statuses || []).map(row => ({ activityType: 'assignment', ...row })) } };
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

it('shows assigned work before the learner has submitted anything and opens its answer form', async () => {
  const fetcher = assignedRequests();
  render(<MemoryRouter><AssignmentsTab kind="apprenticeship" id="92" real={assignedDetail} /></MemoryRouter>);
  const link = await screen.findByRole('link', { name: 'Start assignment' });
  expect(link).toHaveAttribute('href', '/learner/monthly-submission/apprenticeship/92/ASSIGN-1');
  expect(screen.getByText('Project report')).toBeVisible();
  expect(screen.getByText('Week 5')).toBeVisible();
  expect(await screen.findByText('05/11/2026')).toBeVisible();
  expect(screen.queryByText('Read the chapter')).not.toBeInTheDocument();
  expect(screen.queryByText('Project quiz')).not.toBeInTheDocument();
  expect(screen.queryByText('No assignments linked yet')).not.toBeInTheDocument();
  expect(fetcher.mock.calls.some(([url]) => url === '/learner_api/reflection/submissions/?learnerKind=apprenticeship&learnerId=92')).toBe(true);
});

it('shows drafts, returned work, submitted work and accepted work under the matching filters', async () => {
  assignedRequests({ statuses: [
    { activityId: 'DRAFT', status: 'draft' }, { activityId: 'RETURNED', status: 'referred' },
    { activityId: 'SUBMITTED', status: 'submitted_for_tutor_review' }, { activityId: 'ACCEPTED', status: 'accepted' },
    { activityType: 'video', activityId: 'ASSIGN-1', status: 'accepted' },
  ] });
  const real = { ...assignedDetail, components: ['ASSIGN-1', 'DRAFT', 'RETURNED', 'SUBMITTED', 'ACCEPTED'].map(componentId => ({
    ...assignedDetail.components[0], componentId, component: `Assignment ${componentId}`,
  })) };
  render(<MemoryRouter><AssignmentsTab kind="apprenticeship" id="92" real={real} /></MemoryRouter>);
  expect(await screen.findByRole('link', { name: 'Continue draft' })).toHaveAttribute('href', '/learner/monthly-submission/apprenticeship/92/DRAFT');
  expect(screen.getByRole('link', { name: 'Revise assignment' })).toHaveAttribute('href', '/learner/monthly-submission/apprenticeship/92/RETURNED');
  const filters = within(screen.getByRole('navigation', { name: 'Filter assignments' }));
  fireEvent.click(filters.getByRole('button', { name: /^To Do\s*3$/ }));
  expect(screen.getByText('Assignment ASSIGN-1')).toBeVisible();
  expect(screen.queryByText('Assignment SUBMITTED')).not.toBeInTheDocument();
  fireEvent.click(filters.getByRole('button', { name: /^Submitted\s*1$/ }));
  expect(screen.getByRole('link', { name: 'Open submission' })).toHaveAttribute('href', '/learner/monthly-submission/apprenticeship/92/SUBMITTED');
  fireEvent.click(filters.getByRole('button', { name: /^Completed\s*1$/ }));
  expect(screen.getByText('Assignment ACCEPTED')).toBeVisible();
  expect(screen.queryByText('Assignment DRAFT')).not.toBeInTheDocument();
});

it('keeps assigned work available when previous assignment history fails', async () => {
  assignedRequests({ failHistory: true });
  render(<MemoryRouter><AssignmentsTab kind="commercial" id="92" real={assignedDetail} /></MemoryRouter>);
  expect(await screen.findByRole('link', { name: 'Start assignment' })).toBeVisible();
  expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
});

it('keeps an empty assigned component visible and explains why its answer form is unavailable', async () => {
  assignedRequests();
  render(<MemoryRouter><AssignmentsTab kind="commercial" id="92" real={{ ...assignedDetail, components: [
    { ...assignedDetail.components[0], assignmentBrief: null },
  ] }} /></MemoryRouter>);
  expect(await screen.findByText('Awaiting brief')).toBeVisible();
  expect(screen.getByText('Project report')).toBeVisible();
  expect(screen.getByText('Your tutor has not added the assignment brief or materials yet.')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Start assignment' })).not.toBeInTheDocument();
});

it('opens an assignment supplied as an attached document without requiring a separate text brief', async () => {
  assignedRequests();
  render(<MemoryRouter><AssignmentsTab kind="commercial" id="92" real={{ ...assignedDetail, components: [
    { ...assignedDetail.components[0], assignmentBrief: null, resourceUrl: '/media/assignment.pdf' },
  ] }} /></MemoryRouter>);
  expect(await screen.findByRole('link', { name: 'Start assignment' })).toBeVisible();
  expect(screen.queryByText('Awaiting brief')).not.toBeInTheDocument();
});

it.each([
  ['draft', 'Continue draft'],
  ['referred', 'Revise assignment'],
  ['submitted_for_tutor_review', 'Open submission'],
  ['accepted', 'Open submission'],
])('keeps %s work accessible if the tutor removes the assignment brief', async (status, action) => {
  assignedRequests({ statuses: [{ activityId: 'ASSIGN-1', status }] });
  render(<MemoryRouter><AssignmentsTab kind="commercial" id="92" real={{ ...assignedDetail, components: [
    { ...assignedDetail.components[0], assignmentBrief: null },
  ] }} /></MemoryRouter>);
  expect(await screen.findByRole('link', { name: action })).toHaveAttribute('href', '/learner/monthly-submission/commercial/92/ASSIGN-1');
  expect(screen.getByText('The assignment brief is currently unavailable. You can still open your saved work.')).toBeVisible();
  expect(screen.queryByText('Awaiting brief')).not.toBeInTheDocument();
});

it('keeps assignments openable without inventing a To do status after a status failure', async () => {
  assignedRequests({ failStatuses: true });
  render(<MemoryRouter><AssignmentsTab kind="commercial" id="92" real={assignedDetail} /></MemoryRouter>);
  expect(await screen.findByText('Status unavailable')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Open assignment' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Start assignment' })).not.toBeInTheDocument();
});

it('uses canonical IDs and removes an assignment when the training plan changes', async () => {
  assignedRequests();
  const real = { ...assignedDetail, components: [assignedDetail.components[0], assignedDetail.components[0],
    { ...assignedDetail.components[0], componentId: undefined, component: 'Unlinked assignment' }] };
  const { rerender } = render(<MemoryRouter><AssignmentsTab kind="commercial" id="92" real={real} /></MemoryRouter>);
  await screen.findByRole('link', { name: 'Start assignment' });
  expect(screen.getAllByText('Project report')).toHaveLength(1);
  expect(screen.queryByText('Unlinked assignment')).not.toBeInTheDocument();
  rerender(<MemoryRouter><AssignmentsTab kind="commercial" id="92" real={{ ...real, components: [] }} /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText('Project report')).not.toBeInTheDocument());
  expect(await screen.findByText('No assignments linked yet')).toBeVisible();
});

it('labels staff preview links as viewing and preserves encoded component IDs', async () => {
  assignedRequests();
  render(<MemoryRouter><AssignmentsTab kind="commercial" id="92" canTake={false}
    real={{ ...assignedDetail, components: [{ ...assignedDetail.components[0], componentId: 'ASSIGN:1/a' }] }} /></MemoryRouter>);
  expect(await screen.findByRole('link', { name: 'View assignment' })).toHaveAttribute('href', '/learner/monthly-submission/commercial/92/ASSIGN%3A1%2Fa');
  expect(screen.queryByRole('link', { name: 'Start assignment' })).not.toBeInTheDocument();
});

it('shows a failed training plan as a retryable error without claiming no assignments exist', async () => {
  assignedRequests();
  const retry = vi.fn();
  render(<MemoryRouter><AssignmentsTab kind="commercial" id="92" loadError="Could not load the plan" onRetry={retry} /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the plan');
  fireEvent.click(screen.getByRole('button', { name: 'Retry assignments' }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByText('No assignments linked yet')).not.toBeInTheDocument();
});

it('uses the selected month before completion and submission dates, keeping undated records', () => {
  expect(assignmentMonth({ month: '2026-08', dateCompleted: '2026-09-01', submittedAt: null })).toBe('2026-08');
  expect(assignmentMonth({ month: '2026-13', dateCompleted: null, submittedAt: '2026-09-08T12:00:00Z' })).toBe('2026-09');
  expect(assignmentMonth({ month: null, dateCompleted: null, submittedAt: null })).toBe('');
});

it('groups saved submissions by month and opens the existing assignment template', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ assignments: [
    { id: '1', activityId: 'COMP-1', title: 'August report', moduleTitle: 'Project', status: 'accepted', month: '2026-08' },
    { id: '2', activityId: 'COMP-2', title: 'September report', moduleTitle: 'Project', status: 'draft', month: '2026-09' },
  ] }) }));
  render(<MemoryRouter><AssignmentsTab kind="apprenticeship" id="92" /></MemoryRouter>);
  expect(await screen.findByText('September 2026')).toBeTruthy();
  expect(screen.getByText('August 2026')).toBeTruthy();
  expect(screen.getByText('Continue draft').getAttribute('href')).toBe('/learner/monthly-submission/apprenticeship/92/COMP-2');
});

it('shows a failed request as an error rather than an empty history', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Access denied' }) }));
  render(<MemoryRouter><AssignmentsTab kind="apprenticeship" id="92" /></MemoryRouter>);
  expect((await screen.findByRole('alert')).textContent).toBe('Access denied');
  expect(screen.queryByText('No classified assignments available yet')).toBeNull();
});

it('opens an imported assignment independently of the current curriculum', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ assignments: [
    { id: 'legacy-1', activityId: 'aptem:92:evidence:20128', title: 'Original report', moduleTitle: 'Old module',
      status: 'accepted', submissionOrigin: 'classified_legacy', month: '2025-06' },
  ] }) }));
  render(<MemoryRouter><AssignmentsTab kind="commercial" id="125" /></MemoryRouter>);
  expect(await screen.findByText('Open submission')).toHaveAttribute('href', '/learner/historical-assignment/commercial/125/aptem%3A92%3Aevidence%3A20128');
});
