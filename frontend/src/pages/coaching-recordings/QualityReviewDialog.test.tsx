import { act, fireEvent, render as renderUi, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QualityReviewDialog from './QualityReviewDialog';
import { qualityContext, qualityForms, qualityReview, qualityPdf, saveQualityReview, uploadQualityImage, QualityReviewError, type QualityContext, type QualityReview } from '@/api/coachingQualityReviews';
import { loadLinkedCoachingMeeting, type LinkedCoachingMeeting } from '@/api/coachingRecordings';
vi.mock('@/api/coachingQualityReviews', async () => ({ ...await vi.importActual<typeof import('@/api/coachingQualityReviews')>('@/api/coachingQualityReviews'), qualityContext: vi.fn(), qualityForms: vi.fn(), qualityReview: vi.fn(), qualityPdf: vi.fn(), saveQualityReview: vi.fn(), uploadQualityImage: vi.fn() }));
vi.mock('@/api/coachingRecordings', () => ({ loadLinkedCoachingMeeting: vi.fn() }));
vi.mock('@/pages/learner/monthly-submission/AssignmentPdfPreview', () => ({ AssignmentPdfPreview: () => <div>PDF preview</div> }));
const render = (element: ReactNode) => renderUi(<MemoryRouter>{element}</MemoryRouter>);
const context = (): QualityContext => ({ template: { id: 'portfolio-sampling-v1', title: 'Portfolio Sampling Feedback Form', ratings: { gold: 'High quality', green: 'Effective', amber: 'Weak', red: 'Absent', na: 'Not applicable' },
  sections: [{ id: 'progress', title: 'Progress reviews', screenshots: true, criteria: [{ id: 'progress-1', text: 'Synthetic criterion' }] }] },
  learners: [{ id: '1', name: 'Learner One' }, { id: '2', name: 'Learner Two' }], review: null,
  observer: { id: 'staff:1', name: 'Reviewer', email: 'reviewer@example.invalid' }, snapshot: { coach: { email: 'coach@example.invalid', name: 'Coach One' },
    learner: { id: '1', name: 'Learner One' }, meeting: { eventId: 'event', title: 'Synthetic MCM meeting', startsAt: '2026-10-20T10:00:00Z', endsAt: '2026-10-20T11:00:00Z' } } });
const choose = async (kind = 'MCM') => { fireEvent.click(await screen.findByRole('radio', { name: kind })); await screen.findByRole('radio', { name: 'Green' }); };
const occurrence = { meetingId: 'a'.repeat(32), meetingStartsAt: context().snapshot.meeting.startsAt, meetingEndsAt: context().snapshot.meeting.endsAt };
const expiredReference = () => new QualityReviewError('Refresh the calendar to renew this meeting reference.', 400, 'invalid_calendar_reference');
describe('Quality review form', () => {
  beforeEach(() => {
    vi.mocked(qualityForms).mockReset().mockResolvedValue({ forms: ['MCM','PR'].map(reviewType => ({ reviewType, title: reviewType, group: 'Forms', published: true, revision: 0, legacy: false })) });
    vi.mocked(qualityContext).mockReset().mockResolvedValue(context());
    vi.mocked(qualityReview).mockReset();
    vi.mocked(qualityPdf).mockReset().mockResolvedValue(new Blob(['%PDF-synthetic'], { type: 'application/pdf' }));
    vi.mocked(loadLinkedCoachingMeeting).mockReset().mockResolvedValue({ meeting: { meetingId: occurrence.meetingId,
      startsAt: occurrence.meetingStartsAt, endsAt: occurrence.meetingEndsAt, recordingsReference: 'renewed-reference' } } as LinkedCoachingMeeting);
    vi.mocked(uploadQualityImage).mockReset().mockResolvedValue({ id: 'saved-image' });
    vi.mocked(saveQualityReview).mockReset().mockImplementation(async payload => ({ ...context().snapshot, id: 'review-one', version: 1, templateId: 'portfolio-sampling-v1', identity: 'saved',
      learner: { id: '1', name: 'Learner One' }, reviewType: payload.reviewType, status: payload.status, form: payload.form, reviewer: context().observer, updatedAt: '2026-10-20T12:00:00Z', updatedBy: 'staff:1' }) as QualityReview);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('renews a stale reference on opening and keeps using it when choosing a form', async () => {
    vi.mocked(qualityContext).mockRejectedValueOnce(expiredReference());
    render(<QualityReviewDialog {...occurrence} initialLearnerId="1" reference="old-reference" onClose={vi.fn()} />);
    await choose();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(loadLinkedCoachingMeeting).toHaveBeenCalledWith(occurrence.meetingId, '2026-10-20', 'Europe/London', expect.any(AbortSignal), true);
    expect(vi.mocked(qualityContext).mock.calls.map(call => call[1])).toEqual(['old-reference', 'renewed-reference', 'renewed-reference']);
    expect(saveQualityReview).not.toHaveBeenCalled();
  });
  it.each(['Save draft', 'Complete review'])('renews an expired reference during %s, preserves answers and enables the saved PDF', async action => {
    const createUrl = vi.fn().mockReturnValue('blob:quality-review');
    vi.stubGlobal('URL', class extends URL { static createObjectURL = createUrl; static revokeObjectURL = vi.fn(); });
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.mocked(saveQualityReview).mockRejectedValueOnce(expiredReference());
    const onSaved = vi.fn();
    render(<QualityReviewDialog {...occurrence} initialLearnerId="1" reference="old-reference" onClose={vi.fn()} onSaved={onSaved} />);
    await choose();
    fireEvent.click(screen.getByRole('radio', { name: 'Green' }));
    const evidence = screen.getByRole('textbox', { name: 'Evidence observed and impact on the learner' });
    fireEvent.change(evidence, { target: { value: 'Keep the full observation after reference expiry.' } });
    fireEvent.click(screen.getByRole('button', { name: action }));
    await screen.findByText(`${action === 'Save draft' ? 'Draft' : 'Completed'} · Version 1 saved`);
    expect(evidence).toHaveValue('Keep the full observation after reference expiry.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(qualityContext).toHaveBeenCalledTimes(2);
    expect(loadLinkedCoachingMeeting).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledOnce();
    const [first, retry] = vi.mocked(saveQualityReview).mock.calls;
    expect(first[0]).toEqual(retry[0]);
    expect(first[0]).toMatchObject({ learnerId: '1', reviewType: 'MCM', expectedVersion: 0,
      form: { criteria: { 'progress-1': { rating: 'green', evidence: 'Keep the full observation after reference expiry.' } } } });
    expect(first[3]).toBe('old-reference'); expect(retry[3]).toBe('renewed-reference');
    if (action === 'Save draft') {
      fireEvent.click(screen.getByRole('button', { name: 'Complete review' }));
      await screen.findByText('Completed · Version 1 saved');
      const update = vi.mocked(saveQualityReview).mock.calls[2];
      expect(update[1]).toBe('review-one'); expect(update[0].expectedVersion).toBe(1);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
    expect(qualityPdf).toHaveBeenCalledWith(expect.objectContaining({ id: 'review-one', status: 'completed' }));
    expect(qualityContext).toHaveBeenCalledTimes(2);
  });
  it('keeps the selected form and unsaved answers when reference renewal is denied', async () => {
    vi.mocked(saveQualityReview).mockRejectedValueOnce(expiredReference());
    vi.mocked(loadLinkedCoachingMeeting).mockRejectedValue(new Error('This meeting is no longer accessible.'));
    render(<QualityReviewDialog {...occurrence} initialLearnerId="1" reference="old-reference" onClose={vi.fn()} />);
    await choose();
    const evidence = screen.getByRole('textbox', { name: 'Evidence observed and impact on the learner' });
    fireEvent.change(evidence, { target: { value: 'Do not discard this draft.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer accessible');
    expect(evidence).toHaveValue('Do not discard this draft.');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
    expect(saveQualityReview).toHaveBeenCalledOnce(); expect(qualityContext).toHaveBeenCalledTimes(2);
  });
  it('opens one scoped read, starts with blank ratings and saves only on an explicit action', async () => {
    render(<QualityReviewDialog initialLearnerId="1" eventKey="event" reference="signed" onClose={vi.fn()} />);
    await choose();
    await screen.findByRole('radio', { name: 'Green' });
    expect(qualityContext).toHaveBeenCalledWith('event', 'signed', '1', expect.any(AbortSignal), undefined);
    expect(saveQualityReview).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Edit form template' })).toHaveAttribute('href', '/curriculum/quality/forms?type=MCM');
    expect(screen.getAllByRole('radio').filter(radio => !['MCM','PR'].includes(radio.getAttribute('aria-label') || '')).every(radio => !(radio as HTMLInputElement).checked)).toBe(true);
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
    await choose();
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
  it('switches to the other published form only after accepting unsaved-answer loss', async () => {
    vi.mocked(qualityContext).mockImplementation(async (_event, _reference, _learner, _signal, kind) => {
      const value = context(); value.snapshot.reviewType = kind || 'MCM'; value.template.reviewType = kind || 'MCM';
      value.template.sections[0].criteria[0].text = `${kind || 'MCM'} only question`; return value;
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      render(<QualityReviewDialog initialLearnerId="1" eventKey="event" reference="signed" onClose={vi.fn()} />);
    await choose();
      await screen.findByText('MCM only question');
      fireEvent.change(screen.getByRole('textbox', { name: 'Evidence observed and impact on the learner' }), { target: { value: 'Keep the MCM note' } });
      fireEvent.click(screen.getByRole('button', { name: 'Choose another form' }));
      fireEvent.click(await screen.findByRole('radio', { name: 'PR' }));
      expect(qualityContext).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('textbox', { name: 'Evidence observed and impact on the learner' })).toHaveValue('Keep the MCM note');
      confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('radio', { name: 'PR' }));
      await screen.findByText('PR only question');
      expect(screen.getByRole('link', { name: 'Edit form template' })).toHaveAttribute('href', '/curriculum/quality/forms?type=PR');
      expect(screen.getByRole('textbox', { name: 'Evidence observed and impact on the learner' })).toHaveValue('');
      expect(screen.getByRole('link', { name: 'Edit form template' })).toHaveAttribute('href', '/curriculum/quality/forms?type=PR');
      expect(saveQualityReview).not.toHaveBeenCalled(); expect(qualityContext).toHaveBeenCalledTimes(3);
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      await screen.findByText('Draft · Version 1 saved');
      expect(vi.mocked(saveQualityReview).mock.calls[0][0]).toMatchObject({ reviewType: 'PR', learnerId: '1' });
    } finally { confirm.mockRestore(); }
  });
  it('requires an explicit form choice for an unknown title', async () => {
    const value = context(); value.snapshot.meeting.title = 'EPA readiness'; value.snapshot.reviewType = '';
    vi.mocked(qualityContext).mockResolvedValue(value);
    render(<QualityReviewDialog initialLearnerId="1" onClose={vi.fn()} />);
    await screen.findByRole('radio', { name: 'PR' });
    expect(screen.getByRole('button', { name: 'Complete review' })).toBeDisabled();
    expect(screen.queryByRole('radio', { name: 'Green' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'PR' }));
    await screen.findByRole('radio', { name: 'Green' });
    expect(screen.getByRole('link', { name: 'Edit form template' })).toHaveAttribute('href', '/curriculum/quality/forms?type=PR'); expect(saveQualityReview).not.toHaveBeenCalled();
  });
  it('keeps a saved manual type ahead of the original title suggestion', async () => {
    const value = context(); value.snapshot.reviewType = 'PR';
    value.review = { ...value.snapshot, id: 'saved', version: 2, reviewType: 'PR', learner: { id: '1', name: 'Learner One' },
      status: 'draft', form: { header: { employer: '', programme: '', activityDate: '', startDate: '', endDate: '' }, criteria: {}, images: {}, sources: [], actions: [] },
      reviewer: value.observer } as QualityReview;
    vi.mocked(qualityContext).mockResolvedValue(value);
    render(<QualityReviewDialog initialLearnerId="1" initialReviewType="MCM" onClose={vi.fn()} />);
    await choose('PR');
    await screen.findByRole('radio', { name: 'Green' });
    expect(screen.getByRole('link', { name: 'Edit form template' })).toHaveAttribute('href', '/curriculum/quality/forms?type=PR'); expect(qualityContext).toHaveBeenCalledTimes(2);
  });
  it('opens the original saved form through its ID and keeps its type and save version', async () => {
    const value = context();
    const saved = { ...value.snapshot, id: 'saved-review', version: 2, reviewType: 'MCM', learner: { id: '1', name: 'Learner One' }, status: 'draft',
      form: { header: { employer: '', programme: '', activityDate: '', startDate: '', endDate: '' }, criteria: {}, images: {}, sources: [], actions: [] }, reviewer: value.observer } as QualityReview;
    vi.mocked(qualityReview).mockImplementation(async (_id, _signal, kind) => ({ review: saved, reviewType: kind || 'MCM', template: { ...value.template, reviewType: kind || 'MCM' } }));
    render(<QualityReviewDialog reviewId={saved.id} onClose={vi.fn()} />);
    await screen.findByRole('radio', { name: 'Green' });
    expect(screen.queryByRole('button', { name: 'Choose another form' })).not.toBeInTheDocument();
    await waitFor(() => expect(qualityReview).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveQualityReview).toHaveBeenCalledOnce());
    expect(vi.mocked(saveQualityReview).mock.calls[0][0]).toMatchObject({ reviewType: 'MCM', expectedVersion: 2 });
    expect(vi.mocked(saveQualityReview).mock.calls[0][1]).toBe(saved.id);
  });
  it('retains edits on a save conflict and reuses a request ID on an unchanged retry', async () => {
    vi.mocked(saveQualityReview).mockRejectedValue(new QualityReviewError('A newer saved version exists.', 409));
    render(<QualityReviewDialog initialLearnerId="1" onClose={vi.fn()} />);
    await choose();
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
    await choose();
    const evidence = await screen.findByRole('textbox', { name: 'Evidence observed and impact on the learner' });
    fireEvent.change(evidence, { target: { value: 'Unsaved note' } });
    expect(dirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close Quality Check' }));
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
  it('attaches an image to the saved learner review and includes it in the next save', async () => {
    render(<QualityReviewDialog initialLearnerId="1" onClose={vi.fn()} />);
    await choose();
    await screen.findByRole('radio', { name: 'Green' });
    expect(screen.getByLabelText('Attach image: Progress reviews screenshots')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' })); await screen.findByText('Draft · Version 1 saved');
    const image = new File(['synthetic image bytes'], 'capture.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Attach image: Progress reviews screenshots'), { target: { files: [image] } });
    await screen.findByRole('img', { name: 'Saved review screenshot' });
    expect(uploadQualityImage).toHaveBeenCalledWith('review-one', 'progress', image);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveQualityReview).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveQualityReview).mock.calls[1][0].form.images.progress).toEqual(['saved-image']);
  });
});
