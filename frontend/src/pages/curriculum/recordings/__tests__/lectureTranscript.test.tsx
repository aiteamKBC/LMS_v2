import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LectureDetailsPanel from '../components/LectureDetailsPanel';
import { loadLectureTranscriptPdf } from '../lectureTranscript';
import type { Lecture } from '../types';

vi.mock('../lectureTranscript', () => ({ loadLectureTranscriptPdf: vi.fn() }));
vi.mock('../components/LectureAttendance', () => ({ default: () => <div>Saved attendance</div> }));
vi.mock('@/pages/learner/monthly-submission/AssignmentPdfPreview', () => ({
  AssignmentPdfPreview: ({ url, label }: { url: string; label: string }) => <section aria-label={label} data-url={url} />,
}));
const lecture: Lecture = { id: 'M:O', moduleId: 'M', seriesId: 'S', occurrenceId: 'O', title: 'Synthetic lecture',
  date: '2026-11-02', startTime: '10:00', endTime: '11:00', programme: 'Synthetic programme', cohort: 'Cohort A',
  group: 'Group A', module: 'Synthetic module', week: 1, weekTitle: 'Introduction', archived: false,
  programmeActive: true, status: 'ready', recordings: [] };
const panel = (value = lecture) => <LectureDetailsPanel lecture={value} timeZone="Europe/London" playingId={null} onClose={vi.fn()} onPlay={vi.fn()} />;

describe('Tutor recording drawer transcript', () => {
  beforeEach(() => {
    vi.mocked(loadLectureTranscriptPdf).mockReset().mockResolvedValue(new Blob(['%PDF-synthetic'], { type: 'application/pdf' }));
    vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:lecture'); static revokeObjectURL = vi.fn(); });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('offers the coaching PDF preview and download without opening video or changing the quality form', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.href).toBe('blob:lecture'); expect(this.download).toBe('tutor-session-transcript.pdf');
    });
    render(panel());
    expect(screen.getByRole('button', { name: 'Open teaching quality check' })).toBeEnabled();
    expect(loadLectureTranscriptPdf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(loadLectureTranscriptPdf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Transcript PDF' }));
    expect(await dialog.findByRole('region', { name: 'Transcript PDF preview' })).toHaveAttribute('data-url', 'blob:lecture');
    expect(loadLectureTranscriptPdf).toHaveBeenCalledWith({ moduleId: 'M', seriesId: 'S', occurrenceId: 'O' }, expect.any(AbortSignal));
    fireEvent.click(dialog.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(loadLectureTranscriptPdf).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open teaching quality check' })).toBeEnabled();
  });

  it('shows missing or unavailable text as a retryable error', async () => {
    vi.mocked(loadLectureTranscriptPdf).mockRejectedValueOnce(new Error('No saved transcript is available for this lecture yet.'));
    render(panel());
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No saved transcript');
    expect(screen.queryByRole('region', { name: 'Transcript PDF preview' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry PDF' }));
    await screen.findByRole('region', { name: 'Transcript PDF preview' });
    expect(loadLectureTranscriptPdf).toHaveBeenCalledTimes(2);
  });

  it('aborts and discards the previous lecture PDF when the selection changes', async () => {
    let finish!: (blob: Blob) => void;
    vi.mocked(loadLectureTranscriptPdf).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = render(panel());
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    const signal = vi.mocked(loadLectureTranscriptPdf).mock.calls[0][1];
    view.rerender(panel({ ...lecture, id: 'M:O2', occurrenceId: 'O2' }));
    expect(signal.aborted).toBe(true);
    await act(async () => finish(new Blob(['%PDF-old-lecture'])));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    await screen.findByRole('region', { name: 'Transcript PDF preview' });
    expect(loadLectureTranscriptPdf).toHaveBeenLastCalledWith({ moduleId: 'M', seriesId: 'S', occurrenceId: 'O2' }, expect.any(AbortSignal));
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:lecture');
  });

  it('does not offer transcript access for a lecture without a saved occurrence', () => {
    render(panel({ ...lecture, occurrenceId: undefined }));
    expect(screen.queryByRole('button', { name: 'Transcript' })).not.toBeInTheDocument();
    expect(loadLectureTranscriptPdf).not.toHaveBeenCalled();
  });
});
