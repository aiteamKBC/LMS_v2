import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { eventFeedbackApi } from '@/api/eventFeedback';
import { PublicEventFeedback } from './PublicEventFeedback';

vi.mock('@/api/eventFeedback', () => ({
  eventFeedbackApi: { publicAccess: vi.fn(), savePublicResponse: vi.fn() },
}));

beforeEach(() => { vi.clearAllMocks(); });

it('opens every form attached to the token event', async () => {
  vi.mocked(eventFeedbackApi.publicAccess).mockResolvedValue({
    event: { id: 2, title: 'Leadership Day', date: '27 Sep 2026', location: 'London' },
    recipient: { name: 'Guest Person' },
    expiresAt: '2026-10-27T10:00:00Z',
    forms: [
      { id: 4, title: 'Venue feedback', description: '', instructions: '', allowSaveContinue: false, allowEditAfterSubmission: false, sections: [], response: { id: null, status: 'not_started', answers: {}, submittedAt: null } },
      { id: 5, title: 'Speaker feedback', description: '', instructions: '', allowSaveContinue: false, allowEditAfterSubmission: false, sections: [], response: { id: null, status: 'not_started', answers: {}, submittedAt: null } },
    ],
  });

  render(<PublicEventFeedback token="secret" />);

  expect(await screen.findByText('Leadership Day')).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Venue feedback' })).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Speaker feedback' })).toBeVisible();
  await waitFor(() => expect(eventFeedbackApi.publicAccess).toHaveBeenCalledWith('secret'));
  expect(eventFeedbackApi.publicAccess).toHaveBeenCalledWith('secret');
});

it('uses the same stepped form experience as learner feedback', async () => {
  const user = userEvent.setup();
  vi.mocked(eventFeedbackApi.publicAccess).mockResolvedValue({
    event: { id: 2, title: 'Leadership Day', date: '27 Sep 2026', location: 'London' },
    recipient: { name: 'Guest Person' },
    expiresAt: '2026-10-27T10:00:00Z',
    forms: [{
      id: 4, title: 'Event feedback', description: '', instructions: '',
      allowSaveContinue: false, allowEditAfterSubmission: false,
      sections: [
        { id: 1, title: 'Experience', icon: 'ri-star-line', description: '', questions: [{ id: 10, type: 'short_text', text: 'Your feedback', required: true, helpText: '', config: {} }] },
        { id: 2, title: 'Follow up', icon: 'ri-user-line', description: '', questions: [{ id: 11, type: 'long_text', text: 'Anything else?', required: false, helpText: '', config: {} }] },
      ],
      response: { id: null, status: 'not_started', answers: {}, submittedAt: null },
    }],
  });

  render(<PublicEventFeedback token="secret" />);

  expect(await screen.findByRole('button', { name: /Experience/ })).toHaveAttribute('aria-current', 'step');
  expect(screen.getByRole('textbox', { name: /Your feedback/ })).toBeVisible();
  expect(screen.queryByRole('textbox', { name: /Anything else/ })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('alert')).toHaveTextContent('required');
  await user.type(screen.getByRole('textbox', { name: /Your feedback/ }), 'Great event');
  await user.click(screen.getByRole('button', { name: 'Next' }));

  expect(screen.getByRole('textbox', { name: /Anything else/ })).toBeVisible();
  expect(screen.getByText('2/2')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Submit' })).toBeVisible();
});
