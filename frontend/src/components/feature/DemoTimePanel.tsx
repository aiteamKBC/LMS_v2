import { useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ProgressBar } from '@/components/ui/ProgressMetric';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDemoMinutes, setDemoTimeOverride, type DemoProgrammeSummary } from '@/lib/demoTime';

// ============================================================================
// Inspection-demo time UI. Rendered only behind `isInspectionDemoAccount` —
// see learnerFlowAccess.ts / demoTime.ts. Deliberately labelled "Demo" so it
// reads as an overlay on the real workspace, not a redesign of it.
// ============================================================================

/** One compact figure in the summary strip. */
function SummaryFigure({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex min-w-[104px] flex-1 items-center gap-2 rounded-xl border border-foreground-200/60 bg-background-50 px-3 py-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-600">
        <AppIcon className={`${icon} text-[13px]`} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold leading-tight text-foreground-900">{value}</span>
        <span className="block truncate text-[10px] font-semibold uppercase tracking-wide text-foreground-400">{label}</span>
      </span>
    </div>
  );
}

/** Cosmetic icon per card position — purely presentational, cycles through a
 * fixed palette keyed by the material's authored `order` so it stays stable
 * across renders without encoding any meaning of its own. */
const MATERIAL_ICONS = ['ri-book-2-line', 'ri-bar-chart-box-line', 'ri-lightbulb-flash-line', 'ri-shield-check-line', 'ri-team-line', 'ri-compass-3-line'];

type DemoMaterialStatus = 'not-available' | 'completed' | 'in-progress' | 'not-started';

function materialStatus(available: boolean, complete: boolean, completionPct: number): DemoMaterialStatus {
  if (!available) return 'not-available';
  if (complete) return 'completed';
  if (completionPct > 0) return 'in-progress';
  return 'not-started';
}

const STATUS_META: Record<DemoMaterialStatus, { label: string; tone: 'positive' | 'info' | 'neutral' }> = {
  'not-available': { label: 'Not yet available', tone: 'neutral' },
  completed: { label: 'Completed', tone: 'positive' },
  'in-progress': { label: 'In progress', tone: 'info' },
  'not-started': { label: 'Not started', tone: 'neutral' },
};

/** The same Not started / In progress / Completed / Not yet available badge
 * `DemoMaterialCard` shows, for reuse on the material drill-down header. */
export function DemoMaterialStatusBadge({
  available,
  complete,
  completionPct,
  size = 'md',
  className,
}: {
  available: boolean;
  complete: boolean;
  completionPct: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const meta = STATUS_META[materialStatus(available, complete, completionPct)];
  return <StatusBadge tone={meta.tone} label={meta.label} size={size} className={className} />;
}

/** One material card in "Your Materials": title, status, progress, learning
 * time and the current/next activity, ending in a compact CTA. `summary` is
 * the material's own component-level rollup (see `timingsForModuleIds` +
 * `summariseDemoTimings`) — never a separately-tracked figure. */
export function DemoMaterialCard({
  name,
  order = 1,
  summary,
  currentWeekLabel,
  complete,
  available,
  onContinue,
}: {
  name: string;
  /** The material's authored display order — used only to pick a stable icon. */
  order?: number;
  summary: DemoProgrammeSummary;
  /** The material's current week label, or null when every week is done. */
  currentWeekLabel: string | null;
  /** Every openable component in the material is complete. */
  complete: boolean;
  /** False when no authored content exists for this material yet. */
  available: boolean;
  onContinue: () => void;
}) {
  const status = materialStatus(available, complete, summary.completionPct);
  const meta = STATUS_META[status];
  const icon = MATERIAL_ICONS[(Math.max(1, order) - 1) % MATERIAL_ICONS.length];
  const activityLabel = !available
    ? null
    : complete
      ? 'All components complete'
      : currentWeekLabel
        ? `Continue: ${currentWeekLabel}`
        : 'Ready to start';

  return (
    <Panel className="flex min-h-[190px] h-full flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-600">
            <AppIcon className={`${icon} text-[16px]`} />
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="text-[15px] font-semibold leading-snug text-foreground-900">{name}</p>
            {activityLabel && <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-foreground-400">{activityLabel}</p>}
          </div>
        </div>
        <StatusBadge tone={meta.tone} label={meta.label} size="sm" className="shrink-0" />
      </div>

      {available ? (
        <>
          <div className="mt-3.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-foreground-400">Progress</span>
            <span className="text-[12px] font-semibold tabular-nums text-foreground-800">{summary.completionPct}%</span>
          </div>
          <ProgressBar percent={summary.completionPct} tone="bg-primary-500" className="mt-1" />

          <div className="mt-4 flex flex-1 flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div className="flex flex-col gap-1 text-[11px] text-foreground-500">
              <span className="inline-flex items-center gap-1">
                <AppIcon className="ri-time-line text-[11px]" />
                {formatDemoMinutes(summary.completedMinutes)} of {formatDemoMinutes(summary.expectedMinutes)}
              </span>
              <span className="inline-flex items-center gap-1">
                <AppIcon className="ri-list-check-2 text-[11px]" />
                {summary.materialsCompleted}/{summary.materialsTotal} components
              </span>
            </div>
            <button
              type="button"
              onClick={onContinue}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:bg-primary-700"
            >
              Open material
              <AppIcon className="ri-arrow-right-line text-[12px]" />
            </button>
          </div>
        </>
      ) : (
        <div className="mt-3.5 flex flex-1 flex-col justify-between gap-3">
          <p className="text-[11px] text-foreground-400">This material has no published content yet.</p>
          <span className="inline-flex w-fit items-center gap-1 rounded-lg bg-background-100 px-3 py-1.5 text-[12px] font-semibold text-foreground-400">
            <AppIcon className="ri-time-line text-[12px]" />
            Coming soon
          </span>
        </div>
      )}
    </Panel>
  );
}

/** Compact programme-level time summary, built entirely from component-level
 * data (see `summariseDemoTimings`) — never a single stored programme total. */
export function DemoProgrammeSummaryCard({ summary }: { summary: DemoProgrammeSummary }) {
  return (
    <Panel>
      <SectionHeader
        title="Programme Time"
        icon="ri-timer-flash-line"
        description="Inspection view · component-level totals"
        actions={
          <span className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-semibold text-primary-700">
            <AppIcon className="ri-eye-line text-[10px]" />Demo account
          </span>
        }
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <SummaryFigure icon="ri-percent-line" label="Programme progress" value={`${summary.completionPct}%`} />
        <SummaryFigure icon="ri-hourglass-line" label="Total time" value={formatDemoMinutes(summary.expectedMinutes)} />
        <SummaryFigure icon="ri-checkbox-circle-line" label="Completed time" value={formatDemoMinutes(summary.completedMinutes)} />
        <SummaryFigure icon="ri-time-line" label="Remaining time" value={formatDemoMinutes(summary.remainingMinutes)} />
        {/* summary.materialsTotal counts individual components, not the
            programme's few named materials shown below — label it plainly so
            it isn't confused with "Your Materials". */}
        <SummaryFigure icon="ri-list-check-2" label="Components" value={`${summary.materialsCompleted}/${summary.materialsTotal}`} />
        {summary.quizzesTotal > 0 && (
          <SummaryFigure icon="ri-questionnaire-line" label="Quizzes passed" value={`${summary.quizzesPassed}/${summary.quizzesTotal}`} />
        )}
      </div>
    </Panel>
  );
}

/** A subtle "Expected Xm · Demo Ym" chip. Editable only for an authorised demo
 * account — everyone else (and every other learner) never sees this. */
export function DemoTimeChip({
  scopeKey,
  timeKey,
  expectedMinutes,
  actualMinutes,
  editable = false,
  onSaved,
}: {
  scopeKey: string;
  timeKey: string;
  expectedMinutes: number | null;
  actualMinutes: number | null;
  editable?: boolean;
  onSaved?: (minutes: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => (actualMinutes != null ? String(actualMinutes) : ''));

  if (expectedMinutes == null && actualMinutes == null) return null;

  const save = () => {
    const parsed = draft.trim() === '' ? null : Number(draft);
    const minutes = parsed != null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    setDemoTimeOverride(scopeKey, timeKey, minutes);
    onSaved?.(minutes);
    setEditing(false);
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2 py-0.5 ring-1 ring-primary-200">
        <input
          type="number"
          min={0}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          className="w-14 bg-transparent text-[11px] font-semibold text-primary-800 focus:outline-none"
          aria-label="Demo time in minutes"
        />
        <span className="text-[10px] text-primary-500">min</span>
        <button type="button" onClick={save} className="text-primary-700 hover:text-primary-900" title="Save demo time">
          <AppIcon className="ri-check-line text-[12px]" />
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-foreground-400 hover:text-foreground-600" title="Cancel">
          <AppIcon className="ri-close-line text-[12px]" />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-foreground-400">
      <AppIcon className="ri-time-line text-[10px]" />
      {expectedMinutes != null && <span>Expected {formatDemoMinutes(expectedMinutes)}</span>}
      <span>· Demo {formatDemoMinutes(actualMinutes)}</span>
      {editable && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDraft(actualMinutes != null ? String(actualMinutes) : ''); setEditing(true); }}
          className="text-primary-500 hover:text-primary-700"
          title="Edit demo time"
        >
          <AppIcon className="ri-pencil-line text-[10px]" />
        </button>
      )}
    </span>
  );
}
