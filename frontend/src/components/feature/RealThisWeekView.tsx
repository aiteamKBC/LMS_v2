import { useMemo, useState } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import type { LearnerDetail, LearnerKind } from '@/api/learnerDetail';
import {
  buildLearnerJourney, quizAggregateStats, componentTypeMeta, gradePercent, isOpenableComponent,
  type JourneyModule, type JourneyWeek, type JourneyComponent,
} from '@/utils/learnerJourney';
import { EvidenceFilesButton } from '@/components/feature/EvidenceFilesButton';

const learnerNav = roleNavMap.learner;

/**
 * Rich "This Week" view for a REAL learner — adopts the mock this-week visual
 * language (dark hero, snapshot stat cards, sectioned component list) but only
 * renders what the saved training plan + KSBs + quiz attempts actually back.
 * Fabricated mock elements (live-session Teams links, tutor/coach cards, per-
 * component status/points, calendar dates) are intentionally omitted.
 */
export function RealThisWeekView({
  real, loading, loadError, kind, learnerId,
}: {
  real: LearnerDetail | null;
  loading: boolean;
  loadError: string | null;
  kind?: string;
  learnerId?: string;
}) {
  const navigate = useNavigate();
  const journey = useMemo(() => buildLearnerJourney(real), [real]);
  const quizStats = useMemo(() => quizAggregateStats(real), [real]);
  // Component ids the learner has already completed (videos + generic components).
  const completedIds = useMemo(() => new Set<string>([
    ...(real?.videoProgress || []).map((v) => v.componentId),
    ...(real?.componentProgress || []).map((c) => c.componentId),
  ]), [real]);

  const totalComponents = journey.reduce((n, m) => n + m.weeks.reduce((k, w) => k + w.components.length, 0), 0);
  const totalWeeks = journey.reduce((n, m) => n + m.weeks.length, 0);
  const totalOtjh = real?.totalExpectedOtjh ?? 0;
  const ksbCount = real?.ksbs.length ?? 0;

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
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">
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
                  <span className="text-xs font-semibold text-accent-300/80 uppercase tracking-wider bg-accent-400/10 px-2.5 py-1 rounded-md border border-accent-400/15">
                    {subtitle}
                  </span>
                </div>
              )}
              <h1 className="text-lg md:text-xl font-heading font-bold text-white tracking-tight mb-1.5">This Week</h1>
              <p className="text-sm text-white/40 max-w-lg">
                {journey.length} {journey.length === 1 ? 'module' : 'modules'} · {totalWeeks} {totalWeeks === 1 ? 'week' : 'weeks'} · {totalComponents} {totalComponents === 1 ? 'component' : 'components'}
              </p>
            </div>
            {quizStats.quizzesTaken > 0 && (
              <div className="lg:w-[220px] shrink-0 px-5 md:px-7 py-5 md:py-6 border-t lg:border-t-0 lg:border-l border-accent-400/10 flex items-center justify-center">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-3xl font-heading font-bold text-white">{quizStats.totalHours}h</span>
                  <span className="text-[11px] text-white/50 font-medium uppercase tracking-wider">Logged via quizzes</span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ═══════════ SNAPSHOT CARDS ═══════════ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <SnapshotCard icon="ri-stack-line" label="Components" value={`${totalComponents}`} detail="Learning items" color="primary" />
          <SnapshotCard icon="ri-award-line" label="KSBs Covered" value={`${ksbCount}`} detail="Knowledge, Skills & Behaviours" color="accent" />
          <SnapshotCard icon="ri-time-line" label="Planned OTJH" value={`${totalOtjh}h`} detail="On-the-job training hours" color="secondary" />
          <SnapshotCard
            icon="ri-questionnaire-line"
            label="Quizzes"
            value={quizStats.quizzesTaken > 0 ? `${quizStats.quizzesTaken} taken` : '—'}
            detail={quizStats.quizzesTaken > 0 ? `${quizStats.ksbCount} KSBs evidenced` : 'None taken yet'}
            color="amber"
          />
        </div>

        {/* ═══════════ MODULE → WEEK → COMPONENTS ═══════════ */}
        {loading ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="Loading…" /></div>
        ) : loadError ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text={loadError} /></div>
        ) : journey.length === 0 ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="No training plan built for this learner yet." /></div>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-heading font-semibold text-foreground-900">Weekly Learning Components</h2>
              <p className="text-sm text-foreground-400 mt-1">Your saved plan, grouped by module and week. Every component concludes with Learning Evidence &amp; Reflection.</p>
            </div>

            {/* Journey flow indicator — Learn → Apply → Reflect → Evidence → Complete */}
            <div className="flex items-center gap-2 px-4 py-3 bg-background-50 rounded-xl border border-foreground-300/50 overflow-x-auto">
              {['Learn', 'Apply', 'Reflect', 'Evidence', 'Complete'].map((step, i) => (
                <div key={step} className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-semibold whitespace-nowrap ${i <= 1 ? 'text-foreground-700' : 'text-foreground-400'}`}>{step}</span>
                  {i < 4 && <i className="ri-arrow-right-s-line text-foreground-300 text-xs" />}
                </div>
              ))}
            </div>

            <div className="space-y-3">
              {journey.map((mod, i) => (
                <ModuleSection key={mod.module} module={mod} defaultOpen={i === 0} kind={kind} learnerId={learnerId} navigate={navigate} completedIds={completedIds} />
              ))}
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

/* ═══════════════════════════════════════════════════════
   SNAPSHOT CARD
   ═══════════════════════════════════════════════════════ */
const SNAPSHOT_COLORS: Record<string, { bg: string; icon: string }> = {
  primary: { bg: 'bg-primary-50', icon: 'text-primary-600' },
  accent: { bg: 'bg-accent-50', icon: 'text-accent-600' },
  secondary: { bg: 'bg-secondary-50', icon: 'text-secondary-600' },
  amber: { bg: 'bg-amber-50', icon: 'text-amber-600' },
};

function SnapshotCard({ icon, label, value, detail, color }: {
  icon: string; label: string; value: string; detail: string; color: keyof typeof SNAPSHOT_COLORS | string;
}) {
  const c = SNAPSHOT_COLORS[color] || SNAPSHOT_COLORS.primary;
  return (
    <div className="bg-background-50 rounded-2xl border border-foreground-200/50 p-4 md:p-5 card-premium">
      <div className={`w-9 h-9 rounded-xl ${c.bg} flex items-center justify-center mb-3`}>
        <i className={`${icon} ${c.icon} text-base`} />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-400 mb-1">{label}</p>
      <p className="text-2xl font-heading font-bold text-foreground-900 leading-none">{value}</p>
      <p className="text-[11px] text-foreground-400 mt-1.5">{detail}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MODULE SECTION — collapsible group of weeks
   ═══════════════════════════════════════════════════════ */
function ModuleSection({ module, defaultOpen, kind, learnerId, navigate, completedIds }: {
  module: JourneyModule; defaultOpen: boolean; kind?: string; learnerId?: string; navigate: NavigateFunction; completedIds: Set<string>;
}) {
  const [collapsed, setCollapsed] = useState(!defaultOpen);
  const weekCount = module.weeks.length;
  const componentCount = module.weeks.reduce((n, w) => n + w.components.length, 0);
  const moduleOtjh = module.weeks.reduce((n, w) => n + w.otjh, 0);

  return (
    <div className="rounded-2xl border border-background-300 bg-background-50 transition-all overflow-hidden">
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
          {moduleOtjh > 0 && <span className="hidden sm:inline text-xs font-semibold text-primary-600">{Math.round(moduleOtjh * 10) / 10}h</span>}
          <div className="w-7 h-7 flex items-center justify-center rounded-lg bg-background-100">
            <i className={`ri-arrow-down-s-line text-foreground-400 transition-transform text-sm ${collapsed ? '' : 'rotate-180'}`} />
          </div>
        </div>
      </button>

      {!collapsed && (
        <div className="border-t border-background-300">
          {weekCount === 0 ? (
            <p className="px-5 py-4 text-[12px] text-foreground-400 italic">No weeks added yet</p>
          ) : (
            <div className="relative pl-10 md:pl-12 pr-4 md:pr-5 py-4">
              <div className="absolute left-7 md:left-[34px] top-0 bottom-0 w-px bg-background-300" />
              <div className="space-y-2">
                {module.weeks.map((w) => (
                  <WeekCard key={w.week} week={w} module={module.module} kind={kind} learnerId={learnerId} navigate={navigate} completedIds={completedIds} />
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
function WeekCard({ week, module, kind, learnerId, navigate, completedIds }: {
  week: JourneyWeek; module: string; kind?: string; learnerId?: string; navigate: NavigateFunction; completedIds: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const componentCount = week.components.length;
  const canStartQuiz = !!(kind && learnerId);

  return (
    <div className="relative pl-6 md:pl-7">
      <div className="absolute left-[-15px] md:left-[-16px] top-[19px] w-2 h-2 rounded-full ring-2 ring-background-100 bg-background-300 z-10" />
      <div className="rounded-xl border border-background-300 bg-white transition-all duration-200 overflow-hidden">
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

        {open && (
          <div className="border-t border-background-300">
            {componentCount === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-foreground-400">No components in this week.</div>
            ) : (
              <div className="divide-y divide-background-300">
                {week.components.map((c) => (
                  <ComponentRow key={c.title} component={c} module={module} week={week.week} kind={kind} learnerId={learnerId} canStartQuiz={canStartQuiz} completed={!!c.componentId && completedIds.has(c.componentId)} navigate={navigate} />
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
   COMPONENT ROW — with quiz start/retake + attempt badge
   ═══════════════════════════════════════════════════════ */
function ComponentRow({ component: c, module, week, kind, learnerId, canStartQuiz, completed, navigate }: {
  component: JourneyComponent; module: string; week: string; kind?: string; learnerId?: string; canStartQuiz: boolean; completed?: boolean; navigate: NavigateFunction;
}) {
  const meta = componentTypeMeta(c.title);
  const attempts = c.quizAttempts || [];
  const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
  const gradeLabel = lastAttempt ? `${gradePercent(lastAttempt.grade)}%` : '';
  const canOpenComponent = !!(kind && learnerId && isOpenableComponent(c));
  // Only assignments collect uploaded evidence, so only they get the view-file affordance.
  const isAssignment = (c.type || '').toLowerCase() === 'assignment';

  return (
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
        <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
          lastAttempt.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
        }`}>
          <i className={lastAttempt.passed ? 'ri-checkbox-circle-line text-[10px]' : 'ri-close-circle-line text-[10px]'} />
          {gradeLabel}
        </span>
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
      {completed && !c.isQuiz && (
        <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-emerald-100 text-emerald-700">
          <i className="ri-checkbox-circle-line text-[10px]" />Done
        </span>
      )}
      {c.type === 'video' && c.videoUrl && c.componentId && canStartQuiz && (
        <button
          onClick={() => navigate(`/learner/video/${kind}/${learnerId}/${c.componentId}?module=${encodeURIComponent(module)}&week=${encodeURIComponent(week)}`)}
          className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer"
        >
          <i className={`${completed ? 'ri-refresh-line' : 'ri-play-fill'} text-[10px]`} />
          {completed ? 'Rewatch' : 'Play'}
        </button>
      )}
      {isAssignment && kind && learnerId && c.componentId && (
        <EvidenceFilesButton kind={kind as LearnerKind} learnerId={learnerId} componentId={c.componentId} />
      )}
      {!c.isQuiz && c.type !== 'video' && c.componentId && canOpenComponent && (
        <button
          onClick={() => navigate(`/learner/component/${kind}/${learnerId}/${c.componentId}?module=${encodeURIComponent(module)}&week=${encodeURIComponent(week)}`)}
          className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors cursor-pointer"
        >
          <i className={`${completed ? 'ri-refresh-line' : 'ri-arrow-right-line'} text-[10px]`} />
          {completed ? 'Review again' : 'Open'}
        </button>
      )}
    </div>
  );
}
