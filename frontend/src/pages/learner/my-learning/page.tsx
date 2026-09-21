import { useMemo, useState } from 'react';
import { StudentActivityPanel as SubjectCardsPanel } from './SubjectWorkspace';
export { StudentActivityPanel } from './SubjectWorkspace';
import { DeferredStudentMaterial as StudentMaterial } from './DeferredStudentMaterial';
import { AssignmentsTab } from './AssignmentsTab';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { useLearnerMetrics } from '@/hooks/useLearnerMetrics';
import { useStudentActivity } from '@/hooks/useStudentActivity';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { useLearnerWorkspaceAccess } from '@/hooks/useLearnerWorkspaceAccess';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { buildLinkedQuizzes, splitLinkedQuizWeek, type LinkedQuiz } from '@/utils/linkedQuizzes';
import { gradePercent } from '@/utils/learnerJourney';
import { BookOpen, Sparkles } from 'lucide-react';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageTabs, type PageTabItem } from '@/components/ui/PageTabs';
import { ModeSwitch } from '@/components/ui/ModeSwitch';
import { FreeCoursesTab } from './FreeCoursesTab';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { RowAction } from '@/components/ui/ActionRow';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState, EmptyStateAction } from '@/components/ui/EmptyState';
import { EMPTY_VALUE } from '@/lib/format';
import type { LearnerKind } from '@/api/learnerDetail';
import { LearningHero } from './LearningCatalogue';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';
import { learningSchedule } from '@/api/learnerOverview';
import learningStyles from './SubjectWorkspace.module.css';

const learnerNav = roleNavMap.learner;

type TabKey = 'modules' | 'quizzes' | 'assignments';

/** Training Plan and Quizzes used to be their own pages; their old URLs still
 * work (staff/coach deep-links and saved links depend on it) but now land on
 * the matching tab of this merged page instead of a separate screen. */
function defaultTabForPath(pathname: string): TabKey {
  if (pathname.startsWith('/learner/training-plan') || pathname.startsWith('/learner/modules')) return 'modules';
  if (pathname.startsWith('/learner/quizzes')) return 'quizzes';
  return 'modules';
}

export default function MyLearningPage({ view = 'catalogue' }: { view?: 'catalogue' | 'map' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(urlKind, urlId);
  const { isRealMode, real, loading, loadError, refresh } = useLearnerDetailParam(kind, id);
  const { canProgress, showReadOnlyNotice } = useLearnerWorkspaceAccess(id);

  const requestedTab = new URLSearchParams(location.search).get('tab');
  const tab = view === 'map' ? 'modules' : requestedTab === 'modules' || requestedTab === 'quizzes' || requestedTab === 'assignments'
    ? requestedTab : defaultTabForPath(location.pathname);
  const setTab = (next: TabKey) => {
    if (next === tab) return;
    const params = new URLSearchParams(location.search);
    params.set('tab', next);
    navigate({ pathname: location.pathname, search: params.toString() });
  };

  // The whole page switches between the programme modules ("My courses") and the
  // learner's assigned free courses. Map view is always the module workspace.
  const requestedMode = new URLSearchParams(location.search).get('mode');
  const mode = view === 'map' ? 'courses' : requestedMode === 'free' ? 'free' : 'courses';
  const setMode = (next: string) => {
    if (next === mode) return;
    const params = new URLSearchParams(location.search);
    if (next === 'free') params.set('mode', next); else params.delete('mode');
    navigate({ pathname: location.pathname, search: params.toString() });
  };

  const canTake = !!(kind && id) && canProgress;

  const subtitle = real
    ? [real.programme, real.employer, real.cohort ? `Cohort ${real.cohort}` : ''].filter(Boolean).join(' · ')
    : '';

  const tabs: PageTabItem[] = [
    { value: 'modules', label: 'Modules' },
    { value: 'quizzes', label: 'Quizzes' },
    { value: 'assignments', label: 'Assignments' },
  ];

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={view === 'map' ? 'Learner’s Map' : 'My Learning'}
      pageSubtitle={subtitle}
      userName={real?.name || 'Learner'}
      userRole={real?.programme ? `${real.programme} Learner` : 'Learner'}
      breadcrumbCurrentLabel={view === 'map' ? 'Learner’s Map' : 'My Learning'}
    >
      <PageContainer><div className={learningStyles.learningPage}>
        {view === 'catalogue' && isRealMode && (
          <ModeSwitch
            value={mode}
            onChange={setMode}
            label="Switch learning view"
            options={[
              { value: 'courses', label: 'My courses', icon: <BookOpen size={13} aria-hidden="true" /> },
              { value: 'free', label: 'Free courses', icon: <Sparkles size={13} aria-hidden="true" /> },
            ]}
          />
        )}

        {/* Keyed by mode so switching remounts the panel and re-runs the slide:
            Free enters from the right, My courses from the left. */}
        <div key={mode} className={view === 'catalogue' && isRealMode ? (mode === 'free' ? 'slide-from-right' : 'slide-from-left') : undefined}>
          {!isRealMode ? (
            <Panel><EmptyState size="sm" title="No learner selected" description="Open this page from a learner record." /></Panel>
          ) : mode === 'free' ? (
            <FreeCoursesTab kind={kind} id={id} />
          ) : (
            <>
              {view === 'catalogue' && <LearningHero />}
              {view === 'catalogue' && <PageTabs items={tabs} value={tab} onChange={(v) => setTab(v as TabKey)} label="My Learning section" />}

              {tab === 'modules' ? (
                <ModulesTab key={`${kind}:${id}`} real={real} loading={loading} loadError={loadError} kind={kind} id={id} showReadOnlyNotice={showReadOnlyNotice} view={view} onRefresh={refresh} />
              ) : (
                tab === 'assignments' ? <AssignmentsTab key={`${kind}:${id}`} kind={kind} id={id} real={real} loading={loading} loadError={loadError} onRetry={refresh} canTake={canTake} /> :
                <QuizzesTab real={real} loading={loading} loadError={loadError} kind={kind} id={id} canTake={canTake} navigate={navigate} onRetry={refresh} />
              )}
            </>
          )}
        </div>
      </div></PageContainer>
    </WorkspaceShell>
  );
}

/* ═══════════════════════════════════════════════════════
   MODULES TAB — the old Training Plan, reused and tightened
   ═══════════════════════════════════════════════════════ */
export function ModulesTab({ real, loading, loadError, kind, id, showReadOnlyNotice, view = 'catalogue', onRefresh }: {
  real: ReturnType<typeof useLearnerDetailParam>['real'];
  loading: boolean;
  loadError: string | null;
  kind?: LearnerKind;
  id?: string;
  showReadOnlyNotice?: boolean;
  view?: 'catalogue' | 'map'; onRefresh?: () => void;
}) {
  const activityAvailable = !!real?.studentActivityAvailable;
  const activity = useStudentActivity(kind, id, !loading && !loadError && activityAvailable);
  const activityData = activityAvailable ? activity.data : null;
  // Get the actual subjects on screen before starting the secondary source
  // reads. Their failure must never hold up the materials.
  const primaryReady = !!real && !loading && (!activityAvailable || !!activityData);
  const metrics = useLearnerMetrics(kind, id, primaryReady);
  const schedule = useLiveLearnerRead(kind, id, primaryReady, learningSchedule.read, learningSchedule.peek);

  return (
    <div className="space-y-3">
      {schedule.error && view === 'map' && <p role="alert" className="text-sm text-amber-800">The current module schedule could not be loaded. Choose a module below. <button onClick={schedule.refresh} className="font-semibold underline">Retry schedule</button></p>}
      {metrics.error && <p role="alert" className="text-sm text-amber-800">{metrics.error} <button onClick={metrics.refresh} className="font-semibold underline">Retry programme totals</button></p>}
      {showReadOnlyNotice && (
        <div className="flex items-start gap-2.5 rounded-xl border border-primary-200/70 bg-primary-50/60 px-3.5 py-2.5">
          <AppIcon className="ri-eye-line mt-0.5 shrink-0 text-[15px] text-primary-600" />
          <p className="text-[12px] leading-snug text-foreground-600">
            <span className="font-semibold text-foreground-800">Viewing read-only.</span>{' '}
            The learner or an administrator can complete activities, upload evidence or submit reflections.
          </p>
        </div>
      )}
      <SubjectCardsPanel
        metrics={metrics.data}
        view={view} schedule={schedule.data} scheduleLoading={schedule.loading}
        kind={kind} learnerId={id} real={real}
        data={activityData ?? null}
        loading={loading || (activityAvailable && activity.loading)}
        error={loadError || activity.error || null}
        onRetry={() => { if (activity.error) activity.refresh(); if (loadError) onRefresh?.(); }}
        onProgress={() => { activity.refresh(); metrics.refresh(); }}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   QUIZZES TAB — compact filterable list, replacing the big cards
   ═══════════════════════════════════════════════════════ */
type QuizFilter = 'all' | 'todo' | 'completed' | 'failed';

export function QuizzesTab({ real, loading, loadError, kind, id, canTake, navigate, onRetry }: {
  real: ReturnType<typeof useLearnerDetailParam>['real'];
  loading: boolean;
  loadError: string | null;
  kind?: string;
  id?: string;
  canTake: boolean;
  navigate: ReturnType<typeof useNavigate>;
  onRetry?: () => void;
}) {
  const [filter, setFilter] = useState<QuizFilter>('all');
  const quizzes = useMemo(() => buildLinkedQuizzes(real), [real]);

  const rows = useMemo(() => quizzes.map((q) => {
    const attempts = q.attempts;
    const best = attempts.length ? attempts.reduce((b, a) => (gradePercent(a.grade) > gradePercent(b.grade) ? a : b)) : null;
    const status: QuizFilter = !best ? 'todo' : best.passed ? 'completed' : 'failed';
    return { ...q, best, status };
  }), [quizzes]);

  const counts = useMemo(() => ({
    all: rows.length,
    todo: rows.filter((r) => r.status === 'todo').length,
    completed: rows.filter((r) => r.status === 'completed').length,
    failed: rows.filter((r) => r.status === 'failed').length,
  }), [rows]);

  const tabs: PageTabItem[] = [
    { value: 'all', label: 'All', count: counts.all },
    { value: 'todo', label: 'To Do', count: counts.todo },
    { value: 'completed', label: 'Completed', count: counts.completed, tone: 'positive' },
    { value: 'failed', label: 'Failed', count: counts.failed, tone: 'critical', hideWhenEmpty: true },
  ];

  const filtered = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

  return (
    <div className="space-y-3">
      <SectionHeader title="Quizzes" description="Every quiz linked to your training plan" icon="ri-questionnaire-line" />
      <PageTabs items={tabs} value={filter} onChange={(v) => setFilter(v as QuizFilter)} label="Filter quizzes" />

      {loading ? (
        <Panel><RowsSkeleton rows={4} /></Panel>
      ) : loadError ? (
        <Panel><EmptyState size="sm" variant="error" title={loadError} action={onRetry ? <EmptyStateAction label="Retry" onClick={onRetry} /> : undefined} /></Panel>
      ) : quizzes.length === 0 ? (
        <Panel><EmptyState size="sm" title="No quizzes linked yet" description="Quizzes linked to your training plan will appear here." /></Panel>
      ) : filtered.length === 0 ? (
        <Panel><EmptyState size="sm" title="No quizzes match this filter" /></Panel>
      ) : (
        <Panel padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-foreground-200/60 bg-background-100/60">
                  <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">Quiz</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">Week</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">Date</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">Score</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">Status</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground-100">
                {filtered.map((q) => (
                  <QuizListRow key={q.quizId} quiz={q} canTake={canTake} onTake={() =>
                    navigate(`/learner/quiz/${kind}/${id}/${q.quizId}?module=${encodeURIComponent(q.module || '')}&week=${encodeURIComponent(q.week || '')}`)
                  } />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function QuizListRow({ quiz, canTake, onTake }: {
  quiz: LinkedQuiz & { best: LinkedQuiz['attempts'][number] | null; status: QuizFilter };
  canTake: boolean;
  onTake: () => void;
}) {
  const { best, status } = quiz;
  const { label: weekLabel, date: weekDate } = splitLinkedQuizWeek(quiz.week);
  return (
    <tr className="transition-colors hover:bg-background-100/40">
      <td className="px-4 py-3">
        <p className="text-[13px] font-semibold text-foreground-900">{quiz.name}</p>
        {quiz.module && <p className="text-[11px] text-foreground-400">{quiz.module}</p>}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-[12px] text-foreground-600">{weekLabel || EMPTY_VALUE}</td>
      <td className="whitespace-nowrap px-4 py-3 text-[12px] text-foreground-600">{weekDate || EMPTY_VALUE}</td>
      <td className="whitespace-nowrap px-4 py-3 text-[12px] font-semibold text-foreground-800">
        {best ? `${gradePercent(best.grade)}%` : EMPTY_VALUE}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <StatusBadge
          tone={status === 'completed' ? 'positive' : status === 'failed' ? 'critical' : 'neutral'}
          label={status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : 'To do'}
        />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        {canTake && <RowAction label={best ? 'Retake' : 'Start'} emphasis={status === 'todo' ? 'primary' : 'secondary'} onClick={onTake} />}
      </td>
    </tr>
  );
}
