import { AlertTriangle } from "lucide-react";
import type { DraftRow } from "@/features/audit/learner-log-pro-copy/lib/journalDraft";
import { isUkBankHoliday, isUkWeekend } from "@/features/audit/learner-log-pro-copy/lib/ukCalendar";


export function ledgerRef(row: Pick<DraftRow, "category" | "source_ref" | "serverId">) {
  // rq: bundles now have a full ledger view (one content block per part).
  if (row.source_ref?.startsWith("rq:")) return row.source_ref;
  if (row.category === "assignment" || !row.source_ref) {
    return row.serverId != null ? `row:${row.serverId}` : null;
  }
  return row.source_ref;
}


// Awarding actual hours to an activity the learner never finished marks it
// complete, and clearing them puts it back — mirrored here so the badge moves
// with the draft; the backend applies the same rule when the draft is saved.
export const LMS_INCOMPLETE = "not_completed";

export const COMPLETED_BY_HOURS = "completed_by_hours";


export function completionNoteForHours(note: string | null, actualHours: number): string | null {
  if (actualHours > 0) return note === LMS_INCOMPLETE ? COMPLETED_BY_HOURS : note;
  return note === COMPLETED_BY_HOURS ? LMS_INCOMPLETE : note;
}


// LMS group/module names arrive HTML-encoded from the WordPress sync
// ("Impact &amp;Planning") — decode the common entities for display.
export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}


export function completionBadge(note: string | null) {
  switch ((note || "").toLowerCase()) {
    case "completed":
      return <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">Completed by learner</span>;
    case COMPLETED_BY_HOURS:
      // The LMS flag never flipped, but the audit team awarded hours for it —
      // it counts as complete without claiming the learner ticked it off.
      return (
        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success" title="Marked complete by the audit team: actual hours were awarded for this activity, even though the LMS never recorded it as finished.">
          Completed — hours awarded
        </span>
      );
    case LMS_INCOMPLETE:
      return <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Not completed by learner</span>;
    case "no_record":
      return <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">No learner record</span>;
    default:
      return null;
  }
}


// Assignment rows carry Aptem's OWN status word (every assignment is imported
// now, not just the completed ones), so the chip colours by meaning and shows
// the source wording rather than a fixed vocabulary.
export function assignmentStatusBadge(status: string | null) {
  const text = (status || "").trim();
  if (!text) return null;
  const key = text.toLowerCase();
  const tone = key.includes("complet") || key.includes("approv") || key.includes("pass")
    ? "bg-success/15 text-success"
    : key.includes("submit") || key.includes("progress") || key.includes("pending") || key.includes("review")
      ? "bg-primary/10 text-primary"
      : key.includes("reject") || key.includes("fail") || key.includes("overdue")
        ? "bg-destructive/15 text-destructive"
        : "bg-amber-500/15 text-amber-700";
  const label = text.charAt(0).toUpperCase() + text.slice(1);
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`} title="Status of this assignment on Aptem">
      {label}
    </span>
  );
}


export function dateFlagBadge(date: string | null) {
  if (!date) return null;
  const flag = isUkWeekend(date) ? "Weekend" : isUkBankHoliday(date) ? "Bank holiday" : null;
  if (!flag) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive" title="This date is not a UK working day — edit the row to move it.">
      <AlertTriangle className="h-2.5 w-2.5" /> {flag}
    </span>
  );
}
