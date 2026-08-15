// "Calculate actual hours" / "Approve" for the Learner Journal's Activity log.
//
// Three buttons, no identity box and no offset picker. "Calculate actual hours"
// and "Calculate planned hours" are independent: each proposes its own column
// and leaves the other's pending proposal alone, so they can be pressed in any
// order before one Approve writes both. Actual runs use varied offsets per row
// (-15…+15 minutes, derived from each row so the same row always gets the same
// value); planned shares the month's Aptem LMS components across its
// reading-only activities. Every run is attributed to the workspace itself.
//
// Calculating writes nothing into the report: it stores a pending value per row,
// shown in the Actual column as a dashed → figure. Approving applies those
// values to the rows. Nothing here runs on page load; both actions are explicit.
import { CalendarClock, Calculator, Check, LoaderCircle } from "lucide-react";
import { Button } from "@/features/audit/learner-log-pro-hours-test/components/ui/button";
import type { JournalHoursState } from "@/features/audit/learner-log-pro-hours-test/lib/useJournalHours";

export function JournalHoursControls({ state, aptemId, month }: {
  state: JournalHoursState; aptemId: number | null; month: string;
}) {
  const scoped = Boolean(aptemId && month);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        disabled={!scoped || state.isCalculating}
        title={`Calculate this month's actual hours: ${state.referenceMinutes} min ± an offset per row for reading+quiz, the activity's own runtime for video/audio, and the genuine elapsed time wherever a timestamp range exists`}
        onClick={() => state.calculate("actual")}
      >
        {state.isCalculating && state.calculatingField === "actual"
          ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          : <Calculator className="h-3.5 w-3.5" />}
        Calculate actual hours
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        disabled={!scoped || state.isCalculating}
        title="Calculate this month's planned hours: the Aptem LMS component(s) for the month, shared across its reading-only activities"
        onClick={() => state.calculate("planned")}
      >
        {state.isCalculating && state.calculatingField === "planned"
          ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          : <CalendarClock className="h-3.5 w-3.5" />}
        Calculate planned hours
      </Button>
      <Button
        size="sm"
        className="gap-1.5 bg-[#182d48] hover:bg-[#243f61]"
        disabled={!scoped || !state.pendingCount || state.isDeciding}
        title="Apply the calculated values to this month's report"
        onClick={() => state.decide("approve")}
      >
        {state.isDeciding ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Approve {state.pendingCount ? `(${state.pendingCount})` : ""}
      </Button>
      {/* Say why a button is doing nothing, rather than sitting silently disabled. */}
      {!state.message && !state.error && scoped && !state.pendingCount ? (
        <span className="text-[11px] text-muted-foreground">
          Nothing calculated for this month yet — press one of the Calculate buttons.
        </span>
      ) : null}
      {state.message ? <span className="text-[11px] text-emerald-700">{state.message}</span> : null}
      {state.error ? <span className="text-[11px] text-red-600">{state.error}</span> : null}
    </div>
  );
}
