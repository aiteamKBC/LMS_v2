import { beforeEach, expect, it, vi } from 'vitest';
import { calendarAction } from '../calendarActions';
import { coachFetch } from '@/lib/coachFetch';
import { clearCurriculumGetCache } from '@/lib/curriculumApi';
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
vi.mock('@/lib/curriculumApi', () => ({ clearCurriculumGetCache: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it('uses authenticated transport with the exact stored series id', async () => {
  vi.mocked(coachFetch).mockResolvedValue({ ok: true, json: async () => ({ status: 'done', message: 'Saved' }) } as Response);
  await calendarAction('LIVE/ONE', { stage: 'confirm', reviewToken: 'review', acknowledgeNotifications: true });
  expect(vi.mocked(coachFetch).mock.calls[0][0]).toBe('/curriculum_api/curriculum/teams-meetings/LIVE%2FONE/actions/');
  expect(vi.mocked(coachFetch).mock.calls[0][1]?.method).toBe('POST');
  expect(clearCurriculumGetCache).toHaveBeenCalledOnce();
});
it('rejects an incomplete review before allowing confirmation', async () => {
  vi.mocked(coachFetch).mockResolvedValue({ ok: true, json: async () => ({ reviewToken: 'review' }) } as Response);
  await expect(calendarAction('LIVE-1', { stage: 'review' })).rejects.toThrow('could not be verified');
  expect(clearCurriculumGetCache).not.toHaveBeenCalled();
});
it('reports the backend error without retrying a calendar change', async () => {
  vi.mocked(coachFetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Review expired' }) } as Response);
  await expect(calendarAction('LIVE-1', { stage: 'confirm' })).rejects.toThrow('Review expired');
  expect(coachFetch).toHaveBeenCalledOnce();
});
