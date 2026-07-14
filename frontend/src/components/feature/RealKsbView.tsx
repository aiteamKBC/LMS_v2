import { useMemo } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import type { LearnerDetail, LearnerKsbItem } from '@/api/learnerDetail';

const learnerNav = roleNavMap.learner;

/* ═══════════════════════════════════════════════════════
   REAL KSB Progress — the programme's defined KSBs (real.ksbs),
   each marked Evidenced (its code appears in a quiz/video
   reflection) or Not started. That evidenced signal is the only
   per-learner KSB data the backend has, so the mock's
   Validated/Applied lifecycle is intentionally not shown.
   ═══════════════════════════════════════════════════════ */

const TYPE_META: Record<string, { label: string; icon: string; tint: string; ring: string }> = {
  K: { label: 'Knowledge', icon: 'ri-book-open-line', tint: 'bg-blue-100 text-blue-600', ring: 'text-blue-500' },
  S: { label: 'Skill', icon: 'ri-tools-line', tint: 'bg-violet-100 text-violet-600', ring: 'text-violet-500' },
  B: { label: 'Behaviour', icon: 'ri-user-heart-line', tint: 'bg-amber-100 text-amber-600', ring: 'text-amber-500' },
};
const TYPE_ORDER = ['K', 'S', 'B'];

function typeOf(k: LearnerKsbItem): string {
  return (k.type || k.code.charAt(0) || '?').toUpperCase();
}

function Ring({ percent, colorClass, size = 64, stroke = 6 }: { percent: number; colorClass: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90 shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="text-background-200" stroke="currentColor" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
        className={colorClass} stroke="currentColor" strokeDasharray={c} strokeDashoffset={c - (Math.min(100, percent) / 100) * c}
        style={{ transition: 'stroke-dashoffset 700ms ease-out' }} />
    </svg>
  );
}

export function RealKsbView({ real, loading }: { real: LearnerDetail | null; loading: boolean }) {
  const evidencedCodes = useMemo(() => {
    const set = new Set<string>();
    for (const a of real?.quizAttempts ?? []) for (const code of a.ksbs || []) set.add(code);
    for (const v of real?.videoProgress ?? []) for (const code of v.ksbs || []) set.add(code);
    return set;
  }, [real]);

  const ksbs = real?.ksbs ?? [];
  const total = ksbs.length;
  const evidenced = ksbs.filter((k) => evidencedCodes.has(k.code)).length;
  const overallPct = total ? Math.round((evidenced / total) * 100) : 0;

  // Group by K / S / B.
  const groups = useMemo(() => {
    const by: Record<string, LearnerKsbItem[]> = {};
    for (const k of ksbs) (by[typeOf(k)] ||= []).push(k);
    return TYPE_ORDER.filter((t) => by[t]?.length).map((t) => {
      const items = by[t].slice().sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
      const ev = items.filter((k) => evidencedCodes.has(k.code)).length;
      return { type: t, ...TYPE_META[t], items, evidenced: ev, total: items.length, pct: items.length ? Math.round((ev / items.length) * 100) : 0 };
    });
  }, [ksbs, evidencedCodes]);

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="KSB Progress"
      pageSubtitle={real?.programme || 'Knowledge, Skills & Behaviours'}
      userName={real?.name || 'Learner'}
      userRole="Learner"
    >
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">
        {/* Hero */}
        <section className="relative rounded-2xl overflow-hidden p-6 md:p-8 text-white" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-900)) 0%, oklch(var(--primary-700)) 100%)' }}>
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-4 min-w-0">
              <span className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><i className="ri-bar-chart-2-line text-2xl" /></span>
              <div className="min-w-0">
                <h1 className="text-2xl md:text-3xl font-heading font-bold tracking-tight">KSB Progress</h1>
                <p className="text-sm text-white/70">Knowledge, Skills &amp; Behaviours evidenced through your activities</p>
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-3">
              <div className="relative flex items-center justify-center">
                <Ring percent={overallPct} colorClass="text-white" size={72} stroke={7} />
                <span className="absolute text-sm font-heading font-bold tabular-nums">{overallPct}%</span>
              </div>
              <div className="text-right">
                <p className="text-lg font-heading font-bold leading-none">{evidenced}<span className="text-white/60">/{total}</span></p>
                <p className="text-[11px] text-white/70 mt-1">evidenced</p>
              </div>
            </div>
          </div>
        </section>

        {/* Stat strip */}
        <div className="grid grid-cols-2 gap-3 md:gap-4">
          <StatCard icon="ri-checkbox-circle-line" tint="bg-emerald-100 text-emerald-600" label="Evidenced" value={`${evidenced}`} total={total} barClass="bg-emerald-500" pct={overallPct} />
          <StatCard icon="ri-circle-line" tint="bg-background-200 text-foreground-500" label="Not started" value={`${total - evidenced}`} total={total} barClass="bg-foreground-300" pct={total ? Math.round(((total - evidenced) / total) * 100) : 0} />
        </div>

        {/* Category cards */}
        {loading ? (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-6"><EmptyState text="Loading…" /></div>
        ) : total === 0 ? (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-6"><EmptyState text="No KSBs defined for this programme yet." /></div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
              {groups.map((g) => (
                <div key={g.type} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${g.tint}`}><i className={`${g.icon} text-base`} /></span>
                      <div>
                        <p className="text-sm font-heading font-bold text-foreground-900">{g.label}</p>
                        <p className="text-[11px] text-foreground-400">{g.evidenced} of {g.total} evidenced</p>
                      </div>
                    </div>
                    <div className="relative flex items-center justify-center">
                      <Ring percent={g.pct} colorClass={g.ring} size={48} stroke={5} />
                      <span className="absolute text-[10px] font-heading font-bold tabular-nums text-foreground-700">{g.pct}%</span>
                    </div>
                  </div>
                  <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                    {g.items.map((k) => {
                      const ev = evidencedCodes.has(k.code);
                      return (
                        <div key={k.code} className="flex items-start gap-2 py-1.5">
                          <span className={`shrink-0 w-2 h-2 rounded-full mt-1.5 ${ev ? 'bg-emerald-500' : 'bg-foreground-300'}`} />
                          <div className="min-w-0 flex-1">
                            <span className="text-[12px] font-semibold text-primary-600">{k.code}</span>
                            <span className="text-[12px] text-foreground-600"> — {k.description}</span>
                          </div>
                          <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${ev ? 'bg-emerald-100 text-emerald-700' : 'bg-background-200 text-foreground-500'}`}>
                            {ev ? 'Evidenced' : 'Not started'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}

function StatCard({ icon, tint, label, value, total, barClass, pct }: { icon: string; tint: string; label: string; value: string; total: number; barClass: string; pct: number }) {
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${tint}`}><i className={`${icon} text-sm`} /></span>
        <span className="text-xs text-foreground-400">{label}</span>
      </div>
      <p className="text-xl font-heading font-bold text-foreground-900 tabular-nums leading-tight">{value}<span className="text-sm text-foreground-400">/{total}</span></p>
      <div className="mt-2 h-1.5 w-full rounded-full bg-background-200 overflow-hidden">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
