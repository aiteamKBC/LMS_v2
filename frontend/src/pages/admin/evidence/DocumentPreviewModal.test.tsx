import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchEvidenceDocument = vi.fn();
const fetchEvidenceText = vi.fn();
vi.mock('@/api/adminEvidence', () => ({
  fetchEvidenceDocument: (...args: unknown[]) => fetchEvidenceDocument(...args),
  fetchEvidenceText: (...args: unknown[]) => fetchEvidenceText(...args),
}));

const { DocumentPreviewModal } = await import('./DocumentPreviewModal');

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    name: 'Assignment.pdf',
    contentType: 'application/pdf',
    url: 'https://blob.test/assignment.pdf?sig=short-lived',
    downloadUrl: 'https://blob.test/assignment.pdf?sig=download',
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    textPreviewPath: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('AppIcon', ({ className }: { className?: string }) => <i className={className} />);
  fetchEvidenceDocument.mockReset();
  fetchEvidenceText.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('assignment document preview', () => {
  it('shows an assignment PDF in an internal iframe', async () => {
    fetchEvidenceDocument.mockResolvedValue(document());
    render(<DocumentPreviewModal path="/open/?part=file" title="Assignment file" onClose={() => {}} />);
    const frame = await screen.findByTitle('Assignment.pdf');
    expect(frame).toHaveAttribute('src', 'https://blob.test/assignment.pdf?sig=short-lived');
    expect(screen.getByRole('link', { name: /Download/i })).toHaveAttribute('href', expect.stringContaining('download'));
  });

  it('uses Office Online for an assessment report in DOCX format', async () => {
    fetchEvidenceDocument.mockResolvedValue(document({
      name: 'Assessment report.docx', contentType: null,
      url: 'https://blob.test/report.docx?sig=temporary',
    }));
    render(<DocumentPreviewModal path="/open/?part=report" title="Assessment report" onClose={() => {}} />);
    const frame = await screen.findByTitle('Assessment report.docx');
    expect(frame.getAttribute('src')).toBe(
      `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent('https://blob.test/report.docx?sig=temporary')}`,
    );
  });

  it('shows loading and missing-file errors accessibly', async () => {
    let reject!: (error: Error) => void;
    fetchEvidenceDocument.mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    render(<DocumentPreviewModal path="/missing" title="Missing file" onClose={() => {}} />);
    expect(screen.getByText(/Preparing document preview/i)).toBeInTheDocument();
    await act(async () => reject(new Error('This assignment has no file.')));
    expect(await screen.findByText('This assignment has no file.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });

  it('refreshes the temporary URL before it expires', async () => {
    vi.useFakeTimers();
    fetchEvidenceDocument
      .mockResolvedValueOnce(document({ expiresAt: new Date(Date.now() + 31_000).toISOString() }))
      .mockResolvedValueOnce(document({ url: 'https://blob.test/refreshed.pdf?sig=new' }));
    render(<DocumentPreviewModal path="/open" title="Expiring" onClose={() => {}} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetchEvidenceDocument).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1_100); await Promise.resolve(); await Promise.resolve(); });
    expect(fetchEvidenceDocument).toHaveBeenCalledTimes(2);
  });

  it('does not iframe an unsupported file type', async () => {
    fetchEvidenceDocument.mockResolvedValue(document({
      name: 'archive.zip', contentType: 'application/zip', url: 'https://blob.test/archive.zip?sig=x',
    }));
    render(<DocumentPreviewModal path="/open" title="Archive" onClose={() => {}} />);
    expect(await screen.findByText(/cannot be previewed inside the system/i)).toBeInTheDocument();
    expect(screen.queryByTitle('archive.zip')).not.toBeInTheDocument();
  });

  it('renders TXT as text without injecting HTML', async () => {
    fetchEvidenceDocument.mockResolvedValue(document({
      name: 'notes.txt', contentType: 'text/plain', url: 'https://blob.test/notes.txt?sig=x', textPreviewPath: '/text',
    }));
    fetchEvidenceText.mockResolvedValue({ id: 100, text: '<b>not html</b>' });
    const { container } = render(<DocumentPreviewModal path="/open" title="Notes" onClose={() => {}} />);
    expect(await screen.findByText('<b>not html</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });
});
