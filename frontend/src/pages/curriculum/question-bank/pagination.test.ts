import { describe, expect, it } from 'vitest';

import { questionBankQueryString } from './pagination';

describe('question bank pagination requests', () => {
  it('keeps every active filter while traversing pages', () => {
    const params = new URLSearchParams(questionBankQueryString({
      programme: 'Business Admin L3',
      search: '  safeguarding ',
      questionType: 'multiple_choice',
      quizStatus: 'published',
      page: 4,
    }));

    expect(Object.fromEntries(params)).toEqual({
      programme: 'Business Admin L3',
      search: 'safeguarding',
      questionType: 'multiple_choice',
      quizStatus: 'published',
      page: '4',
      pageSize: '50',
    });
  });
});
