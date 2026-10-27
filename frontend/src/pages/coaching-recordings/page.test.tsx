import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { loadCoachingCalendar, loadCoachingSession, loadSavedCoachingEvidence, loadCoachLearners, type CoachingCalendar, type CoachingSessionDetails } from '@/api/coachingRecordings';
import CoachingRecordingsPage from './page';
import { filterMeetings, hasPlayableRecording, meetingDate, meetingPhase } from './model';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/api/coachingRecordings', async () => ({
  ...await vi.importActual<typeof import('@/api/coachingRecordings')>('@/api/coachingRecordings'),
  loadCoachingCalendar: vi.fn(), loadCoachingSession: vi.fn(), loadSavedCoachingEvidence: vi.fn(), loadCoachLearners: vi.fn(),
}));

const fixture = (): CoachingCalendar => ({
  start: '2026-10-01', end: '2026-10-31', timeZone: 'UTC', scope: 'all', partial: false, errors: [],
  coaches: [{ email: 'one@example.invalid', name: 'Coach One' }, { email: 'two@example.invalid', name: 'Coach Two' }],
  learners: [{ id: '1', name: 'Learner One', coachEmail: 'one@example.invalid', learnerType: 'apprenticeship' },
    { id: '2', name: 'Learner Two', coachEmail: 'two@example.invalid', learnerType: 'commercial' }],
  meetings: [
    { calendarEventId: 'one', coachEmail: 'one@example.invalid', eventKey: 'mcr:1', candidateEventKeys: [], learnerIds: ['1'], family: 'MCM',
      startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T10:00:00Z', phase: 'ended', match: 'matched', readyToAction: true,
      media: { state: 'ready', readyCount: 1, recordings: [{ id: 'file/one+', state: 'ready' }] } },
    { calendarEventId: 'two', coachEmail: 'two@example.invalid', eventKey: 'pr:2', candidateEventKeys: [], learnerIds: ['2'], family: 'PR',
      startsAt: '2026-10-20T15:00:00Z', endsAt: '2026-10-20T16:00:00Z', phase: 'upcoming', match: 'mismatch', readyToAction: false,
      media: { state: 'pending', readyCount: 0, recordings: [] } },
  ], lmsOnly: [], cancelledBookings: [], coverage: { checkedCoachEmails: ['one@example.invalid', 'two@example.invalid'], totalCoaches: 2, nextOffset: null },
});
const mount = (workspace: 'coach' | 'curriculum' = 'curriculum') => render(<MemoryRouter><CoachingRecordingsPage workspace={workspace} /></MemoryRouter>);
const details = (): CoachingSessionDetails => ({ eventKey: 'mcr:1', media: fixture().meetings[0].media, partial: false,
  attendance: { state: 'available', reportCount: 1, rows: [{ name: 'Verified Participant', status: 'attended', role: 'learner', totalAttendanceSeconds: 600 }] } });

describe('Coaching recordings calendar', () => {
  it('keeps ended MCM, PR, Support and Other ready regardless of native booking or AI availability', async () => {
    const data = fixture();
    data.meetings = (['MCM', 'PR', 'SUPPORT', 'OTHER', 'LECTURE'] as const).map((category, index) => ({ ...data.meetings[0], category,
      calendarEventId: `ready-${index}`, title: `Ready ${category} appointment`, family: null, eventKey: null,
      match: 'external', recordingsReference: `signed-${index}` }));
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data);
    mount();
    for (const category of ['MCM', 'PR', 'SUPPORT', 'OTHER', 'LECTURE']) {
      expect(await screen.findByRole('button', { name: `View Ready ${category} appointment on 2026-10-20` })).toBeInTheDocument();
    }
    expect(loadCoachingCalendar).toHaveBeenCalledOnce();
    expect(loadCoachingSession).not.toHaveBeenCalled();
    expect(loadSavedCoachingEvidence).not.toHaveBeenCalled();
  });
  it('shows all ended meetings with separate empty, failed and no-Teams states, without extra reads', async () => {
    const data = fixture();
    const original = data.meetings[0];
    data.meetings.push(
      { ...original, calendarEventId: 'empty', title: 'No returned video', media: { state: 'pending', readyCount: 0, recordings: [], check: { state: 'complete', checkedAt: '2026-10-20T11:00:00Z', reason: 'no-recordings-returned' } } },
      { ...original, calendarEventId: 'offline', title: 'Failed recording check', media: { state: 'unavailable', readyCount: 0, recordings: [], check: { state: 'failed', checkedAt: null } } },
      { ...original, calendarEventId: 'leave', title: 'Calendar appointment', media: { state: 'pending', readyCount: 0, recordings: [], check: { state: 'complete', checkedAt: '2026-10-20T11:00:00Z', reason: 'no-teams-link' } } },
    );
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data);
    mount();
    const notice = within(await screen.findByRole('region', { name: 'Ready to action summary' }));
    expect(notice.getByText('4 ended meetings · 1 with playable recordings')).toBeInTheDocument();
    for (const label of ['1 · Recording available', '1 · No recording returned at last check', '1 · Recording check failed', '1 · No Teams link on this calendar entry']) {
      expect(notice.getByText(label)).toBeInTheDocument();
    }
    for (const title of ['No returned video', 'Failed recording check', 'Calendar appointment']) {
      expect(screen.getByRole('button', { name: `View ${title} on 2026-10-20` })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'View Progress Review on 2026-10-20' })).not.toBeInTheDocument();
    fireEvent.click(notice.getByRole('button', { name: 'Show all loaded meetings' }));
    expect(screen.getByRole('button', { name: 'View Progress Review on 2026-10-20' })).toBeInTheDocument();
    expect(loadCoachingCalendar).toHaveBeenCalledOnce();
    expect(loadSavedCoachingEvidence).not.toHaveBeenCalled();
    expect(loadCoachingSession).not.toHaveBeenCalled();
  });
  it.each(['MCM', 'PR', 'OTHER'] as const)('passes the %s meeting category into the evidence drawer while keeping transcript lookup available', async category => {
    const data = fixture();
    data.meetings[0] = { ...data.meetings[0], category, title: 'Synthetic calendar meeting', recordingsReference: 'signed-reference' };
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data);
    vi.mocked(loadSavedCoachingEvidence).mockResolvedValue({ state: 'matched', source: 'coaching-session', transcript: null, analyses: [],
      transcriptCheck: { state: 'missing', code: 'no_transcript' } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^View Synthetic calendar meeting on / }));
    const drawer = within(screen.getByRole('dialog', { name: 'Meeting details' }));
    await drawer.findByText('Verified Participant');
    expect(loadSavedCoachingEvidence).not.toHaveBeenCalled();
    if (category === 'OTHER') {
      expect(drawer.getByText('MCM & PR only')).toBeInTheDocument();
      expect(drawer.queryByRole('button', { name: 'AI analysis' })).not.toBeInTheDocument();
    } else expect(drawer.getByRole('button', { name: 'AI analysis' })).toBeInTheDocument();
    fireEvent.click(drawer.getByRole('button', { name: 'Transcript' }));
    expect(await drawer.findByText(/Microsoft has not published a transcript/)).toBeInTheDocument();
    expect(loadSavedCoachingEvidence).toHaveBeenCalledWith('mcr:1', expect.any(AbortSignal), 'signed-reference', true);
    expect(loadCoachingCalendar).toHaveBeenCalledOnce();
    expect(loadCoachingSession).toHaveBeenCalledOnce();
  });
  it('keeps every meeting category in All meetings and organises MCM and PR first without extra requests', async () => {
    const data = fixture();
    data.meetings[0] = { ...data.meetings[0], title: 'Monthly coaching appointment', category: 'MCM' };
    data.meetings[1] = { ...data.meetings[1], title: 'Progress review appointment', category: 'PR' };
    const base = data.meetings[0];
    data.meetings.push(
      { ...base, calendarEventId: 'support', eventKey: null, title: 'Learner support appointment', category: 'SUPPORT', family: null,
        match: 'external', recordingsReference: 'support-reference' },
      { ...base, calendarEventId: 'planning', eventKey: null, title: 'Team planning appointment', category: 'OTHER', family: null,
        learnerIds: [], match: 'external', readyToAction: false, media: { state: 'pending', readyCount: 0, recordings: [] } },
      { ...data.meetings[1], calendarEventId: 'catchup', eventKey: null, title: 'Catch-up appointment', category: 'OTHER', family: null,
        learnerIds: [], match: 'external' },
      { ...base, calendarEventId: 'lecture', eventKey: null, title: 'Subject lecture appointment', category: 'LECTURE', family: null },
    );
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data);
    mount();
    await screen.findByRole('button', { name: /^View Monthly coaching appointment on / });
    expect(screen.getByRole('button', { name: 'Ready to action' })).toHaveAttribute('aria-pressed', 'true');
    const types = screen.getByRole('combobox', { name: 'Meeting type' });
    expect(types).toHaveValue('all');
    expect(within(types).getAllByRole('option').map(option => option.textContent)).toEqual([
      'All types', 'MCM', 'PR (Progress Review)', 'Student Support', 'Other', 'Lectures / subjects',
    ]);
    expect(within(types).getByRole('group', { name: 'MCM & PR' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All meetings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide lectures / subjects' }));
    const calendar = within(screen.getByRole('region', { name: 'Coach meeting calendar' }));
    const titles = data.meetings.slice(0, 5).map(row => row.title!);
    for (const title of titles) expect(calendar.getByRole('button', { name: `View ${title} on 2026-10-20` })).toBeInTheDocument();
    expect(calendar.queryByRole('button', { name: /^View Subject lecture appointment on / })).not.toBeInTheDocument();
    fireEvent.change(types, { target: { value: 'PR' } });
    fireEvent.click(calendar.getByRole('button', { name: /^View Progress review appointment on / }));
    expect(within(screen.getByRole('dialog', { name: 'Meeting details' })).getByText('PR (Progress Review)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close meeting details' }));
    fireEvent.change(types, { target: { value: 'OTHER' } });
    expect(calendar.getByRole('button', { name: /^View Team planning appointment on / })).toBeInTheDocument();
    expect(calendar.getByRole('button', { name: /^View Catch-up appointment on / })).toBeInTheDocument();
    expect(calendar.queryByRole('button', { name: /^View Monthly coaching appointment on / })).not.toBeInTheDocument();
    fireEvent.change(types, { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show lectures / subjects' }));
    for (const row of data.meetings) expect(calendar.getByRole('button', { name: `View ${row.title} on 2026-10-20` })).toBeInTheDocument();
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(1);
  });

  it('includes lectures in Ready automatically and preserves the optional lecture toggle in other filters', async () => {
    const data = fixture();
    data.meetings[0].category = 'MCM';
    data.meetings.push({ ...data.meetings[0], calendarEventId: 'lecture', eventKey: null, category: 'LECTURE', title: 'Synthetic subject lecture' });
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data);
    mount();
    await screen.findByRole('button', { name: /^View Monthly Coaching Meeting on / });
    expect(screen.getByRole('button', { name: /^View Synthetic subject lecture on / })).toBeInTheDocument();
    expect(screen.getByText('Lectures included in Ready to action')).toBeInTheDocument();
    const count = vi.mocked(loadCoachingCalendar).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'All meetings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide lectures / subjects' }));
    expect(screen.queryByRole('button', { name: /^View Synthetic subject lecture on / })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show lectures / subjects' }));
    expect(await screen.findByRole('button', { name: /^View Synthetic subject lecture on / })).toBeInTheDocument();
    expect(vi.mocked(loadCoachingCalendar)).toHaveBeenCalledTimes(count);
    fireEvent.change(screen.getByRole('combobox', { name: 'Meeting type' }), { target: { value: 'OTHER' } });
    expect(screen.queryByRole('button', { name: /^View Synthetic subject lecture on / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^View Monthly Coaching Meeting on / })).not.toBeInTheDocument();
  });
  it('shows Microsoft cancellations and saved LMS cancellations with an honest date label', async () => {
    const data = fixture();
    data.meetings[0] = { ...data.meetings[0], phase: 'cancelled', cancellationSources: ['microsoft', 'lms'] };
    data.cancelledBookings = [
      { eventKey: 'mcr:1', learnerId: '1', coachEmail: 'one@example.invalid', family: 'MCM',
        startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T10:00:00Z', dateBasis: 'session', sources: ['lms'], recordUpdatedAt: null },
      { eventKey: 'pr:old', learnerId: '2', coachEmail: 'two@example.invalid', family: 'PR', startsAt: null, endsAt: null,
        dateBasis: 'record-updated', sources: ['lms'], recordUpdatedAt: '2026-10-20T11:00:00Z' },
    ];
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data);
    mount(); await screen.findByRole('button', { name: 'Cancelled' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelled' }));
    fireEvent.click(await screen.findByRole('button', { name: /^View Monthly Coaching Meeting on / }));
    expect(await screen.findByText('Cancellation source: Microsoft + LMS')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close meeting details' }));
    const saved = screen.getByRole('region', { name: 'Saved LMS cancellations' });
    expect(within(saved).getByText(/Original session time not retained/)).toBeInTheDocument();
    expect(within(saved).queryByText(/Learner One/)).not.toBeInTheDocument();
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    vi.mocked(loadCoachingCalendar).mockReset().mockResolvedValue(fixture());
    vi.mocked(loadCoachingSession).mockReset().mockResolvedValue(details());
    vi.mocked(loadSavedCoachingEvidence).mockReset();
    vi.mocked(loadCoachLearners).mockReset().mockResolvedValue({ coach: fixture().coaches[0], source: 'lms', scope: 'all',
      start: '2026-10-01', end: '2026-10-31', timeZone: 'UTC', search: '',
      learners: [{ id: '1', name: 'Learner One', learnerType: 'apprenticeship', bookings: [] }],
      coverage: { offset: 0, totalLearners: 1, nextOffset: null } });
  });
  afterEach(() => vi.useRealTimers());

  it('renders a calendar placeholder immediately and makes progressive results usable', async () => {
    let complete!: (value: CoachingCalendar) => void;
    let publish!: (value: CoachingCalendar) => void;
    vi.mocked(loadCoachingCalendar).mockImplementationOnce((_query, _signal, options) => {
      publish = options!.onProgress!;
      return new Promise(resolve => { complete = resolve; });
    });
    mount();
    expect(screen.getByRole('region', { name: 'Loading calendar preview' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText(/No ready recordings/)).not.toBeInTheDocument();
    const partial = { ...fixture(), meetings: fixture().meetings.slice(0, 1),
      coverage: { checkedCoachEmails: ['one@example.invalid'], totalCoaches: 2, nextOffset: 1 } };
    await act(async () => publish(partial));
    expect(screen.getByRole('heading', { name: 'Monthly Coaching Meeting' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Calendar loading progress' })).toHaveAttribute('value', '1');
    fireEvent.change(screen.getByRole('combobox', { name: 'Learner' }), { target: { value: '1' } });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(1);
    await act(async () => complete(fixture()));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('enables coach choices while the first Microsoft calendar is still pending', async () => {
    let complete!: (value: CoachingCalendar) => void;
    vi.mocked(loadCoachingCalendar).mockImplementationOnce((_query, _signal, options) => {
      queueMicrotask(() => options!.onDirectory!(fixture()));
      return new Promise(resolve => { complete = resolve; });
    });
    mount();
    expect(await screen.findByRole('option', { name: 'Coach One' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Loading calendar preview' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Monthly Coaching Meeting' })).not.toBeInTheDocument();
    await act(async () => complete(fixture()));
  });

  it('retains the visible calendar during refresh and asks for a fresh provider read', async () => {
    mount(); await screen.findByRole('heading', { name: 'Monthly Coaching Meeting' });
    let complete!: (value: CoachingCalendar) => void;
    vi.mocked(loadCoachingCalendar).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh calendars' }));
    expect(screen.getByRole('heading', { name: 'Monthly Coaching Meeting' })).toBeInTheDocument();
    expect(vi.mocked(loadCoachingCalendar).mock.lastCall?.[2]?.refresh).toBe(true);
    await act(async () => complete(fixture()));
  });

  it('clears progressive results and coach details if permission is revoked while loading', async () => {
    let deny!: (error: Error) => void;
    vi.mocked(loadCoachingCalendar).mockImplementationOnce((_query, _signal, options) => {
      queueMicrotask(() => options!.onProgress!(fixture()));
      return new Promise((_resolve, reject) => { deny = reject; });
    });
    mount(); await screen.findByRole('heading', { name: 'Monthly Coaching Meeting' });
    await act(async () => deny(new Error('You do not have access to this coaching calendar.')));
    expect(screen.getByRole('alert')).toHaveTextContent('do not have access');
    expect(screen.queryByRole('heading', { name: 'Monthly Coaching Meeting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Coach One' })).not.toBeInTheDocument();
  });

  it('bounds a month preview with an honest shown/total count and keeps the rest accessible', async () => {
    const data = fixture();
    data.meetings = Array.from({ length: 45 }, (_, index) => ({ ...data.meetings[0], calendarEventId: `meeting-${index}`,
      eventKey: `mcr:${index}`, title: `Meeting ${index}` }));
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data);
    mount();
    await screen.findByRole('heading', { name: 'Meeting 0' });
    fireEvent.change(screen.getByRole('combobox', { name: /^Coach$/ }), { target: { value: 'one@example.invalid' } });
    await screen.findByRole('region', { name: 'Hourly coach meeting calendar' });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Calendar period' }), { target: { value: 'month' } });
    await screen.findByText(/Showing 30 of 45 matching meetings/);
    const list = await screen.findByRole('region', { name: 'Coaching meetings' });
    fireEvent.click(within(list).getByRole('button', { name: 'Show more meetings (15 remaining)' }));
    expect(within(list).getByText(/45 meetings match the filters/)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: '+42 more · View day' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Calendar period' })).toHaveValue('day'));
    const dayList = await screen.findByRole('region', { name: 'Coaching meetings' });
    await waitFor(() => expect(within(dayList).getAllByRole('article')).toHaveLength(45));
    expect(within(dayList).queryByText(/Showing 30/)).not.toBeInTheDocument();
  });

  it('shows all coaches in calendar columns with local access to every meeting', async () => {
    const data = fixture();
    data.coaches = Array.from({ length: 6 }, (_, index) => ({ email: `coach-${index}@example.invalid`, name: `Coach ${index}` }));
    data.meetings = Array.from({ length: 38 }, (_, index) => ({ ...data.meetings[0], calendarEventId: `meeting-${index}`,
      eventKey: `mcr:${index}`, coachEmail: data.coaches[Math.floor(index / 7)].email, title: `Meeting ${index}` }));
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data);
    mount();
    const list = await screen.findByRole('region', { name: 'Coaching meetings' });
    expect(within(list).getByText(/38 meetings match the filters/)).toBeInTheDocument();
    expect(within(list).getAllByRole('article')).toHaveLength(28);
    expect(screen.getByRole('region', { name: 'Hourly coach meeting calendar' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'All coach meeting agenda' })).not.toBeInTheDocument();
    const requests = vi.mocked(loadCoachingCalendar).mock.calls.length;
    fireEvent.click(within(list).getByRole('button', { name: 'Next coaches' }));
    expect(within(list).getAllByRole('article')).toHaveLength(10);
    expect(within(list).getByText(/38 meetings match the filters/)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: /^View Meeting 37 on / }));
    expect(await screen.findByRole('dialog', { name: 'Meeting details' })).toHaveTextContent('Meeting 37');
    expect(vi.mocked(loadCoachingSession).mock.lastCall?.[0]).toBe('mcr:37');
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(requests);
  });

  it('shows Ready to action by default and links to the lecture library', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Monthly Coaching Meeting' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Progress Review' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ready to action', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lecture recordings' })).toHaveAttribute('href', '/curriculum/recordings');
    expect(within(screen.getByRole('region', { name: 'Coaching meetings' })).getByText('Ended · Recording available')).toBeInTheDocument();
  });

  it('opens learners only for one selected coach and returns to all of the chosen learner meetings', async () => {
    mount(); await screen.findByRole('heading', { name: 'Monthly Coaching Meeting' });
    expect(screen.getByRole('button', { name: 'Coach learners' })).toBeDisabled();
    expect(loadCoachLearners).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Coach' }), { target: { value: 'one@example.invalid' } });
    await screen.findByRole('heading', { name: 'Monthly Coaching Meeting' });
    fireEvent.click(screen.getByRole('button', { name: 'Coach learners' }));
    const dialog = await screen.findByRole('dialog', { name: 'Coach One — learners' });
    await within(dialog).findByRole('heading', { name: 'Learner One' });
    expect(vi.mocked(loadCoachLearners).mock.lastCall?.[0].coachEmail).toBe('one@example.invalid');
    fireEvent.click(within(dialog).getByRole('button', { name: 'View learner meetings' }));
    expect(screen.getByRole('combobox', { name: 'Learner' })).toHaveValue('1');
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All meetings', pressed: true })).toBeInTheDocument();
  });

  it('switches to upcoming meetings and filters matching status', async () => {
    mount(); await screen.findByRole('heading', { name: 'Monthly Coaching Meeting' });
    fireEvent.click(screen.getByRole('button', { name: 'Upcoming' }));
    expect(screen.getByRole('heading', { name: 'Progress Review' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'LMS match' }), { target: { value: 'matched' } });
    expect(screen.queryByRole('heading', { name: 'Progress Review' })).not.toBeInTheDocument();
    expect(screen.getByText(/No meetings match/)).toBeInTheDocument();
  });

  it('narrows the learner picker to the selected coach and resets the learner on coach change', async () => {
    mount(); await screen.findByRole('heading', { name: 'Monthly Coaching Meeting' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Learner' }), { target: { value: '1' } });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('combobox', { name: 'Learner' })).toHaveValue('1');
    fireEvent.change(screen.getByRole('combobox', { name: 'Coach' }), { target: { value: 'two@example.invalid' } });
    await waitFor(() => expect(vi.mocked(loadCoachingCalendar).mock.lastCall?.[0]).toMatchObject({ coachEmail: 'two@example.invalid' }));
    expect(screen.getByRole('combobox', { name: 'Learner' })).toHaveValue('');
    await screen.findByRole('option', { name: 'Learner Two' });
    expect(within(screen.getByRole('combobox', { name: 'Learner' })).queryByRole('option', { name: 'Learner One' })).not.toBeInTheDocument();
  });

  it('selects a calendar day and requests that day only', async () => {
    mount(); await screen.findByRole('heading', { name: 'Monthly Coaching Meeting' });
    fireEvent.change(screen.getByRole('combobox', { name: /^Coach$/ }), { target: { value: 'one@example.invalid' } });
    await screen.findByRole('region', { name: 'Hourly coach meeting calendar' });
    fireEvent.click(screen.getByRole('button', { name: 'Show meetings on 2026-10-22' }));
    await waitFor(() => expect(vi.mocked(loadCoachingCalendar).mock.lastCall?.[0]).toMatchObject({ start: '2026-10-22', end: '2026-10-22' }));
    expect(screen.getByRole('combobox', { name: 'Calendar period' })).toHaveValue('day');
  });

  it('shows only the chosen coach meetings in both the calendar and the review list', async () => {
    mount(); await screen.findByRole('heading', { name: 'Monthly Coaching Meeting' });
    fireEvent.click(screen.getByRole('button', { name: 'All meetings' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Coach' }), { target: { value: 'two@example.invalid' } });
    await screen.findByRole('heading', { name: 'Progress Review' });
    const calendar = within(screen.getByRole('region', { name: 'Coach meeting calendar' }));
    expect(calendar.getByText('Coach Two')).toBeInTheDocument();
    expect(calendar.queryByText('Coach One')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Monthly Coaching Meeting' })).not.toBeInTheDocument();
    expect(vi.mocked(loadCoachingCalendar).mock.lastCall?.[0].coachEmail).toBe('two@example.invalid');
  });

  it('keeps any calendar title and meetings without a learner or LMS booking visible under All meetings', async () => {
    const data = fixture();
    data.meetings[0].title = 'Combined support and monthly discussion';
    data.meetings.push({ ...data.meetings[0], calendarEventId: 'no-booking', eventKey: null,
      title: 'Internal planning appointment', learnerIds: [], family: null, match: 'external',
      media: { state: 'unlinked', recordings: [], readyCount: 0 }, readyToAction: false });
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data);
    mount();
    await screen.findByRole('heading', { name: 'Combined support and monthly discussion' });
    fireEvent.click(screen.getByRole('button', { name: 'All meetings' }));
    expect(screen.getByRole('heading', { name: 'Internal planning appointment' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Monthly Coaching Meeting' })).not.toBeInTheDocument();
    const calendar = within(screen.getByRole('region', { name: 'Coach meeting calendar' }));
    expect(calendar.getByText('Internal planning appointment')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Learner' }), { target: { value: '1' } });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(1);
    await screen.findByRole('heading', { name: 'Combined support and monthly discussion' });
    expect(screen.queryByRole('heading', { name: 'Internal planning appointment' })).not.toBeInTheDocument();
  });

  it('keeps filters when moving to another period or timezone', async () => {
    mount(); await screen.findByRole('heading', { name: 'Monthly Coaching Meeting' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Meeting type' }), { target: { value: 'PR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    await waitFor(() => expect(vi.mocked(loadCoachingCalendar).mock.lastCall?.[0]).toMatchObject({ start: '2026-10-21', end: '2026-10-21' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Time zone' }), { target: { value: 'Europe/London' } });
    await waitFor(() => expect(vi.mocked(loadCoachingCalendar).mock.lastCall?.[0].timeZone).toBe('Europe/London'));
    expect(screen.getByRole('combobox', { name: 'Meeting type' })).toHaveValue('PR');
  });

  it('shows partial coverage and does not call a failed calendar empty', async () => {
    vi.mocked(loadCoachingCalendar).mockResolvedValue({ ...fixture(), meetings: [], partial: true,
      errors: [{ coachEmail: 'two@example.invalid', code: 'calendar_read_failed' }],
      coverage: { checkedCoachEmails: ['one@example.invalid'], totalCoaches: 2, nextOffset: null } });
    mount();
    expect(await screen.findByRole('region', { name: 'Calendar data status' })).toHaveTextContent('1 check needs attention');
    expect(screen.getByText(/No meetings loaded for these filters/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 calendars loaded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sync & booking details' }));
    expect(screen.getByRole('dialog', { name: 'Sync & booking details' })).toHaveTextContent('Some checks need attention');
    fireEvent.click(screen.getByRole('button', { name: 'Recheck calendars' }));
    await waitFor(() => expect(loadCoachingCalendar).toHaveBeenCalledTimes(2));
  });

  it('explains an unavailable Microsoft mailbox without offering a blind retry', async () => {
    vi.mocked(loadCoachingCalendar).mockResolvedValueOnce({ ...fixture(), partial: true,
      errors: [{ coachEmail: 'two@example.invalid', code: 'calendar_mailbox_unavailable', retryable: false }],
      coverage: { checkedCoachEmails: ['one@example.invalid'], totalCoaches: 2, nextOffset: null } });
    mount();
    await screen.findByRole('region', { name: 'Calendar data status' });
    expect(screen.queryByText(/Microsoft reports no calendar mailbox/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sync & booking details' }));
    expect(screen.getByRole('dialog', { name: 'Sync & booking details' })).toHaveTextContent('Microsoft reports no calendar mailbox available through its API');
    expect(screen.queryByRole('button', { name: 'Retry calendars' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh calendars' })).toBeEnabled();
  });

  it('separates account action from transient errors and focuses the affected coach without clearing the default status', async () => {
    const data = { ...fixture(), partial: true, errors: [
      { coachEmail: 'two@example.invalid', code: 'calendar_not_found', retryable: false },
      { coachEmail: 'one@example.invalid', code: 'calendar_timeout', retryable: true },
    ] };
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data);
    mount();
    await screen.findByRole('region', { name: 'Calendar data status' });
    fireEvent.click(screen.getByRole('button', { name: 'Sync & booking details' }));
    const alert = screen.getByRole('dialog', { name: 'Sync & booking details' });
    expect(within(alert).getByText('Account action required')).toBeVisible();
    expect(within(alert).getByText('Temporary check failure')).toBeVisible();
    expect(within(alert).getByText(/After correcting the saved account, mailbox or app access/)).toBeVisible();
    fireEvent.click(within(alert).getByRole('button', { name: 'View calendar for Coach Two' }));
    await waitFor(() => expect(vi.mocked(loadCoachingCalendar).mock.lastCall?.[0].coachEmail).toBe('two@example.invalid'));
    expect(screen.getByRole('combobox', { name: /^Coach$/ })).toHaveValue('two@example.invalid');
    expect(screen.getByRole('button', { name: 'Ready to action', pressed: true })).toBeInTheDocument();
  });

  it('keeps an ended appointment in Ready even when the source has no recording', async () => {
    const data = fixture();
    data.meetings[0].media = { state: 'pending', readyCount: 0, recordings: [] };
    data.meetings[0].readyToAction = false;
    vi.mocked(loadCoachingCalendar).mockResolvedValueOnce(data);
    mount();
    expect(await screen.findByText('1 ended meeting · 0 with playable recordings')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Monthly Coaching Meeting' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ready to action', pressed: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all loaded meetings' }));
    expect(screen.getByRole('heading', { name: 'Monthly Coaching Meeting' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Progress Review' })).toBeInTheDocument();
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(1);
  });

  it('keeps a retry for temporary provider delays and reports incomplete results', async () => {
    vi.mocked(loadCoachingCalendar).mockResolvedValueOnce({ ...fixture(), partial: true,
      errors: [{ coachEmail: 'two@example.invalid', code: 'calendar_timeout', retryable: true }] });
    mount();
    await screen.findByRole('region', { name: 'Calendar data status' });
    fireEvent.click(screen.getByRole('button', { name: 'Sync & booking details' }));
    expect(screen.getByRole('dialog', { name: 'Sync & booking details' })).toHaveTextContent('calendar took too long');
    expect(screen.getByRole('button', { name: 'Recheck calendars' })).toBeEnabled();
  });

  it('offers retry after a request error and recovers', async () => {
    vi.mocked(loadCoachingCalendar).mockRejectedValueOnce(new Error('Calendars unavailable'));
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('Calendars unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Monthly Coaching Meeting' })).toBeInTheDocument();
  });

  it('ignores an old response after the period changes', async () => {
    let resolveFirst!: (value: CoachingCalendar) => void;
    vi.mocked(loadCoachingCalendar).mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    const next = fixture(); next.meetings[0] = { ...next.meetings[0], startsAt: '2026-10-19T09:00:00Z', endsAt: '2026-10-19T10:00:00Z' };
    vi.mocked(loadCoachingCalendar).mockResolvedValueOnce(next);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    await screen.findByRole('heading', { name: 'Monthly Coaching Meeting' });
    const old = fixture(); old.coaches = [{ email: 'old@example.invalid', name: 'Stale Coach' }];
    await act(async () => resolveFirst(old));
    expect(screen.queryByRole('option', { name: 'Stale Coach' })).not.toBeInTheDocument();
    expect(vi.mocked(loadCoachingCalendar).mock.calls[0][1]?.aborted).toBe(true);
  });

  it('coach entry does not offer a curriculum-only lecture link', async () => {
    vi.mocked(loadCoachingCalendar).mockResolvedValue({ ...fixture(), scope: 'own', coaches: fixture().coaches.slice(0, 1) });
    mount('coach'); await screen.findByRole('heading', { name: 'Monthly Coaching Meeting' });
    expect(screen.queryByRole('link', { name: 'Lecture recordings' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'My calendar' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Hourly coach meeting calendar' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'All coach meeting agenda' })).not.toBeInTheDocument();
  });

  it('marks LMS-only bookings as needing review without claiming cancellation', async () => {
    vi.mocked(loadCoachingCalendar).mockResolvedValue({ ...fixture(), lmsOnly: [{
      eventKey: 'mcr:3', learnerId: '1', coachEmail: 'one@example.invalid', startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T10:00:00Z' }] });
    mount();
    expect(await screen.findByRole('region', { name: 'Calendar data status' })).toHaveTextContent('1 booking to compare');
    expect(screen.queryByRole('region', { name: 'LMS booking comparison' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sync & booking details' }));
    expect(screen.getByRole('region', { name: 'LMS booking comparison' })).toHaveTextContent('does not establish cancellation or absence');
  });

  it('uses viewing timezone and live instants instead of a stale server status', () => {
    expect(meetingDate('2026-10-20T23:30:00Z', 'Africa/Cairo')).toBe('2026-10-21');
    const upcoming = fixture().meetings[1];
    expect(meetingPhase(upcoming, Date.parse('2026-10-20T15:30:00Z'))).toBe('in-progress');
    expect(meetingPhase(upcoming, Date.parse('2026-10-20T16:00:00Z'))).toBe('ended');
    expect(meetingPhase({ ...upcoming, phase: 'cancelled' }, Date.parse('2026-10-29T10:00:00Z'))).toBe('cancelled');
  });

  it('separates all ended review appointments from playable recordings and excludes future/cancelled appointments', () => {
    const row = fixture().meetings[0];
    for (const changed of [
      { ...row, phase: 'cancelled' as const },
      { ...row, startsAt: '2026-10-28T09:00:00Z', endsAt: '2026-10-28T10:00:00Z' },
    ]) expect(filterMeetings([changed], 'ready', 'all', 'all', Date.now())).toEqual([]);
    for (const changed of [{ ...row, media: { state: 'pending' as const, readyCount: 0, recordings: [] } },
      { ...row, match: 'candidate' as const }]) {
      expect(filterMeetings([changed], 'ready', 'all', 'all', Date.now())).toEqual([changed]);
    }
    expect(hasPlayableRecording({ ...row, media: { state: 'pending', readyCount: 0, recordings: [] } }, Date.now())).toBe(false);
    expect(hasPlayableRecording(row, Date.now())).toBe(true);
  });

  it('loads saved attendance and exposes protected playback and download paths', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^View .+ on \d{4}-\d{2}-\d{2}$/ }));
    expect(await screen.findByRole('table', { name: 'Saved meeting attendance' })).toHaveTextContent('Verified Participant');
    expect(screen.getByRole('table')).toHaveTextContent('attended');
    expect(screen.getByRole('link', { name: 'Download recording 1' })).toHaveAttribute('href', expect.stringContaining('recordingId=file%2Fone%2B'));
    fireEvent.click(screen.getByRole('button', { name: 'Play recording 1' }));
    const player = screen.getByLabelText('Coaching recording player');
    expect(player).toHaveAttribute('src', expect.stringContaining('preview=1'));
    fireEvent.error(player);
    expect(screen.getByRole('alert')).toHaveTextContent('could not be played');
    fireEvent.click(screen.getByRole('button', { name: 'Close meeting details' }));
    expect(screen.queryByLabelText('Coaching recording player')).not.toBeInTheDocument();
  });

  it('reviews any titled coach meeting without an LMS booking and keeps Ready, Upcoming and All distinct', async () => {
    const data = fixture();
    data.meetings[0] = { ...data.meetings[0], eventKey: null, title: 'Combined support discussion',
      learnerIds: [], family: null, match: 'external', recordingsReference: 'signed-calendar-reference' };
    vi.mocked(loadCoachingCalendar).mockResolvedValueOnce(data);
    vi.mocked(loadCoachingSession).mockResolvedValueOnce({ ...details(), eventKey: 'coach-calendar:verified', reference: 'signed-calendar-reference' });
    mount();
    await screen.findByRole('heading', { name: 'Combined support discussion' });
    expect(screen.getByRole('button', { name: 'Ready to action', pressed: true })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Progress Review' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^View .+ on \d{4}-\d{2}-\d{2}$/ }));
    expect(await screen.findByRole('table', { name: 'Saved meeting attendance' })).toHaveTextContent('Verified Participant');
    expect(loadCoachingSession).toHaveBeenCalledWith('', expect.any(AbortSignal), 'signed-calendar-reference', 'attendance');
    const params = new URL(screen.getByRole('link', { name: 'Download recording 1' }).getAttribute('href')!, 'http://localhost').searchParams;
    expect(params.get('eventKey')).toBe('coach-calendar:verified');
    expect(params.get('reference')).toBe('signed-calendar-reference');
    fireEvent.click(screen.getByRole('button', { name: 'Play recording 1' }));
    expect(screen.getByLabelText('Coaching recording player')).toHaveAttribute('src', expect.stringContaining('reference=signed-calendar-reference'));
    fireEvent.click(screen.getByRole('button', { name: 'Close meeting details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Upcoming' }));
    expect(screen.getByRole('heading', { name: 'Progress Review' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Combined support discussion' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All meetings' }));
    expect(screen.getByRole('heading', { name: 'Progress Review' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Combined support discussion' })).toBeInTheDocument();
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(1);
  });

  it('keeps attendance pending when a report has not arrived', async () => {
    vi.mocked(loadCoachingSession).mockResolvedValue({ ...details(), attendance: { state: 'pending', reportCount: 0, rows: [] } });
    mount(); fireEvent.click(await screen.findByRole('button', { name: /^View .+ on \d{4}-\d{2}-\d{2}$/ }));
    expect(await screen.findByText(/Attendance remains pending/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a SharePoint recording in Ready with no archive interface', async () => {
    const saved = details();
    saved.media = { state: 'ready', readyCount: 1, recordings: [{ id: 'source-file', state: 'ready', source: 'microsoft' }] };
    vi.mocked(loadCoachingSession).mockResolvedValueOnce(saved);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^View .+ on \d{4}-\d{2}-\d{2}$/ }));
    expect(await screen.findByText('SharePoint recording')).toBeInTheDocument();
    expect(screen.queryByText(/Archiving|Azure archive|Archived/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play recording 1' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Download recording 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ready to action', pressed: true })).toBeInTheDocument();
  });

  it('keeps the open recording player stable while background polls renew signed references', async () => {
    let publish!: (value: CoachingCalendar) => void;
    let complete!: (value: CoachingCalendar) => void;
    const data = fixture();
    data.meetings[0] = { ...data.meetings[0], eventKey: null, match: 'external', recordingsReference: 'first-reference' };
    vi.mocked(loadCoachingCalendar).mockImplementationOnce((_query, _signal, options) => {
      publish = options!.onProgress!;
      queueMicrotask(() => publish(data));
      return new Promise(resolve => { complete = resolve; });
    });
    vi.mocked(loadCoachingSession).mockResolvedValueOnce({ ...details(), reference: 'first-reference', eventKey: 'coach-calendar:verified' });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^View .+ on \d{4}-\d{2}-\d{2}$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Play recording 1' }));
    const player = screen.getByLabelText('Coaching recording player');
    const renewed = { ...data, meetings: [{ ...data.meetings[0], recordingsReference: 'renewed-reference' }, data.meetings[1]] };
    await act(async () => publish(renewed));
    expect(screen.getByLabelText('Coaching recording player')).toBe(player);
    expect(loadCoachingSession).toHaveBeenCalledTimes(1);
    await act(async () => complete(renewed));
  });

  it('labels unfinished background checks without claiming there are no recordings', async () => {
    vi.mocked(loadCoachingCalendar).mockResolvedValueOnce({ ...fixture(), meetings: [], sync: {
      pending: true, pendingCalendars: 1, pendingEvidence: 0, lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false } });
    mount();
    expect(await screen.findByRole('region', { name: 'Calendar data status' })).toHaveTextContent('Remaining checks pending');
    expect(screen.queryByText(/No ready recordings/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No meetings match/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sync & booking details' }));
    expect(screen.getByRole('dialog', { name: 'Sync & booking details' })).toHaveTextContent('First checks remaining: 1 calendars');
  });

  it('allows viewing loaded meetings while recording checks continue without a blocking loader', async () => {
    const data = fixture();
    data.meetings[0] = { ...data.meetings[0], readyToAction: false, media: { state: 'pending', readyCount: 0, recordings: [] } };
    data.sync = { pending: true, pendingCalendars: 0, pendingEvidence: 10, lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false };
    vi.mocked(loadCoachingCalendar).mockResolvedValueOnce(data);
    mount();
    expect(await screen.findByText(/Initial recording checks are still pending/)).toBeInTheDocument();
    expect(screen.queryByText(/Loading the remaining/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all loaded meetings' }));
    expect(screen.getByRole('region', { name: 'Coaching meetings' }).querySelectorAll('article')).toHaveLength(2);
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(1);
  });

  it('retains last known meetings with an explicit error when a refresh temporarily fails', async () => {
    vi.mocked(loadCoachingCalendar).mockResolvedValueOnce(fixture()).mockRejectedValueOnce(new Error('Connection temporarily unavailable'));
    mount();
    await screen.findByRole('button', { name: /^View .+ on \d{4}-\d{2}-\d{2}$/ });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh calendars' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection temporarily unavailable');
    expect(screen.getByRole('button', { name: /^View .+ on \d{4}-\d{2}-\d{2}$/ })).toBeInTheDocument();
  });

  it('refreshes pending snapshots in the background while preserving usable results', async () => {
    vi.useFakeTimers();
    const data = { ...fixture(), sync: { pending: true, pendingCalendars: 1, pendingEvidence: 10, lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false } };
    let finish!: (value: CoachingCalendar) => void;
    vi.mocked(loadCoachingCalendar).mockResolvedValueOnce(data).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Loading the remaining/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^View .+ on \d{4}-\d{2}-\d{2}$/ })).toBeInTheDocument();
    expect(vi.mocked(loadCoachingCalendar).mock.calls[1][2]?.previous?.data).toEqual(data);
    await act(async () => finish(data));
  });

  it('pauses calendar polling during a meeting review and resumes after closing it', async () => {
    vi.useFakeTimers();
    const data = { ...fixture(), sync: { pending: true, pendingCalendars: 1, pendingEvidence: 10,
      lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false } };
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data);
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole('button', { name: /^View Monthly Coaching Meeting on / }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(60_000); });
    expect(loadCoachingCalendar).toHaveBeenCalledOnce();
    expect(loadCoachingSession).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Close meeting details' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(2);
  });

  it('stops after three automatic checks even when every reply reports new progress', async () => {
    vi.useFakeTimers();
    let version = 0;
    vi.mocked(loadCoachingCalendar).mockImplementation(async () => ({ ...fixture(), sync: { pending: true,
      pendingCalendars: 1, pendingEvidence: 10, version: String(++version),
      lastSuccessfulAt: new Date().toISOString(), directoryHash: 'one', directoryUnchanged: false } }));
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    for (let second = 0; second < 600; second++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(4);
    expect(screen.getByRole('region', { name: 'Calendar data status' })).toHaveTextContent('Automatic updates stopped');
    expect(screen.queryByText('Checking for updates')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^View Monthly Coaching Meeting on / })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All meetings' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Meeting type' }), { target: { value: 'PR' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1800000); });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(4);
  });

  it('stops completed snapshots without periodic reads and keeps filters local', async () => {
    vi.useFakeTimers();
    const data = { ...fixture(), sync: { pending: false, pendingCalendars: 0, pendingEvidence: 0,
      lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false } };
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data);
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole('button', { name: 'All meetings' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Meeting type' }), { target: { value: 'PR' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1800000); });
    expect(loadCoachingCalendar).toHaveBeenCalledOnce();
    expect(screen.getByRole('combobox', { name: 'Meeting type' })).toHaveValue('PR');
    expect(loadCoachingSession).not.toHaveBeenCalled(); expect(loadSavedCoachingEvidence).not.toHaveBeenCalled();
  });

  it('counts slow successful reads towards the absolute ninety-second cycle limit', async () => {
    vi.useFakeTimers();
    const data = { ...fixture(), sync: { pending: true, pendingCalendars: 1, pendingEvidence: 10,
      lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false } };
    vi.mocked(loadCoachingCalendar).mockImplementation(() => new Promise(resolve => {
      window.setTimeout(() => resolve(data), 15000);
    }));
    mount();
    for (let second = 0; second < 90; second++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('region', { name: 'Calendar data status' })).toHaveTextContent('Automatic updates stopped');
    expect(screen.queryByText('Checking for updates')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(600000); });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(3);
  });

  it('starts a new bounded cycle for a different coach after the previous cycle has stopped', async () => {
    vi.useFakeTimers();
    const data = { ...fixture(), sync: { pending: true, pendingCalendars: 1, pendingEvidence: 0,
      lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false } };
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data);
    mount();
    for (let second = 0; second < 100; second++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(4);
    fireEvent.change(screen.getByRole('combobox', { name: /^Coach$/ }), { target: { value: 'one@example.invalid' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(5);
    expect(vi.mocked(loadCoachingCalendar).mock.lastCall?.[0].coachEmail).toBe('one@example.invalid');
    expect(screen.getByRole('region', { name: 'Calendar data status' })).not.toHaveTextContent('Automatic updates stopped');
    for (let second = 0; second < 100; second++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(8);
    expect(screen.getByRole('region', { name: 'Calendar data status' })).toHaveTextContent('Automatic updates stopped');
  });

  it('does not poll maintenance jobs or permanent account failures after saved results load', async () => {
    vi.useFakeTimers();
    const data = { ...fixture(), partial: true, errors: [{ coachEmail: 'two@example.invalid', code: 'calendar_not_found', retryable: false }],
      sync: { pending: true, pendingCalendars: 1, pendingEvidence: 10, initialPendingCalendars: 0, initialPendingEvidence: 0,
        lastSuccessfulAt: '2026-10-20T11:00:00Z', directoryHash: 'one', directoryUnchanged: false } };
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data); mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const status = screen.getByRole('region', { name: 'Calendar data status' });
    expect(status).toHaveTextContent('Saved results available'); expect(status).toHaveTextContent('1 check needs attention');
    expect(status).not.toHaveTextContent('Remaining checks pending');
    fireEvent.click(screen.getByRole('button', { name: 'Sync & booking details' }));
    expect(screen.getByRole('dialog', { name: 'Sync & booking details' })).toHaveTextContent('Account action required');
    fireEvent.click(screen.getByRole('button', { name: 'Close sync details' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1800000); });
    expect(loadCoachingCalendar).toHaveBeenCalledOnce();
  });

  it('coalesces focus events within the cycle and never restarts expired hidden or offline cycles', async () => {
    vi.useFakeTimers();
    const data = { ...fixture(), sync: { pending: true, pendingCalendars: 1, pendingEvidence: 0,
      lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false } };
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    try {
      mount(); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      hidden.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'));
      await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
      expect(loadCoachingCalendar).toHaveBeenCalledOnce();
      hidden.mockReturnValue(false);
      for (let index = 0; index < 5; index++) document.dispatchEvent(new Event('visibilitychange'));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(loadCoachingCalendar).toHaveBeenCalledTimes(2);
      online.mockReturnValue(false); window.dispatchEvent(new Event('offline'));
      await act(async () => { await vi.advanceTimersByTimeAsync(600000); });
      online.mockReturnValue(true);
      await act(async () => {
        for (let index = 0; index < 5; index++) window.dispatchEvent(new Event('online'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(loadCoachingCalendar).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('region', { name: 'Calendar data status' })).toHaveTextContent('Automatic updates stopped');
    } finally { hidden.mockRestore(); online.mockRestore(); }
  });

  it('times out a stalled initial read and ignores a late response instead of leaving a spinner', async () => {
    vi.useFakeTimers();
    let finish!: (value: CoachingCalendar) => void;
    vi.mocked(loadCoachingCalendar).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    mount(); await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(screen.getByRole('alert')).toHaveTextContent('timed out');
    expect(screen.queryByRole('region', { name: 'Loading calendar preview' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh calendars' })).toBeEnabled();
    expect(vi.mocked(loadCoachingCalendar).mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => finish(fixture()));
    expect(screen.queryByRole('button', { name: /^View Monthly Coaching Meeting on / })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(600000); });
    expect(loadCoachingCalendar).toHaveBeenCalledOnce();
  });

  it('preserves saved meetings on timeout and starts a fresh bounded cycle only on explicit refresh', async () => {
    vi.useFakeTimers();
    const data = { ...fixture(), sync: { pending: true, pendingCalendars: 1, pendingEvidence: 10,
      lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false } };
    let finish!: (value: CoachingCalendar) => void;
    vi.mocked(loadCoachingCalendar).mockResolvedValueOnce(data).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(data);
    mount(); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(screen.getByRole('button', { name: 'Refresh calendars' })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(screen.queryByText('Checking for updates')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^View Monthly Coaching Meeting on / })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh calendars' })).toBeEnabled();
    await act(async () => finish({ ...data, meetings: [] }));
    expect(screen.getByRole('button', { name: /^View Monthly Coaching Meeting on / })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(600000); });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh calendars' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(vi.mocked(loadCoachingCalendar).mock.lastCall?.[2]?.refresh).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(4);
  });

  it('stops automatic checks on failure and clears saved data when an explicit retry finds revoked access', async () => {
    vi.useFakeTimers();
    const data = { ...fixture(), sync: { pending: true, pendingCalendars: 1, pendingEvidence: 0,
      lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false } };
    vi.mocked(loadCoachingCalendar).mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('Connection temporarily unavailable'))
      .mockRejectedValueOnce(new Error('You do not have access to this coaching calendar.'));
    mount(); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(screen.getByRole('alert')).toHaveTextContent('Connection temporarily unavailable');
    expect(screen.getByRole('button', { name: /^View Monthly Coaching Meeting on / })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(600000); });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh calendars' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('alert')).toHaveTextContent('do not have access');
    expect(screen.queryByRole('button', { name: /^View Monthly Coaching Meeting on / })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(600000); });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(3);
  });

  it('releases the polling pause if an in-flight update removes the selected meeting', async () => {
    vi.useFakeTimers();
    const data = { ...fixture(), sync: { pending: true, pendingCalendars: 1, pendingEvidence: 10,
      lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false } };
    let finish!: (value: CoachingCalendar) => void;
    vi.mocked(loadCoachingCalendar).mockImplementationOnce((_query, _signal, options) => {
      options!.onProgress!(data);
      return new Promise(resolve => { finish = resolve; });
    }).mockResolvedValue(data);
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole('button', { name: /^View Monthly Coaching Meeting on / }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('dialog', { name: 'Meeting details' })).toBeInTheDocument();
    await act(async () => finish({ ...data, meetings: [] }));
    expect(screen.queryByRole('dialog', { name: 'Meeting details' })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(2);
  });

  it('retries a failed detail read without losing the calendar filters', async () => {
    vi.mocked(loadCoachingSession).mockRejectedValueOnce(new Error('Evidence unavailable'));
    mount(); fireEvent.click(await screen.findByRole('button', { name: /^View .+ on \d{4}-\d{2}-\d{2}$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Evidence unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry details' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ready to action', pressed: true })).toBeInTheDocument();
  });

  it('opens in day view, reads only that day, and fetches details only on a meeting click', async () => {
    mount();
    const event = await screen.findByRole('button', { name: 'View Monthly Coaching Meeting on 2026-10-20' });
    expect(screen.getByRole('combobox', { name: 'Calendar period' })).toHaveValue('day');
    expect(vi.mocked(loadCoachingCalendar).mock.calls[0][0]).toMatchObject({ start: '2026-10-20', end: '2026-10-20' });
    expect(screen.getByRole('region', { name: 'Hourly coach meeting calendar' })).toBeInTheDocument();
    expect(loadCoachingSession).not.toHaveBeenCalled();
    event.focus(); fireEvent.click(event);
    const drawer = await screen.findByRole('dialog', { name: 'Meeting details' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(within(drawer).getByRole('heading', { name: 'Monthly Coaching Meeting' })).toBeInTheDocument();
    expect(within(drawer).getByText('Coach One')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close meeting details' })).toHaveFocus();
    await within(drawer).findByRole('link', { name: 'Download recording 1' });
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(within(drawer).getByRole('link', { name: 'Download recording 1' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close meeting details' })).toHaveFocus();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Play recording 1' }));
    expect(within(drawer).getByLabelText('Coaching recording player')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Coaching meetings' })).queryByLabelText('Coaching recording player')).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(event).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('shows upcoming meeting details without requesting recording or attendance evidence early', async () => {
    mount(); await screen.findByRole('heading', { name: 'Monthly Coaching Meeting' });
    fireEvent.click(screen.getByRole('button', { name: 'Upcoming' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Progress Review on 2026-10-20' }));
    const drawer = screen.getByRole('dialog', { name: 'Meeting details' });
    expect(within(drawer).getByText(/after this meeting ends/)).toBeInTheDocument();
    expect(loadCoachingSession).not.toHaveBeenCalled();
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(1);
  });

  it('opens a meeting from month view without changing its occurrence or fetching a separate day', async () => {
    mount(); await screen.findByRole('heading', { name: 'Monthly Coaching Meeting' });
    fireEvent.change(screen.getByRole('combobox', { name: /^Coach$/ }), { target: { value: 'one@example.invalid' } });
    await screen.findByRole('region', { name: 'Hourly coach meeting calendar' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Calendar period' }), { target: { value: 'month' } });
    const event = await screen.findByRole('button', { name: 'View Monthly Coaching Meeting on 2026-10-20' });
    fireEvent.click(event);
    await screen.findByRole('dialog', { name: 'Meeting details' });
    expect(loadCoachingSession).toHaveBeenCalledWith('mcr:1', expect.any(AbortSignal), undefined, 'attendance');
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('combobox', { name: 'Calendar period' })).toHaveValue('month');
  });

  it('keeps calendar presentation for all coaches and one coach while retaining the Ready filter', async () => {
    mount();
    await screen.findByRole('region', { name: 'Hourly coach meeting calendar' });
    fireEvent.change(screen.getByRole('combobox', { name: /^Coach$/ }), { target: { value: 'one@example.invalid' } });
    await screen.findByRole('region', { name: 'Hourly coach meeting calendar' });
    expect(screen.queryByRole('region', { name: 'All coach meeting agenda' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coach learners' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Ready to action', pressed: true })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: /^Coach$/ }), { target: { value: '' } });
    await screen.findByRole('region', { name: 'Hourly coach meeting calendar' });
    expect(screen.queryByRole('region', { name: 'All coach meeting agenda' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ready to action', pressed: true })).toBeInTheDocument();
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(3);
  });

  it('keeps partial-data issues visible in a compact summary and opens their accessible drawer without new requests', async () => {
    const data = { ...fixture(), partial: true, errors: [
      { coachEmail: 'two@example.invalid', code: 'calendar_not_found', retryable: false },
      { coachEmail: 'two@example.invalid', code: 'calendar_not_found', retryable: false },
    ] };
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data);
    mount();
    expect(await screen.findByRole('region', { name: 'Calendar data status' })).toHaveTextContent('1 check needs attention');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Microsoft could not find a calendar/)).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Sync & booking details' });
    trigger.focus(); fireEvent.click(trigger);
    const drawer = screen.getByRole('dialog', { name: 'Sync & booking details' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(within(drawer).getAllByText(/Microsoft could not find a calendar/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Close sync details' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Recheck calendars' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close sync details' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(1);
    expect(loadCoachingSession).not.toHaveBeenCalled();
  });

  it('shows unmatched bookings only on demand and marks comparison provisional while calendars update', async () => {
    const data = { ...fixture(), sync: { pending: true, pendingCalendars: 1, pendingEvidence: 0,
      lastSuccessfulAt: '2026-10-20T11:00:00Z', directoryHash: 'current', directoryUnchanged: false },
      lmsOnly: [{ eventKey: 'mcr:unmatched', learnerId: '1', coachEmail: 'one@example.invalid', startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T10:00:00Z' }] };
    vi.mocked(loadCoachingCalendar).mockResolvedValue(data);
    mount();
    expect(await screen.findByRole('region', { name: 'Calendar data status' })).toHaveTextContent('Remaining checks pending');
    expect(screen.queryByRole('region', { name: 'LMS booking comparison' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sync & booking details' }));
    const comparison = screen.getByRole('region', { name: 'LMS booking comparison' });
    expect(comparison).toHaveTextContent('These results are provisional');
    expect(comparison).toHaveTextContent('does not establish cancellation or absence');
    expect(comparison).toHaveTextContent('Learner One');
    expect(loadCoachingCalendar).toHaveBeenCalledTimes(1);
    expect(loadCoachingSession).not.toHaveBeenCalled();
  });
});
