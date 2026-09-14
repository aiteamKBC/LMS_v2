import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviousRecordMenuItem } from './PreviousRecordMenuItem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getWorkspaceRecordLink } from './api';
import { rememberSignedInLearner } from '@/hooks/useMyLearner';

const state = vi.hoisted(() => ({ account: { id: 1, role: 'learner', hasLegacyRecord: true } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: state }) }));
vi.mock('./api', () => ({ getWorkspaceRecordLink: vi.fn() }));
function Location() { return <output data-testid="path">{useLocation().pathname}</output>; }
let client: QueryClient;
function page(path = '/workspace/learner') {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/workspace/learner" element={<PreviousRecordMenuItem onNavigate={vi.fn()} />} />
    <Route path="/workspace/learner/:kind/:id/dashboard" element={<PreviousRecordMenuItem onNavigate={vi.fn()} />} />
    <Route path="/old-otjh/*" element={<p>Record destination</p>} />
  </Routes><Location /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  state.account = { id: 1, role: 'learner', hasLegacyRecord: true };
  rememberSignedInLearner(undefined, undefined);
  localStorage.clear();
  vi.mocked(getWorkspaceRecordLink).mockResolvedValue({ href: null });
});
afterEach(() => { cleanup(); client?.clear(); vi.resetAllMocks(); localStorage.clear(); });

describe('previous record workspace shortcut', () => {
  it('hides the link for new learners even when an old session hint says otherwise', async () => {
    page();
    await waitFor(() => expect(getWorkspaceRecordLink).toHaveBeenCalledWith(undefined));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });
  it('opens only the signed-in learners months despite a selected learner in the URL or storage', async () => {
    state.account.hasLegacyRecord = false;
    localStorage.setItem('my_learner', JSON.stringify({ kind: 'apprenticeship', id: '999' }));
    vi.mocked(getWorkspaceRecordLink).mockResolvedValue({ href: '/old-otjh/months' });
    page('/workspace/learner/apprenticeship/999/dashboard');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Previous learning record' }));
    expect(getWorkspaceRecordLink).toHaveBeenCalledWith(undefined);
    expect(screen.getByTestId('path')).toHaveTextContent('/old-otjh/months');
  });
  it.each(['admin', 'staff'])('opens the selected existing learner months in a %s preview', async role => {
    state.account.role = role;
    vi.mocked(getWorkspaceRecordLink).mockResolvedValue({ href: '/old-otjh/coach/42/months?workspace=learner' });
    page('/workspace/learner/apprenticeship/7/dashboard');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Previous learning record' }));
    expect(getWorkspaceRecordLink).toHaveBeenCalledWith('7');
    expect(screen.getByTestId('path')).toHaveTextContent('/old-otjh/coach/42/months');
  });
  it('hides the link in a new learner admin preview', async () => {
    state.account.role = 'admin';
    page('/workspace/learner/commercial/7/dashboard');
    await waitFor(() => expect(getWorkspaceRecordLink).toHaveBeenCalledWith('7'));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });
  it('hides the link while eligibility cannot be verified', async () => {
    vi.mocked(getWorkspaceRecordLink).mockRejectedValue(new Error('Unavailable'));
    page();
    await waitFor(() => expect(getWorkspaceRecordLink).toHaveBeenCalled());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });
  it('never falls back to a staff directory destination', async () => {
    vi.mocked(getWorkspaceRecordLink).mockResolvedValue({ href: '/old-otjh/coach' });
    page();
    await waitFor(() => expect(getWorkspaceRecordLink).toHaveBeenCalled());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });
});
