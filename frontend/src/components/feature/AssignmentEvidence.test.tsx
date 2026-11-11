import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssignmentEvidence } from './AssignmentEvidence';
import { fetchEvidence, uploadEvidence, type EvidenceRecord, type UploadEvidenceResult } from '@/api/evidence';

vi.mock('@/api/evidence', () => ({ fetchEvidence: vi.fn(), uploadEvidence: vi.fn(), getEvidenceDownloadUrl: vi.fn(), deleteEvidence: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => { vi.mocked(fetchEvidence).mockReset().mockResolvedValue([]); vi.mocked(uploadEvidence).mockReset(); });

it('identifies only the explicit new upload, while preserving notifications for existing approved files', async () => {
  const old = { id: 'old-file', filename: 'Existing.pdf', status: 'approved', sectionRef: 'extra:synthetic', sizeBytes: 12 } as EvidenceRecord;
  const uploaded: UploadEvidenceResult = { id: 'new-file', filename: 'New.pdf', status: 'pending', scanResult: '', sectionRef: 'extra:synthetic' };
  vi.mocked(fetchEvidence).mockResolvedValue([old]);
  vi.mocked(uploadEvidence).mockResolvedValue(uploaded);
  const completed = vi.fn(), changed = vi.fn();
  const { container } = render(<AssignmentEvidence kind="commercial" learnerId="101" componentId="extra:synthetic" trainingPlanDetails={{}}
    onUploadCompleted={completed} onUploaded={changed} />);
  await screen.findByText('Existing.pdf');
  expect(completed).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalledWith([old]);
  const file = new File(['synthetic content'], 'New.pdf', { type: 'application/pdf' });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await waitFor(() => expect(completed).toHaveBeenCalledExactlyOnceWith(uploaded));
  expect(uploadEvidence).toHaveBeenCalledWith('commercial', '101', file, 'extra:synthetic', {});
});

it('does not report an attachment when the upload fails', async () => {
  vi.mocked(uploadEvidence).mockRejectedValue(new Error('Synthetic upload failure'));
  const completed = vi.fn();
  const { container } = render(<AssignmentEvidence kind="apprenticeship" learnerId="101" componentId="extra:synthetic" trainingPlanDetails={{}}
    onUploadCompleted={completed} />);
  await screen.findByText('No evidence uploaded yet.');
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['synthetic'], 'New.pdf', { type: 'application/pdf' })] } });
  expect(await screen.findByText('Synthetic upload failure')).toBeVisible();
  expect(completed).not.toHaveBeenCalled();
});
