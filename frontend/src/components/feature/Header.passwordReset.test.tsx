/**
 * Resetting your own password from the profile menu.
 *
 * Reuses the same /forgot-password/ endpoint the sign-in page's "Forgot
 * password?" link uses, rather than a second reset flow that could drift from
 * it. That endpoint deliberately does not disclose whether an address has an
 * account, so the menu reports only that a link was sent.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Header } from './Header';

const forgotPassword = vi.fn();

vi.mock('@/api/auth', () => ({ apiForgotPassword: (email: string) => forgotPassword(email) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    auth: {
      user: { email: 'aya.khater@kentbusinesscollege.com', displayName: 'Aya Aya Test' },
      // The header reads roles and account for its label; a partial mock makes
      // it throw before the menu renders.
      roles: [{ name: 'Apprentice learner' }],
      account: null,
    },
    logout: vi.fn(),
  }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light', toggle: vi.fn() }) }));

async function openProfileMenu() {
  render(<MemoryRouter><Header /></MemoryRouter>);
  // The menu is behind the avatar button; the item does not exist until opened.
  const triggers = screen.getAllByRole('button');
  for (const trigger of triggers) {
    await userEvent.click(trigger);
    if (screen.queryByText(/reset password/i)) return;
  }
}

describe('profile menu password reset', () => {
  beforeEach(() => {
    forgotPassword.mockReset();
    forgotPassword.mockResolvedValue('If that address has an account, a reset link has been sent to it.');
  });

  it('offers a reset option naming the signed-in address', async () => {
    await openProfileMenu();

    // The address is named on the item itself so somebody with two accounts
    // knows which inbox to open. Matched on the sentence rather than the bare
    // address, which also appears in the menu header.
    expect(screen.getByText(/we will email a link to aya\.khater@kentbusinesscollege\.com/i)).toBeTruthy();
  });

  it('sends the reset to the signed-in address', async () => {
    await openProfileMenu();

    await userEvent.click(screen.getByText(/reset password/i));

    expect(forgotPassword).toHaveBeenCalledWith('aya.khater@kentbusinesscollege.com');
  });

  it('confirms in place rather than closing the menu', async () => {
    // Closing on click would leave the person unsure whether anything happened.
    await openProfileMenu();

    await userEvent.click(screen.getByText(/reset password/i));

    expect(await screen.findByText(/reset email sent/i)).toBeTruthy();
  });

  it('does not send twice', async () => {
    await openProfileMenu();

    await userEvent.click(screen.getByText(/reset password/i));
    await screen.findByText(/reset email sent/i);
    await userEvent.click(screen.getByText(/reset email sent/i));

    expect(forgotPassword).toHaveBeenCalledTimes(1);
  });

  it('reports a failure instead of claiming success', async () => {
    forgotPassword.mockRejectedValue(new Error('Mail service unavailable.'));
    await openProfileMenu();

    await userEvent.click(screen.getByText(/reset password/i));

    expect(await screen.findByText(/mail service unavailable/i)).toBeTruthy();
  });
});
