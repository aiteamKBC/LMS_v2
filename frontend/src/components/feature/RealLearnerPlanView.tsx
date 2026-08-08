import { useEffect, useState } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import type { LearnerDetail, LearnerKind, LearnerQuizAttempt, LearnerQuizQuestionResult } from '@/api/learnerDetail';
import { fetchQuiz, type Quiz } from '@/api/quizzes';
import { EvidenceFilesButton } from '@/components/feature/EvidenceFilesButton';
import { buildLearnerJourney, componentTypeMeta, gradePercent, isOpenableComponent, type JourneyModule, type JourneyWeek, type JourneyComponent } from '@/utils/learnerJourney';

/** Resolve a stored (id-only) attempt question to display text using the fetched
 * quiz. Free-text types carry chosenText; others resolve answer ids -> text. */
function resolveQuestion(q: LearnerQuizQuestionResult, quiz: Quiz | null) {
  const question = quiz?.questions.find((x) => x.id === q.questionId);
  const questionText = question?.text ?? `Question ${q.questionId}`;
  const byId = new Map<number, string>();
  for (const a of question?.answers ?? []) byId.set(a.id, a.text ?? a.left ?? String(a.id));
  const idsToText = (ids: number | number[] | null | undefined) => {
    if (ids == null) return null;
    const arr = Array.isArray(ids) ? ids : [ids];
    const parts = arr.map((i) => byId.get(i)).filter(Boolean) as string[];
    return parts.length ? parts.join(', ') : null;
  };
  const chosen = q.chosenText ?? idsToText(q.chosenAnswerId);
  const correct = idsToText(q.correctAnswerId);
  return { questionText, chosen, correct };
}

const learnerNav = roleNavMap.learner;

/**
 * Full read-only view of a real learner's saved training plan — module -> week
 * -> components, each annotated with its authored expected_otjh where known.
 * Shared by /learner/training-plan/:kind/:id and /learner/this-week/:kind/:id,
 * since neither route has any real notion of "this week" without calendar/
 * scheduling data — both show the same honest, complete plan.
 */
export function RealLearnerPlanView({
  real,
  loading,
  loadError,
  pageLabel,
  note,
  kind,
  learnerId,
}: {
  real: LearnerDetail | null;
  loading: boolean;
  loadError: string | null;
  pageLabel: string;
  note?: string;
  kind?: string;
  learnerId?: string;
}) {
  const journey = buildLearnerJourney(real);
  // Component ids the learner has already completed (videos + generic components).
  const completedIds = new Set<string>([
    ...(real?.videoProgress || []).map((v) => v.componentId),
    ...(real?.componentProgress || []).map((c) => c.componentId),
  ]);
  const totalOtjh = real?.totalExpectedOtjh ?? 0;
  const totalWeeks = journey.reduce((n, m) => n + m.weeks.length, 0);
  const totalComponents = journey.reduce((n, m) => n + m.weeks.reduce((k, w) => k + w.components.length, 0), 0);
  const subtitle = real
    ? [real.programme, real.employer, real.cohort ? `Cohort ${real.cohort}` : ''].filter(Boolean).join(' · ')
    : '';

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={loading ? 'Loading learner…' : (real?.name || 'Learner')}
      pageSubtitle={subtitle}
      userName={real?.name || 'Learner'}
      userRole={real?.programme ? `${real.programme} Learner` : 'Learner'}
    >
      <div className="w-full space-y-5 p-3 sm:p-4 md:space-y-6 md:p-6 lg:p-8">
        {/* ═══════════ HERO ═══════════ */}
        <section className="relative overflow-hidden rounded-2xl border border-white/10 shadow-[0_18px_45px_-28px_rgba(32,4,75,0.9)] animate-in fade-in duration-300 sm:rounded-3xl" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
          </div>
          <div className="relative flex min-h-[184px] flex-col items-stretch lg:flex-row">
            <div className="flex min-w-0 flex-1 flex-col justify-center px-5 py-6 sm:px-6 sm:py-7 md:px-9 md:py-8">
              {subtitle && (
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <span className="rounded-lg border border-accent-400/20 bg-accent-400/10 px-3 py-1.5 font-label text-xs font-semibold uppercase tracking-[0.12em] text-accent-200">
                    {subtitle}
                  </span>
                </div>
              )}
              <h1 className="mb-2 font-heading text-2xl font-bold tracking-tight text-white md:text-3xl">{pageLabel}</h1>
              <p className="max-w-2xl text-sm font-medium text-white/65 md:text-base">
                {journey.length} {journey.length === 1 ? 'module' : 'modules'} · {totalWeeks} {totalWeeks === 1 ? 'week' : 'weeks'} · {totalComponents} {totalComponents === 1 ? 'component' : 'components'}
              </p>
            </div>
            {totalOtjh > 0 && (
              <div className="flex shrink-0 items-center justify-center border-t border-white/10 bg-white/[0.025] px-8 py-6 lg:w-[230px] lg:border-l lg:border-t-0">
                <div className="flex flex-col items-center gap-1.5">
                  <span className="font-heading text-4xl font-bold tracking-tight text-white">{totalOtjh}h</span>
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">Planned OTJH</span>
                </div>
              </div>
            )}
          </div>
        </section>

        {note && <p className="text-xs text-foreground-400 -mt-2">{note}</p>}

        {/* ═══════════ MODULE GROUPS — TIMELINE ═══════════ */}
        {loading ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="Loading…" /></div>
        ) : loadError ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text={loadError} /></div>
        ) : journey.length === 0 ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="No training plan built for this learner yet." /></div>
        ) : (
          <div className="space-y-4">
            {journey.map((mod, i) => (
              <ModuleSection key={mod.module} module={mod} defaultOpen={i === 0} kind={kind} learnerId={learnerId} completedIds={completedIds} />
            ))}
          </div>
        )}

        {real && real.ksbs.length > 0 && (
          <div className="card-premium rounded-2xl border border-foreground-200/60 bg-background-50 p-5 shadow-sm md:p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-heading font-semibold text-foreground-900">Programme KSBs</h2>
              <span className="text-xs text-foreground-400">{real.ksbs.length} total</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-80 overflow-y-auto pr-1">
              {real.ksbs.map((k) => (
                <div key={k.code} className="rounded-lg border border-foreground-100 p-2.5">
                  <span className="text-xs font-semibold text-primary-600">{k.code}</span>
                  <p className="text-xs text-foreground-600 mt-0.5 line-clamp-3">{k.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

/* ═══════════════════════════════════════════════════════
   MODULE SECTION — collapsible group of weeks
   ═══════════════════════════════════════════════════════ */
function ModuleSection({ module, defaultOpen, kind, learnerId, completedIds }: {
  module: JourneyModule; defaultOpen: boolean; kind?: string; learnerId?: string; completedIds: Set<string>;
}) {
  const [collapsed, setCollapsed] = useState(!defaultOpen);
  const weekCount = module.weeks.length;
  const componentCount = module.weeks.reduce((n, w) => n + w.components.length, 0);
  const moduleOtjh = module.weeks.reduce((n, w) => n + w.otjh, 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-background-300 bg-background-50 shadow-[0_8px_24px_-22px_rgba(15,23,42,0.7)] transition-all hover:border-primary-200/80">
      {/* Module header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-primary-50/30 sm:gap-4 sm:px-5 md:px-6"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary-200/70 bg-primary-100 sm:h-11 sm:w-11">
          <AppIcon className="ri-book-2-line text-lg text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate font-heading text-base font-bold text-foreground-900">{module.module}</p>
          <p className="mt-1 text-xs text-foreground-500">
            {weekCount} {weekCount === 1 ? 'week' : 'weeks'} · {componentCount} {componentCount === 1 ? 'component' : 'components'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {moduleOtjh > 0 && (
            <span className="hidden rounded-full bg-primary-50 px-3 py-1 text-xs font-bold text-primary-700 sm:inline">{Math.round(moduleOtjh * 10) / 10}h OTJH</span>
          )}
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background-100">
            <AppIcon className={`ri-arrow-down-s-line text-base text-foreground-500 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
          </div>
        </div>
      </button>

      {/* Module weeks */}
      {!collapsed && (
        <div className="border-t border-background-300">
          {weekCount === 0 ? (
            <p className="px-5 py-4 text-[12px] text-foreground-400 italic">No weeks added yet</p>
          ) : (
            <div className="bg-background-100/35 p-2.5 sm:p-3 md:p-5">
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {module.weeks.map((w) => (
                  <WeekCard key={w.week} week={w} module={module.module} kind={kind} learnerId={learnerId} completedIds={completedIds} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   WEEK CARD — collapsible list of components
   ═══════════════════════════════════════════════════════ */
function WeekCard({ week, module, kind, learnerId, completedIds }: {
  week: JourneyWeek; module: string; kind?: string; learnerId?: string; completedIds: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const componentCount = week.components.length;
  const canStartQuiz = !!(kind && learnerId);

  return (
    <div className={`min-w-0 transition-all ${open ? 'xl:col-span-2' : ''}`}>
      <div className="overflow-hidden rounded-xl border border-background-300 bg-white shadow-[0_6px_18px_-18px_rgba(15,23,42,0.8)] transition-all duration-200 hover:border-primary-200 hover:shadow-sm">
        {/* Header */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-3.5 text-left transition-colors hover:bg-primary-50/30 sm:gap-3 sm:px-4"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-background-300 bg-background-100 font-heading text-sm font-bold text-foreground-600">
            <AppIcon className="ri-calendar-line" />
          </span>
          <div className="flex-1 min-w-0">
            <span className="font-heading text-sm font-bold text-foreground-900 md:text-[15px]">{week.week}</span>
            <p className="mt-1 text-xs text-foreground-500">{componentCount} {componentCount === 1 ? 'component' : 'components'}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {week.otjh > 0 && <span className="rounded-md bg-background-100 px-2 py-1 text-xs font-semibold text-foreground-600">{Math.round(week.otjh * 10) / 10}h</span>}
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-background-100">
              <AppIcon className={`ri-arrow-down-s-line text-sm text-foreground-500 transition-transform ${open ? 'rotate-180' : ''}`} />
            </div>
          </div>
        </button>

        {/* Expanded components */}
        {open && (
          <div className="border-t border-background-300">
            {componentCount === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-foreground-400">No components in this week.</div>
            ) : (
              <div className="divide-y divide-background-300">
                {week.components.map((c) => (
                  <ComponentRow
                    key={c.title}
                    component={c}
                    module={module}
                    week={week.week}
                    kind={kind}
                    learnerId={learnerId}
                    canStartQuiz={canStartQuiz}
                    completed={!!c.componentId && completedIds.has(c.componentId)}
                    navigate={navigate}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   COMPONENT ROW — with quiz start/retake + past-attempt breakdown
   ═══════════════════════════════════════════════════════ */
function ComponentRow({ component: c, module, week, kind, learnerId, canStartQuiz, completed, navigate }: {
  component: JourneyComponent;
  module: string;
  week: string;
  kind?: string;
  learnerId?: string;
  canStartQuiz: boolean;
  completed?: boolean;
  navigate: NavigateFunction;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [selectedAttempt, setSelectedAttempt] = useState<number | null>(null);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const meta = componentTypeMeta(c.title);
  const attempts = c.quizAttempts || [];
  const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
  const canOpenComponent = !!(kind && learnerId && isOpenableComponent(c));
  // Only assignments collect uploaded evidence, so only they get the view-file affordance.
  const isAssignment = (c.type || '').toLowerCase() === 'assignment';

  // Grade is stored as a 0-1 decimal now; render as a whole percent.
  const gradeOf = (a: LearnerQuizAttempt | null) => (a ? `${gradePercent(a.grade)}%` : '');
  const scoreOf = (a: LearnerQuizAttempt | null) =>
    a && a.achievedScore != null && a.totalScore != null ? `${a.achievedScore}/${a.totalScore}` : null;
  // Badge summarizes the most recent attempt.
  const gradeLabel = gradeOf(lastAttempt);
  const scoreSummary = scoreOf(lastAttempt);
  const hasBreakdown = !!(lastAttempt?.questions && lastAttempt.questions.length > 0);

  // When the breakdown is opened, fetch the quiz once so id-only stored answers
  // can be resolved back to their text.
  const quizId = c.quizMeta?.quizId;
  useEffect(() => {
    if (!showBreakdown || quiz || quizId == null) return;
    let cancelled = false;
    fetchQuiz(quizId).then((q) => { if (!cancelled) setQuiz(q); }).catch(() => { /* text just won't resolve */ });
    return () => { cancelled = true; };
  }, [showBreakdown, quiz, quizId]);

  // Which attempt's breakdown is shown when expanded (defaults to the latest).
  const viewIndex = selectedAttempt ?? attempts.length - 1;
  const viewAttempt = attempts[viewIndex] ?? lastAttempt;

  return (
    <div>
      <div className="flex w-full flex-wrap items-center gap-3 px-3 py-3 sm:px-4">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${meta.bg}`}>
          <AppIcon className={`${meta.icon} text-[13px] ${meta.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">{meta.label}</span>
          <p className="text-sm font-semibold leading-snug text-foreground-900">{meta.detail || meta.label}</p>
        </div>
        {c.isQuiz && c.quizMeta?.questions != null ? (
          <span className="shrink-0 text-[11px] text-foreground-400 inline-flex items-center gap-1">
            <AppIcon className="ri-questionnaire-line text-[10px]" />{c.quizMeta.questions} {c.quizMeta.questions === 1 ? 'question' : 'questions'}
          </span>
        ) : c.expectedOtjh != null && c.expectedOtjh > 0 && (
          <span className="shrink-0 text-[11px] text-foreground-400 inline-flex items-center gap-1">
            <AppIcon className="ri-time-line text-[10px]" />{c.expectedOtjh}h
          </span>
        )}
        {c.isQuiz && lastAttempt && (
          <button
            onClick={() => hasBreakdown && setShowBreakdown((s) => !s)}
            disabled={!hasBreakdown}
            className={`shrink-0 flex flex-col items-end gap-0.5 ${hasBreakdown ? 'cursor-pointer' : ''}`}
          >
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
              lastAttempt.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
            }`}>
              <AppIcon className={lastAttempt.passed ? 'ri-checkbox-circle-line text-[10px]' : 'ri-close-circle-line text-[10px]'} />
              {gradeLabel} · {lastAttempt.passed ? 'Passed' : 'Failed'}
            </span>
            <span className="text-[10px] text-foreground-400 inline-flex items-center gap-1">
              {scoreSummary && <span>{scoreSummary} ·</span>}
              {attempts.length} {attempts.length === 1 ? 'attempt' : 'attempts'}
              {hasBreakdown && <AppIcon className={`ri-arrow-down-s-line transition-transform ${showBreakdown ? 'rotate-180' : ''}`} />}
            </span>
          </button>
        )}
        {c.isQuiz && c.quizMeta?.quizId != null && canStartQuiz && (
          <button
            onClick={() => navigate(`/learner/quiz/${kind}/${learnerId}/${c.quizMeta!.quizId}?module=${encodeURIComponent(module)}&week=${encodeURIComponent(week)}`)}
            className="inline-flex w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-700 sm:w-auto sm:py-1.5 sm:text-[11px]"
          >
            <AppIcon className={lastAttempt ? 'ri-refresh-line text-[10px]' : 'ri-play-fill text-[10px]'} />
            {lastAttempt ? 'Retake Quiz' : 'Start Quiz'}
          </button>
        )}
        {completed && !c.isQuiz && (
          <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-emerald-100 text-emerald-700">
            <AppIcon className="ri-checkbox-circle-line text-[10px]" />Done
          </span>
        )}
        {c.type === 'video' && c.videoUrl && c.componentId && canStartQuiz && (
          <button
            onClick={() => navigate(`/learner/video/${kind}/${learnerId}/${c.componentId}?module=${encodeURIComponent(module)}&week=${encodeURIComponent(week)}`)}
            className="inline-flex w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700 sm:w-auto sm:py-1.5 sm:text-[11px]"
          >
            <AppIcon className={`${completed ? 'ri-refresh-line' : 'ri-play-fill'} text-[10px]`} />
            {completed ? 'Rewatch' : 'Play'}
          </button>
        )}
        {isAssignment && kind && learnerId && c.componentId && (
          <EvidenceFilesButton kind={kind as LearnerKind} learnerId={learnerId} componentId={c.componentId} />
        )}
        {!c.isQuiz && c.type !== 'video' && c.componentId && canOpenComponent && (
          <button
            onClick={() => navigate(`/learner/component/${kind}/${learnerId}/${c.componentId}?module=${encodeURIComponent(module)}&week=${encodeURIComponent(week)}`)}
            className="inline-flex w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-700 sm:w-auto sm:py-1.5 sm:text-[11px]"
          >
            <AppIcon className={`${completed ? 'ri-refresh-line' : 'ri-arrow-right-line'} text-[10px]`} />
            {completed ? 'Review again' : 'Open'}
          </button>
        )}
      </div>

      {/* Past-attempt breakdown */}
      {showBreakdown && hasBreakdown && viewAttempt && (
        <div className="px-4 pb-4 -mt-1">
          <div className="rounded-lg bg-background-50 border border-background-300 p-3 space-y-2">
            {/* Attempt selector — only when there's more than one */}
            {attempts.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap pb-1">
                <span className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mr-1">Attempts:</span>
                {attempts.map((a, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedAttempt(i)}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors cursor-pointer inline-flex items-center gap-1 ${
                      i === viewIndex
                        ? 'bg-primary-600 text-white'
                        : a.passed ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-red-100 text-red-700 hover:bg-red-200'
                    }`}
                  >
                    #{a.attempt ?? i + 1} · {gradeOf(a)}
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">
              Attempt {viewAttempt.attempt ?? viewIndex + 1} · {gradeOf(viewAttempt)}
              {scoreOf(viewAttempt) && ` (${scoreOf(viewAttempt)})`}
              {viewAttempt.timeTaken && ` · ${viewAttempt.timeTaken}`}
              {' · '}{viewAttempt.submittedAt ? new Date(viewAttempt.submittedAt).toLocaleString() : ''}
            </p>
            {(viewAttempt.questions || []).map((q, i) => {
              const r = resolveQuestion(q, quiz);
              return (
                <div key={q.questionId} className={`rounded-lg border p-2.5 ${q.correct ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'}`}>
                  <div className="flex items-start gap-2">
                    <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold mt-0.5 ${q.correct ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
                      <AppIcon className={q.correct ? 'ri-check-line' : 'ri-close-line'} />
                    </span>
                    <p className="text-xs font-medium text-foreground-800 flex-1">
                      <span className="text-foreground-400">Q{i + 1}.</span> {r.questionText}
                    </p>
                  </div>
                  <div className="pl-6 mt-1 space-y-0.5">
                    <p className="text-[11px] text-foreground-600">
                      <span className="text-foreground-400">Your answer: </span>{r.chosen || <span className="italic">No answer</span>}
                    </p>
                    {!q.correct && r.correct && (
                      <p className="text-[11px] text-emerald-700">
                        <span className="font-medium">Correct answer: </span>{r.correct}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
