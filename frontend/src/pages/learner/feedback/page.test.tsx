import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { feedbackApi, type LearnerFeedbackListItem } from '@/api/feedback';
import LearnerFeedbackPage from './page';

const flags = vi.hoisted(() => ({ fullFeedbackEnabled: true }));
vi.mock('@/lib/featureFlags', () => ({ get LEARNER_FEEDBACK_ENABLED() { return flags.fullFeedbackEnabled; } }));
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
    vi.stubGlobal('AppIcon', () => null);
    flags.fullFeedbackEnabled = true;
    Object.assign(state.account, { role: 'learner', subjectType: 'learner', subjectId: 61, displayName: 'Learner' });
    Object.assign(state.resolved, { kind: 'apprenticeship', id: '61' });
  });

  it.each([['mid_module', 'mid-module', 'Mid-module Feedback'], ['end_module', 'end-module', 'End-module Feedback']] as const)(
    'opens %s through its owned delivery and preserves its category', async (formType, category, title) => {
      flags.fullFeedbackEnabled = true;
      vi.mocked(feedbackApi.myForms).mockResolvedValue({ forms: [{ ...lecture, formType, title, sessionTitle: title }] });
      const user = userEvent.setup();
      render(<MemoryRouter initialEntries={['/learner/feedback']}><LearnerFeedbackPage /><Location /></MemoryRouter>);
      await user.click(await screen.findByRole('button', { name: /All feedback types/ }));
      await user.click(screen.getByRole('option', { name: title }));
      const requests = screen.getByRole('region', { name: 'All feedback requests' });
      await user.click(within(requests).getByRole('button', { name: new RegExp(`Start ${title}`) }));
      expect(screen.getByText(`/learner/feedback/delivery/21?category=${category}`)).toBeVisible();
    },
  );

  it('exposes only Live Sessions in production while keeping all other categories closed', async () => {
    flags.fullFeedbackEnabled = false;
    vi.mocked(feedbackApi.myForms).mockResolvedValue({ forms: [
      lecture,
      { ...lecture, id: 7, formType: 'mid_module', title: 'Module midpoint' },
      { ...lecture, id: 8, formType: 'end_module', title: 'Module end' },
      { ...lecture, id: 6, deliveryId: null, eventRecipientId: 40, formType: 'post_event', title: 'Event feedback' },
    ] });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/learner/feedback?category=event']}><LearnerFeedbackPage /><Location /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: /All feedback types/ }));
    expect(screen.getByRole('option', { name: /Live Sessions Feedback/ })).toBeVisible();
    expect(screen.queryByRole('option', { name: /Mid-module Feedback/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /End-module Feedback/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Event Feedback/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Event feedback')).not.toBeInTheDocument();
    expect(screen.queryByText('Module midpoint')).not.toBeInTheDocument();
    expect(screen.queryByText('Module end')).not.toBeInTheDocument();
  });

  it('shows a unified request list with type, search, status filters and summary', async () => {
    vi.mocked(feedbackApi.myForms).mockResolvedValue({ forms: [
      lecture,
      { ...lecture, id: 5, deliveryId: 22, sessionTitle: 'Data Foundations — Lecture 1', sessionStartsAt: '2026-09-16T09:00:00Z', status: 'completed' },
      { ...lecture, id: 6, deliveryId: null, eventRecipientId: 40, formType: 'post_event', moduleName: '', title: 'Leadership event', sessionTitle: 'Leadership Day' },
      { ...lecture, id: 7, deliveryId: null, reviewDeliveryId: 71, formType: 'post_mcm_review', moduleName: '', title: 'MCM feedback', sessionTitle: 'October coaching meeting' },
      { ...lecture, id: 8, deliveryId: null, reviewDeliveryId: 72, formType: 'post_progress_review', moduleName: '', title: 'Progress review feedback', sessionTitle: 'October progress review' },
    ] });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/learner/feedback']}><LearnerFeedbackPage /><Location /></MemoryRouter>);

    const typeFilter = await screen.findByRole('button', { name: /All feedback types/ });
    expect(screen.getByRole('region', { name: 'Action needed' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Your feedback summary' })).toBeVisible();

    await user.click(typeFilter);
    expect(screen.getByRole('option', { name: /Event Feedback/ })).toBeVisible();
    await user.click(screen.getByRole('option', { name: /Live Sessions Feedback/ }));
    expect(screen.getByText('/learner/feedback?category=lecture')).toBeVisible();
    const requests = screen.getByRole('region', { name: 'All feedback requests' });
    expect(within(requests).getByText('Data Foundations — Lecture 2')).toBeVisible();
    expect(within(requests).getByText('Data Foundations — Lecture 1')).toBeVisible();

    await user.type(screen.getByRole('textbox', { name: 'Search feedback' }), 'Lecture 2');
    expect(within(requests).queryByText('Data Foundations — Lecture 1')).not.toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: 'Search feedback' }));
    await user.click(screen.getByRole('button', { name: 'All statuses' }));
    await user.click(screen.getByRole('option', { name: 'Submitted' }));
    expect(within(requests).getByRole('button', { name: /View Data Foundations — Lecture 1/ })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Submitted' }));
    await user.click(screen.getByRole('option', { name: 'All statuses' }));
    await user.click(within(requests).getByRole('button', { name: /Start Data Foundations — Lecture 2/ }));
    expect(screen.getByText('/learner/feedback/delivery/21?category=lecture')).toBeVisible();
  });

  it('explains the learner feedback details and limits response visibility to the Engagement Team', async () => {
    vi.mocked(feedbackApi.myForms).mockResolvedValue({ forms: [lecture] });
    render(<MemoryRouter initialEntries={['/learner/feedback']}><LearnerFeedbackPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Helpful details before you submit' })).toBeVisible();
    for (const detail of ['Related session/module name', 'Event date', 'Deadline to submit', 'Estimated time to complete', 'Who can view it', 'Why this feedback matters', 'Can you resubmit?', 'Can you ignore it?']) {
      expect(screen.getByText(detail)).toBeVisible();
    }
    expect(screen.getAllByText(/Engagement Team/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Anonymous or named')).not.toBeInTheDocument();
  });

  it('preserves learner preview and selected category when staff opens a lecture', async () => {
    Object.assign(state.account, { role: 'staff', subjectType: 'staff', subjectId: 8, displayName: 'Reviewer' });
    Object.assign(state.resolved, { kind: 'commercial', id: '125' });
    vi.mocked(feedbackApi.myForms).mockResolvedValue({ forms: [lecture] });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/learner/feedback?learnerId=125&kind=commercial&category=lecture']}><LearnerFeedbackPage /><Location /></MemoryRouter>);

    expect(await screen.findByText(/Preview is read-only/)).toBeVisible();
    expect(feedbackApi.myForms).toHaveBeenCalledWith('125');
    const requests = screen.getByRole('region', { name: 'All feedback requests' });
    await user.click(within(requests).getByRole('button', { name: /Start Data Foundations — Lecture 2/ }));
    expect(screen.getByText('/learner/feedback/delivery/21?learnerId=125&kind=commercial&category=lecture')).toBeVisible();
  });
});
