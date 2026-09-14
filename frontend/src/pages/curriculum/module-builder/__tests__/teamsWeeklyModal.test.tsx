import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { fetchCurriculumHolidays, fetchCurriculumSessions } from '@/lib/curriculumApi';
import { TeamsMeetingModal } from '../TeamsMeetingModal';
import { createTeamsMeeting, loadTeamsMeetingConfiguration, fetchModuleMeetingInvitees, restoreModuleTeamsMeeting } from '../moduleAuthoringData';

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({ showCurriculumAlert: vi.fn() }));
vi.mock('@/lib/curriculumApi', async original => ({
  ...(await original<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumSessions: vi.fn(), fetchCurriculumHolidays: vi.fn(),
}));
vi.mock('../moduleAuthoringData', async original => ({
  ...(await original<typeof import('../moduleAuthoringData')>()),
  createTeamsMeeting: vi.fn(), loadTeamsMeetingConfiguration: vi.fn(),
  fetchModuleMeetingInvitees: vi.fn(), restoreModuleTeamsMeeting: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadTeamsMeetingConfiguration).mockResolvedValue({ configured: true, defaultOrganizer: 'tutor@example.com', organizerLocked: false, timeZone: 'GMT Standard Time', timeZoneIana: 'Europe/London' });
  vi.mocked(fetchCurriculumHolidays).mockResolvedValue([]);
  vi.mocked(fetchModuleMeetingInvitees).mockResolvedValue({ attendees: [], presenters: [] } as never);
  vi.mocked(fetchCurriculumSessions).mockResolvedValue([
    { id: 'one', componentId: 'COMP-MON', moduleCatalogueId: 'MOD-ONE', date: '2026-09-07', day: 'Monday', startTime: '09:00', endTime: '11:00' },
    { id: 'two', componentId: 'COMP-THU', moduleCatalogueId: 'MOD-ONE', date: '2026-09-10', day: 'Thursday', startTime: '19:00', endTime: '20:00' },
  ] as never);
  vi.mocked(restoreModuleTeamsMeeting).mockResolvedValue({ updated: true } as never);
  vi.mocked(createTeamsMeeting).mockResolvedValue({
    created: true, warnings: [], meeting: {
      liveSessionId: 'LIVE-ONE', eventId: 'MON', joinUrl: 'https://teams.example/monday', onlineMeetingId: 'meeting-mon',
      organizerEmail: 'tutor@example.com', settingsApplied: true, durationMinutes: 120, startDateTimeUtc: '2026-09-07T08:00:00Z',
      calendarSeries: [
        { day: 'Monday', eventId: 'MON', joinUrl: 'https://teams.example/monday', onlineMeetingId: 'meeting-mon', sessionNumbers: [1] },
        { day: 'Thursday', eventId: 'THU', joinUrl: 'https://teams.example/thursday', onlineMeetingId: 'meeting-thu', sessionNumbers: [2] },
      ],
    },
  } as never);
});

it('creates from the module times and gives a Thursday component its own series link', async () => {
  const onCreated = vi.fn();
  render(<TeamsMeetingModal module={{ catalogueId: 'MOD-ONE', title: 'Two weekly sessions' }}
    component={{ id: 'COMP-THU', title: 'Thursday session', type: 'live-session', settings: { sessionDate: '2026-09-10' } } as never}
    onClose={vi.fn()} onCreated={onCreated} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create', exact: true })).toBeEnabled());
  expect(screen.getByRole('combobox', { name: /Teams series and links/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Create', exact: true }));
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
  expect(createTeamsMeeting).toHaveBeenCalledWith(expect.objectContaining({ seriesMode: 'auto', scheduledOccurrences: [
    { sessionNumber: 1, startDateTimeUtc: '2026-09-07T08:00:00.000Z', durationMinutes: 120 },
    { sessionNumber: 2, startDateTimeUtc: '2026-09-10T18:00:00.000Z', durationMinutes: 60 },
  ] }));
  expect(restoreModuleTeamsMeeting).toHaveBeenCalledWith('MOD-ONE');
  expect(onCreated.mock.calls[0][0].meeting).toMatchObject({ joinUrl: 'https://teams.example/thursday', eventId: 'THU', onlineMeetingId: 'meeting-thu', durationMinutes: 60, startDateTimeUtc: '2026-09-10T18:00:00.000Z' });
});
