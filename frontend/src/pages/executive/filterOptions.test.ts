import { describe, expect, it } from 'vitest';
import type { DashboardFilters, FormDefinition, QualityRecord } from '@/types/qms';
import { filterOptions, keepConsistent } from './filterOptions';
import type { LiveQmsData } from './qualityData';

const DEFAULTS: DashboardFilters = {
  period: 'Last 12 months', department: 'All departments', programme: 'All programmes',
  category: 'All form categories', formType: 'All form types', respondentType: 'All feedback types',
  feedbackType: 'All feedback types', coach: 'All coaches', tutor: 'All tutors', rag: 'All statuses', query: '',
};
const form = (id: string, category: string, respondentType: string, feedbackType: string | null) =>
  ({ id, shortName: id, category, respondentType, feedbackType }) as unknown as FormDefinition;
const record = (formId: string, category: string, respondentType: string, feedbackType: string | null) =>
  ({ id: formId, formId, category, respondentType, feedbackType }) as unknown as QualityRecord;
const data = {
  forms: [form('MCM', 'Quality Audit', 'Coach', null), form('lecture', 'Learner Feedback', 'Learner', 'post_lecture')],
  records: [record('MCM', 'Quality Audit', 'Coach', null), record('lecture', 'Learner Feedback', 'Learner', 'post_lecture')],
  feedbackTypes: [{ id: 'post_lecture', name: 'Post lecture' }],
} as unknown as LiveQmsData;

describe('executive filter options', () => {
  it('narrows form types, feedback types and respondents to the chosen category', () => {
    const options = filterOptions(data, { ...DEFAULTS, category: 'Quality Audit' });
    expect(options.formTypes.map(item => item.id)).toEqual(['MCM']);
    expect(options.feedbackTypes).toEqual([]);
    expect(options.respondentTypes).toEqual(['Coach']);
  });

  it('clears choices that a new category rules out, so undoing the category restores every record', () => {
    const next = keepConsistent(data, { ...DEFAULTS, formType: 'lecture', feedbackType: 'post_lecture', respondentType: 'Learner', category: 'Quality Audit' });
    expect(next).toMatchObject({ category: 'Quality Audit', formType: 'All form types', feedbackType: 'All feedback types', respondentType: 'All feedback types' });
    expect(keepConsistent(data, { ...DEFAULTS, category: 'Learner Feedback', formType: 'lecture' }).formType).toBe('lecture');
  });
});
