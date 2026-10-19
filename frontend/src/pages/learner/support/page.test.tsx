import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import SupportPage from './page';
import { createSupportTicket, loadSupportTickets } from '@/api/supportTickets';
vi.mock('@/api/supportTickets', async () => ({
  ...await vi.importActual<typeof import('@/api/supportTickets')>('@/api/supportTickets'),
  createSupportTicket: vi.fn(), loadSupportTickets: vi.fn(), updateSupportTicket: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadSupportTickets).mockResolvedValue([]);
});

const session = vi.hoisted(() => ({
  account: { displayName: 'Alex Example', programme: 'Example Course' } as {
    displayName: string | null; programme: string;
  } | null,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: session }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children, userName, userRole }: { children: ReactNode; userName: string; userRole: string }) => (
    <main><span>{userName}</span><span>{userRole}</span>{children}</main>
  ),
}));

(globalThis as Record<string, unknown>).AppIcon = () => <i />;
afterEach(cleanup);

it('uses the signed-in account and updates the greeting when the account changes', () => {
  session.account = { displayName: 'Alex Example', programme: 'Example Course' };
  const view = render(<MemoryRouter><SupportPage /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'How can we help, Alex?' })).toBeInTheDocument();
  expect(screen.getByText('Example Course')).toBeInTheDocument();
  session.account = { displayName: 'Taylor Example', programme: '' };
  view.rerender(<MemoryRouter><SupportPage /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'How can we help, Taylor?' })).toBeInTheDocument();
  expect(screen.queryByText('Alex Example')).not.toBeInTheDocument();
});

it.each([null, { displayName: null, programme: '' }, { displayName: '   ', programme: '' }])(
  'uses a neutral greeting when no account name is available: %s', account => {
    session.account = account;
    render(<MemoryRouter><SupportPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'How can we help?' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Sophie/ })).not.toBeInTheDocument();
  },
);

it('keeps a failed message, retries with the same request ID, then shows the saved ticket', async () => {
  session.account = { displayName: 'Alex Example', programme: '' };
  vi.mocked(createSupportTicket).mockRejectedValueOnce(new Error('Service unavailable'));
  vi.mocked(createSupportTicket).mockImplementationOnce(async body => ({ ...body, id: body.requestId,
    status: 'open', priority: 'medium', requester: 'Alex Example', submitted: '2026-10-19T12:00:00Z',
    lastUpdate: '2026-10-19T12:00:00Z', assignedTo: '', assignedTeam: 'LMS Support', replies: [], timeline: [], messages: 0,
  }));
  render(<MemoryRouter><SupportPage /></MemoryRouter>);
  await screen.findByText('You have no support tickets yet.');
  expect(screen.queryByText('Unable to upload evidence file — keeps timing out')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /New Ticket/ }));
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Cannot finish an activity' } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A timing error appears when saving.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit Ticket' }));
  await screen.findByText('Service unavailable');
  expect(screen.getByLabelText('Description')).toHaveValue('A timing error appears when saving.');
  fireEvent.click(screen.getByRole('button', { name: 'Submit Ticket' }));
  await screen.findByText('Your support ticket has been saved.');
  expect(createSupportTicket).toHaveBeenCalledTimes(2);
  expect(vi.mocked(createSupportTicket).mock.calls[0][0].requestId).toBe(vi.mocked(createSupportTicket).mock.calls[1][0].requestId);
  expect(screen.getAllByText('Cannot finish an activity').length).toBeGreaterThan(0);
  expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
});

it('reports ticket loading failures without showing demo tickets', async () => {
  vi.mocked(loadSupportTickets).mockRejectedValue(new Error('Tickets unavailable'));
  render(<MemoryRouter><SupportPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Tickets unavailable'));
  expect(screen.queryByText('OTJH hours not showing in monthly summary')).not.toBeInTheDocument();
});
