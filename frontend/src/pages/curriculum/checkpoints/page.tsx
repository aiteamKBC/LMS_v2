<<<<<<< HEAD
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { ThemedSelect } from '@/components/feature/ThemedSelect';
=======
import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
import { roleNavMap } from '@/mocks/navigation';

const curriculumNav = roleNavMap.curriculum;

<<<<<<< HEAD
type CheckpointStatus = 'draft' | 'pending' | 'published' | 'private' | 'trash';
type StudentStatus = 'completed' | 'in_progress' | 'not_started';

interface StudentResult {
  id: string;
  name: string;
  cohort: string;
  status: StudentStatus;
  score: number | null;
  completedAt: string;
  ksbCoverage: number;
  strongestKsb: string;
  supportKsb: string;
}

interface MonthlyCheckpoint {
  id: number;
  programmeId: number | null;
  quizTitle: string;
  displayName: string;
  programme: string;
  module: string;
  month: string;
  week: string;
  weekId: string;
  uploadedAt: string;
  updatedAt: string;
  uploadedBy: string;
  questions: number;
  ksbRefs: string[];
  status: CheckpointStatus;
  students: StudentResult[];
  sourceFile?: string;
  packageType?: 'CSV' | 'XML' | 'SCORM';
}

interface QuizPackageResponse {
  id: number;
  title: string;
  programmeId: number | null;
  module: string;
  programme: string;
  questions: number;
  status: CheckpointStatus;
  packageType: string;
  fileName: string;
  author: string;
  weekId?: string;
  updatedAt: string;
  createdAt: string;
  assessmentType?: string;
}

interface CheckpointFormState {
  quizTitle: string;
  programme: string;
  module: string;
  month: string;
  week: string;
  questions: string;
  status: CheckpointStatus;
}

const programmeOptions = [
  { value: 'all', label: 'All programmes' },
  { value: 'APM lv4', label: 'APM lv4' },
  { value: 'ME L4 L4', label: 'ME L4 L4' },
  { value: 'MM LVL6 L6', label: 'MM LVL6 L6' },
  { value: 'PCP', label: 'PCP' },
];

const monthOptions = [
  { value: 'all', label: 'All months' },
  { value: 'Month 1', label: 'Month 1' },
  { value: 'Month 2', label: 'Month 2' },
  { value: 'Month 3', label: 'Month 3' },
  { value: 'Month 4', label: 'Month 4' },
];

const checkpointStatusOptions: { value: CheckpointStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'published', label: 'Published' },
  { value: 'private', label: 'Private' },
];

const statusOptions: { value: 'all' | CheckpointStatus; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  ...checkpointStatusOptions,
  { value: 'trash', label: 'Archive' },
];

const moduleOptionsByProgramme: Record<string, { value: string; label: string }[]> = {
  'APM lv4': [
    { value: 'APM', label: 'APM' },
    { value: 'Stakeholder Management', label: 'Stakeholder Management' },
  ],
  'ME L4 L4': [
    { value: 'Social', label: 'Social' },
    { value: 'Martech', label: 'Martech' },
    { value: 'Marketing Impact', label: 'Marketing Impact' },
  ],
  'MM LVL6 L6': [
    { value: 'AI In Marketing', label: 'AI In Marketing' },
    { value: 'Strategy & Planning', label: 'Strategy & Planning' },
    { value: 'Commercial Intelligence', label: 'Commercial Intelligence' },
  ],
  PCP: [
    { value: 'Planning Controls', label: 'Planning Controls' },
    { value: 'Risk Capability', label: 'Risk Capability' },
  ],
};

const initialCheckpoints: MonthlyCheckpoint[] = [];

const emptyForm: CheckpointFormState = {
  quizTitle: '',
  programme: 'MM LVL6 L6',
  module: 'AI In Marketing',
  month: 'Month 1',
  week: 'Week 4',
  questions: '20',
  status: 'draft',
};

function statusClass(status: CheckpointStatus) {
  if (status === 'published') return 'bg-emerald-100 text-emerald-700';
  if (status === 'pending') return 'bg-sky-100 text-sky-700';
  if (status === 'trash') return 'bg-red-100 text-red-700';
  if (status === 'private') return 'bg-slate-100 text-slate-700';
  return 'bg-amber-100 text-amber-700';
}

function statusLabel(status: CheckpointStatus) {
  if (status === 'published') return 'Published';
  if (status === 'pending') return 'Pending';
  if (status === 'trash') return 'Archive';
  if (status === 'private') return 'Private';
  return 'Draft';
}

function studentStatusClass(status: StudentStatus) {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700';
  if (status === 'in_progress') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

function averageScore(checkpoint: MonthlyCheckpoint) {
  const completed = checkpoint.students.filter(student => student.score !== null);
  if (!completed.length) return 0;
  return Math.round(completed.reduce((sum, student) => sum + (student.score ?? 0), 0) / completed.length);
}

function completionRate(checkpoint: MonthlyCheckpoint) {
  if (!checkpoint.students.length) return 0;
  return Math.round((checkpoint.students.filter(student => student.status === 'completed').length / checkpoint.students.length) * 100);
}

function checkpointPackageType(fileName: string): MonthlyCheckpoint['packageType'] {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'csv') return 'CSV';
  if (extension === 'xml') return 'XML';
  if (extension === 'zip' || extension === 'scorm') return 'SCORM';
  return undefined;
}

function titleFromFileName(fileName: string) {
  return fileName
    .replace(/\.(csv|xml|zip|scorm)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function questionCountFromFileName(fileName: string) {
  const rangeMatch = fileName.match(/q\s*(\d+)\s*[-_]\s*(\d+)/i);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return String(end - start + 1);
  }
  const countMatch = fileName.match(/(\d+)\s*(questions|qs|q)\b/i);
  return countMatch ? countMatch[1] : '';
}

function formatDate(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function checkpointTimingFromTitle(title: string) {
  const monthMatch = title.match(/month\s*\d+/i);
  const weekMatch = title.match(/week\s*\d+/i);
  return {
    month: monthMatch ? monthMatch[0].replace(/\s+/, ' ').replace(/^month/i, 'Month') : 'Month 1',
    week: weekMatch ? weekMatch[0].replace(/\s+/, ' ').replace(/^week/i, 'Week') : 'Week 4',
  };
}

function weekNumberFromLabel(value: string) {
  return value.match(/\d+/)?.[0] ?? '';
}

function buildWeekId(programmeId: number | null, week: string) {
  const weekNumber = weekNumberFromLabel(week);
  return programmeId && weekNumber ? `week-training-module-${programmeId}-${weekNumber}` : '';
}

function quizTitleFromCheckpointTitle(title: string) {
  return title
    .replace(/^\s*month\s*\d+\s*[-–]\s*week\s*\d+\s*[-–]\s*/i, '')
    .trim() || title;
}

function packageTypeLabel(packageType: string): MonthlyCheckpoint['packageType'] {
  if (packageType === 'csv') return 'CSV';
  if (packageType === 'scorm') return 'SCORM';
  return 'XML';
}

function quizToCheckpoint(quiz: QuizPackageResponse): MonthlyCheckpoint {
  const timing = checkpointTimingFromTitle(quiz.title);
  return {
    id: quiz.id,
    programmeId: quiz.programmeId,
    quizTitle: quizTitleFromCheckpointTitle(quiz.title),
    displayName: quiz.title,
    programme: quiz.programme || 'No programme',
    module: quiz.module || 'No module',
    month: timing.month,
    week: timing.week,
    weekId: quiz.weekId || buildWeekId(quiz.programmeId, timing.week),
    uploadedAt: formatDate(quiz.createdAt),
    updatedAt: formatDate(quiz.updatedAt),
    uploadedBy: quiz.author || 'Curriculum Team',
    questions: quiz.questions,
    ksbRefs: ['KSB pending'],
    status: quiz.status,
    students: [],
    sourceFile: quiz.fileName,
    packageType: packageTypeLabel(quiz.packageType),
  };
}

export default function CheckpointsPage() {
  const checkpointFileInputRef = useRef<HTMLInputElement | null>(null);
  const [checkpoints, setCheckpoints] = useState(initialCheckpoints);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [programmeFilter, setProgrammeFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | CheckpointStatus>('all');
  const [showArchive, setShowArchive] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [selectedQuizFile, setSelectedQuizFile] = useState<File | null>(null);
  const [editingCheckpoint, setEditingCheckpoint] = useState<MonthlyCheckpoint | null>(null);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<MonthlyCheckpoint | null>(null);
  const [savingCheckpoint, setSavingCheckpoint] = useState(false);
  const [modalError, setModalError] = useState('');

  const filtered = useMemo(() => checkpoints.filter(checkpoint => {
    if (programmeFilter !== 'all' && checkpoint.programme !== programmeFilter) return false;
    if (monthFilter !== 'all' && checkpoint.month !== monthFilter) return false;
    if (!showArchive && checkpoint.status === 'trash') return false;
    if (showArchive && checkpoint.status !== 'trash') return false;
    if (statusFilter !== 'all' && statusFilter !== 'trash' && checkpoint.status !== statusFilter) return false;
    return true;
  }), [checkpoints, monthFilter, programmeFilter, showArchive, statusFilter]);

  const totalStudents = checkpoints.reduce((sum, checkpoint) => sum + checkpoint.students.length, 0);
  const completedStudents = checkpoints.reduce((sum, checkpoint) => sum + checkpoint.students.filter(student => student.status === 'completed').length, 0);
  const liveCount = checkpoints.filter(checkpoint => checkpoint.status === 'published').length;
  const avgKsbCoverage = Math.round(
    checkpoints.reduce((sum, checkpoint) => sum + checkpoint.students.reduce((studentSum, student) => studentSum + student.ksbCoverage, 0), 0) / Math.max(totalStudents, 1),
  );

  const currentModuleOptions = moduleOptionsByProgramme[form.programme] ?? [];

  const loadCheckpoints = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ assessmentType: 'checkpoint' });
      if (showArchive) params.set('status', 'trash');
      const response = await fetch(`/quiz_api/quizzes/?${params.toString()}`);
      if (!response.ok) throw new Error('Could not load checkpoint quizzes');
      const data: { results: QuizPackageResponse[] } = await response.json();
      setCheckpoints(data.results.map(quizToCheckpoint));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load checkpoint quizzes');
    } finally {
      setLoading(false);
    }
  }, [showArchive]);

  useEffect(() => {
    void loadCheckpoints();
  }, [loadCheckpoints]);

  const handleCheckpointFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedQuizFile(file);
    if (!file) return;

    const detectedQuestions = questionCountFromFileName(file.name);
    setForm(current => ({
      ...current,
      quizTitle: current.quizTitle || titleFromFileName(file.name),
      questions: detectedQuestions || current.questions,
    }));
  };

  const closeCreateModal = () => {
    setShowCreate(false);
    setEditingCheckpoint(null);
    setForm(emptyForm);
    setSelectedQuizFile(null);
    setModalError('');
    setSavingCheckpoint(false);
    if (checkpointFileInputRef.current) checkpointFileInputRef.current.value = '';
  };

  const openCreateModal = () => {
    setEditingCheckpoint(null);
    setForm(emptyForm);
    setSelectedQuizFile(null);
    setModalError('');
    if (checkpointFileInputRef.current) checkpointFileInputRef.current.value = '';
    setShowCreate(true);
  };

  const openCheckpointEditor = (checkpoint: MonthlyCheckpoint) => {
    window.location.href = `/curriculum/quiz-xml/${checkpoint.id}/edit`;
  };

  const updateCheckpointStatus = async (checkpoint: MonthlyCheckpoint, status: CheckpointStatus) => {
    setError('');
    try {
      const response = await fetch(`/quiz_api/quizzes/${checkpoint.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, assessmentType: 'checkpoint' }),
      });
      if (!response.ok) throw new Error('Could not update checkpoint status');
      await loadCheckpoints();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update checkpoint status');
    }
  };

  const deleteCheckpoint = async (checkpoint: MonthlyCheckpoint) => {
    setError('');
    try {
      const response = await fetch(`/quiz_api/quizzes/${checkpoint.id}/`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete checkpoint quiz');
      await loadCheckpoints();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete checkpoint quiz');
    }
  };

  const submitCheckpoint = async (event: FormEvent) => {
    event.preventDefault();
    const displayName = `${form.month} - ${form.week} - ${form.quizTitle || 'Monthly Checkpoint Quiz'}`;

    if (editingCheckpoint) {
      try {
        setError('');
        setModalError('');
        setSavingCheckpoint(true);
        const response = await fetch(`/quiz_api/quizzes/${editingCheckpoint.id}/`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: displayName,
            programme: form.programme,
            module: form.module || currentModuleOptions[0]?.value || 'No module',
            week: form.week,
            weekId: buildWeekId(editingCheckpoint.programmeId, form.week),
            questions: Number(form.questions || editingCheckpoint.questions || 20),
            status: form.status,
            assessmentType: 'checkpoint',
          }),
        });
        if (!response.ok) throw new Error('Could not update checkpoint quiz');
        await loadCheckpoints();
        closeCreateModal();
      } catch (err) {
        setModalError(err instanceof Error ? err.message : 'Could not update checkpoint quiz');
      } finally {
        setSavingCheckpoint(false);
      }
      return;
    }

    try {
      setError('');
      setModalError('');
      setSavingCheckpoint(true);
      let response: Response;
      if (selectedQuizFile) {
        const body = new FormData();
        body.append('file', selectedQuizFile);
        body.append('title', displayName);
        body.append('programme', form.programme);
        body.append('module', form.module || currentModuleOptions[0]?.value || 'No module');
        body.append('week', form.week);
        body.append('questions', String(Number(form.questions || 20)));
        body.append('status', form.status);
        body.append('assessmentType', 'checkpoint');
        response = await fetch('/quiz_api/quizzes/', { method: 'POST', body });
      } else {
        response = await fetch('/quiz_api/quizzes/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: displayName,
            programme: form.programme,
            module: form.module || currentModuleOptions[0]?.value || 'No module',
            week: form.week,
            questions: Number(form.questions || 20),
            status: form.status,
            assessmentType: 'checkpoint',
            packageType: 'xml',
          }),
        });
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Could not save checkpoint quiz');
      }
      await response.json();
      await loadCheckpoints();
      setForm(emptyForm);
      closeCreateModal();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Could not save checkpoint quiz');
    } finally {
      setSavingCheckpoint(false);
    }
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Checkpoint Assessments" pageSubtitle="Monthly checkpoint quizzes and learner KSB performance" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        <section className="relative overflow-hidden rounded-2xl shadow-sm" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 52%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-check-double-line text-white text-2xl"></i>
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Monthly Checkpoint Assessments</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                {checkpoints.length} checkpoint quizzes, {liveCount} published. Coaches can review monthly learner results and KSB achievement from one place.
              </p>
            </div>
            <div className="grid w-full grid-cols-3 gap-3 shrink-0 sm:w-auto">
              <div className="rounded-xl bg-white/15 backdrop-blur-sm px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{checkpoints.length}</p>
                <p className="text-[10px] uppercase tracking-wide text-white/70">Quizzes</p>
              </div>
              <div className="rounded-xl bg-white/15 backdrop-blur-sm px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{completedStudents}/{totalStudents}</p>
                <p className="text-[10px] uppercase tracking-wide text-white/70">Completed</p>
              </div>
              <div className="rounded-xl bg-white/15 backdrop-blur-sm px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{avgKsbCoverage}%</p>
                <p className="text-[10px] uppercase tracking-wide text-white/70">KSBs</p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-foreground-200/50 bg-background-100 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <ThemedSelect value={programmeFilter} options={programmeOptions} onChange={setProgrammeFilter} className="w-full sm:w-48" />
            <ThemedSelect value={monthFilter} options={monthOptions} onChange={setMonthFilter} className="w-full sm:w-40" />
            <ThemedSelect value={statusFilter} options={statusOptions} onChange={setStatusFilter} className="w-full sm:w-44" />
            <div className="min-w-[240px] flex-1 rounded-lg bg-white/70 px-3 py-2 text-xs text-[#647083]">
              Quiz names are generated as <strong>Month - Week - Quiz title</strong> so coaches can track monthly progress.
            </div>
            <button
              onClick={() => {
                setShowArchive(current => !current);
                setStatusFilter('all');
              }}
              className={`h-10 w-full rounded-lg border px-4 text-sm font-semibold transition-smooth sm:w-auto ${
                showArchive
                  ? 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100'
                  : 'border-[#d8dde6] bg-white text-[#5b2dbb] hover:bg-[#f7f3ff]'
              }`}
            >
              <i className={`${showArchive ? 'ri-arrow-go-back-line' : 'ri-archive-line'} mr-1`}></i>{showArchive ? 'Back to active' : 'Archive'}
            </button>
            <button onClick={openCreateModal} className="h-10 w-full rounded-lg bg-primary-500 px-4 text-sm font-semibold text-white transition-smooth hover:bg-primary-600 sm:w-auto">
              <i className="ri-upload-cloud-2-line mr-1"></i>Upload checkpoint quiz
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-foreground-200/60 bg-background-50 overflow-hidden">
          <div className="overflow-x-auto">
          <div className="hidden min-w-[980px] md:grid grid-cols-[2fr_1fr_110px_110px_120px_110px_170px] gap-4 border-b border-foreground-300/50 bg-background-100/60 px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-foreground-500">
            <span>Checkpoint quiz</span>
            <span>Programme</span>
            <span>Timing</span>
            <span>Avg score</span>
            <span>Completion</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>
          <div className="min-w-0 divide-y divide-foreground-200/40 md:min-w-[980px]">
            {loading && (
              <div className="px-5 py-12 text-center text-sm text-foreground-400">Loading checkpoint quizzes...</div>
            )}
            {!loading && error && (
              <div className="mx-5 my-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <div className="px-5 py-12 text-center text-sm text-foreground-400">{showArchive ? 'No archived checkpoint quizzes yet' : 'No checkpoint quizzes match this filter'}</div>
            )}
            {!loading && !error && filtered.map(checkpoint => (
              <article key={checkpoint.id} className="grid grid-cols-1 gap-4 px-5 py-4 transition-smooth hover:bg-background-100/40 md:grid-cols-[2fr_1fr_110px_110px_120px_110px_170px] md:items-center">
                <div className="min-w-0">
                  <h3 className="text-sm font-heading font-bold text-foreground-900 leading-6 break-words">{checkpoint.displayName}</h3>
                  <p className="text-xs text-foreground-400 mt-1">{checkpoint.module} - {checkpoint.questions} questions - uploaded {checkpoint.uploadedAt}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {checkpoint.ksbRefs.map(ref => (
                      <span key={ref} className="rounded-full bg-[#f2f0ff] px-2 py-1 text-[10px] font-bold text-[#5b2dbb]">{ref}</span>
                    ))}
                  </div>
                </div>
                <p className="text-sm text-foreground-700"><span className="md:hidden text-xs font-bold uppercase text-foreground-400">Programme: </span>{checkpoint.programme}</p>
                <p className="text-sm font-semibold text-foreground-900">
                  <span className="md:hidden text-xs font-bold uppercase text-foreground-400">Timing: </span>{checkpoint.month}
                  <br />
                  <span className="text-xs font-normal text-foreground-400">{checkpoint.week}</span>
                  <br />
                  <span className="text-[11px] font-normal text-foreground-400">{checkpoint.weekId || 'Week ID pending'}</span>
                </p>
                <p className="text-sm font-bold text-foreground-900"><span className="md:hidden text-xs font-bold uppercase text-foreground-400">Avg score: </span>{averageScore(checkpoint)}%</p>
                <div>
                  <p className="text-sm font-bold text-foreground-900"><span className="md:hidden text-xs font-bold uppercase text-foreground-400">Completion: </span>{completionRate(checkpoint)}%</p>
                  <div className="mt-1 h-2 max-w-40 rounded-full bg-background-300">
                    <div className="h-2 rounded-full bg-primary-500" style={{ width: `${completionRate(checkpoint)}%` }}></div>
                  </div>
                </div>
                <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${statusClass(checkpoint.status)}`}>{statusLabel(checkpoint.status)}</span>
                <div className="flex items-center justify-start gap-2 md:justify-end">
                  {showArchive ? (
                    <>
                      <button onClick={() => updateCheckpointStatus(checkpoint, 'draft')} className="h-9 rounded-lg bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 transition-smooth hover:bg-emerald-100">
                        <i className="ri-arrow-go-back-line mr-1"></i>Restore
                      </button>
                      <button onClick={() => deleteCheckpoint(checkpoint)} className="h-9 rounded-lg bg-red-50 px-3 text-xs font-semibold text-red-700 transition-smooth hover:bg-red-100">
                        <i className="ri-delete-bin-line mr-1"></i>Delete
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setSelectedCheckpoint(checkpoint)} className="h-9 rounded-lg bg-primary-500 px-3 text-xs font-semibold text-white transition-smooth hover:bg-primary-600">
                        <i className="ri-team-line mr-1"></i>Manage students
                      </button>
                      <button onClick={() => openCheckpointEditor(checkpoint)} className="h-9 w-9 rounded-lg bg-background-100 border border-foreground-200/60 transition-smooth hover:bg-background-200" title="Edit checkpoint">
                        <i className="ri-pencil-line"></i>
                      </button>
                      <button onClick={() => updateCheckpointStatus(checkpoint, 'trash')} className="h-9 w-9 rounded-lg bg-orange-50 text-orange-700 border border-orange-100 transition-smooth hover:bg-orange-100" title="Archive checkpoint">
                        <i className="ri-archive-line"></i>
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
          </div>
        </section>

        <input ref={checkpointFileInputRef} type="file" accept=".csv,.xml,.zip,.scorm" className="hidden" onChange={handleCheckpointFileChange} />

        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeCreateModal}>
            <form onSubmit={submitCheckpoint} className="w-full max-w-2xl rounded-2xl border border-[#d8dde6] bg-white p-5 shadow-xl" onClick={event => event.stopPropagation()}>
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[#5b2dbb]">Monthly checkpoint</p>
                  <h3 className="text-lg font-heading font-bold text-[#0f172a]">{editingCheckpoint ? 'Edit checkpoint quiz' : 'Upload checkpoint quiz'}</h3>
                  <p className="text-sm text-[#647083]">{editingCheckpoint ? 'Update the checkpoint details, timing, file and publishing status.' : 'The quiz name will include the month and programme week automatically.'}</p>
                </div>
                <button type="button" onClick={closeCreateModal} className="h-9 w-9 rounded-lg bg-[#f8fafc] hover:bg-[#f1f5f9]"><i className="ri-close-line"></i></button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input value={form.quizTitle} onChange={event => setForm({ ...form, quizTitle: event.target.value })} placeholder="Quiz title" className="sm:col-span-2 h-11 rounded-lg border border-[#d8dde6] px-3 text-sm outline-none focus:border-[#8b5cf6]" />
                <ThemedSelect value={form.programme} options={programmeOptions.filter(option => option.value !== 'all')} onChange={programme => setForm({ ...form, programme, module: moduleOptionsByProgramme[programme]?.[0]?.value ?? '' })} />
                <ThemedSelect value={form.module} options={currentModuleOptions} onChange={module => setForm({ ...form, module })} />
                <ThemedSelect value={form.month} options={monthOptions.filter(option => option.value !== 'all')} onChange={month => setForm({ ...form, month })} />
                <input value={form.week} onChange={event => setForm({ ...form, week: event.target.value })} placeholder="Week, e.g. Week 8" className="h-11 rounded-lg border border-[#d8dde6] px-3 text-sm outline-none focus:border-[#8b5cf6]" />
                <input type="number" min="1" value={form.questions} onChange={event => setForm({ ...form, questions: event.target.value })} placeholder="Questions" className="h-11 rounded-lg border border-[#d8dde6] px-3 text-sm outline-none focus:border-[#8b5cf6]" />
                <ThemedSelect value={form.status} options={checkpointStatusOptions} onChange={status => setForm({ ...form, status })} />
                {editingCheckpoint ? (
                  <div className="flex h-11 items-center rounded-lg border border-[#d8dde6] bg-[#f8fafc] px-3 text-sm text-[#647083]">
                    <i className="ri-file-list-line mr-1 text-[#5b2dbb]"></i>
                    <span className="truncate">{editingCheckpoint.sourceFile || `${editingCheckpoint.packageType || 'Quiz'} package`}</span>
                  </div>
                ) : (
                  <button type="button" onClick={() => checkpointFileInputRef.current?.click()} className="h-11 rounded-lg border border-dashed border-[#c4b5fd] bg-[#f7f2ff] px-3 text-sm font-semibold text-[#5b2dbb] hover:bg-[#f2edff]">
                    <i className="ri-file-upload-line mr-1"></i>{selectedQuizFile ? 'Change quiz file' : 'Choose quiz file'}
                  </button>
                )}
              </div>
              {!editingCheckpoint && selectedQuizFile && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#c4b5fd] bg-[#f7f2ff] px-3 py-2 text-sm text-[#4c1d95]">
                  <span className="min-w-0 truncate font-semibold">
                    <i className="ri-file-check-line mr-1"></i>{selectedQuizFile.name}
                  </span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-[#5b2dbb]">
                    {checkpointPackageType(selectedQuizFile.name) || 'File'}
                  </span>
                </div>
              )}
              <div className="mt-4 rounded-xl bg-[#f8fafc] p-3 text-sm text-[#475569]">
                Preview name: <strong>{`${form.month} - ${form.week} - ${form.quizTitle || 'Monthly Checkpoint Quiz'}`}</strong>
                <br />
                Week ID: <strong>{editingCheckpoint ? buildWeekId(editingCheckpoint.programmeId, form.week) || editingCheckpoint.weekId || 'Pending until saved' : 'Generated after save'}</strong>
              </div>
              {modalError && (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {modalError}
                </div>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={closeCreateModal} disabled={savingCheckpoint} className="h-10 px-4 rounded-lg bg-[#f8fafc] text-sm font-semibold hover:bg-[#f1f5f9] disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={savingCheckpoint} className="h-10 px-4 rounded-lg bg-[#5b2dbb] text-white text-sm font-semibold hover:bg-[#4c1d95] disabled:cursor-not-allowed disabled:opacity-60">
                  {savingCheckpoint ? 'Saving...' : editingCheckpoint ? 'Save changes' : 'Save checkpoint'}
                </button>
              </div>
            </form>
          </div>
        )}

        {selectedCheckpoint && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelectedCheckpoint(null)}>
            <div className="w-full max-w-6xl max-h-[90vh] overflow-hidden rounded-2xl border border-[#d8dde6] bg-white shadow-xl" onClick={event => event.stopPropagation()}>
              <div className="border-b border-[#e2e8f0] p-5 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[#5b2dbb]">Manage students</p>
                  <h3 className="text-lg font-heading font-bold text-[#0f172a]">{selectedCheckpoint.displayName}</h3>
                  <p className="text-sm text-[#647083]">{selectedCheckpoint.programme} - {selectedCheckpoint.module}</p>
                </div>
                <button onClick={() => setSelectedCheckpoint(null)} className="h-9 w-9 rounded-lg bg-[#f8fafc] hover:bg-[#f1f5f9]"><i className="ri-close-line"></i></button>
              </div>
              <div className="max-h-[calc(90vh-92px)] overflow-y-auto p-5 quiz-preview-scroll">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 mb-5">
                  <div className="rounded-xl bg-[#f8fafc] p-4"><p className="text-2xl font-bold">{selectedCheckpoint.students.length}</p><p className="text-xs text-[#647083]">Learners</p></div>
                  <div className="rounded-xl bg-[#f8fafc] p-4"><p className="text-2xl font-bold">{completionRate(selectedCheckpoint)}%</p><p className="text-xs text-[#647083]">Completion</p></div>
                  <div className="rounded-xl bg-[#f8fafc] p-4"><p className="text-2xl font-bold">{averageScore(selectedCheckpoint)}%</p><p className="text-xs text-[#647083]">Average score</p></div>
                  <div className="rounded-xl bg-[#f8fafc] p-4"><p className="text-2xl font-bold">{Math.round(selectedCheckpoint.students.reduce((sum, student) => sum + student.ksbCoverage, 0) / Math.max(selectedCheckpoint.students.length, 1))}%</p><p className="text-xs text-[#647083]">KSB achievement</p></div>
                </div>

                {selectedCheckpoint.students.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#d8dde6] bg-[#f8fafc] p-10 text-center">
                    <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f2f0ff] text-[#5b2dbb]">
                      <i className="ri-team-line text-xl"></i>
                    </span>
                    <p className="text-sm font-semibold text-[#0f172a]">No student attempts yet</p>
                    <p className="mt-1 text-xs text-[#647083]">Learners will appear here after they start or complete this checkpoint quiz.</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[#d8dde6] overflow-hidden">
                    <div className="hidden md:grid grid-cols-[1.4fr_110px_110px_130px_120px_120px] gap-3 bg-[#f8fafc] px-4 py-3 text-[11px] font-bold uppercase text-[#526173]">
                      <span>Student</span>
                      <span>Status</span>
                      <span>Score</span>
                      <span>KSB coverage</span>
                      <span>Strongest KSB</span>
                      <span>Support focus</span>
                    </div>
                    <div className="divide-y divide-[#e2e8f0]">
                      {selectedCheckpoint.students.map(student => (
                        <div key={student.id} className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[1.4fr_110px_110px_130px_120px_120px] md:items-center">
                          <div>
                            <p className="text-sm font-semibold text-[#0f172a]">{student.name}</p>
                            <p className="text-xs text-[#647083]">{student.cohort} - completed {student.completedAt}</p>
                          </div>
                          <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold capitalize ${studentStatusClass(student.status)}`}>{student.status.replace('_', ' ')}</span>
                          <p className="text-sm font-bold text-[#0f172a]">{student.score === null ? '-' : `${student.score}%`}</p>
                          <div>
                            <p className="text-sm font-bold text-[#0f172a]">{student.ksbCoverage}%</p>
                            <div className="mt-1 h-2 rounded-full bg-[#e2e8f0]"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${student.ksbCoverage}%` }}></div></div>
                          </div>
                          <p className="text-sm text-[#334155]">{student.strongestKsb}</p>
                          <p className="text-sm font-semibold text-[#b45309]">{student.supportKsb}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
=======
interface Checkpoint {
  id: string;
  title: string;
  module: string;
  programme: string;
  week: string;
  type: string;
  ksbRefs: string[];
  passRate: number;
  submissions: number;
  avgScore: number;
  status: 'active' | 'draft' | 'archived';
  lastReviewed: string;
  gatewayLink: boolean;
}

const CHECKPOINTS: Checkpoint[] = [
  { id: 'cp-01', title: 'Business Communication Fundamentals', module: 'Business Communication', programme: 'Business Admin L3', week: 'Week 4', type: 'Knowledge Check', ksbRefs: ['K1', 'K2', 'K3'], passRate: 88, submissions: 42, avgScore: 76, status: 'active', lastReviewed: '5 Jun 2026', gatewayLink: false },
  { id: 'cp-02', title: 'Written Communication Assessment', module: 'Business Communication', programme: 'Business Admin L3', week: 'Week 8', type: 'Skills Assessment', ksbRefs: ['K4', 'S3', 'S4'], passRate: 72, submissions: 38, avgScore: 68, status: 'active', lastReviewed: '3 Jun 2026', gatewayLink: false },
  { id: 'cp-03', title: 'Organisational Culture Mid-Module Check', module: 'Organisational Culture', programme: 'Business Admin L3', week: 'Week 14', type: 'Knowledge Check', ksbRefs: ['K8', 'K9'], passRate: 91, submissions: 35, avgScore: 82, status: 'active', lastReviewed: '1 Jun 2026', gatewayLink: false },
  { id: 'cp-04', title: 'Data Visualisation Competency Test', module: 'Data Visualisation', programme: 'Data Analyst L4', week: 'Week 6', type: 'Competency Test', ksbRefs: ['K10', 'S9', 'S10'], passRate: 65, submissions: 28, avgScore: 62, status: 'active', lastReviewed: '4 Jun 2026', gatewayLink: true },
  { id: 'cp-05', title: 'Statistical Methods — Hypothesis Testing', module: 'Statistical Analysis', programme: 'Data Analyst L4', week: 'Week 10', type: 'Skills Assessment', ksbRefs: ['S11', 'S12', 'S13'], passRate: 58, submissions: 22, avgScore: 55, status: 'active', lastReviewed: '2 Jun 2026', gatewayLink: false },
  { id: 'cp-06', title: 'Segmentation Strategy Checkpoint', module: 'Marketing Planning', programme: 'Marketing Exec L4', week: 'Week 5', type: 'Knowledge Check', ksbRefs: ['K5', 'S8'], passRate: 85, submissions: 30, avgScore: 78, status: 'active', lastReviewed: '28 May 2026', gatewayLink: false },
  { id: 'cp-07', title: 'Gateway — Module 2 Readiness', module: 'Business Communication', programme: 'Business Admin L3', week: 'Week 12', type: 'Gateway Check', ksbRefs: ['K1', 'K2', 'K3', 'K4', 'S1', 'S2', 'S3', 'S4', 'B1', 'B2'], passRate: 74, submissions: 40, avgScore: 71, status: 'active', lastReviewed: '5 Jun 2026', gatewayLink: true },
  { id: 'cp-08', title: 'Digital Channels Practical Assessment', module: 'Digital Channels', programme: 'Marketing Exec L4', week: 'Week 8', type: 'Practical Assessment', ksbRefs: ['K7', 'S10', 'S11'], passRate: 80, submissions: 18, avgScore: 74, status: 'draft', lastReviewed: '22 May 2026', gatewayLink: false },
];

export default function CheckpointsPage() {
  const [selectedCP, setSelectedCP] = useState<Checkpoint | null>(null);
  const [filterProgramme, setFilterProgramme] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');

  const programmes = ['all', 'Business Admin L3', 'Data Analyst L4', 'Marketing Exec L4'];
  const types = ['all', 'Knowledge Check', 'Skills Assessment', 'Competency Test', 'Gateway Check', 'Practical Assessment'];

  const filtered = CHECKPOINTS.filter(c => {
    if (filterProgramme !== 'all' && c.programme !== filterProgramme) return false;
    if (filterType !== 'all' && c.type !== filterType) return false;
    return true;
  });

  const active = CHECKPOINTS.filter(c => c.status === 'active').length;
  const avgPass = Math.round(CHECKPOINTS.reduce((s, c) => s + c.passRate, 0) / CHECKPOINTS.length);
  const totalSubs = CHECKPOINTS.reduce((s, c) => s + c.submissions, 0);
  const gatewayCPs = CHECKPOINTS.filter(c => c.gatewayLink).length;

  const typeColors: Record<string, string> = {
    'Knowledge Check': 'bg-primary-100 text-primary-700',
    'Skills Assessment': 'bg-accent-100 text-accent-700',
    'Competency Test': 'bg-rose-100 text-rose-700',
    'Gateway Check': 'bg-amber-100 text-amber-700',
    'Practical Assessment': 'bg-emerald-100 text-emerald-700',
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Checkpoint Assessments" pageSubtitle="Module checkpoint assessments — knowledge checks, skills tests and gateway readiness" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        {/* Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-check-double-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Checkpoint Assessments</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{CHECKPOINTS.length} checkpoints</strong> — {active} active. Avg pass rate: {avgPass}%. {totalSubs} total submissions. {gatewayCPs} gateway-linked.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{CHECKPOINTS.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Checkpoints</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{avgPass}%</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Pass Rate</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{totalSubs}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Submissions</p></div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {programmes.map(p => (
              <button key={p} onClick={() => setFilterProgramme(p)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filterProgramme === p ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{p === 'all' ? 'All Programmes' : p}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {types.map(t => (
              <button key={t} onClick={() => setFilterType(t)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filterType === t ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{t === 'all' ? 'All Types' : t}</button>
            ))}
          </div>
          <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-add-line mr-1"></i> New Checkpoint</button>
        </div>

        {/* Table */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_0.8fr_0.8fr_0.8fr_0.8fr_1fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
            <span>Checkpoint</span>
            <span>Type</span>
            <span className="text-center">Week</span>
            <span className="text-center">Pass Rate</span>
            <span className="text-center">Avg Score</span>
            <span className="text-center">Submissions</span>
            <span className="text-center">Status</span>
            <span className="text-center">Action</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(c => (
              <div key={c.id} onClick={() => setSelectedCP(c)} className={`grid grid-cols-[2fr_1fr_1fr_0.8fr_0.8fr_0.8fr_0.8fr_1fr] gap-3 px-4 py-3 items-center cursor-pointer transition-smooth ${selectedCP?.id === c.id ? 'bg-primary-50/40 border-l-2 border-l-primary-400' : 'hover:bg-background-100/30'}`}>
                <div className="flex items-center gap-2 min-w-0">
                  {c.gatewayLink && <i className="ri-flag-line text-amber-500 text-sm shrink-0" title="Gateway-linked"></i>}
                  <div className="min-w-0">
                    <span className="text-[12px] font-medium text-foreground-900 block truncate">{c.title}</span>
                    <span className="text-[10px] text-foreground-400">{c.module}</span>
                  </div>
                </div>
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full w-fit whitespace-nowrap ${typeColors[c.type] || 'bg-foreground-100 text-foreground-500'}`}>{c.type}</span>
                <span className="text-[11px] text-foreground-500 text-center">{c.week}</span>
                <div className="flex items-center justify-center gap-1.5">
                  <div className="w-10 bg-background-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${c.passRate >= 80 ? 'bg-emerald-500' : c.passRate >= 65 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${c.passRate}%` }}></div>
                  </div>
                  <span className={`text-[11px] font-semibold ${c.passRate >= 80 ? 'text-emerald-600' : c.passRate >= 65 ? 'text-amber-600' : 'text-red-600'}`}>{c.passRate}%</span>
                </div>
                <span className="text-[11px] text-foreground-500 text-center">{c.avgScore}</span>
                <span className="text-[11px] text-foreground-500 text-center">{c.submissions}</span>
                <div className="flex justify-center">
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${c.status === 'active' ? 'bg-emerald-100 text-emerald-700' : c.status === 'draft' ? 'bg-foreground-100 text-foreground-500' : 'bg-foreground-100 text-foreground-500'}`}>{c.status}</span>
                </div>
                <div className="flex justify-center">
                  <button className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Review</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail Panel */}
        {selectedCP && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-heading font-bold text-foreground-900">{selectedCP.title}</h3>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${typeColors[selectedCP.type]}`}>{selectedCP.type}</span>
                  {selectedCP.gatewayLink && <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Gateway</span>}
                </div>
                <p className="text-[11px] text-foreground-400">{selectedCP.module} · {selectedCP.programme} · {selectedCP.week}</p>
              </div>
              <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${selectedCP.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-500'}`}>{selectedCP.status}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
              {[
                { label: 'Pass Rate', value: `${selectedCP.passRate}%` },
                { label: 'Avg Score', value: String(selectedCP.avgScore) },
                { label: 'Submissions', value: String(selectedCP.submissions) },
                { label: 'Last Reviewed', value: selectedCP.lastReviewed },
                { label: 'KSB Refs', value: selectedCP.ksbRefs.length.toString() },
              ].map(s => (
                <div key={s.label} className="bg-background-100/50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-foreground-900">{s.value}</p>
                  <p className="text-[10px] text-foreground-400">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-edit-line mr-1"></i> Edit Checkpoint</button>
              <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-bar-chart-2-line mr-1"></i> View Analytics</button>
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
<<<<<<< HEAD
}
=======
}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
