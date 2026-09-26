import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { uploadEvidence } from '@/api/evidence';
import { McmPresentationUpload } from './McmPresentationUpload';

vi.mock('@/api/evidence', () => ({ uploadEvidence: vi.fn(), getEvidenceDownloadUrl: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const props = { kind: 'commercial' as const, learnerId: '12', activityId: 'COMP-1', month: '2026-09', disabled: false, onUploaded: vi.fn() };
const choose = (name: string) => fireEvent.change(screen.getByLabelText('Upload your MCM PowerPoint'), { target: { files: [new File(['slides'], name)] } });

it.each(['commercial', 'apprenticeship'] as const)('uploads owned MCM evidence for %s and exposes the tooltip', async kind => {
  vi.mocked(uploadEvidence).mockResolvedValue({ id: 'file-1', filename: 'MCM.pptx', status: 'approved', scanResult: 'clean', sectionRef: 'COMP-1' });
  render(<McmPresentationUpload {...props} kind={kind} />);
  expect(screen.getByRole('button', { name: 'Upload MCM PowerPoint' })).toHaveAccessibleDescription('Upload the MCM PowerPoint prepared by you, the learner/user, instead of exporting one from the system.');
  choose('MCM.pptx');
  await waitFor(() => expect(props.onUploaded).toHaveBeenCalledWith({ id: 'file-1', name: 'MCM.pptx' }));
  expect(uploadEvidence).toHaveBeenCalledWith(kind, '12', expect.any(File), 'COMP-1', expect.objectContaining({ componentId: 'COMP-1' }));
});

it('rejects non-PowerPoint files before uploading', () => {
  render(<McmPresentationUpload {...props} />); choose('notes.pdf');
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a non-empty .ppt or .pptx');
  expect(uploadEvidence).not.toHaveBeenCalled();
});

it.each(['pending', 'rejected'])('does not accept a %s scan result', async status => {
  vi.mocked(uploadEvidence).mockResolvedValue({ id: 'file-1', filename: 'MCM.ppt', status, scanResult: '', sectionRef: 'COMP-1' });
  render(<McmPresentationUpload {...props} />); choose('MCM.ppt');
  expect(await screen.findByRole('alert')).toHaveTextContent('has not passed');
  expect(props.onUploaded).not.toHaveBeenCalled();
});

it('preserves an existing presentation on upload failure', async () => {
  vi.mocked(uploadEvidence).mockRejectedValue(new Error('Upload failed'));
  render(<McmPresentationUpload {...props} uploaded={{ id: 'old', name: 'Original.pptx' }} />); choose('new.pptx');
  await screen.findByText('Upload failed');
  expect(screen.getByText('Original.pptx')).toBeVisible();
  expect(props.onUploaded).not.toHaveBeenCalled();
});

it('disables upload on locked submissions', () => {
  render(<McmPresentationUpload {...props} disabled />);
  expect(screen.getByRole('button', { name: 'Upload MCM PowerPoint' })).toBeDisabled();
});
