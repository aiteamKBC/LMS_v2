import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readLearnerJson } from '@/api/learnerRead';
import { clearCoachViewAs, setCoachViewAs } from '@/lib/coachViewAs';
import { completeLogMonth, getLogContent, getLogMonth, getLogSummary, signLogMonth } from './api';

vi.mock('@/api/learnerRead', () => ({ readLearnerJson: vi.fn(), invalidateLearnerReads: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  setCoachViewAs({ email: 'other-coach@example.test' }, 'admin@example.test');
  vi.mocked(readLearnerJson).mockResolvedValue({ parts: [] });
});
afterEach(() => { clearCoachViewAs(); vi.unstubAllGlobals(); window.history.pushState({}, '', '/'); });

describe('monthly log workspace scope', () => {
  it('does not carry a previous coach selection into any learner record request', async () => {
    await getLogSummary('7', undefined, 'learner');
    await getLogMonth('7', '2026-08', undefined, 'learner');
    await getLogContent('7', '2026-08', 44, 'learner');
    const urls = vi.mocked(readLearnerJson).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([
      '/learner_api/monthly-logs/7/?perspective=learner',
      '/learner_api/monthly-logs/7/2026-08/?perspective=learner',
      '/learner_api/monthly-logs/7/2026-08/activities/44/?perspective=learner',
    ]);
  });

  it('keeps the selected coach scope in the coach workspace', async () => {
    await getLogSummary('7', undefined, 'coach');
    expect(readLearnerJson).toHaveBeenCalledWith(
      '/learner_api/monthly-logs/7/?perspective=coach&viewAsCoach=other-coach%40example.test', expect.anything());
  });

  it('requests the linked MCM month so an unsigned empty log can be displayed', async () => {
    window.history.pushState({}, '', '/learner/monthly-logs/apprenticeship/7/2026-09?workflow=mcm&source=mcm');
    await getLogSummary('7', undefined, 'learner', '2026-09');
    expect(readLearnerJson).toHaveBeenCalledWith(
      '/learner_api/monthly-logs/7/?perspective=learner&workflow=mcm&month=2026-09', expect.anything());
  });

  it('carries the MCM workflow when the report is embedded outside the logs route', async () => {
    window.history.pushState({}, '', '/learner/monthly-coaching/mcr-7');
    await getLogSummary('7', undefined, 'learner', '2026-09', 'mcm');
    await getLogMonth('7', '2026-09', undefined, 'learner', false, 'mcm');
    expect(readLearnerJson).toHaveBeenNthCalledWith(1,
      '/learner_api/monthly-logs/7/?perspective=learner&workflow=mcm&month=2026-09', expect.anything());
    expect(readLearnerJson).toHaveBeenNthCalledWith(2,
      '/learner_api/monthly-logs/7/2026-09/?perspective=learner&workflow=mcm', expect.anything());
  });

  it('carries the perspective and CSRF token when saving a signature', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ month: '2026-09' }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await signLogMonth('7', '2026-09', 'reviewed', new Blob(['signature']), 'draw', 'token', 'learner');
    expect(fetcher).toHaveBeenCalledWith('/learner_api/monthly-logs/7/2026-09/sign/?perspective=learner',
      expect.objectContaining({ method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': 'token' } }));
  });

  it('completes the explicitly selected learner month without a stale coach scope', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ month: '2026-08', source: 'legacy' })));
    vi.stubGlobal('fetch', fetcher);
    await completeLogMonth('7', '2026-08', 'token', 'learner');
    expect(fetcher).toHaveBeenCalledWith('/learner_api/monthly-logs/7/2026-08/complete/?perspective=learner',
      expect.objectContaining({ method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': 'token' } }));
  });
});
