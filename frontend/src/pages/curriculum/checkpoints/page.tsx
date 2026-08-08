import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { ThemedSelect } from '@/components/feature/ThemedSelect';
import { roleNavMap } from '@/mocks/navigation';

const curriculumNav = roleNavMap.curriculum;

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
              <AppIcon className="ri-check-double-line text-white text-2xl"></AppIcon>
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
              <AppIcon className={`${showArchive ? 'ri-arrow-go-back-line' : 'ri-archive-line'} mr-1`}></AppIcon>{showArchive ? 'Back to active' : 'Archive'}
            </button>
            <button onClick={openCreateModal} className="h-10 w-full rounded-lg bg-primary-500 px-4 text-sm font-semibold text-white transition-smooth hover:bg-primary-600 sm:w-auto">
              <AppIcon className="ri-upload-cloud-2-line mr-1"></AppIcon>Upload checkpoint quiz
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
                        <AppIcon className="ri-arrow-go-back-line mr-1"></AppIcon>Restore
                      </button>
                      <button onClick={() => deleteCheckpoint(checkpoint)} className="h-9 rounded-lg bg-red-50 px-3 text-xs font-semibold text-red-700 transition-smooth hover:bg-red-100">
                        <AppIcon className="ri-delete-bin-line mr-1"></AppIcon>Delete
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setSelectedCheckpoint(checkpoint)} className="h-9 rounded-lg bg-primary-500 px-3 text-xs font-semibold text-white transition-smooth hover:bg-primary-600">
                        <AppIcon className="ri-team-line mr-1"></AppIcon>Manage students
                      </button>
                      <button onClick={() => openCheckpointEditor(checkpoint)} className="h-9 w-9 rounded-lg bg-background-100 border border-foreground-200/60 transition-smooth hover:bg-background-200" title="Edit checkpoint">
                        <AppIcon className="ri-pencil-line"></AppIcon>
                      </button>
                      <button onClick={() => updateCheckpointStatus(checkpoint, 'trash')} className="h-9 w-9 rounded-lg bg-orange-50 text-orange-700 border border-orange-100 transition-smooth hover:bg-orange-100" title="Archive checkpoint">
                        <AppIcon className="ri-archive-line"></AppIcon>
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
                <button type="button" onClick={closeCreateModal} className="h-9 w-9 rounded-lg bg-[#f8fafc] hover:bg-[#f1f5f9]"><AppIcon className="ri-close-line"></AppIcon></button>
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
                    <AppIcon className="ri-file-list-line mr-1 text-[#5b2dbb]"></AppIcon>
                    <span className="truncate">{editingCheckpoint.sourceFile || `${editingCheckpoint.packageType || 'Quiz'} package`}</span>
                  </div>
                ) : (
                  <button type="button" onClick={() => checkpointFileInputRef.current?.click()} className="h-11 rounded-lg border border-dashed border-[#c4b5fd] bg-[#f7f2ff] px-3 text-sm font-semibold text-[#5b2dbb] hover:bg-[#f2edff]">
                    <AppIcon className="ri-file-upload-line mr-1"></AppIcon>{selectedQuizFile ? 'Change quiz file' : 'Choose quiz file'}
                  </button>
                )}
              </div>
              {!editingCheckpoint && selectedQuizFile && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#c4b5fd] bg-[#f7f2ff] px-3 py-2 text-sm text-[#4c1d95]">
                  <span className="min-w-0 truncate font-semibold">
                    <AppIcon className="ri-file-check-line mr-1"></AppIcon>{selectedQuizFile.name}
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
                <button onClick={() => setSelectedCheckpoint(null)} className="h-9 w-9 rounded-lg bg-[#f8fafc] hover:bg-[#f1f5f9]"><AppIcon className="ri-close-line"></AppIcon></button>
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
                      <AppIcon className="ri-team-line text-xl"></AppIcon>
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
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
