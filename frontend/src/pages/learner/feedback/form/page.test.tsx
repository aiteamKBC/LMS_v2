import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { feedbackApi, type FeedbackForm } from '@/api/feedback';
import LearnerFeedbackFormPage from './page';

vi.mock('@/api/feedback', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/feedback')>();
  return { ...actual, feedbackApi: { ...actual.feedbackApi, myForm: vi.fn(), saveResponse: vi.fn() } };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { role: 'learner', subjectType: 'learner', subjectId: 61, learnerType: 'apprenticeship', displayName: 'Learner' } }, isInitialized: true }) }));
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
  });

  it('removes the Save button and saves an answer automatically', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/learner/feedback/4']}><Routes><Route path="/learner/feedback/:formId" element={<LearnerFeedbackFormPage />} /></Routes></MemoryRouter>);

    await user.type(await screen.findByRole('textbox', { name: 'Your feedback' }), 'Great session');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    await waitFor(() => expect(feedbackApi.saveResponse).toHaveBeenLastCalledWith(4, { '10': 'Great session' }, false), { timeout: 2500 });
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
  });
});
