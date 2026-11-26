import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionAttachments } from './SessionAttachments';
import { uploadSessionAttachment, type SessionFile } from '@/api/sessionResults';

vi.mock('@/api/sessionResults', () => ({
  uploadSessionAttachment: vi.fn(),
  sessionFileUrl: (series: string, file: SessionFile, learner?: { kind: string; id: string }) =>
    learner ? `/learner_api/${learner.kind}/${learner.id}/${series}/${file.id}/` : `/curriculum_api/${series}/${file.id}/`,
}));
const files: SessionFile[] = [{ id: 'F1', type: 'attachment', state: 'ready', fileName: 'Lesson slides.pdf', sizeBytes: 1024 }];
const onSaved = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.mocked(uploadSessionAttachment).mockResolvedValue({ id: 'F1', state: 'ready' }); });
afterEach(cleanup);
describe('Session attachment access and upload', () => {
  it.each(['commercial', 'apprenticeship'] as const)('provides a scoped download, with no upload control, for %s learners', kind => {
    render(<SessionAttachments seriesId="S1" sessionNumber={1} files={files} learner={{ kind, id: '7' }} onSaved={onSaved} />);
    expect(screen.getByRole('link', { name: /Download Lesson/ })).toHaveAttribute('href', `/learner_api/${kind}/7/S1/F1/`);
    expect(screen.queryByLabelText('Add session attachment')).not.toBeInTheDocument();
  });
  it('does not grant uploads in a staff learner preview', () => {
    render(<SessionAttachments seriesId="S1" sessionNumber={1} files={files} preview onSaved={onSaved} />);
    expect(screen.queryByLabelText('Add session attachment')).not.toBeInTheDocument();
  });
  it('keeps pending and failed files visible without creating download links', () => {
    render(<SessionAttachments seriesId="S1" sessionNumber={1} files={[{ ...files[0], state: 'failed' }, { ...files[0], id: 'F2', state: 'pending' }]} onSaved={onSaved} />);
    expect(screen.getByText('Saving needs retry')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('uploads exactly to the selected session then refreshes saved files', async () => {
    render(<SessionAttachments seriesId="S1" sessionNumber={2} files={[]} onSaved={onSaved} />);
    const file = new File(['%PDF-test'], 'Slides.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Add session attachment'), { target: { files: [file] } });
    await screen.findByText('Attachment saved for this session.');
    expect(uploadSessionAttachment).toHaveBeenCalledWith('S1', 2, file);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
  it('shows an actionable failure and allows the same file to be retried', async () => {
    vi.mocked(uploadSessionAttachment).mockRejectedValueOnce(new Error('Storage needs retry.'));
    render(<SessionAttachments seriesId="S1" sessionNumber={1} files={[]} onSaved={onSaved} />);
    const file = new File(['%PDF-test'], 'Slides.pdf');
    fireEvent.change(screen.getByLabelText('Add session attachment'), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage needs retry.');
    fireEvent.change(screen.getByLabelText('Add session attachment'), { target: { files: [file] } });
    await screen.findByText('Attachment saved for this session.');
    expect(uploadSessionAttachment).toHaveBeenCalledTimes(2);
  });
  it('does not refresh another session when an earlier upload finishes late', async () => {
    let resolve!: (result: { id: string; state: 'ready' }) => void;
    vi.mocked(uploadSessionAttachment).mockReturnValue(new Promise(done => { resolve = done; }));
    const { rerender } = render(<SessionAttachments seriesId="S1" sessionNumber={1} files={[]} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Add session attachment'), { target: { files: [new File(['x'], 'notes.txt')] } });
    rerender(<SessionAttachments seriesId="S2" sessionNumber={1} files={[]} onSaved={onSaved} />);
    resolve({ id: 'F1', state: 'ready' });
    await waitFor(() => expect(screen.queryByText('Saving attachment…')).not.toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
  });
  it('rejects empty files before uploading and reports disabled automatic import', async () => {
    render(<SessionAttachments seriesId="S1" sessionNumber={1} files={[]} settings={{ maxBytes: 50, automaticImport: false, storageProvider: 'lms' }} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Add session attachment'), { target: { files: [new File([], 'empty.pdf')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('non-empty');
    expect(uploadSessionAttachment).not.toHaveBeenCalled();
    expect(screen.getByText(/Automatic collection from Teams chat is not enabled/)).toBeInTheDocument();
  });
});
