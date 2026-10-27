import { describe, expect, it } from 'vitest';
import type { FeedbackQuestion } from '@/api/feedback';
import { analyticsForNewType, questionAnalyticsSettings, withAnswerOptions } from './questionAnalyticsConfig';

const question: FeedbackQuestion = {
  type: 'single_choice', text: 'Quality?', required: false, helpText: '',
  config: { options: ['Good', 'Poor'], analytics: { importance: 'high', scoring: 'options', optionScores: { Good: 75, Poor: 0 } } },
};

describe('reporting configuration is independent from learner delivery', () => {
  it('uses neutral defaults for questions without settings, without mutating them', () => {
    const legacy = { ...question, config: {} };
    expect(questionAnalyticsSettings(legacy)).toMatchObject({ importance: 'medium', scoring: 'none' });
    expect(questionAnalyticsSettings({ ...legacy, type: 'rating' })).toMatchObject({ scoring: 'higher' });
    expect(legacy.config).toEqual({});
  });
  it('keeps answer scores attached to labels when reordering', () => {
    expect(withAnswerOptions(question, ['Poor', 'Good']).analytics?.optionScores).toEqual({ Poor: 0, Good: 75 });
    expect(question.config.options).toEqual(['Good', 'Poor']);
  });
  it('retains a zero score when renaming and removes deleted answer scores', () => {
    expect(withAnswerOptions(question, ['Good', 'Very poor']).analytics?.optionScores).toEqual({ Good: 75, 'Very poor': 0 });
    expect(withAnswerOptions(question, ['Good', 'Poor', 'New option']).analytics?.optionScores).toEqual({ Good: 75, Poor: 0 });
  });
  it('preserves importance but resets incompatible scoring when changing answer types', () => {
    expect(analyticsForNewType(question, 'long_text')).toEqual({ analytics: { importance: 'high', includeInOverall: true, scoring: 'none' } });
    expect(analyticsForNewType(question, 'rating').analytics?.scoring).toBe('higher');
    expect(analyticsForNewType({ ...question, config: {} }, 'rating')).toEqual({});
  });
});
