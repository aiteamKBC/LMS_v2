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
import type { MeetingAttendance } from '@/api/meetingAttendance';
import { ToastProvider } from '@/hooks/useToast';
import ProgressReviewPage, { ProgressReviewsListPage } from '../progress-reviews/page';
import MonthlyCoachingPage, { MonthlyCoachingListPage } from '../monthly-coaching/page';
import { CurriculumReviewPage, CurriculumReviewsListPage } from './curriculumReviews';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/pages/coach/progress-reviews/page', () => ({ buildProgressReviewSlidesDeck: vi.fn() }));
const access = vi.hoisted(() => ({ canProgress: true }));
vi.mock('@/hooks/useLearnerWorkspaceAccess', () => ({ useLearnerWorkspaceAccess: () => access }));

const detail = { id: '125', name: 'New learner', programme: 'Assigned programme',
  components: [], componentProgress: [], videoProgress: [], quizAttempts: [] };
const cases = [
  { source: 'progress-review', path: 'progress-reviews', region: 'Reviews sessions', Page: ProgressReviewsListPage, Detail: ProgressReviewPage },
  { source: 'mcr', path: 'monthly-coaching', region: 'Monthly Coaching Meetings', Page: MonthlyCoachingListPage, Detail: MonthlyCoachingPage },
] as const;
const reviewsCase = { source: 'review', path: 'reviews', region: 'Reviews sessions',
  Page: CurriculumReviewsListPage, Detail: CurriculumReviewPage } as const;
let events: LearnerCalendarEvent[];
let calendarFails: boolean;
let detailFails: boolean;
let archiveFails: boolean;
let detailActivityAvailable: boolean;
let historyReviews: ImportedReview[];
let attendanceSessions: MeetingAttendance[];
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
  // Booking dates in these fixtures are relative to this server-provided day.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-14T09:00:00Z'));
  clearAllCachedResources();
  rememberSignedInLearner(undefined, undefined);
  localStorage.clear(); rememberLearner('commercial', '19');
  vi.stubGlobal('React', React); vi.stubGlobal('AppIcon', AppIcon);
  events = []; historyReviews = []; attendanceSessions = []; requests = []; calendarFails = detailFails = archiveFails = detailActivityAvailable = false;
  bookingWarning = ''; bookings = []; reschedules = []; bookingError = '';
  currentCoach = { name: 'Assigned coach', email: 'assigned@example.test' };
  access.canProgress = true;
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
        calendarEventKey: existing.reviewSource === 'aptem' ? existing.calendarEventKey || `booking:${existing.reviewId}` : existing.calendarEventKey,
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
    else if (url.includes('/calendar/') || url.includes('/review-sessions/')) {
      body = { events: url.includes('content=summary')
        ? events.map(event => event.importedReview ? { ...event, importedReview: { ...event.importedReview, sections: [] } } : event)
        : events, currentCoach };
      failed = calendarFails;
    }
    else if (url.includes('/meeting-attendance/')) body = { sessions: attendanceSessions, today: '2026-09-14', timeZone: 'Europe/London', csrfToken: 'test' };
    else throw new Error(`Unexpected read: ${url}`);
    return new Response(JSON.stringify(failed ? { error: 'Temporarily unavailable' } : body), { status: failed ? 503 : 200 });
  }));
});

it('renders server-owned Native occurrences without requiring imported history', async () => {
  events = [session('mcr'), session('mcr', 2, 'completed')];
  mount(cases[1]);

  const region = await screen.findByRole('region', { name: 'Monthly Coaching Meetings' });
  expect((await within(region).findAllByRole('link', { name: 'View meeting' }))[0]).toBeVisible();
  expect(within(region).getByRole('button', { name: 'Book a time' })).toBeVisible();
  expect(within(region).getByRole('tablist')).toBeVisible();
  fireEvent.click(within(region).getByRole('tab', { name: /Past/ }));
  expect(within(region).getAllByRole('link', { name: 'View meeting' })[0]).toBeVisible();
});

it('bounds a stalled progress-review read and shows loading again during retry', async () => {
  const normalFetch = vi.mocked(fetch).getMockImplementation()!;
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation((input, init) => String(input).includes('/review-sessions/')
    ? new Promise(resolve => { finish = resolve; }) : normalFetch(input, init));
  vi.useFakeTimers();
  mount(cases[0], '?kind=apprenticeship&learner=125', 'current');
  expect(screen.getByText('Loading your reviews…')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'View all reviews (0)' })).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
  expect(screen.getByText('Loading is taking longer than expected. Please try again.')).toBeVisible();
  expect(screen.queryByText('No current review')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByText('Loading your reviews…')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'View all reviews (0)' })).not.toBeInTheDocument();
  await act(async () => { finish(new Response(JSON.stringify({ events: [session('progress-review')] }))); });
  expect(screen.getByRole('link', { name: 'View all reviews (1)' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Book a time' })).toBeVisible();
});

it('keeps completed ordinary imported history in Reviews', async () => {
  detailActivityAvailable = true;
  historyReviews = [{
    id: 'review-1', aptemReviewId: 'A-1', name: 'Eligibility Review & FS Discussion',
    type: 'Eligibility Review & FS Discussion', reviewerName: 'Review officer',
    plannedDate: '2026-09-18', plannedTime: null, completedDate: null,
    status: 'completed', extractionStatus: 'complete', detailsAvailable: false, sections: [],
  }];
  events = [{ ...session('progress-review', 1, 'completed'), id: 'imported-review:A-900', eventKey: 'imported-review:A-900',
    reviewSource: 'aptem', reviewId: historyReviews[0].id, importedReview: historyReviews[0], title: historyReviews[0].name,
    date: historyReviews[0].plannedDate, targetDate: historyReviews[0].plannedDate }];
  mount(reviewsCase);

  const region = await screen.findByRole('region', { name: 'Reviews sessions' });
  fireEvent.click(await within(region).findByRole('button', { name: /^Past \(/ }));
  expect((await within(region).findAllByText('Eligibility Review & FS Discussion')).at(-1)).toBeVisible();
  expect(within(region).getByRole('button', { name: 'All (1)' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Review timeline' })).toBeVisible();
});

describe.each(['apprenticeship', 'commercial'])('%s Aptem progress review detail booking', kind => {
  it.each(['not-scheduled', 'completed'])('offers a first booking only for an open review: %s', async status => {
    events = [{ ...session('progress-review', 1, status), id: 'imported-review:A-11', eventKey: 'imported-review:A-11',
      reviewSource: 'aptem', reviewId: '11', aptemReviewId: 'A-11', importedReview: {
        id: '11', aptemReviewId: 'A-11', name: 'Progress Review 1', type: 'Progress Review', reviewerName: 'Coach',
        plannedDate: '2026-10-31', plannedTime: null, completedDate: status === 'completed' ? '2026-09-01' : null,
        status, extractionStatus: 'complete', detailsAvailable: false, sections: [],
      } }];
    mount(cases[0], `/imported-review%3AA-11?kind=${kind}&learner=125`);
    await screen.findByRole('heading', { name: 'Progress Review 1', level: 2 });
    if (status === 'completed') {
      expect(screen.queryByRole('button', { name: 'Book a time' })).not.toBeInTheDocument();
      expect(bookings).toEqual([]);
      return;
    }
    const book = screen.getByRole('button', { name: 'Book a time' });
    await waitFor(() => expect(book).toBeEnabled());
    fireEvent.click(book);
    const dialog = await screen.findByRole('dialog', { name: 'Book progress review' });
    const submit = within(dialog).getByRole('button', { name: 'Book session' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: '2026-11-02' } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bookings).toEqual([expect.objectContaining({ reviewId: '11', sessionType: 'progress-review', scheduledDate: '2026-11-02' })]);
    expect(reschedules).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Book a time' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Reschedule meeting' })).toBeEnabled();
  });

  it('reschedules from the detail page using the existing booking and refreshes the saved time', async () => {
    const imported = { ...session('progress-review', 1, 'scheduled'), id: 'imported-review:A-11', eventKey: 'imported-review:A-11',
      calendarEventKey: 'booking:11', reviewSource: 'aptem' as const, reviewId: '11', aptemReviewId: 'A-11',
      scheduledDate: '2026-10-20', scheduledTime: '09:00', durationMinutes: 90, importedReview: {
        id: '11', aptemReviewId: 'A-11', name: 'Progress Review 1', type: 'Progress Review', reviewerName: 'Coach',
        plannedDate: '2026-10-01', plannedTime: '09:00', completedDate: null, status: 'scheduled',
        extractionStatus: 'complete', detailsAvailable: false, sections: [],
      } };
    const unrelated = { ...session('progress-review', 2, 'scheduled'), scheduledDate: imported.scheduledDate, scheduledTime: '12:00' };
    events = [imported, unrelated];
    mount(cases[0], `/imported-review%3AA-11?kind=${kind}&learner=125`);
    const reschedule = await screen.findByRole('button', { name: 'Reschedule meeting' });
    await waitFor(() => expect(reschedule).toBeEnabled());
    fireEvent.click(reschedule);
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Save new time' });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(within(dialog).getByLabelText('Day')).toHaveValue('2026-10-20');
    expect(within(dialog).getByLabelText('Time')).toHaveValue('09:00');
    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: '2026-10-21' } });
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '14:30' } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(reschedules).toEqual([expect.objectContaining({ eventKey: 'booking:11', reviewId: '11',
      scheduledDate: '2026-10-21', scheduledTime: '14:30', durationMinutes: 90 })]);
    expect(bookings).toEqual([]);
    expect(events).toContainEqual(unrelated);
    expect(events.find(event => event.reviewId === '11')).toMatchObject({ id: imported.id, eventKey: imported.eventKey, importedReview: imported.importedReview });
    fireEvent.click(await screen.findByRole('button', { name: 'Reschedule meeting' }));
    const refreshed = await screen.findByRole('dialog');
    await waitFor(() => expect(within(refreshed).getByLabelText('Day')).toHaveValue('2026-10-21'));
    expect(within(refreshed).getByLabelText('Time')).toHaveValue('14:30');
  });

  it.each(['completed', 'awaiting-signature', 'in-progress', 'cancelled', 'attended'])('keeps a %s detail read-only for scheduling', async status => {
    events = [{ ...session('progress-review', 1, status === 'attended' ? 'scheduled' : status),
      id: 'imported-review:A-11', eventKey: 'imported-review:A-11', calendarEventKey: 'booking:11', reviewId: '11',
      reviewSource: 'aptem', scheduledDate: '2026-10-20', scheduledTime: '09:00', importedReview: {
        id: '11', aptemReviewId: 'A-11', name: 'Progress Review 1', type: 'Progress Review', reviewerName: 'Coach',
        plannedDate: '2026-10-01', plannedTime: '09:00', completedDate: null, status: 'scheduled',
        extractionStatus: 'complete', detailsAvailable: false, sections: [],
      } }];
    // A different attendance ID must still match this exact durable booking key.
    attendanceSessions = [{ id: 'local:11', calendarEventKey: 'booking:11', title: 'Progress review', status: 'scheduled',
      date: '2026-10-20', startTime: '09:00', durationMinutes: 60, meetingLink: '', meetingProvider: '',
      canAttend: false, attendanceConfirmed: status === 'attended', creditedMinutes: status === 'attended' ? 60 : null,
      canReportAbsence: false, absenceReported: false, absenceSessionId: null, missed: false }];
    mount(cases[0], `/imported-review%3AA-11?kind=${kind}&learner=125`);
    await screen.findByRole('heading', { name: 'Progress Review 1', level: 2 });
    await waitFor(() => expect(requests).toContain(`/learner_api/meeting-attendance/${kind}/125/`));
    expect(screen.queryByRole('button', { name: 'Reschedule meeting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Book a time' })).not.toBeInTheDocument();
    expect(bookings).toEqual([]);
    expect(reschedules).toEqual([]);
  });
});

it('disables detail rescheduling while attendance is pending or failed, then enables it after retry', async () => {
  const target = { ...session('progress-review', 1, 'scheduled'), scheduledDate: '2026-10-20', scheduledTime: '09:00' };
  events = [target];
  const normalFetch = vi.mocked(fetch).getMockImplementation()!;
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation((input, init) => String(input).includes('/meeting-attendance/')
    ? new Promise(resolve => { finish = resolve; }) : normalFetch(input, init));
  mount(cases[0], `/${encodeURIComponent(target.id)}?kind=apprenticeship&learner=125`);
  const reschedule = await screen.findByRole('button', { name: 'Reschedule meeting' });
  expect(reschedule).toBeDisabled();
  fireEvent.click(reschedule);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  // The read helper retries a 503 once; fail that request too before using the manual retry.
  vi.mocked(fetch).mockImplementation((input, init) => String(input).includes('/meeting-attendance/')
    ? Promise.resolve(new Response(JSON.stringify({ error: 'Attendance temporarily unavailable' }), { status: 503 })) : normalFetch(input, init));
  await act(async () => { finish(new Response(JSON.stringify({ error: 'Attendance temporarily unavailable' }), { status: 503 })); });
  expect(await screen.findByRole('alert')).toHaveTextContent('Attendance temporarily unavailable');
  expect(reschedule).toBeDisabled();
  vi.mocked(fetch).mockImplementation(normalFetch);
  fireEvent.click(screen.getByRole('button', { name: 'Retry attendance' }));
  await waitFor(() => expect(reschedule).toBeEnabled());
  expect(bookings).toEqual([]);
  expect(reschedules).toEqual([]);
});

it('keeps detail rescheduling disabled in a staff preview', async () => {
  const target = { ...session('progress-review', 1, 'scheduled'), scheduledDate: '2026-10-20', scheduledTime: '09:00' };
  events = [target]; access.canProgress = false;
  mount(cases[0], `/${encodeURIComponent(target.id)}?kind=apprenticeship&learner=125`);
  const reschedule = await screen.findByRole('button', { name: 'Reschedule meeting' });
  expect(reschedule).toBeDisabled();
  fireEvent.click(reschedule);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(bookings).toEqual([]);
  expect(reschedules).toEqual([]);
});

describe.each(['apprenticeship', 'commercial'])('%s imported review classification', kind => {
  const types = ['Eligibility Review & FS Discussion', 'RPL and Experience', 'Progress Review',
    'Progress Review (+ Skills Radar)', 'Monthly Coaching Meeting'];
  function mixedReviews() {
    return types.map((type, index) => ({ ...session(type === 'Monthly Coaching Meeting' ? 'mcr' : 'progress-review', index + 1, 'completed'),
      id: `imported-review:A-${index}`, eventKey: `imported-review:A-${index}`, importedReviewType: type,
      reviewSource: 'aptem' as const, title: type, reviewTypeCode: type === 'Monthly Coaching Meeting' ? 'mcm' : 'progress_review',
      importedReview: { id: String(index), aptemReviewId: `A-${index}`, name: type, type,
        reviewerName: 'Synthetic coach', plannedDate: '2026-10-31', plannedTime: null, completedDate: '2026-10-31',
        status: 'completed', extractionStatus: 'complete', detailsAvailable: true,
        sections: [{ id: 'answer', name: 'Recorded answers', order: 1, fields: [{ label: 'Outcome', value: 'Synthetic saved answer',
          links: [{ text: 'Review evidence', url: 'https://example.invalid/evidence.pdf' }] }], tables: [], rawText: '' }] },
    }));
  }

  it('loads Aptem historical answers only after opening a progress review', async () => {
    events = mixedReviews();
    mount(cases[0], `?kind=${kind}&learner=125`);
    const list = await screen.findByRole('region', { name: 'All reviews' });
    fireEvent.click(within(list).getAllByRole('link', { name: 'View review' })[0]);
    expect(await screen.findByText('Synthetic saved answer')).toBeVisible();
    expect(requests).toContain(`/learner_api/review-sessions/${kind}/125/?content=summary`);
    expect(requests).toContain(`/learner_api/review-sessions/${kind}/125/?content=full`);
    expect(requests.some(url => url.includes('/calendar/'))).toBe(false);
    expect(bookings).toEqual([]);
  });

  it.each([reviewsCase, ...cases])('shows only the stored category in $path', async item => {
    events = mixedReviews();
    const original = JSON.stringify(events);
    mount(item, `?kind=${kind}&learner=125`);
    if (item.source === 'mcr') fireEvent.click(await screen.findByRole('tab', { name: /Past/ }));
    await waitFor(() => {
      const count = item.source === 'mcr' ? 1 : 2;
      const links = item.source === 'mcr'
        ? within(screen.getByRole('tabpanel')).getAllByRole('link', { name: 'View meeting' }).filter(link => link.hasAttribute('aria-label'))
        : within(screen.getByRole('region', { name: 'All reviews' })).getAllByRole('link', { name: 'View review' });
      expect(links).toHaveLength(count);
      for (const link of links) {
        const index = Number(decodeURIComponent(link.getAttribute('href') || '').match(/A-(\d+)/)?.[1]);
        expect(index).toBeGreaterThanOrEqual(item.source === 'review' ? 0 : item.source === 'mcr' ? 4 : 2);
        expect(index).toBeLessThanOrEqual(item.source === 'review' ? 1 : item.source === 'mcr' ? 4 : 3);
        expect(link).toHaveAttribute('href', expect.stringContaining(`/learner/${item.path}/`));
      }
      expect(JSON.stringify(events)).toBe(original);
    });
  });

  it('opens the ordinary saved review with its answers, attachments and PDF action', async () => {
    events = mixedReviews();
    mount(reviewsCase, `/imported-review%3AA-0?kind=${kind}&learner=125`);
    expect(await screen.findByRole('heading', { name: types[0], level: 1 })).toBeVisible();
    expect(screen.getByText('Synthetic saved answer')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Review evidence' }));
    expect(screen.getByRole('dialog', { name: 'Review evidence' })).toBeVisible();
    expect(screen.getByTitle('Review evidence')).toHaveAttribute('src', 'https://example.invalid/evidence.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Close attachment preview' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Reviews' })).toBeVisible();
    expect(requests.some(url => url.includes('/review-history/') || url.includes('/review/'))).toBe(false);
    expect(bookings).toEqual([]);
  });
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
function mount(item: typeof cases[number] | typeof reviewsCase, suffix = '?kind=apprenticeship&learner=125', view: 'all' | 'current' = 'all') {
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
function openMoreOptions(item: typeof cases[number]) {
  // CoachingHome labels this control "Details" (always shown, expanded inline)
  // for the current-meeting card; every other context keeps "More options".
  const label = item.source === 'mcr' ? 'Details' : 'More options';
  const summary = screen.getByText(label, { selector: 'summary' });
  fireEvent.click(summary);
}

describe.each(cases)('$path programme sessions', item => {
  it.each(['apprenticeship', 'commercial'])('books an unbooked Aptem occurrence for a %s learner from the list', async kind => {
    const target = { ...session(item.source), id: 'imported-review:A-11', eventKey: 'imported-review:A-11',
      reviewSource: 'aptem' as const, reviewId: '11', aptemReviewId: 'A-11', importedReview: {
        id: '11', aptemReviewId: 'A-11', name: 'Planned review', type: item.source === 'mcr' ? 'Monthly Coaching Meeting' : 'Progress Review',
        reviewerName: 'Coach', plannedDate: '2026-10-31', plannedTime: null, completedDate: null,
        status: 'Not Scheduled', extractionStatus: 'complete', detailsAvailable: false, sections: [],
      } };
    const unrelated = { ...target, id: 'imported-review:A-12', eventKey: 'imported-review:A-12', reviewId: '12',
      sequence: 2, importedReview: { ...target.importedReview, id: '12', aptemReviewId: 'A-12' } };
    events = [target, unrelated];
    mount(item, `?kind=${kind}&learner=125`);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Book a time' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: /Book (monthly coaching|progress review)/ });
    const submit = within(dialog).getByRole('button', { name: 'Book session' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: '2026-11-02' } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bookings).toEqual([expect.objectContaining({ reviewId: '11', sessionType: item.source, scheduledDate: '2026-11-02' })]);
    expect(reschedules).toEqual([]);
    expect(events.find(event => event.reviewId === '12')).toEqual(unrelated);
    expect(events.find(event => event.reviewId === '11')).toMatchObject({ calendarEventKey: 'booking:11', status: 'scheduled' });
  });

  it.each(['apprenticeship', 'commercial'])('reschedules the linked Aptem appointment for a %s learner and retains its review identity after refresh', async kind => {
    const importedReview: ImportedReview = {
      id: '11', aptemReviewId: 'A-11', name: 'Imported meeting', type: item.source === 'mcr' ? 'Monthly Coaching Meeting' : 'Progress Review',
      reviewerName: 'Assigned coach', plannedDate: '2026-10-01', plannedTime: '09:00', completedDate: null,
      status: 'scheduled', extractionStatus: 'complete', detailsAvailable: true, sections: [],
    };
    const imported = { ...session(item.source, 1, 'scheduled'), id: 'imported-review:A-11', eventKey: 'imported-review:A-11',
      calendarEventKey: 'imported-review:125:A-11', reviewSource: 'aptem' as const, reviewId: '11', aptemReviewId: 'A-11',
      importedReview, scheduledDate: '2026-10-20', scheduledTime: '09:00', durationMinutes: 90 };
    const unrelated = { ...session(item.source, 2, 'completed') };
    events = [imported, unrelated];
    mount(item, `?kind=${kind}&learner=125`, 'current');
    await screen.findByText(item.source === 'mcr' ? 'Details' : 'More options', { selector: 'summary' });
    if (item.source === 'mcr') openMoreOptions(item);
    fireEvent.click(screen.getByRole('button', { name: item.source === 'mcr' ? 'Reschedule' : 'Reschedule meeting' }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Save new time' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: '2026-10-21' } });
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '14:30' } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(reschedules).toEqual([expect.objectContaining({ eventKey: imported.calendarEventKey, reviewId: '11',
      scheduledDate: '2026-10-21', scheduledTime: '14:30', durationMinutes: 90 })]);
    expect(requests).toContain(`/learner_api/calendar/${kind}/125/reschedule/`);
    expect(bookings).toHaveLength(0);
    expect(events).toContainEqual(unrelated);
    expect(events.find(event => event.reviewId === '11')).toMatchObject({ id: imported.id, eventKey: imported.eventKey, importedReview });
    if (item.source === 'mcr') openMoreOptions(item);
    fireEvent.click(screen.getByRole('button', { name: item.source === 'mcr' ? 'Reschedule' : 'Reschedule meeting' }));
    const refreshed = await screen.findByRole('dialog');
    await waitFor(() => expect(within(refreshed).getByLabelText('Day')).toHaveValue('2026-10-21'));
    expect(within(refreshed).getByLabelText('Time')).toHaveValue('14:30');
  });

  it('uses server-owned Native occurrences without merging the legacy history stream', async () => {
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
    const editedDay = item.source === 'mcr' ? '2026-11-20' : '2026-11-09';
    fireEvent.change(within(dialog).getByLabelText('Day'), { target: { value: editedDay } });
    const readCount = requests.length;
    fireEvent.focus(window);
    await waitFor(() => expect(requests.length).toBeGreaterThan(readCount));
    expect(within(dialog).getByLabelText('Day')).toHaveValue(editedDay);
    bookingError = 'That time overlaps another calendar event. Please choose another time.';
    fireEvent.click(submit);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(bookingError);
    expect(within(dialog).getByLabelText('Day')).toHaveValue(editedDay);
    bookingError = '';
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '13:30' } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bookings.at(-1)).toMatchObject({ scheduledDate: editedDay, scheduledTime: '13:30' });
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
      timezoneOffsetMinutes: 0 })]);
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
    openMoreOptions(item);
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
    const readPath = item.source === 'progress-review' ? '/review-sessions/' : '/calendar/';
    expect(requests.filter(url => url.includes(readPath))).toHaveLength(1);
    if (item.source === 'progress-review') {
      expect(requests.some(url => url.includes('/calendar/'))).toBe(false);
      expect(requests).toContain('/learner_api/review-sessions/apprenticeship/125/?content=summary');
    }
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
      const archive = within(screen.getByRole('region', { name: 'All reviews' }));
      expect(archive.getByText('Scheduled', { exact: true })).toBeVisible();
      expect(archive.getByRole('list')).toHaveTextContent('2 November 2026');
    }
  });

  it('clears previous learner sessions while a different learner loads', async () => {
    events = [session(item.source)]; mount(item);
    await screen.findByRole('button', { name: bookingAction(item) });
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(input => /\/(calendar|review-sessions)\//.test(String(input))
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
  const archive = within(region).getByRole('region', { name: 'All coaching meetings' });
  expect(within(region).getByRole('tab', { name: /Upcoming/ })).toHaveAttribute('aria-selected', 'true');
  expect(within(archive).getAllByRole('listitem')).toHaveLength(2);
  expect(within(region).getByText(/November 2026 coaching/)).toBeVisible();
  fireEvent.click(within(region).getByRole('tab', { name: /Needs your action/ }));
  expect(within(region).getByText(/September 2026 coaching/)).toBeVisible();
  expect(within(archive).getAllByRole('listitem')).toHaveLength(1);
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
  const archive = within(screen.getByRole('region', { name: 'All reviews' }));
  expect(archive.getAllByRole('listitem')).toHaveLength(5);
  fireEvent.click(reviewFilter('Upcoming', 2));
  expect(archive.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Book a time' })).toBeVisible();
  fireEvent.click(reviewFilter('Past', 3));
  expect(archive.getAllByRole('listitem')).toHaveLength(3);
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
