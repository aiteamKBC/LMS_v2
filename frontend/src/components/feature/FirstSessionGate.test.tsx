import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirstSessionGate } from './FirstSessionGate';

const mocks = vi.hoisted(() => ({
  fetchState: vi.fn(),
  book: vi.fn(),
  reschedule: vi.fn(),
  account: { role: 'learner', subjectId: 7, learnerType: 'commercial' } as Record<string, unknown> | null,
  logout: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ auth: { account: mocks.account }, logout: mocks.logout }),
}));
vi.mock('@/api/learnerCalendar', () => ({
  fetchLearnerFirstSession: mocks.fetchState,
  bookLearnerCalendarSession: mocks.book,
  rescheduleLearnerCalendarSession: mocks.reschedule,
}));
vi.mock('./RouteLoadingSkeleton', () => ({ RouteLoadingSkeleton: () => <p>Loading…</p> }));

const owner = { name: 'Ann Coach', email: 'ann@kbc.test' };

function state(overrides: Record<string, unknown> = {}) {
  return { caseOwner: owner, booked: false, event: null, startsOn: null, access: 'book', ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  mocks.account = { role: 'learner', subjectId: 7, learnerType: 'commercial' };
  mocks.fetchState.mockResolvedValue(state());
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
    expect(screen.getByText(/Ann Coach/)).toBeTruthy();
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
    fireEvent.click(within(screen.getByRole('list', { name: 'Hour' })).getByRole('button', { name: '11' }));
    fireEvent.click(within(screen.getByRole('list', { name: 'Minute' })).getByRole('button', { name: '30' }));
    fireEvent.click(screen.getByRole('button', { name: /Book my first session/ }));

    await waitFor(() => expect(mocks.book).toHaveBeenCalledWith('commercial', '7', expect.objectContaining({
      sessionType: 'first-session',
      scheduledDate: '2026-10-05',
      scheduledTime: '11:30',
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
    fireEvent.click(within(screen.getByRole('list', { name: 'Hour' })).getByRole('button', { name: '11' }));
    fireEvent.click(screen.getByRole('button', { name: /Book my first session/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Saturdays or Sundays');
  });

  it('offers only the college day, so a session cannot start outside working hours', async () => {
    view();

    await screen.findByText(/Book your first learning session/);
    const hours = within(screen.getByRole('list', { name: 'Hour' })).getAllByRole('button');
    expect(hours.map(h => h.textContent)).toEqual(['09', '10', '11', '12', '13', '14', '15', '16']);
  });
});

describe('rescheduling from the learner page', () => {
  const waiting = () => state({
    booked: true, access: 'waiting', startsOn: '2026-09-22',
    event: {
      eventKey: 'first-session:7:1:2026-09-22',
      scheduledTime: '10:00:00',
      durationMinutes: 60,
      meetingLink: 'https://teams.example/join',
    },
  });

  it('offers the learner a way to move their own session', async () => {
    mocks.fetchState.mockResolvedValue(waiting());
    view();

    expect(await screen.findByRole('button', { name: /Reschedule/ })).toBeTruthy();
  });

  it('moves the existing meeting rather than booking a second one', async () => {
    mocks.fetchState.mockResolvedValue(waiting());
    mocks.reschedule.mockResolvedValue({ event: {}, warning: '' });
    view();

    fireEvent.click(await screen.findByRole('button', { name: /Reschedule/ }));
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-09-24' } });
    fireEvent.click(within(screen.getByRole('list', { name: 'Hour' })).getByRole('button', { name: '14' }));
    fireEvent.click(within(screen.getByRole('list', { name: 'Minute' })).getByRole('button', { name: '30' }));
    fireEvent.click(screen.getByRole('button', { name: /Move my session/ }));

    await waitFor(() => expect(mocks.reschedule).toHaveBeenCalledWith('commercial', '7', expect.objectContaining({
      eventKey: 'first-session:7:1:2026-09-22',
      scheduledDate: '2026-09-24',
      scheduledTime: '14:30',
      durationMinutes: 60,
    })));
    // Never a second booking: that would leave two meetings and two invites.
    expect(mocks.book).not.toHaveBeenCalled();
    // Access is re-read, because moving the session moves the start date.
    await waitFor(() => expect(mocks.fetchState).toHaveBeenCalledTimes(2));
  });

  it('will not submit an unchanged slot', async () => {
    mocks.fetchState.mockResolvedValue(waiting());
    view();

    fireEvent.click(await screen.findByRole('button', { name: /Reschedule/ }));

    expect(screen.getByRole('button', { name: /Move my session/ })).toBeDisabled();
  });

  it('goes back without moving anything when the learner changes their mind', async () => {
    mocks.fetchState.mockResolvedValue(waiting());
    view();

    fireEvent.click(await screen.findByRole('button', { name: /Reschedule/ }));
    fireEvent.click(screen.getByRole('button', { name: /Keep it as it is/ }));

    expect(await screen.findByText(/Your programme starts on/)).toBeTruthy();
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });

  it('reports a refused move instead of pretending it worked', async () => {
    mocks.fetchState.mockResolvedValue(waiting());
    mocks.reschedule.mockRejectedValue(new Error('Sessions cannot be booked on Saturdays or Sundays.'));
    view();

    fireEvent.click(await screen.findByRole('button', { name: /Reschedule/ }));
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-09-26' } });
    fireEvent.click(screen.getByRole('button', { name: /Move my session/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Saturdays or Sundays');
  });
});
