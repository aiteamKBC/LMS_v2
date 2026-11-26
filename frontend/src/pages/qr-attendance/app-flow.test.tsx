import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from '@/App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('opens through the real app router without a session or an activity audit write', async () => {
  vi.stubGlobal('__BASE_PATH__', '/');
  window.history.replaceState({}, '', '/qr-attendance');
  const requested: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), window.location.origin).pathname;
    requested.push(path);
    const body = path === '/curriculum_api/qr-attendance/'
      ? { csrfToken: 'csrf', url: 'https://college.example.test/qr-attendance', timeZone: 'Europe/London', serverNow: '2026-11-07T11:00:00Z' }
      : { error: 'Authentication required.' };
    return new Response(JSON.stringify(body), { status: path === '/login_api/me/' ? 401 : 200, headers: { 'Content-Type': 'application/json' } });
  }));
  render(<App />);
  expect(await screen.findByLabelText('Your Registered Email')).toBeVisible();
  expect(window.location.pathname).toBe('/qr-attendance');
  expect(requested).not.toContain('/curriculum_api/activity/record/');
  expect(screen.queryByText('Your session has ended')).not.toBeInTheDocument();
});
