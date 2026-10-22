import { useEffect, useMemo, useState } from 'react';
export { StudentActivityPanel } from './SubjectWorkspace';
import { DeferredStudentMaterial as StudentMaterial } from './DeferredStudentMaterial';
import { AssignmentsTab } from './AssignmentsTab';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
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
import { useAuth } from '@/hooks/useAuth';
import learningStyles from './SubjectWorkspace.module.css';
import { useMyLearningCatalogue } from '@/api/myLearning';
import { CompactModules } from './CompactModules';

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
  const { auth, isInitialized } = useAuth();
  const resolved = useResolvedLearner(urlKind, urlId);
  // On a hard refresh the in-memory learner pin is empty until /login_api/me/
  // settles. Use that authoritative account identity directly for learner
  // self-view; staff/admin accounts still require an explicit URL selection.
  const accountLearner = useMemo(() => auth.account?.role === 'learner' && auth.account.subjectId != null
    ? { kind: auth.account.learnerType === 'commercial' ? 'commercial' as const : 'apprenticeship' as const, id: String(auth.account.subjectId) }
    : null, [auth.account]);
  const { kind, id } = accountLearner || resolved;
  const reviewAccount = auth.account && auth.account.role !== 'learner';
  useEffect(() => {
    if (!isInitialized || !reviewAccount || accountLearner || urlId || !kind || !id) return;
    const params = new URLSearchParams(location.search);
    navigate({ pathname: `/learner/my-learning/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, search: params.toString() }, { replace: true });
  }, [accountLearner, id, isInitialized, kind, location.search, navigate, reviewAccount, urlId]);
  const learnerNavItems = useMemo(() => learnerNav.items.map(item => {
    if (!kind || !id) return item;
    if (item.id === 'learner-my-learning') {
      return { ...item, href: `/learner/my-learning/${encodeURIComponent(kind)}/${encodeURIComponent(id)}` };
    }
    if (item.id === 'learner-feedback' && reviewAccount) {
      return { ...item, href: `/learner/feedback?learnerId=${encodeURIComponent(id)}&kind=${encodeURIComponent(kind)}` };
    }
    return item;
  }), [id, kind, reviewAccount]);
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
  const courseParams = new URLSearchParams(location.search);
  const { isRealMode, real, loading, loadError, refresh } = useLearnerDetailParam(kind, id, false, isInitialized && tab !== 'modules');
  const catalogue = useMyLearningCatalogue(kind as LearnerKind | undefined, id, isInitialized && tab === 'modules' && mode === 'courses');
  const subjectOpen = view === 'catalogue' && mode === 'courses' && tab === 'modules'
    && !!(courseParams.get('subject') || courseParams.get('module') || courseParams.get('activity'));
  const setMode = (next: string) => {
    if (next === mode) return;
    const params = new URLSearchParams(location.search);
    if (next === 'free') params.set('mode', next); else params.delete('mode');
    navigate({ pathname: location.pathname, search: params.toString() });
  };

  const canTake = !!(kind && id) && canProgress;

  const subtitle = real
    ? [real.programme, real.name, real.cohort ? `Cohort ${real.cohort}` : ''].filter(Boolean).join(' · ')
    : catalogue.data ? [catalogue.data.learner.programme, catalogue.data.learner.name, catalogue.data.learner.cohort ? `Cohort ${catalogue.data.learner.cohort}` : ''].filter(Boolean).join(' \u00b7 ') : '';

  const tabs: PageTabItem[] = [
    { value: 'modules', label: 'Modules' },
    { value: 'quizzes', label: 'Quizzes' },
    { value: 'assignments', label: 'Assignments' },
  ];

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNavItems}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={view === 'map' ? 'Learner’s Map' : 'My Learning'}
      pageSubtitle={subtitle}
      userName={real?.name || catalogue.data?.learner.name || 'Learner'}
      userRole={(real?.programme || catalogue.data?.learner.programme) ? `${real?.programme || catalogue.data?.learner.programme} Learner` : 'Learner'}
      breadcrumbCurrentLabel={view === 'map' ? 'Learner’s Map' : 'My Learning'}
    >
      <PageContainer><div className={learningStyles.learningPage}>
        {view === 'catalogue' && isRealMode && !subjectOpen && (
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
          {!isInitialized ? (
            <Panel><RowsSkeleton rows={2} /></Panel>
          ) : !isRealMode ? (
            <Panel><EmptyState size="sm" title="No learner selected" description="Open this page from a learner record." /></Panel>
          ) : mode === 'free' ? (
            <FreeCoursesTab kind={kind} id={id} />
          ) : (
            <>
              {view === 'catalogue' && !subjectOpen && <LearningHero />}
              {view === 'catalogue' && !subjectOpen && <PageTabs className={learningStyles.catalogueTabs} items={tabs} value={tab} onChange={(v) => setTab(v as TabKey)} label="My Learning section" />}

              {tab === 'modules' ? (
                <CompactModules key={`${kind}:${id}`} kind={kind as LearnerKind | undefined} id={id} catalogue={catalogue.data} loading={catalogue.loading} error={catalogue.error} refresh={catalogue.refresh} showReadOnlyNotice={showReadOnlyNotice} view={view} canRequestTransfer={auth.account?.role === 'learner' && String(auth.account.subjectId) === id} />
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

type QuizFilter = 'all' | 'todo' | 'completed' | 'failed' | 'unavailable';

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
    const best = attempts.length ? attempts.reduce((b, a) => (
      (a.grade != null && b.grade == null) || gradePercent(a.grade) > gradePercent(b.grade) ? a : b
    )) : null;
    const status: QuizFilter = !best ? 'todo'
      : attempts.some((attempt) => attempt.passed === true) ? 'completed'
      : attempts.some((attempt) => attempt.passed === false) ? 'failed' : 'unavailable';
    return { ...q, best, status };
  }), [quizzes]);

  const counts = useMemo(() => ({
    all: rows.length,
    todo: rows.filter((r) => r.status === 'todo').length,
    completed: rows.filter((r) => r.status === 'completed').length,
    failed: rows.filter((r) => r.status === 'failed').length,
    unavailable: rows.filter((r) => r.status === 'unavailable').length,
  }), [rows]);

  const tabs: PageTabItem[] = [
    { value: 'all', label: 'All', count: counts.all },
    { value: 'todo', label: 'To Do', count: counts.todo },
    { value: 'completed', label: 'Completed', count: counts.completed, tone: 'positive' },
    { value: 'failed', label: 'Failed', count: counts.failed, tone: 'critical', hideWhenEmpty: true },
    { value: 'unavailable', label: 'Result unavailable', count: counts.unavailable, hideWhenEmpty: true },
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
        {best && best.grade != null ? `${gradePercent(best.grade)}%` : EMPTY_VALUE}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <StatusBadge
          tone={status === 'completed' ? 'positive' : status === 'failed' ? 'critical' : 'neutral'}
          label={status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : status === 'unavailable' ? 'Result unavailable' : 'To do'}
        />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        {canTake && <RowAction label={best ? 'Retake' : 'Start'} emphasis={status === 'todo' ? 'primary' : 'secondary'} onClick={onTake} />}
      </td>
    </tr>
  );
}
