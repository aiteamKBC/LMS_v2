import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { feedbackApi, type FeedbackResponse, type FeedbackResponseEmail, type FeedbackResponseEmailContext } from '@/api/feedback';
import { ResponseEmailPanel } from './ResponseEmailPanel';
import { QUALITY_TICKET_CHANGED } from './qualityTicketEvents';

vi.mock('@/api/feedback', () => ({ feedbackApi: { responseEmails: vi.fn(), sendResponseEmail: vi.fn(), retryEmailTicketClose: vi.fn() } }));

const response = { id: 7, formTitle: 'Live Sessions Feedback', sessionTitle: 'Example session' } as FeedbackResponse;
const mailbox = 'Quality.Support@kentbusinesscollege.com';
const context: FeedbackResponseEmailContext = {
  recipient: { name: 'Example Learner', email: 'learner@example.test' }, sender: mailbox, replyTo: mailbox,
  canSend: true, reason: '', emails: [],
};
const email: FeedbackResponseEmail = {
  id: 'request-1', subject: 'Following up', body: 'Thank you for your feedback.',
  from: mailbox, to: 'learner@example.test', sentBy: 'Example Staff', status: 'sent', error: '',
  createdAt: '2026-11-17T10:00:00Z', sentAt: '2026-11-17T10:00:01Z',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(feedbackApi.responseEmails).mockResolvedValue(context);
  vi.mocked(feedbackApi.sendResponseEmail).mockResolvedValue({ email });
});

function setup() {
  const dirty = vi.fn(), sending = vi.fn(), close = vi.fn();
  render(<ResponseEmailPanel response={response} onDirtyChange={dirty} onSendingChange={sending} onClose={close} />);
  return { user: userEvent.setup(), dirty, sending, close };
}

describe('response email composer', () => {
  it('updates the matching dashboard ticket after accepted sending and closure', async () => {
    const changed = vi.fn();
    window.addEventListener(QUALITY_TICKET_CHANGED, changed);
    try {
      vi.mocked(feedbackApi.sendResponseEmail).mockResolvedValue({ email: { ...email, qualityTicket: { status: 'closed', error: '' } } });
      const { user } = setup();
      await user.type(await screen.findByLabelText('Message'), email.body);
      await user.click(screen.getByRole('button', { name: 'Preview email' }));
      await user.click(screen.getByRole('button', { name: 'Send email' }));
      expect(await screen.findByText('Quality ticket: Closed in LMS and technicalsupport')).toBeVisible();
      expect(changed).toHaveBeenCalledTimes(1);
      expect(changed.mock.calls[0][0].detail).toEqual({ responseId: 7, status: 'Closed' });
    } finally { window.removeEventListener(QUALITY_TICKET_CHANGED, changed); }
  });

  it('shows partial failure from persisted history and retries only ticket closure', async () => {
    vi.mocked(feedbackApi.responseEmails).mockResolvedValue({ ...context, emails: [{ ...email,
      qualityTicket: { status: 'failed', error: 'Email accepted. Ticket sync failed; retry closure.' },
    }] });
    vi.mocked(feedbackApi.retryEmailTicketClose).mockRejectedValueOnce(new Error('Still unavailable'))
      .mockResolvedValueOnce({ email: { ...email, qualityTicket: { status: 'closed', error: '' } } });
    const { user } = setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Ticket sync failed');
    await user.click(screen.getByRole('button', { name: 'Retry ticket closure' }));
    expect(await screen.findByText('Still unavailable')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry ticket closure' }));
    expect(await screen.findByText('Quality ticket: Closed in LMS and technicalsupport')).toBeVisible();
    expect(feedbackApi.retryEmailTicketClose).toHaveBeenLastCalledWith(7, email.id);
    expect(feedbackApi.sendResponseEmail).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry ticket closure' })).not.toBeInTheDocument();
  });
  it('previews the message and fixed recipient before explicitly sending and recording history', async () => {
    const { user, dirty, sending } = setup();
    await screen.findByLabelText('Subject');
    expect(screen.getByText(/learner@example.test/)).toBeVisible();
    await user.type(screen.getByLabelText('Message'), email.body);
    expect(feedbackApi.sendResponseEmail).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Preview email' }));
    expect(screen.getByLabelText('Email preview')).toHaveTextContent(email.body);
    expect(feedbackApi.sendResponseEmail).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Send email' }));
    await screen.findByText(/Your email was accepted for sending/);
    expect(feedbackApi.sendResponseEmail).toHaveBeenCalledExactlyOnceWith(7, {
      requestId: expect.any(String), subject: 'Following up on your feedback — Example session',
      body: email.body, expectedRecipient: 'learner@example.test',
    });
    expect(screen.getByText(/Accepted for sending ·/)).toBeVisible();
    expect(screen.getByLabelText('Message')).toHaveValue('');
    expect(dirty).toHaveBeenLastCalledWith(false);
    expect(sending.mock.calls).toEqual([[true], [false]]);
  });

  it('uses optional templates and preserves the draft when editing its preview', async () => {
    const { user } = setup();
    await user.selectOptions(await screen.findByLabelText('Message template'), 'details');
    const draft = (screen.getByLabelText('Message') as HTMLTextAreaElement).value;
    expect(draft).toContain('Hello Example Learner');
    await user.click(screen.getByRole('button', { name: 'Preview email' }));
    await user.click(screen.getByRole('button', { name: 'Edit message' }));
    expect(screen.getByLabelText('Message')).toHaveValue(draft);
    expect(feedbackApi.sendResponseEmail).not.toHaveBeenCalled();
  });

  it('keeps rejected messages visible and retryable with a new request identity', async () => {
    vi.mocked(feedbackApi.sendResponseEmail).mockResolvedValueOnce({ email: { ...email, status: 'failed', error: 'Mailbox access denied', sentAt: null } });
    const { user } = setup();
    await user.type(await screen.findByLabelText('Message'), email.body);
    await user.click(screen.getByRole('button', { name: 'Preview email' }));
    await user.click(screen.getByRole('button', { name: 'Send email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mailbox access denied');
    expect(screen.getByLabelText('Email preview')).toHaveTextContent(email.body);
    await user.click(screen.getByRole('button', { name: 'Send email' }));
    await screen.findByText(/Your email was accepted for sending/);
    const calls = vi.mocked(feedbackApi.sendResponseEmail).mock.calls;
    expect(calls[0][1].requestId).not.toBe(calls[1][1].requestId);
  });

  it('keeps the same request identity after a lost response and blocks duplicate clicks', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(feedbackApi.sendResponseEmail).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const { user, close } = setup();
    await user.type(await screen.findByLabelText('Message'), email.body);
    await user.click(screen.getByRole('button', { name: 'Preview email' }));
    await user.click(screen.getByRole('button', { name: 'Send email' }));
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close email panel' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Close email panel' }));
    expect(close).not.toHaveBeenCalled();
    await act(async () => reject(new Error('Connection lost')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    expect(screen.getByRole('button', { name: 'Close email panel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Edit message' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Check sending result' }));
    await screen.findByText(/Your email was accepted for sending/);
    const calls = vi.mocked(feedbackApi.sendResponseEmail).mock.calls;
    expect(calls[0][1].requestId).toBe(calls[1][1].requestId);
  });

  it('does not allow emailing anonymous feedback and exposes no recipient/history', async () => {
    vi.mocked(feedbackApi.responseEmails).mockResolvedValue({ ...context, recipient: null, canSend: false,
      reason: 'Email is unavailable for anonymous feedback.', emails: [] });
    setup();
    expect(await screen.findByText('Email is unavailable for anonymous feedback.')).toBeVisible();
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    expect(screen.queryByText(/learner@example.test/)).not.toBeInTheDocument();
    expect(feedbackApi.sendResponseEmail).not.toHaveBeenCalled();
  });

  it('allows closing the email panel without sending or clearing the draft', async () => {
    const { user, close, dirty } = setup();
    await user.type(await screen.findByLabelText('Message'), 'Keep this draft');
    await user.click(screen.getByRole('button', { name: 'Close email panel' }));
    expect(close).toHaveBeenCalledOnce();
    expect(dirty).toHaveBeenLastCalledWith(true);
    expect(feedbackApi.sendResponseEmail).not.toHaveBeenCalled();
  });

  it('preserves the draft and reloads a changed recipient before another preview', async () => {
    vi.mocked(feedbackApi.sendResponseEmail).mockRejectedValueOnce(Object.assign(new Error('The respondent email changed.'), { status: 409 }));
    vi.mocked(feedbackApi.responseEmails).mockResolvedValueOnce(context).mockResolvedValueOnce({
      ...context, recipient: { name: 'Example Learner', email: 'updated@example.test' },
    });
    const { user } = setup();
    await user.type(await screen.findByLabelText('Message'), email.body);
    await user.click(screen.getByRole('button', { name: 'Preview email' }));
    await user.click(screen.getByRole('button', { name: 'Send email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The respondent email changed.');
    expect(screen.getByLabelText('Message')).toHaveValue(email.body);
    expect(await screen.findByText(/updated@example.test/)).toBeVisible();
    expect(feedbackApi.sendResponseEmail).toHaveBeenCalledTimes(1);
  });

  it('surfaces loading errors and retries without fabricating an email address', async () => {
    vi.mocked(feedbackApi.responseEmails).mockRejectedValueOnce(new Error('Email history unavailable'));
    const { user } = setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Email history unavailable');
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload email details' }));
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeVisible());
  });
});
