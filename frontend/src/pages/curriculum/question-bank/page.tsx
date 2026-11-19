import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useListQueryState } from '@/hooks/useListQueryState';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { ThemedSelect } from '@/components/feature/ThemedSelect';
import { QuestionAnswersView } from '@/components/feature/QuestionTypeRenderer';
import { QuizQuestionImage } from '@/components/feature/QuizQuestionImage';
import { useToast } from "@/hooks/useToast";
import { roleNavMap } from '@/mocks/navigation';
import './page.css';

const curriculumNav = roleNavMap.curriculum;

type QuestionType = 'single_choice' | 'multiple_choice' | 'true_false' | 'matching' | 'image_matching' | 'keywords' | 'fill_gap' | 'ordering';

const questionTypeOptions: { value: QuestionType; label: string }[] = [
  { value: 'single_choice', label: 'Single choice' },
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'true_false', label: 'True-False' },
  { value: 'matching', label: 'Matching' },
  { value: 'image_matching', label: 'Image matching' },
  { value: 'keywords', label: 'Keywords' },
  { value: 'fill_gap', label: 'Fill in the gap' },
  { value: 'ordering', label: 'Ordering' },
];

interface QuestionBankProgramme {
  name: string;
  key?: string;
  questionCount: number;
  quizCount: number;
  moduleRows?: number;
  trainingPlanRows?: number;
}

interface QuestionBankQuestion {
  id: number;
  text: string;
  imageUrl?: string;
  questionType: QuestionType;
  explanation: string;
  quizStatus: string;
  programme: string;
  programmeKey: string;
  module: string;
  quizId: number;
  quizTitle: string;
  linkedQuizzes?: {
    id: number;
    title: string;
    module: string;
    status: string;
  }[];
  answers: {
    id: number;
    text: string;
    isCorrect: boolean;
  }[];
}

interface QuestionBankData {
  programmes: QuestionBankProgramme[];
  questions: QuestionBankQuestion[];
  quizzes: QuestionBankQuiz[];
  totalQuestions: number;
  statuses?: string[];
  ksbTaggedCount?: number;
  pagination?: { page: number; pageSize: number; total: number; totalPages: number };
}

interface QuestionBankQuiz {
  id: number;
  title: string;
  module: string;
  programme: string;
  programmeKey: string;
  questions: number;
  status: string;
}

function questionLabel(type: QuestionType) {
  return questionTypeOptions.find(option => option.value === type)?.label || type;
}

function statusLabel(status: string) {
  if (status === 'trash') return 'Archive';
  if (status === 'validating') return 'Pending';
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Draft';
}

function statusClasses(status: string) {
  if (status === 'published') return 'bg-emerald-100 text-emerald-700';
  if (status === 'pending' || status === 'validating') return 'bg-amber-100 text-amber-700';
  if (status === 'private') return 'bg-sky-100 text-sky-700';
  return 'bg-[#e8edf4] text-[#526173]';
}

function statusIcon(status: string) {
  if (status === 'published') return 'ri-checkbox-circle-line';
  if (status === 'pending' || status === 'validating') return 'ri-time-line';
  if (status === 'private') return 'ri-lock-line';
  return 'ri-file-edit-line';
}

const QUESTION_BANK_QUERY_DEFAULTS = { programme: 'all', q: '', type: 'all', status: 'all', page: 1 };

export default function QuestionBankPage() {
  const { success, error: toastError } = useToast();
  const [questionBank, setQuestionBank] = useState<QuestionBankData | null>(null);
  // In the URL, so stepping back here from the quiz workspace keeps the filters.
  const { state: query, setValues: setQuery } = useListQueryState(QUESTION_BANK_QUERY_DEFAULTS);
  const bankProgramme = String(query.programme);
  const bankSearch = String(query.q);
  const typeFilter = String(query.type) as 'all' | QuestionType;
  const statusFilter = String(query.status);
  const page = Number(query.page);
  const setBankProgramme = (value: string) => setQuery({ programme: value, page: 1 });
  const setBankSearch = (value: string) => setQuery({ q: value, page: 1 });
  const setTypeFilter = (value: 'all' | QuestionType) => setQuery({ type: value, page: 1 });
  const setStatusFilter = (value: string) => setQuery({ status: value, page: 1 });
  const [bankLoading, setBankLoading] = useState(true);
  const [bankError, setBankError] = useState('');
  const [selectedQuestion, setSelectedQuestion] = useState<QuestionBankQuestion | null>(null);
  const [targetQuizId, setTargetQuizId] = useState('');
  const [addingQuestion, setAddingQuestion] = useState(false);
  const requestSequence = useRef(0);

  const loadQuestionBank = useCallback(async (background = false, signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    if (!background) setBankLoading(true);
    setBankError('');
    const params = new URLSearchParams();
    params.set('programme', bankProgramme);
    params.set('page', String(page));
    params.set('pageSize', '25');
    params.set('type', typeFilter);
    params.set('status', statusFilter);
    if (bankSearch.trim()) params.set('search', bankSearch.trim());

    try {
      const response = await fetch(`/quiz_api/question-bank/?${params.toString()}`, { signal });
      if (!response.ok) throw new Error(`Could not load question bank (${response.status}). Please try again.`);
      if (!(response.headers.get('content-type') || '').includes('application/json')) {
        throw new Error('Could not load question bank: the server returned an unexpected response.');
      }
      const data: QuestionBankData = await response.json();
      if (!data || !Array.isArray(data.questions) || !Array.isArray(data.programmes)
          || !Array.isArray(data.quizzes) || typeof data.totalQuestions !== 'number') {
        throw new Error('Could not load question bank: the response was incomplete.');
      }
      if (sequence !== requestSequence.current || signal?.aborted) return;
      setQuestionBank(data);
    } catch (err) {
      if (sequence === requestSequence.current && !signal?.aborted && (err as DOMException).name !== 'AbortError') {
        setBankError(err instanceof Error ? err.message : 'Could not load question bank');
      }
    } finally {
      if (sequence === requestSequence.current && !signal?.aborted) setBankLoading(false);
    }
  }, [bankProgramme, bankSearch, page, typeFilter, statusFilter]);

  useEffect(() => {
    const controller = new AbortController();
    setBankLoading(true);
    const timer = window.setTimeout(() => void loadQuestionBank(false, controller.signal), bankSearch.trim() ? 250 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      requestSequence.current += 1;
    };
  }, [loadQuestionBank, bankSearch]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadQuestionBank(true);
    };
    const interval = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadQuestionBank]);

  const bankProgrammes = questionBank?.programmes ?? [];
  const filteredQuestions = useMemo(() => {
    return (questionBank?.questions ?? []).filter(question => {
      if (typeFilter !== 'all' && question.questionType !== typeFilter) return false;
      if (statusFilter !== 'all' && question.quizStatus !== statusFilter) return false;
      return true;
    });
  }, [questionBank?.questions, statusFilter, typeFilter]);
  const bankQuestionsByProgramme = useMemo(() => {
    const grouped = new Map<string, QuestionBankQuestion[]>();
    for (const question of filteredQuestions) {
      const key = question.programme || 'Unassigned';
      grouped.set(key, [...(grouped.get(key) ?? []), question]);
    }
    return Array.from(grouped.entries());
  }, [filteredQuestions]);
  const activeBankCount = bankProgrammes.filter(programme => programme.questionCount > 0).length;
  const totalBankCount = bankProgrammes.length;
  const totalQuestionCount = questionBank?.totalQuestions ?? 0;
  const visibleQuestionCount = questionBank?.pagination?.total ?? filteredQuestions.length;
  const visibleKsbTaggedCount = questionBank?.ksbTaggedCount ?? filteredQuestions.filter(question => /(\bksb\b|knowledge|skill|behaviour|behavior|k\d|s\d|b\d)/i.test(question.explanation)).length;
  const ksbTaggedPercent = visibleQuestionCount ? Math.round((visibleKsbTaggedCount / visibleQuestionCount) * 100) : 0;
  const hasActiveQuestionFilters = bankProgramme !== 'all' || typeFilter !== 'all' || statusFilter !== 'all' || Boolean(bankSearch.trim());
  const statusOptions = useMemo(() => {
    const statuses = [...(questionBank?.statuses ?? new Set((questionBank?.questions ?? []).map(question => question.quizStatus).filter(Boolean)))];
    return [
      { value: 'all', label: 'All statuses' },
      ...statuses.sort().map(status => ({ value: status, label: statusLabel(status) })),
    ];
  }, [questionBank?.questions, questionBank?.statuses]);
  const typeOptions: { value: 'all' | QuestionType; label: string }[] = useMemo(() => [
    { value: 'all' as const, label: 'All types' },
    ...questionTypeOptions,
  ], []);
  const selectedQuestionCurrentQuiz = useMemo(() => {
    if (!selectedQuestion) return null;
    return (questionBank?.quizzes ?? []).find(quiz => quiz.id === selectedQuestion.quizId) ?? null;
  }, [questionBank?.quizzes, selectedQuestion]);
  const availableTargetQuizzes = useMemo(() => {
    if (!selectedQuestion) return [];
    return (questionBank?.quizzes ?? [])
      .filter(quiz => quiz.programmeKey === selectedQuestion.programmeKey && quiz.id !== selectedQuestion.quizId);
  }, [questionBank?.quizzes, selectedQuestion]);
  const targetQuizOptions = useMemo(() => {
    return availableTargetQuizzes
      .map(quiz => ({
        value: String(quiz.id),
        label: `${quiz.title} (${quiz.questions} questions)`,
      }));
  }, [availableTargetQuizzes]);

  const openAddToQuiz = (question: QuestionBankQuestion) => {
    const options = (questionBank?.quizzes ?? [])
      .filter(quiz => quiz.programmeKey === question.programmeKey && quiz.id !== question.quizId);
    setSelectedQuestion(question);
    setTargetQuizId(options[0] ? String(options[0].id) : '');
  };

  const addQuestionToQuiz = async () => {
    if (!selectedQuestion || !targetQuizId) return;
    setAddingQuestion(true);
    try {
      const response = await fetch(`/quiz_api/question-bank/questions/${selectedQuestion.id}/add-to-quiz/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quizId: Number(targetQuizId) }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Could not add question to quiz');
      }
      const targetQuiz = questionBank?.quizzes.find(quiz => String(quiz.id) === targetQuizId);
      if (targetQuiz) {
        const sourceQuestion = selectedQuestion;
        setQuestionBank(prev => prev ? ({
          ...prev,
          questions: prev.questions.map(question => {
            const sameQuestion = question.programmeKey === sourceQuestion.programmeKey
              && question.questionType === sourceQuestion.questionType
              && (question.imageUrl || '') === (sourceQuestion.imageUrl || '')
              && question.text.trim().toLowerCase() === sourceQuestion.text.trim().toLowerCase();
            if (!sameQuestion) return question;
            const existingLinked = question.linkedQuizzes?.length
              ? question.linkedQuizzes
              : [{ id: question.quizId, title: question.quizTitle, module: question.module, status: question.quizStatus }];
            const nextLinked = existingLinked.some(quiz => quiz.id === targetQuiz.id)
              ? existingLinked
              : [
                ...existingLinked,
                {
                  id: targetQuiz.id,
                  title: targetQuiz.title,
                  module: targetQuiz.module,
                  status: targetQuiz.status,
                },
              ];
            return { ...question, linkedQuizzes: nextLinked };
          }),
          quizzes: prev.quizzes.map(quiz => quiz.id === targetQuiz.id ? { ...quiz, questions: quiz.questions + 1 } : quiz),
        }) : prev);
      }
      success('Question added', targetQuiz ? `Added to ${targetQuiz.title}.` : 'Question copied to the selected quiz.');
      setSelectedQuestion(null);
      setTargetQuizId('');
      await loadQuestionBank(true);
    } catch (err) {
      toastError('Add failed', err instanceof Error ? err.message : 'Could not add question to quiz');
    } finally {
      setAddingQuestion(false);
    }
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Question Bank" pageSubtitle="Programme-scoped quiz questions" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="curriculum-library-page question-bank-page min-h-full bg-[#f7f6f4] p-4 sm:p-5 lg:p-6 space-y-4">
        <WorkspaceHeroBanner
          className="curriculum-library-hero question-bank-hero"
          decorative
          eyebrow="Learning resources"
          title="Question Bank"
          description="Create, manage and organize questions to support assessment and learning."
          icon="ri-database-2-line"
          statIconPosition="leading"
          stats={[
            { label: 'Banks', value: questionBank ? String(activeBankCount) : '—', icon: 'ri-database-2-line' },
            { label: 'Questions', value: questionBank ? String(totalQuestionCount) : '—', icon: 'ri-file-line' },
            { label: 'KSB Tagged', value: questionBank ? `${ksbTaggedPercent}%` : '—', icon: 'ri-price-tag-3-line' },
          ]}
        />

        <section className="rounded-2xl border border-[#ded8e8] bg-white shadow-sm overflow-hidden">
          <div className="question-bank-heading flex flex-wrap items-center justify-between gap-4 px-6 py-5 border-b border-[#e2e8f0] bg-[#fbfbfd]">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-9 h-9 rounded-xl bg-[#f2f0ff] text-[#5b2dbb] flex items-center justify-center">
                  <AppIcon className="ri-questionnaire-line text-lg"></AppIcon>
                </span>
                <p className="text-xs font-bold uppercase tracking-wider text-[#5b2dbb]">Question Bank</p>
              </div>
              <h2 className="text-2xl font-heading font-bold text-foreground-900">Programme Question Bank</h2>
              <p className="text-sm text-[#647083] mt-1">Questions are grouped by the linked Training Plan programme and stay quietly up to date for concurrent curriculum work.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link to="/curriculum/quiz-xml" className="h-10 px-4 rounded-lg bg-[#b27715] text-white text-sm font-semibold hover:bg-[#986511] transition-smooth flex items-center">
                <AppIcon className="ri-arrow-left-line mr-1"></AppIcon> Quiz Workspace
              </Link>
            </div>
          </div>

          <div className="question-bank-layout grid min-h-[calc(100vh-260px)]">
            <aside className="question-bank-programmes border-[#e2e8f0] bg-white p-4 overflow-y-auto quiz-preview-scroll" aria-label="Question bank programmes">
              <button
                onClick={() => setBankProgramme('all')}
                className={`w-full rounded-xl border px-3 py-3 text-left transition-smooth mb-3 ${bankProgramme === 'all' ? 'border-[#a78bfa] bg-[#f2f0ff]' : 'border-[#e2e8f0] bg-white hover:bg-[#f8fafc]'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-foreground-900">All programmes</span>
                  <span className="text-xs font-bold text-[#5b2dbb]">{questionBank?.totalQuestions ?? '—'}</span>
                </div>
              </button>
              <div className="space-y-2">
                {bankProgrammes.map(programme => {
                  const value = programme.key ?? (programme.name === 'Unassigned' ? '__unassigned__' : programme.name);
                  return (
                    <button
                      key={value}
                      onClick={() => setBankProgramme(value)}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition-smooth ${bankProgramme === value ? 'border-[#a78bfa] bg-[#f2f0ff]' : 'border-[#e2e8f0] bg-white hover:bg-[#f8fafc]'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground-900 break-words">{programme.name}</p>
                          <p className="text-[11px] text-[#647083] mt-1">{programme.quizCount} quizzes - {programme.moduleRows ?? programme.trainingPlanRows ?? 0} module rows</p>
                        </div>
                        <span className="text-xs font-bold text-[#5b2dbb] bg-white rounded-full px-2 py-1 shrink-0">{programme.questionCount}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="question-bank-results min-w-0 bg-[#f7f6f4] p-5">
              <div className="question-bank-toolbar sticky top-0 z-10 -mx-5 -mt-5 mb-5 border-b border-[#e2e8f0] bg-[#f7f6f4]/95 px-5 py-4 backdrop-blur">
                <div className="flex min-w-0 flex-col gap-3">
                  <div>
                    <p className="text-sm font-heading font-bold text-foreground-900">{bankProgramme === 'all' ? 'All programme questions' : bankProgramme === '__unassigned__' ? 'Unassigned questions' : bankProgramme}</p>
                    <p className="text-xs text-[#647083] mt-1" aria-live="polite">{questionBank ? `${filteredQuestions.length} of ${visibleQuestionCount} questions shown` : bankLoading ? 'Loading questions…' : 'Question count unavailable'}</p>
                  </div>
                  <div className="question-bank-filters">
                    <ThemedSelect
                      value={typeFilter}
                      options={typeOptions}
                      onChange={value => setTypeFilter(value as 'all' | QuestionType)}
                      className="min-w-0 w-full"
                    />
                    <ThemedSelect
                      value={statusFilter}
                      options={statusOptions}
                      onChange={setStatusFilter}
                      className="min-w-0 w-full"
                    />
                    <div className="question-bank-search relative min-w-0 w-full">
                      <input aria-label="Search question bank" value={bankSearch} onChange={event => setBankSearch(event.target.value)} placeholder="Search question bank" className="h-10 w-full rounded-lg bg-white border border-[#d8dde6] pl-4 pr-10 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]" />
                      <AppIcon className="ri-search-line absolute right-3 top-1/2 -translate-y-1/2 text-[#647083]"></AppIcon>
                    </div>
                  </div>
                </div>
              </div>

              {bankError && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <p>{bankError}</p>
                <button type="button" onClick={() => void loadQuestionBank()} className="mt-3 rounded-lg border border-red-300 px-3 py-2 font-semibold" disabled={bankLoading}>Try again</button>
              </div>}
              {bankLoading && <div className="py-16 text-center text-sm text-[#647083]">Loading question bank...</div>}
              {!bankLoading && !bankError && questionBank && filteredQuestions.length === 0 && (
                <div className="rounded-2xl border border-[#e2e8f0] bg-white p-10 text-center">
                  <span className="w-14 h-14 rounded-2xl bg-[#f2f0ff] text-[#5b2dbb] flex items-center justify-center mx-auto mb-3">
                    <AppIcon className="ri-question-answer-line text-xl"></AppIcon>
                  </span>
                  <p className="text-sm font-semibold text-foreground-700">No questions match this view</p>
                  <p className="text-xs text-[#647083] mt-1">
                    {hasActiveQuestionFilters
                      ? 'The current type, status, or search filter is hiding the available questions.'
                      : 'Create or import quiz questions in Quiz Workspace to populate this bank.'}
                  </p>
                  {hasActiveQuestionFilters && (
                    <button
                      type="button"
                      onClick={() => setQuery({ programme: 'all', type: 'all', status: 'all', q: '', page: 1 })}
                      className="mt-4 h-9 px-4 rounded-lg bg-[#5b2dbb] text-white text-xs font-semibold hover:bg-[#4c1d95] transition-smooth"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              )}

              {!bankLoading && questionBank && filteredQuestions.length > 0 && (
                <div className="space-y-5">
                  {bankQuestionsByProgramme.map(([programme, questions]) => (
                    <div key={programme} className="space-y-3">
                      {bankProgramme === 'all' && (
                        <div className="flex items-center gap-3">
                          <h3 className="text-sm font-heading font-bold text-foreground-900">{programme}</h3>
                          <span className="text-[11px] font-bold rounded-full bg-[#f2f0ff] text-[#5b2dbb] px-2 py-1">{questions.length} questions</span>
                        </div>
                      )}
                      {questions.map(question => {
                        const hasKsbTag = /(\bksb\b|knowledge|skill|behaviour|behavior|k\d|s\d|b\d)/i.test(question.explanation);
                        return (
                          <article key={question.id} className="question-bank-question rounded-2xl border border-[#dfe4ec] bg-white p-5 shadow-sm">
                            <div className="flex min-w-0 flex-col gap-3 mb-4">
                              <div className="min-w-0">
                                <p className="text-[15px] font-semibold text-foreground-900 leading-7">{question.text}</p>
                                <p className="text-xs text-[#647083] mt-2">
                                  {question.module || 'No module'} - {question.quizTitle}
                                </p>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  {(question.linkedQuizzes?.length ? question.linkedQuizzes : [{ id: question.quizId, title: question.quizTitle, module: question.module, status: question.quizStatus }]).map(linkedQuiz => {
                                    const isCurrent = linkedQuiz.id === question.quizId;
                                    return (
                                      <span
                                        key={linkedQuiz.id}
                                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold shadow-sm ${isCurrent ? 'border-[#c4b5fd] bg-[#ede9fe] text-[#43207d]' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
                                      >
                                        <AppIcon className={isCurrent ? 'ri-folder-info-line text-[#5b2dbb]' : 'ri-links-line text-emerald-600'}></AppIcon>
                                        {isCurrent ? 'Currently in' : 'Also in'}: {linkedQuiz.title}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                {hasKsbTag && <span className="inline-flex w-fit items-center gap-1 rounded-md bg-[#eefcf7] px-2 py-1 text-[10px] font-bold uppercase text-emerald-700"><AppIcon className="ri-price-tag-3-line text-[11px]"></AppIcon>KSB tagged</span>}
                                <span className={`inline-flex w-fit items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase ${statusClasses(question.quizStatus)}`}><AppIcon className={`${statusIcon(question.quizStatus)} text-[11px]`}></AppIcon>{statusLabel(question.quizStatus)}</span>
                                <span className="inline-flex w-fit items-center gap-1 rounded-md bg-[#e8edf4] px-2 py-1 text-[10px] font-bold uppercase text-[#526173]"><AppIcon className="ri-list-check-2-line text-[11px]"></AppIcon>{questionLabel(question.questionType)}</span>
                                <button type="button" onClick={() => openAddToQuiz(question)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-[#5b2dbb] px-3 text-xs font-semibold text-white hover:bg-[#4c1d95] transition-smooth">
                                  <AppIcon className="ri-add-line text-sm"></AppIcon>Add to quiz
                                </button>
                              </div>
                            </div>
                            <QuizQuestionImage imageUrl={question.imageUrl} />
                            <QuestionAnswersView type={question.questionType} answers={question.answers} fallbackText={question.explanation} compact />
                          </article>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
              {questionBank?.pagination && questionBank.pagination.totalPages > 1 && (
                <nav aria-label="Question pages" className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <button type="button" disabled={bankLoading || questionBank.pagination.page <= 1} onClick={() => setQuery({ page: questionBank.pagination!.page - 1 })} className="rounded-lg border px-4 py-2 disabled:opacity-50">Previous</button>
                  <span>Page {questionBank.pagination.page} of {questionBank.pagination.totalPages}</span>
                  <button type="button" disabled={bankLoading || questionBank.pagination.page >= questionBank.pagination.totalPages} onClick={() => setQuery({ page: questionBank.pagination!.page + 1 })} className="rounded-lg border px-4 py-2 disabled:opacity-50">Next</button>
                </nav>
              )}
            </section>
          </div>
        </section>

        {selectedQuestion && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onClick={() => setSelectedQuestion(null)}>
            <div role="dialog" aria-modal="true" aria-label="Copy question to an existing quiz" className="question-bank-dialog w-full max-w-lg rounded-2xl border border-[#ded8e8] bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 border-b border-[#e2e8f0] p-5">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#5b2dbb] mb-1">Add to quiz</p>
                  <h3 className="text-lg font-heading font-bold text-foreground-900">Copy question to an existing quiz</h3>
                </div>
                <button aria-label="Close add to quiz" onClick={() => setSelectedQuestion(null)} className="w-9 h-9 shrink-0 rounded-xl bg-[#f8fafc] hover:bg-[#f1f5f9] text-[#475569] transition-smooth">
                  <AppIcon className="ri-close-line text-lg"></AppIcon>
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4">
                  <p className="text-sm font-semibold text-foreground-900 leading-6 line-clamp-3">{selectedQuestion.text}</p>
                  <p className="text-xs text-[#647083] mt-2">{selectedQuestion.programme} - from {selectedQuestion.quizTitle}</p>
                </div>

                <div className="rounded-xl border border-[#ddd6fe] bg-[#fbf9ff] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#5b2dbb] mb-2">Currently used in</p>
                  <div className="space-y-2">
                    {(selectedQuestion.linkedQuizzes?.length ? selectedQuestion.linkedQuizzes : [{
                      id: selectedQuestion.quizId,
                      title: selectedQuestionCurrentQuiz?.title ?? selectedQuestion.quizTitle,
                      module: selectedQuestionCurrentQuiz?.module || selectedQuestion.module,
                      status: selectedQuestionCurrentQuiz?.status ?? selectedQuestion.quizStatus,
                    }]).map(linkedQuiz => {
                      const isCurrent = linkedQuiz.id === selectedQuestion.quizId;
                      return (
                        <div key={linkedQuiz.id} className={`rounded-lg border px-3 py-2 ${isCurrent ? 'border-[#c4b5fd] bg-white' : 'border-emerald-200 bg-emerald-50'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-[#1f2937]">{linkedQuiz.title}</p>
                              <p className="mt-1 text-xs text-[#647083]">
                                {(linkedQuiz.module || 'No module')} - {statusLabel(linkedQuiz.status)}
                              </p>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${isCurrent ? 'bg-[#ede9fe] text-[#43207d]' : 'bg-white text-emerald-700'}`}>
                              {isCurrent ? 'Current' : 'Linked'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {targetQuizOptions.length > 0 ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-foreground-600 mb-2">Available quizzes to add this question to</label>
                      <ThemedSelect
                        value={targetQuizId}
                        options={targetQuizOptions}
                        onChange={setTargetQuizId}
                        buttonClassName="h-11"
                        menuClassName="max-h-56"
                      />
                      <p className="text-xs text-[#647083] mt-2">Only other quizzes linked to the same programme are shown, so questions do not mix across programmes.</p>
                    </div>
                    <div className="rounded-xl border border-[#e2e8f0] bg-white p-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-[#647083] mb-2">Available in this programme</p>
                      <div className="space-y-2 max-h-36 overflow-y-auto quiz-preview-scroll pr-1">
                        {availableTargetQuizzes.map(quiz => (
                          <div key={quiz.id} className={`rounded-lg border px-3 py-2 text-xs ${String(quiz.id) === targetQuizId ? 'border-[#a78bfa] bg-[#f2f0ff] text-[#43207d]' : 'border-[#e2e8f0] bg-[#f8fafc] text-[#475569]'}`}>
                            <p className="font-semibold">{quiz.title}</p>
                            <p className="mt-1 text-[#647083]">{quiz.module || 'No module'} - {quiz.questions} questions - {statusLabel(quiz.status)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    This question is already in its current quiz, and there are no other available quizzes in the same programme yet.
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[#e2e8f0] p-5">
                <button onClick={() => setSelectedQuestion(null)} className="h-10 px-4 rounded-lg bg-[#f8fafc] text-sm font-semibold text-foreground-700 hover:bg-[#f1f5f9] transition-smooth">Cancel</button>
                <button onClick={() => void addQuestionToQuiz()} disabled={!targetQuizId || addingQuestion} className="h-10 px-4 rounded-lg bg-[#5b2dbb] text-white text-sm font-semibold hover:bg-[#4c1d95] disabled:opacity-45 disabled:cursor-not-allowed transition-smooth">
                  {addingQuestion ? 'Adding...' : 'Add question'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
