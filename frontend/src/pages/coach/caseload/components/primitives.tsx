// ============================================================================
// Coach caseload — small shared pieces.
//
// The colour and layout for identity, dates and reasons now come from
// `@/pages/coach/shared/LearnerIdentity` and `@/components/ui/*` — the same
// components every other coach page uses. What stays here are thin adapters
// that keep this page's existing vocabulary (`AttentionTier`, `AttentionReason`,
// a raw `daysAway` number) so `LearnerCard` and `LearnerQuickViewDrawer` did not
// have to change, while the actual colour comes from one shared table instead
// of a second one defined here.
// ============================================================================
import { memo } from 'react';
import {
  LearnerAvatar as SharedLearnerAvatar,
  ReasonLine,
  DateStatus as SharedDateStatus,
} from '@/pages/coach/shared/LearnerIdentity';
import { SectionLabel } from '@/components/ui/SectionHeader';
import { FilterChip } from '@/components/ui/FilterToolbar';
import { ProgressBar } from '@/components/ui/ProgressMetric';
import { dueTone } from '@/lib/statusTone';
import { EMPTY_VALUE, displayValue, formatDayOffset, getProgramStatusStyle } from '../lib/format';
import { riskTierStyle } from '../lib/tone';
import { REASON_ICON, type AttentionReason, type AttentionTier } from '../lib/attention';

export { SectionLabel, FilterChip, ProgressBar };

const TIER_TO_TONE = {
  critical: 'critical',
  attention: 'caution',
  upcoming: 'upcoming',
  'on-track': 'positive',
  inactive: 'neutral',
} as const;

// --- risk -------------------------------------------------------------------

export const RiskBadge = memo(function RiskBadge({
  tier,
  label,
  size = 'sm',
}: {
  tier: AttentionTier;
  label: string;
  size?: 'xs' | 'sm' | 'md';
}) {
  const style = riskTierStyle(tier);
  const sizing = size === 'md'
    ? 'px-2.5 py-1 text-[12px]'
    : size === 'sm'
      ? 'px-2 py-0.5 text-[12px]'
      : 'px-1.5 py-0.5 text-[12px]';

  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border font-semibold ${style.bg} ${style.border} ${style.text} ${sizing}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`}></span>
      {label}
    </span>
  );
});

/** Programme status (Active / On a break / Withdrawn), which is not a risk. */
export const StatusPill = memo(function StatusPill({ value }: { value?: string | null }) {
  const label = displayValue(value);
  if (label === EMPTY_VALUE) return null;
  const style = getProgramStatusStyle(value);
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[12px] font-semibold ${style.bg} ${style.border} ${style.text}`}>
      {label}
    </span>
  );
});

// --- avatar -----------------------------------------------------------------

/** Adapts this page's `AttentionTier` onto the shared avatar's `tone`. */
export const LearnerAvatar = memo(function LearnerAvatar({
  initials,
  tier,
  size = 'md',
  onClick,
  title,
}: {
  initials: string;
  tier?: AttentionTier;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  title?: string;
}) {
  const tone = tier ? TIER_TO_TONE[tier] : 'neutral';
  return <SharedLearnerAvatar initials={initials} tone={tone} size={size} onClick={onClick} title={title} />;
});

// --- reasons ----------------------------------------------------------------

const REASON_TONE = { critical: 'critical', warning: 'caution', info: 'brand' } as const;

/** Adapts this page's `AttentionReason` onto the shared `ReasonLine`. */
export const AttentionReasonLine = memo(function AttentionReasonLine({
  reason,
  showDetail = true,
  onClick,
}: {
  reason: AttentionReason;
  showDetail?: boolean;
  onClick?: () => void;
}) {
  return (
    <ReasonLine
      icon={REASON_ICON[reason.metric]}
      label={reason.label}
      detail={showDetail ? reason.detail : undefined}
      tone={REASON_TONE[reason.severity]}
      onClick={onClick}
    />
  );
});

// --- dates ------------------------------------------------------------------

/**
 * A date and what it means right now. Adapts this page's raw `daysAway` onto
 * the shared `DateStatus`, which takes a pre-resolved tone and offset text —
 * the tone/text derivation (overdue vs soon vs neutral) is shared with every
 * other coach page's due-date cells via `dueTone()`.
 */
export const DateStatus = memo(function DateStatus({
  label,
  date,
  daysAway,
  overdueBelow = 0,
  soonBelow = 30,
}: {
  label?: string;
  date: string;
  daysAway: number | null;
  overdueBelow?: number;
  soonBelow?: number;
}) {
  // `overdueBelow` is always 0 at every call site on this page; `dueTone`
  // treats "overdue" as strictly negative, matching that default exactly.
  void overdueBelow;
  return (
    <SharedDateStatus
      label={label}
      date={date}
      daysAway={daysAway}
      tone={dueTone(daysAway, soonBelow)}
      offsetText={daysAway !== null ? formatDayOffset(daysAway) : undefined}
    />
  );
});

// --- metric -----------------------------------------------------------------

/**
 * A number with its meaning attached. `note` is where the interpretation goes
 * ("12.8 hrs behind target"), which is the whole difference between data and
 * information on this page. Kept local rather than replaced by the shared
 * `CompactMetric`: this one supports centred alignment for the card grid and a
 * `noteTone` vocabulary this page already uses everywhere.
 */
export const Metric = memo(function Metric({
  label,
  value,
  note,
  noteTone = 'muted',
  align = 'left',
}: {
  label: string;
  value: string;
  note?: string | null;
  noteTone?: 'muted' | 'warning' | 'critical' | 'positive';
  align?: 'left' | 'center';
}) {
  const noteClass = {
    muted: 'text-foreground-400',
    warning: 'text-amber-700',
    critical: 'text-red-700',
    positive: 'text-emerald-700',
  }[noteTone];

  return (
    <div className={align === 'center' ? 'text-center' : ''}>
      <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-foreground-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-foreground-900">{value}</p>
      {note ? <p className={`mt-0.5 text-[12px] leading-tight ${noteClass}`}>{note}</p> : null}
    </div>
  );
});
