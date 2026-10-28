import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CoachLmsTicket } from '@/api/coachLmsSupportTickets';
import CoachSupportTicketsPage from './page';

const { load, reply, inclusion } = vi.hoisted(() => ({ load: vi.fn(), reply: vi.fn(), inclusion: vi.fn() }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useAuth.helpers", () => ({ useAuth: () => ({ auth: { account: { id: 7 } } }) }));
vi.mock('@/api/coachLmsSupportTickets', () => ({
  loadCoachLmsTickets: load, replyToCoachLmsTicket: reply,
  coachLmsAttachmentUrl: (ticketId: string, fileId: string) => `/coach_api/coach/lms-support-tickets/${ticketId}/attachments/${fileId}`,
}));
vi.mock('@/api/coachSupportTickets', () => ({ fetchCoachSupportTickets: inclusion, addSupportTicketNote: vi.fn(), updateSupportTicketStatus: vi.fn() }));

const ticket: CoachLmsTicket = {
  id: 'ticket-a', learnerId: 101, learnerName: 'Ada Example', requester: 'Ada Example',
  title: 'Cannot open a lesson', description: 'A synthetic issue.', category: 'Technical Issue',
  status: 'open', priority: 'medium', submitted: '2026-10-01T10:00:00Z', lastUpdate: '2026-10-01T10:00:00Z',
  assignedTo: 'Support Agent', assignedTeam: 'Support', messages: 0, timeline: [], replies: [],
  attachments: [{ id: 'file-a', name: 'issue.log', size: 100, contentType: 'text/plain' }],
};
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><CoachSupportTicketsPage /></MemoryRouter></QueryClientProvider>);
}

describe('Coach LMS tickets', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    load.mockResolvedValue({ tickets: [ticket], readOnly: false });
    inclusion.mockRejectedValue(new Error('Inclusion unavailable'));
  });

  it('shows LMS tickets without Inclusion and uses protected file links', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: ticket.title })).toBeInTheDocument();
    expect(inclusion).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Inclusion & safeguarding' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download issue.log' })).toHaveAttribute('href', '/coach_api/coach/lms-support-tickets/ticket-a/attachments/file-a');
    expect(screen.getByText('Assigned to: Support Agent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Assign|Update status/ })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
  });

  it('retains the draft and retry key on failure then shows the saved coach reply', async () => {
    const saved = { ...ticket, replies: [{ id: 'r1', sender: 'Example Coach', senderRole: 'Coach', body: 'I will help.', timestamp: '2026-10-01T11:00:00Z' }] };
    reply.mockRejectedValueOnce(new Error('Please retry')).mockImplementationOnce(async () => {
      load.mockResolvedValue({ tickets: [saved], readOnly: false });
      return saved;
    });
    renderPage();
    const box = await screen.findByLabelText('Reply to ticket');
    fireEvent.change(box, { target: { value: 'I will help.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please retry');
    expect(box).toHaveValue('I will help.');
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(box).toHaveValue(''));
    expect(reply.mock.calls[0]).toEqual(reply.mock.calls[1]);
    expect(reply.mock.calls[0]).toEqual(['ticket-a', 'I will help.', expect.any(String)]);
    expect(within(screen.getByRole('region', { name: 'Ticket conversation' })).getByText('I will help.')).toBeInTheDocument();
  });

  it('keeps drafts for each LMS ticket independently of Inclusion availability', async () => {
    load.mockResolvedValue({ tickets: [ticket, { ...ticket, id: 'ticket-b', learnerName: 'Ben Example', title: 'Another issue' }], readOnly: false });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Reply to ticket'), { target: { value: 'Draft for Ada' } });
    fireEvent.click(screen.getByRole('button', { name: /Ben Example/ }));
    expect(screen.getByLabelText('Reply to ticket')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /Ada Example/ }));
    expect(screen.getByLabelText('Reply to ticket')).toHaveValue('Draft for Ada');
    expect(inclusion).not.toHaveBeenCalled();
    expect(screen.queryByText('Inclusion unavailable')).not.toBeInTheDocument();
  });

  it('filters by learner and ticket status without granting edit actions', async () => {
    load.mockResolvedValue({ tickets: [ticket, { ...ticket, id: 'ticket-b', learnerName: 'Ben Example', title: 'Resolved issue', status: 'resolved' }], readOnly: false });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Search LMS tickets'), { target: { value: 'Ben' } });
    expect(screen.getByRole('heading', { name: 'Resolved issue' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter LMS tickets'), { target: { value: 'open' } });
    expect(screen.getByText('No tickets match your filters.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reply to ticket')).not.toBeInTheDocument();
  });

  it('does not offer replies in admin view-as', async () => {
    load.mockResolvedValue({ tickets: [ticket], readOnly: true });
    renderPage();
    expect(await screen.findByText(/Read-only view/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Reply to ticket')).not.toBeInTheDocument();
  });

  it('shows a load error separately from an empty caseload and retries', async () => {
    load.mockRejectedValueOnce(new Error('LMS unavailable')).mockResolvedValue({ tickets: [], readOnly: false });
    renderPage();
    expect(await screen.findByText('LMS unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No LMS tickets')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No LMS tickets')).toBeInTheDocument();
  });
});
