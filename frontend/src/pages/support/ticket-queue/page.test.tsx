import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import SupportTicketQueue from './page';
import { loadSupportTickets, updateSupportTicket, type SupportTicket } from '@/api/supportTickets';
vi.mock('@/api/supportTickets', async () => ({
  ...await vi.importActual<typeof import('@/api/supportTickets')>('@/api/supportTickets'),
  loadSupportTickets: vi.fn(), updateSupportTicket: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ auth: { account: { id: 20, displayName: 'Support Example' } } }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
(globalThis as Record<string, unknown>).AppIcon = () => <i />;
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const ticket: SupportTicket = { id: 'example', title: 'Cannot finish activity', description: 'Timing expired', category: 'Technical Issue',
  status: 'open', priority: 'high', requester: 'Learner Example', assignedTo: '', assignedTeam: 'LMS Support',
  submitted: '2026-10-19T12:00:00Z', lastUpdate: '2026-10-19T12:00:00Z', replies: [], timeline: [], messages: 0 };
it('loads real tickets, persists a staff reply, and changes status with the previous status', async () => {
  vi.mocked(loadSupportTickets).mockResolvedValue([ticket]);
  vi.mocked(updateSupportTicket).mockResolvedValue({ ...ticket, replies: [{ id: 'r1', sender: 'Support Example', senderRole: 'Support', body: 'We are investigating.', timestamp: ticket.submitted }] });
  render(<SupportTicketQueue />);
  fireEvent.click(await screen.findByText(ticket.title));
  fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'We are investigating.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
  await screen.findByText('We are investigating.');
  expect(loadSupportTickets).toHaveBeenCalledWith(true);
  expect(updateSupportTicket).toHaveBeenCalledWith('example', expect.objectContaining({ action: 'reply', body: 'We are investigating.' }), true);
  vi.mocked(updateSupportTicket).mockResolvedValue({ ...ticket, status: 'resolved' });
  fireEvent.change(screen.getByLabelText('Ticket status'), { target: { value: 'resolved' } });
  await waitFor(() => expect(screen.getByLabelText('Ticket status')).toHaveValue('resolved'));
  expect(updateSupportTicket).toHaveBeenLastCalledWith('example', { action: 'status', status: 'resolved', expectedStatus: 'open' }, true);
});
it('shows permission failures without any sample tickets', async () => {
  vi.mocked(loadSupportTickets).mockRejectedValue(new Error('Access denied'));
  render(<SupportTicketQueue />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  expect(screen.queryByText('TKT-0892')).not.toBeInTheDocument();
});

it('shows learner attachments on tickets and replies without giving staff an upload control', async () => {
  const file = { id: 'f1', name: 'screenshot.png', size: 10, contentType: 'image/png' };
  vi.mocked(loadSupportTickets).mockResolvedValue([{ ...ticket, attachments: [file], replies: [{ id: 'reply', sender: 'Learner',
    senderRole: 'Learner', body: 'Details', timestamp: ticket.submitted, attachments: [{ ...file, id: 'f2', name: 'error.log' }] }] }]);
  render(<SupportTicketQueue />);
  fireEvent.click(await screen.findByText(ticket.title));
  expect(screen.getByRole('link', { name: 'Download screenshot.png' })).toHaveAttribute('href', '/learner_api/support/queue/example/attachments/f1/');
  expect(screen.getByRole('link', { name: 'Download error.log' })).toHaveAttribute('href', '/learner_api/support/queue/example/attachments/f2/');
  expect(screen.queryByLabelText('Attachments (optional)')).not.toBeInTheDocument();
});
