import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoachingPdf } from '@/api/coachingRecordings';
import SavedEvidencePdf from './SavedEvidencePdf';

vi.mock('@/pages/learner/monthly-submission/AssignmentPdfPreview', () => ({ AssignmentPdfPreview: ({url,label}: {url:string;label:string}) => <section aria-label={label} data-pdf-url={url} /> }));

vi.mock('@/api/coachingRecordings', () => ({ loadCoachingPdf: vi.fn() }));
beforeEach(() => {
  vi.mocked(loadCoachingPdf).mockReset().mockResolvedValue(new Blob(['%PDF-synthetic'], { type: 'application/pdf' }));
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:private-pdf'); static revokeObjectURL = vi.fn(); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Saved evidence PDF', () => {
  it('previews a real PDF blob and downloads the same file without another request', async () => {
    const onPreviewChange = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.href).toBe('blob:private-pdf');
      expect(this.download).toBe('coaching-analysis.pdf');
    });
    const view = render(<SavedEvidencePdf eventKey="event" reference="signed" kind="analysis" analysisId="saved" onPreviewChange={onPreviewChange} />);
    expect(loadCoachingPdf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByRole('region', { name: 'AI analysis PDF preview' })).toHaveAttribute('data-pdf-url', 'blob:private-pdf');
    expect(screen.getByRole('dialog', { name: 'AI analysis PDF' })).toHaveAttribute('aria-modal', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(loadCoachingPdf).toHaveBeenCalledTimes(1);
    expect(onPreviewChange).toHaveBeenLastCalledWith(true);
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-pdf');
    expect(onPreviewChange).toHaveBeenLastCalledWith(false);
  });

  it('shows an unavailable PDF as a recoverable error and never embeds the error response', async () => {
    vi.mocked(loadCoachingPdf).mockRejectedValueOnce(new Error('Source unavailable.')).mockResolvedValueOnce(new Blob(['%PDF-synthetic']));
    render(<SavedEvidencePdf eventKey="event" kind="transcript" />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Source unavailable.');
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry PDF' }));
    await screen.findByRole('region', { name: 'Transcript PDF preview' });
    expect(loadCoachingPdf).toHaveBeenCalledTimes(2);
  });

  it('aborts a pending PDF read when the meeting closes and prevents duplicate requests', () => {
    vi.mocked(loadCoachingPdf).mockImplementation(() => new Promise(() => {}));
    const view = render(<SavedEvidencePdf eventKey="event" kind="transcript" />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(loadCoachingPdf).toHaveBeenCalledTimes(1);
    const signal = vi.mocked(loadCoachingPdf).mock.calls[0][4]!;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it('closes only the PDF popup on Escape, restores focus and reopens from the cached file', async () => {
    render(<SavedEvidencePdf eventKey="event" kind="transcript" />);
    const trigger = screen.getByRole('button', { name: 'Preview PDF' });
    trigger.focus(); fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Transcript PDF' });
    expect(within(dialog).getByRole('button', { name: 'Close PDF preview' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    await screen.findByRole('dialog', { name: 'Transcript PDF' });
    expect(loadCoachingPdf).toHaveBeenCalledOnce();
  });

  it('opens the popup immediately while loading and preserves the parsed preview on reopen', async () => {
    let finish!: (value: Blob) => void;
    vi.mocked(loadCoachingPdf).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<SavedEvidencePdf eventKey="event" kind="transcript" />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    const dialog = screen.getByRole('dialog', { name: 'Transcript PDF' });
    expect(within(dialog).getByRole('status')).toHaveTextContent('Preparing PDF');
    expect(within(dialog).getByRole('button', { name: 'Download PDF' })).toBeDisabled();
    await act(async () => finish(new Blob(['%PDF-synthetic'], { type: 'application/pdf' })));
    const preview = await screen.findByRole('region', { name: 'Transcript PDF preview' });
    fireEvent.click(screen.getByRole('button', { name: 'Close PDF preview' }));
    expect(preview).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(screen.getByRole('region', { name: 'Transcript PDF preview' })).toBe(preview);
    expect(loadCoachingPdf).toHaveBeenCalledOnce();
  });

  it('traps keyboard focus inside the popup and preserves an existing drawer scroll lock', async () => {
    document.body.style.overflow = 'hidden';
    const view = render(<SavedEvidencePdf eventKey="event" kind="analysis" />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'AI analysis PDF' }));
    const first = dialog.getByRole('button', { name: 'Download PDF' }), last = dialog.getByRole('button', { name: 'Close PDF preview' });
    await waitFor(() => expect(first).toBeEnabled());
    last.focus(); fireEvent.keyDown(document, { key: 'Tab' }); expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(last).toHaveFocus();
    view.unmount();
    expect(document.body.style.overflow).toBe('hidden');
    document.body.style.overflow = '';
  });
});
