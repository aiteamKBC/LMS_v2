<<<<<<< HEAD
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { ThemedSelect } from '@/components/feature/ThemedSelect';
import { QuestionAnswersView } from '@/components/feature/QuestionTypeRenderer';
import { roleNavMap } from '@/mocks/navigation';
import { kbcUsers } from '@/mocks/users';
import { useToast } from '@/hooks/useToast';

const curriculumNav = roleNavMap.curriculum;

type QuizStatus = 'published' | 'pending' | 'draft' | 'trash' | 'private' | 'validating';
type PackageType = 'xml' | 'scorm' | 'excel' | 'csv' | 'file';
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

const statusOptions: { value: 'all' | QuizStatus; label: string }[] = [
  { value: 'all', label: 'Status: All' },
  { value: 'published', label: 'Published' },
  { value: 'pending', label: 'Pending' },
  { value: 'draft', label: 'Draft' },
  { value: 'trash', label: 'Archive' },
  { value: 'private', label: 'Private' },
];

const editableStatusOptions: { value: QuizStatus; label: string }[] = statusOptions
  .filter((option): option is { value: QuizStatus; label: string } => option.value !== 'all');

const pageSizeOptions = [
  { value: '10', label: '10 per page' },
  { value: '20', label: '20 per page' },
  { value: '50', label: '50 per page' },
];

function parseStatusParam(value: string | null): 'all' | QuizStatus {
  return statusOptions.some(option => option.value === value) ? value as 'all' | QuizStatus : 'all';
}

interface QuizPackage {
  id: number;
=======
import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const curriculumNav = roleNavMap.curriculum;

interface QuizXml {
  id: string;
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
  title: string;
  module: string;
  programme: string;
  questions: number;
<<<<<<< HEAD
  defaultQuestionType: QuestionType;
  version: string;
  status: QuizStatus;
  packageType: PackageType;
  fileName: string;
  fileSize: number;
  displaySize: string;
  schemaValid: boolean;
  validationMessage: string;
  mappedComponents: number;
  weekId?: string;
  author: string;
  linkedCourses: number;
  updatedAt: string;
}

interface QuizPreviewQuestion {
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

interface QuizPreviewData {
  quiz: QuizPackage;
  questions: QuizPreviewQuestion[];
}

interface QuizFormState {
  title: string;
  module: string;
  programme: string;
  programmeId: string;
  week: string;
  version: string;
  questions: string;
  questionType: QuestionType;
  status: QuizStatus;
  author: string;
  linkedCourses: string;
}

interface AiGeneratorState {
  title: string;
  topic: string;
  lessonContent: string;
  customInstructions: string;
  programme: string;
  module: string;
  programmeId: string;
  week: string;
  questionCount: string;
  author: string;
}

interface TrainingPlanModuleOption {
  value: string;
  label: string;
  programmeId: number;
}

interface TrainingPlanOptions {
  programmes: { value: string; label: string }[];
  modulesByProgramme: Record<string, TrainingPlanModuleOption[]>;
}

interface ScormApi {
  LMSInitialize: () => string;
  LMSFinish: () => string;
  LMSGetValue: (key: string) => string;
  LMSSetValue: (key: string, value: string) => string;
  LMSCommit: () => string;
  LMSGetLastError: () => string;
  LMSGetErrorString: () => string;
  LMSGetDiagnostic: () => string;
}

declare global {
  interface Window {
    API?: ScormApi;
  }
}

const emptyForm: QuizFormState = {
  title: '',
  module: '',
  programme: '',
  programmeId: '',
  week: '',
  version: 'v1.0',
  questions: '',
  questionType: 'single_choice',
  status: 'draft',
  author: 'Curriculum Team',
  linkedCourses: '1',
};

const embeddedAiPromptPreview = `Create a mixed-format LMS quiz from only the supplied lesson content and uploaded files.

Core rules:
- Use all readable files together and distribute coverage fairly across them.
- Generate the requested number of questions where the source supports it.
- Use mixed question types: single choice, multiple choice, true/false, matching, image matching, keywords, fill in the gap and ordering.
- Progress difficulty from easy to medium to hard across the quiz.
- Prefer realistic workplace/admin scenarios and adult-learning assessment quality.
- Align explanations to source concepts and KSBs where available.
- Keep distractors plausible and avoid repeated stems or obvious patterns.
- Return structured JSON only so the LMS can save and preview the questions.`;

const emptyGeneratorForm: AiGeneratorState = {
  title: '',
  topic: '',
  lessonContent: '',
  customInstructions: embeddedAiPromptPreview,
  programme: '',
  module: '',
  programmeId: '',
  week: '',
  questionCount: '5',
  author: 'Curriculum Team',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusClasses(status: QuizStatus) {
  if (status === 'published') return 'bg-emerald-100 text-emerald-700';
  if (status === 'pending' || status === 'validating') return 'bg-amber-100 text-amber-700';
  if (status === 'trash') return 'bg-red-100 text-red-700';
  if (status === 'private') return 'bg-sky-100 text-sky-700';
  return 'bg-foreground-100 text-foreground-600';
}

function statusLabel(status: QuizStatus | 'all') {
  if (status === 'validating') return 'Pending';
  return statusOptions.find(option => option.value === status)?.label || status;
}

function serializeEditorQuestions(questions: QuizPreviewQuestion[]) {
  return JSON.stringify(questions.map(question => ({
    text: question.text,
    questionType: question.questionType,
    explanation: question.explanation,
    answers: question.answers.map(answer => ({
      text: answer.text,
      isCorrect: answer.isCorrect,
    })),
  })));
}

export default function QuizXmlWorkspacePage() {
  const { success, error: toastError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [quizzes, setQuizzes] = useState<QuizPackage[]>([]);
  const [selectedQuiz, setSelectedQuiz] = useState<QuizPackage | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkAction, setBulkAction] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | QuizStatus>(() => parseStatusParam(searchParams.get('status')));
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState('10');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<QuizFormState>(emptyForm);
  const [savingQuiz, setSavingQuiz] = useState(false);
  const [trainingPlanOptions, setTrainingPlanOptions] = useState<TrainingPlanOptions>({ programmes: [], modulesByProgramme: {} });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<QuizPreviewData | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);
  const [editorData, setEditorData] = useState<QuizPreviewData | null>(null);
  const [editorLoadingId, setEditorLoadingId] = useState<number | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<number | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorBaseline, setEditorBaseline] = useState('');
  const [showGenerator, setShowGenerator] = useState(false);
  const [generatorForm, setGeneratorForm] = useState<AiGeneratorState>(emptyGeneratorForm);
  const [generatorFiles, setGeneratorFiles] = useState<File[]>([]);
  const [generatorDragActive, setGeneratorDragActive] = useState(false);
  const [showPromptCustomize, setShowPromptCustomize] = useState(false);
  const [generatedQuestions, setGeneratedQuestions] = useState<QuizPreviewQuestion[]>([]);
  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [savingGeneratedQuiz, setSavingGeneratedQuiz] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const generatorFileInputRef = useRef<HTMLInputElement | null>(null);

  const loadQuizzes = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (search.trim()) params.set('search', search.trim());

    try {
      const response = await fetch(`/quiz_api/quizzes/?${params.toString()}`);
      if (!response.ok) throw new Error('Could not load quizzes');
      const data = await response.json();
      setQuizzes(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load quizzes');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, search]);

  useEffect(() => {
    void loadQuizzes();
  }, [loadQuizzes]);

  useEffect(() => {
    const nextStatus = parseStatusParam(searchParams.get('status'));
    setFilterStatus(current => current === nextStatus ? current : nextStatus);
  }, [searchParams]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, search, pageSize]);

  useEffect(() => {
    setCurrentPage(current => Math.min(current, Math.max(1, Math.ceil(quizzes.length / Number(pageSize)))));
  }, [quizzes.length, pageSize]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/quiz_api/training-plan-options/', { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Could not load training plan options')))
      .then((data: TrainingPlanOptions) => setTrainingPlanOptions(data))
      .catch(err => {
        if ((err as DOMException).name !== 'AbortError') setTrainingPlanOptions({ programmes: [], modulesByProgramme: {} });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (previewData?.quiz.packageType !== 'scorm') return;

    const scormValues: Record<string, string> = {};
    const api: ScormApi = {
      LMSInitialize: () => 'true',
      LMSFinish: () => 'true',
      LMSGetValue: key => scormValues[key] ?? '',
      LMSSetValue: (key, value) => {
        scormValues[key] = String(value);
        return 'true';
      },
      LMSCommit: () => 'true',
      LMSGetLastError: () => '0',
      LMSGetErrorString: () => 'No error',
      LMSGetDiagnostic: () => '',
    };

    window.API = api;
    return () => {
      if (window.API === api) delete window.API;
    };
  }, [previewData?.quiz.id, previewData?.quiz.packageType]);

  const published = quizzes.filter(q => q.status === 'published').length;
  const draft = quizzes.filter(q => q.status === 'draft').length;
  const validationIssues = quizzes.filter(q => !q.schemaValid).length;
  const totalQuestions = quizzes.reduce((sum, quiz) => sum + quiz.questions, 0);
  const numericPageSize = Number(pageSize);
  const pageCount = Math.max(1, Math.ceil(quizzes.length / numericPageSize));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const pageStartIndex = (safeCurrentPage - 1) * numericPageSize;
  const pageEndIndex = pageStartIndex + numericPageSize;
  const paginatedQuizzes = quizzes.slice(pageStartIndex, pageEndIndex);
  const allVisibleSelected = paginatedQuizzes.length > 0 && paginatedQuizzes.every(q => selectedIds.includes(q.id));
  const visiblePageNumbers = useMemo(() => {
    const pages = new Set<number>([1, pageCount, safeCurrentPage]);
    if (safeCurrentPage > 1) pages.add(safeCurrentPage - 1);
    if (safeCurrentPage < pageCount) pages.add(safeCurrentPage + 1);
    return Array.from(pages).filter(page => page >= 1 && page <= pageCount).sort((a, b) => a - b);
  }, [pageCount, safeCurrentPage]);
  const bulkActionOptions = useMemo(() => {
    const statusActions = editableStatusOptions
      .filter(option => option.value !== 'trash')
      .map(option => ({ value: option.value, label: `Move to ${option.label}` }));
    return [
      { value: '', label: 'Bulk actions' },
      ...statusActions,
      ...(filterStatus === 'trash'
        ? [{ value: 'draft', label: 'Restore to Draft' }]
        : [{ value: 'trash', label: 'Archive' }]),
      ...(filterStatus === 'trash' ? [{ value: 'delete', label: 'Delete permanently' }] : []),
    ];
  }, [filterStatus]);
  const authorOptions = useMemo(() => {
    const authors = Array.from(new Set([
      'Curriculum Team',
      ...kbcUsers.map(user => user.fullName),
      ...quizzes.map(quiz => quiz.author).filter(Boolean),
    ]));
    return authors.map(author => ({ value: author, label: author }));
  }, [quizzes]);
  const programmeOptions = useMemo(() => [
    { value: '', label: 'Programme' },
    ...trainingPlanOptions.programmes,
  ], [trainingPlanOptions.programmes]);
  const moduleOptions = useMemo(() => [
    { value: '', label: form.programme ? 'Module' : 'Select programme first', programmeId: 0 },
    ...(trainingPlanOptions.modulesByProgramme[form.programme] ?? []),
  ], [form.programme, trainingPlanOptions.modulesByProgramme]);
  const generatorModuleOptions = useMemo(() => [
    { value: '', label: generatorForm.programme ? 'Module' : 'Select programme first', programmeId: 0 },
    ...(trainingPlanOptions.modulesByProgramme[generatorForm.programme] ?? []),
  ], [generatorForm.programme, trainingPlanOptions.modulesByProgramme]);

  const selectedCount = selectedIds.length;
  const activeEditorQuestion = editorData?.questions.find(question => question.id === activeQuestionId) ?? editorData?.questions[0];
  const editorSnapshot = useMemo(() => editorData ? serializeEditorQuestions(editorData.questions) : '', [editorData]);
  const editorDirty = Boolean(editorData && editorSnapshot !== editorBaseline);

  const resetModal = () => {
    setShowCreate(false);
    setForm(emptyForm);
    setUploadFile(null);
    setSavingQuiz(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const resetGenerator = () => {
    setShowGenerator(false);
    setGeneratorForm(emptyGeneratorForm);
    setGeneratorFiles([]);
    setGeneratorDragActive(false);
    setGeneratedQuestions([]);
    if (generatorFileInputRef.current) generatorFileInputRef.current.value = '';
  };

  const selectGeneratorFiles = (files: File[]) => {
    setGeneratorFiles(files);
    const firstFile = files[0];
    if (!firstFile) return;
    setGeneratorForm(prev => ({
      ...prev,
      title: prev.title || firstFile.name.replace(/\.(txt|md|csv|xml|html|htm|json|xlsx|xlsm|pptx|pptm|pdf|docx|zip)$/i, '').replace(/[-_]/g, ' '),
    }));
  };

  const handleStatusFilterChange = (status: 'all' | QuizStatus) => {
    setFilterStatus(status);
    const nextParams = new URLSearchParams(searchParams);
    if (status === 'all') {
      nextParams.delete('status');
    } else {
      nextParams.set('status', status);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const submitQuiz = async (event: FormEvent) => {
    event.preventDefault();
    if (savingQuiz) return;
    setError('');
    setSavingQuiz(true);

    try {
      let response: Response;
      if (uploadFile) {
        const body = new FormData();
        body.append('file', uploadFile);
        Object.entries(form).forEach(([key, value]) => body.append(key, value));
        response = await fetch('/quiz_api/quizzes/', { method: 'POST', body });
      } else {
        response = await fetch('/quiz_api/quizzes/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: form.title,
            module: form.module,
            programme: form.programme,
            programmeId: form.programmeId,
            week: form.week,
            version: form.version,
            questions: Number(form.questions || 0),
            questionType: form.questionType,
            status: form.status,
            author: form.author,
            linkedCourses: Number(form.linkedCourses || 0),
            packageType: 'xml',
          }),
        });
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || 'Could not save quiz');
      }
      const saved = await response.json();
      setQuizzes(prev => [saved, ...prev]);
      resetModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save quiz');
    } finally {
      setSavingQuiz(false);
    }
  };

  const generateQuestions = async () => {
    setError('');
    if (!generatorForm.topic.trim() && !generatorForm.lessonContent.trim() && generatorFiles.length === 0) {
      setError('Add a topic, paste lesson content, or upload source files first. The embedded prompt controls how AI writes questions, but it is not lesson content.');
      return;
    }
    setGeneratingQuestions(true);
    try {
      let response: Response;
      if (generatorFiles.length) {
        const body = new FormData();
        generatorFiles.forEach(file => body.append('files', file));
        body.append('courseTitle', generatorForm.title);
        body.append('topic', generatorForm.topic);
        body.append('lessonContent', generatorForm.lessonContent);
        body.append('customInstructions', generatorForm.customInstructions);
        body.append('programme', generatorForm.programme);
        body.append('module', generatorForm.module);
        body.append('questionCount', generatorForm.questionCount);
        response = await fetch('/quiz_api/ai/generate-questions/', { method: 'POST', body });
      } else {
        response = await fetch('/quiz_api/ai/generate-questions/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            courseTitle: generatorForm.title,
            topic: generatorForm.topic,
            lessonContent: generatorForm.lessonContent,
            customInstructions: generatorForm.customInstructions,
            programme: generatorForm.programme,
            module: generatorForm.module,
            questionCount: Number(generatorForm.questionCount || 5),
          }),
        });
      }
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Could not generate questions');
      setGeneratedQuestions(data.questions || []);
      const unreadableFiles = data.source?.unreadableFiles || [];
      if (unreadableFiles.length) {
        setError(`Generated from readable files only. These files had no extractable text: ${unreadableFiles.join(', ')}. Upload a text-based version or OCR copy to include them.`);
      }
      success('Questions generated', `${data.questions?.length || 0} questions are ready for review.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate questions');
    } finally {
      setGeneratingQuestions(false);
    }
  };

  const saveGeneratedQuiz = async () => {
    if (!generatedQuestions.length) return;
    setSavingGeneratedQuiz(true);
    setError('');
    try {
      const createResponse = await fetch('/quiz_api/quizzes/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: generatorForm.title || generatorForm.topic || 'AI Generated Quiz',
          module: generatorForm.module,
          programme: generatorForm.programme,
          programmeId: generatorForm.programmeId,
          week: generatorForm.week,
          version: 'v1.0',
          questions: generatedQuestions.length,
          questionType: generatedQuestions[0]?.questionType || 'single_choice',
          status: 'draft',
          author: generatorForm.author,
          linkedCourses: generatorForm.programmeId ? 1 : 0,
          packageType: 'xml',
          schemaValid: true,
        }),
      });
      const created = await createResponse.json().catch(() => null);
      if (!createResponse.ok) throw new Error(created?.error || 'Could not create quiz');

      const saveResponse = await fetch(`/quiz_api/quizzes/${created.id}/questions/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: generatedQuestions, removeMissing: true }),
      });
      const saved = await saveResponse.json().catch(() => null);
      if (!saveResponse.ok) throw new Error(saved?.error || 'Could not save generated questions');

      setQuizzes(prev => [saved.quiz, ...prev.filter(quiz => quiz.id !== saved.quiz.id)]);
      resetGenerator();
      success('Quiz saved', 'Generated questions were saved as a draft quiz.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save generated quiz');
    } finally {
      setSavingGeneratedQuiz(false);
    }
  };

  const updateStatus = async (ids: number[], status: QuizStatus) => {
    const responses = await Promise.all(ids.map(id => fetch(`/quiz_api/quizzes/${id}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })));
    const failed = responses.find(response => !response.ok);
    if (failed) {
      const details = await failed.json().catch(() => null);
      throw new Error(details?.error || 'Could not update selected quizzes');
    }
    setSelectedIds([]);
    setBulkAction('');
    await loadQuizzes();
    success(status === 'trash' ? 'Quizzes archived' : 'Status updated', `${ids.length} selected quiz${ids.length === 1 ? '' : 'zes'} updated.`);
  };

  const updateAuthor = async (quiz: QuizPackage, author: string) => {
    if (quiz.author === author) return;
    await fetch(`/quiz_api/quizzes/${quiz.id}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author }),
    });
    setQuizzes(prev => prev.map(item => item.id === quiz.id ? { ...item, author } : item));
    setSelectedQuiz(prev => prev?.id === quiz.id ? { ...prev, author } : prev);
  };

  const deleteSelected = async () => {
    const ids = [...selectedIds];
    const responses = await Promise.all(ids.map(id => fetch(`/quiz_api/quizzes/${id}/`, { method: 'DELETE' })));
    const failed = responses.find(response => !response.ok);
    if (failed) throw new Error('Could not delete selected quizzes');
    setSelectedIds([]);
    setBulkAction('');
    setSelectedQuiz(null);
    await loadQuizzes();
    success('Quizzes deleted', `${ids.length} selected quiz${ids.length === 1 ? '' : 'zes'} deleted permanently.`);
  };

  const applyBulkAction = async () => {
    if (!bulkAction || !selectedIds.length) return;
    const ids = [...selectedIds];
    setError('');
    try {
      if (editableStatusOptions.some(option => option.value === bulkAction)) {
        await updateStatus(ids, bulkAction as QuizStatus);
      } else if (bulkAction === 'delete') {
        await deleteSelected();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bulk action failed';
      setError(message);
      toastError('Bulk action failed', message);
    }
  };

  const openStudentPreview = async (quiz: QuizPackage) => {
    setPreviewLoadingId(quiz.id);
    setError('');
    try {
      const response = await fetch(`/quiz_api/quizzes/${quiz.id}/preview/`);
      if (!response.ok) throw new Error('Could not load quiz preview');
      const data = await response.json();
      setPreviewData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load quiz preview');
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const openQuestionEditor = async (quiz: QuizPackage) => {
    window.location.href = `/curriculum/quiz-xml/${quiz.id}/edit`;
  };

  const updateEditorQuestion = (questionId: number, patch: Partial<QuizPreviewQuestion>) => {
    setEditorData(prev => prev ? ({
      ...prev,
      questions: prev.questions.map(question => question.id === questionId ? { ...question, ...patch } : question),
    }) : prev);
  };

  const updateEditorAnswer = (questionId: number, answerId: number, patch: Partial<QuizPreviewQuestion['answers'][number]>) => {
    setEditorData(prev => prev ? ({
      ...prev,
      questions: prev.questions.map(question => question.id === questionId ? {
        ...question,
        answers: question.answers.map(answer => answer.id === answerId ? { ...answer, ...patch } : answer),
      } : question),
    }) : prev);
  };

  const markCorrectAnswer = (questionId: number, answerId: number) => {
    setEditorData(prev => prev ? ({
      ...prev,
      questions: prev.questions.map(question => question.id === questionId ? {
        ...question,
        answers: question.answers.map(answer => ({
          ...answer,
          isCorrect: question.questionType === 'multiple_choice'
            ? answer.id === answerId ? !answer.isCorrect : answer.isCorrect
            : answer.id === answerId,
        })),
      } : question),
    }) : prev);
  };

  const addEditorAnswer = (questionId: number) => {
    setEditorData(prev => prev ? ({
      ...prev,
      questions: prev.questions.map(question => question.id === questionId ? {
        ...question,
        answers: [...question.answers, { id: Date.now(), text: '', isCorrect: false }],
      } : question),
    }) : prev);
  };

  const saveQuestionEditor = async () => {
    if (!editorData) return;
    setEditorSaving(true);
    setError('');
    try {
      const response = await fetch(`/quiz_api/quizzes/${editorData.quiz.id}/questions/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: editorData.questions }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || 'Could not save questions');
      }
      const data = await response.json();
      setEditorData(data);
      setEditorBaseline(serializeEditorQuestions(data.questions));
      success('Changes saved', 'Quiz questions and answers were updated.');
      await loadQuizzes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save questions');
    } finally {
      setEditorSaving(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadFile(file);
    setForm(prev => ({
      ...prev,
      title: prev.title || file.name.replace(/\.(xml|zip|xlsx|xlsm|csv)$/i, '').replace(/[-_]/g, ' '),
    }));
    event.target.value = '';
    setShowCreate(true);
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Quiz Workspace" pageSubtitle="Upload XML, SCORM or spreadsheet quiz files, then store questions and answers" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-code-box-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Quiz Workspace</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{quizzes.length} quiz packages</strong> - {published} published, {draft} in draft. {validationIssues} with validation issues.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{quizzes.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Quizzes</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{totalQuestions}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Questions</p></div>
=======
  version: string;
  status: 'published' | 'draft' | 'validating';
  lastBuilt: string;
  xmlSize: string;
  schemaValid: boolean;
  mappedComponents: number;
}

const QUIZZES: QuizXml[] = [
  { id: 'qx-01', title: 'Business Communication — Week 1 Quiz', module: 'Business Communication', programme: 'Business Admin L3', questions: 12, version: 'v2.1', status: 'published', lastBuilt: '5 Jun 2026', xmlSize: '24 KB', schemaValid: true, mappedComponents: 2 },
  { id: 'qx-02', title: 'Written Communication Assessment', module: 'Business Communication', programme: 'Business Admin L3', questions: 15, version: 'v1.8', status: 'published', lastBuilt: '3 Jun 2026', xmlSize: '31 KB', schemaValid: true, mappedComponents: 3 },
  { id: 'qx-03', title: 'Organisational Culture Checkpoint', module: 'Organisational Culture', programme: 'Business Admin L3', questions: 10, version: 'v1.5', status: 'draft', lastBuilt: '1 Jun 2026', xmlSize: '18 KB', schemaValid: true, mappedComponents: 1 },
  { id: 'qx-04', title: 'Data Visualisation — Tableau Basics', module: 'Data Visualisation', programme: 'Data Analyst L4', questions: 18, version: 'v2.0', status: 'published', lastBuilt: '4 Jun 2026', xmlSize: '42 KB', schemaValid: true, mappedComponents: 2 },
  { id: 'qx-05', title: 'Statistical Concepts Quiz', module: 'Statistical Analysis', programme: 'Data Analyst L4', questions: 20, version: 'v1.3', status: 'validating', lastBuilt: '28 May 2026', xmlSize: '45 KB', schemaValid: false, mappedComponents: 3 },
  { id: 'qx-06', title: 'Segmentation & Targeting Test', module: 'Marketing Planning', programme: 'Marketing Exec L4', questions: 14, version: 'v1.7', status: 'published', lastBuilt: '2 Jun 2026', xmlSize: '28 KB', schemaValid: true, mappedComponents: 2 },
  { id: 'qx-07', title: 'Digital Channels Assessment', module: 'Digital Channels', programme: 'Marketing Exec L4', questions: 16, version: 'v1.4', status: 'draft', lastBuilt: '25 May 2026', xmlSize: '33 KB', schemaValid: true, mappedComponents: 2 },
  { id: 'qx-08', title: 'Agile Development Fundamentals', module: 'Agile Development', programme: 'Software Dev L4', questions: 22, version: 'v0.9', status: 'draft', lastBuilt: '20 May 2026', xmlSize: '50 KB', schemaValid: false, mappedComponents: 4 },
];

export default function QuizXmlWorkspacePage() {
  const [selectedQuiz, setSelectedQuiz] = useState<QuizXml | null>(null);
  const [showXmlPreview, setShowXmlPreview] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const filtered = filterStatus === 'all' ? QUIZZES : QUIZZES.filter(q => q.status === filterStatus);
  const published = QUIZZES.filter(q => q.status === 'published').length;
  const draft = QUIZZES.filter(q => q.status === 'draft').length;
  const validationIssues = QUIZZES.filter(q => !q.schemaValid).length;

  const sampleXml = `<quiz id="qx-01" version="2.1">
  <metadata>
    <title>Business Communication — Week 1 Quiz</title>
    <module>M01 — Business Communication</module>
    <ksb_refs>K1 K2 K3</ksb_refs>
    <time_limit>20</time_limit>
    <pass_mark>70</pass_mark>
  </metadata>
  <questions>
    <question id="q1" type="multiple_choice" points="1">
      <stem>Which model describes communication as a linear process?</stem>
      <options>
        <option correct="true">Shannon-Weaver Model</option>
        <option correct="false">Schramm Model</option>
        <option correct="false">Berlo's SMCR Model</option>
        <option correct="false">Transactional Model</option>
      </options>
      <feedback>The Shannon-Weaver Model (1949) is linear: Sender → Encoder → Channel → Decoder → Receiver</feedback>
    </question>
    <!-- ... -->
  </questions>
</quiz>`;

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Quiz XML Workspace" pageSubtitle="Build, validate and publish SCORM-compatible quiz XML packages" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        {/* Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-code-box-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Quiz XML Workspace</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{QUIZZES.length} quiz packages</strong> — {published} published, {draft} in draft. {validationIssues} with schema validation issues.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{QUIZZES.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Quizzes</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{QUIZZES.reduce((s, q) => s + q.questions, 0)}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Questions</p></div>
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{published}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Published</p></div>
            </div>
          </div>
        </div>

<<<<<<< HEAD
        <input ref={fileInputRef} type="file" accept=".xml,.zip,.xlsx,.xlsm,.csv" className="hidden" onChange={handleFileChange} />
        <input
          ref={generatorFileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.csv,.xml,.html,.htm,.json,.xlsx,.xlsm,.pptx,.pptm,.pdf,.docx,.zip"
          className="hidden"
          onChange={event => {
            selectGeneratorFiles(Array.from(event.target.files ?? []));
          }}
        />

        <div className="bg-background-100 rounded-xl border border-foreground-200/50 p-3 flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 px-2">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={() => {
                const pageIds = paginatedQuizzes.map(q => q.id);
                setSelectedIds(prev => allVisibleSelected ? prev.filter(id => !pageIds.includes(id)) : Array.from(new Set([...prev, ...pageIds])));
              }}
              className="w-4 h-4 rounded border-foreground-300"
            />
          </label>

          <ThemedSelect
            value={bulkAction}
            options={bulkActionOptions}
            disabled={!selectedCount}
            onChange={setBulkAction}
            className="w-44"
          />
          <button
            type="button"
            onClick={() => void applyBulkAction()}
            disabled={!selectedCount || !bulkAction}
            className="h-10 px-4 rounded-lg bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 disabled:bg-[#c7d2fe] disabled:cursor-not-allowed transition-smooth whitespace-nowrap"
          >
            Apply
          </button>

          <ThemedSelect
            value={filterStatus}
            options={statusOptions}
            onChange={handleStatusFilterChange}
            className="w-44 ml-auto"
          />

          <div className="relative">
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by title" className="h-10 w-56 rounded-lg bg-background-50 border border-foreground-200/60 pl-4 pr-10 text-sm outline-none focus:border-primary-400" />
            <i className="ri-search-line absolute right-3 top-1/2 -translate-y-1/2 text-foreground-400"></i>
          </div>

          <button
            type="button"
            onClick={() => handleStatusFilterChange(filterStatus === 'trash' ? 'all' : 'trash')}
            className={`h-10 px-4 rounded-lg text-sm font-semibold transition-smooth whitespace-nowrap flex items-center ${
              filterStatus === 'trash'
                ? 'bg-[#fff7ed] border border-[#fed7aa] text-[#c2410c]'
                : 'bg-white border border-[#d8dde6] text-[#5b2dbb] hover:bg-[#f7f3ff]'
            }`}
            title={filterStatus === 'trash' ? 'Back to all quizzes' : 'View archived quizzes'}
          >
            <i className={`${filterStatus === 'trash' ? 'ri-arrow-left-line' : 'ri-archive-line'} mr-1`}></i>
            {filterStatus === 'trash' ? 'Back to quizzes' : 'Archive'}
          </button>

          <Link to="/curriculum/question-bank" className="h-10 px-4 bg-white border border-[#d8dde6] rounded-lg text-sm font-semibold text-[#5b2dbb] hover:bg-[#f7f3ff] transition-smooth whitespace-nowrap flex items-center">
            <i className="ri-questionnaire-line mr-1"></i> Question Bank
          </Link>
          <button onClick={() => setShowGenerator(true)} className="h-10 px-4 bg-[#0f172a] text-white rounded-lg text-sm font-semibold hover:bg-[#111827] transition-smooth whitespace-nowrap">
            <i className="ri-sparkling-2-line mr-1"></i> Generate Questions
          </button>
          <button onClick={() => setShowCreate(true)} className="h-10 px-4 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth whitespace-nowrap">
            <i className="ri-add-circle-fill mr-1"></i> Add New Quiz
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="h-10 px-4 bg-background-50 border border-foreground-200/60 rounded-lg text-sm font-semibold text-foreground-700 hover:bg-background-200 transition-smooth whitespace-nowrap">
            <i className="ri-upload-cloud-line mr-1"></i> Upload Quiz File
          </button>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-foreground-300/50 bg-background-100/60">
                  <th className="px-4 py-3 w-10"></th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-foreground-500">Title</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-foreground-500">Linked Courses</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-foreground-500">Date</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-foreground-500">Author</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-foreground-500">Package</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-foreground-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-foreground-400">Loading quizzes...</td></tr>
                )}
                {!loading && paginatedQuizzes.map(quiz => (
                  <tr key={quiz.id} onClick={() => setSelectedQuiz(quiz)} className="border-b border-foreground-200/40 hover:bg-background-100/40 transition-smooth cursor-pointer">
                    <td className="px-4 py-3" onClick={event => event.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds.includes(quiz.id)} onChange={() => setSelectedIds(prev => prev.includes(quiz.id) ? prev.filter(id => id !== quiz.id) : [...prev, quiz.id])} className="w-4 h-4 rounded border-foreground-300" />
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-foreground-900">{quiz.title}</p>
                      <p className="text-xs text-foreground-400">{quiz.module || 'No module'} - {quiz.questions} questions</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-primary-600">{quiz.linkedCourses}</td>
                    <td className="px-4 py-3 text-sm text-foreground-700">
                      <p>Last Modified - <span>{statusLabel(quiz.status)}</span></p>
                      <p>{formatDate(quiz.updatedAt)}</p>
                    </td>
                    <td className="px-4 py-3" onClick={event => event.stopPropagation()}>
                      <ThemedSelect
                        value={quiz.author || 'Curriculum Team'}
                        options={authorOptions}
                        onChange={author => void updateAuthor(quiz, author)}
                        className="w-48"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${statusClasses(quiz.status)}`}>{statusLabel(quiz.status)}</span>
                        <span className="text-xs text-foreground-400 uppercase">{quiz.packageType}</span>
                        {quiz.schemaValid ? <i className="ri-checkbox-circle-line text-emerald-500"></i> : <i className="ri-error-warning-line text-red-500"></i>}
                      </div>
                    </td>
                    <td className="px-4 py-3" onClick={event => event.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        {quiz.status === 'trash' && (
                          <button
                            onClick={() => void updateStatus([quiz.id], 'draft')}
                            className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-smooth"
                            title="Restore to quizzes"
                          >
                            <i className="ri-arrow-go-back-line"></i>
                          </button>
                        )}
                        <button
                          onClick={() => void openStudentPreview(quiz)}
                          className="w-9 h-9 rounded-lg bg-background-100 hover:bg-primary-100 hover:text-primary-600 transition-smooth"
                          title="Student preview"
                        >
                          <i className={`${previewLoadingId === quiz.id ? 'ri-loader-4-line animate-spin' : 'ri-eye-line'}`}></i>
                        </button>
                        <button onClick={() => void openQuestionEditor(quiz)} className="w-9 h-9 rounded-lg bg-background-100 hover:bg-primary-100 hover:text-primary-600 transition-smooth" title="Review questions">
                          <i className={`${editorLoadingId === quiz.id ? 'ri-loader-4-line animate-spin' : 'ri-pencil-line'}`}></i>
                        </button>
                        <a href={`/quiz_api/quizzes/${quiz.id}/download/`} className="w-9 h-9 rounded-lg bg-background-100 hover:bg-primary-100 hover:text-primary-600 transition-smooth flex items-center justify-center"><i className="ri-download-line"></i></a>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && quizzes.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-foreground-400">No quizzes match this filter</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {!loading && quizzes.length > 0 && (
            <div className="border-t border-foreground-200/50 bg-white px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="text-xs text-foreground-400">
                Showing <span className="font-semibold text-foreground-700">{pageStartIndex + 1}</span>-
                <span className="font-semibold text-foreground-700">{Math.min(pageEndIndex, quizzes.length)}</span> of{' '}
                <span className="font-semibold text-foreground-700">{quizzes.length}</span> quizzes
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
                  disabled={safeCurrentPage === 1}
                  className="w-9 h-9 rounded-lg bg-background-100 text-sm font-semibold text-foreground-600 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Previous page"
                >
                  <i className="ri-arrow-left-line"></i>
                </button>
                {visiblePageNumbers.map((page, index) => (
                  <div key={page} className="flex items-center gap-2">
                    {index > 0 && page - visiblePageNumbers[index - 1] > 1 && <span className="px-1 text-xs text-foreground-400">...</span>}
                    <button
                      type="button"
                      onClick={() => setCurrentPage(page)}
                      className={`w-9 h-9 rounded-lg text-sm font-semibold transition-smooth ${safeCurrentPage === page ? 'bg-primary-50 text-primary-700' : 'bg-background-100 text-foreground-600 hover:bg-primary-50 hover:text-primary-600'}`}
                    >
                      {page}
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setCurrentPage(page => Math.min(pageCount, page + 1))}
                  disabled={safeCurrentPage === pageCount}
                  className="w-9 h-9 rounded-lg bg-background-100 text-sm font-semibold text-foreground-600 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Next page"
                >
                  <i className="ri-arrow-right-line"></i>
                </button>
                <ThemedSelect
                  value={pageSize}
                  options={pageSizeOptions}
                  onChange={setPageSize}
                  className="w-36 ml-0 md:ml-2"
                />
=======
        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {(['all', 'published', 'draft', 'validating'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filterStatus === s ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
          <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-add-line mr-1"></i> New Quiz XML</button>
          <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-upload-cloud-line mr-1"></i> Import SCORM</button>
        </div>

        <div className="flex gap-6">
          {/* Quiz List */}
          <div className="flex-1 min-w-0">
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_0.8fr_0.8fr_1fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                <span>Quiz</span>
                <span>Version</span>
                <span className="text-center">Questions</span>
                <span className="text-center">Size</span>
                <span className="text-center">Schema</span>
                <span className="text-center">Status</span>
                <span className="text-center">Action</span>
              </div>
              <div className="divide-y divide-background-200/30">
                {filtered.map(q => (
                  <div key={q.id} onClick={() => { setSelectedQuiz(q); setShowXmlPreview(false); }} className={`grid grid-cols-[2fr_1fr_1fr_1fr_0.8fr_0.8fr_1fr] gap-3 px-4 py-3 items-center cursor-pointer transition-smooth ${selectedQuiz?.id === q.id ? 'bg-primary-50/40 border-l-2 border-l-primary-400' : 'hover:bg-background-100/30'}`}>
                    <div>
                      <span className="text-[12px] font-medium text-foreground-900 block">{q.title}</span>
                      <span className="text-[10px] text-foreground-400">{q.module} · {q.programme}</span>
                    </div>
                    <span className="text-[11px] text-foreground-500">{q.version}</span>
                    <span className="text-[11px] text-foreground-500 text-center">{q.questions}</span>
                    <span className="text-[11px] text-foreground-500 text-center">{q.xmlSize}</span>
                    <div className="flex justify-center">
                      {q.schemaValid ? <i className="ri-checkbox-circle-line text-emerald-500 text-sm"></i> : <i className="ri-error-warning-line text-red-500 text-sm"></i>}
                    </div>
                    <div className="flex justify-center">
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${q.status === 'published' ? 'bg-emerald-100 text-emerald-700' : q.status === 'validating' ? 'bg-amber-100 text-amber-700' : 'bg-foreground-100 text-foreground-500'}`}>{q.status}</span>
                    </div>
                    <div className="flex justify-center gap-1">
                      <button className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Build</button>
                      <button className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center hover:bg-secondary-100 hover:text-secondary-600 transition-smooth cursor-pointer"><i className="ri-download-line text-xs"></i></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Detail Panel */}
          {selectedQuiz && (
            <div className="w-[380px] shrink-0">
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium sticky top-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-heading font-bold text-foreground-900">{selectedQuiz.title}</h4>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${selectedQuiz.status === 'published' ? 'bg-emerald-100 text-emerald-700' : selectedQuiz.status === 'validating' ? 'bg-amber-100 text-amber-700' : 'bg-foreground-100 text-foreground-500'}`}>{selectedQuiz.status}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {[
                    { l: 'Questions', v: String(selectedQuiz.questions) },
                    { l: 'Version', v: selectedQuiz.version },
                    { l: 'XML Size', v: selectedQuiz.xmlSize },
                    { l: 'Mapped Components', v: String(selectedQuiz.mappedComponents) },
                    { l: 'Schema Valid', v: selectedQuiz.schemaValid ? 'Yes' : 'No' },
                    { l: 'Last Built', v: selectedQuiz.lastBuilt },
                  ].map(s => (
                    <div key={s.l} className="bg-background-100/50 rounded-lg p-2.5">
                      <p className="text-[9px] text-foreground-400 uppercase tracking-wider">{s.l}</p>
                      <p className={`text-sm font-semibold ${s.l === 'Schema Valid' ? (selectedQuiz.schemaValid ? 'text-emerald-600' : 'text-red-600') : 'text-foreground-900'}`}>{s.v}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <button onClick={() => setShowXmlPreview(!showXmlPreview)} className="flex-1 px-3 py-1.5 bg-background-100 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-100 hover:text-secondary-700 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className={`${showXmlPreview ? 'ri-eye-off-line' : 'ri-eye-line'} mr-1`}></i> {showXmlPreview ? 'Hide XML' : 'Preview XML'}
                  </button>
                  <button className="flex-1 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-edit-line mr-1"></i> Edit XML</button>
                </div>
                {showXmlPreview && (
                  <div className="bg-foreground-900 rounded-lg p-3 overflow-auto max-h-[350px]">
                    <pre className="text-[10px] text-emerald-300 font-mono leading-relaxed whitespace-pre">{sampleXml}</pre>
                  </div>
                )}
                {!selectedQuiz.schemaValid && (
                  <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
                    <p className="text-[10px] font-semibold text-red-700"><i className="ri-error-warning-line mr-1"></i> Schema Validation Errors</p>
                    <ul className="text-[10px] text-red-600 mt-1 space-y-0.5 list-disc list-inside">
                      <li>Missing required attribute: time_limit</li>
                      <li>Question q7: invalid type "matrix"</li>
                    </ul>
                  </div>
                )}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
              </div>
            </div>
          )}
        </div>
<<<<<<< HEAD

        {selectedQuiz && (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setSelectedQuiz(null)}>
            <aside className="w-full max-w-md bg-background-50 h-full shadow-xl p-6 overflow-y-auto" onClick={event => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <h3 className="text-lg font-heading font-bold text-foreground-900">{selectedQuiz.title}</h3>
                  <p className="text-sm text-foreground-400">{selectedQuiz.module} - {selectedQuiz.programme}</p>
                </div>
                <button onClick={() => setSelectedQuiz(null)} className="w-9 h-9 rounded-lg bg-background-100 hover:bg-background-200"><i className="ri-close-line"></i></button>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-5">
                {[
                  ['Questions', selectedQuiz.questions],
                  ['Version', selectedQuiz.version],
                  ['Package', selectedQuiz.packageType.toUpperCase()],
                  ['Size', selectedQuiz.displaySize],
                  ['Schema', selectedQuiz.schemaValid ? 'Valid' : 'Issue'],
                  ['Mapped', selectedQuiz.mappedComponents],
                ].map(([label, value]) => (
                  <div key={label} className="bg-background-100 rounded-lg p-3">
                    <p className="text-[10px] uppercase tracking-wider text-foreground-400">{label}</p>
                    <p className="text-sm font-semibold text-foreground-900">{value}</p>
                  </div>
                ))}
              </div>
              {!selectedQuiz.schemaValid && (
                <div className="mb-5 p-3 bg-red-50 rounded-lg border border-red-200 text-sm text-red-700">
                  <i className="ri-error-warning-line mr-1"></i>{selectedQuiz.validationMessage || 'Package requires validation.'}
                </div>
              )}
              <div className="flex items-center gap-2 mb-4">
                <button onClick={() => void updateStatus([selectedQuiz.id], 'published')} className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600">Publish</button>
                <a href={`/quiz_api/quizzes/${selectedQuiz.id}/download/`} className="flex-1 px-3 py-2 bg-background-100 rounded-lg text-sm font-semibold text-center hover:bg-background-200">Download</a>
              </div>
              <div className="rounded-xl border border-foreground-200/60 bg-background-100/60 p-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-foreground-400 mb-1">Import Summary</p>
                  <p className="text-sm text-foreground-700 leading-relaxed">This quiz is ready for curriculum use and learner preview.</p>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-foreground-500">Linked training plan</span>
                    <span className="font-semibold text-foreground-900">{selectedQuiz.linkedCourses > 0 ? `${selectedQuiz.linkedCourses} linked` : 'Not linked'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-foreground-500">Programme</span>
                    <span className="font-semibold text-foreground-900 text-right">{selectedQuiz.programme || 'Not set'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-foreground-500">Section</span>
                    <span className="font-semibold text-foreground-900 text-right">{selectedQuiz.module || 'Not set'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-foreground-500">Imported content</span>
                    <span className="font-semibold text-foreground-900">{selectedQuiz.questions} questions</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}

        {previewData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setPreviewData(null)}>
            <div className="w-full max-w-6xl max-h-[92vh] bg-white rounded-2xl border border-[#ded8e8] shadow-2xl flex flex-col overflow-hidden" onClick={event => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 px-4 sm:px-7 py-5 sm:py-6 border-b border-[#e2e8f0] bg-[#fbfbfd]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-8 h-8 rounded-xl bg-[#f2f0ff] text-[#5b2dbb] flex items-center justify-center">
                      <i className="ri-eye-line"></i>
                    </span>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#5b2dbb]">Student Preview</p>
                  </div>
                  <h3 className="text-xl font-heading font-bold text-foreground-900 leading-snug">{previewData.quiz.title}</h3>
                  <p className="text-sm text-[#647083] mt-1">
                    {previewData.quiz.packageType === 'scorm' ? 'SCORM package preview' : `${previewData.questions.length} questions`}{previewData.quiz.programme ? ` - ${previewData.quiz.programme}` : ''}
                  </p>
                </div>
                <button onClick={() => setPreviewData(null)} className="w-11 h-11 rounded-xl bg-white hover:bg-[#f1f5f9] text-[#0f172a] shrink-0 transition-smooth"><i className="ri-close-line text-lg"></i></button>
              </div>

              <div className={`${previewData.quiz.packageType === 'scorm' ? 'flex-1 min-h-[620px] p-0' : 'flex-1 overflow-y-auto bg-[#f8fafc] px-4 py-5 sm:px-6 quiz-preview-scroll'}`}>
                {previewData.quiz.packageType === 'scorm' ? (
                  <iframe
                    title={`${previewData.quiz.title} SCORM preview`}
                    src={`/quiz_api/quizzes/${previewData.quiz.id}/scorm/`}
                    className="w-full h-full min-h-[620px] border-0 bg-background-50"
                    sandbox="allow-scripts allow-forms allow-same-origin"
                  />
                ) : previewData.questions.length === 0 ? (
                  <div className="py-16 text-center">
                    <span className="w-14 h-14 rounded-2xl bg-white border border-[#e2e8f0] flex items-center justify-center mx-auto mb-3">
                      <i className="ri-questionnaire-line text-foreground-300 text-xl"></i>
                    </span>
                    <p className="text-sm font-semibold text-foreground-600">No saved questions yet</p>
                    <p className="text-xs text-foreground-400 mt-1">Upload an Excel/CSV/XML file with questions to preview the learner view.</p>
                  </div>
                ) : (
                  <div className="max-w-5xl mx-auto space-y-4 sm:space-y-5">
                    {previewData.questions.map((question, questionIndex) => (
                      <div key={question.id} className="rounded-2xl border border-[#d8e0ea] bg-white px-4 py-5 sm:p-6 shadow-sm overflow-hidden">
                        <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-3 sm:gap-5">
                          <span className="w-10 h-10 rounded-xl bg-[#f2edff] text-[#5b21b6] border border-[#ded2ff] flex items-center justify-center text-sm font-bold shrink-0">{questionIndex + 1}</span>
                          <div className="min-w-0">
                            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 mb-5">
                              <p className="text-[15px] sm:text-base font-semibold text-[#0f172a] leading-7 break-words [overflow-wrap:anywhere]">{question.text}</p>
                              <span className="w-fit text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-lg bg-[#e8eef5] text-[#526173] shrink-0">
                                {questionTypeOptions.find(option => option.value === question.questionType)?.label || question.questionType}
                              </span>
                            </div>
                            <QuestionAnswersView type={question.questionType} answers={question.answers} fallbackText={question.explanation} />
                            {question.explanation && (
                              <div className="mt-5 rounded-xl border border-[#ddd2ff] bg-[#fbf9ff] px-4 py-3.5">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-[#6d5aa8] mb-1">Feedback</p>
                                <p className="text-sm text-[#3f2f73] leading-6 break-words [overflow-wrap:anywhere]">{question.explanation}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {editorData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditorData(null)}>
            <div className="w-full max-w-6xl max-h-[90vh] bg-background-50 rounded-2xl border border-foreground-200/60 shadow-xl flex flex-col" onClick={event => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 p-5 border-b border-foreground-200/60">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary-600 mb-1">Question Editor</p>
                  <h3 className="text-lg font-heading font-bold text-foreground-900 truncate">{editorData.quiz.title}</h3>
                  <p className="text-sm text-foreground-400">{editorData.questions.length} questions - review wording, answers and correct option</p>
                </div>
                <button onClick={() => setEditorData(null)} className="w-9 h-9 rounded-lg bg-background-100 hover:bg-background-200 shrink-0"><i className="ri-close-line"></i></button>
              </div>

              <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[360px_1fr]">
                <aside className="border-r border-foreground-200/60 bg-background-100/50 p-4 overflow-y-auto quiz-preview-scroll">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-foreground-800">Questions</span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary-100 text-primary-700">{editorData.questions.length}</span>
                  </div>
                  <div className="space-y-2">
                    {editorData.questions.map((question, index) => (
                      <button
                        key={question.id}
                        onClick={() => setActiveQuestionId(question.id)}
                        className={`w-full text-left rounded-lg border px-3 py-2 transition-smooth ${activeEditorQuestion?.id === question.id ? 'bg-background-50 border-primary-300 shadow-sm' : 'bg-background-50/70 border-foreground-200/60 hover:border-primary-200'}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px] font-bold text-foreground-400">{String(index + 1).padStart(2, '0')}</span>
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground-200 text-foreground-600">{questionTypeOptions.find(option => option.value === question.questionType)?.label || question.questionType}</span>
                        </div>
                        <p className="text-xs text-foreground-800 line-clamp-2">{question.text}</p>
                      </button>
                    ))}
                  </div>
                </aside>

                <section className="p-5 overflow-y-auto quiz-preview-scroll">
                  {activeEditorQuestion ? (
                    <div className="space-y-5">
                      <div>
                        <label className="block text-xs font-semibold text-foreground-500 mb-2">Question text</label>
                        <textarea
                          value={activeEditorQuestion.text}
                          onChange={event => updateEditorQuestion(activeEditorQuestion.id, { text: event.target.value })}
                          className="w-full min-h-36 rounded-xl border border-foreground-200/60 bg-background-50 p-4 text-sm leading-relaxed outline-none focus:border-primary-400"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-foreground-500 mb-2">Question type</label>
                          <ThemedSelect
                            value={activeEditorQuestion.questionType}
                            options={questionTypeOptions}
                            onChange={questionType => updateEditorQuestion(activeEditorQuestion.id, { questionType })}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-foreground-500 mb-2">Feedback</label>
                          <input
                            value={activeEditorQuestion.explanation}
                            onChange={event => updateEditorQuestion(activeEditorQuestion.id, { explanation: event.target.value })}
                            className="w-full h-10 rounded-lg border border-foreground-200/60 bg-background-50 px-3 text-sm"
                            placeholder="Optional feedback"
                          />
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-heading font-bold text-foreground-900">Answers</h4>
                          <button onClick={() => addEditorAnswer(activeEditorQuestion.id)} className="px-3 py-1.5 rounded-lg bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition-smooth">
                            <i className="ri-add-line mr-1"></i>Add answer
                          </button>
                        </div>
                        <div className="space-y-3">
                          {activeEditorQuestion.answers.map((answer, answerIndex) => (
                            <div key={answer.id} className="rounded-xl border border-foreground-200/60 bg-background-100/70 p-3">
                              <div className="flex items-center gap-3">
                                <span className="w-7 h-7 rounded-full bg-background-50 border border-foreground-200/60 flex items-center justify-center text-xs font-bold text-foreground-500 shrink-0">{String.fromCharCode(65 + answerIndex)}</span>
                                <input
                                  value={answer.text}
                                  onChange={event => updateEditorAnswer(activeEditorQuestion.id, answer.id, { text: event.target.value })}
                                  className="flex-1 min-w-0 h-10 rounded-lg border border-foreground-200/60 bg-background-50 px-3 text-sm"
                                />
                                <label className="inline-flex items-center gap-2 text-sm text-foreground-700 shrink-0">
                                  <input
                                    type="radio"
                                    name={`correct-${activeEditorQuestion.id}`}
                                    checked={answer.isCorrect}
                                    onChange={() => markCorrectAnswer(activeEditorQuestion.id, answer.id)}
                                    className="w-4 h-4"
                                  />
                                  Correct
                                </label>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-16 text-center text-sm text-foreground-400">No questions to review.</div>
                  )}
                </section>
              </div>

              <div className="flex items-center justify-end gap-2 p-5 border-t border-foreground-200/60">
                <button onClick={() => setEditorData(null)} className="px-4 py-2 rounded-lg bg-background-100 text-sm font-semibold hover:bg-background-200">Close</button>
                <button onClick={() => void saveQuestionEditor()} disabled={editorSaving || !editorDirty} className="px-5 py-2 rounded-lg bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-primary-500">
                  {editorSaving ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showGenerator && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={resetGenerator}>
            <div className="w-full max-w-5xl max-h-[92vh] bg-background-50 rounded-2xl border border-foreground-200/60 shadow-xl flex flex-col overflow-hidden" onClick={event => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 p-5 border-b border-foreground-200/60">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary-600 mb-1">AI Question Generator</p>
                  <h3 className="text-lg font-heading font-bold text-foreground-900">Generate questions from text or files</h3>
                  <p className="text-sm text-foreground-400">Review the generated questions before saving them as a draft quiz.</p>
                </div>
                <button onClick={resetGenerator} className="w-9 h-9 rounded-lg bg-background-100 hover:bg-background-200 shrink-0"><i className="ri-close-line"></i></button>
              </div>

              <div className="flex-1 overflow-y-auto quiz-preview-scroll p-5 grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-5">
                <section className="space-y-3">
                  <input value={generatorForm.title} onChange={event => setGeneratorForm({ ...generatorForm, title: event.target.value })} placeholder="Quiz title" className="w-full h-10 rounded-lg border border-foreground-200/60 bg-white px-3 text-sm outline-none focus:border-primary-400" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
                    <ThemedSelect
                      value={generatorForm.programme}
                      options={programmeOptions}
                      onChange={programme => setGeneratorForm({ ...generatorForm, programme, module: '', programmeId: '' })}
                      menuClassName="max-h-56"
                    />
                    <ThemedSelect
                      value={generatorForm.module}
                      options={generatorModuleOptions}
                      onChange={module => {
                        const selectedModule = generatorModuleOptions.find(option => option.value === module);
                        setGeneratorForm({ ...generatorForm, module, programmeId: selectedModule?.programmeId ? String(selectedModule.programmeId) : '' });
                      }}
                      disabled={!generatorForm.programme}
                      menuClassName="max-h-56"
                    />
                    <input
                      value={generatorForm.week}
                      onChange={event => setGeneratorForm({ ...generatorForm, week: event.target.value })}
                      className="h-10 rounded-lg border border-foreground-200/60 bg-white px-3 text-sm outline-none focus:border-primary-400"
                      placeholder="Week, e.g. Week 9"
                    />
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={generatorForm.questionCount}
                      onChange={event => setGeneratorForm({ ...generatorForm, questionCount: event.target.value })}
                      className="h-10 rounded-lg border border-foreground-200/60 bg-white px-3 text-sm outline-none focus:border-primary-400"
                      title="Question count, up to 60"
                      placeholder="Questions"
                    />
                  </div>
                  <div className="rounded-xl border border-[#e4def8] bg-[#fbf9ff] px-3 py-2 text-xs leading-5 text-[#4b3f72]">
                    <strong className="text-[#5b2dbb]">Mixed quiz:</strong> AI will use different question formats and gradually balance easy, medium and hard questions.
                  </div>
                  <input value={generatorForm.topic} onChange={event => setGeneratorForm({ ...generatorForm, topic: event.target.value })} placeholder="Topic, e.g. Organic vs Paid Marketing" className="w-full h-10 rounded-lg border border-foreground-200/60 bg-white px-3 text-sm outline-none focus:border-primary-400" />
                  <div className="rounded-xl border border-[#d8dde6] bg-white overflow-hidden">
                    <div className="flex items-center justify-between gap-3 border-b border-[#e2e8f0] bg-[#f8fafc] px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-wide text-[#5b2dbb]">Embedded AI prompt</p>
                        <p className="text-[11px] text-[#647083]">This prompt is applied with the system rules. Customize it when you need extra guidance.</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {showPromptCustomize && (
                          <button
                            type="button"
                            onClick={() => setGeneratorForm({ ...generatorForm, customInstructions: embeddedAiPromptPreview })}
                            className="h-8 px-3 rounded-lg bg-white border border-[#d8dde6] text-[#526173] text-xs font-semibold hover:bg-[#f8fafc]"
                          >
                            Reset
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowPromptCustomize(prev => !prev)}
                          className="h-8 px-3 rounded-lg bg-[#5b2dbb] text-white text-xs font-semibold hover:bg-[#4c1d95]"
                        >
                          <i className={showPromptCustomize ? 'ri-check-line mr-1' : 'ri-edit-line mr-1'}></i>{showPromptCustomize ? 'Done' : 'Customize'}
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={generatorForm.customInstructions}
                      readOnly={!showPromptCustomize}
                      onChange={event => setGeneratorForm({ ...generatorForm, customInstructions: event.target.value })}
                      className={`w-full min-h-40 resize-y p-3 text-xs leading-5 outline-none transition-smooth ${showPromptCustomize ? 'bg-white text-[#111827] focus:ring-2 focus:ring-inset focus:ring-[#ede9fe]' : 'bg-[#fbfcff] text-[#475569]'}`}
                    />
                  </div>
                  <textarea
                    value={generatorForm.lessonContent}
                    onChange={event => setGeneratorForm({ ...generatorForm, lessonContent: event.target.value })}
                    placeholder="Paste lesson text here, or upload TXT/CSV/XML/XLSX/PPTX/PDF/DOCX/SCORM ZIP files below."
                    className="w-full min-h-32 rounded-lg border border-foreground-200/60 bg-white p-3 text-sm leading-relaxed outline-none focus:border-primary-400"
                  />
                  <button
                    type="button"
                    onClick={() => generatorFileInputRef.current?.click()}
                    onDragEnter={event => {
                      event.preventDefault();
                      setGeneratorDragActive(true);
                    }}
                    onDragOver={event => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'copy';
                      setGeneratorDragActive(true);
                    }}
                    onDragLeave={event => {
                      event.preventDefault();
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setGeneratorDragActive(false);
                    }}
                    onDrop={event => {
                      event.preventDefault();
                      setGeneratorDragActive(false);
                      selectGeneratorFiles(Array.from(event.dataTransfer.files ?? []));
                    }}
                    className={`w-full min-h-24 rounded-xl border border-dashed px-4 py-4 text-sm font-semibold transition-smooth flex flex-col items-center justify-center gap-2 text-center ${
                      generatorDragActive
                        ? 'border-primary-500 bg-primary-50 text-primary-700 ring-2 ring-primary-100'
                        : generatorFiles.length
                          ? 'border-primary-300 bg-[#f7f2ff] text-primary-700 hover:bg-primary-50'
                          : 'border-foreground-200/80 bg-background-100 text-foreground-700 hover:border-primary-300 hover:bg-primary-50'
                    }`}
                  >
                    <span className="w-10 h-10 rounded-xl bg-white border border-foreground-200/60 flex items-center justify-center text-lg">
                      <i className={generatorDragActive ? 'ri-upload-cloud-2-line' : 'ri-file-upload-line'}></i>
                    </span>
                    <span className="max-w-full truncate">
                      {generatorFiles.length === 0
                        ? 'Drop source files here or choose files'
                        : generatorFiles.length === 1
                          ? generatorFiles[0].name
                          : `${generatorFiles.length} files selected`}
                    </span>
                    {generatorFiles.length > 1 && (
                      <span className="max-w-full text-[11px] font-medium text-primary-700 truncate">
                        {generatorFiles.map(file => file.name).join(', ')}
                      </span>
                    )}
                    <span className="text-[11px] font-medium text-foreground-400">TXT, CSV, XML, Excel, PowerPoint, PDF, DOCX or SCORM ZIP</span>
                  </button>
                  <button type="button" onClick={() => void generateQuestions()} disabled={generatingQuestions} className="w-full h-11 rounded-lg bg-[#0f172a] text-white text-sm font-semibold hover:bg-[#111827] disabled:opacity-50 disabled:cursor-wait">
                    {generatingQuestions ? 'Generating...' : 'Generate preview'}
                  </button>
                </section>

                <section className="min-w-0 min-h-[420px] max-h-[calc(92vh-150px)] rounded-2xl border border-[#dbe3ee] bg-[#f8fafc] p-3 sm:p-4 flex flex-col overflow-hidden">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 shrink-0 rounded-xl bg-white border border-[#e2e8f0] px-4 py-3 shadow-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center shrink-0">
                          <i className="ri-eye-line"></i>
                        </span>
                        <div className="min-w-0">
                          <h4 className="text-sm font-heading font-bold text-[#0f172a]">Preview</h4>
                          <p className="text-xs text-[#64748b]">{generatedQuestions.length ? `${generatedQuestions.length} generated questions` : 'Generated questions will appear here.'}</p>
                        </div>
                      </div>
                    </div>
                    <button onClick={() => void saveGeneratedQuiz()} disabled={!generatedQuestions.length || savingGeneratedQuiz} className="h-10 sm:h-9 px-4 rounded-lg bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 w-full sm:w-auto">
                      {savingGeneratedQuiz ? 'Saving...' : 'Save as quiz'}
                    </button>
                  </div>

                  {generatedQuestions.length === 0 ? (
                    <div className="min-h-80 flex flex-col items-center justify-center text-center">
                      <span className="w-12 h-12 rounded-2xl bg-white border border-foreground-200/60 flex items-center justify-center text-foreground-300 mb-3">
                        <i className="ri-sparkling-2-line text-xl"></i>
                      </span>
                      <p className="text-sm font-semibold text-foreground-700">No generated questions yet</p>
                      <p className="text-xs text-foreground-400 mt-1 max-w-sm">Add a topic, paste lesson content, or upload source files, then generate a preview.</p>
                    </div>
                  ) : (
                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden quiz-preview-scroll pr-1">
                      {generatedQuestions.map((question, questionIndex) => (
                        <div key={question.id} className="min-w-0 rounded-2xl border border-[#dbe3ee] bg-white p-4 sm:p-5 overflow-hidden shadow-sm">
                          <div className="flex items-start gap-3 sm:gap-4 mb-5 min-w-0">
                            <span className="w-10 h-10 rounded-xl bg-[#f2edff] text-[#5b21b6] border border-[#ded2ff] flex items-center justify-center text-sm font-bold shrink-0">{questionIndex + 1}</span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2">
                                <p className="text-[15px] sm:text-base font-semibold text-[#0f172a] leading-7 break-words [overflow-wrap:anywhere]">{question.text}</p>
                                <span className="w-fit text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-lg bg-[#e8eef5] text-[#526173] shrink-0">
                                  {questionTypeOptions.find(option => option.value === question.questionType)?.label}
                                </span>
                              </div>
                            </div>
                          </div>
                          <QuestionAnswersView type={question.questionType} answers={question.answers} fallbackText={question.explanation} className="pl-0 sm:pl-14" />
                          {question.explanation && (
                            <div className="mt-5 sm:ml-14 rounded-xl border border-[#ddd2ff] bg-[#fbf9ff] px-4 py-3.5">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-[#6d5aa8] mb-1">Feedback</p>
                              <p className="text-sm text-[#3f2f73] leading-6 break-words [overflow-wrap:anywhere]">{question.explanation}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        )}

        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={resetModal}>
            <form onSubmit={submitQuiz} className="w-full max-w-xl bg-background-50 rounded-2xl border border-foreground-200/60 shadow-xl p-5" onClick={event => event.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-heading font-bold text-foreground-900">Add Quiz Package</h3>
                <button type="button" onClick={resetModal} disabled={savingQuiz} className="w-8 h-8 rounded-lg bg-background-100 hover:bg-background-200 disabled:cursor-not-allowed disabled:opacity-50"><i className="ri-close-line"></i></button>
              </div>
              {uploadFile && (
                <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-700 flex items-center gap-2 min-w-0">
                  <i className="ri-file-upload-line shrink-0"></i>
                  <span className="truncate min-w-0" title={`${uploadFile.name} ready to upload`}>{uploadFile.name} ready to upload</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Quiz title" className="sm:col-span-2 h-10 rounded-lg border border-foreground-200/60 px-3 text-sm" />
                <ThemedSelect
                  value={form.questionType}
                  options={questionTypeOptions}
                  onChange={questionType => setForm({ ...form, questionType })}
                  className="sm:col-span-2"
                />
                <ThemedSelect
                  value={form.programme}
                  options={programmeOptions}
                  onChange={programme => setForm({ ...form, programme, module: '', programmeId: '' })}
                  menuClassName="max-h-56"
                />
                <ThemedSelect
                  value={form.module}
                  options={moduleOptions}
                  onChange={module => {
                    const selectedModule = moduleOptions.find(option => option.value === module);
                    setForm({ ...form, module, programmeId: selectedModule?.programmeId ? String(selectedModule.programmeId) : '' });
                  }}
                  disabled={!form.programme}
                  menuClassName="max-h-56"
                />
                <input
                  value={form.week}
                  onChange={e => setForm({ ...form, week: e.target.value })}
                  placeholder="Week, e.g. Week 9"
                  className="h-10 rounded-lg border border-foreground-200/60 px-3 text-sm"
                />
                <input value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} placeholder="Version" className="h-10 rounded-lg border border-foreground-200/60 px-3 text-sm" />
                <input type="number" min="0" value={form.questions} onChange={e => setForm({ ...form, questions: e.target.value })} placeholder="Questions" className="h-10 rounded-lg border border-foreground-200/60 px-3 text-sm" />
                <input value={form.author} onChange={e => setForm({ ...form, author: e.target.value })} placeholder="Author" className="h-10 rounded-lg border border-foreground-200/60 px-3 text-sm" />
                <ThemedSelect
                  value={form.status}
                  options={editableStatusOptions}
                  onChange={status => setForm({ ...form, status })}
                />
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" disabled={savingQuiz} onClick={() => fileInputRef.current?.click()} className="px-4 py-2 rounded-lg bg-background-100 text-sm font-semibold hover:bg-background-200 disabled:cursor-not-allowed disabled:opacity-60">Choose XML, SCORM or Excel/CSV</button>
                <button type="submit" disabled={savingQuiz} className="inline-flex min-w-28 items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 disabled:cursor-wait disabled:opacity-70">
                  {savingQuiz && <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true"></span>}
                  {savingQuiz ? 'Saving...' : 'Save Quiz'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
=======
      </div>
    </WorkspaceShell>
  );
}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
