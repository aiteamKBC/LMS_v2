import { describe, expect, it } from 'vitest';
import type { FeedbackAnswerValue, FeedbackQuestion, FeedbackQuestionType } from '@/api/feedback';
import cases from './__fixtures__/scorePreview.json?raw';
import { previewClass, previewQuestionScore, previewResponseScore, scoringReadiness } from './scorePreview';

const question = (type: FeedbackQuestionType = 'rating', config: FeedbackQuestion['config'] = {}): FeedbackQuestion => ({ type, config, text: 'Synthetic question', required: false, helpText: '' });

describe('staff score preview matches the backend scoring contract', () => {
  for (const example of JSON.parse(cases) as { name: string; type: FeedbackQuestionType; config: FeedbackQuestion['config']; value: FeedbackAnswerValue; expected: number | null; expectedClassification?: string }[]) {
    it(example.name, () => {
      const item = question(example.type, example.config);
      const original = JSON.stringify(item);
      const score = previewQuestionScore(item, example.value);
      if (example.expected == null) expect(score).toBeNull();
      else expect(score).toBeCloseTo(example.expected, 10);
      if (example.expectedClassification) expect(previewClass(score)).toBe(example.expectedClassification);
      expect(JSON.stringify(item)).toBe(original);
    });
  }
  it('uses answered, included question weights instead of treating blanks as zero', () => {
    const result = previewResponseScore([
      { key: 'high', question: question('rating', { analytics: { importance: 'critical' } }), answer: 5 },
      { key: 'low', question: question('rating', { analytics: { importance: 'low' } }), answer: 1 },
      { key: 'blank', question: question(), answer: null },
      { key: 'excluded', question: question('rating', { analytics: { includeInOverall: false } }), answer: 1 },
      { key: 'text', question: question('long_text'), answer: 'Helpful' },
    ]);
    expect(result).toMatchObject({ score: 80, classification: 'positive', weight: 5, total: 400, scoredQuestions: 2 });
    expect(result.rows.find(row => row.key === 'excluded')).toMatchObject({ score: 0, included: false });
    expect(previewResponseScore([])).toMatchObject({ score: null, classification: 'unscored', scoredQuestions: 0 });
  });
  it('does not round a neutral score across the positive boundary', () => {
    expect(previewClass(74.999)).toBe('neutral');
    expect(previewClass(75)).toBe('positive');
    expect(previewClass(50)).toBe('neutral');
    expect(previewClass(49.999)).toBe('negative');
    expect(previewClass(null)).toBe('unscored');
  });
  it('explains incomplete explicit settings while allowing intentionally unscored questions', () => {
    const item = question('single_choice', { options: ['A', 'B'], analytics: { scoring: 'options', optionScores: { A: 100 } } });
    expect(scoringReadiness(item)).toMatchObject({ state: 'incomplete', message: expect.stringContaining('Blank is not zero') });
    expect(previewQuestionScore(item, 'A')).toBeNull();
    expect(scoringReadiness({ ...item, config: { ...item.config, analytics: { scoring: 'none' } } }).state).toBe('not_scored');
    expect(scoringReadiness(question('number', { analytics: { scoring: 'higher', scoreMin: 10, scoreMax: 10 } })).state).toBe('incomplete');
    expect(scoringReadiness(question('rating', { min: 5, max: 1 })).state).toBe('incomplete');
  });
});
