import type { ReactNode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { feedbackApi, type FeedbackDashboardReport, type FeedbackResponse } from '@/api/feedback';
import type { HeaderNotification } from '@/components/feature/Header';
import QualityAssurancePage from './page';

const session = vi.hoisted(() => ({ account: { id: 1 } as { id: number } | null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: session.account } }) }));
vi.mock('@/components/feature/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/pages/executive/page', () => ({ default: ({ attentionPanel }: { attentionPanel: ReactNode }) => <>{attentionPanel}</> }));
vi.mock('@/components/feature/Header', () => ({ Header: ({ notifications, onNotificationClick }: {
  notifications: HeaderNotification[]; onNotificationClick: (notification: HeaderNotification) => void;
}) => <nav aria-label="Notification bell">{notifications.map(notification => <button key={notification.id} type="button" onClick={() => onNotificationClick(notification)}>{notification.title}</button>)}</nav> }));

const report = { analytics: { insights: { classification: { responses: [{
  responseId: 14, formId: 3, formTitle: 'Synthetic feedback', formType: 'post_lecture', version: 1,
  respondent: 'Anonymous learner', score: 20, classification: 'negative', scoredQuestions: 1,
  submittedAt: '2026-11-17T10:00:00Z', contextTitle: 'Synthetic session', groupName: 'Synthetic group',
}] } } } as FeedbackDashboardReport };
const response: FeedbackResponse = {
  id: 14, formId: 3, formTitle: 'Synthetic feedback', templateKey: 'synthetic', learnerId: null,
  formType: 'post_lecture', deliveryId: 1, sessionTitle: 'Synthetic session', sessionStartsAt: null,
  tutorName: 'Synthetic tutor', learnerName: 'Anonymous learner', programme: '', status: 'completed',
  startedAt: '2026-11-17T10:00:00Z', updatedAt: '2026-11-17T10:00:00Z', submittedAt: '2026-11-17T10:00:00Z',
  sections: [{ title: 'Original answers', description: '', questions: [{ id: 5, type: 'long_text', text: 'What needs improvement?', required: false, helpText: '', config: {}, answer: 'Synthetic answer from the server.' }] }],
};

beforeEach(() => {
  session.account = { id: 1 };
  vi.spyOn(feedbackApi, 'insightsDashboard').mockResolvedValue(report);
  vi.spyOn(feedbackApi, 'response').mockResolvedValue({ response });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Quality dashboard live notification wiring', () => {
  it('shares fetched alerts between the card and bell and opens original answers from either', async () => {
    render(<MemoryRouter><QualityAssurancePage /></MemoryRouter>);
    const card = within(screen.getByRole('region', { name: 'Needs Attention' }));
    await card.findByText('1 alert');
    const bell = within(screen.getByRole('navigation', { name: 'Notification bell' }));
    expect(bell.getByRole('button', { name: 'Anonymous learner · Red feedback' })).toBeInTheDocument();
    await userEvent.click(card.getByRole('button', { name: /Anonymous learner/ }));
    expect(await screen.findByRole('textbox', { name: 'What needs improvement?' })).toHaveValue('Synthetic answer from the server.');
    expect(feedbackApi.response).toHaveBeenLastCalledWith(14);
    await userEvent.click(screen.getByRole('button', { name: 'Close Feedback response' }));
    await userEvent.click(bell.getByRole('button', { name: 'Anonymous learner · Red feedback' }));
    expect(await screen.findByRole('textbox', { name: 'What needs improvement?' })).toHaveValue('Synthetic answer from the server.');
    expect(feedbackApi.response).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: 'Close Feedback response' }));
    vi.mocked(feedbackApi.insightsDashboard).mockResolvedValue({ analytics: { insights: { classification: { responses: [] } } } as FeedbackDashboardReport });
    await userEvent.click(card.getByRole('button', { name: 'Refresh alerts' }));
    await card.findByText('No quality alerts need your attention.');
    expect(bell.queryByRole('button')).not.toBeInTheDocument();
    expect(feedbackApi.insightsDashboard).toHaveBeenLastCalledWith({ classification: 'negative' });
  });

  it('does not show demo notifications when the server rejects a read', async () => {
    vi.mocked(feedbackApi.insightsDashboard).mockRejectedValueOnce(new Error('Not authorised to read feedback'));
    render(<MemoryRouter><QualityAssurancePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Not authorised to read feedback'));
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Notification bell' })).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('0 alerts')).not.toBeInTheDocument();
    expect(feedbackApi.response).not.toHaveBeenCalled();
  });

  it('closes the previous account response and clears alerts when signing out', async () => {
    const { rerender } = render(<MemoryRouter><QualityAssurancePage /></MemoryRouter>);
    const card = within(screen.getByRole('region', { name: 'Needs Attention' }));
    await card.findByText('1 alert');
    await userEvent.click(card.getByRole('button', { name: /Anonymous learner/ }));
    await screen.findByRole('textbox', { name: 'What needs improvement?' });
    session.account = null;
    rerender(<MemoryRouter><QualityAssurancePage /></MemoryRouter>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('1 alert')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in to load quality alerts.');
    expect(feedbackApi.response).toHaveBeenCalledTimes(1);
  });
});
