export interface QuizListQuery {
  status: string;
  search: string;
  page: number;
  pageSize: string;
  updatedAfter?: Date | null;
  updatedBefore?: Date | null;
}

export function quizListQueryString(query: QuizListQuery) {
  const params = new URLSearchParams();
  if (query.status !== 'all') params.set('status', query.status);
  if (query.search.trim()) params.set('search', query.search.trim());
  params.set('page', String(query.page));
  params.set('pageSize', query.pageSize);
  if (query.updatedAfter && query.updatedBefore) {
    params.set('updatedAfter', query.updatedAfter.toISOString());
    params.set('updatedBefore', query.updatedBefore.toISOString());
  }
  return params.toString();
}

export function quizStudentResultsUrl(quizId: number, page: number, pageSize = 25) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return `/quiz_api/quizzes/${quizId}/students/?${params.toString()}`;
}
