import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { loadRecordingsLibrary, resolveRecordingUrl, type RecordingsLibrary } from '@/api/sessionResults';
import { addDays, todayIso } from '../utils';
import { buildCalendarLectures } from '../model';
import CurriculumRecordingsPage from '../page';

const calendarOverride = vi.hoisted(() => ({ exclude: [] as string[], fail: false, choose: false, unmatched: [] as { title: string; date: string; startTime: string; endTime: string; cancelled: boolean; reason: string }[] }));
vi.mock('@/lib/personalLearning', async () => {
  const actual = await vi.importActual<typeof import('@/lib/personalLearning')>('@/lib/personalLearning');
  return { ...actual, learningFetch: vi.fn(async (input: string) => {
    if (!input.includes('/calendar-matches/')) throw new Error('Unexpected real request in calendar regression test');
    if (calendarOverride.fail) return new Response(JSON.stringify({ error: 'Calendar unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    const params = new URL(input, 'http://localhost').searchParams;
    const value = await vi.mocked(loadRecordingsLibrary).mock.results.at(-1)?.value;
    return new Response(JSON.stringify({ status: calendarOverride.choose && !params.get('mailbox') ? 'choose' : 'verified', start: params.get('start'), end: params.get('end'), timeZone: params.get('timeZone'), mailbox: 'calendar@example.invalid', accounts: ['calendar@example.invalid'],
      matched: (value?.sessions ?? []).filter(item => item.source !== 'authored' && !calendarOverride.exclude.includes(item.occurrenceId)).map(item => ({ moduleId: item.moduleId, occurrenceId: item.occurrenceId, title: item.title })), unmatched: calendarOverride.unmatched }), { headers: { 'Content-Type': 'application/json' } });
  }) };
});

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

const renderPage = async (showAll = true) => {
  render(<MemoryRouter><CurriculumRecordingsPage /></MemoryRouter>);
  if (showAll) {
    fireEvent.change(await screen.findByRole('combobox', { name: 'Filter by recording status' }), { target: { value: 'all' } });
    await screen.findByText(/Calendar events not matched to LMS/);
  }
};

describe('Session recordings calendar', () => {
  beforeEach(() => {
    calendarOverride.exclude = []; calendarOverride.unmatched = []; calendarOverride.fail = false; calendarOverride.choose = false;
    window.localStorage.removeItem('lms-recordings-calendar-account');
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
    await renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Sessions may be missing');
    expect(screen.queryByText('No lectures scheduled')).not.toBeInTheDocument();
  });

  it('refreshes persisted LMS sessions when returning to an old browser tab', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      await renderPage();
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
    await renderPage();
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
    await renderPage();
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
    await renderPage();
    await user.click((await screen.findAllByRole('button', { name: /Intro to analysis/ }))[0]);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again');
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('never offers a download for a recording without a ready saved file', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click((await screen.findAllByRole('button', { name: /Cleaning data/ }))[0]);
    expect(screen.getByRole('complementary', { name: 'Lecture details' })).toHaveTextContent('A saved archive copy has not been confirmed');
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
  });

  it('opens a lecture from the title search', async () => {
    const user = userEvent.setup();
    await renderPage();
    await screen.findAllByRole('button', { name: /Intro to analysis/ });
    await user.type(screen.getByRole('textbox', { name: 'Search lectures by title' }), 'Cleaning');
    await user.click(screen.getAllByRole('button', { name: /Cleaning data/ })[0]);
    expect(screen.getByRole('complementary', { name: 'Lecture details' })).toHaveTextContent('Cleaning data');
  });

  it('keeps modules without booked lectures in the LMS directory', async () => {
    const user = userEvent.setup();
    await renderPage();
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
    await renderPage();
    await screen.findAllByRole('button', { name: /Intro to analysis/ });
    // Day is the default; keep this scenario explicit about day navigation.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Calendar view' }), 'day');
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
    await renderPage();
    await screen.findAllByRole('button', { name: /Intro to analysis/ });
    // Day is the default; keep this scenario explicit about day navigation.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Calendar view' }), 'day');
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
    await renderPage(false);
    expect(await screen.findByRole('alert')).toHaveTextContent('Library unavailable');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Intro to analysis/ }).length).toBeGreaterThan(0));
  });
  it('keeps ended lectures inside the selected day or week, independent of saved recordings', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('lms-recordings-calendar-zone', 'UTC');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(at(12)));
    try {
      vi.mocked(loadRecordingsLibrary).mockResolvedValue({ ...library, deliveries: [], sessions: [
        ...library.sessions!, { ...library.sessions![0], occurrenceId: 'OLD', title: 'Older lecture',
          startsAt: `${addDays(date, -14)}T09:00:00Z`, endsAt: `${addDays(date, -14)}T11:00:00Z` },
      ] });
      await renderPage();
      await user.click(await screen.findByRole('button', { name: 'Ended (1)' }));
      expect(screen.getByRole('button', { name: /Intro to analysis/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Cleaning data|Older lecture/ })).not.toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'All dates' })).toBeDisabled();
      await user.selectOptions(screen.getByRole('combobox', { name: 'Calendar view' }), 'day');
      expect(screen.getByRole('button', { name: /Intro to analysis/ })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Next day' }));
      expect(screen.queryByRole('button', { name: /Intro to analysis/ })).not.toBeInTheDocument();
    } finally { clock.mockRestore(); }
  });

  it('searches the selected period by default and shows all matches across dates on request', async () => {
    const user = userEvent.setup();
    vi.mocked(loadRecordingsLibrary).mockResolvedValue({ ...library, deliveries: [], sessions: Array.from({ length: 10 }, (_, index) => ({
      ...library.sessions![0], occurrenceId: `F${index}`, title: `Remote seminar ${index}`,
      startsAt: `${addDays(date, 14)}T09:00:00Z`, endsAt: `${addDays(date, 14)}T11:00:00Z`,
    })) });
    await renderPage();
    await screen.findByRole('button', { name: 'All lectures (0)' });
    await user.type(screen.getByRole('textbox', { name: 'Search lectures by title' }), 'remote');
    expect(screen.queryByRole('button', { name: /Remote seminar/ })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Search date scope' }), 'all');
    expect(screen.getAllByRole('button', { name: /Remote seminar/ })).toHaveLength(10);
    expect(screen.getByText(/10 lectures across all dates/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Remote seminar 9/ }));
    expect(screen.getByRole('complementary', { name: 'Lecture details' })).toHaveTextContent('Remote seminar 9');
  });

  it('narrows dependent group and module choices and clears child filters when programme changes', async () => {
    const user = userEvent.setup();
    vi.mocked(loadRecordingsLibrary).mockResolvedValue({ ...library, sessions: [...library.sessions!, {
      ...library.sessions![0], occurrenceId: 'OTHER', moduleId: 'M2', moduleTitle: 'Leadership', title: 'Other programme lecture',
      programme: 'Level 5', cohort: 'Other cohort', group: 'Group B',
    }] });
    await renderPage();
    await screen.findAllByRole('button', { name: /Intro to analysis/ });
    await user.click(screen.getByText('More filters (0)'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by programme' }), 'Level 4');
    expect(screen.getByRole('combobox', { name: 'Filter by group' })).not.toHaveTextContent('Group B');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by group' }), 'Group A');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by module' }), 'M1');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by programme' }), 'Level 5');
    expect(screen.getByRole('combobox', { name: 'Filter by group' })).toHaveValue('all');
    expect(screen.getByRole('combobox', { name: 'Filter by module' })).toHaveValue('all');
    expect(screen.getByRole('button', { name: /Other programme lecture/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Intro to analysis/ })).not.toBeInTheDocument();
  });

  it('uses one Teams-style view selector and moves work weeks by seven calendar days', async () => {
    const user = userEvent.setup();
    await renderPage();
    await screen.findAllByRole('button', { name: /Intro to analysis/ });
    const view = screen.getByRole('combobox', { name: 'Calendar view' });
    expect(view).toHaveValue('day');
    expect(screen.getByRole('complementary', { name: 'Choose lecture date' })).toBeInTheDocument();
    await user.selectOptions(view, 'workWeek');
    expect(view).toHaveValue('workWeek');
    expect(screen.getByText('work week agenda')).toBeInTheDocument();
    const previous = screen.getByRole('heading', { level: 2 }).textContent;
    await user.click(screen.getByRole('button', { name: 'Next work week' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).not.toBe(previous);
    await user.click(screen.getByRole('button', { name: 'Previous work week' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(previous);
  });

  it('selecting a mini-calendar date switches Week to Day', async () => {
    const user = userEvent.setup(); await renderPage();
    await screen.findAllByRole('button', { name: /Intro to analysis/ });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Calendar view' }), 'week');
    expect(screen.getByRole('combobox', { name: 'Calendar view' })).toHaveValue('week');
    const sidebar = screen.getByRole('complementary', { name: 'Choose lecture date' });
    await user.click(within(sidebar).getByRole('button', { name: `Select ${date}` }));
    expect(screen.getByRole('combobox', { name: 'Calendar view' })).toHaveValue('day');
    expect(screen.getByText('day agenda')).toBeInTheDocument();
  });

  it('does not attach another-day recording to the planned lecture even if the placement flag is missing', () => {
    const recording = library.deliveries[0].weeks[0].recordings[0];
    const sample = { ...library, deliveries: [{ ...library.deliveries[0], weeks: [{ ...library.deliveries[0].weeks[0], recordings: [
      { ...recording, recordedAt: `${addDays(date, -1)}T09:00:00Z`, endsAt: `${addDays(date, -1)}T10:00:00Z`, placementReview: false },
    ] }] }] };
    const lectures = buildCalendarLectures(sample, 'UTC').lectures;
    expect(lectures.find(item => item.id === 'M1:O1')?.recordings).toHaveLength(0);
    expect(lectures.find(item => item.source === 'recording-review')?.date).toBe(addDays(date, -1));
  });

  it('defaults to ready downloads and switching status uses one active filter with matching counts', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('lms-recordings-calendar-zone', 'UTC');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(at(12)));
    try {
      await renderPage(false);
      expect(await screen.findByRole('button', { name: 'Ready to download (1)' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: /Intro to analysis/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Cleaning data/ })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Not ended (1)' }));
      expect(screen.getByRole('button', { name: /Cleaning data/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Intro to analysis/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Ready to download (1)' })).toHaveAttribute('aria-pressed', 'false');
      await user.click(screen.getByRole('button', { name: 'Ended (1)' }));
      expect(screen.getByRole('combobox', { name: 'Filter by recording status' })).toHaveValue('all');
      expect(screen.getByRole('button', { name: /Intro to analysis/ })).toBeInTheDocument();
      expect(screen.getByText('1 lectures in selected day')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'All lectures (2)' }));
      expect(screen.getByRole('button', { name: /Cleaning data/ })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Lecture status' }).querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    } finally { clock.mockRestore(); }
  });
  it('recomputes filter counts and rows for the selected day without retaining a hidden recording filter', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('lms-recordings-calendar-zone', 'UTC');
    vi.mocked(loadRecordingsLibrary).mockResolvedValue({ ...library, sessions: [...library.sessions!, {
      ...library.sessions![0], occurrenceId: 'TOMORROW', title: 'Tomorrow lecture', startsAt: `${addDays(date, 1)}T09:00:00Z`, endsAt: `${addDays(date, 1)}T10:00:00Z`,
    }] });
    await renderPage(false);
    await screen.findByRole('button', { name: 'Ready to download (1)' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Calendar view' }), 'day');
    await user.click(screen.getByRole('button', { name: 'Next day' }));
    expect(screen.getByRole('button', { name: 'Ready to download (0)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /Tomorrow lecture/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Not ended (1)' }));
    expect(screen.getByRole('button', { name: /Tomorrow lecture/ })).toBeInTheDocument();
    expect(screen.getByText('1 lectures in selected day')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All lectures (1)' })).toBeInTheDocument();
  });

  it('Ended includes finished lectures without a ready file and its count matches the rows', async () => {
    const user = userEvent.setup(); window.localStorage.setItem('lms-recordings-calendar-zone', 'UTC');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(at(16)));
    try {
      await renderPage(false);
      await user.click(await screen.findByRole('button', { name: 'Ended (2)' }));
      expect(screen.getByRole('button', { name: /Intro to analysis/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Cleaning data/ })).toBeInTheDocument();
      expect(screen.getByText('2 lectures in selected day')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Ready to download (1)' })).toHaveAttribute('aria-pressed', 'false');
      await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by recording status' }), 'ready');
      expect(screen.getByRole('button', { name: 'Ended (2)' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByRole('button', { name: /Cleaning data/ })).not.toBeInTheDocument();
    } finally { clock.mockRestore(); }
  });

  it('defaults to the selected day, excluding earlier days from every status count and the calendar', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('lms-recordings-calendar-zone', 'UTC');
    vi.mocked(loadRecordingsLibrary).mockResolvedValue({ ...library, deliveries: [], sessions: [
      ...library.sessions!, ...[1, 2].map(offset => ({ ...library.sessions![0], occurrenceId: `PAST${offset}`, title: `Earlier day ${offset}`,
        startsAt: `${addDays(date, -offset)}T09:00:00Z`, endsAt: `${addDays(date, -offset)}T10:00:00Z` })),
    ] });
    await renderPage();
    expect(screen.getByRole('combobox', { name: 'Calendar view' })).toHaveValue('day');
    expect(screen.getByRole('button', { name: 'All lectures (2)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /Earlier day/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Hourly lecture calendar' })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Calendar view' }), 'week');
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('combobox', { name: 'Calendar view' })).toHaveValue('day');
    expect(screen.queryByRole('button', { name: /Earlier day/ })).not.toBeInTheDocument();
  });

  it('selecting a date cancels an all-dates search and restores day-scoped counts and results', async () => {
    const user = userEvent.setup(); window.localStorage.setItem('lms-recordings-calendar-zone', 'UTC');
    vi.mocked(loadRecordingsLibrary).mockResolvedValue({ ...library, deliveries: [], sessions: [
      ...library.sessions!, { ...library.sessions![0], occurrenceId: 'REMOTE', title: 'Intro on another day',
        startsAt: `${addDays(date, -2)}T09:00:00Z`, endsAt: `${addDays(date, -2)}T10:00:00Z` },
    ] });
    await renderPage();
    await user.type(screen.getByRole('textbox', { name: 'Search lectures by title' }), 'Intro');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Search date scope' }), 'all');
    expect(screen.getByRole('button', { name: /Intro on another day/ })).toBeInTheDocument();
    await user.click(within(screen.getByRole('complementary', { name: 'Choose lecture date' })).getByRole('button', { name: `Select ${date}` }));
    expect(screen.getByRole('combobox', { name: 'Search date scope' })).toHaveValue('period');
    expect(screen.getByRole('button', { name: 'All lectures (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Intro on another day/ })).not.toBeInTheDocument();
  });

  it('opens attendance inside the selected event details and expands the calendar without changing filters', async () => {
    const user = userEvent.setup(); await renderPage();
    await screen.findByRole('button', { name: /Intro to analysis/ });
    expect(screen.queryByRole('button', { name: 'View attendance & saved files' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /Intro to analysis/ }));
    expect(within(screen.getByRole('complementary', { name: 'Lecture details' })).getByRole('button', { name: 'View attendance & saved files' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close details panel' }));
    expect(screen.getByRole('button', { name: 'All lectures (2)' })).toHaveAttribute('aria-pressed', 'true');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lecture filter' }), 'ready');
    expect(screen.queryByRole('button', { name: /Cleaning data/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ready to download (1)' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Full screen' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('includes linked meetings absent from the selected calendar but excludes unbooked plans', async () => {
    const user = userEvent.setup();
    calendarOverride.exclude = ['O2'];
    calendarOverride.unmatched = [{ title: 'Unlinked Portfolio', date, startTime: '11:00', endTime: '13:00', cancelled: false, reason: 'This Teams meeting is not linked to an LMS module.' }];
    vi.mocked(loadRecordingsLibrary).mockResolvedValue({ ...library, sessions: [...library.sessions!, {
      ...library.sessions![0], occurrenceId: 'authored:PLAN', title: 'Unbooked duplicate plan', source: 'authored', status: 'planned',
    }] });
    await renderPage();
    expect(screen.getByRole('button', { name: 'All lectures (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Intro to analysis/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cleaning data/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unbooked duplicate plan/ })).not.toBeInTheDocument();
    await user.click(screen.getByText('Calendar events not matched to LMS (1)'));
    expect(screen.getByText('Unlinked Portfolio')).toBeInTheDocument();
    expect(screen.getByText('This Teams meeting is not linked to an LMS module.')).toBeInTheDocument();
  });

  it('keeps linked LMS sessions available when the optional calendar comparison fails', async () => {
    calendarOverride.fail = true; await renderPage(false);
    expect(await screen.findByRole('alert')).toHaveTextContent('Calendar unavailable');
    expect(await screen.findByRole('button', { name: /Intro to analysis/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ready to download (1)' })).toBeEnabled();
    calendarOverride.fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry calendar comparison' }));
    expect(await screen.findByRole('button', { name: /Intro to analysis/ })).toBeInTheDocument();
  });

  it('shows linked LMS sessions before choosing a comparison calendar and retains Ready after choosing', async () => {
    const user = userEvent.setup(); calendarOverride.choose = true;
    await renderPage(false);
    const account = await screen.findByRole('combobox', { name: 'Teams calendar account' });
    expect(await screen.findByRole('button', { name: /Intro to analysis/ })).toBeInTheDocument();
    await user.selectOptions(account, 'calendar@example.invalid');
    expect(await screen.findByRole('button', { name: /Intro to analysis/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ready to download (1)' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('lms-recordings-calendar-account')).toBe('calendar@example.invalid');
  });

});
