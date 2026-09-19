import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProgressReviewsPage from '../../progress-reviews/page';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchLearnerEventReviewInstance, signLearnerProgressReview, type LearnerCalendarEvent, type LearnerReviewDefinition } from '@/api/learnerCalendar';

const access = vi.hoisted(() => ({ canProgress: true }));
vi.mock('@/hooks/useLearnerWorkspaceAccess', () => ({ useLearnerWorkspaceAccess: () => access }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/api/learnerCalendar', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/learnerCalendar')>(), fetchLearnerEventReviewInstance: vi.fn(), signLearnerProgressReview: vi.fn(),
}));
vi.mock('@/api/evidence', () => ({ fetchEvidence: vi.fn(async () => []) }));
vi.mock('@/pages/coach/progress-reviews/page', () => ({ buildProgressReviewSlidesDeck: () => ({}) }));
vi.mock('@/pages/coach/shared/CoachMeetingArtifactsPanel', () => ({ CoachMeetingArtifactsPanel: () => null }));
vi.mock('@/pages/coach/progress-reviews/components/ProgressReviewSlidesModal', () => ({
  default: ({ open, primaryAction }: { open: boolean; primaryAction?: ReactNode }) => open ? <section aria-label="Review slides">Slides content{primaryAction}</section> : null,
}));
vi.mock('@/pages/users/wizard/steps/SignaturePad', () => ({
  SignaturePad: ({ onCommit }: { onCommit: (signature: string) => void }) => <button type="button" onClick={() => onCommit('data:image/png;base64,c2F2ZWQ=')}>Confirm signature</button>,
}));

let selectedEvent: LearnerCalendarEvent;
let review: LearnerReviewDefinition;
vi.mock('@/pages/learner/reviews/useReviewSessions', () => ({
  useReviewSessions: () => {
    const [sessions, setEvents] = useState([selectedEvent]);
    return { myLearner: { kind: 'apprenticeship', id: '12' },
      learner: { name: 'Ayman Learner', programme: 'Marketing', components: [], quizAttempts: [], videoProgress: [], componentProgress: [] },
      sessions, setEvents, loading: false, error: '', refresh: vi.fn() };
  },
}));

function mount() {
  return render(<MemoryRouter initialEntries={['/learner/progress-reviews/review-1']}>
    <Routes><Route path="/learner/progress-reviews/:reviewId" element={<ProgressReviewsPage />} /></Routes>
  </MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  access.canProgress = true;
  vi.stubGlobal('AppIcon', AppIcon);
  selectedEvent = {
    id: 'review-1', eventKey: 'review-1', title: 'Progress review', source: 'progress-review', type: 'review', sequence: 1,
    status: 'awaiting-signature', date: '2026-09-14', targetDate: '2026-09-14', scheduledDate: '2026-09-14', scheduledTime: '09:00',
    durationMinutes: 60, coachName: 'Sam Coach', coachEmail: '', meetingProvider: '', meetingLink: '', notes: '', reviewResponses: {},
    reviewTemplateId: 'template-1', reviewInstanceId: 'instance-1', learnerSigned: false,
  };
  review = {
    manualOverride: null,
    instance: { id: 'instance-1', reviewTemplateId: 'template-1', learnerId: 12, programmeId: 'programme-1', occurrenceNumber: 1,
      targetDate: '2026-09-14', status: 'awaiting-signature', startedAt: null, completedAt: null },
    template: { id: 'template-1', name: 'Progress review', signatures: { advisor: true, participant: true, employer: false, referrer: false },
      visibleTo: { advisor: true, participant: true, employer: false, referrer: false }, recurrence: { interval: 12, unit: 'weeks' }, notifications: {}, allowEditingPriorDays: 0 },
    sections: [], signatures: {
      advisor: { required: true, signed: false }, participant: { required: true, signed: false },
      employer: { required: false, signed: false }, referrer: { required: false, signed: false },
    },
  };
  vi.mocked(fetchLearnerEventReviewInstance).mockImplementation(async () => structuredClone(review));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('progress review instance signatures', () => {
  it('shows a failed save in the shared form, then refreshes the saved signature on retry', async () => {
    vi.mocked(signLearnerProgressReview).mockRejectedValueOnce(new Error('Signature service unavailable'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm signature' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Signature service unavailable');
    expect(fetchLearnerEventReviewInstance).toHaveBeenCalledTimes(1);
    vi.mocked(signLearnerProgressReview).mockImplementationOnce(async () => {
      review.signatures.participant = { required: true, signed: true, signedName: 'Ayman Learner', signedAt: '2026-09-14T10:00:00Z', signature: 'data:image/png;base64,c2F2ZWQ=' };
      return { event: { ...selectedEvent, learnerSigned: false } };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm signature' }));
    expect(await screen.findByRole('img', { name: 'Learner signature' })).toHaveAttribute('src', 'data:image/png;base64,c2F2ZWQ=');
    expect(fetchLearnerEventReviewInstance).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Confirm signature' })).not.toBeInTheDocument();
    expect(screen.getByText('Your signature is saved')).toBeVisible();
  });

  it.each(['template', 'instance-only'])('keeps %s review slides viewable without adding the legacy sign flow', async (identity) => {
    if (identity === 'instance-only') selectedEvent.reviewTemplateId = null;
    review.signatures.participant = { required: true, signed: true, signedName: 'Ayman Learner' };
    mount();
    await screen.findByText('Your signature is saved');
    expect(screen.queryByRole('button', { name: 'Show slides & sign' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show slides' }));
    expect(await screen.findByLabelText('Review slides')).toHaveTextContent('Slides content');
    expect(screen.queryByRole('button', { name: 'Sign slides' })).not.toBeInTheDocument();
  });

  it('keeps a staff preview readable without allowing the learner to sign', async () => {
    access.canProgress = false;
    mount();
    await screen.findByRole('region', { name: 'Review signatures' });
    expect(screen.queryByRole('button', { name: 'Confirm signature' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show slides' })).toBeEnabled();
    expect(signLearnerProgressReview).not.toHaveBeenCalled();
  });

  it('retains legacy slides acknowledgement and its visible save error', async () => {
    selectedEvent.reviewTemplateId = null;
    selectedEvent.reviewInstanceId = null;
    vi.mocked(signLearnerProgressReview).mockRejectedValueOnce(new Error('Legacy signature unavailable'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Show slides & sign' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign slides' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I have reviewed the slides/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm signature' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Legacy signature unavailable'));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(fetchLearnerEventReviewInstance).not.toHaveBeenCalled();
  });
});
