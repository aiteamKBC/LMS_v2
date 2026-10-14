import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { loadRecordingsLibrary, resolveRecordingUrl, type RecordingsLibrary } from '@/api/sessionResults';
import { addDays, todayIso } from '../utils';
import { buildCalendarLectures } from '../model';
import CurriculumRecordingsPage from '../page';

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/feature/SessionRecordingPlayer', () => ({
  SessionRecordingPlayer: ({ label }: { label: string }) => <div data-testid="player">{label}</div>,
}));
vi.mock('@/api/sessionResults', async () => {
  const actual = await vi.importActual<typeof import('@/api/sessionResults')>('@/api/sessionResults');
  return { ...actual, loadRecordingsLibrary: vi.fn(), resolveRecordingUrl: vi.fn() };
});

const date = todayIso();
const at = (hour: number) => `${date}T${String(hour).padStart(2, '0')}:00:00Z`;
const library: RecordingsLibrary = {
  recordingCount: 2, attentionChecked: true,
  modules: [
    { moduleId: 'M1', title: 'Data Analysis', programme: 'Level 4', cohort: 'Sep 26', group: 'Group A', archived: false, programmeActive: true },
    { moduleId: 'M2', title: 'Leadership', programme: 'Level 4', cohort: 'Sep 26', group: 'Group B', archived: false, programmeActive: true },
  ],
  sessions: [
    { occurrenceId: 'O1', moduleId: 'M1', title: 'Intro to analysis', moduleTitle: 'Data Analysis',
      programme: 'Level 4', programmeActive: true, cohort: 'Sep 26', group: 'Group A',
      weekId: 'W1', weekNumber: 1, weekTitle: 'Introduction', sessionNumber: 1, startsAt: at(9), endsAt: at(11) },
    { occurrenceId: 'O2', moduleId: 'M1', title: 'Cleaning data', moduleTitle: 'Data Analysis',
      programme: 'Level 4', programmeActive: true, cohort: 'Sep 26', group: 'Group A',
      weekId: 'W2', weekNumber: 2, weekTitle: 'Cleaning', sessionNumber: 2, startsAt: at(13), endsAt: at(15) },
  ],
  deliveries: [{ moduleId: 'M1', title: 'Data Analysis', programme: 'Level 4', programmeActive: true,
    archived: false, cohort: 'Sep 26', group: 'Group A', recordingCount: 2, attention: [],
    weeks: [
      { weekId: 'W1', weekNumber: 1, title: 'Introduction', recordings: [
        { id: 'R1', seriesId: 'S1', occurrenceId: 'O1', sessionNumber: 1, startsAt: at(9), recordedAt: at(9), endsAt: at(11),
          state: 'ready', status: 'available', duplicateCount: 0, hiddenFromLearners: false },
      ] },
      { weekId: 'W2', weekNumber: 2, title: 'Cleaning', recordings: [
        { id: 'R2', seriesId: 'S1', occurrenceId: 'O2', sessionNumber: 2, startsAt: at(13), recordedAt: at(13), endsAt: at(15),
          state: 'pending', status: 'verificationRequired', duplicateCount: 0, hiddenFromLearners: false },
      ] },
    ] }],
};

const renderPage = () => render(<MemoryRouter><CurriculumRecordingsPage /></MemoryRouter>);

describe('Session recordings calendar', () => {
  beforeEach(() => {
    window.localStorage.removeItem('lms-recordings-calendar-zone');
    vi.mocked(loadRecordingsLibrary).mockReset().mockResolvedValue(library);
    vi.mocked(resolveRecordingUrl).mockReset().mockResolvedValue('https://storage.invalid/inline-video');
  });

  it('converts the same UTC lecture across Cairo and London including the date boundary and daylight saving', () => {
    const sample = { ...library, deliveries: [], sessions: [{ ...(library.sessions ?? [])[0],
      startsAt: '2026-07-01T23:30:00Z', endsAt: '2026-07-02T00:30:00Z' }] };
    const cairo = buildCalendarLectures(sample, 'Africa/Cairo').lectures[0];
    const london = buildCalendarLectures(sample, 'Europe/London').lectures[0];
    expect([cairo.date, cairo.startTime]).toEqual(['2026-07-02', '02:30']);
    expect([london.date, london.startTime]).toEqual(['2026-07-02', '00:30']);
    const october = { ...sample, sessions: [{ ...sample.sessions[0],
      startsAt: '2026-10-14T08:00:00Z', endsAt: '2026-10-14T10:00:00Z' }] };
    expect(buildCalendarLectures(october, 'Africa/Cairo').lectures[0].startTime).toBe('11:00');
    expect(buildCalendarLectures(october, 'Europe/London').lectures[0].startTime).toBe('09:00');
    const spring = { ...sample, sessions: [{ ...sample.sessions[0],
      startsAt: '2026-04-01T08:00:00Z', endsAt: '2026-04-01T09:00:00Z' }] };
    expect(buildCalendarLectures(spring, 'Africa/Cairo').lectures[0].startTime).toBe('10:00');
    expect(buildCalendarLectures(spring, 'Europe/London').lectures[0].startTime).toBe('09:00');
    const winter = { ...sample, sessions: [{ ...sample.sessions[0],
      startsAt: '2026-12-01T09:00:00Z', endsAt: '2026-12-01T10:00:00Z' }] };
    expect(buildCalendarLectures(winter, 'Africa/Cairo').lectures[0].startTime).toBe('11:00');
    expect(buildCalendarLectures(winter, 'Europe/London').lectures[0].startTime).toBe('09:00');
  });

  it('shows an early Teams run on its recorded day for review without confirming the planned lecture', () => {
    const saved = (library.deliveries[0].weeks[0].recordings[0]);
    const sample: RecordingsLibrary = {
      ...library,
      sessions: [{ ...library.sessions![0], startsAt: '2026-10-14T08:00:00Z', endsAt: '2026-10-14T10:00:00Z' }],
      deliveries: [{ ...library.deliveries[0], weeks: [{ ...library.deliveries[0].weeks[0], recordings: [
        { ...saved, startsAt: '2026-10-14T08:00:00Z', recordedAt: '2026-10-12T09:00:00Z',
          endsAt: '2026-10-12T09:30:00Z', placementReview: true },
      ] }] }],
    };
    const { lectures } = buildCalendarLectures(sample, 'Europe/London');
    const planned = lectures.find(item => item.date === '2026-10-14');
    const review = lectures.find(item => item.date === '2026-10-12');
    expect(planned?.recordings).toHaveLength(0);
    expect(review?.source).toBe('recording-review');
    expect(review?.status).toBe('review');
    expect(review?.recordings[0].status).toBe('ready');
  });

  it('shows a calendar read failure instead of treating it as an empty day', async () => {
    vi.mocked(loadRecordingsLibrary).mockResolvedValue({ ...library, sessions: [], calendarAvailable: false });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Sessions may be missing');
    expect(screen.queryByText('No lectures scheduled')).not.toBeInTheDocument();
  });

  it('refreshes persisted LMS sessions when returning to an old browser tab', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      renderPage();
      await screen.findAllByRole('button', { name: /Intro to analysis/ });
      expect(loadRecordingsLibrary).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(32000);
      fireEvent.focus(window);
      await waitFor(() => expect(loadRecordingsLibrary).toHaveBeenCalledTimes(2));
    } finally {
      clock.mockRestore();
    }
  });

  it('shows authored lecture titles and resolves the private playback URL', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findAllByRole('button', { name: /Intro to analysis/ })).not.toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /Cleaning data/ })).not.toHaveLength(0);
    await user.click(screen.getAllByRole('button', { name: /Intro to analysis/ })[0]);
    expect(screen.getByRole('complementary', { name: 'Lecture details' })).toHaveTextContent('Introduction');
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(resolveRecordingUrl).toHaveBeenCalledWith('S1', 'R1', false, expect.any(AbortSignal)));
    expect(await screen.findByTestId('player')).toHaveTextContent('Intro to analysis');
  });

  it('resolves download after authentication and never navigates to a JSON 401', async () => {
    const user = userEvent.setup();
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.href);
    });
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: /Intro to analysis/ }))[0]);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(resolveRecordingUrl).toHaveBeenCalledWith('S1', 'R1', true));
    await waitFor(() => expect(clicked).toEqual(['https://storage.invalid/inline-video']));
    click.mockRestore();
  });

  it('explains expired login instead of opening the 401 response', async () => {
    const user = userEvent.setup();
    vi.mocked(resolveRecordingUrl).mockRejectedValue(new Error('Your session has expired. Sign in again to play or download this recording.'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: /Intro to analysis/ }))[0]);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again');
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('never offers a download for a recording without a ready saved file', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: /Cleaning data/ }))[0]);
    expect(screen.getByRole('complementary', { name: 'Lecture details' })).toHaveTextContent('A saved archive copy has not been confirmed');
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
  });

  it('opens a lecture from the title search', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByRole('button', { name: /Intro to analysis/ });
    await user.type(screen.getByRole('textbox', { name: 'Search lectures by title' }), 'Cleaning');
    await user.click(screen.getAllByRole('button', { name: /Cleaning data/ })[0]);
    expect(screen.getByRole('complementary', { name: 'Lecture details' })).toHaveTextContent('Cleaning data');
  });

  it('keeps modules without booked lectures in the LMS directory', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'All LMS modules (2)' }));
    expect(screen.getByRole('region', { name: 'All LMS modules' })).toHaveTextContent('2 of 2 modules');
    await user.click(screen.getByText('Leadership'));
    expect(screen.getByText(/No dated lecture is saved for this module/)).toBeInTheDocument();
  });

  it('shows a scheduled lecture without inventing a recording or download', async () => {
    const user = userEvent.setup();
    const tomorrow = addDays(date, 1);
    vi.mocked(loadRecordingsLibrary).mockResolvedValue({ ...library, sessions: [...(library.sessions ?? []), {
      occurrenceId: 'O3', moduleId: 'M3', title: 'Future seminar', moduleTitle: 'Planning',
      programme: 'Level 4', programmeActive: true, cohort: 'Sep 26', group: 'Group A',
      weekId: null, weekNumber: null, weekTitle: '', sessionNumber: 3,
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/future',
      startsAt: `${tomorrow}T09:00:00Z`, endsAt: `${tomorrow}T10:00:00Z`,
    }] });
    renderPage();
    await screen.findAllByRole('button', { name: /Intro to analysis/ });
    await user.click(screen.getAllByRole('button', { name: 'Next day' })[0]);
    await user.click(screen.getAllByRole('button', { name: /Future seminar/ })[0]);
    expect(screen.getByRole('complementary', { name: 'Lecture details' })).toHaveTextContent('This lecture has not started yet');
    expect(screen.getByRole('link', { name: 'Open Teams meeting' })).toHaveAttribute('href', 'https://teams.microsoft.com/l/meetup-join/future');
    expect(screen.getByRole('complementary', { name: 'Lecture details' })).not.toHaveTextContent('Not matched to a week');
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
  });

  it('shows an LMS meeting without a week component using its saved title', async () => {
    const user = userEvent.setup();
    const tomorrow = addDays(date, 1);
    vi.mocked(loadRecordingsLibrary).mockResolvedValue({ ...library, sessions: [...(library.sessions ?? []), {
      occurrenceId: 'O4', moduleId: 'M4', title: 'Marketing Strategy', moduleTitle: 'Marketing Strategy',
      programme: 'Level 4', programmeActive: true, cohort: 'Sep 26', group: 'Group A',
      weekId: null, weekNumber: null, weekTitle: '', sessionNumber: 5,
      startsAt: `${tomorrow}T11:00:00Z`, endsAt: `${tomorrow}T13:00:00Z`,
    }] });
    renderPage();
    await screen.findAllByRole('button', { name: /Intro to analysis/ });
    await user.click(screen.getAllByRole('button', { name: 'Next day' })[0]);
    await user.click(screen.getAllByRole('button', { name: /Marketing Strategy/ })[0]);
    expect(screen.getByRole('complementary', { name: 'Lecture details' })).toHaveTextContent('Marketing Strategy');
    expect(screen.getByRole('complementary', { name: 'Lecture details' })).not.toHaveTextContent('Week 5');
  });

  it('distinguishes a running meeting from a cancelled future meeting', () => {
    const now = Date.now();
    const base = library.sessions![0];
    const { lectures } = buildCalendarLectures({ ...library, deliveries: [], sessions: [
      { ...base, occurrenceId: 'LIVE', startsAt: new Date(now - 5 * 60000).toISOString(),
        endsAt: new Date(now + 5 * 60000).toISOString(), status: 'scheduled' },
      { ...base, occurrenceId: 'CANCELLED', startsAt: new Date(now + 60 * 60000).toISOString(),
        endsAt: new Date(now + 120 * 60000).toISOString(), status: 'cancelled',
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/cancelled' },
    ] });
    expect(lectures.find(item => item.id.endsWith(':LIVE'))?.status).toBe('inProgress');
    expect(lectures.find(item => item.id.endsWith(':CANCELLED'))).toMatchObject({ status: 'cancelled', joinUrl: undefined });
  });

  it('keeps an authored LMS slot distinct from a confirmed Teams meeting', () => {
    const base = library.sessions![0];
    const planned = { ...base, occurrenceId: 'authored:C1', source: 'authored' as const,
      status: 'planned', joinUrl: 'https://teams.microsoft.com/inherited' };
    const { lectures } = buildCalendarLectures({ ...library, deliveries: [], sessions: [planned] });
    expect(lectures).toHaveLength(1);
    expect(lectures[0]).toMatchObject({ status: 'planned', source: 'authored', joinUrl: undefined, recordings: [] });
  });

  it('shows a load error and retries the authenticated library request', async () => {
    const user = userEvent.setup();
    vi.mocked(loadRecordingsLibrary).mockRejectedValueOnce(new Error('Library unavailable'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Library unavailable');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Intro to analysis/ }).length).toBeGreaterThan(0));
  });
});
