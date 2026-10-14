import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CoachSupportTicketsResponse, SupportTicket, WellbeingReportResponse } from '@/api/coachSupportTickets';
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

const statuses = ['new', 'under review', 'assigned', 'action in progress', 'outcome recorded', 'closed']
  .map(value => ({ value, label: value.replace(/\b\w/g, letter => letter.toUpperCase()) }));

function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: 10, ticketType: 'wellbeing', subject: 'Feeling overwhelmed', details: 'Synthetic details.',
    urgency: 'medium', preferredContact: 'email', status: 'under review', statusLabel: 'Under Review',
    assignedOwner: 'Inclusion Team', daysToClose: null, createdAt: '2026-09-01T09:00:00Z', updatedAt: '2026-09-02T09:00:00Z',
    notes: [{ id: 'n1', type: 'activity', note: 'Status changed from New to Under Review', createdAt: '2026-09-02T09:00:00Z', createdBy: 'dsl@example.invalid' }],
    evidence: [{ id: 'e1', fileName: 'letter.pdf', mimeType: 'application/pdf', description: '', url: 'https://admin.example.invalid/file', createdAt: null, createdBy: '' }],
    canChangeStatus: true, canAddNote: true,
    ...overrides,
  };
}

function payload(overrides: Partial<CoachSupportTicketsResponse> = {}): CoachSupportTicketsResponse {
  return {
    statuses, readOnly: false,
    learners: [
      { learnerId: 1, name: 'Ada Example', email: 'ada@example.invalid', programme: 'Programme A', cohort: 'C1', group: 'G1', openTickets: 1, tickets: [ticket()] },
      { learnerId: 2, name: 'Ben Example', email: 'ben@example.invalid', programme: 'Programme B', cohort: 'C2', group: 'G2', openTickets: 1,
        tickets: [ticket({ id: 20, ticketType: 'safeguarding', subject: 'Safeguarding concern', canChangeStatus: false })] },
    ],
    ...overrides,
  };
}

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) };
}

type Reply = ReturnType<typeof json>;

const NO_REPORT: WellbeingReportResponse = { available: false };

/** Route coachFetch by URL: list GETs, per-ticket report GETs, and writes in order. */
function serve(list: Reply, { report = NO_REPORT, writes = [] }: { report?: WellbeingReportResponse | Reply; writes?: Reply[] } = {}) {
  const queue = [...writes];
  coachFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/wellbeing-report')) return 'text' in report ? report : json({ report });
    if (init?.method && init.method !== 'GET') return queue.shift() ?? json({ error: 'unexpected' }, 500);
    return list;
  });
}

function writeCalls() {
  return coachFetch.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
}

const REPORT: WellbeingReportResponse = {
  available: true,
  submittedAt: '2026-09-30T12:07:00+00:00',
  riskLevel: 'Low',
  triggerCount: 2,
  scores: [
    { key: 'overall', label: 'Overall Score', value: 2.54 },
    { key: 'mental', label: 'Mental Health', value: 3.88 },
    { key: 'safeguarding', label: 'Safeguarding Safety', value: 1 },
  ],
  patterns: ['protective_above_5'],
  counts: { riskFlags: 2, high: 1, medium: 1, answers: 3 },
  answers: [
    { id: '2', question: 'I feel that I belong.', category: 'Provider Culture', construct: 'Belonging at Provider', learnerAnswer: 5, concernScore: 6, maxScore: 10, reverseScored: true, flag: 'medium', whyFlagged: 'Low answer on a positive question' },
    { id: '1', question: 'I feel under constant pressure.', category: 'Personal Wellbeing', construct: 'Stress & Pressure', learnerAnswer: 8, concernScore: 8, maxScore: 10, reverseScored: false, flag: 'high', whyFlagged: 'High answer on a risk question' },
    { id: '3', question: 'I feel safe.', category: 'Safeguarding', construct: 'Domestic Safety', learnerAnswer: 1, concernScore: 1, maxScore: 10, reverseScored: false, flag: null, whyFlagged: '' },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><CoachSupportTicketsPage /></MemoryRouter></QueryClientProvider>);
}

function evidenceCards() {
  return within(screen.getByRole('region', { name: 'Survey question evidence' })).getAllByRole('listitem');
}

describe('Coach support tickets', () => {
  beforeEach(() => {
    coachFetch.mockReset();
  });

  it('sits in the coach sidebar directly under the Inclusion link, which is unchanged', () => {
    const ids = coachNavItems.map(item => item.id);
    expect(ids.indexOf('coach-support-tickets')).toBe(ids.indexOf('coach-inclusion') + 1);
    expect(coachNavItems.find(item => item.id === 'coach-inclusion')).toMatchObject({ external: true });
    expect(coachNavItems.find(item => item.id === 'coach-support-tickets')).toMatchObject({ href: '/coach/support-tickets' });
  });

  it('lists learners with tickets and shows the selected learner ticket details', async () => {
    serve(json(payload()));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Feeling overwhelmed' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Learners with support tickets' });
    expect(within(list).getByText('Ada Example')).toBeInTheDocument();
    expect(within(list).getByText('Ben Example')).toBeInTheDocument();
    expect(await screen.findByText('Synthetic details.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'letter.pdf' })).toHaveAttribute('href', 'https://admin.example.invalid/file');
    expect(coachFetch).toHaveBeenCalledWith('/coach_api/coach/support-tickets', expect.anything());
  });

  it('shows the survey wellbeing report with risk flags first, and every answer on request', async () => {
    serve(json(payload()), { report: REPORT });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Question evidence' })).toBeInTheDocument();
    expect(coachFetch).toHaveBeenCalledWith('/coach_api/coach/support-tickets/10/wellbeing-report', expect.anything());
    expect(screen.getByText('Mental Health').nextSibling).toHaveTextContent('3.88');
    expect(screen.getByText('Protective above 5')).toBeInTheDocument();

    // High concern before follow-up; unflagged answers hidden.
    expect(evidenceCards().map(card => within(card).getByText(/^I feel/).textContent))
      .toEqual(['I feel under constant pressure.', 'I feel that I belong.']);
    expect(within(evidenceCards()[0]).getByText('High answer on a risk question')).toBeInTheDocument();
    expect(within(evidenceCards()[1]).getByText('Low answer on a positive question')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /All answers/ }));
    expect(evidenceCards()).toHaveLength(3);
    expect(within(evidenceCards()[2]).getByText('Not flagged')).toBeInTheDocument();
    // The ticket's own text stays reachable.
    expect(screen.getByText('Original ticket text')).toBeInTheDocument();
  });

  it('falls back to the ticket text when the report cannot be loaded', async () => {
    serve(json(payload()), { report: json({ error: 'support_tickets_unavailable', message: 'Inclusion is unavailable.' }, 503) });
    renderPage();

    expect(await screen.findByText(/The wellbeing report could not be loaded/)).toBeInTheDocument();
    expect(screen.getByText('Synthetic details.')).toBeInTheDocument();
  });

  it('lays out survey-generated details as facts and triggered questions', async () => {
    const details = [
      'Auto-generated ticket from wellbeing survey.', '',
      'Risk Level: High', 'Total Score: 2.54', 'Trigger Count: 2', 'Coach: Default Owner', '',
      'Triggered Questions:',
      '• I feel low or down. (Score: 7) [medium]',
      '• I find it difficult to relax. (Score: 10) [high]',
    ].join('\n');
    serve(json(payload({ learners: [{ ...payload().learners[0], tickets: [ticket({ details })] }] })));
    renderPage();

    expect(await screen.findByText('Triggered questions (2)')).toBeInTheDocument();
    expect(screen.getByText('Risk Level').nextSibling).toHaveTextContent('High');
    expect(screen.getByText('I feel low or down.')).toBeInTheDocument();
    expect(screen.getByText('Score 10')).toBeInTheDocument();
    expect(screen.getByText('Default Owner')).toBeInTheDocument();
    expect(screen.queryByText(/\(Score: 7\)/)).not.toBeInTheDocument();
  });

  it('locks status on safeguarding tickets but still allows a note', async () => {
    serve(json(payload()));
    renderPage();
    fireEvent.click(await screen.findByText('Ben Example'));

    expect(await screen.findByText(/Safeguarding status is managed by the DSL/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Add a note to ticket 20')).toBeInTheDocument();
  });

  it('sends the status the coach loaded so a newer change is never overwritten', async () => {
    serve(json(payload()), { writes: [json({ ticket: ticket({ status: 'assigned', statusLabel: 'Assigned' }) })] });
    renderPage();

    fireEvent.change(await screen.findByRole('combobox', { name: 'Status' }), { target: { value: 'assigned' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update status' }));

    await waitFor(() => expect(writeCalls()).toHaveLength(1));
    const [url, init] = writeCalls()[0];
    expect(url).toBe('/coach_api/coach/support-tickets/10/status');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ status: 'assigned', expectedStatus: 'under review' });
  });

  it('adds a note and clears the box only after the server accepts it', async () => {
    const saved = ticket({ notes: [{ id: 'n2', type: 'note', note: 'Called the learner.', createdAt: '2026-09-03T09:00:00Z', createdBy: 'coach@example.invalid' }, ...ticket().notes] });
    serve(json(payload()), { writes: [
      json({ error: 'support_tickets_unavailable', message: 'The Inclusion ticket system is unavailable right now.' }, 503),
      json({ ticket: saved }, 201),
    ] });
    renderPage();

    const box = await screen.findByLabelText('Add a note to ticket 10');
    fireEvent.change(box, { target: { value: 'Called the learner.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
    expect(box).toHaveValue('Called the learner.');

    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(box).toHaveValue(''));
    expect(screen.getByText('Called the learner.')).toBeInTheDocument();
    expect(JSON.parse(writeCalls()[1][1].body)).toEqual({ note: 'Called the learner.' });
  });

  it('shows no actions in admin view-as', async () => {
    serve(json(payload({
      readOnly: true,
      learners: [{ ...payload().learners[0], tickets: [ticket({ canChangeStatus: false, canAddNote: false })] }],
    })), { report: REPORT });
    renderPage();

    expect(await screen.findByText(/Read-only view/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Question evidence' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
  });

  it('distinguishes a load failure from having no tickets', async () => {
    serve(json({ error: 'support_tickets_unavailable', message: 'The Inclusion ticket system is unavailable right now.' }, 503));
    renderPage();
    expect(await screen.findByText('Unable to load support tickets')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
