import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmployerAssignment } from '@/api/employerPortal';

const assignments: EmployerAssignment[] = [
  { id: 'lms:c1', source: 'lms', title: 'Marketing plan', moduleTitle: 'Aya Modual', weekTitle: 'Week 3',
    status: 'submitted_for_tutor_review', submittedAt: '2026-09-01T09:00:00Z',
    files: [{ source: 'lms', id: 'f1', name: 'plan.docx' }] },
  { id: 'aptem:5:evidence:77', source: 'aptem', title: 'Old essay', moduleTitle: 'Legacy module', weekTitle: '',
    status: 'referred', submittedAt: null,
    files: [{ source: 'aptem', id: '77', activityId: 'aptem:5:evidence:77', name: 'Old essay.pdf' }] },
  { id: 'lms:c2', source: 'lms', title: 'Reflection', moduleTitle: '', weekTitle: '', status: 'accepted',
    submittedAt: '2026-08-10T09:00:00Z', files: [] },
];

const fileUrl = vi.fn((..._args: unknown[]) => Promise.resolve('https://sas.example/file'));
const assignmentApi = vi.hoisted(() => ({ fetchAssignments: vi.fn() }));
vi.mock("@/hooks/useToast.helpers", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/api/employerPortal', () => ({
  fetchEmployerLearnerAssignments: (...args: unknown[]) => assignmentApi.fetchAssignments(...args),
  fetchEmployerAssignmentFileUrl: (...args: unknown[]) => fileUrl(...args),
}));

import { EmployerAssignmentsTab } from './EmployerAssignmentsTab';

beforeEach(() => {
  assignmentApi.fetchAssignments.mockReset();
  assignmentApi.fetchAssignments.mockResolvedValue({ assignments });
});

afterEach(() => { cleanup(); fileUrl.mockClear(); });

describe('Employer assignments tab', () => {
  it('shows the animated loading state while assignments are being prepared', () => {
    assignmentApi.fetchAssignments.mockReturnValueOnce(new Promise(() => undefined));
    render(<EmployerAssignmentsTab employerId="9" kind="commercial" learnerId="101" learnerName="Aya" />);

    expect(screen.getByRole('status', { name: 'Loading assignments' })).toBeVisible();
    expect(screen.getByTestId('assignments-loading-spinner')).toHaveClass('animate-spin');
  });

  it('lists every handed-in assignment with its status and files', async () => {
    render(<EmployerAssignmentsTab employerId="9" kind="commercial" learnerId="101" learnerName="Aya" />);
    const list = await screen.findByRole('region', { name: 'Assignments' });
    expect(within(list).getByText('3 assignments handed in by Aya · 2 with uploaded files')).toBeInTheDocument();
    expect(within(list).getByText('Marketing plan')).toBeInTheDocument();
    expect(within(list).getByText('Week 3')).toBeInTheDocument();
    expect(within(list).getByText('Awaiting marking')).toBeInTheDocument();
    expect(within(list).getByText('Referred')).toBeInTheDocument();
    expect(within(list).getByText('Accepted')).toBeInTheDocument();
    expect(within(list).getByText('No file uploaded')).toBeInTheDocument();
    expect(within(list).queryByText(/score|feedback/i)).not.toBeInTheDocument();
  });

  it('groups assignments by module, then by the month they were handed in', async () => {
    assignmentApi.fetchAssignments.mockResolvedValueOnce({ assignments: [
      ...assignments,
      { id: 'lms:c3', source: 'lms', title: 'Campaign brief', moduleTitle: 'Aya Modual', weekTitle: 'Week 6',
        status: 'accepted', submittedAt: '2026-10-02T09:00:00Z', files: [] },
      { id: 'lms:c4', source: 'lms', title: 'Persona', moduleTitle: 'Aya Modual', weekTitle: 'Week 2',
        status: 'accepted', submittedAt: '2026-09-20T09:00:00Z', files: [] },
    ] });
    render(<EmployerAssignmentsTab employerId="9" kind="commercial" learnerId="101" learnerName="Aya" />);
    await screen.findByRole('region', { name: 'Assignments' });

    // Most recently worked-on module first; undated work after dated; no module last.
    const modules = screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent);
    expect(modules).toEqual(['Aya Modual3 assignments', 'Legacy module1 assignment', 'Other assignments1 assignment']);

    const aya = screen.getByRole('region', { name: 'Aya Modual' });
    expect(within(aya).getAllByRole('heading', { level: 4 }).map(h => h.textContent)).toEqual(['October 2026', 'September 2026']);
    const september = within(aya).getByRole('region', { name: 'Aya Modual, September 2026' });
    // Newest first within the month.
    expect(within(september).getAllByRole('listitem').map(item => item.querySelector('[title]')?.textContent))
      .toEqual(['Persona', 'Marketing plan']);
    expect(within(screen.getByRole('region', { name: 'Legacy module' })).getByRole('heading', { level: 4 }))
      .toHaveTextContent('Date not recorded');
  });

  it('opens an uploaded file in a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<EmployerAssignmentsTab employerId="9" kind="commercial" learnerId="101" learnerName="Aya" />);
    fireEvent.click(await screen.findByRole('button', { name: /Old essay\.pdf/ }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://sas.example/file', '_blank', 'noopener,noreferrer'));
    expect(fileUrl).toHaveBeenCalledWith('9', 'commercial', '101', assignments[1].files[0]);
    open.mockRestore();
  });
});
