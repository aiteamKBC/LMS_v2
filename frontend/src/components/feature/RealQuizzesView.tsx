import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import type { LearnerDetail, LearnerQuizAttempt } from '@/api/learnerDetail';

const learnerNav = roleNavMap.learner;

interface LinkedQuiz {
  quizId: number;
  name: string;        // detail part of the component title
  module: string | null;
  week: string | null;
  questions: number | null;
  attempts: LearnerQuizAttempt[];
}

function gradePercent(g: string | number | undefined): number {
  if (typeof g === 'number') return g;
  const m = String(g ?? '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

/** Derive the learner's linked quizzes (from plan components) + their attempts. */
function buildLinkedQuizzes(real: LearnerDetail | null): LinkedQuiz[] {
  if (!real) return [];
  const byQuiz = new Map<number, LinkedQuiz>();
  for (const c of real.components) {
    if (!c.isQuiz || !c.quizMeta?.quizId) continue;
    const quizId = c.quizMeta.quizId;
    if (byQuiz.has(quizId)) continue;
    // Component title is "Quiz · <name>" — surface the detail part.
    const detail = c.component.includes('·') ? c.component.split('·').slice(1).join('·').trim() : c.component;
    byQuiz.set(quizId, {
      quizId,
      name: detail || c.component,
      module: c.module,
      week: c.week,
      questions: c.quizMeta.questions,
      attempts: real.quizAttempts.filter((a) => a.quizId === quizId),
    });
  }
  return Array.from(byQuiz.values());
}

export function RealQuizzesView({
  real, loading, loadError, kind, learnerId,
}: {
  real: LearnerDetail | null;
  loading: boolean;
  loadError: string | null;
  kind?: string;
  learnerId?: string;
}) {
  const navigate = useNavigate();
  const quizzes = useMemo(() => buildLinkedQuizzes(real), [real]);
  const canTake = !!(kind && learnerId);

  const taken = quizzes.filter((q) => q.attempts.length > 0);
  const passed = taken.filter((q) => q.attempts.some((a) => a.passed));
  const bestScores = taken.map((q) => Math.max(...q.attempts.map((a) => gradePercent(a.grade))));
  const avgBest = bestScores.length ? Math.round(bestScores.reduce((s, n) => s + n, 0) / bestScores.length) : 0;

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
              <h1 className="text-lg md:text-xl font-heading font-bold text-white tracking-tight mb-1.5">Quizzes</h1>
              <p className="text-sm text-white/40 max-w-lg">
                {quizzes.length} linked · {taken.length} taken · {passed.length} passed
              </p>
            </div>
            {taken.length > 0 && (
              <div className="lg:w-[220px] shrink-0 px-5 md:px-7 py-5 md:py-6 border-t lg:border-t-0 lg:border-l border-accent-400/10 flex items-center justify-center">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-3xl font-heading font-bold text-white">{avgBest}%</span>
                  <span className="text-[11px] text-white/50 font-medium uppercase tracking-wider">Avg best score</span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ═══════════ SNAPSHOT ═══════════ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatCard icon="ri-questionnaire-line" label="Linked" value={`${quizzes.length}`} detail="Quizzes on your plan" color="primary" />
          <StatCard icon="ri-check-double-line" label="Taken" value={`${taken.length}`} detail="At least one attempt" color="accent" />
          <StatCard icon="ri-trophy-line" label="Passed" value={`${passed.length}`} detail="Met passing grade" color="secondary" />
          <StatCard icon="ri-percent-line" label="Avg best" value={taken.length ? `${avgBest}%` : '—'} detail="Across taken quizzes" color="amber" />
        </div>

        {/* ═══════════ QUIZ LIST ═══════════ */}
        {loading ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="Loading…" /></div>
        ) : loadError ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text={loadError} /></div>
        ) : quizzes.length === 0 ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="No quizzes are linked to this learner's plan yet." /></div>
        ) : (
          <div className="space-y-3">
            {quizzes.map((q) => (
              <QuizRow key={q.quizId} quiz={q} canTake={canTake} onTake={() =>
                navigate(`/learner/quiz/${kind}/${learnerId}/${q.quizId}?module=${encodeURIComponent(q.module || '')}&week=${encodeURIComponent(q.week || '')}`)
              } />
            ))}
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

const STAT_COLORS: Record<string, { bg: string; icon: string }> = {
  primary: { bg: 'bg-primary-50', icon: 'text-primary-600' },
  accent: { bg: 'bg-accent-50', icon: 'text-accent-600' },
  secondary: { bg: 'bg-secondary-50', icon: 'text-secondary-600' },
  amber: { bg: 'bg-amber-50', icon: 'text-amber-600' },
};

function StatCard({ icon, label, value, detail, color }: { icon: string; label: string; value: string; detail: string; color: string }) {
  const c = STAT_COLORS[color] || STAT_COLORS.primary;
  return (
    <div className="bg-background-50 rounded-2xl border border-foreground-200/50 p-4 md:p-5 card-premium">
      <div className={`w-9 h-9 rounded-xl ${c.bg} flex items-center justify-center mb-3`}><i className={`${icon} ${c.icon} text-base`} /></div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-400 mb-1">{label}</p>
      <p className="text-2xl font-heading font-bold text-foreground-900 leading-none">{value}</p>
      <p className="text-[11px] text-foreground-400 mt-1.5">{detail}</p>
    </div>
  );
}

function QuizRow({ quiz, canTake, onTake }: { quiz: LinkedQuiz; canTake: boolean; onTake: () => void }) {
  const attempts = quiz.attempts;
  const best = attempts.length ? attempts.reduce((b, a) => (gradePercent(a.grade) > gradePercent(b.grade) ? a : b)) : null;
  const bestGrade = best ? (typeof best.grade === 'number' ? `${best.grade}%` : best.grade) : null;
  const bestPassed = best?.passed ?? false;

  return (
    <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-4 md:p-5 card-premium flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
        <i className="ri-questionnaire-line text-amber-600 text-lg" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-heading font-bold text-foreground-900 truncate">{quiz.name}</p>
        <div className="flex items-center gap-x-2.5 gap-y-1 text-[11px] text-foreground-400 mt-1 flex-wrap">
          {quiz.module && <span className="inline-flex items-center gap-1"><i className="ri-book-2-line text-[10px]" />{quiz.module}</span>}
          {quiz.week && <span className="inline-flex items-center gap-1"><i className="ri-calendar-line text-[10px]" />{quiz.week}</span>}
          {quiz.questions != null && <span className="inline-flex items-center gap-1"><i className="ri-list-check text-[10px]" />{quiz.questions} questions</span>}
        </div>
      </div>

      {/* Status */}
      {best ? (
        <div className="shrink-0 flex flex-col items-end gap-0.5">
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${bestPassed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            <i className={bestPassed ? 'ri-checkbox-circle-line text-[10px]' : 'ri-close-circle-line text-[10px]'} />
            {bestGrade} · {bestPassed ? 'Passed' : 'Failed'}
          </span>
          <span className="text-[10px] text-foreground-400">{attempts.length} {attempts.length === 1 ? 'attempt' : 'attempts'} · best</span>
        </div>
      ) : (
        <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-background-100 text-foreground-500">Not started</span>
      )}

      {canTake && (
        <button
          onClick={onTake}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors cursor-pointer"
        >
          <i className={best ? 'ri-refresh-line text-xs' : 'ri-play-fill text-xs'} />
          {best ? 'Retake' : 'Start'}
        </button>
      )}
    </div>
  );
}
