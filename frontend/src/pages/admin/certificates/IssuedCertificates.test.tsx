import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import IssuedCertificates from './IssuedCertificates';
import Page from './page';
import { listIssuedCertificates, readIssuedCertificate, updateIssuedCertificate, fetchCertificateTemplate,
  type AdminIssuedCertificate, type IssuedCertificateDetail } from '@/api/platformAdmin';

vi.mock('@/api/platformAdmin', async original => ({ ...await original<typeof import('@/api/platformAdmin')>(),
  listIssuedCertificates: vi.fn(), readIssuedCertificate: vi.fn(), updateIssuedCertificate: vi.fn(), fetchCertificateTemplate: vi.fn(),
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../_shared/AdminPage', () => ({ AdminPageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => <header><h1>{title}</h1>{actions}</header> }));
vi.mock('@/components/feature/CertificateDocument', () => ({ CertificateDocument: (props: { learnerName: string; programmeName: string; revisionLabel?: string }) =>
  <div data-testid="certificate-preview">{props.learnerName} · {props.programmeName} · {props.revisionLabel}</div> }));

const original: AdminIssuedCertificate = {
  id: 11, certificateNumber: 'KBC-TEST', templateId: 1, templateVersion: 3, progressPercent: 80,
  snapshot: { learner: { name: 'Original name' } as never }, issuedAt: '2026-11-18T12:00:00Z',
  verificationToken: 'token', verificationUrl: '/verify-certificate/token', pdfBlobUrl: '',
  moduleRef: 'free:FC-1', moduleTitle: 'Original course', status: 'issued', learnerKind: 'commercial', revision: 1,
  revokedAt: null, revokeReason: '', correctedAt: null,
  editable: { learnerName: 'Original name', courseTitle: 'Original course', title: 'Achievement', bodyText: 'Completed the requirements', instructorName: 'Tutor', instructorLabel: 'Instructor' },
  layoutConfig: { primaryColor: '#123456' },
};
const detail = (): IssuedCertificateDetail => ({ certificate: structuredClone(original), history: [] });
beforeEach(() => {
  vi.mocked(listIssuedCertificates).mockResolvedValue({ count: 1, page: 1, pageSize: 20, results: [{ ...original, learnerName: 'Original name', courseTitle: 'Original course' }] });
  vi.mocked(readIssuedCertificate).mockResolvedValue(detail());
  vi.mocked(fetchCertificateTemplate).mockResolvedValue({ template: null });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); });
async function edit() {
  render(<IssuedCertificates active />);
  fireEvent.click(await screen.findByRole('button', { name: 'Correct KBC-TEST' }));
  return screen.findByLabelText('Student name');
}

it('opens the new tab without losing the builder draft and supports keyboard tabs', async () => {
  render(<MemoryRouter><Page /></MemoryRouter>);
  await waitFor(() => expect(fetchCertificateTemplate).toHaveBeenCalledOnce());
  const name = screen.getByLabelText('Template name');
  fireEvent.change(name, { target: { value: 'Keep this draft' } });
  expect(listIssuedCertificates).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: 'Manage Certificates' }));
  expect(await screen.findByRole('button', { name: 'Correct KBC-TEST' })).toBeVisible();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Manage Certificates' }), { key: 'ArrowLeft' });
  expect(screen.getByRole('tab', { name: 'Certificate Builder' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('Template name')).toHaveValue('Keep this draft');
});

it('searches names or numbers, filters statuses, and paginates on the server', async () => {
  vi.mocked(listIssuedCertificates).mockResolvedValue({ count: 41, page: 1, pageSize: 20, results: [] });
  render(<IssuedCertificates active />);
  await screen.findByText('No certificates match your search.');
  fireEvent.change(screen.getByLabelText('Student, certificate number or course'), { target: { value: 'KBC-TEST' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Search certificates' }));
  await waitFor(() => expect(listIssuedCertificates).toHaveBeenLastCalledWith({ q: 'KBC-TEST', status: '', page: 1 }));
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  await waitFor(() => expect(listIssuedCertificates).toHaveBeenLastCalledWith({ q: 'KBC-TEST', status: '', page: 2 }));
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'revoked' } });
  await waitFor(() => expect(listIssuedCertificates).toHaveBeenLastCalledWith({ q: 'KBC-TEST', status: 'revoked', page: 1 }));
});

it('previews a name correction and submits only the changed field with reason and revision', async () => {
  const updated = detail();
  updated.certificate = { ...updated.certificate, revision: 2, correctedAt: '2026-11-19T12:00:00Z', editable: { ...original.editable, learnerName: 'Corrected name' } };
  updated.history = [{ id: 1, action: 'certificate-corrected', actor: 'Admin', at: '2026-11-19T12:00:00Z', details: {
    reason: 'Spelling', changedFields: ['learnerName'], before: original, after: updated.certificate,
  } }];
  vi.mocked(updateIssuedCertificate).mockResolvedValue(updated);
  const name = await edit();
  expect(screen.getByRole('button', { name: 'Save corrected copy' })).toBeDisabled();
  fireEvent.change(name, { target: { value: 'Corrected name' } });
  expect(screen.getByTestId('certificate-preview')).toHaveTextContent('Corrected name');
  fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Spelling' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Certificate correction' }));
  await waitFor(() => expect(updateIssuedCertificate).toHaveBeenCalledWith(11, {
    action: 'correct', revision: 1, reason: 'Spelling', changes: { learnerName: 'Corrected name' },
  }));
  expect(await screen.findByRole('status')).toHaveTextContent('Corrected copy saved');
  expect(screen.getByRole('link', { name: 'Open verification page' })).toHaveAttribute('href', '/verify-certificate/token');
  expect(screen.getByText(/Original name → Corrected name/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'View copy before this change (revision 1)' }));
  expect(screen.getByText('Archived copy · for review only')).toBeVisible();
  expect(screen.getAllByTestId('certificate-preview')[1]).toHaveTextContent('Original name');
});

it('retains form values and reason after a concurrent edit rejection', async () => {
  vi.mocked(updateIssuedCertificate).mockRejectedValue(new Error('This certificate changed. Reload it.'));
  fireEvent.change(await edit(), { target: { value: 'Keep my edit' } });
  fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Correction requested' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Certificate correction' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This certificate changed');
  expect(screen.getByLabelText('Student name')).toHaveValue('Keep my edit');
  expect(screen.getByLabelText('Reason for correction')).toHaveValue('Correction requested');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Reload certificate' }));
  expect(confirm).toHaveBeenCalled();
  expect(readIssuedCertificate).toHaveBeenCalledTimes(1);
});

it('does not discard unsaved correction when returning to the list is cancelled', async () => {
  fireEvent.change(await edit(), { target: { value: 'Unsaved name' } });
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Back to certificates' }));
  expect(screen.getByLabelText('Student name')).toHaveValue('Unsaved name');
});

it('requires a reason and a separate confirmation before revoking', async () => {
  const revoked = detail(); revoked.certificate.status = 'revoked';
  vi.mocked(updateIssuedCertificate).mockResolvedValue(revoked);
  await edit();
  fireEvent.click(screen.getByRole('button', { name: 'Revoke certificate' }));
  expect(updateIssuedCertificate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Confirm revocation' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Reason for revocation'), { target: { value: 'Issued in error' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm revocation' }));
  await waitFor(() => expect(updateIssuedCertificate).toHaveBeenCalledWith(11, { action: 'revoke', revision: 1, reason: 'Issued in error' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Certificate revoked');
  expect(screen.queryByRole('button', { name: 'Correct certificate' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open verification page' })).not.toBeInTheDocument();
});

it('shows a failed list read as an error and offers a retry', async () => {
  vi.mocked(listIssuedCertificates).mockRejectedValueOnce(new Error('Service unavailable'));
  render(<IssuedCertificates active />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
  expect(screen.queryByText('No certificates match your search.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('button', { name: 'Correct KBC-TEST' })).toBeVisible();
});
