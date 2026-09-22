import { beforeEach, expect, it, vi } from 'vitest';
import { fetchCurriculumTeamsMeetingSummaries } from '@/lib/curriculumApi';
import { fetchModuleSessionPlan, updateTeamsMeetingSchedule } from '../../../module-builder/moduleAuthoringData';
import { pushModulePlanToTeams } from '../teamsCalendarPush';

vi.mock('@/lib/curriculumApi', async original => ({
  ...(await original<typeof import('@/lib/curriculumApi')>()), fetchCurriculumTeamsMeetingSummaries: vi.fn(),
}));
vi.mock('../../../module-builder/moduleAuthoringData', async original => ({
  ...(await original<typeof import('../../../module-builder/moduleAuthoringData')>()),
  fetchModuleSessionPlan: vi.fn(), updateTeamsMeetingSchedule: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchModuleSessionPlan).mockResolvedValue({ sessions: ['2026-10-23', '2026-10-30'].map(date => ({
    date, startTime: '09:00', endTime: '11:00', durationMinutes: 120,
  })) } as never);
  vi.mocked(updateTeamsMeetingSchedule).mockResolvedValue({ updated: true, warnings: [] } as never);
});

it.each([
  ['Africa/Cairo', ['2026-10-23T06:00:00.000Z', '2026-10-30T07:00:00.000Z']],
  ['Europe/London', ['2026-10-23T08:00:00.000Z', '2026-10-30T09:00:00.000Z']],
  [undefined, ['2026-10-23T08:00:00.000Z', '2026-10-30T09:00:00.000Z']],
])('retains the module calendar zone %s when its dates are updated', async (timeZone, starts) => {
  vi.mocked(fetchCurriculumTeamsMeetingSummaries).mockResolvedValue([
    { moduleCatalogueId: 'MOD-OTHER', liveSessionId: 'LIVE-OTHER', timeZone: 'Europe/London' },
    { moduleCatalogueId: 'MOD-EGYPT', liveSessionId: 'LIVE-EGYPT', organizerEmail: 'organizer@example.invalid', timeZone },
  ] as never);
  await pushModulePlanToTeams({ moduleCatalogueId: 'MOD-EGYPT' });
  expect(updateTeamsMeetingSchedule).toHaveBeenCalledWith('LIVE-EGYPT', expect.objectContaining({
    scheduledOccurrences: (starts as string[]).map((startDateTimeUtc, index) => ({ sessionNumber: index + 1, startDateTimeUtc, durationMinutes: 120 })),
  }));
  expect(updateTeamsMeetingSchedule).toHaveBeenCalledTimes(1);
  expect(vi.mocked(updateTeamsMeetingSchedule).mock.calls[0][1]).not.toHaveProperty('attendees');
});
