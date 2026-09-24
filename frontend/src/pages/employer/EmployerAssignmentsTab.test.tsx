import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/api/employerPortal', () => ({
  fetchEmployerLearnerAssignments: vi.fn(() => Promise.resolve({ assignments })),
  fetchEmployerAssignmentFileUrl: (...args: unknown[]) => fileUrl(...args),
}));

import { EmployerAssignmentsTab } from './EmployerAssignmentsTab';

afterEach(() => { cleanup(); fileUrl.mockClear(); });

describe('Employer assignments tab', () => {
  it('lists every handed-in assignment with its status and files', async () => {
    render(<EmployerAssignmentsTab employerId="9" kind="commercial" learnerId="101" learnerName="Aya" />);
    const list = await screen.findByRole('region', { name: 'Assignments' });
    expect(within(list).getByText('3 assignments handed in by Aya · 2 with uploaded files')).toBeInTheDocument();
    expect(within(list).getByText('Marketing plan')).toBeInTheDocument();
    expect(within(list).getByText('Aya Modual · Week 3')).toBeInTheDocument();
    expect(within(list).getByText('Awaiting marking')).toBeInTheDocument();
    expect(within(list).getByText('Referred')).toBeInTheDocument();
    expect(within(list).getByText('Accepted')).toBeInTheDocument();
    expect(within(list).getByText('No file uploaded')).toBeInTheDocument();
    expect(within(list).queryByText(/score|feedback/i)).not.toBeInTheDocument();
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
