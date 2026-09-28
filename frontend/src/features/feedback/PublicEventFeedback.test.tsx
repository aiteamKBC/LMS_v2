import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { eventFeedbackApi } from '@/api/eventFeedback';
import { PublicEventFeedback } from './PublicEventFeedback';

vi.mock('@/api/eventFeedback', () => ({
  eventFeedbackApi: { publicAccess: vi.fn(), savePublicResponse: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(eventFeedbackApi.publicAccess).mockReset();
  window.history.replaceState({}, '', '/login#feedback=secret');
});

it('opens every form attached to the token event and removes the token from browser history', async () => {
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
  await waitFor(() => expect(window.location.hash).toBe(''));
  expect(eventFeedbackApi.publicAccess).toHaveBeenCalledWith('secret');
});
