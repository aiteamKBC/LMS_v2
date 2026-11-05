import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoachLearners, type CoachLearners, type CoachingMeeting } from '@/api/coachingRecordings';
import CoachLearnersDialog from './CoachLearnersDialog';

vi.mock('@/api/coachingRecordings', async () => ({ ...await vi.importActual<typeof import('@/api/coachingRecordings')>('@/api/coachingRecordings'), loadCoachLearners: vi.fn() }));
const roster = (): CoachLearners => ({ coach: { email: 'coach@example.invalid', name: 'Sample Coach' }, scope: 'own', source: 'lms',
  start: '2026-10-01', end: '2026-10-31', timeZone: 'UTC', search: '',
  learners: [{ id: '1', name: 'Learner One', learnerType: 'apprenticeship', bookings: [{ eventKey: 'mcr:1', eventType: 'mcr', sequence: 1,
    status: 'awaiting-signature', syncState: 'synced', cancelled: false, targetDate: '2026-10-19', scheduledDate: '2026-10-20',
    startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T10:00:00Z', reviewCompletedAt: null, recordUpdatedAt: null, periodBasis: 'session' }] },
  { id: '2', name: 'Learner Two', learnerType: 'commercial', bookings: [] }], coverage: { offset: 0, totalLearners: 2, nextOffset: null } });
const meeting: CoachingMeeting = { calendarEventId: 'event', coachEmail: 'coach@example.invalid', eventKey: 'mcr:1', candidateEventKeys: [], learnerIds: ['1'],
  family: null, title: 'Support and monthly discussion', startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T10:00:00Z', phase: 'ended',
  match: 'matched', media: { state: 'pending', readyCount: 0, recordings: [] }, readyToAction: false };
const props = () => ({ coachEmail: 'coach@example.invalid', coachName: 'Sample Coach', start: '2026-10-01', end: '2026-10-31', timeZone: 'UTC',
  meetings: [meeting, { ...meeting, calendarEventId: 'unlinked', eventKey: null, learnerIds: [], title: 'Team planning' }], calendarPartial: false,
  onClose: vi.fn(), onViewMeetings: vi.fn() });

beforeEach(() => { vi.mocked(loadCoachLearners).mockReset().mockResolvedValue(roster()); });
afterEach(() => vi.restoreAllMocks());

describe('Coach learner popup', () => {
  it('labels an unlinked Progress Review booking as PR while preserving its saved state', async () => {
    const data = roster();
    data.learners[0].bookings[0].eventType = 'progress-review';
    data.learners[0].bookings[0].eventKey = 'pr:1';
    vi.mocked(loadCoachLearners).mockResolvedValue(data);
    render(<CoachLearnersDialog {...props()} />);
    const learner = await screen.findByRole('region', { name: 'Learner Learner One' });
    fireEvent.click(within(learner).getByRole('button', { name: 'Bookings & review status' }));
    expect(within(learner).getByText('PR (Progress Review) #1')).toBeInTheDocument();
    expect(within(learner).getByText('LMS status: Awaiting signature')).toBeInTheDocument();
  });

  it('loads current learners on demand and keeps saved review status distinct from ended calendar meetings', async () => {
    render(<CoachLearnersDialog {...props()} />);
    const learner = await screen.findByRole('region', { name: 'Learner Learner One' });
    fireEvent.click(within(learner).getByRole('button', { name: 'Bookings & review status' }));
    expect(within(learner).getByText('LMS status: Awaiting signature')).toBeInTheDocument();
    expect(within(learner).getAllByText('Support and monthly discussion')).toHaveLength(2);
    expect(within(learner).queryByText(/Review completed at/)).not.toBeInTheDocument();
    expect(loadCoachLearners).toHaveBeenCalledWith(expect.objectContaining({ coachEmail: 'coach@example.invalid', start: '2026-10-01', end: '2026-10-31' }), expect.any(AbortSignal));
    expect(screen.getByText(/1 calendar meetings have no learner linked/)).toBeInTheDocument();
  });

  it('keeps a learner without saved bookings visible without claiming they never booked elsewhere', async () => {
    render(<CoachLearnersDialog {...props()} />);
    const learner = await screen.findByRole('region', { name: 'Learner Learner Two' });
    fireEvent.click(within(learner).getByRole('button', { name: 'Bookings & review status' }));
    expect(within(learner).getByText(/No saved LMS bookings or reviews in this period/)).toHaveTextContent('booked elsewhere');
  });

  it('passes the chosen learner back to the calendar without changing any booking', async () => {
    const callbacks = props(); render(<CoachLearnersDialog {...callbacks} />);
    const learner = await screen.findByRole('region', { name: 'Learner Learner Two' });
    fireEvent.click(within(learner).getByRole('button', { name: 'View learner meetings' }));
    expect(callbacks.onViewMeetings).toHaveBeenCalledWith('2');
    expect(loadCoachLearners).toHaveBeenCalledTimes(1);
  });

  it('shows unknown booking types and honestly labels cancellation records whose date was erased', async () => {
    const data = roster();
    data.learners[0].bookings[0] = { ...data.learners[0].bookings[0], eventKey: 'custom', eventType: 'custom-coaching', cancelled: true,
      startsAt: null, endsAt: null, scheduledDate: null, status: 'not-scheduled', periodBasis: 'record-updated', recordUpdatedAt: '2026-10-21T12:00:00Z' };
    vi.mocked(loadCoachLearners).mockResolvedValue(data);
    render(<CoachLearnersDialog {...props()} />);
    fireEvent.click(within(await screen.findByRole('region', { name: 'Learner Learner One' })).getByRole('button', { name: 'Bookings & review status' }));
    expect(screen.getByText('custom-coaching #1')).toBeInTheDocument();
    expect(screen.getByText(/Included by record update date/)).toHaveTextContent('original meeting or cancellation time was not retained');
  });

  it('retries a failed roster read instead of inventing an empty caseload', async () => {
    vi.mocked(loadCoachLearners).mockRejectedValueOnce(new Error('Roster unavailable'));
    render(<CoachLearnersDialog {...props()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Roster unavailable');
    expect(screen.queryByText(/No current learners/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry learners' }));
    expect(await screen.findByRole('heading', { name: 'Learner One' })).toBeInTheDocument();
  });

  it('searches the coach caseload on submit', async () => {
    render(<CoachLearnersDialog {...props()} />);
    await screen.findByRole('heading', { name: 'Learner One' });
    const data = roster(); data.search = 'Two'; data.learners = data.learners.slice(1); data.coverage.totalLearners = 1;
    vi.mocked(loadCoachLearners).mockResolvedValueOnce(data);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search coach learners' }), { target: { value: 'Two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search learners' }));
    await waitFor(() => expect(vi.mocked(loadCoachLearners).mock.lastCall?.[0].search).toBe('Two'));
    await screen.findByRole('heading', { name: 'Learner Two' });
    expect(screen.queryByRole('heading', { name: 'Learner One' })).not.toBeInTheDocument();
  });

  it('loads additional learner pages without dropping previous learners', async () => {
    const first = roster(); first.learners = first.learners.slice(0, 1); first.coverage.nextOffset = 1;
    const second = roster(); second.learners = second.learners.slice(1); second.coverage.offset = 1;
    vi.mocked(loadCoachLearners).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    render(<CoachLearnersDialog {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more learners' }));
    await screen.findByRole('heading', { name: 'Learner Two' });
    expect(screen.getByRole('heading', { name: 'Learner One' })).toBeInTheDocument();
    expect(screen.getByText(/Showing 2 of 2 learners/)).toBeInTheDocument();
    expect(vi.mocked(loadCoachLearners).mock.lastCall?.[0].offset).toBe(1);
  });

  it('keeps partial paging visible and clears learner data when access is revoked', async () => {
    const first = roster(); first.learners = first.learners.slice(0, 1); first.coverage.nextOffset = 1;
    const denied = new Error('Access revoked'); denied.name = 'CoachingLearnersAccessError';
    vi.mocked(loadCoachLearners).mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('Page unavailable')).mockRejectedValueOnce(denied);
    render(<CoachLearnersDialog {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more learners' }));
    await screen.findByRole('alert');
    expect(screen.getByText(/Showing 1 of 2 learners/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more learners' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Access revoked');
    expect(screen.queryByRole('heading', { name: 'Learner One' })).not.toBeInTheDocument();
  });

  it('aborts stale requests and does not display another coach response', async () => {
    let finish!: (value: CoachLearners) => void;
    vi.mocked(loadCoachLearners).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const initial = props(); const view = render(<CoachLearnersDialog {...initial} />);
    const oldSignal = vi.mocked(loadCoachLearners).mock.calls[0][1];
    const other = roster(); other.coach.email = 'other@example.invalid'; other.learners = []; other.coverage.totalLearners = 0;
    vi.mocked(loadCoachLearners).mockResolvedValueOnce(other);
    view.rerender(<CoachLearnersDialog {...initial} coachEmail="other@example.invalid" coachName="Other Coach" />);
    await screen.findByText('No current learners match this search.');
    await act(async () => finish(roster()));
    expect(oldSignal?.aborted).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Learner One' })).not.toBeInTheDocument();
  });

  it('traps focus, closes with Escape, restores the opener and aborts work on unmount', async () => {
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    const callbacks = props(); const view = render(<CoachLearnersDialog {...callbacks} />);
    const signal = vi.mocked(loadCoachLearners).mock.calls[0][1];
    const dialog = screen.getByRole('dialog'); expect(dialog).toHaveFocus();
    await screen.findByRole('heading', { name: 'Learner One' });
    const buttons = within(dialog).getAllByRole('button');
    buttons[buttons.length - 1].focus(); fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(buttons[buttons.length - 1]).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(callbacks.onClose).toHaveBeenCalledOnce();
    view.unmount(); expect(opener).toHaveFocus(); expect(signal?.aborted).toBe(true); opener.remove();
  });
});
