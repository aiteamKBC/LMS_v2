import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmployerPortal, EmployerDashboardMetrics } from '@/api/employerPortal';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import EmployerPortalPage from './EmployerPortalPage';
import { londonToday } from './employerDashboardData';

const api = vi.hoisted(() => ({
  portal: vi.fn(), metrics: vi.fn(), reviews: vi.fn(),
}));
vi.mock('@/api/employerPortal', () => ({
  fetchEmployerPortal: (...args: unknown[]) => api.portal(...args),
  fetchEmployerDashboardMetrics: (...args: unknown[]) => api.metrics(...args),
  fetchEmployerProgressReviews: (...args: unknown[]) => api.reviews(...args),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ auth: { account: { role: 'employer', displayName: 'Test Employer' } } }),
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="path">{location.pathname}{location.search}</output>;
}
function showPage(path = '/employers/8') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/employers/:employerId/*" element={<><EmployerPortalPage /><CurrentPath /></>} />
  </Routes></MemoryRouter>);
}
let portal: EmployerPortal;
let metrics: EmployerDashboardMetrics;
const makeReview = (id: string, overrides: Partial<LearnerCalendarEvent> = {}): LearnerCalendarEvent => ({
  id, eventKey: id, title: 'Progress review', source: 'progress-review', importedReviewType: 'Progress Review',
  type: 'review', sequence: 1, status: 'scheduled', date: londonToday(), targetDate: londonToday(),
  scheduledDate: londonToday(), scheduledTime: '09:00', durationMinutes: 60, coachName: 'Coach',
  coachEmail: '', meetingProvider: '', meetingLink: '', notes: '', ...overrides,
});
const table = () => within(screen.getByRole('region', { name: 'Employer learners' }));
beforeEach(() => {
  vi.clearAllMocks();
  portal = {
    employer: { id: '8', name: 'Test employer', email: 'employer@example.test', employerGroupNames: ['Test org'] },
    outstandingTotal: 2,
    learners: [
      { id: '11', kind: 'apprenticeship', name: 'Alex Learner', email: 'alex@example.test', programme: 'Data Analysis', cohort: 'Cohort A', programmeStatus: 'Active', onboardingStatus: '', isActive: true, outstandingCount: 0, documentsTotal: 2 },
      { id: '12', kind: 'commercial', name: 'Morgan Learner', email: 'morgan@example.test', programme: 'Marketing', cohort: 'Cohort B', programmeStatus: 'Onboarding', onboardingStatus: 'Onboarding', isActive: false, outstandingCount: 2, documentsTotal: 2 },
    ],
  };
  metrics = { asOf: londonToday(), learners: {
    '11': { programme: { completed: 68, total: 100, percent: 68, status: 'ready' }, risk: 'on-track' },
    '12': { programme: { completed: 32, total: 100, percent: 32, status: 'ready' }, risk: 'unavailable' },
  } };
  api.portal.mockImplementation(async () => structuredClone(portal));
  api.metrics.mockImplementation(async () => structuredClone(metrics));
  api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: [
    makeReview('pr-' + id, id === '12' ? { scheduledDate: '2099-12-21', targetDate: '2099-12-21' } : {}),
    makeReview('gateway-' + id, { importedReviewType: 'Gateway Review', title: 'Gateway Review' }),
    makeReview('support-' + id, { importedReviewType: 'Personal Support Plan', title: 'Personal Support Plan' }),
  ], definitions: {} }));
});
afterEach(cleanup);

describe('employer home dashboard', () => {
  it('keeps a loading state while learners are being prepared', () => {
    api.portal.mockReturnValueOnce(new Promise(() => undefined));
    showPage();
    expect(screen.getByRole('status', { name: 'Loading learners' })).toBeVisible();
    expect(screen.getByTestId('learners-loading-spinner')).toHaveClass('animate-spin');
    expect(api.metrics).not.toHaveBeenCalled();
  });

  it('renders real progress and the reference banner, and links both learner kinds correctly', async () => {
    const { container } = showPage();
    expect(await screen.findByRole('heading', { name: 'Test employer' })).toBeInTheDocument();
    expect(container.querySelector('img[src="/assets/employer/graduation-group.webp"]')).toBeInTheDocument();
    const progress = await screen.findByRole('progressbar', { name: 'Alex Learner programme progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '68');
    expect(screen.getByRole('progressbar', { name: 'Morgan Learner programme progress' })).toHaveAttribute('aria-valuenow', '32');
    expect(table().getByRole('link', { name: 'View Alex Learner' })).toHaveAttribute('href', '/employers/8/learner/apprenticeship/11');
    expect(table().getByRole('link', { name: 'View Morgan Learner' })).toHaveAttribute('href', '/employers/8/learner/commercial/12');
    expect(api.metrics).toHaveBeenCalledWith('8', expect.any(AbortSignal));
    expect(api.reviews).toHaveBeenCalledWith('8', 'commercial', '12', expect.any(AbortSignal));
  });

  it('combines search, programme, cohort and status filters and clears them', async () => {
    showPage();
    await screen.findByRole('heading', { name: 'Your learners (2)' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search learners' }), 'morgan');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Programme' }), 'Marketing');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cohort' }), 'Cohort B');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'inactive');
    expect(table().queryByRole('link', { name: 'View Alex Learner' })).not.toBeInTheDocument();
    expect(table().getByRole('link', { name: 'View Morgan Learner' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Programme' })).toHaveValue('');
  });

  it('shows small catalogue percentages and activity counts without rounding them to zero', async () => {
    metrics.learners['11'].programme = { completed: 1, total: 900, percent: 0.11, status: 'ready' };
    showPage();
    const progress = await screen.findByRole('progressbar', { name: 'Alex Learner programme progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '0.11');
    expect(table().getByText('0.11%')).toBeVisible();
    expect(table().getByText('1 / 900 activities')).toBeVisible();
    const programmes = within(screen.getByRole('region', { name: 'Progress by programme' }));
    expect(programmes.getByText('0.11%')).toBeVisible();
    expect(programmes.getByRole('progressbar', { name: 'Data Analysis average progress' })).toHaveAttribute('aria-valuenow', '0.11');
    expect(table().getByText('32%')).toBeVisible();
  });

  it('counts only progress reviews and filters this month without displaying Gateway or support plans', async () => {
    showPage();
    const due = await screen.findByRole('button', { name: /Reviews due this month: 1\. Open progress reviews/ });
    expect(screen.queryByText('Gateway Review')).not.toBeInTheDocument();
    expect(screen.queryByText('Personal Support Plan')).not.toBeInTheDocument();
    await userEvent.click(due);
    expect(screen.getByRole('combobox', { name: 'Upcoming review' })).toHaveValue('month');
    expect(screen.getByTestId('path')).toHaveTextContent('/employers/8/reviews?upcoming=month');
    const journey = screen.getByRole('region', { name: 'Progress review journey' });
    expect(within(journey).getByRole('link', { name: 'Alex Learner' })).toBeVisible();
    expect(within(journey).queryByRole('link', { name: 'Morgan Learner' })).not.toBeInTheDocument();
  });

  it('gives My learners and Progress reviews their own content instead of repeating home', async () => {
    showPage('/employers/8/learners');
    expect(await screen.findByRole('heading', { level: 1, name: 'My learners' })).toBeVisible();
    expect(table().getByRole('link', { name: 'View Alex Learner' })).toBeVisible();
    // The overview's panels stay on home; this page is the learner list.
    expect(screen.queryByRole('region', { name: 'Learner summary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Progress review journey' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Action required' })).not.toBeInTheDocument();

    cleanup();
    showPage('/employers/8/reviews');
    expect(await screen.findByRole('heading', { level: 1, name: 'Progress reviews' })).toBeVisible();
    const journey = screen.getByRole('region', { name: 'Progress review journey' });
    expect(within(journey).getByRole('link', { name: 'Alex Learner' })).toBeVisible();
    expect(within(journey).getByRole('link', { name: 'Morgan Learner' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Employer learners' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Learner summary' })).not.toBeInTheDocument();
  });

  it('keeps a section filter in the address so a reload still shows it', async () => {
    showPage('/employers/8/learners?status=inactive');
    expect(await screen.findByRole('heading', { name: 'Your learners (1)' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('inactive');
    expect(table().getByRole('link', { name: 'View Morgan Learner' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
    expect(screen.getByTestId('path')).toHaveTextContent('/employers/8/learners');
    expect(screen.getByTestId('path')).not.toHaveTextContent('status=inactive');
  });

  it('shows every review in a separate learner timeline with signature context and the correct links', async () => {
    api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: [
      makeReview(`${id}-done`, { title: 'Completed review', status: 'completed', scheduledDate: '2026-10-01' }),
      makeReview(`${id}-sign`, { title: 'Review to sign', status: 'awaiting-signature', employerSignatureRequired: true, employerSigned: false }),
      ...Array.from({ length: 5 }, (_, index) => makeReview(`${id}-next-${index}`, { title: `Planned review ${index + 1}`, status: 'not-scheduled' })),
    ], definitions: {} }));
    showPage('/employers/8/reviews');
    const alex = within(await screen.findByRole('article', { name: 'Alex Learner reviews' }));
    expect(await alex.findByText('1 awaiting your signature')).toBeVisible();
    expect(alex.getAllByRole('listitem')).toHaveLength(7);
    expect(alex.getByText('1 of 7 completed')).toBeVisible();
    expect(alex.getByText('1 Oct 2026')).toBeVisible();
    expect(alex.getByText('Your signature needed')).toBeVisible();
    expect(alex.getByText('Planned review 5')).toBeVisible();
    expect(alex.getByRole('link', { name: 'View reviews for Alex Learner' })).toHaveAttribute('href', '/employers/8/learner/apprenticeship/11?tab=reviews');
    expect(screen.getByRole('link', { name: 'View reviews for Morgan Learner' })).toHaveAttribute('href', '/employers/8/learner/commercial/12?tab=reviews');
    expect(screen.getByText('2 of 2 learners')).toBeVisible();
  });

  it.each(['/employers/8', '/employers/8/reviews'])('orders the journey by the source plan after appointments move on %s', async path => {
    const planned = ['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01'];
    const booked = ['2026-12-10', '2026-09-10', '2026-10-20', '2026-11-20', '2026-08-01'];
    api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: [1, 4, 3, 0, 2].map(index =>
      makeReview(`${id}-${index}`, { title: `Review ${index + 1}`, reviewSource: 'aptem',
        targetDate: planned[index], scheduledDate: booked[index], date: booked[index], sequence: index + 1,
        status: index === 0 ? 'awaiting-signature' : index === 1 ? 'completed' : 'scheduled' })), definitions: {} }));
    showPage(path);
    await screen.findByRole('link', { name: /Alex Learner: Review 1,/ });
    const journey = within(screen.getByRole('region', { name: 'Progress review journey' }));
    for (const name of ['Alex Learner', 'Morgan Learner']) {
      const links = journey.getAllByRole('link', { name: new RegExp(`^${name}: Review`) });
      expect(links.map(link => link.querySelector('strong')?.textContent)).toEqual(
        path.endsWith('/reviews') ? ['Review 1', 'Review 2', 'Review 3', 'Review 4', 'Review 5']
          : ['Review 1', 'Review 2', 'Review 3', 'Review 4']);
      expect(links[0]).toHaveAccessibleName(`${name}: Review 1, Waiting for signatures, 10 Dec 2026`);
      expect(links[1]).toHaveAccessibleName(`${name}: Review 2, Completed, 10 Sept 2026`);
    }
    if (!path.endsWith('/reviews')) {
      // The appointment due first is still the next review, irrespective of plan order.
      expect(table().getAllByRole('link', { name: '1 Aug 2026' })).toHaveLength(2);
    }
  });

  it('filters the review journeys and can recover from an empty search', async () => {
    showPage('/employers/8/reviews');
    await screen.findByRole('article', { name: 'Alex Learner reviews' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search learners' }), 'morgan');
    expect(screen.getByRole('article', { name: 'Morgan Learner reviews' })).toBeVisible();
    expect(screen.queryByRole('article', { name: 'Alex Learner reviews' })).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 learners')).toBeVisible();
    await userEvent.type(screen.getByRole('searchbox'), ' missing');
    expect(screen.getByRole('heading', { name: 'No matching learners' })).toBeVisible();
    const journey = within(screen.getByRole('region', { name: 'Progress review journey' }));
    await userEvent.click(journey.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('2 of 2 learners')).toBeVisible();
  });

  it('keeps review loading and failure distinct from an empty timeline and retries failed reads', async () => {
    api.reviews.mockRejectedValueOnce(new Error('temporary'));
    showPage('/employers/8/reviews');
    const alex = within(await screen.findByRole('article', { name: 'Alex Learner reviews' }));
    expect(await alex.findByRole('alert')).toHaveTextContent('Reviews could not be loaded for this learner.');
    expect(alex.queryByText('No progress reviews planned yet.')).not.toBeInTheDocument();
    await userEvent.click(alex.getByRole('button', { name: 'Retry reviews' }));
    expect(await alex.findByRole('list')).toBeVisible();
    expect(alex.queryByRole('alert')).not.toBeInTheDocument();

    cleanup();
    api.reviews.mockImplementation(() => new Promise(() => undefined));
    showPage('/employers/8/reviews');
    const loading = within(await screen.findByRole('article', { name: 'Alex Learner reviews' }));
    expect(loading.getByRole('status')).toHaveTextContent('Loading progress reviews');
    expect(loading.queryByText('No progress reviews planned yet.')).not.toBeInTheDocument();
  });

  it('opens existing document and progress-review tabs from actionable links', async () => {
    showPage();
    const actions = await screen.findByRole('region', { name: 'Action required' });
    const action = within(actions).getByRole('link', { name: /Morgan Learner/ });
    expect(action).toHaveTextContent('2 documents need your signature');
    expect(action).toHaveAttribute('href', '/employers/8/learner/commercial/12?tab=documents');
    const journey = screen.getByRole('region', { name: 'Progress review journey' });
    expect(within(journey).getByRole('link', { name: 'Alex Learner' })).toHaveAttribute('href', '/employers/8/learner/apprenticeship/11?tab=reviews');
    expect(within(actions).getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/employers/8/documents');
  });

  it('uses the same OTJ statuses for the overview, table, filters and Needs attention', async () => {
    portal.learners[1].isActive = true;
    metrics.learners['11'].risk = 'need-attention';
    metrics.learners['12'].risk = 'at-risk';
    showPage();
    const attention = await screen.findByRole('button', { name: /Needs attention: 2\. Behind/ });
    const overview = within(screen.getByRole('region', { name: 'Learner progress overview' }));
    expect(overview.getByRole('img')).toHaveAccessibleName('On track: 0, Needs attention: 1, At risk: 1, Not available: 0');
    expect(table().getByText('Needs attention')).toBeVisible();
    expect(table().getByText('At risk')).toBeVisible();
    expect(table().queryByText('OTJ status unavailable')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'at-risk');
    expect(table().getByRole('link', { name: 'View Morgan Learner' })).toBeVisible();
    expect(table().queryByRole('link', { name: 'View Alex Learner' })).not.toBeInTheDocument();
    expect(overview.getByRole('img')).toHaveAccessibleName('On track: 0, Needs attention: 0, At risk: 1, Not available: 0');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'need-attention');
    expect(table().getByRole('link', { name: 'View Alex Learner' })).toBeVisible();
    expect(table().queryByRole('link', { name: 'View Morgan Learner' })).not.toBeInTheDocument();
    await userEvent.click(attention);
    expect(screen.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('attention');
  });

  it('shows missing metrics as unavailable instead of zero or healthy progress', async () => {
    metrics.learners = {};
    showPage();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Learner summary' })).toHaveTextContent('Needs attentionUnavailable'));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Engagement this month' })).toHaveTextContent('Not available');
  });

  it('keeps the learner table and successful review reads when another source fails, with retry', async () => {
    api.metrics.mockRejectedValueOnce(new Error('temporary'));
    api.reviews.mockRejectedValueOnce(new Error('temporary'));
    showPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(table().getByRole('link', { name: 'View Alex Learner' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('progressbar', { name: 'Alex Learner programme progress' });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('retries a failed initial request', async () => {
    api.portal.mockRejectedValueOnce(new Error('Could not load learners.'));
    showPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load learners.');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
  });

  it('handles an employer with no learners without making secondary requests', async () => {
    portal.learners = [];
    portal.outstandingTotal = 0;
    showPage();
    expect(await screen.findByRole('heading', { name: 'No learners linked yet' })).toBeVisible();
    expect(api.metrics).not.toHaveBeenCalled();
    expect(api.reviews).not.toHaveBeenCalled();
  });

  it('paginates large learner lists and resets pagination after filtering', async () => {
    portal.learners = Array.from({ length: 10 }, (_, index) => ({ ...portal.learners[0], id: String(index + 100), name: 'Learner ' + index }));
    showPage();
    await screen.findByRole('heading', { name: 'Your learners (10)' });
    expect(table().getAllByRole('row')).toHaveLength(9);
    await userEvent.click(screen.getByRole('button', { name: 'Next learner page' }));
    expect(table().getAllByRole('row')).toHaveLength(3);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Learner 0' } });
    expect(table().getByRole('link', { name: 'View Learner 0' })).toBeVisible();
  });
});
