import { beforeEach, expect, it, vi } from 'vitest';
import { fetchCurriculumTeamsMeetingSummaries } from '@/lib/curriculumApi';
import { fetchModuleSessionPlan, loadModuleStructure, updateTeamsMeetingSchedule } from '../../../module-builder/moduleAuthoringData';
import { pushModulePlanToTeams } from '../teamsCalendarPush';

vi.mock('@/lib/curriculumApi', async original => ({
  ...(await original<typeof import('@/lib/curriculumApi')>()), fetchCurriculumTeamsMeetingSummaries: vi.fn(),
}));
vi.mock('../../../module-builder/moduleAuthoringData', async original => ({
  ...(await original<typeof import('../../../module-builder/moduleAuthoringData')>()),
  fetchModuleSessionPlan: vi.fn(), updateTeamsMeetingSchedule: vi.fn(), loadModuleStructure: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchModuleSessionPlan).mockResolvedValue({ sessions: ['2026-10-23', '2026-10-30'].map(date => ({
    date, startTime: '09:00', endTime: '11:00', durationMinutes: 120,
  })) } as never);
  vi.mocked(updateTeamsMeetingSchedule).mockResolvedValue({ updated: true, warnings: [] } as never);
  // No authored weeks: every planned date is the module calendar's, as before.
  vi.mocked(loadModuleStructure).mockResolvedValue(null);
});

it('never sends a week delivered by an additional meeting, or one not yet assigned to either calendar', async () => {
  const live = (id: string, settings: Record<string, unknown>) => ({ id, type: 'live-session', title: id, settings });
  vi.mocked(loadModuleStructure).mockResolvedValue({ weekStructure: [
    { weekNumber: 1, components: [live('C1', { teamsOccurrenceId: 'OCC-1', teamsSessionNumber: 1 })] },
    { weekNumber: 2, components: [live('C2', { extraTeamsMeetingUrl: 'https://teams.example.invalid/extra' })] },
    { weekNumber: 3, components: [live('C3', {})] },
    { weekNumber: 4, components: [live('C4', { teamsMeetingScope: 'main' })] },
    { weekNumber: 5, components: [live('C5', { teamsMeetingScope: 'additional' })] },
  ] } as never);
  vi.mocked(fetchModuleSessionPlan).mockResolvedValue({ sessions: [1, 2, 3, 4, 5].map(weekNumber => ({
    weekNumber, date: `2026-11-0${weekNumber + 1}`, startTime: '09:00', endTime: '11:00', durationMinutes: 120,
  })) } as never);
  vi.mocked(fetchCurriculumTeamsMeetingSummaries).mockResolvedValue([
    { moduleCatalogueId: 'MOD-1', liveSessionId: 'LIVE-1', organizerEmail: 'organizer@example.invalid', timeZone: 'Africa/Cairo' },
  ] as never);

  const pushed = await pushModulePlanToTeams({ moduleCatalogueId: 'MOD-1' });

  const sent = vi.mocked(updateTeamsMeetingSchedule).mock.calls[0][1].scheduledOccurrences || [];
  expect(sent.map(item => item.startDateTimeUtc.slice(0, 10))).toEqual(['2026-11-02', '2026-11-05']);
  expect(pushed.sessionCount).toBe(2);
});

it('sends nothing when the module weeks cannot be read', async () => {
  vi.mocked(loadModuleStructure).mockRejectedValue(new Error('Network down'));
  vi.mocked(fetchCurriculumTeamsMeetingSummaries).mockResolvedValue([
    { moduleCatalogueId: 'MOD-1', liveSessionId: 'LIVE-1', timeZone: 'Africa/Cairo' },
  ] as never);
  await expect(pushModulePlanToTeams({ moduleCatalogueId: 'MOD-1' })).rejects.toThrow('Network down');
  expect(updateTeamsMeetingSchedule).not.toHaveBeenCalled();
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
