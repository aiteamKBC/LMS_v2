import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import SupportPage from './page';
import { createSupportTicket, loadSupportTickets, updateSupportTicket, type SupportTicket } from '@/api/supportTickets';
vi.mock('@/api/supportTickets', async () => ({
  ...await vi.importActual<typeof import('@/api/supportTickets')>('@/api/supportTickets'),
  createSupportTicket: vi.fn(), loadSupportTickets: vi.fn(), updateSupportTicket: vi.fn(),
}));
const coachHeader = vi.hoisted(() => ({ data: null as { coach: { name: string; email?: string; phone?: string | null } } | null }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadSupportTickets).mockResolvedValue([]);
  coachHeader.data = null;
});

const session = vi.hoisted(() => ({
  account: { displayName: 'Alex Example', programme: 'Example Course' } as {
    displayName: string | null; programme: string; subjectType?: string; subjectId?: number; learnerType?: string;
  } | null,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ auth: session }) }));
vi.mock('@/hooks/useDashboardHeader', () => ({ useDashboardHeader: () => coachHeader }));
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

it('shows the assigned learner coach email from the dashboard data', () => {
  session.account = { displayName: 'Alex Example', programme: '', subjectType: 'learner', subjectId: 125, learnerType: 'commercial' };
  coachHeader.data = { coach: { name: 'Sarah Collins', email: 'sarah.collins@kbc.ac.uk', phone: '01227 811 402' } };
  render(<MemoryRouter><SupportPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Contact Us' }));
  expect(screen.getByText('Sarah Collins')).toBeInTheDocument();
  expect(screen.getByText('sarah.collins@kbc.ac.uk')).toBeInTheDocument();
  expect(screen.queryByText('01227 811 402')).not.toBeInTheDocument();
  expect(screen.getByText('Crispin Reed')).toBeInTheDocument();
  expect(screen.getByText('Crispin@kentbusinesscollege.com')).toBeInTheDocument();
  expect(screen.queryByText('01227 811 235')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Call' })).not.toBeInTheDocument();
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

const savedTicket: SupportTicket = { id: 'ticket-1', title: 'Attachment issue', description: 'Details',
  category: 'Technical Issue', priority: 'medium', status: 'open', requester: 'Example Learner',
  submitted: '2026-10-19T12:00:00Z', lastUpdate: '2026-10-19T12:00:00Z', assignedTo: '', assignedTeam: 'LMS Support',
  messages: 0, timeline: [], replies: [], attachments: [{ id: 'file-1', name: 'screenshot.png', size: 5, contentType: 'image/png' }] };

it('keeps selected files on save failure and shows the saved attachment after retry', async () => {
  vi.mocked(createSupportTicket).mockRejectedValueOnce(new Error('Storage unavailable')).mockResolvedValueOnce(savedTicket);
  render(<MemoryRouter><SupportPage /></MemoryRouter>);
  await screen.findByText('You have no support tickets yet.');
  fireEvent.click(screen.getByRole('button', { name: /New Ticket/ }));
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: savedTicket.title } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: savedTicket.description } });
  const image = new File(['image'], 'screenshot.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Attachments (optional)'), { target: { files: [image] } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit Ticket' }));
  await screen.findByText('Storage unavailable');
  expect(screen.getByRole('button', { name: 'Remove screenshot.png' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Submit Ticket' }));
  expect(await screen.findByRole('link', { name: 'Download screenshot.png' })).toHaveAttribute('href', '/learner_api/support/tickets/ticket-1/attachments/file-1/');
  expect(vi.mocked(createSupportTicket).mock.calls[0][1]).toEqual([image]);
  expect(vi.mocked(createSupportTicket).mock.calls[1]).toEqual(vi.mocked(createSupportTicket).mock.calls[0]);
});

it('adds reply files and retains them for a failed retry', async () => {
  vi.mocked(loadSupportTickets).mockResolvedValue([savedTicket]);
  vi.mocked(updateSupportTicket).mockRejectedValueOnce(new Error('Upload failed')).mockResolvedValueOnce({ ...savedTicket,
    replies: [{ id: 'reply-1', sender: 'Example Learner', senderRole: 'Learner', body: 'See error log', timestamp: savedTicket.submitted,
      attachments: [{ id: 'file-2', name: 'error.log', size: 5, contentType: 'text/plain' }] }] });
  render(<MemoryRouter><SupportPage /></MemoryRouter>);
  fireEvent.click(await screen.findByText(savedTicket.title));
  fireEvent.click(screen.getByRole('button', { name: 'Reply to Ticket' }));
  fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'See error log' } });
  const file = new File(['error'], 'error.log');
  fireEvent.change(screen.getByLabelText('Attachments (optional)'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Send Reply' }));
  await screen.findAllByText('Upload failed');
  expect(screen.getByRole('button', { name: 'Remove error.log' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Send Reply' }));
  expect(await screen.findByRole('link', { name: 'Download error.log' })).toHaveAttribute('href', '/learner_api/support/tickets/ticket-1/attachments/file-2/');
  const calls = vi.mocked(updateSupportTicket).mock.calls;
  expect(calls[0]).toEqual(calls[1]);
  expect(calls[0]).toEqual(['ticket-1', expect.objectContaining({ action: 'reply', body: 'See error log' }), false, [file]]);
});
