import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { ThemedSelect } from '@/components/feature/ThemedSelect';
import { ImageMatchingPairFields } from '@/components/feature/ImageMatchingPairFields';
import { roleNavMap } from '@/mocks/navigation';
import { useToast } from '@/hooks/useToast';
import { fetchWeeks, type WeekItem } from '@/api/curriculum';
import { getQuizGeneralSettings } from '@/lib/quizGeneralSettings';
import { convertAnswerTextForQuestionType, isPairAnswerComplete, parseQuizPairAnswer, serializeQuizPairAnswer } from '@/lib/quizPairAnswers';

const curriculumNav = roleNavMap.curriculum;

type QuizStatus = 'published' | 'pending' | 'draft' | 'trash' | 'private' | 'validating';
type QuestionType = 'single_choice' | 'multiple_choice' | 'true_false' | 'matching' | 'image_matching' | 'keywords' | 'fill_gap' | 'ordering';
type ManualTab = 'questions' | 'settings';
type WeekLoadState = 'idle' | 'loading' | 'ready' | 'error';

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

const quizStatusOptions: { value: QuizStatus; label: string }[] = [
  { value: 'published', label: 'Published' },
  { value: 'pending', label: 'Pending' },
  { value: 'draft', label: 'Draft' },
  { value: 'trash', label: 'Archive' },
  { value: 'private', label: 'Private' },
];

const timeUnitOptions = [
  { value: 'minutes', label: 'Minutes' },
  { value: 'hours', label: 'Hours' },
  { value: 'days', label: 'Days' },
];

const quizStyleOptions = [
  { value: 'default', label: 'Default' },
  { value: 'pagination', label: 'Pagination' },
  { value: 'global', label: 'Global' },
];

interface TrainingPlanModuleOption {
  value: string;
  label: string;
  programmeId: string;
  moduleId?: string;
}

interface TrainingPlanOptions {
  programmes: { value: string; label: string }[];
  modulesByProgramme: Record<string, TrainingPlanModuleOption[]>;
}

interface ManualQuizForm {
  title: string;
  module: string;
  programme: string;
  programmeId: string;
  week: string;
  weekId: string;
  version: string;
  status: QuizStatus;
  author: string;
  linkedCourses: string;
}

interface ManualSettings {
  shortDescription: string;
  lessonContent: string;
  duration: number;
  timeUnit: string;
  quizStyle: string;
  randomizeQuestions: boolean;
  randomizeAnswers: boolean;
  showCorrectAnswer: boolean;
  attemptHistory: boolean;
  retakeAfterPass: boolean;
  limitAttempts: boolean;
  passingGrade: number;
  retakePointsCut: number;
}

interface ManualQuestion {
  id: number;
  text: string;
  questionType: QuestionType;
  explanation: string;
  answers: {
    id: number;
    text: string;
    isCorrect: boolean;
  }[];
}

const emptyForm: ManualQuizForm = {
  title: '',
  module: '',
  programme: '',
  programmeId: '',
  week: '',
  weekId: '',
  version: 'v1.0',
  status: 'draft',
  author: 'Curriculum Team',
  linkedCourses: '1',
};

function createDefaultSettings(): ManualSettings {
  const generalSettings = getQuizGeneralSettings();
  return {
    shortDescription: '',
    lessonContent: '',
    duration: 60,
    timeUnit: 'minutes',
    quizStyle: generalSettings.quizStyle,
    randomizeQuestions: false,
    randomizeAnswers: false,
    showCorrectAnswer: true,
    attemptHistory: generalSettings.attemptHistory,
    retakeAfterPass: generalSettings.retakeAfterPass,
    limitAttempts: generalSettings.attemptMode === 'limited',
    passingGrade: 65,
    retakePointsCut: 5,
  };
}

function isAlwaysCorrectType(type: QuestionType) {
  return ['ordering', 'matching', 'image_matching', 'keywords', 'fill_gap'].includes(type);
}

function normalizeAnswers(answers: ManualQuestion['answers'], type: QuestionType): ManualQuestion['answers'] {
  const fallbackId = -Date.now();
  const nextAnswers = answers.length ? [...answers] : [{ id: fallbackId, text: '', isCorrect: true }];

  if (type === 'true_false') {
    const falseIsCorrect = (nextAnswers.find(answer => answer.isCorrect)?.text || '').toLowerCase().includes('false');
    return [
      { id: nextAnswers[0]?.id ?? fallbackId, text: 'True', isCorrect: !falseIsCorrect },
      { id: nextAnswers[1]?.id ?? fallbackId - 1, text: 'False', isCorrect: falseIsCorrect },
    ];
  }

  if (isAlwaysCorrectType(type)) return nextAnswers.map(answer => ({ ...answer, isCorrect: true }));
  if (type === 'multiple_choice') {
    const hasCorrect = nextAnswers.some(answer => answer.isCorrect);
    return nextAnswers.map((answer, index) => ({ ...answer, isCorrect: hasCorrect ? answer.isCorrect : index === 0 }));
  }

  const firstCorrectIndex = Math.max(nextAnswers.findIndex(answer => answer.isCorrect), 0);
  return nextAnswers.map((answer, index) => ({ ...answer, isCorrect: index === firstCorrectIndex }));
}

function createQuestion(order: number, type: QuestionType = 'single_choice'): ManualQuestion {
  const id = -Date.now() - order;
  return {
    id,
    text: '',
    questionType: type,
    explanation: '',
    answers: normalizeAnswers([
      { id: id * 10 - 1, text: '', isCorrect: true },
      { id: id * 10 - 2, text: '', isCorrect: false },
      { id: id * 10 - 3, text: '', isCorrect: false },
      { id: id * 10 - 4, text: '', isCorrect: false },
    ], type),
  };
}

function answerCopy(type: QuestionType) {
  if (type === 'multiple_choice') return { title: 'Answer choices', hint: 'Tick every correct answer.', add: 'Add option' };
  if (type === 'true_false') return { title: 'True/False answers', hint: 'Choose whether True or False is correct.', add: 'Add option' };
  if (type === 'matching') return { title: 'Matching pairs', hint: 'Write each pair as prompt and match.', add: 'Add pair' };
  if (type === 'image_matching') return { title: 'Image matching pairs', hint: 'Upload each image and enter the concept it should match.', add: 'Add match' };
  if (type === 'keywords') return { title: 'Accepted keywords', hint: 'Each row is an accepted keyword or phrase.', add: 'Add keyword' };
  if (type === 'fill_gap') return { title: 'Accepted gap answers', hint: 'Each row is an accepted answer for the blank.', add: 'Add answer' };
  if (type === 'ordering') return { title: 'Correct order', hint: 'Add the steps in the correct sequence.', add: 'Add step' };
  return { title: 'Answer choices', hint: 'Choose the one best correct answer.', add: 'Add option' };
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-xl border border-[#dbe3ee] bg-white px-4 py-3 text-sm font-semibold text-[#0f172a]">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="w-4 h-4" />
    </label>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-foreground-700 mb-2">{label}</label>
      {children}
    </div>
  );
}

export default function ManualQuizPage() {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const firstQuestion = useMemo(() => createQuestion(1), []);
  const [activeTab, setActiveTab] = useState<ManualTab>('questions');
  const [form, setForm] = useState<ManualQuizForm>(emptyForm);
  const [settings, setSettings] = useState<ManualSettings>(() => createDefaultSettings());
  const [questions, setQuestions] = useState<ManualQuestion[]>([firstQuestion]);
  const [activeQuestionId, setActiveQuestionId] = useState(firstQuestion.id);
  const [trainingPlanOptions, setTrainingPlanOptions] = useState<TrainingPlanOptions>({ programmes: [], modulesByProgramme: {} });
  const [weeks, setWeeks] = useState<WeekItem[]>([]);
  const [weeksState, setWeeksState] = useState<WeekLoadState>('idle');
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/quiz_api/training-plan-options/', { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Could not load training plan options')))
      .then((data: TrainingPlanOptions) => setTrainingPlanOptions(data))
      .catch(() => setTrainingPlanOptions({ programmes: [], modulesByProgramme: {} }));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const selectedModule = (trainingPlanOptions.modulesByProgramme[form.programme] ?? []).find(option => option.value === form.module);
    if (!selectedModule?.moduleId) {
      setWeeks([]);
      setWeeksState(form.module ? 'error' : 'idle');
      return;
    }

    let cancelled = false;
    setWeeksState('loading');
    fetchWeeks(selectedModule.moduleId)
      .then(nextWeeks => {
        if (cancelled) return;
        setWeeks(nextWeeks);
        setWeeksState('ready');
        setForm(current => nextWeeks.some(week => week.id === current.weekId) ? current : { ...current, week: '', weekId: '' });
      })
      .catch(() => {
        if (cancelled) return;
        setWeeks([]);
        setWeeksState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [form.module, form.programme, trainingPlanOptions.modulesByProgramme]);

  const programmeOptions = useMemo(() => [{ value: '', label: 'Programme' }, ...trainingPlanOptions.programmes], [trainingPlanOptions.programmes]);
  const moduleOptions = useMemo(() => [
    { value: '', label: form.programme ? 'Module' : 'Select programme first', programmeId: '' },
    ...(trainingPlanOptions.modulesByProgramme[form.programme] ?? []),
  ], [form.programme, trainingPlanOptions.modulesByProgramme]);
  const weekOptions = useMemo(() => {
    const label = !form.module ? 'Select module first' : weeksState === 'loading' ? 'Loading weeks...' : weeksState === 'error' ? 'No weeks found' : 'Week';
    return [{ value: '', label }, ...weeks.map(week => ({ value: week.id, label: week.title }))];
  }, [form.module, weeks, weeksState]);

  const activeQuestion = questions.find(question => question.id === activeQuestionId) ?? questions[0];
  const activeAnswerCopy = answerCopy(activeQuestion?.questionType ?? 'single_choice');

  const updateQuestion = (questionId: number, patch: Partial<ManualQuestion>) => {
    setQuestions(prev => prev.map(question => question.id === questionId ? { ...question, ...patch } : question));
  };

  const updateQuestionType = (questionId: number, questionType: QuestionType) => {
    setQuestions(prev => prev.map(question => question.id === questionId ? {
      ...question,
      questionType,
      answers: normalizeAnswers(
        question.answers.map(answer => ({
          ...answer,
          text: convertAnswerTextForQuestionType(answer.text, question.questionType, questionType),
        })),
        questionType,
      ),
    } : question));
  };

  const updateAnswer = (questionId: number, answerId: number, text: string) => {
    setQuestions(prev => prev.map(question => question.id === questionId ? {
      ...question,
      answers: question.answers.map(answer => answer.id === answerId ? { ...answer, text } : answer),
    } : question));
  };

  const updateAnswerPair = (questionId: number, answerId: number, patch: { left?: string; right?: string; imageUrl?: string }) => {
    setQuestions(prev => prev.map(question => question.id === questionId ? {
      ...question,
      answers: question.answers.map(answer => {
        if (answer.id !== answerId) return answer;
        const type = question.questionType === 'image_matching' ? 'image_matching' : 'matching';
        const pair = parseQuizPairAnswer(answer.text, type);
        return { ...answer, text: serializeQuizPairAnswer(type, { ...pair, ...patch }), isCorrect: true };
      }),
    } : question));
  };

  const markCorrect = (questionId: number, answerId: number) => {
    setQuestions(prev => prev.map(question => question.id === questionId ? {
      ...question,
      answers: question.answers.map(answer => ({
        ...answer,
        isCorrect: isAlwaysCorrectType(question.questionType)
          ? true
          : question.questionType === 'multiple_choice'
            ? answer.id === answerId ? !answer.isCorrect : answer.isCorrect
            : answer.id === answerId,
      })),
    } : question));
  };

  const addQuestion = () => {
    setQuestions(prev => {
      const nextQuestion = createQuestion(prev.length + 1, prev.at(-1)?.questionType ?? 'single_choice');
      setActiveQuestionId(nextQuestion.id);
      setActiveTab('questions');
      return [...prev, nextQuestion];
    });
  };

  const removeQuestion = (questionId: number) => {
    setQuestions(prev => {
      if (prev.length <= 1) return prev;
      const nextQuestions = prev.filter(question => question.id !== questionId);
      if (activeQuestionId === questionId) setActiveQuestionId(nextQuestions[0]?.id ?? 0);
      return nextQuestions;
    });
  };

  const addAnswer = (questionId: number) => {
    setQuestions(prev => prev.map(question => question.id === questionId ? {
      ...question,
      answers: [...question.answers, { id: -Date.now(), text: '', isCorrect: isAlwaysCorrectType(question.questionType) }],
    } : question));
  };

  const removeAnswer = (questionId: number, answerId: number) => {
    setQuestions(prev => prev.map(question => {
      if (question.id !== questionId || question.answers.length <= 1) return question;
      return { ...question, answers: normalizeAnswers(question.answers.filter(answer => answer.id !== answerId), question.questionType) };
    }));
  };

  const validateQuiz = () => {
    if (!form.title.trim()) return 'Quiz title is required.';
    for (const [index, question] of questions.entries()) {
      if (!question.text.trim()) return `Question ${index + 1} needs question text.`;
      if (question.questionType === 'matching' && question.answers.some(answer => !isPairAnswerComplete('matching', answer.text))) {
        return `Question ${index + 1} has an incomplete matching pair.`;
      }
      if (question.questionType === 'image_matching' && question.answers.some(answer => !isPairAnswerComplete('image_matching', answer.text))) {
        return `Question ${index + 1} needs an image or prompt plus a matching concept for every row.`;
      }
      if (!['matching', 'image_matching'].includes(question.questionType) && question.answers.some(answer => !answer.text.trim())) {
        return `Question ${index + 1} has an empty answer.`;
      }
      if (!isAlwaysCorrectType(question.questionType) && !question.answers.some(answer => answer.isCorrect)) return `Question ${index + 1} needs at least one correct answer.`;
      if (['single_choice', 'multiple_choice', 'true_false'].includes(question.questionType) && question.answers.length < 2) return `Question ${index + 1} needs at least two answers.`;
    }
    return '';
  };

  const saveManualQuiz = async (event?: FormEvent) => {
    event?.preventDefault();
    if (saving) return;
    const validationMessage = validateQuiz();
    if (validationMessage) {
      setPageError(validationMessage);
      return;
    }

    setSaving(true);
    setPageError('');
    try {
      const createResponse = await fetch('/quiz_api/quizzes/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          ...settings,
          title: form.title,
          questions: questions.length,
          questionType: questions[0]?.questionType || 'single_choice',
          linkedCourses: Number(form.linkedCourses || (form.programmeId ? 1 : 0)),
          packageType: 'xml',
          schemaValid: true,
        }),
      });
      const created = await createResponse.json().catch(() => null);
      if (!createResponse.ok) throw new Error(created?.error || 'Could not create manual quiz');

      const saveResponse = await fetch(`/quiz_api/quizzes/${created.id}/questions/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions, removeMissing: true }),
      });
      const saved = await saveResponse.json().catch(() => null);
      if (!saveResponse.ok) throw new Error(saved?.error || 'Could not save manual questions');

      success('Manual quiz saved', 'Questions and settings were saved.');
      navigate('/curriculum/quiz-xml');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save manual quiz';
      setPageError(message);
      toastError('Save failed', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Manual Quiz" pageSubtitle="Create quiz questions and settings manually" userName="Rachel Myers" userRole="Curriculum Designer">
      <form onSubmit={saveManualQuiz} className="min-h-screen bg-[#f7f6f4] p-4 sm:p-6 space-y-5">
        <div className="rounded-2xl border border-[#e3dee9] bg-white p-5 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="min-w-0">
            <button type="button" onClick={() => navigate(-1)} className="text-xs font-semibold text-[#5b2dbb] hover:text-[#43207d]">
              <AppIcon className="ri-arrow-left-line mr-1"></AppIcon> Back to Quiz Workspace
            </button>
            <h2 className="mt-2 text-2xl font-heading font-bold text-foreground-900">Manual Quiz Builder</h2>
            <p className="text-sm text-[#647083]">Build the quiz, questions and learner settings before publishing.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button type="button" onClick={addQuestion} className="h-10 px-4 rounded-lg bg-white border border-primary-200 text-primary-700 text-sm font-semibold hover:bg-primary-50">
              <AppIcon className="ri-add-line mr-1"></AppIcon>Add question
            </button>
            <button type="submit" disabled={saving} className="h-10 px-5 rounded-lg bg-[#5b2dbb] text-white text-sm font-semibold hover:bg-[#4c1d95] disabled:opacity-60 disabled:cursor-wait">
              {saving ? 'Saving...' : 'Save Manual Quiz'}
            </button>
          </div>
        </div>

        {pageError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{pageError}</div>}

        <section className="rounded-2xl border border-[#ded8e8] bg-white p-5 shadow-sm space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <input required value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Quiz title" className="sm:col-span-2 h-11 rounded-lg border border-[#d8dde6] px-3 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]" />
            <input value={form.version} onChange={event => setForm({ ...form, version: event.target.value })} placeholder="Version" className="h-11 rounded-lg border border-[#d8dde6] px-3 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]" />
            <input value={form.author} onChange={event => setForm({ ...form, author: event.target.value })} placeholder="Author" className="h-11 rounded-lg border border-[#d8dde6] px-3 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]" />
            <ThemedSelect value={form.programme} options={programmeOptions} onChange={programme => setForm({ ...form, programme, module: '', programmeId: '', week: '', weekId: '' })} menuClassName="max-h-56" buttonClassName="h-11" />
            <ThemedSelect
              value={form.module}
              options={moduleOptions}
              onChange={module => {
                const selectedModule = moduleOptions.find(option => option.value === module);
                setForm({ ...form, module, programmeId: selectedModule?.programmeId ? String(selectedModule.programmeId) : '', week: '', weekId: '' });
              }}
              disabled={!form.programme}
              menuClassName="max-h-56"
              buttonClassName="h-11"
            />
            <ThemedSelect
              value={form.weekId}
              options={weekOptions}
              onChange={weekId => {
                const selectedWeek = weeks.find(week => week.id === weekId);
                setForm({ ...form, weekId, week: selectedWeek?.title || '' });
              }}
              disabled={!form.module || weeksState === 'loading' || weeks.length === 0}
              menuClassName="max-h-56"
              buttonClassName="h-11"
            />
            <ThemedSelect value={form.status} options={quizStatusOptions} onChange={status => setForm({ ...form, status })} buttonClassName="h-11" />
          </div>
        </section>

        <section className="rounded-2xl border border-[#ded8e8] bg-white p-5 shadow-sm">
          <div className="grid grid-cols-2 max-w-md rounded-xl bg-[#edf0f5] p-1 overflow-hidden mb-5">
            {[
              { id: 'questions' as const, label: 'Questions', count: questions.length },
              { id: 'settings' as const, label: 'Settings' },
            ].map(tab => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`h-10 rounded-lg text-sm font-semibold transition-smooth ${activeTab === tab.id ? 'bg-white text-[#43207d] shadow-sm' : 'text-[#526173] hover:bg-white/65'}`}>
                {tab.label}
                {'count' in tab && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-[#dce3ec] text-[#526173]">{tab.count}</span>}
              </button>
            ))}
          </div>

          {activeTab === 'questions' && (
            <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-5">
              <aside className="border border-[#dfe4ec] rounded-2xl bg-[#f8fafc] p-3 max-h-[680px] overflow-y-auto quiz-preview-scroll">
                <button type="button" onClick={addQuestion} className="mb-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#5b2dbb] text-sm font-semibold text-white hover:bg-[#4c1d95]">
                  <AppIcon className="ri-add-line"></AppIcon>Add question
                </button>
                <div className="space-y-2">
                  {questions.map((question, index) => (
                    <button key={question.id} type="button" onClick={() => setActiveQuestionId(question.id)} className={`w-full rounded-xl border px-3 py-2 text-left transition-smooth ${activeQuestion?.id === question.id ? 'bg-white border-[#a78bfa] shadow-sm' : 'bg-white/85 border-[#e2e8f0] hover:border-[#c4b5fd]'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-bold text-foreground-400">{String(index + 1).padStart(2, '0')}</span>
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#e8edf4] text-[#526173]">{questionTypeOptions.find(option => option.value === question.questionType)?.label}</span>
                      </div>
                      <p className="text-xs text-foreground-800 line-clamp-2">{question.text || 'Untitled question'}</p>
                    </button>
                  ))}
                </div>
              </aside>

              {activeQuestion && (
                <section className="min-w-0 space-y-5">
                  <div>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <label className="text-xs font-semibold text-foreground-600">Question text</label>
                      <button type="button" onClick={() => removeQuestion(activeQuestion.id)} disabled={questions.length === 1} className="h-8 px-3 rounded-lg bg-red-50 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed">
                        <AppIcon className="ri-delete-bin-line mr-1"></AppIcon>Remove
                      </button>
                    </div>
                    <textarea value={activeQuestion.text} onChange={event => updateQuestion(activeQuestion.id, { text: event.target.value })} className="w-full min-h-36 rounded-xl border border-[#d8dde6] bg-white p-4 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]" placeholder="Write the question learners will answer" />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-foreground-600 mb-2">Question type</label>
                      <ThemedSelect value={activeQuestion.questionType} options={questionTypeOptions} onChange={questionType => updateQuestionType(activeQuestion.id, questionType)} buttonClassName="h-11" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground-600 mb-2">Feedback</label>
                      <input value={activeQuestion.explanation} onChange={event => updateQuestion(activeQuestion.id, { explanation: event.target.value })} className="w-full h-11 rounded-lg border border-[#d8dde6] bg-white px-3 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]" placeholder="Feedback or explanation" />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-heading font-bold text-foreground-900">{activeAnswerCopy.title}</h3>
                        <p className="text-xs text-[#647083] mt-1">{activeAnswerCopy.hint}</p>
                      </div>
                      {activeQuestion.questionType !== 'true_false' && (
                        <button type="button" onClick={() => addAnswer(activeQuestion.id)} className="h-9 px-3 rounded-lg bg-[#5b2dbb] text-white text-xs font-semibold hover:bg-[#4c1d95]">
                          <AppIcon className="ri-add-line mr-1"></AppIcon>{activeAnswerCopy.add}
                        </button>
                      )}
                    </div>
                    <div className="space-y-3">
                      {activeQuestion.answers.map((answer, answerIndex) => {
                        const isPair = activeQuestion.questionType === 'matching' || activeQuestion.questionType === 'image_matching';
                        const pair = isPair
                          ? parseQuizPairAnswer(
                            answer.text,
                            activeQuestion.questionType === 'image_matching' ? 'image_matching' : 'matching',
                          )
                          : null;
                        const rowLabel = activeQuestion.questionType === 'ordering' ? answerIndex + 1 : String.fromCharCode(65 + answerIndex);
                        return (
                          <div key={answer.id} className="rounded-xl border border-[#e2e8f0] bg-[#fbfcfe] p-3">
                            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                              <span className="w-8 h-8 rounded-lg bg-white border border-[#d8dde6] text-[#647083] flex items-center justify-center text-xs font-bold shrink-0">{rowLabel}</span>
                              {isPair ? (
                                activeQuestion.questionType === 'image_matching' ? (
                                  <ImageMatchingPairFields
                                    value={answer.text}
                                    onChange={nextValue => updateAnswerPair(activeQuestion.id, answer.id, parseQuizPairAnswer(nextValue, 'image_matching'))}
                                  />
                                ) : (
                                  <div className="grid flex-1 min-w-0 grid-cols-1 sm:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)] gap-2">
                                    <input value={pair?.left ?? ''} onChange={event => updateAnswerPair(activeQuestion.id, answer.id, { left: event.target.value })} placeholder="Prompt" className="h-10 rounded-lg border border-[#d8dde6] bg-white px-3 text-sm outline-none focus:border-[#8b5cf6]" />
                                    <span className="hidden sm:flex items-center justify-center text-[#5b2dbb]"><AppIcon className="ri-arrow-right-line"></AppIcon></span>
                                    <input value={pair?.right ?? ''} onChange={event => updateAnswerPair(activeQuestion.id, answer.id, { right: event.target.value })} placeholder="Match" className="h-10 rounded-lg border border-[#d8dde6] bg-white px-3 text-sm outline-none focus:border-[#8b5cf6]" />
                                  </div>
                                )
                              ) : (
                                <input value={answer.text} readOnly={activeQuestion.questionType === 'true_false'} onChange={event => updateAnswer(activeQuestion.id, answer.id, event.target.value)} placeholder={activeQuestion.questionType === 'ordering' ? `Step ${answerIndex + 1}` : `Option ${rowLabel}`} className="flex-1 min-w-0 h-10 rounded-lg border border-[#d8dde6] bg-white px-3 text-sm outline-none focus:border-[#8b5cf6] read-only:bg-[#f8fafc]" />
                              )}
                              {isAlwaysCorrectType(activeQuestion.questionType) ? (
                                <span className="text-xs font-semibold text-emerald-700 shrink-0">Accepted</span>
                              ) : (
                                <label className="inline-flex items-center gap-2 text-sm text-foreground-700 shrink-0">
                                  <input type={activeQuestion.questionType === 'multiple_choice' ? 'checkbox' : 'radio'} name={`correct-${activeQuestion.id}`} checked={answer.isCorrect} onChange={() => markCorrect(activeQuestion.id, answer.id)} className="w-4 h-4" />
                                  Correct
                                </label>
                              )}
                              {activeQuestion.questionType !== 'true_false' && (
                                <button type="button" onClick={() => removeAnswer(activeQuestion.id, answer.id)} disabled={activeQuestion.answers.length <= 1} className="w-9 h-9 rounded-lg bg-white text-foreground-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed shrink-0">
                                  <AppIcon className="ri-close-line"></AppIcon>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="max-w-5xl space-y-6">
              <Field label="Short description of the quiz">
                <textarea value={settings.shortDescription} onChange={event => setSettings({ ...settings, shortDescription: event.target.value })} className="w-full min-h-24 rounded-xl border border-[#d8dde6] bg-white p-3 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]" />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Quiz duration">
                  <input type="number" min="0" value={settings.duration} onChange={event => setSettings({ ...settings, duration: Number(event.target.value || 0) })} className="h-11 w-full rounded-lg border border-[#d8dde6] bg-white px-3 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]" />
                </Field>
                <Field label="Time unit">
                  <ThemedSelect value={settings.timeUnit} options={timeUnitOptions} onChange={timeUnit => setSettings({ ...settings, timeUnit })} buttonClassName="h-11" />
                </Field>
              </div>

              <Field label="Quiz style">
                <ThemedSelect value={settings.quizStyle} options={quizStyleOptions} onChange={quizStyle => setSettings({ ...settings, quizStyle })} buttonClassName="h-11" />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Toggle label="Randomize questions" checked={settings.randomizeQuestions} onChange={checked => setSettings({ ...settings, randomizeQuestions: checked })} />
                <Toggle label="Randomize answers" checked={settings.randomizeAnswers} onChange={checked => setSettings({ ...settings, randomizeAnswers: checked })} />
                <Toggle label="Show correct answer" checked={settings.showCorrectAnswer} onChange={checked => setSettings({ ...settings, showCorrectAnswer: checked })} />
                <Toggle label="Quiz Attempt History" checked={settings.attemptHistory} onChange={checked => setSettings({ ...settings, attemptHistory: checked })} />
                <Toggle label="Retake After Pass" checked={settings.retakeAfterPass} onChange={checked => setSettings({ ...settings, retakeAfterPass: checked })} />
                <Toggle label="Limited attempts to retake quizzes" checked={settings.limitAttempts} onChange={checked => setSettings({ ...settings, limitAttempts: checked })} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Passing grade (%)">
                  <input type="number" min="0" max="100" value={settings.passingGrade} onChange={event => setSettings({ ...settings, passingGrade: Number(event.target.value || 0) })} className="h-11 w-full rounded-lg border border-[#d8dde6] bg-white px-3 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]" />
                </Field>
                <Field label="Points cut after retake (%)">
                  <input type="number" min="0" max="100" value={settings.retakePointsCut} onChange={event => setSettings({ ...settings, retakePointsCut: Number(event.target.value || 0) })} className="h-11 w-full rounded-lg border border-[#d8dde6] bg-white px-3 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]" />
                </Field>
              </div>

              <div className="rounded-xl bg-[#f3f6fb] border border-[#e2e8f0] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <p className="text-sm text-foreground-700">
                  <strong>Hint:</strong> These settings will be saved with the new quiz and can be refined later from the Edit page.
                </p>
                <span className="h-9 px-4 rounded-lg bg-white border border-[#d8dde6] text-[#5b2dbb] text-sm font-semibold inline-flex items-center justify-center">Draft settings</span>
              </div>

              <div className="pt-5 border-t border-[#e2e8f0]">
                <label className="block text-xs font-semibold text-foreground-700 mb-2">Lesson content</label>
                <div className="rounded-xl border border-[#d8dde6] overflow-hidden bg-white">
                  <div className="h-11 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center gap-3 px-3 text-xs text-[#526173] overflow-x-auto">
                    <span>View</span><span>Format</span><span>Table</span><span>Tools</span>
                    <span className="ml-4 font-semibold">B</span><span className="italic font-semibold">I</span><span className="underline font-semibold">U</span>
                    <AppIcon className="ri-link"></AppIcon><AppIcon className="ri-image-line"></AppIcon><AppIcon className="ri-video-line"></AppIcon><AppIcon className="ri-list-check-2"></AppIcon><AppIcon className="ri-align-left"></AppIcon>
                  </div>
                  <textarea value={settings.lessonContent} onChange={event => setSettings({ ...settings, lessonContent: event.target.value })} className="w-full min-h-72 bg-white p-4 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-inset focus:ring-[#ede9fe]" />
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="sticky bottom-0 z-20 -mx-4 sm:-mx-6 bg-white/95 border-t border-[#e2e8f0] px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)]">
          <p className="text-xs text-[#647083]">{questions.length} question{questions.length === 1 ? '' : 's'} ready to save.</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <button type="button" onClick={addQuestion} className="px-4 py-2 rounded-lg bg-white border border-primary-200 text-primary-700 text-sm font-semibold hover:bg-primary-50">
              <AppIcon className="ri-add-line mr-1"></AppIcon>Add question
            </button>
            <button type="submit" disabled={saving} className="px-5 py-2 rounded-lg bg-[#5b2dbb] text-white text-sm font-semibold hover:bg-[#4c1d95] disabled:opacity-60 disabled:cursor-wait">
              {saving ? 'Saving...' : 'Save Manual Quiz'}
            </button>
          </div>
        </div>
      </form>
    </WorkspaceShell>
  );
}
