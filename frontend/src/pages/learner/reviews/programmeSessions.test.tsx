import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppIcon } from '@/components/feature/AppIcon';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { rememberLearner, rememberSignedInLearner } from '@/hooks/useMyLearner';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import type { ImportedReview } from '@/api/reviewHistory';
import { ToastProvider } from '@/hooks/useToast';
import ProgressReviewPage, { ProgressReviewsListPage } from '../progress-reviews/page';
import MonthlyCoachingPage, { MonthlyCoachingListPage } from '../monthly-coaching/page';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/pages/coach/progress-reviews/page', () => ({ buildProgressReviewSlidesDeck: vi.fn() }));

const detail = { id: '125', name: 'New learner', programme: 'Assigned programme',
  components: [], componentProgress: [], videoProgress: [], quizAttempts: [] };
const cases = [
  { source: 'progress-review', path: 'progress-reviews', region: 'Reviews sessions', Page: ProgressReviewsListPage, Detail: ProgressReviewPage },
  { source: 'mcr', path: 'monthly-coaching', region: 'Monthly Coaching Meetings', Page: MonthlyCoachingListPage, Detail: MonthlyCoachingPage },
] as const;
let events: LearnerCalendarEvent[];
let calendarFails: boolean;
let detailFails: boolean;
let archiveFails: boolean;
let detailActivityAvailable: boolean;
let historyReviews: ImportedReview[];
let requests: string[];

function session(source: string, sequence = 1, status = 'not-scheduled'): LearnerCalendarEvent {
  const id = `${source}:211:${sequence}:2026-10-31`;
  return { id, eventKey: id, source, type: source === 'mcr' ? 'coaching' : 'review', title: 'Programme session',
    sequence, status, date: '2026-10-31', targetDate: '2026-10-31', scheduledDate: null, scheduledTime: null,
    durationMinutes: 60, coachName: 'Assigned coach', coachEmail: '', meetingProvider: '', meetingLink: '', notes: '' };
}

beforeEach(() => {
  clearAllCachedResources();
  rememberSignedInLearner(undefined, undefined);
  localStorage.clear(); rememberLearner('commercial', '19');
  vi.stubGlobal('React', React); vi.stubGlobal('AppIcon', AppIcon);
  events = []; historyReviews = []; requests = []; calendarFails = detailFails = archiveFails = detailActivityAvailable = false;
  // jsdom does not load Tailwind. Apply its visibility utilities so the
  // regression fails for a populated but CSS-hidden list, as in the report.
  const style = document.createElement('style'); style.id = 'review-test-style';
  style.textContent = '.hidden { display: none; } .md\\:block { display: block; } .md\\:hidden { display: none; }';
  document.head.append(style);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); requests.push(url);
    if (init?.method && init.method !== 'GET') throw new Error('Unexpected write');
    let body: unknown; let failed = false;
    if (url.includes('/curriculum/cache-epoch/')) body = { epoch: 0, changes: [] };
    else if (url.includes('/learner-detail/')) { body = { ...detail, studentActivityAvailable: detailActivityAvailable }; failed = detailFails; }
    else if (url.includes('/review-history/')) { body = { reviews: historyReviews }; failed = archiveFails; }
    else if (url.includes('/calendar/')) { body = { events }; failed = calendarFails; }
    else throw new Error(`Unexpected read: ${url}`);
    return new Response(JSON.stringify(failed ? { error: 'Temporarily unavailable' } : body), { status: failed ? 503 : 200 });
  }));
});

it('falls back to generated sessions when an Aptem learner has no imported MCM rows', async () => {
  detailActivityAvailable = true;
  events = [session('mcr'), session('mcr', 2, 'completed')];
  mount(cases[1]);

  const region = await screen.findByRole('region', { name: 'Monthly Coaching Meetings' });
  await waitFor(() => expect(within(region).getAllByRole('link', { name: 'View' })[0]).toBeVisible());
  expect(metric('Total')).toHaveTextContent('2');
  expect(within(region).getByRole('link', { name: 'Schedule' })).toBeVisible();
  expect(within(region).getByRole('tablist')).toBeVisible();
});

it('shows all imported review types in the Reviews table', async () => {
  detailActivityAvailable = true;
  historyReviews = [{
    id: 'review-1', aptemReviewId: 'A-1', name: 'Eligibility Review & FS Discussion',
    type: 'Eligibility Review & FS Discussion', reviewerName: 'Review officer',
    plannedDate: '2026-09-18', plannedTime: null, completedDate: null,
    status: 'not-scheduled', extractionStatus: 'complete', detailsAvailable: false, sections: [],
  }];
  mount(cases[0]);

  const region = await screen.findByRole('region', { name: 'Reviews sessions' });
  expect((await within(region).findAllByText('Eligibility Review & FS Discussion')).at(-1)).toBeVisible();
  expect(metric('Total')).toHaveTextContent('1');
});
afterEach(() => {
  cleanup(); clearAllCachedResources(); rememberSignedInLearner(undefined, undefined);
  document.getElementById('review-test-style')?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function Destination() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }
function SwitchLearner({ path }: { path: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(`/learner/${path}?kind=commercial&learner=126`)}>Switch learner</button>;
}
function mount(item: typeof cases[number], suffix = '?kind=apprenticeship&learner=125') {
  return render(<React.StrictMode><ToastProvider><MemoryRouter initialEntries={[`/learner/${item.path}${suffix}`]}>
    <SwitchLearner path={item.path} />
    <Routes>
      <Route path={`/learner/${item.path}`} element={<item.Page />} />
      <Route path={`/learner/${item.path}/:${item.source === 'mcr' ? 'sessionId' : 'reviewId'}`} element={<item.Detail />} />
      <Route path="/learner/calendar" element={<Destination />} />
    </Routes>
  </MemoryRouter></ToastProvider></React.StrictMode>);
}
function metric(label: string) { return screen.getByText(label, { selector: '.ui-metric-card *' }).closest('.ui-metric-card')!; }

describe.each(cases)('$path programme sessions', item => {
  it('shows newly assigned sessions without imported history and counts the visible programme', async () => {
    events = [session(item.source), session(item.source, 2, 'completed'), session(item.source === 'mcr' ? 'progress-review' : 'mcr')];
    mount(item);
    const region = await screen.findByRole('region', { name: item.region });
    await waitFor(() => expect(within(region).getAllByRole('link', { name: 'View' })[0]).toBeVisible());
    expect(region).toBeVisible();
    expect(metric('Total')).toHaveTextContent('2'); expect(metric('Completed')).toHaveTextContent('1');
    fireEvent.click(within(region).getByRole('tab', { name: /Finished/ }));
    expect(within(region).getByRole('link', { name: 'View in calendar' })).toBeVisible();
    expect(requests.filter(url => url.includes('/calendar/'))).toHaveLength(1);
    expect(requests.filter(url => url.startsWith('/learner_api/')).every(url => url.includes('/apprenticeship/125/'))).toBe(true);
    fireEvent.click(within(region).getByRole('tab', { name: /Planned/ }));
    fireEvent.click(within(region).getByRole('link', { name: 'Schedule' }));
    if (item.source === 'mcr') {
      expect(await screen.findByRole('dialog', { name: 'Schedule monthly coaching' })).toBeVisible();
    } else {
      expect(await screen.findByRole('dialog', { name: 'Schedule review' })).toBeVisible();
    }
  });

  it.each(['summary', 'archive'])('keeps current sessions visible when the %s fails', async dependency => {
    events = [session(item.source)]; detailFails = dependency === 'summary'; archiveFails = dependency === 'archive';
    mount(item);
    await waitFor(() => expect(within(screen.getByRole('region', { name: item.region })).getByRole('link', { name: 'View' })).toBeVisible());
    expect(metric('Total')).toHaveTextContent('1');
  });

  it('reports calendar failure and recovers through Try again', async () => {
    calendarFails = true; mount(item);
    expect(await screen.findByText('Could not load programme sessions. Please try again.')).toBeVisible();
    expect(screen.queryByText(/No (progress review|monthly coaching) sessions were found/)).not.toBeInTheDocument();
    calendarFails = false; events = [session(item.source)];
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: item.region })).getByRole('link', { name: 'View' })).toBeVisible());
    expect(screen.queryByText('Could not load programme sessions. Please try again.')).not.toBeInTheDocument();
  });

  it('reloads the booking when returning to an already open page', async () => {
    events = [session(item.source)]; mount(item);
    await waitFor(() => expect(metric('Total')).toHaveTextContent('1'));
    events = [{ ...session(item.source, 1, 'scheduled'), scheduledDate: '2026-11-02', scheduledTime: '14:30' }];
    fireEvent.focus(window);
    await waitFor(() => expect(metric('Scheduled')).toHaveTextContent('1'));
    expect(within(screen.getByRole('region', { name: item.region })).getByRole('table')).toHaveTextContent('02 Nov 2026');
  });

  it('clears previous learner sessions while a different learner loads', async () => {
    events = [session(item.source)]; mount(item);
    await waitFor(() => expect(metric('Total')).toHaveTextContent('1'));
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(input => String(input).includes('/calendar/')
      ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve(new Response(JSON.stringify(String(input).includes('/review-history/') ? { reviews: [] } : detail))));
    fireEvent.click(screen.getByRole('button', { name: 'Switch learner' }));
    expect(screen.queryByRole('link', { name: 'View' })).not.toBeInTheDocument();
    await act(async () => finish(new Response(JSON.stringify({ events: [] }))));
    expect(metric('Total')).toHaveTextContent('0');
  });

  it('opens the assigned session details and returns to the same learner list', async () => {
    events = [session(item.source)]; mount(item);
    const region = screen.getByRole('region', { name: item.region });
    fireEvent.click(await within(region).findByRole('link', { name: 'View' }));
    const back = await screen.findByRole('button', { name: item.source === 'mcr' ? 'Back to coaching meetings' : 'Back to Reviews' });
    await waitFor(() => expect(screen.getAllByText('Assigned coach').length).toBeGreaterThan(0));
    fireEvent.click(back);
    expect(await screen.findByRole('region', { name: item.region })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open calendar' })).toHaveAttribute('href', '/learner/calendar?kind=apprenticeship&learner=125');
  });

  it('keeps a signed-in learner on their own assignments despite an old staff link', async () => {
    rememberSignedInLearner('learner', '126', 'commercial');
    events = [session(item.source)]; mount(item);
    await waitFor(() => expect(metric('Total')).toHaveTextContent('1'));
    expect(requests.filter(url => url.startsWith('/learner_api/')).every(url => url.includes('/commercial/126/'))).toBe(true);
    expect(screen.getByRole('link', { name: 'Open calendar' })).toHaveAttribute('href', '/learner/calendar?kind=commercial&learner=126');
  });
});

it('never substitutes another review when the requested review no longer exists', async () => {
  events = [{ ...session('progress-review'), reviewResponses: { rag_status: 'DO NOT SHOW ANOTHER REVIEW' } }];
  mount(cases[0], '/missing-review?kind=apprenticeship&learner=125');
  expect(await screen.findByText(/This progress review is no longer available/)).toBeVisible();
  expect(screen.queryByText('DO NOT SHOW ANOTHER REVIEW')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to Reviews' }));
  expect(await screen.findByRole('region', { name: 'Reviews sessions' })).toBeVisible();
});
