import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { feedbackApi, type LearnerFeedbackListItem } from '@/api/feedback';
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

const lecture: LearnerFeedbackListItem = {
  id: 4, deliveryId: 21, formType: 'post_lecture', moduleName: 'Martech - Thur',
  title: 'Lecture feedback', description: '', sessionTitle: 'Data Foundations — Lecture 2',
  sessionStartsAt: '2026-09-23T09:00:00Z', assignedAt: '2026-09-23T10:00:00Z',
  dueDate: null, status: 'not_started', responseId: null,
};

describe('learner feedback categories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(state.account, { role: 'learner', subjectType: 'learner', subjectId: 61, displayName: 'Learner' });
    Object.assign(state.resolved, { kind: 'apprenticeship', id: '61' });
  });

  it('shows every feedback type, then groups attended lectures by module', async () => {
    vi.mocked(feedbackApi.myForms).mockResolvedValue({ forms: [
      lecture,
      { ...lecture, id: 5, deliveryId: 22, sessionTitle: 'Data Foundations — Lecture 1', sessionStartsAt: '2026-09-16T09:00:00Z', status: 'completed' },
      { ...lecture, id: 6, deliveryId: null, eventRecipientId: 40, formType: 'post_event', moduleName: '', title: 'Leadership event', sessionTitle: 'Leadership Day' },
      { ...lecture, id: 7, deliveryId: null, reviewDeliveryId: 71, formType: 'post_mcm_review', moduleName: '', title: 'MCM feedback', sessionTitle: 'October coaching meeting' },
      { ...lecture, id: 8, deliveryId: null, reviewDeliveryId: 72, formType: 'post_progress_review', moduleName: '', title: 'Progress review feedback', sessionTitle: 'October progress review' },
    ] });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/learner/feedback']}><LearnerFeedbackPage /><Location /></MemoryRouter>);

    const types = await screen.findByRole('region', { name: 'Feedback types' });
    const lectureType = within(types).getByRole('button', { name: /Lecture Feedback/ });
    const eventType = within(types).getByRole('button', { name: /Event Feedback/ });
    const mcmType = within(types).getByRole('button', { name: /MCM Feedback/ });
    const progressReviewType = within(types).getByRole('button', { name: /Progress Review Feedback/ });
    const generalType = within(types).getByRole('button', { name: /General Feedback/ });
    expect(within(lectureType).getByText('2')).toBeVisible();
    expect(within(eventType).getAllByText('1')).toHaveLength(2);
    expect(within(mcmType).getAllByText('1')).toHaveLength(2);
    expect(within(progressReviewType).getAllByText('1')).toHaveLength(2);
    expect(within(generalType).getAllByText('0')).toHaveLength(2);

    await user.click(lectureType);
    expect(screen.getByText('/learner/feedback?category=lecture')).toBeVisible();
    const module = screen.getByRole('region', { name: 'Martech - Thur' });
    expect(within(module).getByText('2 lectures')).toBeVisible();
    expect(within(module).getByRole('button', { name: /Data Foundations — Lecture 2/ })).toBeVisible();

    await user.click(within(module).getByRole('button', { name: /Data Foundations — Lecture 2/ }));
    expect(screen.getByText('/learner/feedback/delivery/21?category=lecture')).toBeVisible();

    await user.click(screen.getByRole('button', { name: /All feedback types/ }));
    await user.click(within(screen.getByRole('region', { name: 'Feedback types' })).getByRole('button', { name: /MCM Feedback/ }));
    await user.click(screen.getByRole('button', { name: /October coaching meeting/ }));
    expect(screen.getByText('/learner/feedback/review/71?category=mcm')).toBeVisible();
  });

  it('preserves learner preview and selected category when staff opens a lecture', async () => {
    Object.assign(state.account, { role: 'staff', subjectType: 'staff', subjectId: 8, displayName: 'Reviewer' });
    Object.assign(state.resolved, { kind: 'commercial', id: '125' });
    vi.mocked(feedbackApi.myForms).mockResolvedValue({ forms: [lecture] });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/learner/feedback?learnerId=125&kind=commercial&category=lecture']}><LearnerFeedbackPage /><Location /></MemoryRouter>);

    expect(await screen.findByText(/Preview is read-only/)).toBeVisible();
    expect(feedbackApi.myForms).toHaveBeenCalledWith('125');
    await user.click(screen.getByRole('button', { name: /Data Foundations — Lecture 2/ }));
    expect(screen.getByText('/learner/feedback/delivery/21?learnerId=125&kind=commercial&category=lecture')).toBeVisible();
  });
});
