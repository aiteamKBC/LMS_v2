import { learningFetch } from '@/lib/personalLearning';
import { sessionBase, type SessionFile, type SessionLearner } from './sessionResults';

export type RecordingInsights = { audience: 'learner'; highlights: { watched: number | null; finished: number | null } }
  | { audience: 'staff'; learners: number; finished: number; watchedSeconds: number; completionPercent: number | null; updatedAt: string;
    provider: { state: 'available' | 'unavailable' | 'not-applicable'; periodDays?: number; views?: number;
      engagementScore?: number | null; dailyViews?: { date: string; views: number }[] } };

const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const optionalCount = (value: unknown) => value === null || count(value);

export async function loadRecordingInsights(seriesId: string, file: SessionFile, learner: SessionLearner | undefined, signal: AbortSignal): Promise<RecordingInsights> {
  const url = `${sessionBase(seriesId, learner)}/artifacts/${encodeURIComponent(file.id)}/?format=engagement`;
  const response = await learningFetch(url, { credentials: 'include', signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Viewing insights could not be loaded. Please retry.');
  const value = await response.json();
  if (learner && value?.audience === 'learner' && value.highlights && optionalCount(value.highlights.watched) && optionalCount(value.highlights.finished)) {
    return { audience: 'learner', highlights: { watched: value.highlights.watched, finished: value.highlights.finished } };
  }
  if (!learner && value?.audience === 'staff' && count(value.learners) && count(value.finished) && value.finished <= value.learners
      && count(value.watchedSeconds) && optionalCount(value.completionPercent) && (value.completionPercent ?? 0) <= 100
      && typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))
      && ['available', 'unavailable', 'not-applicable'].includes(value.provider?.state)) {
    if (value.provider.state === 'available' && (!count(value.provider.views) || !Array.isArray(value.provider.dailyViews)
      || !value.provider.dailyViews.every((row: { date: unknown; views: unknown } | null) => row && typeof row.date === 'string' && count(row.views))
      || (value.provider.engagementScore != null && (typeof value.provider.engagementScore !== 'number'
        || !Number.isFinite(value.provider.engagementScore) || value.provider.engagementScore < 0 || value.provider.engagementScore > 100)))) {
      throw new Error('Viewing insights could not be verified. Please retry.');
    }
    return value as RecordingInsights;
  }
  throw new Error('Viewing insights could not be verified. Please retry.');
}
