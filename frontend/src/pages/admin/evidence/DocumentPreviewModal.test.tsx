import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchEvidenceDocument = vi.fn();
const fetchEvidenceText = vi.fn();
const fetchAssessmentReportForm = vi.fn();
const saveAssessmentReportForm = vi.fn();
vi.mock('@/api/adminEvidence', () => ({
  fetchEvidenceDocument: (...args: unknown[]) => fetchEvidenceDocument(...args),
  fetchEvidenceText: (...args: unknown[]) => fetchEvidenceText(...args),
  fetchAssessmentReportForm: (...args: unknown[]) => fetchAssessmentReportForm(...args),
  saveAssessmentReportForm: (...args: unknown[]) => saveAssessmentReportForm(...args),
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
  fetchAssessmentReportForm.mockReset();
  saveAssessmentReportForm.mockReset();
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

  it('builds an assessment report from the report-preview Build button', async () => {
    const onReportBuilt = vi.fn();
    fetchEvidenceDocument.mockResolvedValue(document({ name: 'Assessment report.pdf' }));
    fetchAssessmentReportForm.mockResolvedValue({
      learner_name: 'Alex Learner', activity_name: 'Marketing activity', evidence_name: 'Assignment.pdf',
      time_spent: 90, result: 'Accepted', assessor: '', date: '08/09/2026',
      result_options: ['Accepted', 'Referred', 'TraineeAccepted', 'TraineeReferred'], has_report: true,
    });
    saveAssessmentReportForm.mockResolvedValue({
      report_blob: '100-AssessmentReport-form.pdf', analysis_required: false,
      analysis_preserved: false, reanalyze_queued: true, job_id: 'job-12',
    });
    render(<DocumentPreviewModal path="/open/?part=report" title="Assessment report" learnerId={42} evidenceId={100} onClose={() => {}} onReportBuilt={onReportBuilt} />);

    fireEvent.click(await screen.findByRole('button', { name: /Build/i }));
    expect(await screen.findByRole('heading', { name: 'Rebuild assessment report' })).toBeInTheDocument();
    expect(screen.getByLabelText('Learner name')).toHaveValue('Alex Learner');
    expect(screen.getByLabelText('Time spent (minutes)')).toHaveValue(null);
    fireEvent.change(screen.getByLabelText('Criteria'), { target: { value: 'Knowledge: K1' } });
    fireEvent.change(screen.getByLabelText('Comments'), { target: { value: 'Strong evidence' } });
    fireEvent.click(screen.getByRole('button', { name: 'Build report PDF' }));
    expect(screen.getByRole('button', { name: /Save & keep analysis/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save & reanalyse/i }));

    await waitFor(() => expect(saveAssessmentReportForm).toHaveBeenCalledWith(
      42, 100, expect.objectContaining({ criteria: 'Knowledge: K1', comments: 'Strong evidence' }), true,
    ));
    await waitFor(() => expect(onReportBuilt).toHaveBeenCalledTimes(1));
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
