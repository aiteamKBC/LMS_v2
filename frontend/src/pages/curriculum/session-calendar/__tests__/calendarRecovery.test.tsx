import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumSession } from '@/lib/curriculumApi';
import SessionCalendarPage from '../page';

const api = vi.hoisted(() => ({ sessions: vi.fn(), holidays: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/curriculumApi')>(),
  fetchCurriculumSessions: api.sessions,
  fetchCurriculumHolidays: api.holidays,
  updateCurriculumSession: api.update,
  subscribeCurriculumRemoteWrites: () => () => {},
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const session: CurriculumSession = {
  id: 'synthetic-session', trainingPlanId: 'synthetic-plan', title: 'Communication workshop',
  type: 'Live Session', date: '2026-11-11', day: 'Wednesday', startTime: '12:00', endTime: '13:00',
  tutor: 'Synthetic tutor', group: 'Synthetic group', cohort: 'Synthetic cohort',
  programme: 'Synthetic programme', module: 'Synthetic module', week: 1, venue: 'Online',
  status: 'scheduled', ksbCodes: [],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  api.sessions.mockReset().mockResolvedValue([session]);
  api.holidays.mockReset().mockResolvedValue([]);
  api.update.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const show = () => render(<MemoryRouter><SessionCalendarPage /></MemoryRouter>);

describe('session calendar read recovery', () => {
  it('retries a failed read without exposing transport detail or changing the schedule', async () => {
    const original = structuredClone(session);
    api.sessions.mockRejectedValueOnce(new Error('SQL: synthetic private transport detail'));
    show();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The session calendar could not be loaded');
    expect(alert).not.toHaveTextContent(/SQL|private transport/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(session.title)).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.sessions).toHaveBeenCalledTimes(2);
    expect(session).toEqual(original);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('retains saved sessions during a failed return refresh and recovers the latest read', async () => {
    show();
    expect(await screen.findByText(session.title)).toBeVisible();
    let rejectRead!: (error: Error) => void;
    api.sessions.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(api.sessions).toHaveBeenCalledTimes(2));
    expect(api.sessions).toHaveBeenLastCalledWith(expect.any(AbortSignal), { revalidate: true });
    expect(screen.getByText(session.title)).toBeVisible();
    await act(async () => rejectRead(new Error('Synthetic refresh failure')));
    expect(await screen.findByRole('alert')).toHaveTextContent('The session calendar could not be loaded');
    expect(screen.getByText(session.title)).toBeVisible();
    api.sessions.mockResolvedValueOnce([{ ...session, title: 'Updated communication workshop' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Updated communication workshop')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.sessions).toHaveBeenCalledTimes(3);
    expect(api.update).not.toHaveBeenCalled();
  });
});
