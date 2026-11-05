import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import App from '@/App';
import { flushActivity, resetActivity } from '@/lib/activityTrail';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  resetActivity();
  vi.unstubAllGlobals();
});

it('keeps a signed-out learner on the public lecture QR when audit or public access returns 401', async () => {
  vi.stubGlobal('__BASE_PATH__', '/');
  window.history.replaceState({}, '', '/lecture-feedback');
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(typeof input === 'string' ? input : input.toString(), window.location.origin).pathname;
    if (path === '/login_api/me/') return json({ error: 'Authentication required.' }, 401);
    if (path === '/curriculum_api/activity/record/') return json({ error: 'Authentication required.' }, 401);
    if (path === '/engagement_api/feedback/public-lecture/csrf/') return json({ csrfToken: 'csrf-1' });
    if (path === '/engagement_api/feedback/public-lecture/') return json({ error: 'Invalid email.' }, 401);
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<App />);
  const email = await screen.findByRole('textbox', { name: 'Aptem or LMS email' });
  flushActivity();
  expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/activity/record/'))).toBe(false);
  expect(window.location.pathname).toBe('/lecture-feedback');

  const user = userEvent.setup();
  await user.type(email, 'unknown@example.test');
  await user.click(screen.getByRole('button', { name: 'Open feedback' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email.');
  await waitFor(() => expect(window.location.pathname).toBe('/lecture-feedback'));
  expect(screen.queryByText('Your session has ended')).not.toBeInTheDocument();
});
