import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CopyInvitationLinkButton } from '../CopyInvitationLinkButton';
import { apiInvitationLink } from '@/api/auth';

vi.mock('@/api/auth', () => ({ apiInvitationLink: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('creates the link on request and copies it for staff to send another way', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  vi.mocked(apiInvitationLink).mockResolvedValue({ ok: true, link: 'https://lms.example/set-password?token=T', expiresAt: '2026-10-08T10:00:00Z', accountCreated: false });
  const onIssued = vi.fn();
  render(<CopyInvitationLinkButton subjectId={71} name="Example Learner" onIssued={onIssued} />);

  // Nothing is minted until staff ask for it.
  expect(apiInvitationLink).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Copy set-password link' }));
  const field = await screen.findByRole('textbox', { name: 'Set-password link for Example Learner' });
  expect(field).toHaveValue('https://lms.example/set-password?token=T');
  expect(apiInvitationLink).toHaveBeenCalledWith(71);
  expect(onIssued).toHaveBeenCalledOnce();
  expect(screen.getByText(/Any earlier invitation link or email for Example Learner no longer works/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith('https://lms.example/set-password?token=T');
});

it('shows why no link was created', async () => {
  vi.mocked(apiInvitationLink).mockRejectedValue(new Error('This person has already set a password. Send a password reset instead.'));
  render(<CopyInvitationLinkButton subjectId={71} name="Example Learner" />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy set-password link' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('already set a password');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
