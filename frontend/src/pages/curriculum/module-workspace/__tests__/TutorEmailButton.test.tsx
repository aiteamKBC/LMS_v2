import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TutorEmailButton } from '../TutorEmailButton';
import { coachFetch } from '@/lib/coachFetch';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

it('emails the tutor only when staff press the button', async () => {
  vi.mocked(coachFetch)
    .mockImplementationOnce(() => reply(200, { tutor: { name: 'Amira Hassan', hasEmail: true }, lastSent: null }))
    .mockImplementationOnce(() => reply(200, { sent: true, tutor: 'Amira Hassan', lastSent: { status: 'sent', at: '2026-10-01T12:00:00Z' } }));
  render(<TutorEmailButton moduleId="MOD-ALPHA" tutorName="Amira Hassan" />);

  const button = await screen.findByRole('button', { name: /Email tutor/ });
  expect(coachFetch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(coachFetch).mock.calls[0][0]).toContain('/curriculum/modules/MOD-ALPHA/tutor-email/');
  fireEvent.click(button);
  expect(await screen.findByRole('status')).toHaveTextContent('Emailed Amira Hassan.');
  expect(vi.mocked(coachFetch).mock.calls[1][1]).toMatchObject({ method: 'POST' });
  expect(screen.getByRole('button', { name: /Email tutor again/ })).toBeInTheDocument();
});

it('asks before emailing a tutor again and does nothing if staff cancel', async () => {
  vi.mocked(coachFetch).mockImplementationOnce(() => reply(200, { tutor: { name: 'Amira Hassan', hasEmail: true }, lastSent: { status: 'sent', at: '2026-09-30T09:00:00Z' } }));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<TutorEmailButton moduleId="MOD-ALPHA" tutorName="Amira Hassan" />);
  fireEvent.click(await screen.findByRole('button', { name: /Email tutor again/ }));
  expect(confirm).toHaveBeenCalled();
  expect(coachFetch).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Last emailed/)).toBeInTheDocument();
});

it('cannot email a tutor with no address and shows send failures', async () => {
  vi.mocked(coachFetch).mockImplementationOnce(() => reply(200, { tutor: { name: 'Amira Hassan', hasEmail: false }, lastSent: null }));
  render(<TutorEmailButton moduleId="MOD-ALPHA" tutorName="Amira Hassan" />);
  expect(await screen.findByRole('button', { name: /Email tutor/ })).toBeDisabled();
  expect(screen.getByText(/No email address on file/)).toBeInTheDocument();
  cleanup();

  vi.mocked(coachFetch)
    .mockImplementationOnce(() => reply(200, { tutor: { name: 'Amira Hassan', hasEmail: true }, lastSent: null }))
    .mockImplementationOnce(() => reply(502, { error: 'The email to Amira Hassan could not be sent. Please try again.' }));
  render(<TutorEmailButton moduleId="MOD-ALPHA" tutorName="Amira Hassan" />);
  fireEvent.click(await screen.findByRole('button', { name: /Email tutor/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be sent');
});
