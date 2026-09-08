import { describe, expect, it } from 'vitest';
import type { LearnerComponentEntry } from '@/api/learnerDetail';
import {
  learningKsbCodes,
  learningMinutesForRecord,
  uniqueLearningProgress,
  type LearningProgressRecord,
} from '@/lib/reviewLearningProgress';

const components = [{
  componentId: 'video-1', component: 'Video', expectedOtjh: 2,
  module: null, week: null,
  ksbMappings: [{ code: 'K1', description: null, classification: 'main', weight: 1 }],
}] as LearnerComponentEntry[];

const record = (overrides: Partial<LearningProgressRecord> = {}): LearningProgressRecord => ({
  kind: 'video', componentId: 'video-1', startedAt: null,
  submittedAt: '2026-09-01T10:00:00Z', timeTaken: null, ...overrides,
} as LearningProgressRecord);

describe('review learning progress', () => {
  it('uses verified seconds instead of the planned reported time', () => {
    expect(learningMinutesForRecord(record({ verifiedSeconds: 90, reportedTime: '2h' }), components)).toBe(1.5);
    expect(learningMinutesForRecord(record({ verifiedSeconds: 0, reportedTime: '2h' }), components)).toBe(0);
  });

  it('treats a bare legacy 60 as sixty minutes', () => {
    expect(learningMinutesForRecord(record({ componentId: 'unknown', reportedTime: '60' }), components)).toBe(60);
  });

  it('only deduplicates identical saved completions', () => {
    expect(uniqueLearningProgress([record(), record()])).toHaveLength(1);
    expect(uniqueLearningProgress([record(), record({ submittedAt: '2026-09-02T10:00:00Z' })])).toHaveLength(2);
  });

  it('falls back to authored KSB mappings for legacy records', () => {
    expect(learningKsbCodes([record({ ksbs: [] })], components)).toEqual(['K1']);
  });
});
