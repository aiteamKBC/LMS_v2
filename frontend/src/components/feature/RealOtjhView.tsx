import { useMemo } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import type { LearnerDetail } from '@/api/learnerDetail';
import { formatHoursMinutes, parseHours } from '@/utils/learnerJourney';

const learnerNav = roleNavMap.learner;

/* ═══════════════════════════════════════════════════════
   REAL Off-the-Job Hours — driven entirely by the learner's
   backend data (Completed/Target/Planned hours, OTJHoursStatus,
   and an activity log built from quiz attempts + video watches).
   Mock-only concepts (validated/paid lifecycle, monthly chart)
   are intentionally omitted — there's no real signal for them.
   ═══════════════════════════════════════════════════════ */

interface LogRow {
  title: string;
  type: string;      // "Quiz" | "Video"
  icon: string;
  tint: string;
  at: string;        // ISO
  ksbs: string[];
  hours: string;     // reportedTime as-is
  passed?: boolean;
  isQuiz: boolean;
}

const RAG = (status: string | null | undefined) =>
  !status ? { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' }
    : /at risk/i.test(status) ? { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' }
    : /attention/i.test(status) ? { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' }
    : { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' };

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function RealOtjhView({ real, loading }: { real: LearnerDetail | null; loading: boolean }) {
  const completed = parseHours(real?.completedHours);
  const target = parseHours(real?.targetHours);
  const planned = parseHours(real?.plannedHours ?? real?.totalExpectedOtjh);
  const progressHours = parseHours(real?.progressHours);
  const variance = real?.progressVariance ? parseFloat(real.progressVariance) : null;
  const status = real?.otjhStatus || 'On track';
  const rag = RAG(status);
  const plannedPercent = planned > 0 ? Math.round((completed / planned) * 100) : 0;
  const targetPercent = target > 0 ? Math.min(100, Math.round((completed / target) * 100)) : 0;

  // Activity log: quiz attempts + video watches, newest first.
  const rows = useMemo<LogRow[]>(() => {
    const quiz = (real?.quizAttempts ?? []).map<LogRow>((a) => ({
      title: `Quiz attempt${a.attempt ? ` #${a.attempt}` : ''}`,
      type: 'Quiz', icon: 'ri-questionnaire-line',
      tint: a.passed ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600',
      at: a.submittedAt, ksbs: a.ksbs || [], hours: a.reportedTime || a.timeTaken || '—',
      passed: a.passed, isQuiz: true,
    }));
    const video = (real?.videoProgress ?? []).map<LogRow>((v) => ({
      title: 'Video watched',
      type: 'Video', icon: 'ri-play-circle-line', tint: 'bg-red-100 text-red-600',
      at: v.submittedAt, ksbs: v.ksbs || [], hours: v.reportedTime || v.timeTaken || '—',
      isQuiz: false,
    }));
    return [...quiz, ...video].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  }, [real]);

  // Hours by activity type (real breakdown).
  const breakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const mins = (() => { const m = String(r.hours).match(/\d+(\.\d+)?/); return m ? parseFloat(m[0]) : 0; })();
      map.set(r.type, (map.get(r.type) || 0) + mins / 60);
    }
    const max = Math.max(1, ...map.values());
    return Array.from(map.entries()).map(([type, hrs]) => ({ type, hrs, pct: Math.round((hrs / max) * 100) }));
  }, [rows]);

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Off-the-Job Hours"
      pageSubtitle={real?.programme || 'Off-the-job training hours'}
      userName={real?.name || 'Learner'}
      userRole="Learner"
    >
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">
        {/* Hero */}
        <section className="relative rounded-2xl overflow-hidden p-6 md:p-8 text-white" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-900)) 0%, oklch(var(--primary-700)) 100%)' }}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="min-w-0">
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${rag.bg} ${rag.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${rag.dot}`} />{status}
              </span>
              <h1 className="mt-3 text-2xl md:text-3xl font-heading font-bold tracking-tight">Off-the-Job Training Hours</h1>
              <p className="mt-1 text-sm text-white/70 max-w-xl">Your logged learning hours, built from every quiz and video you complete and reflect on.</p>
            </div>
            <div className="shrink-0 flex items-center gap-5">
              <div className="text-right">
                <p className="text-4xl font-heading font-bold tabular-nums leading-none">{formatHoursMinutes(completed)}</p>
                <p className="text-xs text-white/70 mt-1">of {formatHoursMinutes(planned)} planned</p>
              </div>
            </div>
          </div>
        </section>

        {/* Stat strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatCard icon="ri-flag-line" iconTint="bg-primary-100 text-primary-600" label="Completed" value={formatHoursMinutes(completed)} sub={`${plannedPercent}% of plan`} />
          <StatCard icon="ri-focus-3-line" iconTint="bg-violet-100 text-violet-600" label="Current target" value={formatHoursMinutes(target)} sub="up to this week" />
          <StatCard
            icon={progressHours < 0 ? 'ri-arrow-down-line' : 'ri-arrow-up-line'}
            iconTint={progressHours < 0 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}
            label={progressHours < 0 ? 'Behind target' : 'Ahead of target'}
            value={formatHoursMinutes(Math.abs(progressHours))}
            sub={variance != null ? `${Math.round(variance * 100)}% variance` : '—'}
          />
          <StatCard icon="ri-calendar-todo-line" iconTint="bg-background-200 text-foreground-500" label="Programme plan" value={formatHoursMinutes(planned)} sub="total planned" />
        </div>

        {/* Progress vs target */}
        <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-heading font-semibold text-foreground-900">Progress against current target</h2>
            <span className="text-xs text-foreground-400">{formatHoursMinutes(completed)} / {formatHoursMinutes(target)}</span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-background-200 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${rag.dot}`} style={{ width: `${targetPercent}%` }} />
          </div>
          <p className="text-[11px] text-foreground-400 mt-1.5">
            {progressHours < 0
              ? `${formatHoursMinutes(Math.abs(progressHours))} behind the ${formatHoursMinutes(target)} you should have logged by now.`
              : `You're on or ahead of your ${formatHoursMinutes(target)} target — keep it up.`}
          </p>
        </section>

        {/* Two-column: activity log + type breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5 items-start">
          <section className="lg:col-span-2 bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="flex items-center justify-between px-4 md:px-5 py-3 border-b border-foreground-100">
              <h2 className="text-base font-heading font-semibold text-foreground-900">Activity Log</h2>
              <span className="text-xs text-foreground-400">{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</span>
            </div>
            {loading ? (
              <div className="p-5"><EmptyState text="Loading…" /></div>
            ) : rows.length === 0 ? (
              <div className="p-5"><EmptyState text="No logged activity yet — complete a quiz or video to see it here." /></div>
            ) : (
              <div className="divide-y divide-foreground-100">
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 md:px-5 py-3">
                    <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${r.tint}`}>
                      <i className={`${r.icon} text-[15px]`} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-foreground-900 truncate">{r.title}</p>
                      <p className="text-[11px] text-foreground-400">{r.type} · {fmtDate(r.at)}</p>
                    </div>
                    {r.ksbs.length > 0 && (
                      <div className="hidden sm:flex flex-wrap gap-1 max-w-[160px] justify-end">
                        {r.ksbs.slice(0, 4).map((k) => (
                          <span key={k} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary-50 text-primary-600">{k}</span>
                        ))}
                        {r.ksbs.length > 4 && <span className="text-[10px] text-foreground-400">+{r.ksbs.length - 4}</span>}
                      </div>
                    )}
                    <span className="shrink-0 text-[12px] font-semibold text-foreground-700 tabular-nums w-16 text-right">{r.hours}</span>
                    {r.isQuiz && (
                      <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${r.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {r.passed ? 'Passed' : 'Attempted'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="lg:col-span-1 bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
            <h2 className="text-base font-heading font-semibold text-foreground-900 mb-4">By activity type</h2>
            {breakdown.length === 0 ? (
              <EmptyState text="No hours logged yet." />
            ) : (
              <div className="space-y-3">
                {breakdown.map((b) => (
                  <div key={b.type}>
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <span className="text-foreground-700">{b.type}</span>
                      <span className="text-foreground-500 font-semibold tabular-nums">{formatHoursMinutes(b.hrs)}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-background-200 overflow-hidden">
                      <div className="h-full rounded-full bg-primary-500" style={{ width: `${b.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </WorkspaceShell>
  );
}

function StatCard({ icon, iconTint, label, value, sub }: { icon: string; iconTint: string; label: string; value: string; sub: string }) {
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconTint}`}><i className={`${icon} text-sm`} /></span>
        <span className="text-xs text-foreground-400">{label}</span>
      </div>
      <p className="text-xl font-heading font-bold text-foreground-900 tabular-nums leading-tight">{value}</p>
      <p className="text-[11px] text-foreground-400 mt-0.5">{sub}</p>
    </div>
  );
}
