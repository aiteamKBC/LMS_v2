import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import AdvancedAdminAssignmentUploads from './AdvancedAdminAssignmentUploads';
import { advancedAdminAssignmentUploads, advancedAdminUploadAssignment } from '@/api/advancedAdmin';

vi.mock('@/api/advancedAdmin', () => ({
  advancedAdminAssignmentUploads: vi.fn(),
  advancedAdminAssignmentUploadUrl: (id: number, recordId: string) =>
    `/login_api/advanced-admin/learners/${id}/assignment-uploads/${recordId}/open/`,
  advancedAdminUploadAssignment: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(advancedAdminAssignmentUploads).mockReset().mockResolvedValue({ items: [{
    id: 'record-1', month: '2026-07', title: 'Sample assignment', actualHours: 12,
    filename: 'sample.docx', uploadedAt: '2026-10-08T09:00:00Z',
  }] });
  vi.mocked(advancedAdminUploadAssignment).mockReset().mockResolvedValue({ id: 'record-2', created: true });
});

it('shows private month hours and an authorized file link without an upload form in read-only mode', async () => {
  render(<AdvancedAdminAssignmentUploads learnerId={42} readOnly />);
  expect(await screen.findByText('12h recorded')).toBeInTheDocument();
  expect(screen.getByText(/July 2026 · 12h/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open assignment' })).toHaveAttribute('href',
    '/login_api/advanced-admin/learners/42/assignment-uploads/record-1/open/');
  expect(screen.queryByRole('button', { name: 'Record assignment' })).not.toBeInTheDocument();
});

it('uploads a selected month, hours, and file through Advanced Admin', async () => {
  render(<AdvancedAdminAssignmentUploads learnerId={42} readOnly={false} />);
  await screen.findByText('12h recorded');
  expect(screen.getByLabelText('Assignment file')).toHaveAttribute('accept', '.pdf,.doc,.docx,.pptx');
  fireEvent.change(screen.getByLabelText('Assignment month'), { target: { value: '2026-08' } });
  fireEvent.change(screen.getByLabelText('Confirmed OTJ hours'), { target: { value: '11' } });
  const file = new File(['synthetic content'], 'sample-august.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  fireEvent.change(screen.getByLabelText('Assignment file'), { target: { files: [file] } });
  fireEvent.submit(screen.getByRole('button', { name: 'Record assignment' }).closest('form')!);
  await waitFor(() => expect(advancedAdminUploadAssignment).toHaveBeenCalledWith(42, '2026-08', '11', file));
  await waitFor(() => expect(advancedAdminAssignmentUploads).toHaveBeenCalledTimes(2));
});
