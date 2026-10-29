import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import MeetingQualityChecks from './MeetingQualityChecks';
import { meetingQualityChecks, attachedQualityPdf } from '@/api/coachingQualityReviews';
vi.mock('@/api/coachingQualityReviews', async () => ({ ...await vi.importActual<typeof import('@/api/coachingQualityReviews')>('@/api/coachingQualityReviews'), meetingQualityChecks: vi.fn(), attachedQualityPdf: vi.fn() }));
vi.mock('@/pages/learner/monthly-submission/AssignmentPdfPreview', () => ({ AssignmentPdfPreview: () => <div>Saved PDF rendered</div> }));
const check = { id: 'review-one', learnerId: '1', learnerName: 'Learner One', status: 'completed', version: 2, pdfVersion: 2, updatedAt: '2026-10-25T10:00:00Z' };
beforeEach(() => {
  vi.mocked(meetingQualityChecks).mockReset().mockResolvedValue({ reviews: [check], nextOffset: null });
  vi.mocked(attachedQualityPdf).mockReset().mockResolvedValue(new Blob(['%PDF-saved'], { type: 'application/pdf' }));
  URL.createObjectURL = vi.fn(() => 'blob:saved-quality'); URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
it('loads metadata once and only loads PDF bytes after explicit action', async () => {
  const onOpen = vi.fn(), preview = vi.fn();
  render(<MeetingQualityChecks meetingId={'a'.repeat(32)} refresh={0} onOpen={onOpen} onPreviewChange={preview} />);
  await screen.findByText('Learner One'); expect(attachedQualityPdf).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open saved form' })); expect(onOpen).toHaveBeenCalledWith('review-one');
  fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' })); await screen.findByText('Saved PDF rendered');
  expect(attachedQualityPdf).toHaveBeenCalledOnce(); expect(preview).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close Quality check PDF' }));
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
  expect(attachedQualityPdf).toHaveBeenCalledOnce(); expect(URL.createObjectURL).toHaveBeenCalledOnce();
});
it('keeps earlier checks when loading another page', async () => {
  vi.mocked(meetingQualityChecks).mockResolvedValueOnce({ reviews: [check], nextOffset: 30 }).mockResolvedValueOnce({ reviews: [{ ...check, id: 'review-two', learnerName: 'Learner Two' }], nextOffset: null });
  render(<MeetingQualityChecks meetingId={'a'.repeat(32)} refresh={0} onOpen={vi.fn()} onPreviewChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Load more checks' }));
  await screen.findByText('Learner Two'); expect(screen.getByText('Learner One')).toBeInTheDocument();
  expect(vi.mocked(meetingQualityChecks).mock.calls[1][2]).toBe(30);
});
it('requests the new completed version after refresh even when only an older PDF was stored', async () => {
  const props = { meetingId: 'a'.repeat(32), onOpen: vi.fn(), onPreviewChange: vi.fn() };
  const view = render(<MeetingQualityChecks {...props} refresh={0} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Preview PDF' }));
  await screen.findByText('Saved PDF rendered');
  fireEvent.click(screen.getByRole('button', { name: 'Close Quality check PDF' }));
  vi.mocked(meetingQualityChecks).mockResolvedValue({ reviews: [{ ...check, version: 3, pdfVersion: 2 }], nextOffset: null });
  view.rerender(<MeetingQualityChecks {...props} refresh={1} />);
  await screen.findByText('Saved PDF - version 3');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:saved-quality');
  fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
  await waitFor(() => expect(attachedQualityPdf).toHaveBeenLastCalledWith(check.id, 3));
});
it('shows a failed read as an error and only retries on request', async () => {
  vi.mocked(meetingQualityChecks).mockRejectedValueOnce(new Error('Unavailable'));
  render(<MeetingQualityChecks meetingId={'a'.repeat(32)} refresh={0} onOpen={vi.fn()} onPreviewChange={vi.fn()} />);
  await screen.findByRole('alert'); expect(screen.queryByText(/No quality check has been saved/)).not.toBeInTheDocument();
  expect(meetingQualityChecks).toHaveBeenCalledOnce(); fireEvent.click(screen.getByRole('button', { name: 'Retry checks' }));
  await screen.findByText('Learner One'); expect(meetingQualityChecks).toHaveBeenCalledTimes(2);
});
it('lists separate forms for the same learner using their saved names without reading document bodies', async () => {
  vi.mocked(meetingQualityChecks).mockResolvedValue({ reviews: [
    { ...check, reviewType: 'FORM_MONTHLY_COACHING', formTitle: 'Monthly Coaching Meeting Feedback Form' },
    { ...check, id: 'review-two', reviewType: 'FORM_SAFEGUARDING', formTitle: 'Safeguarding Feedback Form' },
  ], nextOffset: null });
  const open = vi.fn();
  render(<MeetingQualityChecks meetingId={'a'.repeat(32)} refresh={0} onOpen={open} onPreviewChange={vi.fn()} />);
  await screen.findByText('Monthly Coaching Meeting Feedback Form');
  expect(screen.getByText('Safeguarding Feedback Form')).toBeInTheDocument();
  expect(screen.getAllByText('Learner One')).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('button', { name: 'Open saved form' })[1]);
  expect(open).toHaveBeenCalledWith('review-two');
  expect(attachedQualityPdf).not.toHaveBeenCalled(); expect(meetingQualityChecks).toHaveBeenCalledOnce();
});

it('shows the authenticated saver separately from the learner and preserves missing historical names', async () => {
  vi.mocked(meetingQualityChecks).mockResolvedValue({ reviews: [{ ...check, reviewerName: 'Quality Reviewer' }, { ...check, id: 'old-review' }], nextOffset: null });
  render(<MeetingQualityChecks meetingId={'a'.repeat(32)} refresh={0} onOpen={vi.fn()} onPreviewChange={vi.fn()} />);
  expect(await screen.findByText('Saved by: Quality Reviewer')).toBeInTheDocument();
  expect(screen.getByText('Saved by: Not recorded')).toBeInTheDocument();
});
