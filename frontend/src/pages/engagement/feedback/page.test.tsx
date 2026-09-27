import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { feedbackApi, type FeedbackForm } from '@/api/feedback';
import FeedbackPage from './page';

vi.mock('@/hooks/useOperatorIdentity', () => ({
  useOperatorIdentity: () => ({ name: 'Staff User', role: 'Engagement Manager' }),
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/api/feedback', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/feedback')>();
  return {
    ...actual,
    feedbackApi: {
      ...actual.feedbackApi,
      listForms: vi.fn(), responses: vi.fn(), analytics: vi.fn(), versions: vi.fn(),
    },
  };
});

const form: FeedbackForm = {
  id: 20, title: 'Lecture feedback', formType: 'post_lecture', deliveryScope: 'all_modules',
  templateKey: 'template-1', version: 2, isCurrent: true, previousVersionId: 19,
  curriculumScope: { programmeId: '', programmeName: '', cohortId: '', cohortName: '', groupId: '', groupName: '', moduleCatalogueId: '', moduleName: '' },
  description: '', instructions: '', status: 'published', startDate: null, dueDate: null,
  anonymousResponses: false, allowSaveContinue: true, allowEditAfterSubmission: false,
  createdBy: 'Staff', createdAt: '2026-09-24T10:00:00Z', updatedAt: '2026-09-25T10:00:00Z', publishedAt: '2026-09-24T10:00:00Z',
  assignedCount: 22, responseCount: 3, startedCount: 3, structureLocked: false, willCreateVersion: true,
};

describe('feedback form version history', () => {
  beforeEach(() => {
    vi.mocked(feedbackApi.listForms).mockResolvedValue({ forms: [form], summary: { totalForms: 1, publishedForms: 1, draftForms: 0, totalResponses: 3 } });
    vi.mocked(feedbackApi.responses).mockResolvedValue({ responses: [] });
    vi.mocked(feedbackApi.analytics).mockResolvedValue({ analytics: { totalAssigned: 22, notStarted: 19, inProgress: 0, completed: 3, completionRate: 14, ratingAverages: [] } });
    vi.mocked(feedbackApi.versions).mockResolvedValue({ versions: [
      { id: 20, title: 'Lecture feedback', version: 2, isCurrent: true, previousVersionId: 19, status: 'published', createdAt: '2026-09-25T10:00:00Z', updatedAt: '2026-09-25T10:00:00Z', publishedAt: '2026-09-25T10:00:00Z', deliveryCount: 0, assignedCount: 0, startedCount: 0, responseCount: 0 },
      { id: 19, title: 'Lecture feedback', version: 1, isCurrent: false, previousVersionId: null, status: 'published', createdAt: '2026-09-24T10:00:00Z', updatedAt: '2026-09-24T10:00:00Z', publishedAt: '2026-09-24T10:00:00Z', deliveryCount: 1, assignedCount: 22, startedCount: 3, responseCount: 3 },
    ] });
  });

  it('shows the current version and opens historical versions read-only', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FeedbackPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Forms' }));

    expect(await screen.findByText('v2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Versions' }));

    await waitFor(() => expect(feedbackApi.versions).toHaveBeenCalledWith(20));
    expect(screen.getByText('Version history — Lecture feedback')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('Historical')).toBeInTheDocument();
  });
});
