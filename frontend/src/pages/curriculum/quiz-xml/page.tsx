import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { ThemedSelect } from '@/components/feature/ThemedSelect';
import { ImageMatchingPairFields } from '@/components/feature/ImageMatchingPairFields';
import { QuestionAnswersView } from '@/components/feature/QuestionTypeRenderer';
import { roleNavMap } from '@/mocks/navigation';
import { kbcUsers } from '@/mocks/users';
import { useToast } from '@/hooks/useToast';
import { fetchWeeks, type WeekItem } from '@/api/curriculum';
import { formatQuizGradeRange, type QuizGradeRow, type QuizGradeSettings, useQuizGradeSettings } from '@/lib/quizGradeSettings';
import { type QuizGeneralSettings, useQuizGeneralSettings } from '@/lib/quizGeneralSettings';
import { convertAnswerTextForQuestionType, isPairAnswerComplete, parseQuizPairAnswer, serializeQuizPairAnswer } from '@/lib/quizPairAnswers';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';

const curriculumNav = roleNavMap.curriculum;

type QuizStatus = 'published' | 'pending' | 'draft' | 'trash' | 'private' | 'validating';
type PackageType = 'xml' | 'scorm' | 'excel' | 'csv' | 'file';
type QuestionType = 'single_choice' | 'multiple_choice' | 'true_false' | 'matching' | 'image_matching' | 'keywords' | 'fill_gap' | 'ordering';
type DateFilterPreset = 'all' | 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_year' | 'last_year' | 'custom';

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

const dateFilterPresets: { value: DateFilterPreset; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This Week' },
  { value: 'last_week', label: 'Last Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_year', label: 'This Year' },
  { value: 'last_year', label: 'Last Year' },
];

function parseStatusParam(value: string | null): 'all' | QuizStatus {
  if (value === 'archive') return 'trash';
  return statusOptions.some(option => option.value === value) ? value as 'all' | QuizStatus : 'all';
}

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
  fileName: string;
  fileSize: number;
  displaySize: string;
  schemaValid: boolean;
  validationMessage: string;
  mappedComponents: number;
  weekId?: string;
  author: string;
  linkedCourses: number;
  linkedGroups?: number;
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

interface QuizStudentQuestionResult {
  number: number;
  text: string;
  type: string;
  chosenAnswer: string | null;
  correctAnswer: string | null;
  correct: boolean;
  earned: number | null;
  possible: number | null;
}

interface QuizStudentAttempt {
  attempt: number | null;
  grade: string;
  gradePercent: number | null;
  score: string;
  passed: boolean;
  submittedAt: string;
  startedAt: string;
  timeTaken: string;
  reportedTime: string;
  week: string;
  module: string;
  feedback: string;
  ksbs: string[];
  questions: QuizStudentQuestionResult[];
}

interface QuizStudentResult {
  id: number;
  name: string;
  email: string;
  programme: string;
  cohort: string;
  group: string;
  attemptCount: number;
  bestGrade: number | null;
  latestAttempt: QuizStudentAttempt;
  attempts: QuizStudentAttempt[];
}

interface QuizStudentResultsData {
  quiz: QuizPackage;
  summary: {
    students: number;
    attempts: number;
    passed: number;
    averageBest: number | null;
  };
  students: QuizStudentResult[];
}

interface QuizCourseLinkOption {
  id: string;
  componentId?: string;
  label: string;
  programme: string;
  programmeId?: string;
  module: string;
  moduleCatalogueId?: string;
  component?: string;
  componentType?: string;
  weekId?: string;
  week?: string | number;
  cohort: string;
  group?: string;
  groups?: string[];
  source?: string;
  context?: string;
  startDate: string;
  selected: boolean;
}

interface QuizCourseLinksData {
  programme: string;
  linkType?: string;
  selectedIds: string[];
  courses: QuizCourseLinkOption[];
  quiz: QuizPackage;
}

interface QuizFormState {
  title: string;
  module: string;
  programme: string;
  programmeId: string;
  week: string;
  weekId: string;
  version: string;
  questions: string;
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
  weekId: string;
  questionCount: string;
  author: string;
}

interface CurriculumModuleOption {
  value: string;
  label: string;
  programmeId: string;
  moduleId?: string;
  moduleCatalogueId?: string;
}

interface CurriculumModuleOptions {
  programmes: { value: string; label: string }[];
  modulesByProgramme: Record<string, CurriculumModuleOption[]>;
}

type WeekLoadState = 'idle' | 'loading' | 'ready' | 'error';

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
  weekId: '',
  version: 'v1.0',
  questions: '',
  status: 'draft',
  author: 'Curriculum Team',
  linkedCourses: '0',
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

function isAlwaysCorrectType(type: QuestionType) {
  return ['ordering', 'matching', 'image_matching', 'keywords', 'fill_gap'].includes(type);
}

function normalizeAnswersForQuestionType(answers: QuizPreviewQuestion['answers'], type: QuestionType): QuizPreviewQuestion['answers'] {
  const fallbackId = -Date.now();
  const nextAnswers = answers.length ? [...answers] : [{ id: fallbackId, text: '', isCorrect: true }];

  if (type === 'true_false') {
    const correctText = nextAnswers.find(answer => answer.isCorrect)?.text.toLowerCase() || '';
    const trueAnswer = nextAnswers.find(answer => answer.text.toLowerCase().trim() === 'true') || nextAnswers[0] || { id: fallbackId, text: 'True', isCorrect: true };
    const falseAnswer = nextAnswers.find(answer => answer.text.toLowerCase().trim() === 'false') || nextAnswers[1] || { id: fallbackId - 1, text: 'False', isCorrect: false };
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

function createManualQuestion(order: number, questionType: QuestionType = 'single_choice'): QuizPreviewQuestion {
  const questionId = -Date.now() - order;
  const baseAnswerId = questionId * 10;

  return {
    id: questionId,
    text: '',
    questionType,
    explanation: '',
    answers: normalizeAnswersForQuestionType([
      { id: baseAnswerId - 1, text: '', isCorrect: true },
      { id: baseAnswerId - 2, text: '', isCorrect: false },
      { id: baseAnswerId - 3, text: '', isCorrect: false },
      { id: baseAnswerId - 4, text: '', isCorrect: false },
    ], questionType),
  };
}

function answerEditorCopy(type: QuestionType) {
  if (type === 'multiple_choice') return { title: 'Answer choices', hint: 'Tick every option that should be accepted as correct.', addLabel: 'Add option' };
  if (type === 'true_false') return { title: 'True/False answers', hint: 'Choose whether True or False is the correct answer.', addLabel: 'Add option' };
  if (type === 'matching') return { title: 'Matching pairs', hint: 'Write each pair as a left prompt and a matching answer.', addLabel: 'Add pair' };
  if (type === 'image_matching') return { title: 'Image matching pairs', hint: 'Upload each image and enter the answer it should match.', addLabel: 'Add match' };
  if (type === 'keywords') return { title: 'Accepted keywords', hint: 'Every row is treated as an accepted keyword or phrase.', addLabel: 'Add keyword' };
  if (type === 'fill_gap') return { title: 'Accepted gap answers', hint: 'Every row is treated as an accepted answer for the blank.', addLabel: 'Add answer' };
  if (type === 'ordering') return { title: 'Correct order', hint: 'Add the steps in the correct sequence.', addLabel: 'Add step' };
  return { title: 'Answer choices', hint: 'Choose the one best correct answer.', addLabel: 'Add option' };
}

function QuizRowActions({
  quiz,
  previewLoadingId,
  editorLoadingId,
  studentsLoadingId,
  onRestore,
  onPreview,
  onEdit,
  onManageStudents,
}: {
  quiz: QuizPackage;
  previewLoadingId: number | null;
  editorLoadingId: number | null;
  studentsLoadingId: number | null;
  onRestore: () => void;
  onPreview: () => void;
  onEdit: () => void;
  onManageStudents: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {quiz.status === 'trash' && (
        <button
          type="button"
          onClick={onRestore}
          className="inline-flex w-9 h-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-smooth"
          title="Restore to quizzes"
        >
          <AppIcon className="ri-arrow-go-back-line"></AppIcon>
        </button>
      )}
      <button
        type="button"
        onClick={onPreview}
        className="inline-flex w-9 h-9 items-center justify-center rounded-lg bg-background-100 text-foreground-600 hover:bg-primary-100 hover:text-primary-600 transition-smooth"
        title="Student preview"
      >
        <AppIcon className={`${previewLoadingId === quiz.id ? 'ri-loader-4-line animate-spin' : 'ri-eye-line'} text-[16px]`}></AppIcon>
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex w-9 h-9 items-center justify-center rounded-lg bg-background-100 text-foreground-600 hover:bg-primary-100 hover:text-primary-600 transition-smooth"
        title="Review questions"
      >
        <AppIcon className={`${editorLoadingId === quiz.id ? 'ri-loader-4-line animate-spin' : 'ri-pencil-line'} text-[16px]`}></AppIcon>
      </button>
      <button
        type="button"
        onClick={onManageStudents}
        className="inline-flex w-9 h-9 items-center justify-center rounded-lg bg-background-100 text-foreground-600 hover:bg-primary-100 hover:text-primary-600 transition-smooth"
        title="Manage students"
      >
        <AppIcon className={`${studentsLoadingId === quiz.id ? 'ri-loader-4-line animate-spin' : 'ri-team-line'} text-[16px]`}></AppIcon>
      </button>
      <a href={`/quiz_api/quizzes/${quiz.id}/download/`} className="inline-flex w-9 h-9 items-center justify-center rounded-lg bg-background-100 text-foreground-600 hover:bg-primary-100 hover:text-primary-600 transition-smooth" title="Download">
        <AppIcon className="ri-download-line text-[16px]"></AppIcon>
      </a>
    </div>
  );
}

function GradeSettingsModal({
  settings,
  onChange,
  onClose,
  onSaved,
}: {
  settings: QuizGradeSettings;
  onChange: (settings: QuizGradeSettings) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [newGrade, setNewGrade] = useState({ grade: '', point: '', min: '', color: '#1d7df2' });
  const [draggedGradeKey, setDraggedGradeKey] = useState<string | null>(null);
  const [dragOverGradeKey, setDragOverGradeKey] = useState<string | null>(null);

  const gradeRowKey = (row: QuizGradeRow) => `${row.grade}-${row.min}-${row.point}`;

  const updateSettings = (patch: Partial<QuizGradeSettings>) => {
    onChange({ ...settings, ...patch });
  };

  const deleteRow = (row: QuizGradeRow) => {
    const nextRows = settings.rows.filter(item => !(item.grade === row.grade && item.min === row.min && item.point === row.point));
    if (!nextRows.length) return;
    onChange({ ...settings, rows: nextRows });
    onSaved();
  };

  const confirmDeleteRow = async (row: QuizGradeRow) => {
    await showCurriculumConfirm({
      title: `Delete ${row.grade} grade?`,
      text: `Are you sure you want to delete the ${row.grade} grade from the default quiz grades table?`,
      icon: 'warning',
      confirmButtonText: 'Delete grade',
      onConfirm: () => deleteRow(row),
    });
  };

  const addRow = () => {
    const grade = newGrade.grade.trim();
    const point = Number(newGrade.point);
    const min = Math.round(Number(newGrade.min));
    if (!grade || !Number.isFinite(point) || !Number.isFinite(min)) return;
    onChange({
      ...settings,
      rows: [
        ...settings.rows,
        {
          grade,
          point,
          min: Math.max(0, Math.min(100, min)),
          color: newGrade.color,
        },
      ],
    });
    setNewGrade({ grade: '', point: '', min: '', color: '#1d7df2' });
    onSaved();
  };

  const moveGradeRow = (sourceIndex: number, targetIndex: number, notify = true) => {
    if (sourceIndex === targetIndex) return;
    const nextRows = [...settings.rows];
    const [moved] = nextRows.splice(sourceIndex, 1);
    nextRows.splice(targetIndex, 0, moved);
    onChange({ ...settings, rows: nextRows });
    if (notify) onSaved();
  };

  const moveDraggedGradeOver = (targetIndex: number) => {
    if (!draggedGradeKey) return;
    const sourceIndex = settings.rows.findIndex(row => gradeRowKey(row) === draggedGradeKey);
    if (sourceIndex === -1 || sourceIndex === targetIndex) return;
    moveGradeRow(sourceIndex, targetIndex, false);
  };

  const finishGradeDrag = () => {
    if (draggedGradeKey) onSaved();
    setDraggedGradeKey(null);
    setDragOverGradeKey(null);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:p-6" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-2xl bg-[#eef3f6] p-5 sm:p-6 shadow-2xl border border-white/70" onClick={event => event.stopPropagation()}>
        <div className="mb-6 flex items-center justify-between gap-4">
          <h3 className="text-2xl font-heading font-bold text-[#10233d]">Grades Settings</h3>
          <button type="button" onClick={onClose} className="h-9 w-9 rounded-full bg-white text-[#64748b] hover:bg-[#e2e8f0]">
            <AppIcon className="ri-close-line text-lg"></AppIcon>
          </button>
        </div>

        <div className="space-y-3">
          <GradeSettingRow title="Result display" subtitle="Select the format to display scores to student">
            <ThemedSelect
              value={settings.resultDisplay}
              options={[
                { value: 'grade', label: 'Grade' },
                { value: 'percentage', label: 'Percentage' },
                { value: 'points', label: 'Points' },
                { value: 'grade_percentage', label: 'Grade and percentage' },
              ]}
              onChange={resultDisplay => {
                updateSettings({ resultDisplay });
                onSaved();
              }}
              buttonClassName="h-9 bg-[#f8fafc]"
            />
          </GradeSettingRow>

          <GradeSettingRow title="Score Separator" subtitle="Choose the symbol or text to separate the score from the maximum value">
            <input
              value={settings.scoreSeparator}
              onChange={event => updateSettings({ scoreSeparator: event.target.value })}
              onBlur={onSaved}
              className="h-9 w-full rounded-md border border-[#b9c4d1] bg-[#f8fafc] px-3 text-sm outline-none focus:border-[#5b2dbb] focus:ring-2 focus:ring-[#ede9fe]"
            />
          </GradeSettingRow>

          <GradeSettingRow title="Grades Display on Course Page" subtitle="Select how grades will be shown">
            <ThemedSelect
              value={settings.coursePageDisplay}
              options={[
                { value: 'separate_tab', label: 'Show as separate tab' },
                { value: 'inside_quiz', label: 'Show inside quiz settings' },
                { value: 'hidden', label: 'Hidden from course page' },
              ]}
              onChange={coursePageDisplay => {
                updateSettings({ coursePageDisplay });
                onSaved();
              }}
              buttonClassName="h-9 bg-[#f8fafc]"
            />
          </GradeSettingRow>

          <section className="rounded-lg bg-white px-4 py-5">
            <h4 className="mb-3 text-2xl font-heading font-bold text-[#0f172a]">Grades Table</h4>
            <div className="overflow-hidden rounded border border-[#d5deea]">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[#d5deea] bg-white">
                    <th className="w-10 px-3 py-3 text-xs font-bold text-[#0f172a]"></th>
                    <th className="px-4 py-3 text-xs font-bold text-[#0f172a]">Grade name</th>
                    <th className="px-4 py-3 text-xs font-bold text-[#0f172a]">Grade point</th>
                    <th className="px-4 py-3 text-xs font-bold text-[#0f172a]">Grade range</th>
                    <th className="w-16 px-4 py-3 text-xs font-bold text-[#0f172a]"></th>
                  </tr>
                </thead>
                <tbody>
                  {settings.rows.map((row, index) => (
                    <tr
                      key={gradeRowKey(row)}
                      draggable
                      onDragStart={event => {
                        setDraggedGradeKey(gradeRowKey(row));
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', gradeRowKey(row));
                      }}
                      onDragOver={event => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                        setDragOverGradeKey(gradeRowKey(row));
                        moveDraggedGradeOver(index);
                      }}
                      onDragLeave={() => setDragOverGradeKey(current => current === gradeRowKey(row) ? null : current)}
                      onDrop={event => {
                        event.preventDefault();
                        finishGradeDrag();
                      }}
                      onDragEnd={finishGradeDrag}
                      className={`border-b border-[#d5deea] transition-smooth last:border-b-0 ${draggedGradeKey === gradeRowKey(row) ? 'opacity-50' : ''} ${dragOverGradeKey === gradeRowKey(row) && draggedGradeKey !== gradeRowKey(row) ? 'bg-[#f4f0ff] ring-2 ring-inset ring-[#c4b5fd]' : 'bg-white'}`}
                    >
                      <td className="px-3 py-2.5">
                        <span className="flex h-8 w-8 cursor-grab items-center justify-center rounded bg-[#f1f5f9] text-[#94a3b8] active:cursor-grabbing" title="Drag to reorder">
                          <AppIcon className="ri-draggable text-sm"></AppIcon>
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex min-w-9 items-center justify-center rounded-full px-2.5 py-1 text-sm font-bold text-white" style={{ backgroundColor: row.color }}>{row.grade}</span>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-[#0f172a]">{row.point}</td>
                      <td className="px-4 py-2.5 text-sm text-[#0f172a]">{formatQuizGradeRange(settings.rows, index)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button type="button" onClick={() => void confirmDeleteRow(row)} className="h-9 w-9 rounded bg-red-50 text-red-500 hover:bg-red-100" title={`Delete ${row.grade}`}>
                          <AppIcon className="ri-delete-bin-fill"></AppIcon>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:items-end">
              <GradeAddField label="Grade name">
                <input value={newGrade.grade} onChange={event => setNewGrade({ ...newGrade, grade: event.target.value })} placeholder="A+" className="h-10 w-full rounded border border-[#b9c4d1] bg-[#f8fafc] px-3 text-sm outline-none focus:border-[#5b2dbb]" />
              </GradeAddField>
              <GradeAddField label="Grade point">
                <input value={newGrade.point} onChange={event => setNewGrade({ ...newGrade, point: event.target.value })} placeholder="1" type="number" step="0.1" className="h-10 w-full rounded border border-[#b9c4d1] bg-[#f8fafc] px-3 text-sm outline-none focus:border-[#5b2dbb]" />
              </GradeAddField>
              <GradeAddField label="Grade range min, %">
                <input value={newGrade.min} onChange={event => setNewGrade({ ...newGrade, min: event.target.value })} placeholder="20%" type="number" min="0" max="100" className="h-10 w-full rounded border border-[#b9c4d1] bg-[#f8fafc] px-3 text-sm outline-none focus:border-[#5b2dbb]" />
              </GradeAddField>
              <GradeAddField label="Color">
                <div className="flex h-10 items-center gap-2 rounded border border-[#b9c4d1] bg-[#f8fafc] px-2">
                  <input value={newGrade.color} onChange={event => setNewGrade({ ...newGrade, color: event.target.value })} type="color" className="h-7 w-8 rounded border border-[#cbd5e1] bg-white p-0" />
                  <span className="min-w-0 truncate text-xs text-[#94a3b8]">{newGrade.color}</span>
                </div>
              </GradeAddField>
              <button type="button" onClick={addRow} disabled={!newGrade.grade.trim() || !newGrade.point || !newGrade.min} className="h-10 rounded-md bg-[#1f6fed] px-5 text-sm font-bold text-white hover:bg-[#1858c7] disabled:opacity-45 disabled:cursor-not-allowed">
                Add
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function GradeSettingRow({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-3 rounded-lg bg-white px-4 py-4 md:grid-cols-[280px_1fr] md:items-center">
      <div>
        <p className="text-sm font-semibold text-[#0f172a]">{title}</p>
        <p className="mt-2 text-xs text-[#7b8aa0]">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function GradeAddField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold text-[#0f172a]">{label}</span>
      {children}
    </label>
  );
}

function GeneralQuizSettingsModal({
  settings,
  onChange,
  onClose,
  onSaved,
}: {
  settings: QuizGeneralSettings;
  onChange: (settings: QuizGeneralSettings) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const updateSettings = (patch: Partial<QuizGeneralSettings>) => onChange({ ...settings, ...patch });
  const saveAndClose = () => {
    onSaved();
    onClose();
  };
  const SettingSwitch = ({ checked, onToggle }: { checked: boolean; onToggle: (checked: boolean) => void }) => (
    <button
      type="button"
      onClick={() => onToggle(!checked)}
      className={`h-7 w-12 rounded-full p-1 transition-smooth flex items-center ${checked ? 'bg-primary-500' : 'bg-foreground-200'}`}
      aria-pressed={checked}
    >
      <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:p-6" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-2xl bg-background-50 p-5 sm:p-6 shadow-2xl border border-foreground-200/60" onClick={event => event.stopPropagation()}>
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-primary-600 mb-1">General Quiz Settings</p>
            <h3 className="text-2xl font-heading font-bold text-foreground-900">Quiz</h3>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative w-full sm:w-72">
              <input placeholder="Search..." className="h-10 w-full rounded-full border border-foreground-200/70 bg-white px-4 pr-10 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
              <AppIcon className="ri-search-line absolute right-3 top-1/2 -translate-y-1/2 text-foreground-400"></AppIcon>
            </div>
            <button type="button" onClick={saveAndClose} className="h-10 px-5 rounded-lg bg-primary-500 text-white text-sm font-bold hover:bg-primary-600 transition-smooth">
              Save Settings
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <GradeSettingRow title="Attempts to retake quizzes" subtitle="Choose limited or unlimited attempts for students to retake quizzes.">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-2">
              <ThemedSelect
                value={settings.attemptMode}
                options={[
                  { value: 'unlimited', label: 'Unlimited attempts' },
                  { value: 'limited', label: 'Limited attempts' },
                ]}
                onChange={attemptMode => updateSettings({ attemptMode })}
                buttonClassName="h-10"
              />
              <input
                type="number"
                min="1"
                max="20"
                value={settings.attemptLimit}
                onChange={event => updateSettings({ attemptLimit: Number(event.target.value || 1) })}
                disabled={settings.attemptMode === 'unlimited'}
                className="h-10 rounded-lg border border-foreground-200/70 bg-white px-3 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:bg-background-100 disabled:text-foreground-300"
                title="Attempt limit"
              />
            </div>
          </GradeSettingRow>

          <GradeSettingRow title="Quiz Attempt History" subtitle="Let students view their past quiz attempts in the course player.">
            <div className="flex items-center gap-3">
              <SettingSwitch checked={settings.attemptHistory} onToggle={attemptHistory => updateSettings({ attemptHistory })} />
              <span className={`text-xs font-bold ${settings.attemptHistory ? 'text-primary-600' : 'text-foreground-400'}`}>{settings.attemptHistory ? 'On' : 'Off'}</span>
            </div>
          </GradeSettingRow>

          <GradeSettingRow title="Retake After Passing" subtitle="Allow students to retake the quiz even after passing.">
            <div className="flex items-center gap-3">
              <SettingSwitch checked={settings.retakeAfterPass} onToggle={retakeAfterPass => updateSettings({ retakeAfterPass })} />
              <span className={`text-xs font-bold ${settings.retakeAfterPass ? 'text-primary-600' : 'text-foreground-400'}`}>{settings.retakeAfterPass ? 'On' : 'Off'}</span>
            </div>
          </GradeSettingRow>

          <GradeSettingRow title="Quiz style" subtitle="Choose how quizzes are shown to learners.">
            <ThemedSelect
              value={settings.quizStyle}
              options={[
                { value: 'default', label: 'Default' },
                { value: 'pagination', label: 'Pagination' },
                { value: 'global', label: 'Global' },
              ]}
              onChange={quizStyle => updateSettings({ quizStyle })}
              buttonClassName="h-10"
            />
          </GradeSettingRow>
        </div>
      </div>
    </div>
  );
}

const emptyGeneratorForm: AiGeneratorState = {
  title: '',
  topic: '',
  lessonContent: '',
  customInstructions: embeddedAiPromptPreview,
  programme: '',
  module: '',
  programmeId: '',
  week: '',
  weekId: '',
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

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateRangeForPreset(preset: DateFilterPreset, base = new Date()) {
  const today = startOfDay(base);
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const thisWeekStart = addDays(today, mondayOffset);
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const thisYearStart = new Date(today.getFullYear(), 0, 1);

  if (preset === 'today') return { start: today, end: endOfDay(today) };
  if (preset === 'yesterday') {
    const yesterday = addDays(today, -1);
    return { start: yesterday, end: endOfDay(yesterday) };
  }
  if (preset === 'this_week') return { start: thisWeekStart, end: endOfDay(addDays(thisWeekStart, 6)) };
  if (preset === 'last_week') {
    const start = addDays(thisWeekStart, -7);
    return { start, end: endOfDay(addDays(start, 6)) };
  }
  if (preset === 'this_month') return { start: thisMonthStart, end: endOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0)) };
  if (preset === 'last_month') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return { start, end: endOfDay(new Date(today.getFullYear(), today.getMonth(), 0)) };
  }
  if (preset === 'this_year') return { start: thisYearStart, end: endOfDay(new Date(today.getFullYear(), 11, 31)) };
  if (preset === 'last_year') {
    const start = new Date(today.getFullYear() - 1, 0, 1);
    return { start, end: endOfDay(new Date(today.getFullYear() - 1, 11, 31)) };
  }
  return { start: null, end: null };
}

function compactDate(value: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(value);
}

function monthCalendarDays(viewDate: Date) {
  const firstOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const startOffset = firstOfMonth.getDay();
  const gridStart = addDays(firstOfMonth, -startOffset);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function statusClasses(status: QuizStatus) {
  if (status === 'published') return 'bg-emerald-100 text-emerald-700';
  if (status === 'pending' || status === 'validating') return 'bg-amber-100 text-amber-700';
  if (status === 'trash') return 'bg-red-100 text-red-700';
  if (status === 'private') return 'bg-sky-100 text-sky-700';
  if (status === 'draft') return 'bg-foreground-100 text-foreground-600';
  return 'bg-foreground-100 text-foreground-600';
}

function statusLabel(status: QuizStatus | 'all') {
  if (status === 'validating') return 'Pending';
  return statusOptions.find(option => option.value === status)?.label || status;
}

// The workspace "Linked" column shows both the team's original linked-course
// count and the newer assigned-groups count, e.g. "1 course · 22 groups". The
// group half is omitted when the backend hasn't computed it (older payloads).
function formatLinkedSummary(courses: number, groups?: number) {
  const courseText = `${courses} module${courses === 1 ? '' : 's'}`;
  if (typeof groups !== 'number') return courseText;
  return `${courseText} · ${groups} group${groups === 1 ? '' : 's'}`;
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
  const [dateFilterPreset, setDateFilterPreset] = useState<DateFilterPreset>('all');
  const [customDateRange, setCustomDateRange] = useState<{ start: Date | null; end: Date | null }>({ start: null, end: null });
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [calendarViewDate, setCalendarViewDate] = useState(() => new Date());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState('10');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showManualCreate, setShowManualCreate] = useState(false);
  const [showGradeSettings, setShowGradeSettings] = useState(false);
  const [showGeneralSettings, setShowGeneralSettings] = useState(false);
  const [form, setForm] = useState<QuizFormState>(emptyForm);
  const [savingQuiz, setSavingQuiz] = useState(false);
  const [savingManualQuiz, setSavingManualQuiz] = useState(false);
  const [manualQuestions, setManualQuestions] = useState<QuizPreviewQuestion[]>(() => [createManualQuestion(1)]);
  const [openManualQuestionId, setOpenManualQuestionId] = useState<number | null>(null);
  const [gradeSettings, setGradeSettings] = useQuizGradeSettings();
  const [generalSettings, setGeneralSettings] = useQuizGeneralSettings();
  const [trainingPlanOptions, setTrainingPlanOptions] = useState<CurriculumModuleOptions>({ programmes: [], modulesByProgramme: {} });
  const [formWeeks, setFormWeeks] = useState<WeekItem[]>([]);
  const [formWeeksState, setFormWeeksState] = useState<WeekLoadState>('idle');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<QuizPreviewData | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);
  const [studentResultsData, setStudentResultsData] = useState<QuizStudentResultsData | null>(null);
  const [studentResultsLoadingId, setStudentResultsLoadingId] = useState<number | null>(null);
  const [activeStudentId, setActiveStudentId] = useState<number | null>(null);
  const [activeAttemptIndex, setActiveAttemptIndex] = useState(0);
  const [courseLinksData, setCourseLinksData] = useState<QuizCourseLinksData | null>(null);
  const [courseLinksLoadingId, setCourseLinksLoadingId] = useState<number | null>(null);
  const [editorData, setEditorData] = useState<QuizPreviewData | null>(null);
  const [editorLoadingId, setEditorLoadingId] = useState<number | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<number | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorBaseline, setEditorBaseline] = useState('');
  const [showGenerator, setShowGenerator] = useState(false);
  const [generatorForm, setGeneratorForm] = useState<AiGeneratorState>(emptyGeneratorForm);
  const [generatorWeeks, setGeneratorWeeks] = useState<WeekItem[]>([]);
  const [generatorWeeksState, setGeneratorWeeksState] = useState<WeekLoadState>('idle');
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
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) {
        const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
        throw new Error(payload?.error || `Could not load quizzes (${response.status})`);
      }
      if (!contentType.includes('application/json')) {
        throw new Error('Could not load quizzes: quiz API returned a non-JSON response.');
      }
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
    if (searchParams.get('status') === 'trash') {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('status', 'archive');
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, search, pageSize, dateFilterPreset, customDateRange.start, customDateRange.end]);

  useEffect(() => {
    setCurrentPage(current => Math.min(current, Math.max(1, Math.ceil(quizzes.length / Number(pageSize)))));
  }, [quizzes.length, pageSize]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/quiz_api/training-plan-options/', { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Could not load training plan options')))
      .then((data: CurriculumModuleOptions) => setTrainingPlanOptions(data))
      .catch(err => {
        if ((err as DOMException).name !== 'AbortError') setTrainingPlanOptions({ programmes: [], modulesByProgramme: {} });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const selectedModule = (trainingPlanOptions.modulesByProgramme[form.programme] ?? []).find(option => option.value === form.module);
    const moduleId = selectedModule?.moduleId;
    if (!moduleId) {
      setFormWeeks([]);
      setFormWeeksState(form.module ? 'error' : 'idle');
      return;
    }

    let cancelled = false;
    setFormWeeksState('loading');
    fetchWeeks(moduleId)
      .then(weeks => {
        if (cancelled) return;
        setFormWeeks(weeks);
        setFormWeeksState('ready');
        setForm(current => weeks.some(week => week.id === current.weekId) ? current : { ...current, week: '', weekId: '' });
      })
      .catch(() => {
        if (cancelled) return;
        setFormWeeks([]);
        setFormWeeksState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [form.module, form.programme, trainingPlanOptions.modulesByProgramme]);

  useEffect(() => {
    const selectedModule = (trainingPlanOptions.modulesByProgramme[generatorForm.programme] ?? []).find(option => option.value === generatorForm.module);
    const moduleId = selectedModule?.moduleId;
    if (!moduleId) {
      setGeneratorWeeks([]);
      setGeneratorWeeksState(generatorForm.module ? 'error' : 'idle');
      return;
    }

    let cancelled = false;
    setGeneratorWeeksState('loading');
    fetchWeeks(moduleId)
      .then(weeks => {
        if (cancelled) return;
        setGeneratorWeeks(weeks);
        setGeneratorWeeksState('ready');
        setGeneratorForm(current => weeks.some(week => week.id === current.weekId) ? current : { ...current, week: '', weekId: '' });
      })
      .catch(() => {
        if (cancelled) return;
        setGeneratorWeeks([]);
        setGeneratorWeeksState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [generatorForm.module, generatorForm.programme, trainingPlanOptions.modulesByProgramme]);

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

  const activeDateRange = dateFilterPreset === 'custom' ? customDateRange : dateRangeForPreset(dateFilterPreset);
  const dateFilterLabel = dateFilterPresets.find(option => option.value === dateFilterPreset)?.label || 'Custom';
  const dateRangeLabel = activeDateRange.start && activeDateRange.end
    ? activeDateRange.start.toDateString() === activeDateRange.end.toDateString()
      ? compactDate(activeDateRange.start)
      : `${compactDate(activeDateRange.start)} - ${compactDate(activeDateRange.end)}`
    : 'Jan 1, 1970 - ∞';
  const calendarDays = useMemo(() => monthCalendarDays(calendarViewDate), [calendarViewDate]);
  const visibleQuizzes = useMemo(() => {
    if (!activeDateRange.start || !activeDateRange.end) return quizzes;
    return quizzes.filter(quiz => {
      const updatedAt = new Date(quiz.updatedAt);
      if (Number.isNaN(updatedAt.getTime())) return false;
      return updatedAt >= activeDateRange.start! && updatedAt <= activeDateRange.end!;
    });
  }, [quizzes, activeDateRange.start, activeDateRange.end]);

  const published = visibleQuizzes.filter(q => q.status === 'published').length;
  const draft = visibleQuizzes.filter(q => q.status === 'draft').length;
  const validationIssues = visibleQuizzes.filter(q => !q.schemaValid).length;
  const totalQuestions = visibleQuizzes.reduce((sum, quiz) => sum + quiz.questions, 0);
  const isArchiveView = filterStatus === 'trash';
  const pageHeading = isArchiveView ? 'Quiz Archive' : 'Quiz Workspace';
  const pageSubtitle = isArchiveView
    ? 'Review archived quiz packages and restore anything needed back to the workspace'
    : 'Upload XML, SCORM or spreadsheet quiz files, then store questions and answers';
  const heroSummary = isArchiveView
    ? `${visibleQuizzes.length} archived quiz packages ready to restore or permanently delete.`
    : `${published} published, ${draft} in draft. ${validationIssues} with validation issues.`;
  const tertiaryStat = isArchiveView
    ? { value: visibleQuizzes.length, label: 'Archived' }
    : { value: published, label: 'Published' };
  const numericPageSize = Number(pageSize);
  const pageCount = Math.max(1, Math.ceil(visibleQuizzes.length / numericPageSize));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const pageStartIndex = (safeCurrentPage - 1) * numericPageSize;
  const pageEndIndex = pageStartIndex + numericPageSize;
  const paginatedQuizzes = visibleQuizzes.slice(pageStartIndex, pageEndIndex);
  const allVisibleSelected = paginatedQuizzes.length > 0 && paginatedQuizzes.every(q => selectedIds.includes(q.id));
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
    { value: '', label: form.programme ? 'Module' : 'Select programme first', programmeId: '' },
    ...(trainingPlanOptions.modulesByProgramme[form.programme] ?? []),
  ], [form.programme, trainingPlanOptions.modulesByProgramme]);
  const generatorModuleOptions = useMemo(() => [
    { value: '', label: generatorForm.programme ? 'Module' : 'Select programme first', programmeId: '' },
    ...(trainingPlanOptions.modulesByProgramme[generatorForm.programme] ?? []),
  ], [generatorForm.programme, trainingPlanOptions.modulesByProgramme]);
  const formWeekOptions = useMemo(() => {
    const label = !form.module
      ? 'Select module first'
      : formWeeksState === 'loading'
        ? 'Loading weeks...'
        : formWeeksState === 'error'
          ? 'No weeks found'
          : 'Week';
    return [
      { value: '', label },
      ...formWeeks.map(week => ({ value: week.id, label: week.title })),
    ];
  }, [form.module, formWeeks, formWeeksState]);
  const generatorWeekOptions = useMemo(() => {
    const label = !generatorForm.module
      ? 'Select module first'
      : generatorWeeksState === 'loading'
        ? 'Loading weeks...'
        : generatorWeeksState === 'error'
          ? 'No weeks found'
          : 'Week';
    return [
      { value: '', label },
      ...generatorWeeks.map(week => ({ value: week.id, label: week.title })),
    ];
  }, [generatorForm.module, generatorWeeks, generatorWeeksState]);

  const selectedCount = selectedIds.length;
  const activeEditorQuestion = editorData?.questions.find(question => question.id === activeQuestionId) ?? editorData?.questions[0];
  const editorSnapshot = useMemo(() => editorData ? serializeEditorQuestions(editorData.questions) : '', [editorData]);
  const editorDirty = Boolean(editorData && editorSnapshot !== editorBaseline);
  const activeStudentResult = studentResultsData?.students.find(student => student.id === activeStudentId) ?? studentResultsData?.students[0] ?? null;
  const activeStudentAttempt = activeStudentResult?.attempts[Math.min(activeAttemptIndex, Math.max(0, activeStudentResult.attempts.length - 1))] ?? activeStudentResult?.latestAttempt ?? null;

  const resetModal = () => {
    setShowCreate(false);
    setForm(emptyForm);
    setUploadFile(null);
    setSavingQuiz(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const resetManualModal = () => {
    setShowManualCreate(false);
    setForm(emptyForm);
    const firstQuestion = createManualQuestion(1);
    setManualQuestions([firstQuestion]);
    setOpenManualQuestionId(firstQuestion.id);
    setSavingManualQuiz(false);
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
      nextParams.set('status', status === 'trash' ? 'archive' : status);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const applyDatePreset = (preset: DateFilterPreset) => {
    setDateFilterPreset(preset);
    if (preset !== 'custom') setCustomDateRange({ start: null, end: null });
    setDateFilterOpen(false);
  };

  const selectCalendarDate = (date: Date) => {
    setDateFilterPreset('custom');
    setCustomDateRange({ start: startOfDay(date), end: endOfDay(date) });
    setDateFilterOpen(false);
  };

  const createQuiz = async () => {
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
          weekId: form.weekId,
          version: form.version,
          questions: Number(form.questions || 0),
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
    return response.json();
  };

  const updateManualQuestion = (questionId: number, patch: Partial<QuizPreviewQuestion>) => {
    setManualQuestions(prev => prev.map(question => question.id === questionId ? { ...question, ...patch } : question));
  };

  const updateManualQuestionType = (questionId: number, questionType: QuestionType) => {
    setManualQuestions(prev => prev.map(question => question.id === questionId ? {
      ...question,
      questionType,
      answers: normalizeAnswersForQuestionType(
        question.answers.map(answer => ({
          ...answer,
          text: convertAnswerTextForQuestionType(answer.text, question.questionType, questionType),
        })),
        questionType,
      ),
    } : question));
  };

  const updateManualAnswer = (questionId: number, answerId: number, patch: Partial<QuizPreviewQuestion['answers'][number]>) => {
    setManualQuestions(prev => prev.map(question => question.id === questionId ? {
      ...question,
      answers: question.answers.map(answer => answer.id === answerId ? { ...answer, ...patch } : answer),
    } : question));
  };

  const updateManualAnswerPair = (questionId: number, answerId: number, patch: { left?: string; right?: string; imageUrl?: string }) => {
    setManualQuestions(prev => prev.map(question => question.id === questionId ? {
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
    } : question));
  };

  const markManualCorrectAnswer = (questionId: number, answerId: number) => {
    setManualQuestions(prev => prev.map(question => question.id === questionId ? {
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

  const addManualAnswer = (questionId: number) => {
    setManualQuestions(prev => prev.map(question => question.id === questionId ? {
      ...question,
      answers: [...question.answers, { id: -Date.now(), text: '', isCorrect: isAlwaysCorrectType(question.questionType) }],
    } : question));
  };

  const removeManualAnswer = (questionId: number, answerId: number) => {
    setManualQuestions(prev => prev.map(question => {
      if (question.id !== questionId || question.answers.length <= 1) return question;
      return {
        ...question,
        answers: normalizeAnswersForQuestionType(question.answers.filter(answer => answer.id !== answerId), question.questionType),
      };
    }));
  };

  const addManualQuestion = () => {
    setManualQuestions(prev => {
      const nextQuestion = createManualQuestion(prev.length + 1);
      setOpenManualQuestionId(nextQuestion.id);
      return [...prev, nextQuestion];
    });
  };

  const removeManualQuestion = (questionId: number) => {
    setManualQuestions(prev => {
      if (prev.length <= 1) return prev;
      const nextQuestions = prev.filter(question => question.id !== questionId);
      if (openManualQuestionId === questionId) setOpenManualQuestionId(nextQuestions[0]?.id ?? null);
      return nextQuestions;
    });
  };

  const validateManualQuestions = () => {
    for (const [index, question] of manualQuestions.entries()) {
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

  const submitManualQuiz = async (event: FormEvent) => {
    event.preventDefault();
    if (savingManualQuiz) return;
    const validationMessage = validateManualQuestions();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setError('');
    setSavingManualQuiz(true);
    try {
      const createResponse = await fetch('/quiz_api/quizzes/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          module: form.module,
          programme: form.programme,
          programmeId: form.programmeId,
          week: form.week,
          weekId: form.weekId,
          version: form.version,
          questions: manualQuestions.length,
          questionType: manualQuestions[0]?.questionType || 'single_choice',
          status: form.status,
          author: form.author,
          linkedCourses: Number(form.linkedCourses || 0),
          packageType: 'xml',
          schemaValid: true,
        }),
      });
      const created = await createResponse.json().catch(() => null);
      if (!createResponse.ok) throw new Error(created?.error || 'Could not create manual quiz');

      const saveResponse = await fetch(`/quiz_api/quizzes/${created.id}/questions/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: manualQuestions, removeMissing: true }),
      });
      const saved = await saveResponse.json().catch(() => null);
      if (!saveResponse.ok) throw new Error(saved?.error || 'Could not save manual questions');

      setQuizzes(prev => [saved.quiz, ...prev.filter(quiz => quiz.id !== saved.quiz.id)]);
      resetManualModal();
      success('Quiz created', 'Manual questions were saved as a quiz draft.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save manual quiz');
    } finally {
      setSavingManualQuiz(false);
    }
  };

  const submitQuiz = async (event: FormEvent) => {
    event.preventDefault();
    if (savingQuiz) return;
    setError('');
    setSavingQuiz(true);

    try {
      const saved = await createQuiz();
      setQuizzes(prev => [saved, ...prev]);
      resetModal();
      success('Quiz created', 'The quiz package was saved successfully.');
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
        body.append('week', generatorForm.week);
        body.append('weekId', generatorForm.weekId);
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
            week: generatorForm.week,
            weekId: generatorForm.weekId,
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
          weekId: generatorForm.weekId,
          version: 'v1.0',
          questions: generatedQuestions.length,
          questionType: generatedQuestions[0]?.questionType || 'single_choice',
          status: 'draft',
          author: generatorForm.author,
          linkedCourses: 0,
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
      if (bulkAction === 'trash') {
        await showCurriculumConfirm({
          title: `Archive ${ids.length} quiz${ids.length === 1 ? '' : 'zes'}?`,
          text: 'Archived quizzes move out of the active workspace. You can restore them later from Archive.',
          icon: 'warning',
          confirmButtonText: 'Archive',
          onConfirm: () => updateStatus(ids, 'trash'),
        });
      } else if (editableStatusOptions.some(option => option.value === bulkAction)) {
        await updateStatus(ids, bulkAction as QuizStatus);
      } else if (bulkAction === 'delete') {
        await showCurriculumConfirm({
          title: `Delete ${ids.length} quiz${ids.length === 1 ? '' : 'zes'} permanently?`,
          text: 'This permanently deletes the selected archived quiz packages and cannot be undone.',
          icon: 'warning',
          confirmButtonText: 'Delete permanently',
          onConfirm: deleteSelected,
        });
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

  const openStudentManager = async (quiz: QuizPackage) => {
    setStudentResultsLoadingId(quiz.id);
    setError('');
    try {
      const response = await fetch(`/quiz_api/quizzes/${quiz.id}/students/`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Could not load quiz student results');
      setStudentResultsData(data);
      setActiveStudentId(data.students?.[0]?.id ?? null);
      setActiveAttemptIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load quiz student results');
    } finally {
      setStudentResultsLoadingId(null);
    }
  };

  const openLinkedCourses = async (quiz: QuizPackage) => {
    setCourseLinksLoadingId(quiz.id);
    setError('');
    try {
      const response = await fetch(`/quiz_api/quizzes/${quiz.id}/course-links/`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Could not load module assignments');
      setCourseLinksData(data);
      if (data?.quiz) {
        setQuizzes(prev => prev.map(item => item.id === data.quiz.id ? data.quiz : item));
        setSelectedQuiz(prev => prev?.id === data.quiz.id ? data.quiz : prev);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load module assignments');
    } finally {
      setCourseLinksLoadingId(null);
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
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle={pageHeading} pageSubtitle={pageSubtitle} userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="quiz-workspace-page w-full min-w-0 max-w-full p-4 sm:p-6 space-y-5 sm:space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="relative p-5 sm:p-8 flex flex-col md:flex-row items-start md:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><AppIcon className="ri-code-box-line text-white text-2xl"></AppIcon></span>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-heading font-bold text-white mb-1">{pageHeading}</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{visibleQuizzes.length} quiz packages</strong> - {heroSummary}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3 w-full md:w-auto shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-3 sm:px-4 py-3 text-center min-w-0"><p className="text-xl sm:text-2xl font-bold text-white">{visibleQuizzes.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide truncate">Quizzes</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-3 sm:px-4 py-3 text-center min-w-0"><p className="text-xl sm:text-2xl font-bold text-white">{totalQuestions}</p><p className="text-[10px] text-white/70 uppercase tracking-wide truncate">Questions</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-3 sm:px-4 py-3 text-center min-w-0"><p className="text-xl sm:text-2xl font-bold text-white">{tertiaryStat.value}</p><p className="text-[10px] text-white/70 uppercase tracking-wide truncate">{tertiaryStat.label}</p></div>
            </div>
          </div>
        </div>

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
            className="w-full sm:w-44"
            buttonClassName="quiz-workspace-action-font !border-[#d8dde6] !bg-white !text-[#5b2dbb] !text-[11px] disabled:!border-[#d8dde6] disabled:!bg-white disabled:!text-[#b8afc9]"
          />
          <button
            type="button"
            onClick={() => void applyBulkAction()}
            disabled={!selectedCount || !bulkAction}
            className="quiz-workspace-action-font h-10 px-4 rounded-lg !bg-[#6d28d9] !text-white !text-[11px] font-semibold hover:!bg-[#5b21b6] disabled:!bg-[#e8ddff] disabled:!text-[#9b8bbd] disabled:cursor-not-allowed transition-smooth whitespace-nowrap"
          >
            Apply
          </button>

          <ThemedSelect
            value={filterStatus}
            options={statusOptions}
            onChange={handleStatusFilterChange}
            className="w-full sm:w-44 lg:ml-auto"
            buttonClassName="text-xs"
          />

          <div className="relative w-full sm:w-52">
            <button
              type="button"
              onClick={() => setDateFilterOpen(open => !open)}
              className={`h-10 w-full rounded-lg border px-3 text-left text-xs transition-smooth flex items-center gap-2 ${
                dateFilterOpen || dateFilterPreset !== 'all'
                  ? 'bg-white border-primary-300 text-primary-700 ring-1 ring-primary-200'
                  : 'bg-background-50 border-foreground-200/60 text-foreground-700 hover:border-primary-300'
              }`}
            >
              <AppIcon className="ri-calendar-2-line text-base shrink-0"></AppIcon>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold truncate">{dateFilterLabel}</span>
                <span className="block text-[10px] text-foreground-400 truncate">{dateRangeLabel}</span>
              </span>
              <AppIcon className={`${dateFilterOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-foreground-400 shrink-0`}></AppIcon>
            </button>

            {dateFilterOpen && (
              <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-[min(92vw,410px)] rounded-xl border border-[#d8dde6] bg-white shadow-2xl overflow-hidden">
                <div className="grid grid-cols-[130px_1fr]">
                  <aside className="bg-[#f8fafc] border-r border-[#e2e8f0] p-2">
                    {dateFilterPresets.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => applyDatePreset(option.value)}
                        className={`w-full h-8 rounded-lg px-3 text-left text-sm font-medium transition-smooth ${
                          dateFilterPreset === option.value
                            ? 'bg-[#e7efff] text-[#2563eb]'
                            : 'text-[#526173] hover:bg-white hover:text-[#0f172a]'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setDateFilterPreset('all');
                        setCustomDateRange({ start: null, end: null });
                        setDateFilterOpen(false);
                      }}
                      className="mt-2 h-9 px-3 rounded-lg border border-primary-200 bg-white text-primary-700 text-sm font-semibold hover:bg-primary-50"
                    >
                      Reset
                    </button>
                  </aside>

                  <section className="p-4">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <h4 className="text-sm font-heading font-bold text-[#0f172a]">
                        {new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(calendarViewDate)}
                      </h4>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setCalendarViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))} className="w-8 h-8 rounded-full bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0]">
                          <AppIcon className="ri-arrow-left-s-line"></AppIcon>
                        </button>
                        <button type="button" onClick={() => setCalendarViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))} className="w-8 h-8 rounded-full bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0]">
                          <AppIcon className="ri-arrow-right-s-line"></AppIcon>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-7 gap-1 text-center">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                        <span key={day} className="text-xs font-semibold text-[#94a3b8] py-1">{day}</span>
                      ))}
                      {calendarDays.map(day => {
                        const inMonth = day.getMonth() === calendarViewDate.getMonth();
                        const selected = activeDateRange.start && activeDateRange.end && day >= startOfDay(activeDateRange.start) && day <= activeDateRange.end;
                        return (
                          <button
                            key={dateKey(day)}
                            type="button"
                            onClick={() => selectCalendarDate(day)}
                            className={`h-8 rounded-lg text-sm font-medium transition-smooth ${
                              selected
                                ? 'bg-[#3b82f6] text-white'
                                : inMonth
                                  ? 'text-[#0f172a] hover:bg-[#eff6ff] hover:text-[#2563eb]'
                                  : 'text-[#94a3b8] hover:bg-[#f8fafc]'
                            }`}
                          >
                            {day.getDate()}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </div>
              </div>
            )}
          </div>

          <div className="relative w-full sm:w-72 lg:flex-1 lg:max-w-md">
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by title" className="h-10 w-full rounded-lg bg-background-50 border border-foreground-200/60 pl-4 pr-10 text-sm outline-none focus:border-primary-400" />
            <AppIcon className="ri-search-line absolute right-3 top-1/2 -translate-y-1/2 text-foreground-400"></AppIcon>
          </div>

          <div className="relative w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setMoreMenuOpen(open => !open)}
              className="h-10 px-4 bg-white border border-[#d8dde6] rounded-lg text-sm font-semibold text-[#5b2dbb] hover:bg-[#f7f3ff] transition-smooth whitespace-nowrap flex items-center justify-center gap-1.5 w-full sm:w-auto"
            >
              <AppIcon className="ri-more-2-line"></AppIcon>
              More
              <AppIcon className={`${moreMenuOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-sm`}></AppIcon>
            </button>
            {moreMenuOpen && (
              <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-60 rounded-xl border border-[#d8dde6] bg-white p-2 shadow-2xl">
                <button
                  type="button"
                  onClick={() => {
                    handleStatusFilterChange(filterStatus === 'trash' ? 'all' : 'trash');
                    setMoreMenuOpen(false);
                  }}
                  className="w-full h-10 px-3 rounded-lg text-sm font-semibold text-left text-[#5b2dbb] hover:bg-[#f7f3ff] flex items-center gap-2"
                >
                  <AppIcon className={`${filterStatus === 'trash' ? 'ri-arrow-left-line' : 'ri-archive-line'}`}></AppIcon>
                  {filterStatus === 'trash' ? 'Back to quizzes' : 'Archive'}
                </button>
                <Link to="/curriculum/question-bank" onClick={() => setMoreMenuOpen(false)} className="w-full h-10 px-3 rounded-lg text-sm font-semibold text-left text-[#5b2dbb] hover:bg-[#f7f3ff] flex items-center gap-2">
                  <AppIcon className="ri-questionnaire-line"></AppIcon>
                  Question Bank
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setShowGradeSettings(true);
                    setMoreMenuOpen(false);
                  }}
                  className="w-full h-10 px-3 rounded-lg text-sm font-semibold text-left text-[#5b2dbb] hover:bg-[#f7f3ff] flex items-center gap-2"
                >
                  <AppIcon className="ri-graduation-cap-line"></AppIcon>
                  Grade Settings
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowGeneralSettings(true);
                    setMoreMenuOpen(false);
                  }}
                  className="w-full h-10 px-3 rounded-lg text-sm font-semibold text-left text-[#5b2dbb] hover:bg-[#f7f3ff] flex items-center gap-2"
                >
                  <AppIcon className="ri-settings-3-line"></AppIcon>
                  General Settings
                </button>
              </div>
            )}
          </div>

          <div className="basis-full h-px bg-foreground-200/50" />

          <div className="basis-full flex items-center gap-3 flex-wrap">
            <button onClick={() => setShowGenerator(true)} className="quiz-workspace-action-font inline-flex items-center justify-center gap-1.5 h-10 px-4 !bg-[#5b2dbb] !text-white rounded-lg !text-[11px] font-semibold hover:!bg-[#4c1d95] transition-smooth whitespace-nowrap w-full sm:w-auto">
              <AppIcon className="ri-sparkling-2-line"></AppIcon> Generate Questions
            </button>
            <button onClick={() => setShowCreate(true)} className="quiz-workspace-action-font inline-flex items-center justify-center gap-1.5 h-10 px-4 !bg-white !border-[#cdbdff] !text-[#5b2dbb] rounded-lg !text-[11px] font-semibold hover:!bg-[#f2edff] transition-smooth whitespace-nowrap w-full sm:w-auto">
              <AppIcon name="ri-add-circle-line" size={15}></AppIcon> Add New Quiz
            </button>
            <Link to="/curriculum/quiz-xml/manual" className="quiz-workspace-action-font inline-flex items-center justify-center gap-1.5 h-10 px-4 !bg-[#f2edff] !border-[#cdbdff] rounded-lg !text-[11px] font-semibold !text-[#5b2dbb] hover:!bg-[#e8ddff] transition-smooth whitespace-nowrap w-full sm:w-auto">
              <AppIcon className="ri-edit-2-line"></AppIcon> Manual Quiz
            </Link>
            <button onClick={() => fileInputRef.current?.click()} className="quiz-workspace-action-font inline-flex items-center justify-center gap-1.5 h-10 px-4 !bg-white !border-[#cdbdff] rounded-lg !text-[11px] font-semibold !text-[#5b2dbb] hover:!bg-[#f2edff] transition-smooth whitespace-nowrap w-full sm:w-auto">
              <AppIcon className="ri-upload-cloud-line"></AppIcon> Upload Quiz File
            </button>
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="xl:hidden divide-y divide-foreground-200/50">
            {loading && (
              <div className="px-4 py-10 text-center text-sm text-foreground-400">Loading quizzes...</div>
            )}
            {!loading && paginatedQuizzes.map(quiz => (
              <article key={quiz.id} onClick={() => setSelectedQuiz(quiz)} className="p-4 sm:p-5 hover:bg-background-100/50 transition-smooth cursor-pointer">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(quiz.id)}
                    onClick={event => event.stopPropagation()}
                    onChange={() => setSelectedIds(prev => prev.includes(quiz.id) ? prev.filter(id => id !== quiz.id) : [...prev, quiz.id])}
                    className="mt-1 w-4 h-4 rounded border-foreground-300 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm sm:text-base font-heading font-bold text-foreground-900 leading-6 break-words [overflow-wrap:anywhere]">{quiz.title}</h3>
                        <p className="mt-1 text-xs text-foreground-500 break-words [overflow-wrap:anywhere]">{quiz.module || 'No module'} - {quiz.questions} questions</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${statusClasses(quiz.status)}`}>{statusLabel(quiz.status)}</span>
                        <span className="text-xs text-foreground-400 uppercase">{quiz.packageType}</span>
                        {quiz.schemaValid ? <AppIcon className="ri-checkbox-circle-line text-emerald-500"></AppIcon> : <AppIcon className="ri-error-warning-line text-red-500"></AppIcon>}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                      <div className="rounded-lg bg-background-100/80 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">Linked</p>
                        <button
                          type="button"
                          onClick={event => {
                            event.stopPropagation();
                            void openLinkedCourses(quiz);
                          }}
                          className="font-semibold text-primary-600 hover:text-primary-700 hover:underline disabled:cursor-wait disabled:opacity-60"
                          disabled={courseLinksLoadingId === quiz.id}
                          title="View assigned modules and targeted groups"
                        >
                          {courseLinksLoadingId === quiz.id ? '...' : formatLinkedSummary(quiz.linkedCourses, quiz.linkedGroups)}
                        </button>
                      </div>
                      <div className="rounded-lg bg-background-100/80 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">Date</p>
                        <p className="font-semibold text-foreground-800">Last Modified - {statusLabel(quiz.status)}</p>
                        <p className="text-xs text-foreground-500">{formatDate(quiz.updatedAt)}</p>
                      </div>
                      <div className="rounded-lg bg-background-100/80 px-3 py-2" onClick={event => event.stopPropagation()}>
                        <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-foreground-400">Author</p>
                        <ThemedSelect
                          value={quiz.author || 'Curriculum Team'}
                          options={authorOptions}
                          onChange={author => void updateAuthor(quiz, author)}
                          className="w-full"
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3" onClick={event => event.stopPropagation()}>
                      <p className="text-xs text-foreground-400">Package is {quiz.schemaValid ? 'valid' : 'missing validation'}</p>
                      <QuizRowActions
                        quiz={quiz}
                        previewLoadingId={previewLoadingId}
                        editorLoadingId={editorLoadingId}
                        studentsLoadingId={studentResultsLoadingId}
                        onRestore={() => void updateStatus([quiz.id], 'draft')}
                        onPreview={() => void openStudentPreview(quiz)}
                        onEdit={() => void openQuestionEditor(quiz)}
                        onManageStudents={() => void openStudentManager(quiz)}
                      />
                    </div>
                  </div>
                </div>
              </article>
            ))}
            {!loading && visibleQuizzes.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-foreground-400">No quizzes match this filter</div>
            )}
          </div>

          <div className="hidden xl:block overflow-x-auto">
            <table className="quiz-workspace-table w-full min-w-0 table-fixed text-left">
              <thead>
                <tr className="border-b border-foreground-300/50 bg-background-100/60">
                  <th className="px-4 py-3 w-10"></th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-foreground-500">Title</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-foreground-500">Linked</th>
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
                    <td className="px-4 py-3 text-sm" onClick={event => event.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => void openLinkedCourses(quiz)}
                        className="font-semibold text-primary-600 hover:text-primary-700 hover:underline disabled:cursor-wait disabled:opacity-60"
                        disabled={courseLinksLoadingId === quiz.id}
                        title="View assigned modules and targeted groups"
                      >
                        {courseLinksLoadingId === quiz.id ? '...' : formatLinkedSummary(quiz.linkedCourses, quiz.linkedGroups)}
                      </button>
                    </td>
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
                    <td className="px-4 py-3 align-middle">
                      <div className="mx-auto grid w-fit grid-cols-[5.5rem_3.5rem_1.25rem] items-center gap-2">
                        <span className={`justify-self-center text-[11px] font-semibold px-2.5 py-1 rounded-full ${statusClasses(quiz.status)}`}>{statusLabel(quiz.status)}</span>
                        <span className="justify-self-start text-xs text-foreground-400 uppercase">{quiz.packageType}</span>
                        {quiz.schemaValid ? <AppIcon className="ri-checkbox-circle-line justify-self-start text-emerald-500"></AppIcon> : <AppIcon className="ri-error-warning-line justify-self-start text-red-500"></AppIcon>}
                      </div>
                    </td>
                    <td className="px-4 py-3" onClick={event => event.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <QuizRowActions
                          quiz={quiz}
                          previewLoadingId={previewLoadingId}
                          editorLoadingId={editorLoadingId}
                          studentsLoadingId={studentResultsLoadingId}
                          onRestore={() => void updateStatus([quiz.id], 'draft')}
                          onPreview={() => void openStudentPreview(quiz)}
                          onEdit={() => void openQuestionEditor(quiz)}
                          onManageStudents={() => void openStudentManager(quiz)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && visibleQuizzes.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-foreground-400">No quizzes match this filter</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {!loading && visibleQuizzes.length > 0 && (
            <div className="border-t border-foreground-200/50 bg-white px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="text-xs text-foreground-400">
                Showing <span className="font-semibold text-foreground-700">{pageStartIndex + 1}</span>-
                <span className="font-semibold text-foreground-700">{Math.min(pageEndIndex, visibleQuizzes.length)}</span> of{' '}
                <span className="font-semibold text-foreground-700">{visibleQuizzes.length}</span> quizzes
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
                  disabled={safeCurrentPage === 1}
                  className="inline-flex w-9 h-9 items-center justify-center rounded-lg bg-background-100 text-sm font-semibold text-foreground-600 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Previous page"
                >
                  <AppIcon className="ri-arrow-left-line text-[16px]"></AppIcon>
                </button>
                <span className="inline-flex w-9 h-9 items-center justify-center rounded-lg bg-primary-50 text-sm font-semibold text-primary-700" aria-label={`Current page ${safeCurrentPage}`}>
                  {safeCurrentPage}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage(page => Math.min(pageCount, page + 1))}
                  disabled={safeCurrentPage === pageCount}
                  className="inline-flex w-9 h-9 items-center justify-center rounded-lg bg-background-100 text-sm font-semibold text-foreground-600 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Next page"
                >
                  <AppIcon className="ri-arrow-right-line text-[16px]"></AppIcon>
                </button>
                <ThemedSelect
                  value={pageSize}
                  options={pageSizeOptions}
                  onChange={setPageSize}
                  className="w-36 ml-0 md:ml-2"
                  menuPlacement="auto"
                />
              </div>
            </div>
          )}
        </div>

        {courseLinksData && (() => {
          const linkedCourses = courseLinksData.courses.filter(course => course.selected);
          const courseGroups = (course: QuizCourseLinkOption) => {
            const explicit = course.groups ?? [];
            if (explicit.length > 0) return explicit;
            return course.group ? [course.group] : [];
          };
          const distinctGroups = new Set(linkedCourses.flatMap(course => courseGroups(course).map(name => name.toLowerCase())));
          const metaParts = (course: QuizCourseLinkOption) =>
            [course.programme, course.cohort ? `Cohort: ${course.cohort}` : '', course.startDate ? `Starts: ${course.startDate}` : ''].filter(Boolean) as string[];

          return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCourseLinksData(null)}>
            <div className="w-full max-w-2xl rounded-2xl border border-foreground-200/60 bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 border-b border-foreground-200/60 p-5">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-primary-600 mb-1">Where this quiz is assigned</p>
                  <h3 className="text-lg font-heading font-bold text-foreground-900 truncate">{courseLinksData.quiz.title}</h3>
                  <p className="text-sm text-foreground-400 truncate">{courseLinksData.programme || courseLinksData.quiz.programme || 'No programme'}</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold">
                    <span className="inline-flex items-center gap-1.5 text-foreground-500">
                      <AppIcon className="ri-links-line text-foreground-400"></AppIcon>{linkedCourses.length} assigned module{linkedCourses.length === 1 ? '' : 's'}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-primary-600">
                      <AppIcon className="ri-group-line text-primary-500"></AppIcon>{distinctGroups.size} group{distinctGroups.size === 1 ? '' : 's'} targeted
                    </span>
                  </div>
                </div>
                <button onClick={() => setCourseLinksData(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-500 hover:bg-background-200 hover:text-foreground-800 transition-colors" aria-label="Close">
                  <AppIcon className="ri-close-line text-lg"></AppIcon>
                </button>
              </div>

              <div className="max-h-[60vh] overflow-y-auto p-5 quiz-preview-scroll">
                {linkedCourses.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-foreground-200/80 bg-background-100/60 px-4 py-10 text-center">
                    <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white text-foreground-300 border border-foreground-200/60">
                      <AppIcon className="ri-links-line text-xl"></AppIcon>
                    </span>
                    <p className="text-sm font-semibold text-foreground-700">Not assigned to any module yet</p>
                    <p className="mt-1 text-xs text-foreground-400">Assign it to one or more delivery modules before expecting it to appear to learners.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {linkedCourses.map(course => {
                      const groups = courseGroups(course);
                      const meta = metaParts(course);
                      return (
                      <article key={course.id} className="overflow-hidden rounded-xl border border-foreground-200/70 bg-white shadow-sm">
                        <div className="flex items-start gap-3 p-4">
                          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary-100 bg-primary-50 text-primary-700">
                            <AppIcon className="ri-book-open-line"></AppIcon>
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="min-w-0 truncate text-sm font-heading font-bold text-foreground-900">{course.module || course.label || 'Assigned module'}</h4>
                            </div>
                            {meta.length > 0 && (
                              <p className="mt-1 truncate text-xs text-foreground-400">{meta.join('  ·  ')}</p>
                            )}
                          </div>
                        </div>
                        <div className="border-t border-foreground-100 bg-background-50/60 px-4 py-3">
                          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground-400">
                            <AppIcon className="ri-group-line text-foreground-400"></AppIcon>Assigned groups
                          </p>
                          {groups.length === 0 ? (
                            <p className="text-xs text-foreground-400">No specific groups — open to the whole module.</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {groups.map((name, index) => (
                                <span key={`${course.id}-${index}`} className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-[11px] font-semibold text-primary-700">
                                  <AppIcon className="ri-group-line text-xs text-primary-500"></AppIcon>{name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
          );
        })()}

        {selectedQuiz && (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setSelectedQuiz(null)}>
            <aside className="w-full max-w-md bg-background-50 h-full shadow-xl p-6 overflow-y-auto" onClick={event => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <h3 className="text-lg font-heading font-bold text-foreground-900">{selectedQuiz.title}</h3>
                  <p className="text-sm text-foreground-400">{selectedQuiz.module} - {selectedQuiz.programme}</p>
                </div>
                <button onClick={() => setSelectedQuiz(null)} className="w-9 h-9 rounded-lg bg-background-100 hover:bg-background-200"><AppIcon className="ri-close-line"></AppIcon></button>
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
                  <AppIcon className="ri-error-warning-line mr-1"></AppIcon>{selectedQuiz.validationMessage || 'Package requires validation.'}
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
                      <AppIcon className="ri-eye-line"></AppIcon>
                    </span>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#5b2dbb]">Student Preview</p>
                  </div>
                  <h3 className="text-xl font-heading font-bold text-foreground-900 leading-snug">{previewData.quiz.title}</h3>
                  <p className="text-sm text-[#647083] mt-1">
                    {previewData.quiz.packageType === 'scorm' ? 'SCORM package preview' : `${previewData.questions.length} questions`}{previewData.quiz.programme ? ` - ${previewData.quiz.programme}` : ''}
                  </p>
                </div>
                <button onClick={() => setPreviewData(null)} className="w-11 h-11 rounded-xl bg-white hover:bg-[#f1f5f9] text-[#0f172a] shrink-0 transition-smooth"><AppIcon className="ri-close-line text-lg"></AppIcon></button>
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
                      <AppIcon className="ri-questionnaire-line text-foreground-300 text-xl"></AppIcon>
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

        {studentResultsData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setStudentResultsData(null)}>
            <div className="w-full max-w-7xl max-h-[92vh] bg-white rounded-2xl border border-[#ded8e8] shadow-2xl flex flex-col overflow-hidden" onClick={event => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 px-4 sm:px-7 py-5 sm:py-6 border-b border-[#e2e8f0] bg-[#fbfbfd]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-8 h-8 rounded-xl bg-[#f2f0ff] text-[#5b2dbb] flex items-center justify-center">
                      <AppIcon className="ri-team-line"></AppIcon>
                    </span>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#5b2dbb]">Manage Students</p>
                  </div>
                  <h3 className="text-xl font-heading font-bold text-foreground-900 leading-snug break-words [overflow-wrap:anywhere]">{studentResultsData.quiz.title}</h3>
                  <p className="text-sm text-[#647083] mt-1">Review learner attempts, scores and answer-level results.</p>
                </div>
                <button onClick={() => setStudentResultsData(null)} className="w-11 h-11 rounded-xl bg-white hover:bg-[#f1f5f9] text-[#0f172a] shrink-0 transition-smooth"><AppIcon className="ri-close-line text-lg"></AppIcon></button>
              </div>

              <div className="flex-1 overflow-y-auto bg-[#f8fafc] p-4 sm:p-6 quiz-preview-scroll">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                  {[
                    ['Students', studentResultsData.summary.students],
                    ['Attempts', studentResultsData.summary.attempts],
                    ['Passed', studentResultsData.summary.passed],
                    ['Avg best', studentResultsData.summary.averageBest === null ? '-' : `${studentResultsData.summary.averageBest}%`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[#64748b]">{label}</p>
                      <p className="mt-1 text-xl font-heading font-bold text-[#0f172a]">{value}</p>
                    </div>
                  ))}
                </div>

                {studentResultsData.students.length === 0 ? (
                  <div className="rounded-2xl border border-[#e2e8f0] bg-white py-16 text-center">
                    <span className="w-14 h-14 rounded-2xl bg-[#f8fafc] border border-[#e2e8f0] flex items-center justify-center mx-auto mb-3">
                      <AppIcon className="ri-user-search-line text-[#94a3b8] text-xl"></AppIcon>
                    </span>
                    <p className="text-sm font-semibold text-[#334155]">No student attempts yet</p>
                    <p className="text-xs text-[#64748b] mt-1">When learners submit this quiz, their scores and answers will appear here.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-5">
                    <aside className="rounded-2xl border border-[#e2e8f0] bg-white overflow-hidden">
                      <div className="px-4 py-3 border-b border-[#e2e8f0]">
                        <h4 className="text-sm font-heading font-bold text-[#0f172a]">Students</h4>
                        <p className="text-xs text-[#64748b]">{studentResultsData.students.length} learner{studentResultsData.students.length === 1 ? '' : 's'} attempted</p>
                      </div>
                      <div className="max-h-[56vh] overflow-y-auto quiz-preview-scroll">
                        {studentResultsData.students.map(student => (
                          <button
                            key={student.id}
                            type="button"
                            onClick={() => {
                              setActiveStudentId(student.id);
                              setActiveAttemptIndex(0);
                            }}
                            className={`w-full text-left px-4 py-3 border-b border-[#edf2f7] transition-smooth ${activeStudentResult?.id === student.id ? 'bg-[#f4f1ff]' : 'hover:bg-[#f8fafc]'}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-[#0f172a] truncate">{student.name}</p>
                                <p className="text-xs text-[#64748b] truncate">{student.email || student.programme || 'No email saved'}</p>
                              </div>
                              <span className={`text-[11px] font-bold px-2 py-1 rounded-full shrink-0 ${student.latestAttempt.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                {student.latestAttempt.grade || '-'}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#64748b]">
                              <span>{student.latestAttempt.score || 'No score'}</span>
                              <span>•</span>
                              <span>{student.attemptCount} attempt{student.attemptCount === 1 ? '' : 's'}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </aside>

                    <section className="min-w-0 rounded-2xl border border-[#e2e8f0] bg-white overflow-hidden">
                      {activeStudentResult && activeStudentAttempt ? (
                        <>
                          <div className="p-4 sm:p-5 border-b border-[#e2e8f0]">
                            <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                              <div className="min-w-0">
                                <h4 className="text-lg font-heading font-bold text-[#0f172a] truncate">{activeStudentResult.name}</h4>
                                <p className="text-sm text-[#64748b] break-words [overflow-wrap:anywhere]">{activeStudentResult.email || activeStudentResult.programme || 'No learner email saved'}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${activeStudentAttempt.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                  {activeStudentAttempt.passed ? 'Passed' : 'Not passed'}
                                </span>
                                <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-[#eef2ff] text-[#4f46e5]">{activeStudentAttempt.grade || '-'}</span>
                                <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-[#f1f5f9] text-[#334155]">{activeStudentAttempt.score || 'No score'}</span>
                              </div>
                            </div>

                            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div className="rounded-xl bg-[#f8fafc] border border-[#e2e8f0] px-3 py-2">
                                <p className="text-[10px] font-bold uppercase tracking-wide text-[#64748b]">Submitted</p>
                                <p className="text-sm font-semibold text-[#0f172a]">{activeStudentAttempt.submittedAt ? formatDate(activeStudentAttempt.submittedAt) : '-'}</p>
                              </div>
                              <div className="rounded-xl bg-[#f8fafc] border border-[#e2e8f0] px-3 py-2">
                                <p className="text-[10px] font-bold uppercase tracking-wide text-[#64748b]">Time taken</p>
                                <p className="text-sm font-semibold text-[#0f172a]">{activeStudentAttempt.timeTaken || activeStudentAttempt.reportedTime || '-'}</p>
                              </div>
                              <div className="rounded-xl bg-[#f8fafc] border border-[#e2e8f0] px-3 py-2">
                                <p className="text-[10px] font-bold uppercase tracking-wide text-[#64748b]">Attempt</p>
                                <ThemedSelect
                                  value={String(activeAttemptIndex)}
                                  options={activeStudentResult.attempts.map((attempt, index) => ({
                                    value: String(index),
                                    label: `Attempt ${attempt.attempt ?? index + 1} - ${attempt.grade || '-'}`,
                                  }))}
                                  onChange={value => setActiveAttemptIndex(Number(value))}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="max-h-[56vh] overflow-y-auto p-4 sm:p-5 space-y-4 quiz-preview-scroll">
                            {activeStudentAttempt.questions.length === 0 ? (
                              <div className="py-12 text-center text-sm text-[#64748b]">No answer breakdown was saved for this attempt.</div>
                            ) : activeStudentAttempt.questions.map(question => (
                              <div key={`${question.number}-${question.text}`} className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] p-4">
                                <div className="flex items-start justify-between gap-3 mb-3">
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-[#64748b] mb-1">Question {question.number}</p>
                                    <p className="text-sm font-semibold text-[#0f172a] leading-6 break-words [overflow-wrap:anywhere]">{question.text}</p>
                                  </div>
                                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0 ${question.correct ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                    {question.correct ? 'Correct' : 'Incorrect'}
                                  </span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div className={`rounded-xl border px-3 py-3 ${question.correct ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#64748b] mb-1">Student answer</p>
                                    <p className="text-sm text-[#0f172a] leading-6 break-words [overflow-wrap:anywhere]">{question.chosenAnswer || 'No answer submitted'}</p>
                                  </div>
                                  <div className="rounded-xl border border-emerald-200 bg-white px-3 py-3">
                                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#64748b] mb-1">Correct answer</p>
                                    <p className="text-sm text-[#0f172a] leading-6 break-words [overflow-wrap:anywhere]">{question.correctAnswer || 'No answer key saved'}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="py-16 text-center text-sm text-[#64748b]">Select a student to review their answers.</div>
                      )}
                    </section>
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
                <button onClick={() => setEditorData(null)} className="w-9 h-9 rounded-lg bg-background-100 hover:bg-background-200 shrink-0"><AppIcon className="ri-close-line"></AppIcon></button>
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
                            <AppIcon className="ri-add-line mr-1"></AppIcon>Add answer
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
            <div className="w-full max-w-6xl max-h-[92vh] bg-background-50 rounded-2xl border border-foreground-200/60 shadow-xl flex flex-col overflow-hidden" onClick={event => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 p-5 border-b border-foreground-200/60">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary-600 mb-1">AI Question Generator</p>
                  <h3 className="text-lg font-heading font-bold text-foreground-900">Generate questions from text or files</h3>
                  <p className="text-sm text-foreground-400">Review the generated questions before saving them as a draft quiz.</p>
                </div>
                <button onClick={resetGenerator} className="w-9 h-9 rounded-lg bg-background-100 hover:bg-background-200 shrink-0"><AppIcon className="ri-close-line"></AppIcon></button>
              </div>

              <div className="flex-1 overflow-y-auto quiz-preview-scroll p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-5">
                <section className="space-y-3">
                  <input value={generatorForm.title} onChange={event => setGeneratorForm({ ...generatorForm, title: event.target.value })} placeholder="Quiz title" className="w-full h-10 rounded-lg border border-foreground-200/60 bg-white px-3 text-sm outline-none focus:border-primary-400" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
                    <ThemedSelect
                      value={generatorForm.programme}
                      options={programmeOptions}
                      onChange={programme => setGeneratorForm({ ...generatorForm, programme, module: '', programmeId: '', week: '', weekId: '' })}
                      menuClassName="max-h-56"
                    />
                    <ThemedSelect
                      value={generatorForm.module}
                      options={generatorModuleOptions}
                      onChange={module => {
                        const selectedModule = generatorModuleOptions.find(option => option.value === module);
                        setGeneratorForm({ ...generatorForm, module, programmeId: selectedModule?.programmeId ? String(selectedModule.programmeId) : '', week: '', weekId: '' });
                      }}
                      disabled={!generatorForm.programme}
                      menuClassName="max-h-56"
                    />
                    <ThemedSelect
                      value={generatorForm.weekId}
                      options={generatorWeekOptions}
                      onChange={weekId => {
                        const selectedWeek = generatorWeeks.find(week => week.id === weekId);
                        setGeneratorForm({ ...generatorForm, weekId, week: selectedWeek?.title || '' });
                      }}
                      disabled={!generatorForm.module || generatorWeeksState === 'loading' || generatorWeeks.length === 0}
                      menuClassName="max-h-56"
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
                          <AppIcon className={showPromptCustomize ? 'ri-check-line mr-1' : 'ri-edit-line mr-1'}></AppIcon>{showPromptCustomize ? 'Done' : 'Customize'}
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={generatorForm.customInstructions}
                      readOnly={!showPromptCustomize}
                      onChange={event => setGeneratorForm({ ...generatorForm, customInstructions: event.target.value })}
                      className={`w-full min-h-32 max-h-52 resize-y p-3 text-xs leading-5 outline-none transition-smooth ${showPromptCustomize ? 'bg-white text-[#111827] focus:ring-2 focus:ring-inset focus:ring-[#ede9fe]' : 'bg-[#fbfcff] text-[#475569]'}`}
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
                      <AppIcon className={generatorDragActive ? 'ri-upload-cloud-2-line' : 'ri-file-upload-line'}></AppIcon>
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

                <section className="min-w-0 min-h-[420px] lg:min-h-0 lg:max-h-[calc(92vh-150px)] rounded-2xl border border-[#dbe3ee] bg-[#f8fafc] p-3 sm:p-4 flex flex-col overflow-hidden">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 shrink-0 rounded-xl bg-white border border-[#e2e8f0] px-4 py-3 shadow-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center shrink-0">
                          <AppIcon className="ri-eye-line"></AppIcon>
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
                        <AppIcon className="ri-sparkling-2-line text-xl"></AppIcon>
                      </span>
                      <p className="text-sm font-semibold text-foreground-700">No generated questions yet</p>
                      <p className="text-xs text-foreground-400 mt-1 max-w-sm">Add a topic, paste lesson content, or upload source files, then generate a preview.</p>
                    </div>
                  ) : (
                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden quiz-preview-scroll pr-1">
                      {generatedQuestions.map((question, questionIndex) => (
                        <div key={question.id} className="min-w-0 rounded-xl border border-[#dbe3ee] bg-white overflow-hidden shadow-sm">
                          <div className="flex items-start gap-3 sm:gap-4 p-4 sm:p-5 min-w-0">
                            <span className="w-10 h-10 rounded-xl bg-[#f2edff] text-[#5b21b6] border border-[#ded2ff] flex items-center justify-center text-sm font-bold shrink-0">{String(questionIndex + 1).padStart(2, '0')}</span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-2">
                                <p className="text-[15px] sm:text-base font-semibold text-[#0f172a] leading-7 break-words [overflow-wrap:anywhere]">{question.text}</p>
                                <span className="w-fit inline-flex items-center gap-1.5 text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-lg bg-[#e8eef5] text-[#526173] shrink-0">
                                  <AppIcon className="ri-question-answer-line"></AppIcon>
                                  {questionTypeOptions.find(option => option.value === question.questionType)?.label}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="border-t border-[#edf2f7] bg-[#fbfcff] p-4 sm:p-5">
                            <QuestionAnswersView type={question.questionType} answers={question.answers} fallbackText={question.explanation} compact />
                          </div>
                          {question.explanation && (
                            <div className="mx-4 sm:mx-5 mb-4 sm:mb-5 rounded-xl border border-[#ddd2ff] bg-[#fbf9ff] px-4 py-3.5">
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

        {showGradeSettings && (
          <GradeSettingsModal
            settings={gradeSettings}
            onChange={setGradeSettings}
            onClose={() => setShowGradeSettings(false)}
            onSaved={() => success('Grade settings updated', 'Default quiz grades now appear in the settings grade table.')}
          />
        )}

        {showGeneralSettings && (
          <GeneralQuizSettingsModal
            settings={generalSettings}
            onChange={setGeneralSettings}
            onClose={() => setShowGeneralSettings(false)}
            onSaved={() => success('General settings updated', 'Default quiz behaviour now applies to newly created quizzes.')}
          />
        )}

        {showManualCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={resetManualModal}>
            <form onSubmit={submitManualQuiz} className="w-full max-w-6xl max-h-[92vh] bg-background-50 rounded-2xl border border-foreground-200/60 shadow-xl flex flex-col overflow-hidden" onClick={event => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 p-5 border-b border-foreground-200/60">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary-600 mb-1">Manual Quiz Builder</p>
                  <h3 className="text-lg font-heading font-bold text-foreground-900">Create quiz manually</h3>
                  <p className="text-sm text-foreground-400">Add each question, choose its type, then mark the correct answer.</p>
                </div>
                <button type="button" onClick={resetManualModal} disabled={savingManualQuiz} className="w-9 h-9 rounded-lg bg-background-100 hover:bg-background-200 shrink-0 disabled:cursor-not-allowed disabled:opacity-50">
                  <AppIcon className="ri-close-line"></AppIcon>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto quiz-preview-scroll p-4 sm:p-5 space-y-5">
                <section className="rounded-xl border border-foreground-200/60 bg-white p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <input required value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Quiz title" className="sm:col-span-2 h-10 rounded-lg border border-foreground-200/60 px-3 text-sm outline-none focus:border-primary-400" />
                    <input value={form.version} onChange={event => setForm({ ...form, version: event.target.value })} placeholder="Version" className="h-10 rounded-lg border border-foreground-200/60 px-3 text-sm outline-none focus:border-primary-400" />
                    <input value={form.author} onChange={event => setForm({ ...form, author: event.target.value })} placeholder="Author" className="h-10 rounded-lg border border-foreground-200/60 px-3 text-sm outline-none focus:border-primary-400" />
                    <ThemedSelect
                      value={form.programme}
                      options={programmeOptions}
                      onChange={programme => setForm({ ...form, programme, module: '', programmeId: '', week: '', weekId: '' })}
                      menuClassName="max-h-56"
                    />
                    <ThemedSelect
                      value={form.module}
                      options={moduleOptions}
                      onChange={module => {
                        const selectedModule = moduleOptions.find(option => option.value === module);
                        setForm({ ...form, module, programmeId: selectedModule?.programmeId ? String(selectedModule.programmeId) : '', week: '', weekId: '' });
                      }}
                      disabled={!form.programme}
                      menuClassName="max-h-56"
                    />
                    <ThemedSelect
                      value={form.weekId}
                      options={formWeekOptions}
                      onChange={weekId => {
                        const selectedWeek = formWeeks.find(week => week.id === weekId);
                        setForm({ ...form, weekId, week: selectedWeek?.title || '' });
                      }}
                      disabled={!form.module || formWeeksState === 'loading' || formWeeks.length === 0}
                      menuClassName="max-h-56"
                    />
                    <ThemedSelect
                      value={form.status}
                      options={editableStatusOptions}
                      onChange={status => setForm({ ...form, status })}
                    />
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-heading font-bold text-foreground-900">Questions</h4>
                      <p className="text-xs text-foreground-400">{manualQuestions.length} question{manualQuestions.length === 1 ? '' : 's'} in this manual quiz.</p>
                    </div>
                    <button type="button" onClick={addManualQuestion} className="h-9 px-4 rounded-lg bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition-smooth w-full sm:w-auto">
                      <AppIcon className="ri-add-line mr-1"></AppIcon>Add question
                    </button>
                  </div>

                  {manualQuestions.map((question, questionIndex) => {
                    const answerCopy = answerEditorCopy(question.questionType);
                    const showCorrectSelector = !isAlwaysCorrectType(question.questionType);
                    const pairType = question.questionType === 'matching' || question.questionType === 'image_matching';
                    const canEditAnswerCount = question.questionType !== 'true_false';
                    const isOpen = openManualQuestionId === question.id;
                    const questionLabel = question.text.trim() || `Question ${questionIndex + 1}`;
                    const questionTypeLabel = questionTypeOptions.find(option => option.value === question.questionType)?.label || question.questionType;

                    return (
                      <article key={question.id} className="rounded-2xl border border-[#dbe3ee] bg-white overflow-hidden shadow-sm">
                        <button
                          type="button"
                          onClick={() => setOpenManualQuestionId(isOpen ? null : question.id)}
                          className={`w-full flex items-center gap-3 p-4 sm:p-5 text-left transition-smooth ${isOpen ? 'border-b border-[#edf2f7] bg-white' : 'bg-white hover:bg-[#fbfcff]'}`}
                        >
                          <span className="w-10 h-10 rounded-xl bg-[#f2edff] text-[#5b21b6] border border-[#ded2ff] flex items-center justify-center text-sm font-bold shrink-0">
                            {String(questionIndex + 1).padStart(2, '0')}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-foreground-900 truncate">{questionLabel}</span>
                            <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground-400">
                              <span>{questionTypeLabel}</span>
                              <span className="text-foreground-300">|</span>
                              <span>{question.answers.length} answer{question.answers.length === 1 ? '' : 's'}</span>
                            </span>
                          </span>
                          <span className="flex items-center gap-2 shrink-0">
                            <span className={`hidden sm:inline-flex text-[10px] font-bold uppercase px-2 py-1 rounded-md ${isOpen ? 'bg-primary-100 text-primary-700' : 'bg-foreground-100 text-foreground-500'}`}>
                              {isOpen ? 'Editing' : 'Collapsed'}
                            </span>
                            <AppIcon className={`${isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-xl text-foreground-400`}></AppIcon>
                          </span>
                        </button>

                        {isOpen && (
                          <>
                            <div className="flex flex-col lg:flex-row lg:items-start gap-4 p-4 sm:p-5 border-b border-[#edf2f7]">
                              <div className="min-w-0 flex-1 space-y-3">
                                <textarea
                                  required
                                  value={question.text}
                                  onChange={event => updateManualQuestion(question.id, { text: event.target.value })}
                                  placeholder="Question text"
                                  className="w-full min-h-24 rounded-xl border border-foreground-200/60 bg-background-50 p-3 text-sm leading-relaxed outline-none focus:border-primary-400"
                                />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <ThemedSelect
                                    value={question.questionType}
                                    options={questionTypeOptions}
                                    onChange={questionType => updateManualQuestionType(question.id, questionType)}
                                  />
                                  <input
                                    value={question.explanation}
                                    onChange={event => updateManualQuestion(question.id, { explanation: event.target.value })}
                                    placeholder="Feedback or explanation"
                                    className="h-10 rounded-lg border border-foreground-200/60 bg-background-50 px-3 text-sm outline-none focus:border-primary-400"
                                  />
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeManualQuestion(question.id)}
                                disabled={manualQuestions.length === 1}
                                className="h-9 px-3 rounded-lg bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed lg:self-start"
                              >
                                <AppIcon className="ri-delete-bin-line mr-1"></AppIcon>Remove
                              </button>
                            </div>

                            <div className="p-4 sm:p-5 bg-[#fbfcff]">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                            <div>
                              <h5 className="text-sm font-heading font-bold text-foreground-900">{answerCopy.title}</h5>
                              <p className="text-xs text-foreground-400">{answerCopy.hint}</p>
                            </div>
                            {canEditAnswerCount && (
                              <button type="button" onClick={() => addManualAnswer(question.id)} className="h-8 px-3 rounded-lg bg-white border border-primary-200 text-primary-700 text-xs font-semibold hover:bg-primary-50 w-full sm:w-auto">
                                <AppIcon className="ri-add-line mr-1"></AppIcon>{answerCopy.addLabel}
                              </button>
                            )}
                          </div>

                          <div className="space-y-3">
                            {question.answers.map((answer, answerIndex) => {
                              const pair = pairType
                                ? parseQuizPairAnswer(
                                  answer.text,
                                  question.questionType === 'image_matching' ? 'image_matching' : 'matching',
                                )
                                : null;
                              return (
                                <div key={answer.id} className="rounded-xl border border-foreground-200/60 bg-white p-3">
                                  <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                                    <span className="w-7 h-7 rounded-full bg-background-50 border border-foreground-200/60 flex items-center justify-center text-xs font-bold text-foreground-500 shrink-0">
                                      {String.fromCharCode(65 + answerIndex)}
                                    </span>
                                    {pairType ? (
                                      question.questionType === 'image_matching' ? (
                                        <ImageMatchingPairFields
                                          value={answer.text}
                                          onChange={nextValue => updateManualAnswerPair(question.id, answer.id, parseQuizPairAnswer(nextValue, 'image_matching'))}
                                        />
                                      ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 flex-1 min-w-0">
                                          <input
                                            value={pair?.left ?? ''}
                                            onChange={event => updateManualAnswerPair(question.id, answer.id, { left: event.target.value })}
                                            placeholder="Prompt"
                                            className="h-10 rounded-lg border border-foreground-200/60 bg-background-50 px-3 text-sm outline-none focus:border-primary-400"
                                          />
                                          <span className="hidden sm:flex items-center justify-center text-foreground-300">
                                            <AppIcon className="ri-arrow-right-line"></AppIcon>
                                          </span>
                                          <input
                                            value={pair?.right ?? ''}
                                            onChange={event => updateManualAnswerPair(question.id, answer.id, { right: event.target.value })}
                                            placeholder="Match"
                                            className="h-10 rounded-lg border border-foreground-200/60 bg-background-50 px-3 text-sm outline-none focus:border-primary-400"
                                          />
                                        </div>
                                      )
                                    ) : (
                                      <input
                                        value={answer.text}
                                        onChange={event => updateManualAnswer(question.id, answer.id, { text: event.target.value })}
                                        readOnly={question.questionType === 'true_false'}
                                        placeholder={question.questionType === 'ordering' ? 'Step in correct order' : 'Answer'}
                                        className="flex-1 min-w-0 h-10 rounded-lg border border-foreground-200/60 bg-background-50 px-3 text-sm outline-none focus:border-primary-400 read-only:bg-background-100"
                                      />
                                    )}
                                    {showCorrectSelector && (
                                      <label className="inline-flex items-center gap-2 text-sm text-foreground-700 shrink-0">
                                        <input
                                          type={question.questionType === 'multiple_choice' ? 'checkbox' : 'radio'}
                                          name={`manual-correct-${question.id}`}
                                          checked={answer.isCorrect}
                                          onChange={() => markManualCorrectAnswer(question.id, answer.id)}
                                          className="w-4 h-4"
                                        />
                                        Correct
                                      </label>
                                    )}
                                    {canEditAnswerCount && (
                                      <button
                                        type="button"
                                        onClick={() => removeManualAnswer(question.id, answer.id)}
                                        disabled={question.answers.length <= 1}
                                        className="w-9 h-9 rounded-lg bg-background-100 text-foreground-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                                        title="Remove answer"
                                      >
                                        <AppIcon className="ri-close-line"></AppIcon>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                            </div>
                          </>
                        )}
                      </article>
                    );
                  })}
                </section>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 border-t border-foreground-200/60 bg-white">
                <p className="text-xs text-foreground-400">The quiz will be saved with {manualQuestions.length} manual question{manualQuestions.length === 1 ? '' : 's'}.</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button type="button" disabled={savingManualQuiz} onClick={addManualQuestion} className="px-4 py-2 rounded-lg bg-white border border-primary-200 text-primary-700 text-sm font-semibold hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60">
                    <AppIcon className="ri-add-line mr-1"></AppIcon>Add question
                  </button>
                  <button type="button" disabled={savingManualQuiz} onClick={resetManualModal} className="px-4 py-2 rounded-lg bg-background-100 text-sm font-semibold hover:bg-background-200 disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
                  <button type="submit" disabled={savingManualQuiz} className="inline-flex min-w-32 items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 disabled:cursor-wait disabled:opacity-70">
                    {savingManualQuiz && <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true"></span>}
                    {savingManualQuiz ? 'Saving...' : 'Save Manual Quiz'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}

        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={resetModal}>
            <form onSubmit={submitQuiz} className="w-full max-w-xl bg-background-50 rounded-2xl border border-foreground-200/60 shadow-xl p-5" onClick={event => event.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-heading font-bold text-foreground-900">Add Quiz Package</h3>
                <button type="button" onClick={resetModal} disabled={savingQuiz} className="w-8 h-8 rounded-lg bg-background-100 hover:bg-background-200 disabled:cursor-not-allowed disabled:opacity-50"><AppIcon className="ri-close-line"></AppIcon></button>
              </div>
              {uploadFile && (
                <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-700 flex items-center gap-2 min-w-0">
                  <AppIcon className="ri-file-upload-line shrink-0"></AppIcon>
                  <span className="truncate min-w-0" title={`${uploadFile.name} ready to upload`}>{uploadFile.name} ready to upload</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Quiz title" className="sm:col-span-2 h-10 rounded-lg border border-foreground-200/60 px-3 text-sm" />
                <ThemedSelect
                  value={form.programme}
                  options={programmeOptions}
                  onChange={programme => setForm({ ...form, programme, module: '', programmeId: '', week: '', weekId: '' })}
                  menuClassName="max-h-56"
                />
                <ThemedSelect
                  value={form.module}
                  options={moduleOptions}
                  onChange={module => {
                    const selectedModule = moduleOptions.find(option => option.value === module);
                    setForm({ ...form, module, programmeId: selectedModule?.programmeId ? String(selectedModule.programmeId) : '', week: '', weekId: '' });
                  }}
                  disabled={!form.programme}
                  menuClassName="max-h-56"
                />
                <ThemedSelect
                  value={form.weekId}
                  options={formWeekOptions}
                  onChange={weekId => {
                    const selectedWeek = formWeeks.find(week => week.id === weekId);
                    setForm({ ...form, weekId, week: selectedWeek?.title || '' });
                  }}
                  disabled={!form.module || formWeeksState === 'loading' || formWeeks.length === 0}
                  menuClassName="max-h-56"
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
