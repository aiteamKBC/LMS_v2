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
vi.mock('@/hooks/useLearnerWorkspaceAccess', () => ({ useLearnerWorkspaceAccess: () => ({ canProgress: true }) }));

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
let bookingWarning: string;
let bookings: Record<string, unknown>[];
let reschedules: Record<string, unknown>[];
let bookingError: string;

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
  bookingWarning = ''; bookings = []; reschedules = []; bookingError = '';
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } },
    close: { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } },
  });
  // jsdom does not load Tailwind. Apply its visibility utilities so the
  // regression fails for a populated but CSS-hidden list, as in the report.
  const style = document.createElement('style'); style.id = 'review-test-style';
  style.textContent = '.hidden { display: none; } .md\\:block { display: block; } .md\\:hidden { display: none; }';
  document.head.append(style);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); requests.push(url);
    if ((init?.method === 'POST' && url.endsWith('/book/')) || (init?.method === 'PATCH' && url.endsWith('/reschedule/'))) {
      const payload = JSON.parse(String(init.body));
      (init.method === 'POST' ? bookings : reschedules).push(payload);
      if (bookingError) return new Response(JSON.stringify({ error: bookingError }), { status: 409 });
      const existing = events.find(event => event.eventKey === payload.eventKey || (payload.reviewId && event.reviewId === payload.reviewId))
        || session(payload.sessionType);
      const saved = { ...existing, status: 'scheduled', date: payload.scheduledDate,
        scheduledDate: payload.scheduledDate, scheduledTime: payload.scheduledTime, durationMinutes: payload.durationMinutes,
        reviewId: payload.reviewId, invited: !bookingWarning, syncWarning: bookingWarning, syncState: bookingWarning ? 'failed' : 'synced' } as LearnerCalendarEvent;
      events = [...events.filter(event => event.id !== saved.id), saved];
      historyReviews = historyReviews.map(review => review.id === payload.reviewId ? { ...review, status: 'scheduled', plannedDate: payload.scheduledDate, plannedTime: payload.scheduledTime } : review);
      return new Response(JSON.stringify({ event: saved, warning: bookingWarning }), { status: 201 });
    }
    if (init?.method && init.method !== 'GET') throw new Error('Unexpected write');
    let body: unknown; let failed = false;
    if (url.includes('/curriculum/cache-epoch/')) body = { epoch: 0, changes: [] };
    else if (url.includes('/learner-detail/')) { body = { ...detail, studentActivityAvailable: detailActivityAvailable }; failed = detailFails; }
    else if (url.includes('/review-history/')) { body = { reviews: historyReviews }; failed = archiveFails; }
    else if (url.includes('/calendar/')) { body = { events }; failed = calendarFails; }
    else if (url.includes('/meeting-attendance/')) body = { sessions: [], today: '2026-09-14', timeZone: 'Europe/London', csrfToken: 'test' };
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
  expect(within(region).getByRole('button', { name: 'Schedule' })).toBeVisible();
  expect(within(region).getByRole('tablist')).toBeVisible();
});

it('keeps completed imported review history in the Reviews table', async () => {
  detailActivityAvailable = true;
  historyReviews = [{
    id: 'review-1', aptemReviewId: 'A-1', name: 'Eligibility Review & FS Discussion',
    type: 'Eligibility Review & FS Discussion', reviewerName: 'Review officer',
    plannedDate: '2026-09-18', plannedTime: null, completedDate: null,
    status: 'completed', extractionStatus: 'complete', detailsAvailable: false, sections: [],
  }];
  mount(cases[0]);

  const region = await screen.findByRole('region', { name: 'Reviews sessions' });
  fireEvent.click(within(region).getByRole('tab', { name: /Finished/ }));
  expect((await within(region).findAllByText('Eligibility Review & FS Discussion')).at(-1)).toBeVisible();
  expect(metric('Total')).toHaveTextContent('1');
});
afterEach(() => {
  vi.useRealTimers();
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
  it('schedules the Curriculum occurrence when imported future reviews also exist', async () => {
    detailActivityAvailable = true;
    historyReviews = [{ id: '908', aptemReviewId: 'A-908', name: 'Old imported meeting',
      type: 'Progress Review', reviewerName: 'Assigned coach',
      plannedDate: '2026-10-02', plannedTime: null, completedDate: null,
      status: 'not-scheduled', extractionStatus: 'complete', detailsAvailable: false, sections: [] }];
    events = [{ ...session(item.source), title: 'Configured conversation', reviewTemplateId: 'REV-1',
      reviewTypeCode: item.source === 'mcr' ? 'mcm' : 'progress_review' }];
    mount(item);
    const region = screen.getByRole('region', { name: item.region });
    fireEvent.click(await within(region).findByRole('button', { name: 'Schedule' }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Book session' });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(within(dialog).getByLabelText('Session')).toHaveValue(events[0].eventKey);
    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: '2026-10-05' } });
    fireEvent.click(submit);
    await waitFor(() => expect(bookings).toHaveLength(1));
    expect(bookings[0]).toEqual(expect.objectContaining({ eventKey: events[0].eventKey, sessionType: item.source }));
    expect(bookings[0]).not.toHaveProperty('reviewId');
    expect(screen.queryByText('Old imported meeting')).not.toBeInTheDocument();
  });

  it('keeps the dialog and entered values when a booking conflicts, and allows retry', async () => {
    events = [session(item.source)];
    mount(item);
    fireEvent.click(await within(screen.getByRole('region', { name: item.region })).findByRole('button', { name: 'Schedule' }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Book session' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: '2026-11-07' } });
    expect(submit).toBeDisabled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Saturdays or Sundays');
    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: '2026-11-09' } });
    const readCount = requests.length;
    fireEvent.focus(window);
    await waitFor(() => expect(requests.length).toBeGreaterThan(readCount));
    expect(within(dialog).getByLabelText('Day')).toHaveValue('2026-11-09');
    bookingError = 'That time overlaps another calendar event. Please choose another time.';
    fireEvent.click(submit);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(bookingError);
    expect(within(dialog).getByLabelText('Day')).toHaveValue('2026-11-09');
    bookingError = '';
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '13:30' } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bookings.at(-1)).toMatchObject({ scheduledDate: '2026-11-09', scheduledTime: '13:30' });
  });

  it('does not substitute another event when the selected meeting disappears', async () => {
    events = [session(item.source), session(item.source, 2)];
    mount(item);
    const buttons = await within(screen.getByRole('region', { name: item.region })).findAllByRole('button', { name: 'Schedule' });
    events = [events[1]];
    fireEvent.click(buttons[0]);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This meeting is no longer available');
    expect(within(dialog).getByRole('button', { name: 'Book session' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bookings).toHaveLength(0);
  });

  it.each(['card', 'table'] as const)('opens the compact booking dialog in place from the %s and books the exact meeting', async entry => {
    events = [session(item.source), { ...session(item.source, 2), targetDate: '2026-10-31' }];
    mount(item);
    await screen.findByRole('button', { name: 'Schedule meeting' });
    if (entry === 'card') fireEvent.click(screen.getByRole('button', { name: 'Schedule meeting' }));
    else fireEvent.click(within(screen.getByRole('region', { name: item.region })).getAllByRole('button', { name: 'Schedule' })[1]);
    const target = entry === 'card' ? events[0] : events[1];
    const dialog = await screen.findByRole('dialog', { name: item.source === 'mcr' ? 'Book monthly coaching' : 'Book progress review' });
    expect(within(dialog).getByLabelText('Session')).toHaveValue(target.id);
    const submit = within(dialog).getByRole('button', { name: 'Book session' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: '2026-11-02' } });
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '14:30' } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bookings).toEqual([expect.objectContaining({ eventKey: target.eventKey, sessionType: item.source,
      scheduledDate: '2026-11-02', scheduledTime: '14:30', durationMinutes: 60,
      timezoneOffsetMinutes: new Date('2026-11-02T14:30:00').getTimezoneOffset() })]);
    expect(reschedules).toHaveLength(0);
    expect(screen.getByRole('region', { name: item.region })).toBeVisible();
  });

  it('opens rescheduling for the existing appointment and retains its sync warning on reload', async () => {
    const warning = 'Your slot is saved, but Microsoft calendar access needs administrator approval.';
    events = [{ ...session(item.source), status: 'scheduled', date: '2026-10-02', scheduledDate: '2026-10-02', scheduledTime: '09:00', durationMinutes: 90, invited: false, syncWarning: warning }];
    const page = mount(item);
    expect(await screen.findByText('Calendar sync pending')).toBeVisible();
    page.unmount(); mount(item);
    expect(await screen.findByRole('status')).toHaveTextContent(warning);
    fireEvent.click(screen.getAllByRole('button', { name: 'Reschedule' })[0]);
    const dialog = await screen.findByRole('dialog', { name: /Reschedule (monthly coaching|progress review)/ });
    const submit = within(dialog).getByRole('button', { name: 'Save new time' });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(within(dialog).getByLabelText('Day')).toHaveValue('2026-10-02');
    expect(within(dialog).getByLabelText('Time')).toHaveValue('09:00');
    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: '2026-10-05' } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(reschedules).toEqual([expect.objectContaining({ eventKey: events[0].eventKey, durationMinutes: 90, scheduledDate: '2026-10-05' })]);
    expect(bookings).toHaveLength(0);
  });

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
    fireEvent.click(within(region).getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByRole('dialog', { name: /Book (monthly coaching|progress review)/ })).toBeVisible();
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
