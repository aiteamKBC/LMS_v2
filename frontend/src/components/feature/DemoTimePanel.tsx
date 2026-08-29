import { useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
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

/** One material card in "Your Materials": name, progress, learning time,
 * current week/status and a Continue button. `summary` is the material's own
 * component-level rollup (see `timingsForModuleIds` + `summariseDemoTimings`)
 * — never a separately-tracked figure. */
export function DemoMaterialCard({
  name,
  summary,
  currentWeekLabel,
  complete,
  available,
  onContinue,
}: {
  name: string;
  summary: DemoProgrammeSummary;
  /** The material's current week label, or null when every week is done. */
  currentWeekLabel: string | null;
  /** Every openable component in the material is complete. */
  complete: boolean;
  /** False when no authored content exists for this material yet. */
  available: boolean;
  onContinue: () => void;
}) {
  const statusLabel = !available
    ? 'Not yet available'
    : complete
      ? 'Complete'
      : currentWeekLabel
        ? currentWeekLabel
        : 'Not started';
  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-foreground-900">{name}</p>
          <p className="mt-0.5 text-[11px] text-foreground-400">{statusLabel}</p>
        </div>
        {available && (
          <span className="shrink-0 rounded-full bg-primary-100 px-2 py-0.5 text-[11px] font-semibold text-primary-700">
            {summary.completionPct}%
          </span>
        )}
      </div>
      {available ? (
        <>
          <ProgressBarThin percent={summary.completionPct} />
          <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-foreground-500">
            <span className="inline-flex items-center gap-1">
              <AppIcon className="ri-time-line text-[11px]" />
              {formatDemoMinutes(summary.completedMinutes)} of {formatDemoMinutes(summary.expectedMinutes)}
            </span>
            <span>{summary.materialsCompleted}/{summary.materialsTotal} complete</span>
          </div>
          <button
            type="button"
            onClick={onContinue}
            className="mt-3 w-full rounded-lg bg-primary-600 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-primary-700"
          >
            Continue
          </button>
        </>
      ) : (
        <p className="mt-3 text-[11px] text-foreground-400">This material has no published content yet.</p>
      )}
    </Panel>
  );
}

function ProgressBarThin({ percent }: { percent: number }) {
  return (
    <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-background-200">
      <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
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
