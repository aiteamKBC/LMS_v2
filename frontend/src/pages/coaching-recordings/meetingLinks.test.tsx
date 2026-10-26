import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { loadCoachingCalendar, loadCoachingSession, loadSavedCoachingEvidence, loadLinkedCoachingMeeting, type CoachingCalendar, type CoachingMeeting } from '@/api/coachingRecordings';
import Page from './page';
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/api/coachingRecordings', async () => ({ ...await vi.importActual<typeof import('@/api/coachingRecordings')>('@/api/coachingRecordings'), loadCoachingCalendar: vi.fn(), loadCoachingSession: vi.fn(), loadSavedCoachingEvidence: vi.fn(), loadLinkedCoachingMeeting: vi.fn() }));
const id = 'a'.repeat(32);
const meeting: CoachingMeeting = { meetingId: id, calendarEventId: 'event', eventKey: null, candidateEventKeys: [], learnerIds: ['1'], family: 'MCM', category: 'MCM', title: 'Synthetic linked MCM',
  coachEmail: 'coach@example.invalid', startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T10:00:00Z', phase: 'ended', match: 'external', readyToAction: true, recordingsReference: 'renewed-reference',
  media: { state: 'ready', readyCount: 1, recordings: [{ id: 'file', state: 'ready' }] } };
const coach = { email: meeting.coachEmail, name: 'Synthetic Coach' };
const calendar: CoachingCalendar = { start: '2026-10-20', end: '2026-10-20', timeZone: 'UTC', scope: 'all', coaches: [coach], learners: [{ id: '1', name: 'Synthetic Learner', coachEmail: coach.email, learnerType: 'apprenticeship' }],
  meetings: [meeting], lmsOnly: [], cancelledBookings: [], errors: [], partial: false, coverage: { checkedCoachEmails: [coach.email], totalCoaches: 1, nextOffset: null } };
function History() { const location = useLocation(), navigate = useNavigate(); return <><output data-testid="url">{location.search}</output><button onClick={() => navigate(-1)}>Browser Back</button><button onClick={() => navigate(1)}>Browser Forward</button></>; }
const mount = (url = '/curriculum/coaching-recordings?date=2026-10-20&zone=UTC') => render(<MemoryRouter initialEntries={[url]}><History /><Page /></MemoryRouter>);
describe('Meeting deep links', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    vi.mocked(loadCoachingCalendar).mockReset().mockResolvedValue(calendar);
    vi.mocked(loadLinkedCoachingMeeting).mockReset().mockResolvedValue({ meeting, coach, learners: [{ id: '1', name: 'Synthetic Learner' }], syncedAt: '2026-10-20T12:00:00Z' });
    vi.mocked(loadCoachingSession).mockReset().mockResolvedValue({ eventKey: 'saved', media: meeting.media, partial: false, attendance: { state: 'available', reportCount: 1, rows: [] } });
    vi.mocked(loadSavedCoachingEvidence).mockReset().mockResolvedValue({ state: 'matched', source: 'coaching-session', transcript: null, analyses: [] });
  });
  afterEach(() => vi.useRealTimers());
  it('writes a stable meeting ID and tab, and Back/Forward restore them without more calendar or PDF requests', async () => {
    mount(); fireEvent.click(await screen.findByRole('button', { name: /^View Synthetic linked MCM/ }));
    const drawer = within(screen.getByRole('dialog', { name: 'Meeting details' }));
    fireEvent.click(await drawer.findByRole('button', { name: 'AI analysis' }));
    await drawer.findByText(/no saved AI report is linked/);
    expect(screen.getByTestId('url')).toHaveTextContent(`meeting=${id}`); expect(screen.getByTestId('url')).toHaveTextContent('tab=analysis');
    expect(screen.getByTestId('url').textContent).not.toContain('renewed-reference');
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
    await waitFor(() => expect(drawer.getByRole('button', { name: 'AI analysis' })).toHaveAttribute('aria-expanded', 'false'));
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
    expect(screen.queryByRole('dialog', { name: 'Meeting details' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Browser Forward' }));
    expect(await screen.findByRole('dialog', { name: 'Meeting details' })).toBeVisible();
    expect(loadCoachingCalendar).toHaveBeenCalledOnce(); expect(loadLinkedCoachingMeeting).not.toHaveBeenCalled();
  });
  it('restores a direct URL before the calendar finishes and keeps the requested filters and tab', async () => {
    vi.mocked(loadCoachingCalendar).mockImplementation(() => new Promise(() => {}));
    mount(`/curriculum/coaching-recordings?date=2026-10-19&view=week&zone=UTC&coach=${encodeURIComponent(coach.email)}&status=all&meeting=${id}&on=2026-10-20&tab=analysis`);
    const drawer = within(await screen.findByRole('dialog', { name: 'Meeting details' }));
    expect(await drawer.findByText(/no saved AI report is linked/)).toBeInTheDocument();
    expect(loadLinkedCoachingMeeting).toHaveBeenCalledWith(id, '2026-10-20', 'UTC', expect.any(AbortSignal), false);
    expect(screen.getByRole('combobox', { name: 'Calendar period' })).toHaveValue('week');
    expect(screen.getByRole('button', { name: 'All meetings' })).toHaveAttribute('aria-pressed', 'true');
    expect(loadCoachingCalendar).toHaveBeenCalledOnce(); expect(loadCoachingSession).toHaveBeenCalledOnce(); expect(loadSavedCoachingEvidence).toHaveBeenCalledOnce();
  });
  it('keeps an unavailable link explicit and closes it without changing the saved filters', async () => {
    vi.mocked(loadCoachingCalendar).mockResolvedValue({ ...calendar, meetings: [] });
    vi.mocked(loadLinkedCoachingMeeting).mockRejectedValue(new Error('This meeting may have moved.'));
    mount(`/curriculum/coaching-recordings?date=2026-10-20&zone=UTC&status=all&meeting=${id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('may have moved');
    fireEvent.click(screen.getByRole('button', { name: 'Close meeting link' }));
    expect(screen.getByTestId('url')).not.toHaveTextContent('meeting=');
    expect(screen.getByTestId('url')).toHaveTextContent('status=all');
    expect(loadCoachingCalendar).toHaveBeenCalledOnce();
  });
});
