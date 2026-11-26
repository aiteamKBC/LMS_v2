import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { feedbackApi, type FeedbackClassificationReport, type FeedbackDashboardReport } from '@/api/feedback';
import { useQualityNotifications } from './useQualityNotifications';

type ClassifiedResponse = FeedbackClassificationReport['responses'][number];
const negative: ClassifiedResponse = {
  responseId: 14, formId: 3, formTitle: 'Synthetic feedback', formType: 'post_lecture', version: 1,
  respondent: 'Anonymous learner', score: 0, classification: 'negative', scoredQuestions: 1,
  submittedAt: '2026-11-17T10:00:00Z', contextTitle: 'Synthetic session', groupName: 'Synthetic group',
};
const report = (responses: ClassifiedResponse[]) => ({ analytics: { insights: { classification: { responses } } } as FeedbackDashboardReport });

beforeEach(() => vi.spyOn(feedbackApi, 'insightsDashboard').mockResolvedValue(report([negative])));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('live quality alerts', () => {
  it('uses server classifications and preserves anonymous respondents and a zero score', async () => {
    vi.mocked(feedbackApi.insightsDashboard).mockResolvedValue(report([
      negative, { ...negative, responseId: 15, classification: 'positive' },
      { ...negative, responseId: 16, classification: 'neutral' },
      { ...negative, responseId: 17, classification: 'unscored', score: null },
    ]));
    const { result } = renderHook(() => useQualityNotifications(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(feedbackApi.insightsDashboard).toHaveBeenCalledExactlyOnceWith({ classification: 'negative' });
    expect(result.current.notifications).toEqual([{
      id: '14', title: 'Anonymous learner · Red feedback', description: 'Synthetic session',
      meta: 'Live Sessions Feedback · 0% · Synthetic group', tone: 'red',
    }]);
  });

  it('reports a failed read without returning static notifications and can refresh', async () => {
    vi.mocked(feedbackApi.insightsDashboard).mockRejectedValueOnce(new Error('Alerts unavailable'));
    const { result } = renderHook(() => useQualityNotifications(1));
    await waitFor(() => expect(result.current.error).toBe('Alerts unavailable'));
    expect(result.current.notifications).toEqual([]);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    expect(result.current.error).toBe('');
  });

  it('treats missing classifications as unavailable rather than a successful empty result', async () => {
    vi.mocked(feedbackApi.insightsDashboard).mockResolvedValue({ analytics: {} as FeedbackDashboardReport });
    const { result } = renderHook(() => useQualityNotifications(1));
    await waitFor(() => expect(result.current.error).toBe('Feedback score classifications are unavailable.'));
    expect(result.current.notifications).toEqual([]);
  });

  it('does not fetch while signed out', () => {
    const { result } = renderHook(() => useQualityNotifications(null));
    expect(result.current.notifications).toEqual([]);
    expect(result.current.error).toBe('Sign in to load quality alerts.');
    expect(feedbackApi.insightsDashboard).not.toHaveBeenCalled();
  });

  it('discards an earlier account request when identity changes', async () => {
    let resolveEarlier: (value: ReturnType<typeof report>) => void;
    vi.mocked(feedbackApi.insightsDashboard).mockImplementationOnce(() => new Promise(resolve => { resolveEarlier = resolve; }))
      .mockResolvedValueOnce(report([]));
    const { result, rerender } = renderHook(({ id }) => useQualityNotifications(id), { initialProps: { id: 1 } });
    rerender({ id: 2 });
    expect(result.current.notifications).toEqual([]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { resolveEarlier!(report([negative])); });
    expect(result.current.notifications).toEqual([]);
    expect(result.current.error).toBe('');
  });

  it('fetches new alerts when returning to the tab and removes listeners on unmount', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { result, unmount } = renderHook(() => useQualityNotifications(1));
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    vi.mocked(feedbackApi.insightsDashboard).mockResolvedValue(report([]));
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notifications).toEqual([]);
    expect(feedbackApi.insightsDashboard).toHaveBeenCalledTimes(2);
    unmount();
    act(() => window.dispatchEvent(new Event('online')));
    expect(feedbackApi.insightsDashboard).toHaveBeenCalledTimes(2);
  });
});
