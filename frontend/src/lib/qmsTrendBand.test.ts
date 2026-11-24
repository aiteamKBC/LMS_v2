import { describe, expect, it } from 'vitest';
import { buildMonthlySeries, trendBand } from './qms';
import type { QualityRecord } from '@/types/qms';

const base: QualityRecord = {
  id: 'r', formId: 'f', formName: 'Synthetic', category: 'Learner Feedback', subjectType: 'Coach', subjectName: 'Synthetic Coach',
  department: 'Not available', programme: 'Not available', respondentType: 'Learner', respondentName: 'Synthetic Learner',
  auditor: 'Feedback response', assessedOn: '2026-10-05', rag: 'unrated', policyVersion: null, critical: false,
  summary: 'Synthetic', learnerRef: null, answeredQuestions: 1, totalQuestions: 1, reviewStatus: 'completed',
};

describe('trendBand', () => {
  it('maps feedback classifications and lowest criterion rating to RAG bands', () => {
    expect(trendBand({ ...base, feedbackClassification: 'positive' })).toBe('green');
    expect(trendBand({ ...base, feedbackClassification: 'neutral' })).toBe('amber');
    expect(trendBand({ ...base, feedbackClassification: 'negative' })).toBe('red');
    expect(trendBand({ ...base, feedbackClassification: 'unscored' })).toBeNull();
    expect(trendBand({ ...base, ratingCounts: { gold: 2, green: 3, amber: 1, red: 0, na: 0 } })).toBe('amber');
    expect(trendBand({ ...base, ratingCounts: { gold: 2, green: 3, amber: 1, red: 1, na: 0 } })).toBe('red');
    expect(trendBand({ ...base, ratingCounts: { gold: 1, green: 0, amber: 0, red: 0, na: 2 } })).toBe('green');
    expect(trendBand({ ...base, ratingCounts: { gold: 0, green: 0, amber: 0, red: 0, na: 2 } })).toBeNull();
  });

  it('counts only banded records in the monthly total', () => {
    const [point] = buildMonthlySeries([
      { ...base, id: 'a', feedbackClassification: 'positive' },
      { ...base, id: 'b', feedbackClassification: 'negative' },
      { ...base, id: 'c' },
    ]);
    expect(point).toMatchObject({ green: 1, amber: 0, red: 1, unrated: 1, total: 2 });
  });
});
