export interface QuestionBankQuery {
  programme: string;
  search: string;
  questionType: string;
  quizStatus: string;
  page: number;
  pageSize?: number;
}

export function questionBankQueryString(query: QuestionBankQuery) {
  const params = new URLSearchParams();
  params.set('programme', query.programme);
  if (query.search.trim()) params.set('search', query.search.trim());
  params.set('questionType', query.questionType);
  params.set('quizStatus', query.quizStatus);
  params.set('page', String(query.page));
  params.set('pageSize', String(query.pageSize ?? 50));
  return params.toString();
}
