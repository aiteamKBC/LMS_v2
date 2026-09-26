import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirstSessionGate } from './FirstSessionGate';

const mocks = vi.hoisted(() => ({
  fetchState: vi.fn(),
  fetchSlots: vi.fn(),
  book: vi.fn(),
  account: { role: 'learner', subjectId: 7, learnerType: 'commercial' } as Record<string, unknown> | null,
  logout: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ auth: { account: mocks.account }, logout: mocks.logout }),
}));
vi.mock('@/api/learnerCalendar', () => ({
  fetchLearnerFirstSession: mocks.fetchState,
  fetchFirstSessionSlots: mocks.fetchSlots,
  bookLearnerCalendarSession: mocks.book,
  ukOffsetForDate: () => -60,
}));
vi.mock('./RouteLoadingSkeleton', () => ({ RouteLoadingSkeleton: () => <p>Loading…</p> }));

const owner = { name: 'Ann Coach', email: 'ann@kbc.test' };

function state(overrides: Record<string, unknown> = {}) {
  return { caseOwner: owner, booked: false, event: null, startsOn: null, access: 'book', ...overrides };
}

/** The college day as the availability endpoint reports it: every hour from
 *  09:00 to 16:00, free unless named in `taken`. */
function collegeDay(taken: string[] = [], unconfirmed = '') {
  return {
    slots: Array.from({ length: 8 }, (_, i) => {
      const time = `${String(i + 9).padStart(2, '0')}:00`;
      return { time, available: !taken.includes(time) };
    }),
    unconfirmed,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  mocks.account = { role: 'learner', subjectId: 7, learnerType: 'commercial' };
  mocks.fetchState.mockResolvedValue(state());
  mocks.fetchSlots.mockResolvedValue(collegeDay());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const view = (path = '/learner/home') => render(
  <MemoryRouter initialEntries={[path]}>
    <FirstSessionGate><p>My programme</p></FirstSessionGate>
  </MemoryRouter>,
);

describe('FirstSessionGate', () => {
  it('asks a learner with nothing booked to book their first session', async () => {
    view();

    expect(await screen.findByText(/Book your first learning session/)).toBeTruthy();
    expect(screen.queryByText('My programme')).toBeNull();
    // Named twice now: in the invitation and in the prompt to pick a date.
    expect(screen.getAllByText(/Ann Coach/).length).toBeGreaterThan(0);
  });

  it('holds a learner whose session has not arrived, and says when it is', async () => {
    mocks.fetchState.mockResolvedValue(state({
      booked: true, access: 'waiting', startsOn: '2026-10-05',
      event: { scheduledTime: '10:00:00', meetingLink: 'https://teams.example/join' },
    }));
    view();

    expect(await screen.findByText(/Your programme starts on/)).toBeTruthy();
    expect(screen.getByText(/10:00 AM/)).toBeTruthy();
    // They can still join the meeting they are waiting for.
    expect(screen.getByRole('link', { name: /Join the Teams meeting/ })).toBeTruthy();
    expect(screen.queryByText('My programme')).toBeNull();
  });

  it('does not offer to move the session', async () => {
    mocks.fetchState.mockResolvedValue(state({
      booked: true, access: 'waiting', startsOn: '2026-10-05',
      event: { scheduledTime: '10:00:00', meetingLink: 'https://teams.example/join' },
    }));
    view();

    await screen.findByText(/Your programme starts on/);
    expect(screen.queryByRole('button', { name: /Reschedule/ })).toBeNull();
  });

  it('lets the learner through once the session day has come', async () => {
    mocks.fetchState.mockResolvedValue(state({ booked: true, access: 'open', startsOn: '2026-10-05' }));
    view();

    expect(await screen.findByText('My programme')).toBeTruthy();
  });

  it('never holds anyone who is not a learner', async () => {
    mocks.account = { role: 'staff', subjectId: 3 };
    view();

    expect(await screen.findByText('My programme')).toBeTruthy();
    expect(mocks.fetchState).not.toHaveBeenCalled();
  });

  it('leaves support and profile reachable while holding', async () => {
    // Somebody who cannot book, or who thinks the date is wrong, needs a way
    // to say so that is not an email address they do not have.
    mocks.fetchState.mockResolvedValue(state({ access: 'waiting', startsOn: '2026-10-05' }));
    view('/learner/support');

    expect(await screen.findByText('My programme')).toBeTruthy();
  });

  it('does not become a lockout when the check itself fails', async () => {
    // The learner has done nothing wrong; holding them out on a network error
    // would be the same screen as holding them out on purpose.
    mocks.fetchState.mockRejectedValue(new Error('offline'));
    view();

    expect(await screen.findByText('My programme')).toBeTruthy();
  });

  it('says who to contact when there is no case owner to book with', async () => {
    mocks.fetchState.mockResolvedValue(state({ caseOwner: null }));
    view();

    expect(await screen.findByText(/cannot be booked yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Book my first session/ })).toBeNull();
  });

  it('books the chosen slot and re-checks access', async () => {
    mocks.book.mockResolvedValue({ event: {}, warning: '' });
    view();

    await screen.findByText(/Book your first learning session/);
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-05' } });
    fireEvent.click(await screen.findByRole('button', { name: '11:00 AM' }));
    fireEvent.click(screen.getByRole('button', { name: /Book my first session/ }));

    await waitFor(() => expect(mocks.book).toHaveBeenCalledWith('commercial', '7', expect.objectContaining({
      sessionType: 'first-session',
      scheduledDate: '2026-10-05',
      scheduledTime: '11:00',
      durationMinutes: 60,
    })));
    // Re-read rather than assumed: the server decides whether they are in.
    await waitFor(() => expect(mocks.fetchState).toHaveBeenCalledTimes(2));
  });

  it('reports a refused booking instead of pretending it worked', async () => {
    mocks.book.mockRejectedValue(new Error('Sessions cannot be booked on Saturdays or Sundays.'));
    view();

    await screen.findByText(/Book your first learning session/);
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-10' } });
    fireEvent.click(await screen.findByRole('button', { name: '11:00 AM' }));
    fireEvent.click(screen.getByRole('button', { name: /Book my first session/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Saturdays or Sundays');
  });

  it('offers only the college day, so a session cannot start outside working hours', async () => {
    view();

    await screen.findByText(/Book your first learning session/);
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-05' } });

    await screen.findByRole('button', { name: '9:00 AM' });
    const times = within(screen.getByRole('group', { name: /Time \(UK\)/ })).getAllByRole('button');
    expect(times.map(button => button.textContent)).toEqual([
      '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
      '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM',
    ]);
  });

  it('asks for a date before offering any time, because availability is per day', async () => {
    view();

    await screen.findByText(/Book your first learning session/);
    expect(screen.getByText(/Choose a date to see the times Ann Coach is free/)).toBeTruthy();
    expect(mocks.fetchSlots).not.toHaveBeenCalled();
  });

  it('shows an hour the case owner is busy for, but will not let it be booked', async () => {
    // Hidden would read as the college not working at 11. Shown-and-disabled
    // says the true thing: that hour is taken.
    mocks.fetchSlots.mockResolvedValue(collegeDay(['11:00']));
    view();

    await screen.findByText(/Book your first learning session/);
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-05' } });

    const taken = await screen.findByRole('button', { name: /11:00 AM .* already booked/ });
    expect(taken).toBeDisabled();
    fireEvent.click(taken);
    expect(screen.getByRole('button', { name: /Book my first session/ })).toBeDisabled();
    expect(mocks.book).not.toHaveBeenCalled();
  });

  it('re-reads availability when the learner changes the day, and drops the old hour', async () => {
    mocks.fetchSlots.mockResolvedValueOnce(collegeDay());
    mocks.fetchSlots.mockResolvedValueOnce(collegeDay(['11:00']));
    view();

    await screen.findByText(/Book your first learning session/);
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-05' } });
    fireEvent.click(await screen.findByRole('button', { name: '11:00 AM' }));
    expect(screen.getByRole('button', { name: /Book my first session/ })).not.toBeDisabled();

    // The second day has 11:00 taken, so the hour picked on the first must not
    // survive into it.
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-06' } });

    await waitFor(() => expect(mocks.fetchSlots).toHaveBeenCalledTimes(2));
    expect(mocks.fetchSlots).toHaveBeenLastCalledWith('commercial', '7', '2026-10-06', expect.anything());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Book my first session/ })).toBeDisabled());
  });

  it('still offers the college day when the case owner calendar is not linked', async () => {
    // A calendar nobody can read must not lock a learner out of starting their
    // programme: the hours are offered unchecked, and said to be unchecked.
    mocks.fetchSlots.mockResolvedValue(
      collegeDay([], 'Could not check the coach calendar. Please retry before booking.'),
    );
    mocks.book.mockResolvedValue({ event: {}, warning: '' });
    view();

    await screen.findByText(/Book your first learning session/);
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-05' } });

    expect(await screen.findByText(/these are the\s+college/)).toBeTruthy();
    // And it is still bookable — that is the whole point of the fallback.
    fireEvent.click(screen.getByRole('button', { name: '11:00 AM' }));
    fireEvent.click(screen.getByRole('button', { name: /Book my first session/ }));

    await waitFor(() => expect(mocks.book).toHaveBeenCalledWith('commercial', '7', expect.objectContaining({
      scheduledTime: '11:00',
    })));
  });

  it('says the calendar could not be read rather than showing an empty day', async () => {
    // "No times" would send the learner hunting for another date to fix a
    // problem that is not about the date.
    mocks.fetchSlots.mockRejectedValue(new Error('Could not check the coach calendar.'));
    view();

    await screen.findByText(/Book your first learning session/);
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-05' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check the coach calendar.');
  });
});
