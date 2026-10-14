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
      listForms: vi.fn(), responses: vi.fn(), analytics: vi.fn(), versions: vi.fn(), recipients: vi.fn(),
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
    vi.mocked(feedbackApi.recipients).mockResolvedValue({
      recipients: [], total: 0, page: 1, pageSize: 50,
      sources: [
        { key: 'lecture:32', type: 'lecture', label: 'Lecture attendance', title: 'Martech - Thur - Session 2', subtitle: 'Martech - Thur', startsAt: '2026-09-24T09:30:00Z', assignedCount: 10, responseCount: 3 },
        { key: 'lecture:31', type: 'lecture', label: 'Lecture attendance', title: 'Martech - Thur - Session 1', subtitle: 'Martech - Thur', startsAt: '2026-09-17T09:30:00Z', assignedCount: 12, responseCount: 1 },
      ],
      lectures: [
        { deliveryId: 32, occurrenceKey: 'session-2', sessionTitle: 'Martech - Thur - Session 2', moduleName: 'Martech - Thur', startsAt: '2026-09-24T09:30:00Z', assignedCount: 10, responseCount: 3 },
        { deliveryId: 31, occurrenceKey: 'session-1', sessionTitle: 'Martech - Thur - Session 1', moduleName: 'Martech - Thur', startsAt: '2026-09-17T09:30:00Z', assignedCount: 12, responseCount: 1 },
      ],
    });
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

  it('opens assigned learners on the latest lecture and can select another lecture', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FeedbackPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Forms' }));
    await user.click(screen.getByRole('button', { name: '22' }));

    const lectureFilter = await screen.findByRole('combobox', { name: 'Filter by lecture' });
    await waitFor(() => expect(feedbackApi.recipients).toHaveBeenCalledWith(20, '', 1, 50, 'lecture:32'));
    expect(lectureFilter).toHaveValue('lecture:32');
    expect(screen.getByRole('option', { name: /Session 1.*12 assigned, 1 responses/ })).toBeInTheDocument();

    await user.selectOptions(lectureFilter, 'lecture:31');
    await waitFor(() => expect(feedbackApi.recipients).toHaveBeenCalledWith(20, '', 1, 50, 'lecture:31'));
  });

  it('shows event attendees from the event assignment source', async () => {
    const user = userEvent.setup();
    const eventForm = { ...form, id: 31, title: 'Event feedback', formType: 'post_event' as const, assignedCount: 1 };
    vi.mocked(feedbackApi.listForms).mockResolvedValue({ forms: [eventForm], summary: { totalForms: 1, publishedForms: 1, draftForms: 0, totalResponses: 0 } });
    vi.mocked(feedbackApi.recipients).mockResolvedValue({
      recipients: [{
        key: 'event-8-44', learnerId: '', learnerName: 'Guest Attendee', email: 'guest@example.test', programme: '',
        source: 'event_attendance', sourceKey: 'event:8', sourceType: 'event', sourceLabel: 'Event attendance',
        sourceTitle: 'Leadership Day', sourceSubtitle: 'Main Hall', sourceStartsAt: '2026-09-29',
        deliveryId: null, occurrenceKey: '', sessionTitle: 'Leadership Day', sessionStartsAt: null, moduleName: '',
        assignedAt: '2026-09-29T10:00:00Z', dueDate: null, responseStatus: 'not_started', formVersion: 1, recipientType: 'guest',
      }],
      sources: [{ key: 'event:8', type: 'event', label: 'Event attendance', title: 'Leadership Day', subtitle: 'Main Hall', startsAt: '2026-09-29', assignedCount: 1, responseCount: 0 }],
      lectures: [], total: 1, page: 1, pageSize: 50,
    });
    render(<MemoryRouter><FeedbackPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Forms' }));
    await user.click(screen.getByRole('button', { name: '1' }));

    expect(await screen.findByText('Assigned attendees — Event feedback')).toBeInTheDocument();
    expect(await screen.findByText('Guest Attendee')).toBeInTheDocument();
    expect(screen.getByText('Event attendance')).toBeInTheDocument();
    expect(screen.getByText('Guest')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Event' })).toBeInTheDocument();
  });
});
