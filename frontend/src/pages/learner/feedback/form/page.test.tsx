import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { feedbackApi, type FeedbackForm } from '@/api/feedback';
import LearnerFeedbackFormPage from './page';

vi.mock('@/api/feedback', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/feedback')>();
  return { ...actual, feedbackApi: { ...actual.feedbackApi, myForm: vi.fn(), saveResponse: vi.fn(), myDelivery: vi.fn(), saveDeliveryResponse: vi.fn(), myReviewDelivery: vi.fn(), saveReviewDeliveryResponse: vi.fn() } };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ auth: { account: { role: 'learner', subjectType: 'learner', subjectId: 61, learnerType: 'apprenticeship', displayName: 'Learner' } }, isInitialized: true }) }));
vi.mock('@/hooks/useMyLearner', () => ({ useResolvedLearner: () => ({ kind: 'apprenticeship', id: '61' }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/mocks/navigation', () => ({ roleNavMap: { learner: { label: 'Learner', items: [], workspaceLabel: 'Workspace' } } }));
vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));

const form: FeedbackForm = {
  id: 4, title: 'Lecture feedback', formType: 'post_lecture', deliveryScope: 'all_modules',
  templateKey: 'template-1', version: 1, isCurrent: true, previousVersionId: null,
  curriculumScope: { programmeId: '', programmeName: '', cohortId: '', cohortName: '', groupId: '', groupName: '', moduleCatalogueId: '', moduleName: '' },
  description: '', instructions: '', status: 'published', startDate: null, dueDate: null,
  anonymousResponses: false, allowSaveContinue: true, allowEditAfterSubmission: false,
  createdBy: 'Staff', createdAt: '2026-09-24T10:00:00Z', updatedAt: '2026-09-24T10:00:00Z', publishedAt: '2026-09-24T10:00:00Z',
  assignedCount: 1, responseCount: 0, startedCount: 0, structureLocked: false, willCreateVersion: false,
  sections: [{ id: 1, title: 'Experience', icon: 'ri-star-line', description: '', questions: [{ id: 10, type: 'short_text', text: 'Your feedback', required: false, helpText: '', config: {} }] }],
  response: { id: null, status: 'not_started', answers: {}, submittedAt: null }, delivery: null,
};

describe('learner feedback automatic save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(feedbackApi.myForm).mockResolvedValue({ form });
    vi.mocked(feedbackApi.saveResponse).mockResolvedValue({ response: { id: 9, status: 'in_progress', submittedAt: null, updatedAt: '2026-09-27T10:00:00Z' } });
    vi.mocked(feedbackApi.myReviewDelivery).mockResolvedValue({ form: {
      ...form, formType: 'post_mcm_review', title: 'MCM feedback',
      reviewDelivery: { id: 71, reviewType: 'Monthly Coaching Meeting', reviewName: 'October coaching', completedAt: '2026-10-19T09:00:00Z' },
    } });
  });

  it.each(['mid_module', 'end_module'] as const)('submits %s using the owned delivery', async formType => {
    vi.mocked(feedbackApi.myDelivery).mockResolvedValue({ form: { ...form, formType, title: 'Module feedback' } });
    vi.mocked(feedbackApi.saveDeliveryResponse).mockResolvedValue({ response: {
      id: 11, status: 'completed', submittedAt: '2026-10-21T10:00:00Z', updatedAt: '2026-10-21T10:00:00Z',
    } });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/learner/feedback/delivery/21']}><Routes><Route path="/learner/feedback/delivery/:deliveryId" element={<LearnerFeedbackFormPage />} /></Routes></MemoryRouter>);
    await user.type(await screen.findByRole('textbox', { name: 'Your feedback' }), 'Helpful module');
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(feedbackApi.saveDeliveryResponse).toHaveBeenCalledWith(21, { '10': 'Helpful module' }, true));
    expect(await screen.findByText('Thank you for your feedback')).toBeVisible();
  });

  it('opens a completed-review delivery through its dedicated route', async () => {
    render(<MemoryRouter initialEntries={['/learner/feedback/review/71?category=mcm']}><Routes><Route path="/learner/feedback/review/:reviewDeliveryId" element={<LearnerFeedbackFormPage />} /></Routes></MemoryRouter>);

    expect(await screen.findByText(/October coaching · Completed/)).toBeInTheDocument();
    expect(feedbackApi.myReviewDelivery).toHaveBeenCalledWith(71, undefined);
  });

  it('removes the Save button and saves an answer automatically', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/learner/feedback/4']}><Routes><Route path="/learner/feedback/:formId" element={<LearnerFeedbackFormPage />} /></Routes></MemoryRouter>);

    await user.type(await screen.findByRole('textbox', { name: 'Your feedback' }), 'Great session');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    await waitFor(() => expect(feedbackApi.saveResponse).toHaveBeenLastCalledWith(4, { '10': 'Great session' }, false), { timeout: 2500 });
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
  });

  it('shows bank categories as one page with stars before the closing question', async () => {
    vi.mocked(feedbackApi.myDelivery).mockResolvedValue({ form: {
      ...form,
      sections: [
        { id: 1, title: 'Teaching', icon: 'ri-star-line', description: '', questionsPerDelivery: 1,
          questions: [{ id: 11, type: 'rating', text: 'Was teaching clear?', required: true, helpText: '', config: { min: 1, max: 5, display: 'stars' } }] },
        { id: 2, title: 'Resources', icon: 'ri-star-line', description: '', questionsPerDelivery: 1,
          questions: [{ id: 12, type: 'rating', text: 'Were resources useful?', required: true, helpText: '', config: { min: 1, max: 5, display: 'stars' } }] },
        { id: 3, title: 'General comments', icon: 'ri-chat-3-line', description: '', questionsPerDelivery: null,
          questions: [{ id: 13, type: 'long_text', text: 'What could we improve?', required: false, helpText: '', config: {} }] },
      ],
    } });
    render(<MemoryRouter initialEntries={['/learner/feedback/delivery/44']}><Routes><Route path="/learner/feedback/delivery/:deliveryId" element={<LearnerFeedbackFormPage />} /></Routes></MemoryRouter>);

    expect(await screen.findByText('Was teaching clear?')).toBeInTheDocument();
    expect(feedbackApi.myDelivery).toHaveBeenCalledWith(44, undefined);
    expect(screen.getByText('Were resources useful?')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'What could we improve?' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });
});
