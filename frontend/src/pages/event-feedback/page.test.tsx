import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { eventFeedbackApi } from '@/api/eventFeedback';
import EventFeedbackPage from './page';
import { eventFeedbackToken } from './token';

vi.mock('@/api/eventFeedback', () => ({
  eventFeedbackApi: { publicAccess: vi.fn(), savePublicResponse: vi.fn() },
}));

it('reads the personal token without requiring an LMS session and removes it from history', async () => {
  vi.mocked(eventFeedbackApi.publicAccess).mockRejectedValue(new Error('expired'));
  window.history.replaceState({}, '', '/event-feedback#token=private-token');

  render(<MemoryRouter initialEntries={['/event-feedback#token=private-token']}><EventFeedbackPage /></MemoryRouter>);

  expect(await screen.findByRole('alert')).toHaveTextContent('expired');
  expect(eventFeedbackApi.publicAccess).toHaveBeenCalledWith('private-token');
  await waitFor(() => expect(window.location.pathname).toBe('/event-feedback'));
  expect(window.location.hash).toBe('');
});

it('prefers the fragment token while supporting query links', () => {
  expect(eventFeedbackToken('?token=query-token', '#token=fragment-token')).toBe('fragment-token');
  expect(eventFeedbackToken('?token=query-token', '')).toBe('query-token');
});
