// Reusable quiz editor — the full authoring surface (questions, settings, Q&A,
// archive) with NO page chrome or routing of its own. `edit/page.tsx` wraps it
// in the curriculum WorkspaceShell for the /curriculum/quiz-xml/:id/edit route;
// the Week Builder mounts the very same component inside a modal so quizzes are
// authored inline without leaving the page. Takes the quiz id as a prop and an
// optional onClose (rendered as a back/close control instead of the route Link).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { ImageMatchingPairFields } from '@/components/feature/ImageMatchingPairFields';
import { ThemedSelect } from '@/components/feature/ThemedSelect';
import { QuestionAnswersView } from '@/components/feature/QuestionTypeRenderer';
import { useToast } from '@/hooks/useToast';
import { formatQuizGradeRange, useQuizGradeSettings } from '@/lib/quizGradeSettings';
import { convertAnswerTextForQuestionType, isPairAnswerComplete, parseQuizPairAnswer, serializeQuizPairAnswer } from '@/lib/quizPairAnswers';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';

type QuizStatus = 'published' | 'pending' | 'draft' | 'trash' | 'private' | 'validating';
type PackageType = 'xml' | 'scorm' | 'excel' | 'csv' | 'file';
type QuestionType = 'single_choice' | 'multiple_choice' | 'true_false' | 'matching' | 'image_matching' | 'keywords' | 'fill_gap' | 'ordering';
type EditorTab = 'questions' | 'settings' | 'qa' | 'archive';

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

const quizStatusOptions: { value: QuizStatus; label: string }[] = [
  { value: 'published', label: 'Published' },
  { value: 'pending', label: 'Pending' },
  { value: 'draft', label: 'Draft' },
  { value: 'trash', label: 'Archive' },
  { value: 'private', label: 'Private' },
];

interface QuizPackage {
  id: number;
  title: string;
  module: string;
  programme: string;
  questions: number;
  defaultQuestionType: QuestionType;
  version: string;
  status: QuizStatus;
  packageType: PackageType;
  displaySize: string;
  schemaValid: boolean;
  author: string;
  linkedCourses: number;
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

interface QuizQuestion {
  id: number;
  text: string;
  questionType: QuestionType;
  explanation: string;
  isArchived: boolean;
  answers: {
    id: number;
    text: string;
    isCorrect: boolean;
  }[];
}

interface QuizEditorData {
  quiz: QuizPackage;
  questions: QuizQuestion[];
}

interface CourseLinkWeekOption {
  id: string;
  label: string;
}

interface CourseLinkOption {
  id: string;
  moduleCatalogueId?: string;
  label: string;
  programme: string;
  programmeId?: string;
  module: string;
  cohort: string;
  startDate: string;
  selected: boolean;
  weeks?: CourseLinkWeekOption[];
}

interface CourseLinkAssignment {
  moduleCatalogueId: string;
  weekId: string;
}

interface CourseLinksState {
  programme: string;
  selectedProgrammeId?: string;
  selectedProgrammeName?: string;
  selectedIds: string[];
  selectedModuleCatalogueIds?: string[];
  selectedAssignments?: CourseLinkAssignment[];
  selectedWeekIdsByModule?: Record<string, string>;
  courses: CourseLinkOption[];
}

interface QuizSettingsState {
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

function questionLabel(type: QuestionType) {
  return questionTypeOptions.find(option => option.value === type)?.label || type;
}

function answerEditorCopy(type: QuestionType) {
  if (type === 'multiple_choice') return { title: 'Answer choices', hint: 'Tick every option that should be accepted as correct.', addLabel: 'Add option' };
  if (type === 'true_false') return { title: 'True/False answers', hint: 'Choose whether True or False is the correct answer.', addLabel: 'Add option' };
  if (type === 'matching') return { title: 'Matching pairs', hint: 'Write each pair as a left prompt and a matching answer.', addLabel: 'Add pair' };
  if (type === 'image_matching') return { title: 'Image matching pairs', hint: 'Upload each image and enter the answer it should match.', addLabel: 'Add match' };
  if (type === 'keywords') return { title: 'Accepted keywords', hint: 'Every row is treated as an accepted keyword or phrase.', addLabel: 'Add keyword' };
  if (type === 'fill_gap') return { title: 'Accepted gap answers', hint: 'Every row is treated as an accepted answer for the blank.', addLabel: 'Add answer' };
  if (type === 'ordering') return { title: 'Correct order', hint: 'Drag items into the correct order. The order itself is the correct answer.', addLabel: 'Add step' };
  return { title: 'Answer choices', hint: 'Choose the one best correct answer.', addLabel: 'Add option' };
}

function isAlwaysCorrectType(type: QuestionType) {
  return ['ordering', 'matching', 'image_matching', 'keywords', 'fill_gap'].includes(type);
}

function normalizeAnswersForQuestionType(answers: QuizQuestion['answers'], type: QuestionType): QuizQuestion['answers'] {
  const fallbackId = Date.now();
  const nextAnswers = answers.length ? [...answers] : [{ id: fallbackId, text: '', isCorrect: true }];

  if (type === 'true_false') {
    const correctText = nextAnswers.find(answer => answer.isCorrect)?.text.toLowerCase() || '';
    const trueAnswer = nextAnswers.find(answer => answer.text.toLowerCase().trim() === 'true') || nextAnswers[0] || { id: fallbackId, text: 'True', isCorrect: true };
    const falseAnswer = nextAnswers.find(answer => answer.text.toLowerCase().trim() === 'false') || nextAnswers[1] || { id: fallbackId + 1, text: 'False', isCorrect: false };
    const falseIsCorrect = correctText.includes('false');

    return [
      { ...trueAnswer, text: 'True', isCorrect: !falseIsCorrect },
      { ...falseAnswer, text: 'False', isCorrect: falseIsCorrect },
    ];
  }

  if (isAlwaysCorrectType(type)) {
    return nextAnswers.map(answer => ({ ...answer, isCorrect: true }));
  }

  if (type === 'multiple_choice') {
    const hasCorrect = nextAnswers.some(answer => answer.isCorrect);
    return nextAnswers.map((answer, index) => ({ ...answer, isCorrect: hasCorrect ? answer.isCorrect : index === 0 }));
  }

  const firstCorrectIndex = Math.max(nextAnswers.findIndex(answer => answer.isCorrect), 0);
  return nextAnswers.map((answer, index) => ({ ...answer, isCorrect: index === firstCorrectIndex }));
}

function createDraftQuestion(order: number, questionType: QuestionType = 'single_choice'): QuizQuestion {
  const questionId = -Date.now();
  const baseAnswerId = questionId * 10;

  return {
    id: questionId,
    text: `New question ${order}`,
    questionType,
    explanation: '',
    isArchived: false,
    answers: normalizeAnswersForQuestionType([
      { id: baseAnswerId - 1, text: '', isCorrect: true },
      { id: baseAnswerId - 2, text: '', isCorrect: false },
      { id: baseAnswerId - 3, text: '', isCorrect: false },
      { id: baseAnswerId - 4, text: '', isCorrect: false },
    ], questionType),
  };
}

function normalizeQuizStyle(value: string) {
  return ['default', 'pagination', 'global'].includes(value) ? value : 'default';
}

function statusLabel(status: QuizStatus) {
  if (status === 'validating') return 'Pending';
  return quizStatusOptions.find(option => option.value === status)?.label || status;
}

function statusPillClass(status: QuizStatus) {
  if (status === 'published') return 'bg-emerald-100 text-emerald-700 shadow-sm';
  if (status === 'pending' || status === 'validating') return 'bg-amber-100 text-amber-700 shadow-sm';
  if (status === 'trash') return 'bg-red-100 text-red-700 shadow-sm';
  if (status === 'private') return 'bg-sky-100 text-sky-700 shadow-sm';
  return 'bg-[#fff7ed] text-[#b45309] shadow-sm';
}

function settingsFromQuiz(quiz: QuizPackage): QuizSettingsState {
  return {
    shortDescription: quiz.shortDescription || '',
    lessonContent: quiz.lessonContent || quiz.shortDescription || '',
    duration: quiz.duration || 60,
    timeUnit: quiz.timeUnit || 'minutes',
    quizStyle: normalizeQuizStyle(quiz.quizStyle || 'default'),
    randomizeQuestions: Boolean(quiz.randomizeQuestions),
    randomizeAnswers: Boolean(quiz.randomizeAnswers),
    showCorrectAnswer: Boolean(quiz.showCorrectAnswer),
    attemptHistory: Boolean(quiz.attemptHistory),
    retakeAfterPass: Boolean(quiz.retakeAfterPass),
    limitAttempts: Boolean(quiz.limitAttempts),
    passingGrade: quiz.passingGrade || 65,
    retakePointsCut: quiz.retakePointsCut || 5,
  };
}

function serializeQuestions(questions: QuizQuestion[]) {
  return JSON.stringify(questions.map(question => ({
    text: question.text,
    questionType: question.questionType,
    explanation: question.explanation,
    isArchived: question.isArchived,
    answers: question.answers.map(answer => ({
      text: answer.text,
      isCorrect: answer.isCorrect,
    })),
  })));
}

function serializeSettings(settings: QuizSettingsState) {
  return JSON.stringify(settings);
}

function buildCourseLinkAssignments(courseLinks: CourseLinksState | null): CourseLinkAssignment[] {
  const selectedIds = [...new Set(courseLinks?.selectedModuleCatalogueIds ?? courseLinks?.selectedIds ?? [])]
    .map(id => String(id))
    .sort();
  const selectedWeekIdsByModule = courseLinks?.selectedWeekIdsByModule ?? {};
  return selectedIds.map(moduleCatalogueId => ({
    moduleCatalogueId,
    weekId: String(selectedWeekIdsByModule[moduleCatalogueId] ?? '').trim(),
  }));
}

function serializeCourseLinks(courseLinks: CourseLinksState | null) {
  const selectedAssignments = buildCourseLinkAssignments(courseLinks);
  return JSON.stringify({
    programmeId: courseLinks?.selectedProgrammeId || '',
    selectedIds: selectedAssignments.map(assignment => assignment.moduleCatalogueId),
    selectedAssignments,
  });
}

function normaliseCourseLinks(payload: CourseLinksState | null): CourseLinksState | null {
  if (!payload) return null;
  const selectedAssignments = Array.isArray(payload.selectedAssignments)
    ? payload.selectedAssignments
        .map(assignment => ({
          moduleCatalogueId: String(assignment?.moduleCatalogueId ?? ''),
          weekId: String(assignment?.weekId ?? ''),
        }))
        .filter(assignment => assignment.moduleCatalogueId)
    : [];
  const selectedIds = Array.from(new Set([
    ...(payload.selectedModuleCatalogueIds ?? payload.selectedIds ?? []).map(id => String(id)),
    ...selectedAssignments.map(assignment => assignment.moduleCatalogueId),
  ]));
  const courses = (payload.courses ?? []).map(course => ({
    ...course,
    id: String(course.moduleCatalogueId ?? course.id),
    moduleCatalogueId: String(course.moduleCatalogueId ?? course.id),
    programmeId: String(course.programmeId ?? ''),
    selected: selectedIds.includes(String(course.moduleCatalogueId ?? course.id)),
    weeks: (course.weeks ?? [])
      .map(week => ({
        id: String(week.id ?? ''),
        label: String(week.label ?? ''),
      }))
      .filter(week => week.id),
  }));
  const selectedWeekIdsByModule = selectedAssignments.reduce<Record<string, string>>((map, assignment) => {
    map[assignment.moduleCatalogueId] = assignment.weekId;
    return map;
  }, {});
  selectedIds.forEach(selectedId => {
    const validWeekIds = new Set(
      (courses.find(course => course.id === selectedId)?.weeks ?? [])
        .map(week => String(week.id ?? '').trim())
        .filter(Boolean),
    );
    const currentWeekId = String(selectedWeekIdsByModule[selectedId] ?? '').trim();
    if (validWeekIds.size > 0 && !validWeekIds.has(currentWeekId)) selectedWeekIdsByModule[selectedId] = '';
  });
  const programmeNameById = new Map<string, string>();
  courses.forEach(course => {
    const programmeId = String(course.programmeId ?? '').trim();
    if (!programmeId) return;
    if (!programmeNameById.has(programmeId)) programmeNameById.set(programmeId, String(course.programme || '').trim() || programmeId);
  });
  const explicitProgrammeId = String(payload.selectedProgrammeId ?? '').trim();
  const firstSelectedProgrammeId = courses.find(course => selectedIds.includes(course.id) && String(course.programmeId ?? '').trim())?.programmeId ?? '';
  const programmeFromLabel = courses.find(course => String(course.programme || '').trim() === String(payload.programme || '').trim())?.programmeId ?? '';
  const selectedProgrammeId = (
    (explicitProgrammeId && programmeNameById.has(explicitProgrammeId) && explicitProgrammeId)
    || firstSelectedProgrammeId
    || programmeFromLabel
    || (programmeNameById.size === 1 ? Array.from(programmeNameById.keys())[0] : '')
  );
  const selectedProgrammeName = (
    (selectedProgrammeId && programmeNameById.get(selectedProgrammeId))
    || String(payload.selectedProgrammeName ?? '').trim()
    || String(payload.programme || '').trim()
  );
  return {
    ...payload,
    programme: selectedProgrammeName,
    selectedProgrammeId,
    selectedProgrammeName,
    selectedIds,
    selectedModuleCatalogueIds: selectedIds,
    selectedAssignments: selectedIds.map(moduleCatalogueId => ({
      moduleCatalogueId,
      weekId: String(selectedWeekIdsByModule[moduleCatalogueId] ?? '').trim(),
    })),
    selectedWeekIdsByModule,
    courses,
  };
}

export function QuizEditorPanel({ quizId, onClose, onSaved }: { quizId: string | number | undefined; onClose?: () => void; onSaved?: () => void }) {
  const { success, error: toastError } = useToast();
  const [activeTab, setActiveTab] = useState<EditorTab>('questions');
  const [data, setData] = useState<QuizEditorData | null>(null);
  const [settings, setSettings] = useState<QuizSettingsState | null>(null);
  const [courseLinks, setCourseLinks] = useState<CourseLinksState | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<number | null>(null);
  const [questionBaseline, setQuestionBaseline] = useState('');
  const [settingsBaseline, setSettingsBaseline] = useState('');
  const [courseLinksBaseline, setCourseLinksBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingQuestions, setSavingQuestions] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingCourseLinks, setSavingCourseLinks] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [showGradesTable, setShowGradesTable] = useState(false);
  const [qaPageIndex, setQaPageIndex] = useState(0);
  const [draggedQuestionId, setDraggedQuestionId] = useState<number | null>(null);
  const [dragOverQuestionId, setDragOverQuestionId] = useState<number | null>(null);
  const [draggedAnswerId, setDraggedAnswerId] = useState<number | null>(null);
  const [dragOverAnswerId, setDragOverAnswerId] = useState<number | null>(null);
  const [pageError, setPageError] = useState('');
  const [gradeSettings] = useQuizGradeSettings();

  const activeQuestions = useMemo(() => data?.questions.filter(question => !question.isArchived) ?? [], [data?.questions]);
  const archivedQuestions = useMemo(() => data?.questions.filter(question => question.isArchived) ?? [], [data?.questions]);
  const activeQuestion = activeQuestions.find(question => question.id === activeQuestionId) ?? activeQuestions[0];
  const activeQuestionIndex = activeQuestion ? activeQuestions.findIndex(question => question.id === activeQuestion.id) : -1;
  const hintGradeRow = gradeSettings.rows.find(row => row.point === 4.5) ?? gradeSettings.rows[1] ?? gradeSettings.rows[0];
  const hintGradeIndex = hintGradeRow ? gradeSettings.rows.findIndex(row => row.grade === hintGradeRow.grade && row.min === hintGradeRow.min) : -1;
  const questionDirty = Boolean(data && serializeQuestions(data.questions) !== questionBaseline);
  const settingsDirty = Boolean(settings && serializeSettings(settings) !== settingsBaseline);
  const courseLinksDirty = Boolean(courseLinks && serializeCourseLinks(courseLinks) !== courseLinksBaseline);
  const selectedCourseLinks = useMemo(
    () => courseLinks?.courses.filter(course => courseLinks.selectedIds.includes(course.id)) ?? [],
    [courseLinks],
  );
  const programmeOptions = useMemo(() => {
    if (!courseLinks) return [];
    const options = new Map<string, string>();
    courseLinks.courses.forEach(course => {
      const programmeId = String(course.programmeId ?? '').trim();
      const programmeName = String(course.programme || '').trim();
      if (!programmeId || options.has(programmeId)) return;
      options.set(programmeId, programmeName || programmeId);
    });
    return [
      { value: '', label: 'Select programme' },
      ...Array.from(options.entries()).map(([value, label]) => ({ value, label })),
    ];
  }, [courseLinks]);
  const visibleCourseLinks = useMemo(() => {
    if (!courseLinks) return [];
    if (!courseLinks.selectedProgrammeId) return [];
    return courseLinks.courses.filter(course => String(course.programmeId ?? '') === courseLinks.selectedProgrammeId);
  }, [courseLinks]);
  const headerProgramme = courseLinks?.selectedProgrammeName || courseLinks?.programme || data?.quiz.programme || 'No programme';
  const headerModule = data?.quiz.module || (
    selectedCourseLinks.length === 1
      ? selectedCourseLinks[0].module
      : selectedCourseLinks.length > 1
        ? 'Multiple modules'
        : 'No module'
  );

  const loadQuiz = useCallback(async () => {
    if (!quizId) return;
    setLoading(true);
    setPageError('');
    try {
      const response = await fetch(`/quiz_api/quizzes/${quizId}/questions/`);
      if (!response.ok) throw new Error('Could not load quiz editor');
      const nextData: QuizEditorData = await response.json();
      const courseLinksResponse = await fetch(`/quiz_api/quizzes/${nextData.quiz.id}/course-links/`);
      const nextCourseLinks = normaliseCourseLinks(courseLinksResponse.ok ? await courseLinksResponse.json() : null);
      const nextSettings = settingsFromQuiz(nextData.quiz);
      setData(nextData);
      setSettings(nextSettings);
      setCourseLinks(nextCourseLinks);
      setActiveQuestionId(nextData.questions[0]?.id ?? null);
      setQuestionBaseline(serializeQuestions(nextData.questions));
      setSettingsBaseline(serializeSettings(nextSettings));
      setCourseLinksBaseline(serializeCourseLinks(nextCourseLinks));
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Could not load quiz editor');
    } finally {
      setLoading(false);
    }
  }, [quizId]);

  useEffect(() => {
    void loadQuiz();
  }, [loadQuiz]);

  useEffect(() => {
    setQaPageIndex(0);
  }, [settings?.quizStyle, data?.questions.length]);

  const tabs = useMemo(() => [
    { id: 'questions' as const, label: 'Questions', count: activeQuestions.length },
    { id: 'settings' as const, label: 'Settings' },
    { id: 'qa' as const, label: 'Q&A' },
    { id: 'archive' as const, label: 'Archive', count: archivedQuestions.length, icon: 'ri-archive-line' },
  ], [activeQuestions.length, archivedQuestions.length]);

  const updateQuestion = (questionId: number, patch: Partial<QuizQuestion>) => {
    setData(prev => prev ? ({
      ...prev,
      questions: prev.questions.map(question => question.id === questionId ? { ...question, ...patch } : question),
    }) : prev);
  };

  const updateAnswer = (questionId: number, answerId: number, text: string) => {
    setData(prev => prev ? ({
      ...prev,
      questions: prev.questions.map(question => question.id === questionId ? {
        ...question,
        answers: question.answers.map(answer => answer.id === answerId ? { ...answer, text } : answer),
      } : question),
    }) : prev);
  };

  const updateAnswerPair = (questionId: number, answerId: number, patch: { left?: string; right?: string; imageUrl?: string }) => {
    setData(prev => prev ? ({
      ...prev,
      questions: prev.questions.map(question => question.id === questionId ? {
        ...question,
        answers: question.answers.map(answer => {
          if (answer.id !== answerId) return answer;
          const type = question.questionType === 'image_matching' ? 'image_matching' : 'matching';
          const pair = parseQuizPairAnswer(answer.text, type);
          return {
            ...answer,
            text: serializeQuizPairAnswer(type, { ...pair, ...patch }),
            isCorrect: true,
          };
        }),
      } : question),
    }) : prev);
  };

  const updateQuestionType = (questionId: number, questionType: QuestionType) => {
    setData(prev => prev ? ({
      ...prev,
      questions: prev.questions.map(question => question.id === questionId ? {
        ...question,
        questionType,
        answers: normalizeAnswersForQuestionType(
          question.answers.map(answer => ({
            ...answer,
            text: convertAnswerTextForQuestionType(answer.text, question.questionType, questionType),
          })),
          questionType,
        ),
      } : question),
    }) : prev);
  };

  const markCorrect = (questionId: number, answerId: number) => {
    setData(prev => prev ? ({
      ...prev,
      questions: prev.questions.map(question => question.id === questionId ? {
        ...question,
        answers: question.answers.map(answer => ({
          ...answer,
          isCorrect: isAlwaysCorrectType(question.questionType)
            ? true
            : question.questionType === 'multiple_choice'
            ? answer.id === answerId ? !answer.isCorrect : answer.isCorrect
            : answer.id === answerId,
        })),
      } : question),
    }) : prev);
  };

  const reorderAnswer = (questionId: number, sourceAnswerId: number, targetAnswerId: number) => {
    if (sourceAnswerId === targetAnswerId) return;
    setData(prev => prev ? ({
      ...prev,
      questions: prev.questions.map(question => {
        if (question.id !== questionId) return question;
        const sourceIndex = question.answers.findIndex(answer => answer.id === sourceAnswerId);
        const targetIndex = question.answers.findIndex(answer => answer.id === targetAnswerId);
        if (sourceIndex === -1 || targetIndex === -1) return question;
        const nextAnswers = [...question.answers];
        const [moved] = nextAnswers.splice(sourceIndex, 1);
        nextAnswers.splice(targetIndex, 0, moved);
        return {
          ...question,
          answers: nextAnswers.map(answer => ({ ...answer, isCorrect: question.questionType === 'ordering' ? true : answer.isCorrect })),
        };
      }),
    }) : prev);
  };

  const handleAnswerDrop = (questionId: number, targetAnswerId: number) => {
    if (draggedAnswerId) reorderAnswer(questionId, draggedAnswerId, targetAnswerId);
    setDraggedAnswerId(null);
    setDragOverAnswerId(null);
  };

  const moveQuestion = (questionId: number, direction: 'up' | 'down') => {
    setData(prev => {
      if (!prev) return prev;
      const currentIndex = prev.questions.findIndex(question => question.id === questionId);
      if (currentIndex === -1) return prev;
      const currentQuestion = prev.questions[currentIndex];
      const swapIndex = direction === 'up'
        ? prev.questions.slice(0, currentIndex).map((question, index) => ({ question, index })).reverse().find(item => item.question.isArchived === currentQuestion.isArchived)?.index
        : prev.questions.slice(currentIndex + 1).map((question, index) => ({ question, index: currentIndex + 1 + index })).find(item => item.question.isArchived === currentQuestion.isArchived)?.index;
      if (swapIndex === undefined) return prev;
      const nextQuestions = [...prev.questions];
      [nextQuestions[currentIndex], nextQuestions[swapIndex]] = [nextQuestions[swapIndex], nextQuestions[currentIndex]];
      return { ...prev, questions: nextQuestions };
    });
  };

  const reorderQuestion = (sourceId: number, targetId: number) => {
    if (sourceId === targetId) return;
    setData(prev => {
      if (!prev) return prev;
      const active = prev.questions.filter(question => !question.isArchived);
      const archived = prev.questions.filter(question => question.isArchived);
      const sourceIndex = active.findIndex(question => question.id === sourceId);
      const targetIndex = active.findIndex(question => question.id === targetId);
      if (sourceIndex === -1 || targetIndex === -1) return prev;
      const reorderedActive = [...active];
      const [moved] = reorderedActive.splice(sourceIndex, 1);
      reorderedActive.splice(targetIndex, 0, moved);
      return { ...prev, questions: [...reorderedActive, ...archived] };
    });
  };

  const handleQuestionDrop = (targetId: number) => {
    if (draggedQuestionId) reorderQuestion(draggedQuestionId, targetId);
    setDraggedQuestionId(null);
    setDragOverQuestionId(null);
  };

  const addQuestion = () => {
    setData(prev => {
      if (!prev) return prev;
      const nextQuestion = createDraftQuestion(
        prev.questions.filter(question => !question.isArchived).length + 1,
        prev.quiz.defaultQuestionType || 'single_choice',
      );
      setActiveQuestionId(nextQuestion.id);
      setActiveTab('questions');
      return {
        ...prev,
        questions: [...prev.questions.filter(question => !question.isArchived), nextQuestion, ...prev.questions.filter(question => question.isArchived)],
      };
    });
  };

  const persistQuestionList = async (questions: QuizQuestion[], nextActiveQuestionId: number | null, title: string, message: string) => {
    if (!data || savingQuestions) return;
    setSavingQuestions(true);
    try {
      const response = await fetch(`/quiz_api/quizzes/${data.quiz.id}/questions/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions, removeMissing: true }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || 'Could not save questions');
      }
      const nextData: QuizEditorData = await response.json();
      setData(nextData);
      setActiveQuestionId(nextActiveQuestionId ?? nextData.questions.find(question => !question.isArchived)?.id ?? null);
      setQuestionBaseline(serializeQuestions(nextData.questions));
      success(title, message);
      onSaved?.();
    } catch (err) {
      toastError('Save failed', err instanceof Error ? err.message : 'Could not save questions');
      void loadQuiz();
    } finally {
      setSavingQuestions(false);
    }
  };

  const archiveQuestion = async (questionId: number) => {
    if (!data || savingQuestions) return;
    const targetQuestion = data.questions.find(question => question.id === questionId);
    await showCurriculumConfirm({
      title: 'Archive question?',
      text: `Are you sure you want to archive "${targetQuestion?.text || 'this question'}"?`,
      icon: 'warning',
      confirmButtonText: 'Archive question',
      onConfirm: async () => {
        const nextQuestions = data.questions.map(question => question.id === questionId ? { ...question, isArchived: true } : question);
        const nextActive = nextQuestions.find(question => !question.isArchived);
        setData({ ...data, questions: nextQuestions });
        setActiveQuestionId(activeQuestionId === questionId ? nextActive?.id ?? null : activeQuestionId);
        setActiveTab('archive');
        await persistQuestionList(nextQuestions, activeQuestionId === questionId ? nextActive?.id ?? null : activeQuestionId, 'Question archived', 'The question was moved to the archive.');
      },
    });
  };

  const restoreQuestion = (questionId: number) => {
    if (!data || savingQuestions) return;
    const nextQuestions = data.questions.map(question => question.id === questionId ? { ...question, isArchived: false } : question);
    setData({ ...data, questions: nextQuestions });
    setActiveQuestionId(questionId);
    setActiveTab('questions');
    void persistQuestionList(nextQuestions, questionId, 'Question restored', 'The question is back in the quiz.');
  };

  const deleteQuestionForever = async (questionId: number) => {
    if (!data || savingQuestions) return;
    const targetQuestion = data.questions.find(question => question.id === questionId);
    await showCurriculumConfirm({
      title: 'Delete question permanently?',
      text: `Are you sure you want to permanently delete "${targetQuestion?.text || 'this question'}"? This cannot be undone.`,
      icon: 'warning',
      confirmButtonText: 'Delete permanently',
      onConfirm: async () => {
        const nextQuestions = data.questions.filter(question => question.id !== questionId);
        const nextActive = nextQuestions.find(question => !question.isArchived);
        setData({ ...data, questions: nextQuestions });
        setActiveQuestionId(activeQuestionId === questionId ? nextActive?.id ?? null : activeQuestionId);
        await persistQuestionList(nextQuestions, activeQuestionId === questionId ? nextActive?.id ?? null : activeQuestionId, 'Question deleted', 'The archived question was deleted permanently.');
      },
    });
  };

  const addAnswer = (questionId: number) => {
    setData(prev => prev ? ({
      ...prev,
      questions: prev.questions.map(question => question.id === questionId ? {
        ...question,
        answers: [...question.answers, { id: Date.now(), text: '', isCorrect: isAlwaysCorrectType(question.questionType) }],
      } : question),
    }) : prev);
  };

  const validateQuestions = (questions: QuizQuestion[]) => {
    for (const [index, question] of questions.filter(item => !item.isArchived).entries()) {
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
      if (!isAlwaysCorrectType(question.questionType) && !question.answers.some(answer => answer.isCorrect)) {
        return `Question ${index + 1} needs at least one correct answer.`;
      }
      if (['single_choice', 'multiple_choice', 'true_false'].includes(question.questionType) && question.answers.length < 2) {
        return `Question ${index + 1} needs at least two answers.`;
      }
    }
    return '';
  };

  const saveQuestions = async () => {
    if (!data) return;
    const validationMessage = validateQuestions(data.questions);
    if (validationMessage) {
      setPageError(validationMessage);
      toastError('Validation error', validationMessage);
      return;
    }
    setPageError('');
    await persistQuestionList(data.questions, activeQuestion?.id ?? null, 'Questions saved', 'Question text, answers and correct options were updated.');
  };

  const saveSettings = async () => {
    if (!data || !settings) return;
    setSavingSettings(true);
    try {
      const response = await fetch(`/quiz_api/quizzes/${data.quiz.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!response.ok) throw new Error('Could not save settings');
      const updatedQuiz: QuizPackage = await response.json();
      const nextSettings = settingsFromQuiz(updatedQuiz);
      setData(prev => prev ? { ...prev, quiz: updatedQuiz } : prev);
      setSettings(nextSettings);
      setSettingsBaseline(serializeSettings(nextSettings));
      success('Settings saved', 'Quiz settings were updated.');
    } catch (err) {
      toastError('Save failed', err instanceof Error ? err.message : 'Could not save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleCourseLink = (courseId: string) => {
    setCourseLinks(prev => {
      if (!prev) return prev;
      const selected = (prev.selectedModuleCatalogueIds ?? prev.selectedIds).includes(courseId)
        ? (prev.selectedModuleCatalogueIds ?? prev.selectedIds).filter(id => id !== courseId)
        : [...(prev.selectedModuleCatalogueIds ?? prev.selectedIds), courseId];
      const selectedProgrammeName = prev.selectedProgrammeId
        ? prev.courses.find(course => String(course.programmeId ?? '') === prev.selectedProgrammeId)?.programme || prev.selectedProgrammeName || prev.programme
        : prev.selectedProgrammeName || prev.programme;
      return {
        ...prev,
        programme: selectedProgrammeName || '',
        selectedIds: selected,
        selectedModuleCatalogueIds: selected,
        selectedAssignments: selected.map(moduleCatalogueId => ({
          moduleCatalogueId,
          weekId: String(prev.selectedWeekIdsByModule?.[moduleCatalogueId] ?? '').trim(),
        })),
        courses: prev.courses.map(course => course.id === courseId ? { ...course, selected: selected.includes(course.id) } : course),
      };
    });
  };

  const selectCourseLinkProgramme = (programmeId: string) => {
    setCourseLinks(prev => {
      if (!prev) return prev;
      const selectedProgrammeName = programmeId
        ? prev.courses.find(course => String(course.programmeId ?? '') === programmeId)?.programme || programmeId
        : '';
      const allowedIds = new Set(
        prev.courses
          .filter(course => !programmeId || String(course.programmeId ?? '') === programmeId)
          .map(course => course.id),
      );
      const nextSelected = (prev.selectedModuleCatalogueIds ?? prev.selectedIds).filter(id => allowedIds.has(id));
        return {
          ...prev,
          programme: selectedProgrammeName,
          selectedProgrammeId: programmeId,
          selectedProgrammeName,
          selectedIds: nextSelected,
          selectedModuleCatalogueIds: nextSelected,
          selectedAssignments: nextSelected.map(moduleCatalogueId => ({
            moduleCatalogueId,
            weekId: String(prev.selectedWeekIdsByModule?.[moduleCatalogueId] ?? '').trim(),
          })),
          courses: prev.courses.map(course => ({ ...course, selected: nextSelected.includes(course.id) })),
        };
      });
  };

  const selectCourseLinkWeek = (courseId: string, weekId: string) => {
    setCourseLinks(prev => {
      if (!prev) return prev;
      const selectedIds = prev.selectedModuleCatalogueIds ?? prev.selectedIds;
      const nextWeekIdsByModule = {
        ...(prev.selectedWeekIdsByModule ?? {}),
        [courseId]: weekId,
      };
      return {
        ...prev,
        selectedWeekIdsByModule: nextWeekIdsByModule,
        selectedAssignments: selectedIds.map(moduleCatalogueId => ({
          moduleCatalogueId,
          weekId: String(nextWeekIdsByModule[moduleCatalogueId] ?? '').trim(),
        })),
      };
    });
  };

  const saveCourseLinks = async () => {
    if (!data || !courseLinks) return;
    const moduleAssignments = buildCourseLinkAssignments(courseLinks);
    const invalidAssignment = moduleAssignments
      .map(assignment => ({
        assignment,
        course: courseLinks.courses.find(course => course.id === assignment.moduleCatalogueId),
      }))
      .find(({ assignment, course }) => {
        const validWeekIds = new Set((course?.weeks ?? []).map(week => String(week.id ?? '').trim()).filter(Boolean));
        if (validWeekIds.size === 0) return false;
        return !assignment.weekId || !validWeekIds.has(assignment.weekId);
      });
    if (invalidAssignment?.course) {
      toastError('Week required', `Select a delivery week for ${invalidAssignment.course.module} before saving.`);
      return;
    }
    setSavingCourseLinks(true);
    try {
      const response = await fetch(`/quiz_api/quizzes/${data.quiz.id}/course-links/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          programmeId: courseLinks.selectedProgrammeId,
          programmeName: courseLinks.selectedProgrammeName || courseLinks.programme,
          moduleCatalogueIds: moduleAssignments.map(assignment => assignment.moduleCatalogueId),
          moduleAssignments,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Could not save module assignments');
      const nextCourseLinks = normaliseCourseLinks(payload);
      if (!nextCourseLinks) throw new Error('Could not save module assignments');
      setCourseLinks(nextCourseLinks);
      setCourseLinksBaseline(serializeCourseLinks(nextCourseLinks));
      setData(prev => prev ? { ...prev, quiz: payload.quiz } : prev);
      success('Assignments saved', 'Quiz delivery modules were updated.');
    } catch (err) {
      toastError('Save failed', err instanceof Error ? err.message : 'Could not save module assignments');
    } finally {
      setSavingCourseLinks(false);
    }
  };

  const performQuizStatusUpdate = async (nextStatus: QuizStatus) => {
    if (!data || data.quiz.status === nextStatus || savingStatus) return;
    setSavingStatus(true);
    try {
      const response = await fetch(`/quiz_api/quizzes/${data.quiz.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || 'Could not update quiz status');
      }
      const updatedQuiz: QuizPackage = await response.json();
      setData(prev => prev ? { ...prev, quiz: updatedQuiz } : prev);
      success('Status updated', `Quiz is now ${statusLabel(nextStatus).toLowerCase()}.`);
      onSaved?.();
    } catch (err) {
      toastError('Status update failed', err instanceof Error ? err.message : 'Could not update quiz status');
    } finally {
      setSavingStatus(false);
    }
  };

  const updateQuizStatus = async (nextStatus: QuizStatus) => {
    if (!data || data.quiz.status === nextStatus || savingStatus) return;
    if (nextStatus === 'trash') {
      await showCurriculumConfirm({
        title: 'Archive quiz?',
        text: `Are you sure you want to archive "${data.quiz.title}"? You can restore it later from Archive.`,
        icon: 'warning',
        confirmButtonText: 'Archive quiz',
        onConfirm: () => performQuizStatusUpdate('trash'),
      });
      return;
    }
    await performQuizStatusUpdate(nextStatus);
  };

  if (loading) {
    return <div className="p-6 text-sm text-foreground-500">Loading quiz editor...</div>;
  }

  if (pageError || !data || !settings) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{pageError || 'Quiz not found'}</div>
      </div>
    );
  }

  const activeAnswerCopy = activeQuestion ? answerEditorCopy(activeQuestion.questionType) : answerEditorCopy('single_choice');

  return (
    <div className="p-6 space-y-6 bg-[#f7f6f4] min-h-screen">
        <div className="rounded-2xl border border-[#e3dee9] bg-white/90 p-5 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            {onClose ? (
              <button type="button" onClick={onClose} className="text-xs font-semibold text-[#5b2dbb] hover:text-[#43207d]">
                <AppIcon className="ri-arrow-left-line mr-1"></AppIcon> Back to week
              </button>
            ) : (
              <Link to="/curriculum/quiz-xml" className="text-xs font-semibold text-[#5b2dbb] hover:text-[#43207d]">
                <AppIcon className="ri-arrow-left-line mr-1"></AppIcon> Back to Quiz Workspace
              </Link>
            )}
            <h2 className="mt-2 text-2xl font-heading font-bold text-foreground-900">{data.quiz.title}</h2>
            <p className="text-sm text-[#647083]">{headerModule} - {headerProgramme} - {data.quiz.packageType.toUpperCase()}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-full border border-[#e2e8f0] bg-[#f8fafc] p-1">
              {quizStatusOptions.map(option => {
                const active = data.quiz.status === option.value || (data.quiz.status === 'validating' && option.value === 'pending');
                const activeClass = statusPillClass(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => void updateQuizStatus(option.value)}
                    disabled={savingStatus}
                    className={`h-7 px-3 rounded-full text-xs font-semibold transition-smooth disabled:cursor-wait ${active ? activeClass : 'text-[#647083] hover:bg-white'}`}
                  >
                    {savingStatus && active ? 'Saving...' : option.label}
                  </button>
                );
              })}
            </div>
            <span className="px-3 py-1 rounded-full bg-[#f1f5f9] text-[#475569] text-xs font-semibold">{activeQuestions.length} questions</span>
            {archivedQuestions.length > 0 && <span className="px-3 py-1 rounded-full bg-[#fff7ed] text-[#b45309] text-xs font-semibold">{archivedQuestions.length} archived</span>}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#ded8e8] p-5 shadow-sm">
          <div className="grid grid-cols-4 max-w-3xl rounded-xl bg-[#edf0f5] p-1 overflow-hidden mb-6">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`h-10 rounded-lg text-sm font-semibold transition-smooth ${activeTab === tab.id ? 'bg-white text-[#43207d] shadow-sm' : 'text-[#526173] hover:bg-white/65'}`}
              >
                {'icon' in tab && <AppIcon className={`${tab.icon} mr-1.5 align-[-1px]`}></AppIcon>}
                {tab.label}
                {'count' in tab && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-[#dce3ec] text-[#526173]">{tab.count}</span>}
              </button>
            ))}
          </div>

          {activeTab === 'questions' && (
            <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-5">
              <aside className="border border-[#dfe4ec] rounded-2xl bg-[#f8fafc] p-3 max-h-[680px] overflow-y-auto quiz-preview-scroll">
                <button
                  type="button"
                  onClick={addQuestion}
                  disabled={savingQuestions}
                  className="mb-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#5b2dbb] text-sm font-semibold text-white transition-smooth hover:bg-[#4c1d95] disabled:cursor-wait disabled:opacity-50"
                >
                  <AppIcon className="ri-add-line"></AppIcon>
                  Add question
                </button>
                <div className="mb-3 rounded-xl bg-[#f2f0ff] border border-[#ded8ff] px-3 py-2 text-[11px] text-[#5b2dbb] flex items-center gap-2">
                  <AppIcon className="ri-draggable"></AppIcon>
                  Drag questions to reorder, then save changes.
                </div>
                <div className="space-y-2">
                  {activeQuestions.map((question, index) => (
                    <div
                      key={question.id}
                      draggable
                      onDragStart={event => {
                        setDraggedQuestionId(question.id);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={event => {
                        event.preventDefault();
                        setDragOverQuestionId(question.id);
                      }}
                      onDragLeave={() => setDragOverQuestionId(prev => prev === question.id ? null : prev)}
                      onDrop={() => handleQuestionDrop(question.id)}
                      onDragEnd={() => {
                        setDraggedQuestionId(null);
                        setDragOverQuestionId(null);
                      }}
                      className={`rounded-xl border transition-smooth cursor-grab active:cursor-grabbing ${activeQuestion?.id === question.id ? 'bg-white border-[#a78bfa] shadow-sm' : 'bg-white/85 border-[#e2e8f0] hover:border-[#c4b5fd] hover:bg-white'} ${draggedQuestionId === question.id ? 'opacity-50' : ''} ${dragOverQuestionId === question.id && draggedQuestionId !== question.id ? 'ring-2 ring-[#c4b5fd] border-[#a78bfa]' : ''}`}
                    >
                      <div className="flex items-start gap-2 px-3 py-2">
                        <span className="w-6 h-8 rounded-md bg-[#f1f5f9] text-[#94a3b8] flex items-center justify-center shrink-0" title="Drag to reorder">
                          <AppIcon className="ri-draggable text-sm"></AppIcon>
                        </span>
                        <button onClick={() => setActiveQuestionId(question.id)} className="flex-1 min-w-0 text-left">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[11px] font-bold text-foreground-400">{String(index + 1).padStart(2, '0')}</span>
                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#e8edf4] text-[#526173]">{questionLabel(question.questionType)}</span>
                          </div>
                          <p className="text-xs text-foreground-800 line-clamp-2">{question.text}</p>
                        </button>
                        <button onClick={() => void archiveQuestion(question.id)} disabled={savingQuestions} title="Archive question" className="w-7 h-7 rounded-md bg-[#fff7ed] text-[#c2410c] hover:bg-[#ffedd5] shrink-0 disabled:opacity-50 disabled:cursor-wait"><AppIcon className="ri-archive-line text-xs"></AppIcon></button>
                      </div>
                    </div>
                  ))}
                </div>
              </aside>

              <section className="min-w-0">
                {activeQuestion ? (
                  <div className="space-y-5">
                    <div>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                        <label className="block text-xs font-semibold text-foreground-600">Question text</label>
                        <button onClick={() => void archiveQuestion(activeQuestion.id)} disabled={savingQuestions} className="h-8 px-2 rounded-lg bg-[#fff7ed] text-xs font-semibold text-[#c2410c] hover:bg-[#ffedd5] self-start sm:self-auto disabled:opacity-50 disabled:cursor-wait">
                          <AppIcon className="ri-archive-line mr-1"></AppIcon>Archive
                        </button>
                      </div>
                      <textarea value={activeQuestion.text} onChange={event => updateQuestion(activeQuestion.id, { text: event.target.value })} className="w-full min-h-36 rounded-xl border border-[#d8dde6] bg-white p-4 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-foreground-600 mb-2">Question type</label>
                        <ThemedSelect
                          value={activeQuestion.questionType}
                          options={questionTypeOptions}
                          onChange={questionType => updateQuestionType(activeQuestion.id, questionType)}
                          buttonClassName="h-11"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-foreground-600 mb-2">Feedback</label>
                        <input value={activeQuestion.explanation} onChange={event => updateQuestion(activeQuestion.id, { explanation: event.target.value })} className="w-full h-11 rounded-lg border border-[#d8dde6] bg-white px-3 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]" />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h3 className="text-sm font-heading font-bold text-foreground-900">{activeAnswerCopy.title}</h3>
                          <p className="text-xs text-[#647083] mt-1">{activeAnswerCopy.hint}</p>
                        </div>
                        <button onClick={() => addAnswer(activeQuestion.id)} className="h-9 px-3 rounded-lg bg-[#5b2dbb] text-white text-xs font-semibold hover:bg-[#4c1d95]">
                          <AppIcon className="ri-add-line mr-1"></AppIcon>{activeAnswerCopy.addLabel}
                        </button>
                      </div>
                      <div className="space-y-3">
                        {activeQuestion.answers.map((answer, answerIndex) => {
                          const isOrdering = activeQuestion.questionType === 'ordering';
                          const isPair = activeQuestion.questionType === 'matching' || activeQuestion.questionType === 'image_matching';
                          const pair = isPair
                            ? parseQuizPairAnswer(
                              answer.text,
                              activeQuestion.questionType === 'image_matching' ? 'image_matching' : 'matching',
                            )
                            : null;
                          const rowNumber = isOrdering ? answerIndex + 1 : String.fromCharCode(65 + answerIndex);

                          return (
                            <div
                              key={answer.id}
                              draggable={isOrdering}
                              onDragStart={event => {
                                if (!isOrdering) return;
                                setDraggedAnswerId(answer.id);
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', String(answer.id));
                              }}
                              onDragOver={event => {
                                if (!isOrdering) return;
                                event.preventDefault();
                                event.dataTransfer.dropEffect = 'move';
                                setDragOverAnswerId(answer.id);
                              }}
                              onDragLeave={() => {
                                if (dragOverAnswerId === answer.id) setDragOverAnswerId(null);
                              }}
                              onDrop={event => {
                                if (!isOrdering) return;
                                event.preventDefault();
                                handleAnswerDrop(activeQuestion.id, answer.id);
                              }}
                              onDragEnd={() => {
                                setDraggedAnswerId(null);
                                setDragOverAnswerId(null);
                              }}
                              className={`rounded-xl border bg-[#fbfcfe] p-3 transition-smooth ${
                                isOrdering ? 'cursor-grab active:cursor-grabbing' : ''
                              } ${
                                dragOverAnswerId === answer.id && draggedAnswerId !== answer.id ? 'border-[#a78bfa] ring-2 ring-[#ede9fe]' : 'border-[#e2e8f0]'
                              } ${
                                draggedAnswerId === answer.id ? 'opacity-50' : ''
                              }`}
                            >
                              <div className={`flex gap-3 ${isPair ? 'items-start' : 'items-center'}`}>
                                {isOrdering && (
                                  <span className="w-8 h-8 rounded-lg bg-[#f4f1ff] text-[#5b2dbb] border border-[#ddd6fe] flex items-center justify-center shrink-0">
                                    <AppIcon className="ri-draggable text-sm"></AppIcon>
                                  </span>
                                )}
                                <span className={`${isOrdering ? 'w-8 h-8 rounded-lg bg-[#5b2dbb] text-white border-[#5b2dbb]' : 'w-7 h-7 rounded-full bg-white text-[#647083] border-[#d8dde6]'} border flex items-center justify-center text-xs font-bold shrink-0`}>
                                  {rowNumber}
                                </span>

                                {isPair ? (
                                  activeQuestion.questionType === 'image_matching' ? (
                                    <ImageMatchingPairFields
                                      value={answer.text}
                                      onChange={nextValue => updateAnswerPair(activeQuestion.id, answer.id, parseQuizPairAnswer(nextValue, 'image_matching'))}
                                      matchPlaceholder="Matching answer"
                                    />
                                  ) : (
                                    <div className="grid flex-1 min-w-0 grid-cols-1 sm:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)] gap-2">
                                      <input
                                        value={pair?.left ?? ''}
                                        onChange={event => updateAnswerPair(activeQuestion.id, answer.id, { left: event.target.value })}
                                        placeholder="Prompt"
                                        className="min-w-0 h-10 rounded-lg border border-[#d8dde6] bg-white px-3 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]"
                                      />
                                      <span className="hidden sm:flex items-center justify-center text-[#5b2dbb]">
                                        <AppIcon className="ri-arrow-right-line"></AppIcon>
                                      </span>
                                      <input
                                        value={pair?.right ?? ''}
                                        onChange={event => updateAnswerPair(activeQuestion.id, answer.id, { right: event.target.value })}
                                        placeholder="Matching answer"
                                        className="min-w-0 h-10 rounded-lg border border-[#d8dde6] bg-white px-3 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]"
                                      />
                                    </div>
                                  )
                                ) : (
                                  <input
                                    value={answer.text}
                                    onChange={event => updateAnswer(activeQuestion.id, answer.id, event.target.value)}
                                    placeholder={activeQuestion.questionType === 'keywords' ? 'Accepted keyword or phrase' : activeQuestion.questionType === 'fill_gap' ? 'Accepted gap answer' : isOrdering ? `Step ${answerIndex + 1}` : `Option ${rowNumber}`}
                                    className="flex-1 min-w-0 h-10 rounded-lg border border-[#d8dde6] bg-white px-3 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]"
                                  />
                                )}

                                {isOrdering ? (
                                  <span className="hidden sm:inline-flex items-center gap-1 rounded-lg bg-[#f2f0ff] px-2.5 py-1.5 text-xs font-semibold text-[#5b2dbb] shrink-0">
                                    <AppIcon className="ri-sort-asc"></AppIcon>Order {answerIndex + 1}
                                  </span>
                                ) : isAlwaysCorrectType(activeQuestion.questionType) ? (
                                  <span className="hidden sm:inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 shrink-0">
                                    <AppIcon className="ri-check-line"></AppIcon>Accepted
                                  </span>
                                ) : (
                                  <label className="inline-flex items-center gap-2 text-sm text-foreground-700 shrink-0">
                                    <input type={activeQuestion.questionType === 'multiple_choice' ? 'checkbox' : 'radio'} name={`correct-${activeQuestion.id}`} checked={answer.isCorrect} onChange={() => markCorrect(activeQuestion.id, answer.id)} className="w-4 h-4" />
                                    Correct
                                  </label>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex justify-end pt-4 border-t border-[#e2e8f0]">
                      <button onClick={() => void saveQuestions()} disabled={!questionDirty || savingQuestions} className="h-11 px-5 rounded-lg bg-[#5b2dbb] text-white text-sm font-semibold hover:bg-[#4c1d95] disabled:opacity-45 disabled:cursor-not-allowed">
                        {savingQuestions ? 'Saving...' : 'Save question changes'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="py-16 text-center">
                    <p className="text-sm text-foreground-400">No questions available.</p>
                    <button
                      type="button"
                      onClick={addQuestion}
                      disabled={savingQuestions}
                      className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#5b2dbb] px-4 text-sm font-semibold text-white transition-smooth hover:bg-[#4c1d95] disabled:cursor-wait disabled:opacity-50"
                    >
                      <AppIcon className="ri-add-line"></AppIcon>
                      Add question
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="max-w-5xl space-y-6">
              <div>
                <label className="block text-xs font-semibold text-foreground-700 mb-2">Short description of the quiz</label>
                <textarea value={settings.shortDescription} onChange={event => setSettings({ ...settings, shortDescription: event.target.value })} className="w-full min-h-24 rounded-xl border border-[#d8dde6] bg-white p-3 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]" />
              </div>

              <section className="rounded-2xl border border-[#dbe3ee] bg-[#f8fafc] p-4">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-8 h-8 rounded-lg bg-[#f2edff] text-[#5b21b6] flex items-center justify-center">
                        <AppIcon className="ri-links-line"></AppIcon>
                      </span>
                      <h3 className="text-sm font-heading font-bold text-[#0f172a]">Assigned modules</h3>
                    </div>
                    <p className="text-xs text-[#64748b] leading-5">
                      Choose which delivery modules and weeks should surface this quiz to learners.
                      {(courseLinks?.selectedProgrammeName || courseLinks?.programme) && <span className="font-semibold text-[#475569]"> Programme: {courseLinks.selectedProgrammeName || courseLinks.programme}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-3 py-1 rounded-full bg-white border border-[#e2e8f0] text-xs font-semibold text-[#475569]">
                      {courseLinks?.selectedIds.length ?? 0} selected
                    </span>
                    <button
                      type="button"
                      onClick={() => void saveCourseLinks()}
                      disabled={!courseLinksDirty || savingCourseLinks}
                      className="h-9 px-4 rounded-lg bg-[#5b2dbb] text-white text-xs font-semibold hover:bg-[#4c1d95] disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      {savingCourseLinks ? 'Saving...' : 'Save links'}
                    </button>
                  </div>
                </div>

                {!courseLinks ? (
                  <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-white p-4 text-sm text-[#64748b]">Course links are loading.</div>
                ) : courseLinks.courses.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-white p-4 text-sm text-[#64748b]">
                    No matching modules found for this programme.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#475569]">Programme</label>
                        <ThemedSelect
                          value={courseLinks.selectedProgrammeId || ''}
                          options={programmeOptions}
                          onChange={selectCourseLinkProgramme}
                          placeholder="Select programme"
                          buttonClassName="h-11"
                        />
                      </div>
                    </div>

                    {!courseLinks.selectedProgrammeId ? (
                      <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-white p-4 text-sm text-[#64748b]">
                        Select a programme first, then choose one or more delivery modules and their learner week.
                      </div>
                    ) : visibleCourseLinks.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-white p-4 text-sm text-[#64748b]">
                        No modules are available for the selected programme.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-y-auto quiz-preview-scroll pr-1">
                        {visibleCourseLinks.map(course => {
                          const selected = courseLinks.selectedIds.includes(course.id);
                          const weekOptions = [
                            { value: '', label: 'Select week' },
                            ...(course.weeks ?? []).map(week => ({ value: week.id, label: week.label })),
                          ];
                          return (
                            <div
                              key={course.id}
                              className={`min-w-0 rounded-xl border p-3 transition-smooth ${selected ? 'border-[#a78bfa] bg-[#f5f3ff] shadow-sm' : 'border-[#dbe3ee] bg-white hover:border-[#c4b5fd]'}`}
                            >
                              <button
                                type="button"
                                onClick={() => toggleCourseLink(course.id)}
                                className="w-full text-left"
                              >
                                <div className="flex items-start gap-3">
                                  <span className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${selected ? 'bg-[#5b2dbb] border-[#5b2dbb] text-white' : 'bg-white border-[#cbd5e1] text-transparent'}`}>
                                    <AppIcon className="ri-check-line text-sm"></AppIcon>
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block text-sm font-semibold text-[#0f172a] truncate">{course.module}</span>
                                    <span className="block text-xs text-[#64748b] truncate">
                                {[course.cohort ? `Cohort: ${course.cohort}` : '', course.startDate ? `Starts: ${course.startDate}` : ''].filter(Boolean).join(' · ') || course.programme}
                              </span>
                            </span>
                                </div>
                              </button>
                              {selected && (
                                <div className="mt-3 border-t border-[#ddd6fe] pt-3">
                                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#5b21b6]">Week</label>
                                  {(course.weeks ?? []).length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-[#d8dde6] bg-white px-3 py-2 text-xs text-[#64748b]">
                                      No learner weeks are available for this module yet.
                                    </div>
                                  ) : (
                                    <ThemedSelect
                                      value={courseLinks.selectedWeekIdsByModule?.[course.id] || ''}
                                      options={weekOptions}
                                      onChange={weekId => selectCourseLinkWeek(course.id, weekId)}
                                      placeholder="Select week"
                                      buttonClassName="h-10 bg-white"
                                    />
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Quiz duration">
                  <input type="number" min="0" value={settings.duration} onChange={event => setSettings({ ...settings, duration: Number(event.target.value || 0) })} className="h-11 w-full rounded-lg border border-[#d8dde6] bg-white px-3 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]" />
                </Field>
                <Field label="Time unit">
                  <ThemedSelect
                    value={settings.timeUnit}
                    options={timeUnitOptions}
                    onChange={timeUnit => setSettings({ ...settings, timeUnit })}
                    buttonClassName="h-11"
                  />
                </Field>
              </div>

              <Field label="Quiz style">
                <ThemedSelect
                  value={settings.quizStyle}
                  options={quizStyleOptions}
                  onChange={quizStyle => setSettings({ ...settings, quizStyle })}
                  buttonClassName="h-11"
                />
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

              <div className="rounded-xl bg-[#f3f6fb] border border-[#e2e8f0] p-4 flex items-center justify-between gap-4">
                <p className="text-sm text-foreground-700">
                  <strong>Hint:</strong> {hintGradeRow ? `${hintGradeRow.point} Points = ${formatQuizGradeRange(gradeSettings.rows, hintGradeIndex)} or "${hintGradeRow.grade}" grade` : 'Configure default grades from Grade Settings'}
                </p>
                <button onClick={() => setShowGradesTable(true)} className="h-9 px-4 rounded-lg bg-[#5b2dbb] text-white text-sm font-semibold hover:bg-[#4c1d95]">See table</button>
              </div>

              <div className="pt-5 border-t border-[#e2e8f0]">
                <label className="block text-xs font-semibold text-foreground-700 mb-2">Lesson content</label>
                <div className="rounded-xl border border-[#d8dde6] overflow-hidden bg-white">
                  <div className="h-11 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center gap-3 px-3 text-xs text-[#526173]">
                    <span>View</span><span>Format</span><span>Table</span><span>Tools</span>
                    <span className="ml-4 font-semibold">B</span><span className="italic font-semibold">I</span><span className="underline font-semibold">U</span>
                    <AppIcon className="ri-link"></AppIcon><AppIcon className="ri-image-line"></AppIcon><AppIcon className="ri-video-line"></AppIcon>
                  </div>
                  <textarea value={settings.lessonContent} onChange={event => setSettings({ ...settings, lessonContent: event.target.value })} className="w-full min-h-72 bg-white p-4 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-inset focus:ring-[#ede9fe]" />
                </div>
              </div>

              <div className="flex justify-end">
                <button onClick={() => void saveSettings()} disabled={!settingsDirty || savingSettings} className="h-11 px-5 rounded-lg bg-[#5b2dbb] text-white text-sm font-semibold hover:bg-[#4c1d95] disabled:opacity-45 disabled:cursor-not-allowed">
                  {savingSettings ? 'Saving...' : 'Save settings'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'archive' && (
            <div className="w-full max-w-4xl">
              <div className="rounded-xl border border-[#fed7aa] bg-[#fffaf2] p-4 mb-4 grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] sm:items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-white text-[#c2410c] border border-[#fed7aa] flex items-center justify-center shrink-0">
                  <AppIcon className="ri-archive-line"></AppIcon>
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-heading font-bold text-foreground-900">Archived questions</h3>
                  <p className="text-xs text-[#7c5b3b] mt-1 leading-5">Restore questions back to the quiz, or delete them permanently.</p>
                </div>
                <span className="w-fit px-3 py-1 rounded-full bg-white text-[#b45309] text-xs font-bold border border-[#fed7aa]">{archivedQuestions.length} archived</span>
              </div>

              {archivedQuestions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#d8dde6] bg-[#fbfcfe] px-4 py-8 text-center">
                  <span className="w-10 h-10 rounded-xl bg-white border border-[#e2e8f0] text-[#94a3b8] flex items-center justify-center mx-auto mb-3">
                    <AppIcon className="ri-inbox-archive-line text-lg"></AppIcon>
                  </span>
                  <p className="text-sm font-semibold text-foreground-700">No archived questions</p>
                  <p className="text-xs text-foreground-400 mt-1">Archived questions will appear here after you archive them from the Questions tab.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {archivedQuestions.map((question, index) => (
                    <div key={question.id} className="rounded-xl border border-[#fed7aa] bg-white p-3 shadow-sm">
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                        <div className="grid grid-cols-[auto_1fr] gap-3 min-w-0">
                          <span className="w-8 h-8 rounded-lg bg-[#fff7ed] text-[#b45309] border border-[#fed7aa] flex items-center justify-center text-xs font-bold shrink-0">{String(index + 1).padStart(2, '0')}</span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#e8edf4] text-[#526173]">{questionLabel(question.questionType)}</span>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-[#b45309]">Archived</span>
                            </div>
                            <p className="text-sm font-semibold text-foreground-900 leading-5 break-words">{question.text}</p>
                          </div>
                        </div>
                        <div className="flex flex-col sm:flex-row md:justify-end items-stretch sm:items-center gap-2 md:pl-3">
                          <button onClick={() => restoreQuestion(question.id)} disabled={savingQuestions} className="h-9 px-3 rounded-lg bg-emerald-50 text-xs font-bold text-emerald-700 hover:bg-emerald-100 whitespace-nowrap disabled:opacity-50 disabled:cursor-wait">
                            <AppIcon className="ri-arrow-go-back-line mr-1"></AppIcon>Restore
                          </button>
                          <button onClick={() => void deleteQuestionForever(question.id)} disabled={savingQuestions} className="h-9 px-3 rounded-lg bg-red-50 text-xs font-bold text-red-700 hover:bg-red-100 whitespace-nowrap disabled:opacity-50 disabled:cursor-wait">
                            <AppIcon className="ri-delete-bin-line mr-1"></AppIcon>Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div className="flex justify-stretch sm:justify-end pt-4 border-t border-[#e2e8f0]">
                    <button onClick={() => void saveQuestions()} disabled={!questionDirty || savingQuestions} className="h-11 w-full sm:w-auto px-5 rounded-lg bg-[#5b2dbb] text-white text-sm font-semibold hover:bg-[#4c1d95] disabled:opacity-45 disabled:cursor-not-allowed">
                      {savingQuestions ? 'Saving...' : 'Save archive changes'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'qa' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-[#dfe4ec] bg-[#f8fafc] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="w-10 h-10 rounded-xl bg-white text-[#5b2dbb] border border-[#e4def8] flex items-center justify-center shrink-0">
                    <AppIcon className="ri-eye-line text-lg"></AppIcon>
                  </span>
                  <div>
                    <p className="text-sm font-heading font-bold text-foreground-900">Learner preview - {settings.quizStyle === 'pagination' ? 'Pagination' : settings.quizStyle === 'global' ? 'Global' : 'Default'}</p>
                    <p className="text-xs text-[#647083] mt-1 leading-relaxed">
                    {settings.quizStyle === 'pagination' && 'Learners answer one question at a time with previous and next controls.'}
                    {settings.quizStyle === 'global' && 'Learners see all questions with a global answer sheet for fast navigation.'}
                    {settings.quizStyle === 'default' && 'Learners see the normal stacked question view.'}
                    </p>
                  </div>
                </div>
                <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white border border-[#e4def8] text-[#5b2dbb] self-start md:self-center">{activeQuestions.length} questions</span>
              </div>

              {settings.quizStyle === 'pagination' ? (
                <div className="rounded-2xl border border-[#dfe4ec] bg-white p-5 shadow-sm">
                  {activeQuestions.length > 0 ? (
                    <>
                      <div className="flex items-center justify-between gap-3 mb-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-foreground-400">Question {qaPageIndex + 1} of {activeQuestions.length}</p>
                        <div className="flex items-center gap-1">
                          {activeQuestions.map((question, index) => (
                            <button
                              key={question.id}
                              onClick={() => setQaPageIndex(index)}
                              className={`w-7 h-7 rounded-md text-xs font-bold ${qaPageIndex === index ? 'bg-[#5b2dbb] text-white' : 'bg-[#f1f5f9] text-[#647083] hover:bg-[#f2f0ff] hover:text-[#5b2dbb]'}`}
                            >
                              {index + 1}
                            </button>
                          ))}
                        </div>
                      </div>
                      <QuestionPreviewCard question={activeQuestions[qaPageIndex]} questionIndex={qaPageIndex} />
                      <div className="mt-5 flex items-center justify-between">
                        <button
                          onClick={() => setQaPageIndex(index => Math.max(index - 1, 0))}
                          disabled={qaPageIndex === 0}
                          className="h-10 px-4 rounded-lg border border-[#d8dde6] bg-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#f8fafc]"
                        >
                          <AppIcon className="ri-arrow-left-line mr-1"></AppIcon>Previous
                        </button>
                        <button
                          onClick={() => setQaPageIndex(index => Math.min(index + 1, activeQuestions.length - 1))}
                          disabled={qaPageIndex === activeQuestions.length - 1}
                          className="h-10 px-4 rounded-lg bg-[#5b2dbb] text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#4c1d95]"
                        >
                          Next<AppIcon className="ri-arrow-right-line ml-1"></AppIcon>
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="py-12 text-center text-sm text-foreground-400">No questions available.</div>
                  )}
                </div>
              ) : settings.quizStyle === 'global' ? (
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4">
                  <div className="space-y-3">
                    {activeQuestions.map((question, questionIndex) => (
                      <QuestionPreviewCard key={question.id} question={question} questionIndex={questionIndex} compact />
                    ))}
                  </div>
                  <aside className="rounded-2xl border border-[#dfe4ec] bg-white p-4 h-fit sticky top-4 shadow-sm">
                    <p className="text-sm font-heading font-bold text-foreground-900 mb-3">Global Answer Sheet</p>
                    <div className="grid grid-cols-5 gap-2">
                      {activeQuestions.map((question, questionIndex) => {
                        const correctIndex = question.answers.findIndex(answer => answer.isCorrect);
                        return (
                          <button key={question.id} onClick={() => setQaPageIndex(questionIndex)} className="rounded-lg bg-[#f1f5f9] hover:bg-[#f2f0ff] px-2 py-2 text-center">
                            <span className="block text-[10px] text-foreground-400 font-bold">{questionIndex + 1}</span>
                            <span className="block text-sm font-bold text-[#5b2dbb]">{correctIndex >= 0 ? String.fromCharCode(65 + correctIndex) : '-'}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-4 text-xs text-foreground-500 leading-relaxed">Global style keeps all questions visible and gives admins a single answer map for review.</p>
                  </aside>
                </div>
              ) : (
                <div className="space-y-3 max-w-6xl mx-auto">
                  {activeQuestions.map((question, questionIndex) => (
                    <QuestionPreviewCard key={question.id} question={question} questionIndex={questionIndex} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {showGradesTable && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onClick={() => setShowGradesTable(false)}>
            <div className="w-full max-w-md rounded-2xl bg-background-50 shadow-2xl border border-foreground-200/60 p-5" onClick={event => event.stopPropagation()}>
              <div className="flex items-center justify-between gap-4 mb-5">
                <h3 className="text-xl font-heading font-bold text-foreground-900">Grades Table</h3>
                <button onClick={() => setShowGradesTable(false)} className="w-8 h-8 rounded-full bg-foreground-100 text-foreground-400 hover:bg-foreground-200 hover:text-foreground-700 transition-smooth">
                  <AppIcon className="ri-close-line text-lg"></AppIcon>
                </button>
              </div>
              <div className="overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-foreground-200/70">
                      <th className="py-3 px-2 text-sm font-bold text-foreground-800">Grade</th>
                      <th className="py-3 px-2 text-sm font-bold text-foreground-800">Point</th>
                      <th className="py-3 px-2 text-sm font-bold text-foreground-800">Range</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gradeSettings.rows.map((row, index) => (
                      <tr key={row.grade} className="border-b border-foreground-200/70 last:border-b-0">
                        <td className="py-2.5 px-2">
                          <span className="inline-flex min-w-9 h-6 items-center justify-center rounded-full px-2 text-sm font-bold text-white" style={{ backgroundColor: row.color }}>{row.grade}</span>
                        </td>
                        <td className="py-2.5 px-2 text-sm text-foreground-900">{row.point}</td>
                        <td className="py-2.5 px-2 text-sm text-foreground-900">{formatQuizGradeRange(gradeSettings.rows, index)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-foreground-700 mb-2">{label}</span>
      {children}
    </label>
  );
}

function QuestionPreviewCard({ question, questionIndex, compact = false }: { question: QuizQuestion; questionIndex: number; compact?: boolean }) {
  return (
    <div className={`rounded-2xl border border-[#dfe4ec] bg-white shadow-sm transition-smooth hover:border-[#cbd5e1] ${compact ? 'p-3' : 'p-5'}`}>
      <div className={`flex items-start ${compact ? 'gap-3' : 'gap-4'}`}>
        <span className={`${compact ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'} rounded-xl bg-[#f2f0ff] text-[#5b2dbb] border border-[#e4def8] flex items-center justify-center font-bold shrink-0`}>
          {questionIndex + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
            <p className={`${compact ? 'text-sm' : 'text-[15px]'} font-semibold text-foreground-900 leading-relaxed`}>{question.text}</p>
            <span className="w-fit text-[10px] font-bold uppercase px-2 py-1 rounded-md bg-[#e8edf4] text-[#526173] shrink-0">{questionLabel(question.questionType)}</span>
          </div>
          <QuestionAnswersView type={question.questionType} answers={question.answers} fallbackText={question.explanation} compact={compact} className="mt-4" />
          {question.explanation && !compact && (
            <div className="mt-4 rounded-xl border border-[#e4def8] bg-[#fbf9ff] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#6d5aa8] mb-1">Feedback</p>
              <p className="text-xs leading-relaxed text-[#4b3f72]">{question.explanation}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-foreground-800">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`w-9 h-5 rounded-full p-0.5 transition-smooth ${checked ? 'bg-[#5b2dbb]' : 'bg-[#cbd5e1]'}`}
      >
        <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}></span>
      </button>
      {label}
    </label>
  );
}
