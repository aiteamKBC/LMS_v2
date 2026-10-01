/**
 * A new apprentice is sent to the first-sign-in screens before anything else —
 * and nobody else is.
 *
 * The server decides whether the screens are still needed; this hook only asks
 * for learners it could apply to (an apprentice still at 'Fresh user'), so a
 * learner midway through their programme never pays for the request, and a
 * failed request never locks anybody out of their own workspace.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

const fetchFirstLoginDetails = vi.fn();
vi.mock('@/api/firstLoginDetails', () => ({
  fetchFirstLoginDetails: (...args: unknown[]) => fetchFirstLoginDetails(...args),
}));

import {
  FIRST_LOGIN_ROUTE,
  resetFirstLoginDetailsRedirect,
  useFirstLoginDetailsRedirect,
} from '../useFirstLoginDetailsRedirect';

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={['/learner/home']}>{children}</MemoryRouter>
);

function render(kind: string, status: string, enabled = true, id = '41') {
  return renderHook(
    () => ({ checking: useFirstLoginDetailsRedirect(kind, id, status, enabled), location: useLocation() }),
    { wrapper },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFirstLoginDetailsRedirect();
});

describe('useFirstLoginDetailsRedirect', () => {
  it('sends a new apprentice to the first-sign-in screens', async () => {
    fetchFirstLoginDetails.mockResolvedValue({ required: true });
    const { result } = render('apprenticeship', 'Fresh user');

    expect(result.current.checking).toBe(true);
    await waitFor(() => expect(result.current.location.pathname).toBe(FIRST_LOGIN_ROUTE));
    expect(fetchFirstLoginDetails).toHaveBeenCalledWith('41');
  });

  it('lets the learner through once the server says the screens are done', async () => {
    fetchFirstLoginDetails.mockResolvedValue({ required: false });
    const { result } = render('apprenticeship', 'Fresh user');

    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.location.pathname).toBe('/learner/home');
  });

  it('does not ask again for a learner already confirmed as done', async () => {
    fetchFirstLoginDetails.mockResolvedValue({ required: false });
    const first = render('apprenticeship', 'Fresh user');
    await waitFor(() => expect(first.result.current.checking).toBe(false));
    first.unmount();

    const second = render('apprenticeship', 'Fresh user');
    expect(second.result.current.checking).toBe(false);
    expect(fetchFirstLoginDetails).toHaveBeenCalledTimes(1);
  });

  it('never locks a learner out when the check fails', async () => {
    fetchFirstLoginDetails.mockRejectedValue(new Error('offline'));
    const { result } = render('apprenticeship', 'Fresh user');

    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.location.pathname).toBe('/learner/home');
  });

  it.each([
    ['a commercial learner', 'commercial', 'Fresh user'],
    ['an apprentice already onboarding', 'apprenticeship', 'Onboarding'],
    ['an active apprentice', 'apprenticeship', 'Active'],
    // An unknown status is not treated as fresh (see isFreshStatus).
    ['a learner whose status is unknown', 'apprenticeship', ''],
  ])('does not check %s', (_label, kind, status) => {
    const { result } = render(kind, status);

    expect(result.current.checking).toBe(false);
    expect(fetchFirstLoginDetails).not.toHaveBeenCalled();
  });

  it('does not check while disabled, e.g. before the record has loaded', () => {
    const { result } = render('apprenticeship', 'Fresh user', false);

    expect(result.current.checking).toBe(false);
    expect(fetchFirstLoginDetails).not.toHaveBeenCalled();
  });
});
