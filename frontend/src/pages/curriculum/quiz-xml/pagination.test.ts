import { describe, expect, it } from 'vitest';

import { quizListQueryString, quizStudentResultsUrl } from './pagination';

describe('quiz list pagination requests', () => {
  it('sends stable server pagination, filters, and UTC date bounds', () => {
    const query = quizListQueryString({
      status: 'published',
      search: '  compliance  ',
      page: 3,
      pageSize: '20',
      updatedAfter: new Date('2026-10-01T00:00:00.000Z'),
      updatedBefore: new Date('2026-10-31T23:59:59.999Z'),
    });
    const params = new URLSearchParams(query);

    expect(Object.fromEntries(params)).toEqual({
      status: 'published',
      search: 'compliance',
      page: '3',
      pageSize: '20',
      updatedAfter: '2026-10-01T00:00:00.000Z',
      updatedBefore: '2026-10-31T23:59:59.999Z',
    });
  });

  it('pages Quiz Students without changing its route', () => {
    expect(quizStudentResultsUrl(17, 2)).toBe('/quiz_api/quizzes/17/students/?page=2&pageSize=25');
  });
});
