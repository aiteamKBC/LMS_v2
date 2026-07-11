import { useState } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import type { LearnerDetail } from '@/api/learnerDetail';
import { buildLearnerJourney, componentTypeMeta, type JourneyModule, type JourneyWeek, type JourneyComponent } from '@/utils/learnerJourney';

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
      <div className="p-3 md:p-6 space-y-5">
        {/* ═══════════ HERO ═══════════ */}
        <section className="relative rounded-2xl overflow-hidden animate-in fade-in duration-300" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
          </div>
          <div className="relative flex flex-col lg:flex-row items-stretch min-h-[150px]">
            <div className="flex-1 px-5 md:px-7 py-5 md:py-6 flex flex-col justify-center min-w-0">
              {subtitle && (
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <span className="text-xs font-semibold text-accent-300/80 uppercase tracking-wider bg-accent-400/10 px-2.5 py-1 rounded-md font-label border border-accent-400/15">
                    {subtitle}
                  </span>
                </div>
              )}
              <h1 className="text-lg md:text-xl font-heading font-bold text-white tracking-tight mb-1.5">{pageLabel}</h1>
              <p className="text-sm text-white/40 max-w-lg">
                {journey.length} {journey.length === 1 ? 'module' : 'modules'} · {totalWeeks} {totalWeeks === 1 ? 'week' : 'weeks'} · {totalComponents} {totalComponents === 1 ? 'component' : 'components'}
              </p>
            </div>
            {totalOtjh > 0 && (
              <div className="lg:w-[200px] shrink-0 px-5 md:px-7 py-5 md:py-6 border-t lg:border-t-0 lg:border-l border-accent-400/10 flex items-center justify-center">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-3xl font-heading font-bold text-white">{totalOtjh}h</span>
                  <span className="text-[11px] text-white/50 font-medium uppercase tracking-wider">Planned OTJH</span>
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
          <div className="space-y-3">
            {journey.map((mod, i) => (
              <ModuleSection key={mod.module} module={mod} defaultOpen={i === 0} kind={kind} learnerId={learnerId} />
            ))}
          </div>
        )}

        {real && real.ksbs.length > 0 && (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5 md:p-6 card-premium">
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
function ModuleSection({ module, defaultOpen, kind, learnerId }: {
  module: JourneyModule; defaultOpen: boolean; kind?: string; learnerId?: string;
}) {
  const [collapsed, setCollapsed] = useState(!defaultOpen);
  const weekCount = module.weeks.length;
  const componentCount = module.weeks.reduce((n, w) => n + w.components.length, 0);
  const moduleOtjh = module.weeks.reduce((n, w) => n + w.otjh, 0);

  return (
    <div className="rounded-2xl border border-background-300 bg-background-50 transition-all overflow-hidden">
      {/* Module header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-3 px-5 py-3.5 transition-colors text-left cursor-pointer hover:bg-background-100/30"
      >
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-primary-100">
          <i className="ri-book-2-line text-primary-600 text-base" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-heading font-bold text-foreground-800 truncate">{module.module}</p>
          <p className="text-[11px] text-foreground-400">
            {weekCount} {weekCount === 1 ? 'week' : 'weeks'} · {componentCount} {componentCount === 1 ? 'component' : 'components'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {moduleOtjh > 0 && (
            <span className="hidden sm:inline text-xs font-semibold text-primary-600">{Math.round(moduleOtjh * 10) / 10}h</span>
          )}
          <div className="w-7 h-7 flex items-center justify-center rounded-lg bg-background-100">
            <i className={`ri-arrow-down-s-line text-foreground-400 transition-transform text-sm ${collapsed ? '' : 'rotate-180'}`} />
          </div>
        </div>
      </button>

      {/* Module weeks */}
      {!collapsed && (
        <div className="border-t border-background-300">
          {weekCount === 0 ? (
            <p className="px-5 py-4 text-[12px] text-foreground-400 italic">No weeks added yet</p>
          ) : (
            <div className="relative pl-10 md:pl-12 pr-4 md:pr-5 py-4">
              {/* Timeline vertical line */}
              <div className="absolute left-7 md:left-[34px] top-0 bottom-0 w-px bg-background-300" />
              <div className="space-y-2">
                {module.weeks.map((w) => (
                  <WeekCard key={w.week} week={w} module={module.module} kind={kind} learnerId={learnerId} />
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
function WeekCard({ week, module, kind, learnerId }: {
  week: JourneyWeek; module: string; kind?: string; learnerId?: string;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const componentCount = week.components.length;
  const canStartQuiz = !!(kind && learnerId);

  return (
    <div className="relative pl-6 md:pl-7">
      {/* Timeline dot */}
      <div className="absolute left-[-15px] md:left-[-16px] top-[19px] w-2 h-2 rounded-full ring-2 ring-background-100 bg-background-300 z-10" />

      <div className="rounded-xl border border-background-300 bg-white transition-all duration-200 overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-3 px-4 py-3 cursor-pointer text-left hover:bg-background-50/80 transition-colors"
        >
          <span className="shrink-0 w-9 h-9 text-xs rounded-lg flex items-center justify-center font-heading font-bold bg-background-100 text-foreground-500">
            <i className="ri-calendar-line" />
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-heading font-bold text-foreground-800">{week.week}</span>
            <p className="text-[11px] text-foreground-400 mt-0.5">{componentCount} {componentCount === 1 ? 'component' : 'components'}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {week.otjh > 0 && <span className="text-xs font-semibold text-foreground-500">{Math.round(week.otjh * 10) / 10}h</span>}
            <div className="flex items-center justify-center rounded-lg bg-background-100 w-6 h-6">
              <i className={`ri-arrow-down-s-line text-foreground-400 transition-transform ${open ? 'rotate-180' : ''} text-xs`} />
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
function ComponentRow({ component: c, module, week, kind, learnerId, canStartQuiz, navigate }: {
  component: JourneyComponent;
  module: string;
  week: string;
  kind?: string;
  learnerId?: string;
  canStartQuiz: boolean;
  navigate: NavigateFunction;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [selectedAttempt, setSelectedAttempt] = useState<number | null>(null);
  const meta = componentTypeMeta(c.title);
  const attempts = c.quizAttempts || [];
  const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;

  const gradeOf = (a: typeof lastAttempt) =>
    a ? (typeof a.grade === 'number' ? `${a.grade}%` : a.grade) : '';
  // Badge summarizes the most recent attempt.
  const gradeLabel = gradeOf(lastAttempt);
  const scoreSummary = lastAttempt?.Score ?? null;
  const hasBreakdown = !!(lastAttempt?.questions && lastAttempt.questions.length > 0);

  // Which attempt's breakdown is shown when expanded (defaults to the latest).
  const viewIndex = selectedAttempt ?? attempts.length - 1;
  const viewAttempt = attempts[viewIndex] ?? lastAttempt;

  return (
    <div>
      <div className="w-full flex items-center gap-3 px-4 py-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${meta.bg}`}>
          <i className={`${meta.icon} text-[13px] ${meta.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">{meta.label}</span>
          <p className="text-sm font-semibold leading-snug text-foreground-900">{meta.detail || meta.label}</p>
        </div>
        {c.isQuiz && c.quizMeta?.questions != null ? (
          <span className="shrink-0 text-[11px] text-foreground-400 inline-flex items-center gap-1">
            <i className="ri-questionnaire-line text-[10px]" />{c.quizMeta.questions} {c.quizMeta.questions === 1 ? 'question' : 'questions'}
          </span>
        ) : c.expectedOtjh != null && c.expectedOtjh > 0 && (
          <span className="shrink-0 text-[11px] text-foreground-400 inline-flex items-center gap-1">
            <i className="ri-time-line text-[10px]" />{c.expectedOtjh}h
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
              <i className={lastAttempt.passed ? 'ri-checkbox-circle-line text-[10px]' : 'ri-close-circle-line text-[10px]'} />
              {gradeLabel} · {lastAttempt.passed ? 'Passed' : 'Failed'}
            </span>
            <span className="text-[10px] text-foreground-400 inline-flex items-center gap-1">
              {scoreSummary && <span>{scoreSummary} ·</span>}
              {attempts.length} {attempts.length === 1 ? 'attempt' : 'attempts'}
              {hasBreakdown && <i className={`ri-arrow-down-s-line transition-transform ${showBreakdown ? 'rotate-180' : ''}`} />}
            </span>
          </button>
        )}
        {c.isQuiz && c.quizMeta?.quizId != null && canStartQuiz && (
          <button
            onClick={() => navigate(`/learner/quiz/${kind}/${learnerId}/${c.quizMeta!.quizId}?module=${encodeURIComponent(module)}&week=${encodeURIComponent(week)}`)}
            className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors cursor-pointer"
          >
            <i className={lastAttempt ? 'ri-refresh-line text-[10px]' : 'ri-play-fill text-[10px]'} />
            {lastAttempt ? 'Retake Quiz' : 'Start Quiz'}
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
              {viewAttempt.Score && ` (${viewAttempt.Score})`}
              {viewAttempt.timeTaken && ` · ${viewAttempt.timeTaken}`}
              {' · '}{viewAttempt.submittedAt ? new Date(viewAttempt.submittedAt).toLocaleString() : ''}
            </p>
            {(viewAttempt.questions || []).map((q, i) => (
              <div key={q.questionId} className={`rounded-lg border p-2.5 ${q.correct ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'}`}>
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold mt-0.5 ${q.correct ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
                    <i className={q.correct ? 'ri-check-line' : 'ri-close-line'} />
                  </span>
                  <p className="text-xs font-medium text-foreground-800 flex-1">
                    <span className="text-foreground-400">Q{i + 1}.</span> {q.questionText}
                  </p>
                </div>
                <div className="pl-6 mt-1 space-y-0.5">
                  <p className="text-[11px] text-foreground-600">
                    <span className="text-foreground-400">Your answer: </span>{q.chosenAnswer || <span className="italic">No answer</span>}
                  </p>
                  {!q.correct && q.correctAnswer && (
                    <p className="text-[11px] text-emerald-700">
                      <span className="font-medium">Correct answer: </span>{q.correctAnswer}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
