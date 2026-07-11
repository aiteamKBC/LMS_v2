import { useMemo } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import type { LearnerDetail } from '@/api/learnerDetail';
import { buildLearnerJourney, quizAggregateStats, type JourneyModule } from '@/utils/learnerJourney';

const learnerNav = roleNavMap.learner;

/**
 * Rich "Learning Journey" view for a REAL learner — a road/timeline of the
 * learner's real modules. Each stop shows only real-backed figures (weeks,
 * components, KSBs referenced, planned OTJH, quizzes-linked/taken). Mock-only
 * fields (per-module progress %, tutor, assignments, evidence counts) are
 * omitted since the real data doesn't track them.
 */
export function RealLearningJourneyView({
  real, loading, loadError,
}: {
  real: LearnerDetail | null;
  loading: boolean;
  loadError: string | null;
}) {
  const journey = useMemo(() => buildLearnerJourney(real), [real]);
  const quizStats = useMemo(() => quizAggregateStats(real), [real]);

  const totalWeeks = journey.reduce((n, m) => n + m.weeks.length, 0);
  const totalComponents = journey.reduce((n, m) => n + m.weeks.reduce((k, w) => k + w.components.length, 0), 0);
  const totalOtjh = real?.totalExpectedOtjh ?? 0;

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
                  <span className="text-xs font-semibold text-accent-300/80 uppercase tracking-wider bg-accent-400/10 px-2.5 py-1 rounded-md border border-accent-400/15">{subtitle}</span>
                </div>
              )}
              <h1 className="text-lg md:text-xl font-heading font-bold text-white tracking-tight mb-1.5">Learning Journey</h1>
              <p className="text-sm text-white/40 max-w-lg">
                {journey.length} {journey.length === 1 ? 'module' : 'modules'} · {totalWeeks} {totalWeeks === 1 ? 'week' : 'weeks'} · {totalComponents} {totalComponents === 1 ? 'component' : 'components'}
              </p>
            </div>
            <div className="lg:w-[220px] shrink-0 px-5 md:px-7 py-5 md:py-6 border-t lg:border-t-0 lg:border-l border-accent-400/10 flex items-center justify-center">
              <div className="flex flex-col items-center gap-1">
                <span className="text-3xl font-heading font-bold text-white">{totalOtjh}h</span>
                <span className="text-[11px] text-white/50 font-medium uppercase tracking-wider">Planned OTJH</span>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════ MODULE ROAD ═══════════ */}
        {loading ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="Loading…" /></div>
        ) : loadError ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text={loadError} /></div>
        ) : journey.length === 0 ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="No training plan built for this learner yet." /></div>
        ) : (
          <div className="relative">
            {/* vertical road line */}
            <div className="absolute left-[22px] md:left-[26px] top-4 bottom-4 w-0.5 bg-background-300" />
            <div className="space-y-4">
              {journey.map((mod, i) => (
                <ModuleStop key={mod.module} module={mod} index={i} quizzesTaken={quizStats.quizzesTaken} />
              ))}
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

/* ═══════════════════════════════════════════════════════
   MODULE STOP — one node on the journey road
   ═══════════════════════════════════════════════════════ */
function ModuleStop({ module, index }: { module: JourneyModule; index: number; quizzesTaken: number }) {
  const weekCount = module.weeks.length;
  const componentCount = module.weeks.reduce((n, w) => n + w.components.length, 0);
  const moduleOtjh = module.weeks.reduce((n, w) => n + w.otjh, 0);
  const quizComponents = module.weeks.reduce(
    (n, w) => n + w.components.filter((c) => c.isQuiz).length, 0,
  );
  const quizzesTakenInModule = module.weeks.reduce(
    (n, w) => n + w.components.filter((c) => c.isQuiz && (c.quizAttempts?.length || 0) > 0).length, 0,
  );
  // Distinct KSB codes referenced by this module's quiz attempts.
  const ksbSet = new Set<string>();
  for (const w of module.weeks) for (const c of w.components) for (const code of (c.quizAttempts?.flatMap((a) => a.ksbs || []) || [])) ksbSet.add(code);

  return (
    <div className="relative pl-12 md:pl-14">
      {/* Node marker */}
      <div className="absolute left-0 top-4 w-11 h-11 md:w-[52px] md:h-[52px] rounded-2xl bg-primary-100 border-4 border-background-50 flex items-center justify-center shrink-0 z-10">
        <span className="text-sm font-heading font-bold text-primary-700">{index + 1}</span>
      </div>

      <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5 card-premium">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary-600 mb-0.5">Module {index + 1}</p>
            <h3 className="text-base font-heading font-bold text-foreground-900 leading-snug">{module.module}</h3>
            <p className="text-xs text-foreground-400 mt-1">
              {weekCount} {weekCount === 1 ? 'week' : 'weeks'} · {componentCount} {componentCount === 1 ? 'component' : 'components'}
            </p>
          </div>
          {moduleOtjh > 0 && (
            <span className="shrink-0 text-xs font-semibold text-primary-600 bg-primary-50 px-2.5 py-1 rounded-lg">{Math.round(moduleOtjh * 10) / 10}h OTJH</span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <MiniStat icon="ri-calendar-line" label="Weeks" value={`${weekCount}`} />
          <MiniStat icon="ri-stack-line" label="Components" value={`${componentCount}`} />
          <MiniStat icon="ri-questionnaire-line" label="Quizzes" value={quizComponents > 0 ? `${quizzesTakenInModule}/${quizComponents}` : '—'} />
          <MiniStat icon="ri-award-line" label="KSBs evidenced" value={ksbSet.size > 0 ? `${ksbSet.size}` : '—'} />
        </div>

        {/* Week chips */}
        {weekCount > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-4">
            {module.weeks.map((w) => (
              <span key={w.week} className="text-[11px] font-medium px-2 py-1 rounded-lg bg-background-100 text-foreground-600 border border-background-300">
                {w.week} · {w.components.length}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-foreground-100 p-2.5">
      <i className={`${icon} text-primary-500 text-sm`} />
      <p className="text-sm font-heading font-bold text-foreground-900 mt-1 leading-none">{value}</p>
      <p className="text-[10px] text-foreground-400 mt-1">{label}</p>
    </div>
  );
}
