import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { ThemedSelect } from '@/components/feature/ThemedSelect';
import { QuestionAnswersView } from '@/components/feature/QuestionTypeRenderer';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';

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
  questionCount: number;
  quizCount: number;
  trainingPlanRows: number;
}

interface QuestionBankQuestion {
  id: number;
  text: string;
  questionType: QuestionType;
  explanation: string;
  quizStatus: string;
  programme: string;
  programmeKey: string;
  module: string;
  quizId: number;
  quizTitle: string;
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

export default function QuestionBankPage() {
  const { success, error: toastError } = useToast();
  const [questionBank, setQuestionBank] = useState<QuestionBankData | null>(null);
  const [bankProgramme, setBankProgramme] = useState<'all' | string>('all');
  const [bankSearch, setBankSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | QuestionType>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [bankLoading, setBankLoading] = useState(true);
  const [bankError, setBankError] = useState('');
  const [selectedQuestion, setSelectedQuestion] = useState<QuestionBankQuestion | null>(null);
  const [targetQuizId, setTargetQuizId] = useState('');
  const [addingQuestion, setAddingQuestion] = useState(false);

  const loadQuestionBank = useCallback(async (background = false, signal?: AbortSignal) => {
    if (!background) setBankLoading(true);
    setBankError('');
    const params = new URLSearchParams();
    params.set('programme', bankProgramme);
    if (bankSearch.trim()) params.set('search', bankSearch.trim());

    try {
      const response = await fetch(`/api/question-bank/?${params.toString()}`, { signal });
      if (!response.ok) throw new Error('Could not load question bank');
      const data: QuestionBankData = await response.json();
      setQuestionBank(data);
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') {
        setBankError(err instanceof Error ? err.message : 'Could not load question bank');
      }
    } finally {
      setBankLoading(false);
    }
  }, [bankProgramme, bankSearch]);

  useEffect(() => {
    const controller = new AbortController();
    void loadQuestionBank(false, controller.signal);
    return () => controller.abort();
  }, [loadQuestionBank]);

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
  const visibleQuestionCount = filteredQuestions.length;
  const visibleKsbTaggedCount = filteredQuestions.filter(question => /(\bksb\b|knowledge|skill|behaviour|behavior|k\d|s\d|b\d)/i.test(question.explanation)).length;
  const ksbTaggedPercent = visibleQuestionCount ? Math.round((visibleKsbTaggedCount / visibleQuestionCount) * 100) : 0;
  const hasActiveQuestionFilters = typeFilter !== 'all' || statusFilter !== 'all' || Boolean(bankSearch.trim());
  const statusOptions = useMemo(() => {
    const statuses = Array.from(new Set((questionBank?.questions ?? []).map(question => question.quizStatus).filter(Boolean)));
    return [
      { value: 'all', label: 'All statuses' },
      ...statuses.sort().map(status => ({ value: status, label: statusLabel(status) })),
    ];
  }, [questionBank?.questions]);
  const typeOptions: { value: 'all' | QuestionType; label: string }[] = useMemo(() => [
    { value: 'all' as const, label: 'All types' },
    ...questionTypeOptions,
  ], []);
  const targetQuizOptions = useMemo(() => {
    if (!selectedQuestion) return [];
    return (questionBank?.quizzes ?? [])
      .filter(quiz => quiz.programmeKey === selectedQuestion.programmeKey)
      .map(quiz => ({
        value: String(quiz.id),
        label: `${quiz.title} (${quiz.questions} questions)`,
      }));
  }, [questionBank?.quizzes, selectedQuestion]);

  const openAddToQuiz = (question: QuestionBankQuestion) => {
    const options = (questionBank?.quizzes ?? [])
      .filter(quiz => quiz.programmeKey === question.programmeKey);
    setSelectedQuestion(question);
    setTargetQuizId(options[0] ? String(options[0].id) : '');
  };

  const addQuestionToQuiz = async () => {
    if (!selectedQuestion || !targetQuizId) return;
    setAddingQuestion(true);
    try {
      const response = await fetch(`/api/question-bank/questions/${selectedQuestion.id}/add-to-quiz/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quizId: Number(targetQuizId) }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Could not add question to quiz');
      }
      const targetQuiz = questionBank?.quizzes.find(quiz => String(quiz.id) === targetQuizId);
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
      <div className="min-h-screen bg-[#f7f6f4] p-6 space-y-5">
        <div className="relative rounded-2xl overflow-hidden shadow-sm" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 52%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-database-2-line text-white text-2xl"></i>
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Question Bank</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{activeBankCount}</strong> active banks from <strong>{totalBankCount}</strong> programmes containing <strong>{totalQuestionCount}</strong> questions. {visibleQuestionCount} shown, {ksbTaggedPercent}% of shown questions KSB tagged.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 shrink-0 w-full sm:w-auto">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{activeBankCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Banks</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalQuestionCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Questions</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{ksbTaggedPercent}%</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">KSB Tagged</p>
              </div>
            </div>
          </div>
        </div>

        <section className="rounded-2xl border border-[#ded8e8] bg-white shadow-sm overflow-hidden">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 px-6 py-5 border-b border-[#e2e8f0] bg-[#fbfbfd]">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-9 h-9 rounded-xl bg-[#f2f0ff] text-[#5b2dbb] flex items-center justify-center">
                  <i className="ri-questionnaire-line text-lg"></i>
                </span>
                <p className="text-xs font-bold uppercase tracking-wider text-[#5b2dbb]">Question Bank</p>
              </div>
              <h2 className="text-2xl font-heading font-bold text-foreground-900">Programme Question Bank</h2>
              <p className="text-sm text-[#647083] mt-1">Questions are grouped by the linked Training Plan programme and stay quietly up to date for concurrent curriculum work.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link to="/curriculum/quiz-xml" className="h-10 px-4 rounded-lg bg-[#5b2dbb] text-white text-sm font-semibold hover:bg-[#4c1d95] transition-smooth flex items-center">
                <i className="ri-arrow-left-line mr-1"></i> Quiz Workspace
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] min-h-[calc(100vh-260px)]">
            <aside className="border-r border-[#e2e8f0] bg-white p-4 overflow-y-auto quiz-preview-scroll">
              <button
                onClick={() => setBankProgramme('all')}
                className={`w-full rounded-xl border px-3 py-3 text-left transition-smooth mb-3 ${bankProgramme === 'all' ? 'border-[#a78bfa] bg-[#f2f0ff]' : 'border-[#e2e8f0] bg-white hover:bg-[#f8fafc]'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-foreground-900">All programmes</span>
                  <span className="text-xs font-bold text-[#5b2dbb]">{questionBank?.totalQuestions ?? 0}</span>
                </div>
              </button>
              <div className="space-y-2">
                {bankProgrammes.map(programme => {
                  const value = programme.name === 'Unassigned' ? '__unassigned__' : programme.name;
                  return (
                    <button
                      key={programme.name}
                      onClick={() => setBankProgramme(value)}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition-smooth ${bankProgramme === value ? 'border-[#a78bfa] bg-[#f2f0ff]' : 'border-[#e2e8f0] bg-white hover:bg-[#f8fafc]'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground-900 truncate">{programme.name}</p>
                          <p className="text-[11px] text-[#647083] mt-1">{programme.quizCount} quizzes - {programme.trainingPlanRows} plan rows</p>
                        </div>
                        <span className="text-xs font-bold text-[#5b2dbb] bg-white rounded-full px-2 py-1 shrink-0">{programme.questionCount}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="min-w-0 bg-[#f7f6f4] p-5">
              <div className="sticky top-0 z-10 -mx-5 -mt-5 mb-5 border-b border-[#e2e8f0] bg-[#f7f6f4]/95 px-5 py-4 backdrop-blur">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-heading font-bold text-foreground-900">{bankProgramme === 'all' ? 'All programme questions' : bankProgramme === '__unassigned__' ? 'Unassigned questions' : bankProgramme}</p>
                    <p className="text-xs text-[#647083] mt-1">{filteredQuestions.length} of {questionBank?.questions.length ?? 0} questions shown</p>
                  </div>
                  <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
                    <ThemedSelect
                      value={typeFilter}
                      options={typeOptions}
                      onChange={setTypeFilter}
                      className="w-full md:w-44"
                    />
                    <ThemedSelect
                      value={statusFilter}
                      options={statusOptions}
                      onChange={setStatusFilter}
                      className="w-full md:w-40"
                    />
                    <div className="relative w-full md:w-80">
                      <input value={bankSearch} onChange={event => setBankSearch(event.target.value)} placeholder="Search question bank" className="h-10 w-full rounded-lg bg-white border border-[#d8dde6] pl-4 pr-10 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]" />
                      <i className="ri-search-line absolute right-3 top-1/2 -translate-y-1/2 text-[#647083]"></i>
                    </div>
                  </div>
                </div>
              </div>

              {bankError && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{bankError}</div>}
              {bankLoading && <div className="py-16 text-center text-sm text-[#647083]">Loading question bank...</div>}
              {!bankLoading && (!questionBank || filteredQuestions.length === 0) && (
                <div className="rounded-2xl border border-[#e2e8f0] bg-white p-10 text-center">
                  <span className="w-14 h-14 rounded-2xl bg-[#f2f0ff] text-[#5b2dbb] flex items-center justify-center mx-auto mb-3">
                    <i className="ri-question-answer-line text-xl"></i>
                  </span>
                  <p className="text-sm font-semibold text-foreground-700">No questions match this view</p>
                  <p className="text-xs text-[#647083] mt-1">
                    {hasActiveQuestionFilters
                      ? 'The current type, status, or search filter is hiding the available questions.'
                      : 'Upload a quiz file with a matched Training Plan programme to populate this bank.'}
                  </p>
                  {hasActiveQuestionFilters && (
                    <button
                      type="button"
                      onClick={() => {
                        setTypeFilter('all');
                        setStatusFilter('all');
                        setBankSearch('');
                      }}
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
                          <article key={question.id} className="rounded-2xl border border-[#dfe4ec] bg-white p-5 shadow-sm">
                            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3 mb-4">
                              <div className="min-w-0">
                                <p className="text-[15px] font-semibold text-foreground-900 leading-7">{question.text}</p>
                                <p className="text-xs text-[#647083] mt-2">
                                  {question.module || 'No module'} - {question.quizTitle}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {hasKsbTag && <span className="w-fit text-[10px] font-bold uppercase px-2 py-1 rounded-md bg-[#eefcf7] text-emerald-700">KSB tagged</span>}
                                <span className={`w-fit text-[10px] font-bold uppercase px-2 py-1 rounded-md ${statusClasses(question.quizStatus)}`}>{statusLabel(question.quizStatus)}</span>
                                <span className="w-fit text-[10px] font-bold uppercase px-2 py-1 rounded-md bg-[#e8edf4] text-[#526173]">{questionLabel(question.questionType)}</span>
                                <button onClick={() => openAddToQuiz(question)} className="h-8 px-3 rounded-lg bg-[#5b2dbb] text-white text-xs font-semibold hover:bg-[#4c1d95] transition-smooth">
                                  <i className="ri-add-line mr-1"></i>Add to quiz
                                </button>
                              </div>
                            </div>
                            <QuestionAnswersView type={question.questionType} answers={question.answers} fallbackText={question.explanation} compact />
                          </article>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </section>

        {selectedQuestion && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onClick={() => setSelectedQuestion(null)}>
            <div className="w-full max-w-lg rounded-2xl border border-[#ded8e8] bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 border-b border-[#e2e8f0] p-5">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#5b2dbb] mb-1">Add to quiz</p>
                  <h3 className="text-lg font-heading font-bold text-foreground-900">Copy question to an existing quiz</h3>
                </div>
                <button onClick={() => setSelectedQuestion(null)} className="w-9 h-9 rounded-xl bg-[#f8fafc] hover:bg-[#f1f5f9] text-[#475569] transition-smooth">
                  <i className="ri-close-line text-lg"></i>
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4">
                  <p className="text-sm font-semibold text-foreground-900 leading-6 line-clamp-3">{selectedQuestion.text}</p>
                  <p className="text-xs text-[#647083] mt-2">{selectedQuestion.programme} - from {selectedQuestion.quizTitle}</p>
                </div>

                {targetQuizOptions.length > 0 ? (
                  <div>
                    <label className="block text-xs font-semibold text-foreground-600 mb-2">Choose target quiz</label>
                    <ThemedSelect
                      value={targetQuizId}
                      options={targetQuizOptions}
                      onChange={setTargetQuizId}
                      buttonClassName="h-11"
                      menuClassName="max-h-56"
                    />
                    <p className="text-xs text-[#647083] mt-2">Only quizzes linked to the same programme are shown, so questions do not mix across programmes.</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    No other quizzes are available in this programme yet.
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
