import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SavedMeetingEvidence from './SavedMeetingEvidence';
import SessionDetails from './SessionDetails';
import { loadCoachingPdf, loadCoachingSession, loadSavedCoachingEvidence, loadCoachingKeywords, loadCoachingQuality, type SavedCoachingEvidence } from '@/api/coachingRecordings';

vi.mock('@/pages/learner/monthly-submission/AssignmentPdfPreview', () => ({ AssignmentPdfPreview: ({url,label}: {url:string;label:string}) => <section aria-label={label} data-pdf-url={url} /> }));

vi.mock('@/api/coachingRecordings', async () => ({
  ...await vi.importActual<typeof import('@/api/coachingRecordings')>('@/api/coachingRecordings'),
  loadCoachingPdf: vi.fn(), loadCoachingSession: vi.fn(), loadSavedCoachingEvidence: vi.fn(), loadCoachingKeywords: vi.fn(), loadCoachingQuality: vi.fn(),
}));

const evidence = (): SavedCoachingEvidence => ({ state: 'matched', source: 'coaching-session',
  transcript: { content: 'WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nSynthetic saved transcript <script>safe text</script>', durationSeconds: 3, updatedAt: null },
  analyses: [{ id: 'analysis/1+', learnerName: 'Synthetic Learner', type: 'monthly_coaching', status: 'completed',
    report: { executive_summary: 'Synthetic saved AI report', qa: [{ metric: 'Review goals', rag: 'Green' }] }, updatedAt: null, sourceSessionId: 'a'.repeat(32) }],
});

describe('Saved Coaching Session evidence buttons', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  beforeEach(() => { vi.mocked(loadCoachingPdf).mockReset().mockResolvedValue(new Blob(['%PDF-synthetic'], {type:'application/pdf'})); vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:verified-pdf'); static revokeObjectURL = vi.fn(); }); vi.mocked(loadSavedCoachingEvidence).mockReset(); vi.mocked(loadCoachingSession).mockReset(); vi.mocked(loadCoachingKeywords).mockReset(); vi.mocked(loadCoachingQuality).mockReset(); });

  it('offers PDFs from availability metadata without transcript or AI bodies', () => {
    const data = evidence(); data.metadataOnly = true; data.transcript = { durationSeconds: null, updatedAt: null, partCount: 3 };
    data.analyses = [{ ...data.analyses[0], report: undefined, reportAvailable: true }];
    render(<SavedMeetingEvidence evidence={data} eventKey="event" />);
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(screen.getByText(/All 3 verified transcript parts/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview PDF' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'AI analysis' }));
    expect(screen.getByRole('button', { name: 'Preview PDF' })).toBeInTheDocument();
    expect(loadSavedCoachingEvidence).not.toHaveBeenCalled(); expect(loadCoachingPdf).not.toHaveBeenCalled();
  });

  it('retains the saved transcript PDF when Microsoft has no additional published part', () => {
    render(<SavedMeetingEvidence evidence={{ ...evidence(), transcriptCheck: { state: 'missing', code: 'no_transcript' } }} eventKey="event" />);
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(screen.getByRole('button', { name: 'Preview PDF' })).toBeInTheDocument();
    expect(screen.queryByText(/Microsoft has not published/)).not.toBeInTheDocument();
  });

  it('distinguishes exact recording coverage from longer participant attendance', async () => {
    vi.mocked(loadCoachingSession).mockResolvedValue({ eventKey: 'event', partial: false,
      media: { state: 'ready', readyCount: 2, recordings: [
        { id: 'one', state: 'ready', startsAt: '2026-10-23T12:00:00Z', endsAt: '2026-10-23T12:04:00Z' },
        { id: 'two', state: 'ready', startsAt: '2026-10-23T12:03:00Z', endsAt: '2026-10-23T12:08:00Z' }] },
      attendance: { state: 'available', reportCount: 1, rows: [{ name: 'Synthetic participant', totalAttendanceSeconds: 560 }] } });
    render(<SessionDetails eventKey="event" />);
    expect(await screen.findByText(/2 recording parts.*8 min 0 sec recorded in total/)).toBeInTheDocument();
    expect(screen.getByText('4 min 0 sec recorded')).toBeInTheDocument();
    expect(screen.getByText('5 min 0 sec recorded')).toBeInTheDocument();
    expect(screen.getByText('9 min 20 sec')).toBeInTheDocument(); expect(loadCoachingSession).toHaveBeenCalledOnce();
  });

  it('stops pending attendance checks after two retries instead of polling indefinitely', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(loadCoachingSession).mockResolvedValue({ eventKey: 'event', partial: false, media: { state: 'pending', readyCount: 0, recordings: [] }, attendance: { state: 'pending', reportCount: 0, rows: [] } });
      render(<SessionDetails eventKey="event" />);
      await act(async () => {});
      await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
      expect(loadCoachingSession).toHaveBeenCalledTimes(3);
      expect(screen.getByText(/Automatic checks have stopped/)).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(300000); });
      expect(loadCoachingSession).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });

  it('offers actual PDF preview/download without rendering raw transcript or loading an external report', async () => {
    const view = render(<SavedMeetingEvidence evidence={evidence()} eventKey="calendar:event" reference="signed-reference" />);
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Transcript', 'AI analysis']);
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(view.container.querySelector('pre')).toBeNull();
    expect(view.container.querySelector('script')).toBeNull();
    expect(loadCoachingPdf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByRole('region', { name: 'Transcript PDF preview' })).toHaveAttribute('data-pdf-url', 'blob:verified-pdf');
    expect(loadCoachingPdf).toHaveBeenCalledWith('calendar:event', 'transcript', 'signed-reference', undefined, expect.any(AbortSignal));
    fireEvent.click(screen.getByRole('button', { name: 'AI analysis' }));
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByRole('region', { name: 'AI analysis PDF preview' })).toHaveAttribute('data-pdf-url', 'blob:verified-pdf');
    expect(loadCoachingPdf).toHaveBeenLastCalledWith('calendar:event', 'analysis', 'signed-reference', 'analysis/1+', expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    expect(loadSavedCoachingEvidence).not.toHaveBeenCalled();
  });

  it('keeps ambiguous, missing and offline evidence distinct without fabricated files', () => {
    const value: SavedCoachingEvidence = { ...evidence(), transcript: null, analyses: [], transcriptCheck: { state: 'missing', code: 'no_transcript' } };
    const view = render(<SavedMeetingEvidence evidence={{ ...value, state: 'ambiguous' }} eventKey="event" />);
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(screen.getByRole('alert')).toHaveTextContent('More than one source meeting');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    view.rerender(<SavedMeetingEvidence evidence={{ ...value, state: 'unavailable' }} eventKey="event" />);
    expect(screen.getByRole('alert')).toHaveTextContent('could not be checked');
    view.rerender(<SavedMeetingEvidence evidence={value} eventKey="event" />);
    expect(screen.getByText(/Microsoft has not published a transcript/)).toBeInTheDocument();
    expect(screen.queryByText('No saved transcript is available for this meeting.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'AI analysis' }));
    expect(screen.getByText(/no saved AI report is linked to it in Coaching Session yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh saved AI report' })).toBeInTheDocument();
  });

  it('does not expose unfinished analysis as a report or request new AI generation', () => {
    const value = evidence(); value.analyses[0] = { ...value.analyses[0], status: 'processing', report: null };
    render(<SavedMeetingEvidence evidence={value} eventKey="event" />);
    fireEvent.click(screen.getByRole('button', { name: 'AI analysis' }));
    expect(screen.queryByRole('button', { name: 'Preview PDF' })).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Original Coaching Session/)).not.toBeInTheDocument();
    expect(screen.getByText('Saved analysis: processing')).toBeInTheDocument();
  });

  it('shows attendance before slow report loading and reuses one evidence request across both buttons', async () => {
    vi.mocked(loadCoachingSession).mockResolvedValue({ eventKey: 'calendar:event', reference: 'signed-reference', partial: false,
      media: { state: 'ready', readyCount: 1, recordings: [{ id: 'file', state: 'ready', source: 'microsoft' }] },
      attendance: { state: 'available', reportCount: 1, source: 'coaching-session', rows: [{ name: 'Actual attendee', role: 'attendee', status: 'attended', totalAttendanceSeconds: 123 }] },
    });
    let finish!: (value: SavedCoachingEvidence) => void;
    vi.mocked(loadSavedCoachingEvidence).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<SessionDetails eventKey="calendar:event" reference="signed-reference" analysisContext="signed-type-context" />);
    const section = await screen.findByRole('region', { name: 'Saved transcript and AI analysis' });
    expect(screen.getByText('Actual attendee')).toBeInTheDocument();
    expect(screen.getByText('2 min 3 sec')).toBeInTheDocument();
    expect(loadCoachingSession).toHaveBeenCalledWith('calendar:event', expect.any(AbortSignal), 'signed-reference', 'attendance');
    expect(loadSavedCoachingEvidence).not.toHaveBeenCalled();
    expect(loadCoachingKeywords).not.toHaveBeenCalled();
    expect(loadCoachingQuality).not.toHaveBeenCalled();
    expect(screen.queryByText(/No saved transcript is verified/)).not.toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Transcript' }));
    expect(screen.getByText('Actual attendee')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading transcript');
    fireEvent.click(within(section).getByRole('button', { name: 'AI analysis' }));
    expect(loadSavedCoachingEvidence).toHaveBeenCalledTimes(1);
    await act(async () => finish(evidence()));
    expect(screen.getByRole('button', { name: 'Preview PDF' })).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Transcript' }));
    expect(screen.getByRole('button', { name: 'Preview PDF' })).toBeInTheDocument();
    expect(loadSavedCoachingEvidence).toHaveBeenCalledTimes(1);
    expect(loadCoachingSession).toHaveBeenCalledTimes(1);
  });

  it('aborts a pending source read when the meeting is closed', async () => {
    vi.mocked(loadSavedCoachingEvidence).mockImplementation(() => new Promise(() => {}));
    const view = render(<SavedMeetingEvidence eventKey="event" />);
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    const signal = vi.mocked(loadSavedCoachingEvidence).mock.calls[0][1]!;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it('retries a failed report read without reloading attendance', async () => {
    vi.mocked(loadSavedCoachingEvidence).mockRejectedValueOnce(new Error('Source temporarily unavailable')).mockResolvedValueOnce(evidence());
    render(<SavedMeetingEvidence eventKey="event" />);
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Source temporarily unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved evidence' }));
    expect(await screen.findByRole('button', { name: 'Preview PDF' })).toBeInTheDocument();
    expect(loadSavedCoachingEvidence).toHaveBeenCalledTimes(2);
    expect(loadCoachingSession).not.toHaveBeenCalled();
  });

  it('does not retry a failed transcript read just because its section was closed', async () => {
    vi.mocked(loadSavedCoachingEvidence).mockRejectedValue(new Error('Transcript temporarily unavailable'));
    render(<SavedMeetingEvidence category="OTHER" eventKey="event" />);
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(screen.getByRole('button', { name: 'Transcript' })).toHaveAttribute('aria-expanded', 'false');
    expect(loadSavedCoachingEvidence).toHaveBeenCalledOnce();
  });

  it('can create the authorised saved report PDF without a source website export ID', async () => {
    const value = evidence(); value.analyses[0].sourceSessionId = null;
    render(<SavedMeetingEvidence evidence={value} eventKey="event" />);
    fireEvent.click(screen.getByRole('button', { name: 'AI analysis' }));
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByRole('region', { name: 'AI analysis PDF preview' })).toHaveAttribute('data-pdf-url', 'blob:verified-pdf');
    expect(loadCoachingPdf).toHaveBeenCalledWith('event', 'analysis', undefined, 'analysis/1+', expect.any(AbortSignal));
  });

  it('closes the PDF preview, revokes its blob and releases the wide drawer when switching sections', async () => {
    const onPreviewChange = vi.fn();
    render(<SavedMeetingEvidence evidence={evidence()} eventKey="event" onPreviewChange={onPreviewChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'AI analysis' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    await screen.findByRole('region', { name: 'AI analysis PDF preview' });
    expect(onPreviewChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(onPreviewChange).toHaveBeenLastCalledWith(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:verified-pdf');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('checks Microsoft only on transcript action and keeps missing source AI separate', async () => {
    const result = evidence();
    result.analysisState = 'not-found'; result.analyses = [];
    result.transcript!.source = 'microsoft'; result.transcriptCheck = { state: 'available', code: 'verified' };
    vi.mocked(loadSavedCoachingEvidence).mockResolvedValue(result);
    render(<SavedMeetingEvidence eventKey="event" reference="signed" />);
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(await screen.findByText(/Verified transcript from Microsoft/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    expect(loadSavedCoachingEvidence).toHaveBeenCalledWith('event', expect.any(AbortSignal), 'signed', true);
    fireEvent.click(screen.getByRole('button', { name: 'AI analysis' }));
    expect(screen.getByText(/No saved AI report is linked/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(loadSavedCoachingEvidence).toHaveBeenCalledTimes(1);
  });

  it.each(['OTHER', 'SUPPORT', 'LECTURE'] as const)('offers transcript PDF for %s and explains AI scope without extra requests', async category => {
    const value = evidence(); value.analyses = []; value.analysisState = 'not-found'; value.transcript!.source = 'microsoft';
    vi.mocked(loadSavedCoachingEvidence).mockResolvedValue(value);
    render(<SavedMeetingEvidence category={category} eventKey="event" reference="signed" />);
    expect(screen.getByText('MCM & PR only')).toBeInTheDocument();
    expect(screen.getByText(/AI analysis is currently available for MCM and PR/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI analysis' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Coming soon/i)).not.toBeInTheDocument();
    expect(loadSavedCoachingEvidence).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(await screen.findByRole('button', { name: 'Preview PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    expect(loadSavedCoachingEvidence).toHaveBeenCalledOnce();
    expect(loadSavedCoachingEvidence).toHaveBeenCalledWith('event', expect.any(AbortSignal), 'signed', true);
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByRole('region', { name: 'Transcript PDF preview' })).toBeInTheDocument();
    expect(loadCoachingPdf).toHaveBeenCalledWith('event', 'transcript', 'signed', undefined, expect.any(AbortSignal));
  });

  it.each(['MCM', 'PR'] as const)('loads the saved %s analysis without asking Microsoft for transcripts or generating AI', async category => {
    vi.mocked(loadSavedCoachingEvidence).mockResolvedValue(evidence());
    render(<SavedMeetingEvidence category={category} eventKey="event" />);
    fireEvent.click(screen.getByRole('button', { name: 'AI analysis' }));
    expect(await screen.findByRole('button', { name: 'Preview PDF' })).toBeInTheDocument();
    expect(screen.queryByText('MCM & PR only')).not.toBeInTheDocument();
    expect(loadSavedCoachingEvidence).toHaveBeenCalledWith('event', expect.any(AbortSignal), undefined, false);
    expect(loadCoachingQuality).not.toHaveBeenCalled();
  });

  it('automatically checks Microsoft when the supplied saved evidence has no transcript', async () => {
    const saved = { ...evidence(), transcript: null, analyses: [] };
    vi.mocked(loadSavedCoachingEvidence).mockResolvedValue({ ...evidence(), analyses: [], analysisState: 'not-found' });
    render(<SavedMeetingEvidence category="OTHER" evidence={saved} eventKey="event" />);
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(await screen.findByRole('button', { name: 'Preview PDF' })).toBeInTheDocument();
    expect(loadSavedCoachingEvidence).toHaveBeenCalledOnce();
    expect(loadSavedCoachingEvidence).toHaveBeenCalledWith('event', expect.any(AbortSignal), undefined, true);
  });

  it('finishes an in-flight AI read before checking Microsoft for the newly selected transcript', async () => {
    let finish!: (value: SavedCoachingEvidence) => void;
    vi.mocked(loadSavedCoachingEvidence).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(evidence());
    render(<SavedMeetingEvidence category="PR" eventKey="event" />);
    fireEvent.click(screen.getByRole('button', { name: 'AI analysis' }));
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(loadSavedCoachingEvidence).toHaveBeenCalledOnce();
    await act(async () => finish({ ...evidence(), transcript: null }));
    expect(await screen.findByRole('button', { name: 'Preview PDF' })).toBeInTheDocument();
    expect(vi.mocked(loadSavedCoachingEvidence).mock.calls.map(call => call[3])).toEqual([false, true]);
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(loadSavedCoachingEvidence).toHaveBeenCalledTimes(2);
  });

  it('shows an honest missing transcript for EPA and retries only on request', async () => {
    vi.mocked(loadSavedCoachingEvidence).mockResolvedValue({ ...evidence(), transcript: null, analyses: [],
      transcriptCheck: { state: 'missing', code: 'no_transcript' } });
    render(<SavedMeetingEvidence category="OTHER" eventKey="event" />);
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(await screen.findByText(/Microsoft has not published a transcript/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview PDF' })).not.toBeInTheDocument();
    expect(loadCoachingPdf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check transcript again' }));
    await waitFor(() => expect(loadSavedCoachingEvidence).toHaveBeenCalledTimes(2));
    await screen.findByText(/Microsoft has not published a transcript/);
  });

  it('retains a verified existing AI report on a mixed meeting classified as Other', () => {
    render(<SavedMeetingEvidence category="OTHER" evidence={evidence()} eventKey="event" />);
    fireEvent.click(screen.getByRole('button', { name: 'AI analysis' }));
    expect(screen.getByRole('button', { name: 'Preview PDF' })).toBeInTheDocument();
    expect(screen.queryByText('MCM & PR only')).not.toBeInTheDocument();
  });

  it('refreshes an empty saved report result without implying denied access or reloading attendance', async () => {
    vi.mocked(loadSavedCoachingEvidence).mockResolvedValueOnce({ ...evidence(), analyses: [] }).mockResolvedValueOnce(evidence());
    render(<SavedMeetingEvidence category="MCM" eventKey="event" />);
    fireEvent.click(screen.getByRole('button', { name: 'AI analysis' }));
    await screen.findByText(/no saved AI report is linked to it in Coaching Session yet/);
    expect(screen.queryByText(/in your scope/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved AI report' }));
    expect(await screen.findByRole('button', { name: 'Preview PDF' })).toBeInTheDocument();
    expect(vi.mocked(loadSavedCoachingEvidence).mock.calls.map(call => call[3])).toEqual([false, false]);
    expect(loadCoachingSession).not.toHaveBeenCalled();
  });
});
