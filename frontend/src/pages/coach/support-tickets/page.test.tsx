import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { coachNavItems } from '@/mocks/navigation';
import CoachSupportTicketsPage from './page';

const { coachFetch } = vi.hoisted(() => ({ coachFetch: vi.fn() }));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ auth: { account: { id: 7, email: 'coach@example.invalid' } }, isInitialized: true }),
}));
vi.mock('@/lib/coachFetch', () => ({ coachFetch }));
vi.mock('@/api/coachLmsSupportTickets', () => ({
  loadCoachLmsTickets: async () => ({ tickets: [], readOnly: false }),
  replyToCoachLmsTicket: vi.fn(),
  coachLmsAttachmentUrl: vi.fn(),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><CoachSupportTicketsPage /></MemoryRouter></QueryClientProvider>);
}

describe('Coach support tickets', () => {
  beforeEach(() => coachFetch.mockReset());

  it('keeps the separate Inclusion sidebar link next to Support Tickets', () => {
    const ids = coachNavItems.map(item => item.id);
    expect(ids.indexOf('coach-support-tickets')).toBe(ids.indexOf('coach-inclusion') + 1);
    expect(coachNavItems.find(item => item.id === 'coach-inclusion')).toMatchObject({
      label: 'Inclusion Ticket System', external: true,
    });
    expect(coachNavItems.find(item => item.id === 'coach-support-tickets')).toMatchObject({ href: '/coach/support-tickets' });
  });

  // The embedded Inclusion workflow was explicitly removed from this page.
  // Its old status/note/report UI tests are replaced by the LMS-only boundary.
  it('shows LMS tickets directly without an embedded Inclusion section or request', async () => {
    renderPage();
    expect(await screen.findByText('No LMS tickets')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Support Tickets' })).toBeInTheDocument();
    expect(screen.getByText('LMS support tickets for learners on your caseload.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Ticket system' })).not.toBeInTheDocument();
    expect(screen.queryByText('Inclusion & safeguarding')).not.toBeInTheDocument();
    expect(screen.queryByText(/Inclusion ticket system is unavailable/)).not.toBeInTheDocument();
    expect(coachFetch).not.toHaveBeenCalled();
  });
});
