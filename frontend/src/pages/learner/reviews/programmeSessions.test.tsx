/* global RequestInfo, RequestInit */
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
let currentCoach: { name: string; email: string };

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
  currentCoach = { name: 'Assigned coach', email: 'assigned@example.test' };
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
    else if (url.includes('/calendar/')) { body = { events, currentCoach }; failed = calendarFails; }
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
  expect((await within(region).findAllByRole('link', { name: 'View meeting' }))[0]).toBeVisible();
  expect(within(region).getByRole('button', { name: 'Book a time' })).toBeVisible();
  expect(within(region).getByRole('tablist')).toBeVisible();
  fireEvent.click(within(region).getByRole('tab', { name: /Past/ }));
  expect(within(region).getAllByRole('link', { name: 'View meeting' })[0]).toBeVisible();
});

it('keeps completed imported review history in all Reviews', async () => {
  detailActivityAvailable = true;
  historyReviews = [{
    id: 'review-1', aptemReviewId: 'A-1', name: 'Eligibility Review & FS Discussion',
    type: 'Eligibility Review & FS Discussion', reviewerName: 'Review officer',
    plannedDate: '2026-09-18', plannedTime: null, completedDate: null,
    status: 'completed', extractionStatus: 'complete', detailsAvailable: false, sections: [],
  }];
  mount(cases[0]);

  const region = await screen.findByRole('region', { name: 'Reviews sessions' });
  fireEvent.click(within(region).getByRole('button', { name: /^Past \(/ }));
  expect((await within(region).findAllByText('Eligibility Review & FS Discussion')).at(-1)).toBeVisible();
  expect(within(region).getByRole('button', { name: 'All (1)' })).toBeVisible();
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
function mount(item: typeof cases[number], suffix = '?kind=apprenticeship&learner=125', view: 'all' | 'current' = 'all') {
  const allView = view === 'all' && !suffix.startsWith('/');
  const target = `/learner/${item.path}${suffix}${allView ? `${suffix.includes('?') ? '&' : '?'}view=all` : ''}`;
  return render(<React.StrictMode><ToastProvider><MemoryRouter initialEntries={[target]}>
    <SwitchLearner path={item.path} />
    <Routes>
      <Route path={`/learner/${item.path}`} element={<item.Page />} />
      <Route path={`/learner/${item.path}/:${item.source === 'mcr' ? 'sessionId' : 'reviewId'}`} element={<item.Detail />} />
      <Route path="/learner/calendar" element={<Destination />} />
    </Routes>
  </MemoryRouter></ToastProvider></React.StrictMode>);
}
function bookingAction(_item: typeof cases[number]) { return 'Book a time'; }
function viewAction(item: typeof cases[number]) { return item.source === 'mcr' ? 'View meeting' : /^Progress Review/; }
function reviewFilter(name: 'All' | 'Upcoming' | 'Past', count: number) {
  return screen.getByRole('button', { name: `${name} (${count})` });
}
function openMoreOptions() {
  const summary = screen.getByText('More options', { selector: 'summary' });
  fireEvent.click(summary);
}

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
    fireEvent.click(await within(region).findByRole('button', { name: bookingAction(item) }));
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
    fireEvent.click(await within(screen.getByRole('region', { name: item.region })).findByRole('button', { name: bookingAction(item) }));
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
    const buttons = await within(screen.getByRole('region', { name: item.region })).findAllByRole('button', { name: bookingAction(item) });
    events = [events[1]];
    fireEvent.click(buttons[0]);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This meeting is no longer available');
    expect(within(dialog).getByRole('button', { name: 'Book session' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bookings).toHaveLength(0);
  });

  it.each(['card', 'list'] as const)('opens the compact booking dialog in place from the %s and books the exact meeting', async entry => {
    events = [session(item.source), { ...session(item.source, 2), targetDate: '2026-10-31' }];
    mount(item, undefined, entry === 'card' ? 'current' : 'all');
    if (entry === 'card') fireEvent.click(await screen.findByRole('button', { name: 'Book a time' }));
    else fireEvent.click((await within(screen.getByRole('region', { name: item.region })).findAllByRole('button', { name: bookingAction(item) }))[1]);
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
    const page = mount(item, undefined, 'current');
    expect(await screen.findByText(item.source === 'mcr' ? 'Calendar sync pending' : warning)).toBeVisible();
    page.unmount(); mount(item, undefined, 'current');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(warning));
    openMoreOptions();
    fireEvent.click(screen.getAllByRole('button', { name: item.source === 'mcr' ? 'Reschedule' : 'Reschedule meeting' })[0]);
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
    await waitFor(() => expect(within(region).getAllByRole('link', { name: viewAction(item) })[0]).toBeVisible());
    expect(region).toBeVisible();
    if (item.source !== 'mcr') {
      expect(reviewFilter('All', 2)).toBeVisible(); expect(reviewFilter('Past', 1)).toBeVisible();
    }
    fireEvent.click(item.source === 'mcr' ? within(region).getByRole('tab', { name: /Past/ }) : reviewFilter('Past', 1));
    expect(within(region).getAllByRole('link', { name: viewAction(item) })[0]).toBeVisible();
    expect(requests.filter(url => url.includes('/calendar/'))).toHaveLength(1);
    expect(requests.filter(url => url.startsWith('/learner_api/')).every(url => url.includes('/apprenticeship/125/'))).toBe(true);
    fireEvent.click(item.source === 'mcr' ? within(region).getByRole('tab', { name: /Upcoming/ }) : reviewFilter('Upcoming', 1));
    fireEvent.click(within(region).getByRole('button', { name: bookingAction(item) }));
    expect(await screen.findByRole('dialog', { name: /Book (monthly coaching|progress review)/ })).toBeVisible();
  });

  it.each(['summary', 'archive'])('keeps current sessions visible when the %s fails', async dependency => {
    events = [session(item.source)]; detailFails = dependency === 'summary'; archiveFails = dependency === 'archive';
    mount(item);
    await waitFor(() => expect(within(screen.getByRole('region', { name: item.region })).getAllByRole('link', { name: viewAction(item) })[0]).toBeVisible());
    if (item.source !== 'mcr') expect(reviewFilter('All', 1)).toBeVisible();
  });

  it('reports calendar failure and recovers through Try again', async () => {
    calendarFails = true; mount(item);
    expect(await screen.findByText('Could not load programme sessions. Please try again.')).toBeVisible();
    expect(screen.queryByText(/No (progress review|monthly coaching) sessions were found/)).not.toBeInTheDocument();
    calendarFails = false; events = [session(item.source)];
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: item.region })).getAllByRole('link', { name: viewAction(item) })[0]).toBeVisible());
    expect(screen.queryByText('Could not load programme sessions. Please try again.')).not.toBeInTheDocument();
  });

  it('reloads the booking when returning to an already open page', async () => {
    events = [session(item.source)]; mount(item);
    await screen.findByRole('button', { name: bookingAction(item) });
    events = [{ ...session(item.source, 1, 'scheduled'), scheduledDate: '2026-11-02', scheduledTime: '14:30' }];
    fireEvent.focus(window);
    if (item.source === 'mcr') {
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Book a time' })).not.toBeInTheDocument());
      expect(screen.getByRole('region', { name: item.region })).toHaveTextContent(/0?2 Nov 2026/);
    } else {
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Book a time' })).not.toBeInTheDocument());
      const region = within(screen.getByRole('region', { name: item.region }));
      expect(region.getByText('Scheduled', { exact: true })).toBeVisible();
      expect(region.getByRole('list')).toHaveTextContent('2 November 2026');
    }
  });

  it('clears previous learner sessions while a different learner loads', async () => {
    events = [session(item.source)]; mount(item);
    await screen.findByRole('button', { name: bookingAction(item) });
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(input => String(input).includes('/calendar/')
      ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve(new Response(JSON.stringify(String(input).includes('/review-history/') ? { reviews: [] } : detail))));
    fireEvent.click(screen.getByRole('button', { name: 'Switch learner' }));
    expect(screen.queryByRole('link', { name: viewAction(item) })).not.toBeInTheDocument();
    await act(async () => finish(new Response(JSON.stringify({ events: [] }))));
    if (item.source === 'mcr') {
      expect(screen.queryByRole('button', { name: 'Book a time' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'View meeting' })).not.toBeInTheDocument();
    } else {
      expect(await screen.findByRole('link', { name: 'View all reviews (0)' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Book a time' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /^Progress Review/ })).not.toBeInTheDocument();
    }
  });

  it('opens the assigned session details and returns to the same learner list', async () => {
    events = [session(item.source)]; mount(item);
    const region = screen.getByRole('region', { name: item.region });
    fireEvent.click((await within(region).findAllByRole('link', { name: viewAction(item) }))[0]);
    const back = await screen.findByRole('button', { name: item.source === 'mcr' ? 'Back to coaching meetings' : 'Back to Reviews' });
    await waitFor(() => expect(screen.getAllByText('Assigned coach').length).toBeGreaterThan(0));
    fireEvent.click(back);
    expect(await screen.findByRole('region', { name: item.region })).toBeVisible();
    if (item.source === 'mcr' && screen.queryByRole('link', { name: 'View all meetings' })) {
      fireEvent.click(screen.getByRole('link', { name: 'View all meetings' }));
    }
    expect(screen.getByRole('link', { name: 'Open calendar' })).toHaveAttribute('href', '/learner/calendar?kind=apprenticeship&learner=125');
  });

  it('keeps a signed-in learner on their own assignments despite an old staff link', async () => {
    rememberSignedInLearner('learner', '126', 'commercial');
    events = [session(item.source)]; mount(item);
    await screen.findByRole('button', { name: bookingAction(item) });
    expect(requests.filter(url => url.startsWith('/learner_api/')).every(url => url.includes('/commercial/126/'))).toBe(true);
    expect(screen.getByRole('link', { name: 'Open calendar' })).toHaveAttribute('href', '/learner/calendar?kind=commercial&learner=126');
  });
});

it('uses the calendar current assignment separately from a booked meeting host and preserves its link', async () => {
  currentCoach = { name: 'Test curriculum', email: 'current@example.test' };
  const booked = { ...session('mcr', 1, 'scheduled'), coachName: 'Rewan Yasser', coachEmail: 'host@example.test',
    scheduledDate: '2026-09-15', scheduledTime: '11:00', date: '2026-09-15', targetDate: '2026-09-15',
    meetingLink: 'https://teams.microsoft.com/meet/existing-booking', meetingProvider: 'Microsoft Teams' };
  events = [booked];
  mount(cases[1], undefined, 'current');
  const card = within(await screen.findByRole('article', { name: 'Current coaching meeting' }));
  expect(await card.findByText('Test curriculum', { exact: true })).toBeVisible();
  expect(card.getByText('This meeting is booked with Rewan Yasser.')).toBeVisible();
  expect(card.getByRole('link', { name: 'Open meeting link' })).toHaveAttribute('href', booked.meetingLink);
  expect(bookings).toEqual([]);
  expect(reschedules).toEqual([]);
  expect(events[0]).toBe(booked);
});

it('opens monthly coaching on the current meeting and reveals grouped history only on request', async () => {
  events = [
    { ...session('mcr', 1), reviewTemplateId: 'REV-1', reviewTypeCode: 'mcm', title: 'September check-in', targetDate: '2026-09-15', date: '2026-09-15' },
    { ...session('mcr', 2, 'scheduled'), reviewTemplateId: 'REV-2', reviewTypeCode: 'mcm', title: 'Your next appointment',
      coachName: 'Appointment coach', scheduledDate: '2026-09-20', scheduledTime: '10:00', date: '2026-09-20', targetDate: '2026-09-20' },
    { ...session('mcr', 3), reviewTemplateId: 'REV-3', reviewTypeCode: 'mcm', title: 'November check-in', date: '2026-11-02', targetDate: '2026-11-02' },
    { ...session('mcr', 4, 'completed'), date: '2026-09-10', targetDate: '2026-09-10' },
  ];
  mount(cases[1], undefined, 'current');

  const current = await screen.findByRole('article', { name: 'Current coaching meeting' });
  await waitFor(() => expect(current).toHaveTextContent('Appointment coach'));
  expect(current).toHaveTextContent('20 Sept 2026');
  expect(within(current).getByRole('link', { name: 'Prepare for meeting' })).toBeVisible();
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  expect(screen.queryByText(/November 2026 coaching/)).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();

  const all = screen.getByRole('link', { name: 'View all meetings' });
  const allParams = new URL(all.getAttribute('href')!, 'http://localhost').searchParams;
  expect(Object.fromEntries(allParams)).toMatchObject({ kind: 'apprenticeship', learner: '125', view: 'all' });
  fireEvent.click(all);

  const region = await screen.findByRole('region', { name: 'Monthly Coaching Meetings' });
  expect(within(region).getByRole('tab', { name: /Upcoming/ })).toHaveAttribute('aria-selected', 'true');
  expect(within(region).getAllByRole('listitem')).toHaveLength(2);
  expect(within(region).getByText(/November 2026 coaching/)).toBeVisible();
  fireEvent.click(within(region).getByRole('tab', { name: /Needs your action/ }));
  expect(within(region).getByText(/September 2026 coaching/)).toBeVisible();
  expect(within(region).getAllByRole('listitem')).toHaveLength(1);
  fireEvent.click(within(region).getByRole('tab', { name: /Past/ }));
  const past = within(region).getAllByRole('link', { name: 'View meeting' })[0];
  expect(past.getAttribute('href')).toContain(encodeURIComponent(events[3].id));
  expect(past.getAttribute('href')).toContain('learner=125');

  fireEvent.click(screen.getByRole('link', { name: 'Back to current meeting' }));
  expect(await screen.findByRole('article', { name: 'Current coaching meeting' })).toHaveTextContent('Appointment coach');
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
});

it('preserves the signed-in learner when opening all monthly coaching meetings from an old staff link', async () => {
  rememberSignedInLearner('learner', '126', 'commercial');
  events = [session('mcr')];
  mount(cases[1], undefined, 'current');
  await screen.findByRole('button', { name: 'Book a time' });

  const all = screen.getByRole('link', { name: 'View all meetings' });
  expect(all.getAttribute('href')).toContain('kind=commercial');
  expect(all.getAttribute('href')).toContain('learner=126');
  fireEvent.click(all);
  expect(await screen.findByRole('link', { name: 'Open calendar' })).toHaveAttribute('href', '/learner/calendar?kind=commercial&learner=126');
  expect(requests.filter(url => url.startsWith('/learner_api/')).every(url => url.includes('/commercial/126/'))).toBe(true);
});

it('opens Reviews on the next booking, keeps an earlier signature visible, and browses every record without writes', async () => {
  rememberSignedInLearner('learner', '126', 'commercial');
  events = [
    { ...session('progress-review', 1), date: '2026-10-01', targetDate: '2026-10-01' },
    { ...session('progress-review', 2, 'scheduled'), coachName: 'Booked reviewer', date: '2026-10-20',
      targetDate: '2026-10-20', scheduledDate: '2026-10-20', scheduledTime: '10:00' },
    { ...session('progress-review', 3, 'awaiting-signature'), date: '2026-09-01', targetDate: '2026-09-01', learnerSigned: false },
    { ...session('progress-review', 4, 'completed'), date: '2026-08-01', targetDate: '2026-08-01', learnerSigned: true },
    { ...session('progress-review', 5, 'cancelled'), date: '2026-11-01', targetDate: '2026-11-01' },
  ];
  const originals = [...events];
  const snapshot = structuredClone(events);
  mount(cases[0], undefined, 'current');

  const current = await screen.findByRole('article', { name: 'Current review' });
  await waitFor(() => expect(current).toHaveTextContent('Booked reviewer'));
  expect(current).toHaveTextContent('20 October 2026');
  expect(within(current).getByRole('link', { name: 'View review' })).toHaveAttribute('href',
    `/learner/progress-reviews/${encodeURIComponent(events[1].id)}?kind=commercial&learner=126`);
  expect(screen.queryByRole('group', { name: 'Filter reviews' })).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Book a time' })).not.toBeInTheDocument();
  const attention = within(screen.getByRole('region', { name: 'Reviews needing attention' }));
  expect(attention.getByText('Your signature is needed', { exact: false })).toBeVisible();
  expect(attention.getByRole('link', { name: 'Read & sign' })).toHaveAttribute('href',
    `/learner/progress-reviews/${encodeURIComponent(events[2].id)}?kind=commercial&learner=126`);

  const all = screen.getByRole('link', { name: 'View all reviews (5)' });
  expect(Object.fromEntries(new URL(all.getAttribute('href')!, 'http://localhost').searchParams)).toEqual({
    kind: 'commercial', learner: '126', view: 'all',
  });
  fireEvent.click(all);
  expect(reviewFilter('All', 5)).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByRole('listitem')).toHaveLength(5);
  fireEvent.click(reviewFilter('Upcoming', 2));
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Book a time' })).toBeVisible();
  fireEvent.click(reviewFilter('Past', 3));
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByText('Cancelled', { exact: true })).toBeVisible();
  const completed = screen.getByRole('link', { name: /Progress Review.*#4$/ });
  const completedUrl = new URL(completed.getAttribute('href')!, 'http://localhost');
  expect(completedUrl.pathname).toBe(`/learner/progress-reviews/${encodeURIComponent(events[3].id)}`);
  expect(Object.fromEntries(completedUrl.searchParams)).toEqual({ kind: 'commercial', learner: '126', view: 'all', filter: 'past', page: '1' });
  fireEvent.click(completed);
  fireEvent.click(await screen.findByRole('button', { name: 'Back to Reviews' }));
  await waitFor(() => expect(reviewFilter('Past', 3)).toHaveAttribute('aria-pressed', 'true'));
  fireEvent.click(screen.getByRole('link', { name: 'Back to current review' }));
  expect(await screen.findByRole('article', { name: 'Current review' })).toHaveTextContent('Booked reviewer');
  expect(screen.queryByRole('group', { name: 'Filter reviews' })).not.toBeInTheDocument();
  expect(events).toEqual(snapshot);
  events.forEach((event, index) => expect(event).toBe(originals[index]));
  expect(bookings).toEqual([]);
  expect(reschedules).toEqual([]);
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  expect(requests.filter(url => url.startsWith('/learner_api/')).every(url => url.includes('/commercial/126/'))).toBe(true);
});

it('never substitutes another review when the requested review no longer exists', async () => {
  events = [{ ...session('progress-review'), reviewResponses: { rag_status: 'DO NOT SHOW ANOTHER REVIEW' } }];
  mount(cases[0], '/missing-review?kind=apprenticeship&learner=125');
  expect(await screen.findByText(/This progress review is no longer available/)).toBeVisible();
  expect(screen.queryByText('DO NOT SHOW ANOTHER REVIEW')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to Reviews' }));
  expect(await screen.findByRole('region', { name: 'Reviews sessions' })).toBeVisible();
});
