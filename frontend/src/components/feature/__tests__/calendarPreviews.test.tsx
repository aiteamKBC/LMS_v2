import * as React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppIcon } from '../AppIcon';
import CoachTimetablePage from '@/pages/coach/timetable/page';
import SessionCalendarPage from '@/pages/curriculum/session-calendar/page';
import { AllCoachesCalendar } from '@/pages/workspace/coach/AllCoachesCalendar';
import { coachFetch } from '@/lib/coachFetch';
import { fetchCoachCalendarEventsForCoach } from '@/pages/coach/shared/calendarEvents';
import { updateCurriculumSession } from '@/lib/curriculumApi';

const fixtures = vi.hoisted(() => {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return {
    event: { id: 'meeting-1', eventKey: 'catch-up:1', title: 'Coaching appointment', source: 'catch-up', type: 'coaching',
      year: now.getFullYear(), month: now.getMonth(), dayOfMonth: now.getDate(), dayOfWeek: (now.getDay() + 6) % 7,
      date, scheduledDate: date, scheduledTime: '10:00', startHour: 10, endHour: 11, durationMinutes: 60,
      status: 'scheduled', learner: 'Test learner', learnerId: '125', learnerType: 'commercial', programme: 'Marketing',
      meetingLink: 'https://teams.microsoft.com/meet/example', priority: 'normal', notes: 'Coaching preparation notes.' },
    sessions: [{ id: 'session-1', trainingPlanId: 1, title: 'Marketing workshop', type: 'Live Session', date, day: 'Monday',
      startTime: '10:00', endTime: '11:00', tutor: 'Assigned tutor', group: 'Group A', cohort: 'September',
      programme: 'Marketing', venue: 'Teams', module: 'Introduction', week: 1, status: 'scheduled', ksbCodes: [] }],
    coach: { id: 1, name: 'Assigned coach', email: 'coach@example.test', caseloadCount: 1, activeLearnerCount: 1, isInitialized: true, isViewingAsCoach: false },
  };
});
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => fixtures.coach }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn(async () => new Response(JSON.stringify({ events: [fixtures.event] }))) }));
vi.mock('@/pages/coach/shared/CoachMeetingArtifactsPanel', () => ({ CoachMeetingArtifactsPanel: () => <p>Meeting recordings</p> }));
vi.mock('@/pages/coach/shared/calendarEvents', async importOriginal => ({
  ...await importOriginal<typeof import('@/pages/coach/shared/calendarEvents')>(),
  fetchCoachCalendarEventsForCoach: vi.fn(async () => ({ events: [fixtures.event] })),
}));
vi.mock('@/hooks/useCurriculumSessions', () => ({ useCurriculumSessions: () => ({ sessions: fixtures.sessions, loading: false, error: null, reload: vi.fn() }) }));
vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/curriculumApi')>(),
  fetchCurriculumHolidays: vi.fn(async () => []), updateCurriculumSession: vi.fn(),
}));

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('AppIcon', AppIcon); vi.stubGlobal('React', React); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('staff calendar previews', () => {
  it.each(['Month', 'Week', 'Day'])('opens a coach event from %s and exposes its edit action', async view => {
    const user = userEvent.setup();
    render(<MemoryRouter><CoachTimetablePage /></MemoryRouter>);
    await screen.findAllByRole('button', { name: /Coaching appointment/ });
    if (view !== 'Month') await user.click(screen.getByRole('button', { name: view }));
    await user.click(screen.getAllByRole('button', { name: /Coaching appointment/ })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Coaching appointment' });
    expect(within(dialog).getByText('Test learner')).toBeVisible();
    expect(within(dialog).getByText('Coaching preparation notes.')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: /Reschedule|Edit schedule/i }));
    expect(screen.queryByRole('dialog', { name: 'Coaching appointment' })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('10:00')).toBeVisible();
    expect(vi.mocked(coachFetch).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  });

  it('previews a curriculum session and opens its edit form without saving', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><SessionCalendarPage /></MemoryRouter>);
    await user.click((await screen.findAllByRole('button', { name: /Marketing workshop/ }))[0]);
    const dialog = screen.getByRole('dialog', { name: 'Marketing workshop' });
    expect(within(dialog).getByText('Assigned tutor')).toBeVisible();
    expect(within(dialog).getByText('Group A')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Edit Session' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    expect(screen.getByDisplayValue('10:00')).toBeVisible();
    expect(updateCurriculumSession).not.toHaveBeenCalled();
  });

  it('previews the all-coaches event before navigating to the coach timetable', async () => {
    const user = userEvent.setup();
    const openCoach = vi.fn();
    render(<AllCoachesCalendar coaches={[fixtures.coach]} onOpenCoach={openCoach} />);
    await user.click((await screen.findAllByRole('button', { name: /Test learner/ }))[0]);
    expect(openCoach).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Coaching appointment' });
    expect(within(dialog).getByText('Assigned coach')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Open coach timetable' }));
    expect(openCoach).toHaveBeenCalledWith(fixtures.coach, fixtures.event);
    expect(fetchCoachCalendarEventsForCoach).toHaveBeenCalled();
  });
});
