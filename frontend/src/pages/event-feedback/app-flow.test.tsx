import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('public event feedback through the full app shell', () => {
  beforeEach(() => {
    vi.stubGlobal('__BASE_PATH__', '/');
    window.history.replaceState({}, '', '/event-feedback#token=guest-token');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps a signed-out guest on the public form', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(typeof input === 'string' ? input : input.toString(), window.location.origin).pathname;
      if (path === '/login_api/me/') return json({ error: 'Authentication required.' }, 401);
      if (path === '/engagement_api/feedback/public-event/csrf/') return json({ csrfToken: 'csrf-1' });
      if (path === '/engagement_api/feedback/public-event/') return json({
        event: { id: 5, title: 'Offline Event', date: '29 Sep 2026', location: 'Tanta' },
        recipient: { name: 'Guest Attendee' }, expiresAt: '2026-10-29T12:00:00Z',
        forms: [{
          id: 9, title: 'Event feedback', description: '', instructions: '',
          allowSaveContinue: false, allowEditAfterSubmission: false, sections: [],
          response: { id: null, status: 'not_started', answers: {}, submittedAt: null },
        }],
      });
      if (path === '/curriculum_api/activity/record/') return json({ error: 'Authentication required.' }, 401);
      return json({});
    }));

    render(<App />);

    expect(await screen.findByText('Offline Event')).toBeVisible();
    expect(screen.getByText('Welcome, Guest Attendee. This personal link gives access only to your event forms.')).toBeVisible();
    expect(window.location.pathname).toBe('/event-feedback');
    expect(screen.queryByText('Your session has ended')).not.toBeInTheDocument();
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
  });

  it('shows a public-link error without redirecting to login', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(typeof input === 'string' ? input : input.toString(), window.location.origin).pathname;
      if (path === '/login_api/me/') return json({ error: 'Authentication required.' }, 401);
      if (path === '/engagement_api/feedback/public-event/csrf/') return json({ csrfToken: 'csrf-1' });
      if (path === '/engagement_api/feedback/public-event/') return json({ error: 'This feedback link is invalid or has expired.' }, 401);
      if (path === '/curriculum_api/activity/record/') return json({ error: 'Authentication required.' }, 401);
      return json({});
    }));

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('This feedback link is invalid or has expired.');
    await waitFor(() => expect(window.location.pathname).toBe('/event-feedback'));
    expect(screen.queryByText('Your session has ended')).not.toBeInTheDocument();
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
  });

  it('shows a published event form in the matched learner account', async () => {
    window.history.replaceState({}, '', '/learner/feedback');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(typeof input === 'string' ? input : input.toString(), window.location.origin).pathname;
      if (path === '/login_api/me/') return json({ user: {
        id: 22, email: 'learner@example.test', displayName: 'Matched Learner', role: 'learner',
        subjectType: 'learner', subjectId: 61, learnerType: 'apprenticeship',
        hasPassword: true, lastLoginAt: null, permissions: [],
      } });
      if (path === '/login_api/learner-entry/') return json({
        classification: 'new', required: false, canAccess: true,
      });
      if (path === '/learner_api/calendar/apprenticeship/61/first-session/') return json({
        caseOwner: null, booked: true, event: null, startsOn: '2026-09-01', access: 'open',
      });
      if (path === '/engagement_api/feedback/my-forms/') return json({ forms: [{
        id: 9, deliveryId: null, eventRecipientId: 5, title: 'Event feedback', description: '',
        sessionTitle: 'Offline Event', sessionStartsAt: null, assignedAt: '2026-09-29T12:00:00Z',
        dueDate: null, status: 'not_started', responseId: null,
      }] });
      return json({});
    }));

    render(<App />);

    expect(await screen.findByRole('button', { name: /Event feedback/ })).toBeVisible();
    expect(screen.getByText('Offline Event')).toBeVisible();
    expect(window.location.pathname).toBe('/learner/feedback');
  });
});
