import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { eventFeedbackApi } from '@/api/eventFeedback';
import { PublicEventRsvp } from './PublicEventRsvp';

vi.mock('@/api/eventFeedback', () => ({
  eventFeedbackApi: { publicRsvp: vi.fn(), savePublicRsvp: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(eventFeedbackApi.publicRsvp).mockResolvedValue({
    event: { id: 2, title: 'Leadership Day', date: '2 Oct 2026', time: '10:00 - 12:00', location: 'London' },
    recipient: { name: 'Guest Person' }, rsvpStatus: 'no_response', expiresAt: '2026-11-01T10:00:00Z',
    form: {
      id: 8, title: 'Event RSVP', description: 'Tell us your plans', instructions: '',
      allowSaveContinue: false, allowEditAfterSubmission: true,
      sections: [{ id: 1, title: 'Details', description: '', questions: [{ id: 10, type: 'short_text', text: 'Dietary needs', required: false, helpText: '', config: {} }] }],
      response: { id: null, status: 'not_started', answers: {}, submittedAt: null },
    },
  });
  vi.mocked(eventFeedbackApi.savePublicRsvp).mockResolvedValue({
    rsvpStatus: 'yes', response: { id: 22, status: 'completed', submittedAt: '2026-10-01T10:00:00Z' },
  });
});

it('collects a changeable RSVP separately from extra form answers', async () => {
  const user = userEvent.setup();
  render(<PublicEventRsvp token="private-token" />);

  expect(await screen.findByText('Leadership Day')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'yes' }));
  await user.type(screen.getByRole('textbox', { name: /Dietary needs/ }), 'Vegetarian');
  await user.click(screen.getByRole('button', { name: 'Submit' }));

  expect(eventFeedbackApi.savePublicRsvp).toHaveBeenCalledWith('private-token', 'yes', { '10': 'Vegetarian' });
  expect(await screen.findByText(/Your RSVP has been saved/)).toBeVisible();
});
