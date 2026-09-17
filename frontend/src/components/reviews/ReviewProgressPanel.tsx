import { Loader2, RefreshCw } from 'lucide-react';
import type { ReviewProgressMetric, ReviewProgressSnapshot, ReviewRagHistoryEntry } from '@/api/reviewInstances';

/**
 * A Progress Review's Learning Progress area.
 *
 * Purely a renderer for what the backend froze: it never derives a percentage
 * the snapshot does not carry, and never falls back to the learner's current
 * figures. A review with no snapshot says so, which is the honest state for
 * one that was completed without ever being calculated.
 */

const METRICS: { key: keyof Pick<ReviewProgressSnapshot, 'programmeProgress' | 'offTheJobHours'>; label: string }[] = [
  { key: 'programmeProgress', label: 'Programme progress' },
  { key: 'offTheJobHours', label: 'Off-the-job hours progress' },
];

function percentLabel(value: number | null): string {
  return value === null || value === undefined ? 'Not recorded' : `${Math.round(value)}%`;
}

function dateLabel(value: string | null | undefined, withTime = false): string {
  if (!value) return 'Not recorded';
  // The API formats timestamps without an offset; those timestamps are UTC.
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) || !value.includes(':')
    ? value
    : `${value.replace(' ', 'T')}Z`;
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Europe/London',
  }).format(parsed);
}

function clamp(value: number | null): number | null {
  return value === null || value === undefined ? null : Math.max(0, Math.min(value, 100));
}

function MetricBar({ label, metric }: { label: string; metric: ReviewProgressMetric }) {
  const actual = clamp(metric?.actualPercent ?? null);
  const expected = clamp(metric?.expectedPercent ?? null);
  const variance = metric?.variancePercent;
  const direction = metric?.varianceDirection;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-bold text-foreground-800">{label}</p>
        <p className="text-[13px] font-bold text-foreground-900">{percentLabel(metric?.actualPercent ?? null)}</p>
      </div>
      <div
        className="relative mt-2 h-2.5 w-full overflow-hidden rounded-full bg-background-200"
        role="img"
        aria-label={`${label}: ${percentLabel(metric?.actualPercent ?? null)} against an expected ${percentLabel(metric?.expectedPercent ?? null)}`}
      >
        <div className="h-full rounded-full bg-primary-600" style={{ width: `${actual ?? 0}%` }} />
        {expected === null ? null : (
          <span aria-hidden className="absolute inset-y-0 w-0.5 bg-foreground-700" style={{ left: `${expected}%` }} />
        )}
      </div>
      <p className="mt-1.5 text-[12px] text-foreground-500">
        {variance === null || variance === undefined || !direction
          ? `Expected ${percentLabel(metric?.expectedPercent ?? null)}`
          : `${Math.abs(Math.round(variance))}% ${direction} expected (${percentLabel(metric?.expectedPercent ?? null)})`}
      </p>
    </div>
  );
}

function RagHistory({ entries }: { entries: ReviewRagHistoryEntry[] }) {
  if (!entries.length) return null;
  return (
    <div className="mt-4 border-t border-background-200 pt-4">
      <h4 className="text-[12px] font-bold uppercase tracking-[0.12em] text-foreground-400">RAG status</h4>
      <ul className="mt-2 space-y-1.5">
        {entries.map((entry) => (
          <li key={entry.reviewInstanceId} className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
            <span className="font-semibold text-foreground-700">
              {entry.reviewName || 'Progress Review'}
              {entry.targetDate ? ` - ${dateLabel(entry.targetDate)}` : ''}
            </span>
            <span className="text-foreground-600">{entry.rag || 'None'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReviewProgressPanel({
  snapshot,
  ragHistory = [],
  canCalculate,
  calculating,
  onCalculate,
}: {
  snapshot: ReviewProgressSnapshot | null | undefined;
  ragHistory?: ReviewRagHistoryEntry[];
  /** False once the review reaches the signature step -- the figures a party
   *  is signing must not move underneath them. */
  canCalculate: boolean;
  calculating: boolean;
  onCalculate: () => void;
}) {
  return (
    <section aria-label="Learning progress" className="rounded-2xl border border-background-200 bg-background-50 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-foreground-900">Learning Progress</h3>
          {snapshot ? (
            <p className="mt-1 text-[12px] text-foreground-500">
              Calculated from {dateLabel(snapshot.calculatedFrom)} · Calculated at {dateLabel(snapshot.calculatedAt, true)}
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-foreground-500">No progress snapshot calculated yet.</p>
          )}
        </div>
        {canCalculate ? (
          <button
            type="button"
            onClick={onCalculate}
            disabled={calculating}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-background-300 bg-white px-4 text-xs font-bold text-foreground-700 shadow-sm transition hover:bg-background-100 disabled:opacity-60"
          >
            {calculating
              ? <Loader2 size={15} className="animate-spin" />
              : <RefreshCw size={15} />}
            {calculating ? 'Calculating...' : snapshot ? 'Recalculate' : 'Calculate'}
          </button>
        ) : null}
      </div>

      {snapshot ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {METRICS.map(({ key, label }) => <MetricBar key={key} label={label} metric={snapshot[key]} />)}
        </div>
      ) : !canCalculate ? (
        <p className="mt-3 text-[13px] text-foreground-500">No progress was calculated for this review.</p>
      ) : null}

      <RagHistory entries={ragHistory} />
    </section>
  );
}
