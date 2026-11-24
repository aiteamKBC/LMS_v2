import { AppIcon } from '@/components/feature/AppIcon';
import { Link } from 'react-router-dom';
import { LoadingLabel, LoadingSkeleton } from '@/components/feature/LoadingSkeleton';

/**
 * One readiness measure on the Overview tab. Deliberately a proportion of
 * something countable — mapped KSBs, published components — rather than a score,
 * so the number always has a definition the reader can check.
 */
/**
 * `valueText` replaces the percentage while the figure cannot be known yet
 * (still loading, or the read failed), so an empty bar never reads as 0%.
 */
export function ReadinessBar({ label, value, detail, color, valueText }: { label: string; value: number; detail: React.ReactNode; color: string; valueText?: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold text-foreground-700">{label}</span>
        <span className="text-[13px] font-heading font-bold text-foreground-950">{valueText ?? `${value}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-background-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-foreground-400"><LoadingLabel>{detail}</LoadingLabel></p>
    </div>
  );
}

/**
 * One gap worth acting on, with the action attached. This is what the Overview
 * tab exists for: the programme-level questions ("is anything unstaffed, is
 * anything unmapped") that no single-record page can answer, each pointing at
 * the one place the gap is actually fixed.
 */
export function AttentionRow({ icon, tone, title, detail, action }: {
  icon: string;
  tone: 'amber' | 'rose' | 'sky';
  title: string;
  detail: string;
  action: { label: string; onClick: () => void };
}) {
  const tones = {
    amber: 'border-amber-200 bg-amber-50/70 text-amber-700',
    rose: 'border-rose-200 bg-rose-50/70 text-rose-700',
    sky: 'border-sky-200 bg-sky-50/70 text-sky-700',
  } as const;
  return (
    <li className={`flex flex-col gap-2 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${tones[tone]}`}>
      <span className="flex min-w-0 items-start gap-2.5">
        <AppIcon className={`${icon} mt-0.5 shrink-0 text-base`}></AppIcon>
        <span className="min-w-0">
          <span className="block text-[13px] font-bold"><LoadingLabel>{title}</LoadingLabel></span>
          <span className="block text-[11px] font-semibold opacity-80"><LoadingLabel>{detail}</LoadingLabel></span>
        </span>
      </span>
      <button
        type="button"
        onClick={action.onClick}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold transition-smooth hover:bg-background-100 sm:self-center"
      >
        {action.label}
        <AppIcon className="ri-arrow-right-line text-xs"></AppIcon>
      </button>
    </li>
  );
}

/**
 * A pointer to the page that owns a record type, carrying this programme's count
 * of it. The Cohorts, Groups and Module Builder pages are where those records are
 * managed across the whole curriculum; this workspace scopes them to one
 * programme, and says so rather than pretending to be a separate catalogue.
 */
/** Stands in for a view built from the programme's modules until they arrive. */
export function ModulesLoadingPanel() {
  return (
    <div  className="flex items-center gap-3 rounded-2xl border border-foreground-200/70 bg-background-50 p-5 text-[12px] font-semibold text-foreground-600"><LoadingSkeleton label="Loading this programme's modules..." variant="rows" /></div>
  );
}

export function RecordHomeLink({ icon, label, count, hint, to }: {
  icon: string;
  label: string;
  count: number | string;
  hint: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border border-background-200 bg-background-100/60 p-3 transition-smooth hover:border-primary-200 hover:bg-primary-50/40"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background-50 text-primary-600">
        <AppIcon className={`${icon} text-base`}></AppIcon>
      </span>
      <span className="min-w-0 flex-1">
        {/* One text node between the two, so the accessible name reads
            "3 cohorts" rather than "3cohorts". */}
        <span className="flex items-baseline gap-1.5">
          <span className="text-[15px] font-heading font-bold text-foreground-950">{count}</span>
          {' '}
          <span className="text-[12px] font-bold text-foreground-700">{label}</span>
        </span>
        <span className="block truncate text-[11px] text-foreground-400">{hint}</span>
      </span>
      <AppIcon className="ri-arrow-right-line shrink-0 text-sm text-foreground-300"></AppIcon>
    </Link>
  );
}

export function QualityCheckCard({ title, count, clearText, issueText, icon, onClick }: { title: string; count: number; clearText: string; issueText: string; icon: string; onClick: () => void }) {
  const clear = count === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-32 flex-col rounded-xl border border-background-200 bg-background-100/50 p-4 text-left transition-smooth hover:border-primary-200 hover:bg-background-50 hover:shadow-sm"
    >
      <div className="flex w-full items-start justify-between gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${clear ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          <AppIcon className={clear ? 'ri-checkbox-circle-line' : icon}></AppIcon>
        </span>
        <span className={`rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase ${clear ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {clear ? 'Clear' : count}
        </span>
      </div>
      <p className="mt-3 text-[12px] font-bold text-foreground-900"><LoadingLabel>{title}</LoadingLabel></p>
      <p className={`mt-1 text-[11px] leading-5 ${clear ? 'text-emerald-700' : 'text-foreground-500'}`}>{clear ? clearText : issueText}</p>
      <span className="mt-auto inline-flex items-center gap-1 pt-3 text-[10px] font-bold text-primary-700">{clear ? 'Review' : 'Fix issue'} <AppIcon className="ri-arrow-right-line transition-transform group-hover:translate-x-0.5"></AppIcon></span>
    </button>
  );
}
