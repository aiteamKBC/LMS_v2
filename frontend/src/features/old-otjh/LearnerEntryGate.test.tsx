import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LearnerEntryGate } from './LearnerEntryGate';
import { fetchLearnerEntry } from './entry';

const session = vi.hoisted(() => ({ auth: { account: { id: 7, role: 'learner', hasLegacyRecord: false } }, logout: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => session }));
vi.mock('./entry', () => ({ fetchLearnerEntry: vi.fn() }));
const pending = { classification: 'existing' as const, enabled: true, required: true, canAccess: false, totalMonths: 2, completedMonths: 0 };
const allowed = { ...pending, required: false, canAccess: true };
function mount(path = '/learner/home') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
    <LearnerEntryGate><Routes>
      <Route path="/learner/home" element={<p>Personalised student home</p>} />
      <Route path="/learner/my-learning" element={<p>Learning content</p>} />
      <Route path="/old-otjh/months" element={<div>Complete monthly document<Link to="/learner/home">Cancel and return</Link></div>} />
      <Route path="/messages" element={<p>Contact the support team</p>} />
    </Routes></LearnerEntryGate>
  </MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { session.auth.account.role = 'learner'; vi.mocked(fetchLearnerEntry).mockResolvedValue(pending); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

describe('mandatory student entry', () => {
  it.each(['/learner/home', '/workspace/learner', '/workspace/learner/dashboard', '/learner/my-learning'])('blocks direct navigation to %s even without the session legacy hint', async path => {
    mount(path);
    const dialog = await screen.findByRole('dialog', { name: 'Review and sign your previous learning record' });
    expect(screen.queryByText('Learning content')).not.toBeInTheDocument();
    expect(screen.queryByText('Personalised student home')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(dialog.parentElement!.firstElementChild!);
    expect(dialog).toBeInTheDocument();
  });
  it.each(['new', 'existing'] as const)('allows verified %s learners with access', async classification => {
    vi.mocked(fetchLearnerEntry).mockResolvedValue({ ...allowed, classification });
    mount();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Personalised student home')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('fails closed on profile errors and retries', async () => {
    vi.mocked(fetchLearnerEntry).mockRejectedValueOnce(new Error('Profile could not be verified'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Profile could not be verified');
    expect(screen.queryByText('Personalised student home')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Review and sign' })).toBeInTheDocument();
  });
  it('keeps signing available; cancelling and forged success events do not unlock access', async () => {
    mount();
    fireEvent.click(await screen.findByRole('link', { name: 'Review and sign' }));
    expect(await screen.findByText('Complete monthly document')).toBeInTheDocument();
    fireEvent(window, new Event('previous-record-updated'));
    fireEvent.click(screen.getByRole('link', { name: 'Cancel and return' }));
    expect(await screen.findByRole('link', { name: 'Review and sign' })).toBeInTheDocument();
    expect(screen.queryByText('Personalised student home')).not.toBeInTheDocument();
  });
  it('returns from signing only after a fresh backend verification', async () => {
    mount('/old-otjh/months');
    await waitFor(() => expect(fetchLearnerEntry).toHaveBeenCalled());
    // Wait for the initial required status to be observed.
    await new Promise(resolve => setTimeout(resolve, 20));
    vi.mocked(fetchLearnerEntry).mockResolvedValue(allowed);
    fireEvent(window, new Event('previous-record-updated'));
    expect(await screen.findByText('Personalised student home')).toBeInTheDocument();
  });
  it('checks on mount and after a saved record, without polling or focus refreshes', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchLearnerEntry).mockResolvedValue(allowed);
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchLearnerEntry).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchLearnerEntry).toHaveBeenCalledTimes(1);

    fireEvent(window, new Event('previous-record-updated'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchLearnerEntry).toHaveBeenCalledTimes(2);
  });
  it('keeps support and sign-out available during the block', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(session.logout).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('link', { name: 'Contact support' }));
    expect(await screen.findByText('Contact the support team')).toBeInTheDocument();
  });
  it.each(['staff', 'admin'])('preserves %s access without querying a learner', role => {
    session.auth.account.role = role;
    mount();
    expect(screen.getByText('Personalised student home')).toBeInTheDocument();
    expect(fetchLearnerEntry).not.toHaveBeenCalled();
  });
});
