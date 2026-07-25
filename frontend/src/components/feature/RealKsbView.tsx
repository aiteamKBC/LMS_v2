import { useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import type { LearnerDetail } from '@/api/learnerDetail';
import {
  buildKsbProgress, completedComponentIds, componentTypeMeta,
  type KsbProgress, type KsbStatus,
} from '@/utils/learnerJourney';

const learnerNav = roleNavMap.learner;

/* ═══════════════════════════════════════════════════════
   REAL KSB Progress — weighted.

   Each component in the training plan declares the KSBs it
   develops and at what weight. A KSB's progress is therefore
   the weight EARNED from components already completed over
   the weight AVAILABLE across the whole plan, and we can name
   exactly which activities still have to be done.

   Weight always comes from the component's authored mapping,
   never from the codes stored on a completion record — legacy
   records hold learner-picked codes with no weight behind them.
   ═══════════════════════════════════════════════════════ */

const TYPE_META: Record<string, { label: string; icon: string; tint: string; ring: string }> = {
  K: { label: 'Knowledge', icon: 'ri-book-open-line', tint: 'bg-blue-100 text-blue-600', ring: 'text-blue-500' },
  S: { label: 'Skill', icon: 'ri-tools-line', tint: 'bg-violet-100 text-violet-600', ring: 'text-violet-500' },
  B: { label: 'Behaviour', icon: 'ri-user-heart-line', tint: 'bg-amber-100 text-amber-600', ring: 'text-amber-500' },
};
const TYPE_ORDER = ['K', 'S', 'B'];

const STATUS_META: Record<KsbStatus, { label: string; badge: string; dot: string; bar: string }> = {
  complete: { label: 'Fully evidenced', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  'in-progress': { label: 'In progress', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500', bar: 'bg-amber-500' },
  'not-started': { label: 'Not started', badge: 'bg-background-200 text-foreground-500', dot: 'bg-foreground-300', bar: 'bg-foreground-300' },
  'not-scheduled': { label: 'Not scheduled', badge: 'bg-background-100 text-foreground-400', dot: 'bg-background-300', bar: 'bg-background-300' },
};

/** Weights are authored as whole numbers but stored as floats. */
function w(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1);
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

type Filter = 'all' | 'scheduled' | KsbStatus;

export function RealKsbView({ real, loading }: { real: LearnerDetail | null; loading: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const progress = useMemo(() => buildKsbProgress({
    ksbs: real?.ksbs ?? [],
    components: real?.components ?? [],
    completedComponentIds: completedComponentIds(real),
  }), [real]);

  const total = progress.length;
  const scheduled = progress.filter((k) => k.status !== 'not-scheduled');
  const complete = progress.filter((k) => k.status === 'complete').length;
  const inProgress = progress.filter((k) => k.status === 'in-progress').length;
  const unscheduled = total - scheduled.length;

  // Headline is weight-based across everything the plan actually offers, so a
  // single bulk record can no longer push it to a misleading number.
  const earnedWeight = progress.reduce((s, k) => s + k.earnedWeight, 0);
  const availableWeight = progress.reduce((s, k) => s + k.availableWeight, 0);
  const overallPct = availableWeight > 0 ? Math.round((earnedWeight / availableWeight) * 100) : 0;

  const visible = useMemo(() => progress.filter((k) => (
    filter === 'all' ? true
      : filter === 'scheduled' ? k.status !== 'not-scheduled'
        : k.status === filter
  )), [progress, filter]);

  const groups = useMemo(() => {
    const by: Record<string, KsbProgress[]> = {};
    for (const k of visible) (by[k.type] ||= []).push(k);
    return TYPE_ORDER.filter((t) => by[t]?.length).map((t) => {
      const items = by[t];
      const av = items.reduce((s, k) => s + k.availableWeight, 0);
      const ea = items.reduce((s, k) => s + k.earnedWeight, 0);
      return {
        type: t, ...TYPE_META[t], items,
        complete: items.filter((k) => k.status === 'complete').length,
        total: items.length,
        pct: av > 0 ? Math.round((ea / av) * 100) : 0,
        earned: ea, available: av,
      };
    });
  }, [visible]);

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
          <div className="flex items-center justify-between gap-6 flex-wrap">
            <div className="flex items-center gap-4 min-w-0">
              <span className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><i className="ri-bar-chart-2-line text-2xl" /></span>
              <div className="min-w-0">
                <h1 className="text-2xl md:text-3xl font-heading font-bold tracking-tight">KSB Progress</h1>
                <p className="text-sm text-white/70">Weight earned from the activities in your training plan</p>
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-3">
              <div className="relative flex items-center justify-center">
                <Ring percent={overallPct} colorClass="text-white" size={72} stroke={7} />
                <span className="absolute text-sm font-heading font-bold tabular-nums">{overallPct}%</span>
              </div>
              <div className="text-right">
                <p className="text-lg font-heading font-bold leading-none tabular-nums">{w(earnedWeight)}<span className="text-white/60">/{w(availableWeight)}</span></p>
                <p className="text-[11px] text-white/70 mt-1">weight earned</p>
              </div>
            </div>
          </div>
        </section>

        {/* Stat strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatCard icon="ri-checkbox-circle-line" tint="bg-emerald-100 text-emerald-600" label="Fully evidenced" value={complete} total={total} barClass="bg-emerald-500" />
          <StatCard icon="ri-progress-4-line" tint="bg-amber-100 text-amber-600" label="In progress" value={inProgress} total={total} barClass="bg-amber-500" />
          <StatCard icon="ri-circle-line" tint="bg-background-200 text-foreground-500" label="Not started" value={scheduled.length - complete - inProgress} total={total} barClass="bg-foreground-300" />
          <StatCard icon="ri-calendar-close-line" tint="bg-background-200 text-foreground-400" label="Not scheduled" value={unscheduled} total={total} barClass="bg-background-300"
            hint="No activity in your plan covers these yet" />
        </div>

        {/* Filters */}
        {total > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              ['all', `All ${total}`],
              ['scheduled', `In your plan ${scheduled.length}`],
              ['complete', `Fully evidenced ${complete}`],
              ['in-progress', `In progress ${inProgress}`],
              ['not-started', `Not started ${scheduled.length - complete - inProgress}`],
              ['not-scheduled', `Not scheduled ${unscheduled}`],
            ] as [Filter, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                  filter === key ? 'bg-foreground-900 text-background-50' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Category cards */}
        {loading ? (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-6"><EmptyState text="Loading…" /></div>
        ) : total === 0 ? (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-6"><EmptyState text="No KSBs defined for this programme yet." /></div>
        ) : visible.length === 0 ? (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-6"><EmptyState text="No KSBs match this filter." /></div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 md:gap-5 items-start">
            {groups.map((g) => (
              <div key={g.type} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${g.tint}`}><i className={`${g.icon} text-base`} /></span>
                    <div>
                      <p className="text-sm font-heading font-bold text-foreground-900">{g.label}</p>
                      <p className="text-[11px] text-foreground-400">
                        {g.complete} of {g.total} fully evidenced
                        {g.available > 0 && <> · {w(g.earned)}/{w(g.available)} weight</>}
                      </p>
                    </div>
                  </div>
                  <div className="relative flex items-center justify-center">
                    <Ring percent={g.pct} colorClass={g.ring} size={48} stroke={5} />
                    <span className="absolute text-[10px] font-heading font-bold tabular-nums text-foreground-700">{g.pct}%</span>
                  </div>
                </div>
                <div className="space-y-1.5 max-h-[32rem] overflow-y-auto pr-1">
                  {g.items.map((k) => (
                    <KsbRow
                      key={k.code}
                      ksb={k}
                      open={expanded === k.code}
                      onToggle={() => setExpanded(expanded === k.code ? null : k.code)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

/* One KSB: collapsed shows weight + progress; expanded names the activities. */
function KsbRow({ ksb, open, onToggle }: { ksb: KsbProgress; open: boolean; onToggle: () => void }) {
  const st = STATUS_META[ksb.status];
  const scheduled = ksb.status !== 'not-scheduled';

  return (
    <div className={`rounded-lg border transition-colors ${open ? 'border-primary-200 bg-white' : 'border-transparent hover:bg-background-100/60'}`}>
      <button
        onClick={onToggle}
        disabled={!scheduled}
        className={`w-full text-left px-2.5 py-2 ${scheduled ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-start gap-2">
          <span className={`shrink-0 w-2 h-2 rounded-full mt-1.5 ${st.dot}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[12px] font-semibold text-primary-600">{ksb.code}</span>
              {scheduled && (
                <span className="text-[10px] font-semibold text-foreground-500 tabular-nums">
                  {w(ksb.earnedWeight)}/{w(ksb.availableWeight)} weight
                </span>
              )}
            </div>
            <p className="text-[12px] text-foreground-600 leading-snug line-clamp-2">{ksb.description}</p>
          </div>
          <div className="shrink-0 flex items-center gap-1.5">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${st.badge}`}>{st.label}</span>
            {scheduled && <i className={`ri-arrow-down-s-line text-foreground-400 text-sm transition-transform ${open ? 'rotate-180' : ''}`} />}
          </div>
        </div>

        {scheduled ? (
          <div className="mt-1.5 ml-4 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-background-200 overflow-hidden">
              <div className={`h-full rounded-full ${st.bar}`} style={{ width: `${ksb.pct}%`, transition: 'width 700ms ease-out' }} />
            </div>
            <span className="text-[10px] font-semibold text-foreground-500 tabular-nums w-8 text-right">{ksb.pct}%</span>
          </div>
        ) : (
          <p className="mt-1 ml-4 text-[10px] text-foreground-400">No activity in your plan covers this yet.</p>
        )}
      </button>

      {open && scheduled && (
        <div className="px-2.5 pb-2.5 pt-0.5 ml-4 space-y-2">
          {/* Criteria — what it takes to finish this KSB */}
          <div className={`rounded-lg border p-2.5 ${ksb.status === 'complete' ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-500 mb-1 flex items-center gap-1">
              <i className={ksb.status === 'complete' ? 'ri-checkbox-circle-line text-emerald-600' : 'ri-flag-line text-amber-600'} />
              {ksb.status === 'complete' ? 'Achieved' : 'To achieve this KSB'}
            </p>
            <p className="text-[11px] text-foreground-700 leading-relaxed">
              {ksb.status === 'complete' ? (
                <>You have completed all {ksb.totalCount} {ksb.totalCount === 1 ? 'activity' : 'activities'} that develop
                  this KSB, earning the full {w(ksb.availableWeight)} weight.</>
              ) : (
                <>Complete the remaining {ksb.totalCount - ksb.doneCount} of {ksb.totalCount}{' '}
                  {ksb.totalCount === 1 ? 'activity' : 'activities'} below to earn the last{' '}
                  <span className="font-semibold">{w(ksb.remainingWeight)}</span> weight
                  ({w(ksb.earnedWeight)} of {w(ksb.availableWeight)} so far).</>
              )}
            </p>
          </div>

          {/* Activities that fulfil this KSB */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400 mb-1">
              Activities that develop this KSB
            </p>
            <ul className="space-y-1">
              {ksb.contributors.map((c, i) => {
                const meta = componentTypeMeta(c.title);
                return (
                  <li key={`${c.componentId}-${i}`} className="flex items-start gap-2 rounded-lg border border-background-200 bg-background-50 px-2 py-1.5">
                    <i className={`${c.done ? 'ri-checkbox-circle-fill text-emerald-600' : 'ri-checkbox-blank-circle-line text-foreground-300'} text-sm shrink-0 mt-0.5`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-semibold text-foreground-800 leading-snug truncate">
                        {meta.detail || meta.label}
                      </span>
                      <span className="block text-[10px] text-foreground-400 truncate">
                        {[meta.label, c.week].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`block text-[11px] font-semibold tabular-nums ${c.done ? 'text-emerald-700' : 'text-foreground-500'}`}>
                        +{w(c.weight)}
                      </span>
                      {c.classification && (
                        <span className="block text-[9px] text-foreground-400 capitalize">{c.classification}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, tint, label, value, total, barClass, hint }: {
  icon: string; tint: string; label: string; value: number; total: number; barClass: string; hint?: string;
}) {
  const pct = total ? Math.round((value / total) * 100) : 0;
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
      {hint && <p className="text-[10px] text-foreground-400 mt-1.5 leading-snug">{hint}</p>}
    </div>
  );
}
