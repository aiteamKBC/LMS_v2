import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QualityReviewDialog from './QualityReviewDialog';
import { qualityContext, saveQualityReview, QualityReviewError, type QualityContext, type QualityReview } from '@/api/coachingQualityReviews';
vi.mock('@/api/coachingQualityReviews', async () => ({ ...await vi.importActual<typeof import('@/api/coachingQualityReviews')>('@/api/coachingQualityReviews'), qualityContext: vi.fn(), saveQualityReview: vi.fn() }));
vi.mock('@/pages/learner/monthly-submission/AssignmentPdfPreview', () => ({ AssignmentPdfPreview: () => <div>PDF preview</div> }));
const context = (): QualityContext => ({ template: { id: 'portfolio-sampling-v1', title: 'Portfolio Sampling Feedback Form', ratings: { gold: 'High quality', green: 'Effective', amber: 'Weak', red: 'Absent', na: 'Not applicable' },
  sections: [{ id: 'progress', title: 'Progress reviews', screenshots: true, criteria: [{ id: 'progress-1', text: 'Synthetic criterion' }] }] },
  learners: [{ id: '1', name: 'Learner One' }, { id: '2', name: 'Learner Two' }], review: null,
  observer: { id: 'staff:1', name: 'Reviewer', email: 'reviewer@example.invalid' }, snapshot: { coach: { email: 'coach@example.invalid', name: 'Coach One' },
    learner: { id: '1', name: 'Learner One' }, meeting: { eventId: 'event', title: 'Synthetic meeting', startsAt: '2026-10-20T10:00:00Z', endsAt: '2026-10-20T11:00:00Z' } } });
describe('Quality review form', () => {
  beforeEach(() => {
    vi.mocked(qualityContext).mockReset().mockResolvedValue(context());
    vi.mocked(saveQualityReview).mockReset().mockImplementation(async payload => ({ ...context().snapshot, id: 'review-one', version: 1, templateId: 'portfolio-sampling-v1', identity: 'saved',
      learner: { id: '1', name: 'Learner One' }, status: payload.status, form: payload.form, reviewer: context().observer, updatedAt: '2026-10-20T12:00:00Z', updatedBy: 'staff:1' }) as QualityReview);
  });
  it('opens one scoped read, starts with blank ratings and saves only on an explicit action', async () => {
    render(<QualityReviewDialog initialLearnerId="1" eventKey="event" reference="signed" onClose={vi.fn()} />);
    await screen.findByRole('radio', { name: 'Green' });
    expect(qualityContext).toHaveBeenCalledWith('event', 'signed', '1', expect.any(AbortSignal));
    expect(saveQualityReview).not.toHaveBeenCalled();
    expect(screen.getAllByRole('radio').every(radio => !(radio as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Green' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Evidence observed and impact on the learner' }), { target: { value: 'Observed evidence at video 04:20.' } });
    expect(saveQualityReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Draft · Version 1 saved');
    expect(saveQualityReview).toHaveBeenCalledOnce();
    expect(vi.mocked(saveQualityReview).mock.calls[0][0]).toMatchObject({ learnerId: '1', expectedVersion: 0, status: 'draft', form: { criteria: { 'progress-1': { rating: 'green', evidence: 'Observed evidence at video 04:20.' } } } });
  });
  it('blocks completion without ratings and evidence, then completes the saved record', async () => {
    render(<QualityReviewDialog initialLearnerId="1" onClose={vi.fn()} />);
    await screen.findByRole('radio', { name: 'Green' });
    fireEvent.click(screen.getByRole('button', { name: 'Complete review' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a rating');
    expect(saveQualityReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Green' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Evidence observed and impact on the learner' }), { target: { value: 'Verified source observation.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete review' }));
    await screen.findByText('Completed · Version 1 saved');
    expect(screen.getByRole('button', { name: 'Preview PDF' })).toBeEnabled();
  });
  it('retains edits on a save conflict and reuses a request ID on an unchanged retry', async () => {
    vi.mocked(saveQualityReview).mockRejectedValue(new QualityReviewError('A newer saved version exists.', 409));
    render(<QualityReviewDialog initialLearnerId="1" onClose={vi.fn()} />);
    const evidence = await screen.findByRole('textbox', { name: 'Evidence observed and impact on the learner' });
    fireEvent.change(evidence, { target: { value: 'Keep this observation.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByRole('alert');
    expect(evidence).toHaveValue('Keep this observation.');
    expect(screen.getByRole('button', { name: 'Reload saved version' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveQualityReview).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveQualityReview).mock.calls[0][0].requestId).toBe(vi.mocked(saveQualityReview).mock.calls[1][0].requestId);
  });
  it('prevents edits during a pending save and preserves unsaved close cancellation', async () => {
    let complete!: (value: QualityReview) => void;
    vi.mocked(saveQualityReview).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const close = vi.fn(), confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const dirty = vi.fn(), busy = vi.fn();
    render(<QualityReviewDialog initialLearnerId="1" onClose={close} onDirtyChange={dirty} onBusyChange={busy} />);
    const evidence = await screen.findByRole('textbox', { name: 'Evidence observed and impact on the learner' });
    fireEvent.change(evidence, { target: { value: 'Unsaved note' } });
    expect(dirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close Portfolio sampling review' }));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(evidence).toBeDisabled();
    expect(busy).toHaveBeenLastCalledWith(true);
    const payload = vi.mocked(saveQualityReview).mock.calls[0][0];
    await act(async () => complete({ ...context().snapshot, id: 'review-one', version: 1, status: 'draft', form: payload.form, reviewer: context().observer } as QualityReview));
    expect(evidence).toBeEnabled();
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(dirty).toHaveBeenLastCalledWith(false);
    confirm.mockRestore();
  });
});
