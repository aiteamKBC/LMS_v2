import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { feedbackApi } from '@/api/feedback';
import LearnerFeedbackPage from './page';

vi.mock('@/api/feedback', () => ({ feedbackApi: { myForms: vi.fn() } }));
const state = {
  account: { role: 'learner', subjectType: 'learner', subjectId: 61, learnerType: 'apprenticeship', displayName: 'Learner' },
  resolved: { kind: 'apprenticeship', id: '61' },
};
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: state.account }, isInitialized: true }) }));
vi.mock('@/hooks/useMyLearner', () => ({ useResolvedLearner: () => state.resolved }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/mocks/navigation', () => ({ roleNavMap: { learner: { label: 'Learner', items: [], workspaceLabel: 'Workspace' } } }));

function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }

describe('learner feedback deliveries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(state.account, { role: 'learner', subjectType: 'learner', subjectId: 61, displayName: 'Learner' });
    Object.assign(state.resolved, { kind: 'apprenticeship', id: '61' });
  });

  it('shows the lecture and opens the delivery-specific route', async () => {
    vi.mocked(feedbackApi.myForms).mockResolvedValue({ forms: [{
      id: 4, deliveryId: 21, title: 'Lecture feedback', description: '',
      sessionTitle: 'Data Foundations — Lecture 2', sessionStartsAt: '2026-09-23T09:00:00Z',
      assignedAt: '2026-09-23T10:00:00Z', dueDate: null, status: 'not_started', responseId: null,
    }] });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/learner/feedback']}><LearnerFeedbackPage /><Location /></MemoryRouter>);

    expect(await screen.findByText(/Data Foundations — Lecture 2/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Lecture feedback/ }));
    expect(screen.getByText('/learner/feedback/delivery/21')).toBeVisible();
  });

  it('loads the selected learner during staff view-as and preserves the target link', async () => {
    Object.assign(state.account, { role: 'staff', subjectType: 'staff', subjectId: 8, displayName: 'Reviewer' });
    Object.assign(state.resolved, { kind: 'commercial', id: '125' });
    vi.mocked(feedbackApi.myForms).mockResolvedValue({ forms: [{
      id: 4, deliveryId: 21, title: 'Lecture feedback', description: '', sessionTitle: 'Lecture 2',
      sessionStartsAt: null, assignedAt: '2026-09-23T10:00:00Z', dueDate: null,
      status: 'not_started', responseId: null,
    }] });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/learner/feedback?learnerId=125&kind=commercial']}><LearnerFeedbackPage /><Location /></MemoryRouter>);

    expect(await screen.findByText(/Preview is read-only/)).toBeVisible();
    expect(feedbackApi.myForms).toHaveBeenCalledWith('125');
    await user.click(screen.getByRole('button', { name: /Lecture feedback/ }));
    expect(screen.getByText('/learner/feedback/delivery/21?learnerId=125&kind=commercial')).toBeVisible();
  });
});
