import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/api/auth';
import { loadCompletionNotifications, updateCompletionNotifications } from '@/api/coachingCompletion';
import CompletionNotifications from './CompletionNotifications';
import CompletionNotice from '../coaching-recordings/CompletionNotice';
vi.mock('@/api/coachingCompletion', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/coachingCompletion')>(),
  loadCompletionNotifications: vi.fn(), updateCompletionNotifications: vi.fn(),
}));
const account = { id: 1, role: 'staff', access: 'coach' } as AuthUser;
const item = { id: 'completion:1', reminderId: 1, text: 'MCM: Synthetic Learner — complete this session in Aptem.',
  createdAt: '2026-10-24T12:00:00Z', unread: true, link: '/coach/coaching-recordings?meeting=verified-id' };
describe('completion inbox', () => {
  afterEach(cleanup);
  beforeEach(() => { vi.mocked(loadCompletionNotifications).mockReset().mockResolvedValue([item]); vi.mocked(updateCompletionNotifications).mockReset().mockResolvedValue(undefined); });
  it('shows the actual coach reminders and persists read/dismiss without changing completion', async () => {
    render(<MemoryRouter><CompletionNotifications account={account} /></MemoryRouter>);
    expect(await screen.findByText(item.text)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review meeting' })).toHaveAttribute('href', item.link);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    await waitFor(() => expect(updateCompletionNotifications).toHaveBeenCalledWith(account, [1], 'read'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss reminder' }));
    await waitFor(() => expect(screen.queryByText(item.text)).not.toBeInTheDocument());
    expect(updateCompletionNotifications).toHaveBeenLastCalledWith(account, [1], 'dismiss');
  });
  it('does not load another role and clears the old account when ownership changes', async () => {
    const view = render(<MemoryRouter><CompletionNotifications account={account} /></MemoryRouter>);
    await screen.findByText(item.text);
    view.rerender(<MemoryRouter><CompletionNotifications account={{ ...account, access: 'curriculum' }} /></MemoryRouter>);
    expect(screen.queryByText(item.text)).not.toBeInTheDocument();
    expect(loadCompletionNotifications).toHaveBeenCalledTimes(1);
  });
  it('shows a failure and explicit retry, without an automatic request loop', async () => {
    vi.mocked(loadCompletionNotifications).mockRejectedValue(new Error('Source reminders unavailable'));
    render(<StrictMode><MemoryRouter><CompletionNotifications account={account} /></MemoryRouter></StrictMode>);
    // StrictMode may subscribe twice; the API cache coalesces the actual HTTP read.
    expect(await screen.findByRole('alert')).toHaveTextContent('Source reminders unavailable');
    const before = vi.mocked(loadCompletionNotifications).mock.calls.length;
    vi.mocked(loadCompletionNotifications).mockResolvedValue([item]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh reminders' }));
    await waitFor(() => expect(loadCompletionNotifications).toHaveBeenCalledTimes(before + 1));
  });
  it('distinguishes completion, signatures and an unverified association', () => {
    const view = render(<CompletionNotice completion={{ state: 'action-required', source: 'aptem' }} />);
    expect(screen.getByText(/still needs completion in Aptem/)).toBeInTheDocument();
    view.rerender(<CompletionNotice completion={{ state: 'awaiting-signature', source: 'aptem' }} />);
    expect(screen.getByText(/awaiting signatures/)).toBeInTheDocument();
    view.rerender(<CompletionNotice completion={{ state: 'completed', source: 'aptem' }} />);
    expect(screen.getByText(/completed in Aptem/)).toBeInTheDocument();
    view.rerender(<CompletionNotice completion={{ state: 'unverified', source: 'aptem' }} />);
    expect(screen.getByText(/missing AI report does not confirm/)).toBeInTheDocument();
  });
});
