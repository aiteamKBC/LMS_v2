// Table row for one DRAFT journal activity. Every action here — edits,
// deletes, staged uploads — mutates the local draft only; the journal's
// floating "Save all activities" button persists the whole draft at once.
// Editing mirrors the add flow: month-bound working-day dates and the same
// timestamp logic (attendance fixed; others "input" or a generated 09:00–17:00
// range from the claimed actual hours).
import { useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, FileText, Paperclip, Pencil, Trash2, X } from "lucide-react";
import Swal from "sweetalert2";
import { DurationInput, formatHoursDuration } from "@/features/audit/learner-log-pro-copy/components/DurationInput";
import { TableCell, TableRow } from "@/features/audit/learner-log-pro-copy/components/ui/table";
import { durationAsHours, formatDurationMinutes } from "@/features/audit/learner-log-pro-copy/lib/manualApi";
import type { DraftPatch, DraftRow } from "@/features/audit/learner-log-pro-copy/lib/journalDraft";
import {
  dateRestriction,
  isUkBankHoliday,
  isUkWeekend,
  monthBounds,
  WORK_DAY_START,
  workingTimeRange,
} from "@/features/audit/learner-log-pro-copy/lib/ukCalendar";

export function ManualActivityTableHeader({ dark = false }: { dark?: boolean }) {
  const color = dark ? "text-white" : "";
  return (
    <TableRow className={dark ? "border-0 bg-[#182d48] hover:bg-[#182d48]" : "hover:bg-transparent"}>
      <th className={`h-12 px-4 pl-7 text-left align-middle label-caps ${color}`}>Date</th>
      <th className={`h-12 px-4 text-left align-middle label-caps ${color}`}>Category</th>
      <th className={`h-12 px-4 text-left align-middle label-caps ${color}`}>Activity</th>
      <th className={`h-12 px-4 text-center align-middle label-caps ${color}`}>Timestamp</th>
      <th className={`h-12 px-4 text-right align-middle label-caps ${color}`}>Planned</th>
      <th className={`h-12 px-4 text-right align-middle label-caps ${color}`}>Actual</th>
      <th className={`h-12 px-4 pr-7 text-right align-middle label-caps ${color}`}>Actions</th>
    </TableRow>
  );
}

function hours(value: number | null | undefined) {
  return formatHoursDuration(value);
}

function RowInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`h-8 min-w-20 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-primary ${className}`} />;
}

export function ledgerRef(row: Pick<DraftRow, "category" | "source_ref" | "serverId">) {
  if (row.category === "assignment" || !row.source_ref) {
    return row.serverId != null ? `row:${row.serverId}` : null;
  }
  return row.source_ref;
}

export function completionBadge(note: string | null) {
  switch ((note || "").toLowerCase()) {
    case "completed":
      return <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">Completed by learner</span>;
    case "not_completed":
      return <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Not completed by learner</span>;
    case "no_record":
      return <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">No learner record</span>;
    default:
      return null;
  }
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

const TIME_RANGE_RE = /^(\d{2}:\d{2}(?::\d{2})?)[–-]\d{2}:\d{2}(?::\d{2})?$/;

type EditDraft = {
  title: string;
  activity_date: string;
  planned_hours: number;
  actual_hours: number;
  tsMode: "input" | "time";
  startTime: string;
  accepted: boolean;
};

function editDraftFromRow(row: DraftRow): EditDraft {
  const timeMatch = TIME_RANGE_RE.exec(row.timestamp_label || "");
  return {
    title: row.title,
    activity_date: row.activity_date ?? "",
    planned_hours: row.planned_hours,
    actual_hours: row.actual_hours,
    tsMode: timeMatch ? "time" : "input",
    startTime: timeMatch ? timeMatch[1] : WORK_DAY_START,
    accepted: row.accepted,
  };
}

function validate(draft: EditDraft, month: string) {
  if (!draft.title.trim()) return "Enter an activity name.";
  for (const [label, value] of [["Planned", draft.planned_hours], ["Actual", draft.actual_hours]] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 50) return `${label} hours must be between 0 and 50.`;
  }
  if (!draft.activity_date) return "Choose a date inside the report month.";
  return dateRestriction(draft.activity_date, month);
}

function StagedFileList({ row, onUnstageFile }: { row: DraftRow; onUnstageFile: (index: number) => void }) {
  if (!row.stagedFiles.length) return null;
  return (
    <>
      {row.stagedFiles.map((file, index) => (
        <div key={`staged-${file.name}-${index}`} className="flex items-center gap-1.5 text-xs">
          <FileText className="h-3 w-3 shrink-0 text-amber-600" />
          <span className="truncate" title={file.name}>{file.name}</span>
          <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">uploads on save</span>
          <button type="button" onClick={() => onUnstageFile(index)} className="text-muted-foreground hover:text-destructive" title="Remove staged file" aria-label={`Remove ${file.name}`}>
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </>
  );
}

function AssignmentDocuments({ row, onStageFiles, onUnstageFile, onDeleteDocument }: {
  row: DraftRow;
  onStageFiles: (files: File[]) => void;
  onUnstageFile: (index: number) => void;
  onDeleteDocument: (docId: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="mt-1.5 space-y-1">
      {row.documents.map((doc) => {
        const pendingDelete = row.deletedDocIds.includes(doc.id);
        return (
          <div key={doc.id} className={`flex items-center gap-1.5 text-xs ${pendingDelete ? "line-through opacity-50" : ""}`}>
            <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
            {doc.download_url && !pendingDelete ? (
              <a href={doc.download_url} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline" title={doc.display_name}>{doc.display_name}</a>
            ) : (
              <span className="truncate text-muted-foreground" title={doc.display_name}>{doc.display_name}</span>
            )}
            {pendingDelete ? (
              <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-semibold text-destructive">removes on save</span>
            ) : (
              <button type="button" onClick={() => onDeleteDocument(doc.id)} className="text-muted-foreground hover:text-destructive" title="Remove document (on save)" aria-label={`Remove ${doc.display_name}`}>
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}
      <StagedFileList row={row} onUnstageFile={onUnstageFile} />
      <input ref={fileRef} type="file" multiple className="hidden" onChange={(event) => {
        const picked = Array.from(event.target.files ?? []);
        if (picked.length) onStageFiles(picked);
        event.target.value = "";
      }} />
      <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary">
        <Paperclip className="h-3 w-3" /> Attach evidence
      </button>
    </div>
  );
}

export function ManualActivityRow({ row, onPatch, onDelete, onStageFiles, onUnstageFile, onDeleteDocument, className = "" }: {
  row: DraftRow;
  onPatch: (patch: DraftPatch) => void;
  onDelete: () => void;
  onStageFiles: (files: File[]) => void;
  onUnstageFile: (index: number) => void;
  onDeleteDocument: (docId: number) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => editDraftFromRow(row));
  const set = (patch: Partial<EditDraft>) => setDraft((value) => ({ ...value, ...patch }));
  const unsaved = row.state !== "clean" || row.stagedFiles.length > 0 || row.deletedDocIds.length > 0;
  const ref = ledgerRef(row);

  function apply() {
    const error = validate(draft, row.month);
    if (error) return void Swal.fire({ icon: "error", title: "Check the row", text: error });
    let timestampLabel = row.timestamp_label;
    if (row.category !== "attendance") {
      if (draft.tsMode === "time") {
        const generated = workingTimeRange(draft.startTime, draft.actual_hours);
        if ("error" in generated) return void Swal.fire({ icon: "error", title: "Check the timestamp", text: generated.error });
        timestampLabel = generated.label;
      } else {
        timestampLabel = "input";
      }
    }
    onPatch({
      title: draft.title.trim(),
      activity_date: draft.activity_date || null,
      planned_hours: draft.planned_hours,
      actual_hours: draft.actual_hours,
      timestamp_label: timestampLabel,
      accepted: draft.accepted,
    });
    setEditing(false);
  }

  async function remove() {
    const confirmation = await Swal.fire({
      icon: "warning",
      title: "Remove this activity?",
      text: row.serverId == null
        ? "It leaves the draft immediately (it was never saved)."
        : "It is removed from the report when you click Save all activities.",
      showCancelButton: true,
      confirmButtonText: "Remove activity",
      confirmButtonColor: "#dc2626",
    });
    if (confirmation.isConfirmed) onDelete();
  }

  if (!editing) {
    return (
      <TableRow className={className}>
        <TableCell className="whitespace-nowrap pl-7 font-mono text-xs text-muted-foreground">
          {row.activity_date ?? "—"}
          <div>{dateFlagBadge(row.activity_date)}</div>
        </TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{row.category}</TableCell>
        <TableCell className="min-w-64 max-w-[38rem] text-sm">
          {ref ? (
            <Link to="/ledger" search={{ ref, learner: String(row.aptem_id) } as never} className="font-medium text-foreground hover:text-primary hover:underline">{row.title}</Link>
          ) : (
            <span className="font-medium text-foreground">{row.title}</span>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {completionBadge(row.completion_note)}
            {formatDurationMinutes(row.duration_minutes) ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary" title="Source media duration — a guide for the actual hours">
                Duration {formatDurationMinutes(row.duration_minutes)}
              </span>
            ) : null}
            {row.retrieved ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Retrieved</span> : null}
            {unsaved ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Unsaved</span> : null}
            {!row.accepted ? <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive">Not accepted</span> : null}
          </div>
          {row.category === "assignment" ? (
            <AssignmentDocuments row={row} onStageFiles={onStageFiles} onUnstageFile={onUnstageFile} onDeleteDocument={onDeleteDocument} />
          ) : null}
        </TableCell>
        <TableCell className="whitespace-nowrap text-center font-mono text-xs text-muted-foreground">{row.timestamp_label || "—"}</TableCell>
        <TableCell className="whitespace-nowrap text-right font-mono text-sm">{hours(row.planned_hours)}</TableCell>
        <TableCell className="whitespace-nowrap text-right font-mono text-sm text-success">{hours(row.actual_hours)}</TableCell>
        <TableCell className="pr-7 text-right">
          <div className="flex justify-end gap-1">
            <button type="button" onClick={() => { setDraft(editDraftFromRow(row)); setEditing(true); }} className="rounded-md border border-border p-1.5 hover:bg-secondary" title="Edit in this row" aria-label="Edit activity"><Pencil className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={remove} className="rounded-md border border-destructive/30 p-1.5 text-destructive hover:bg-destructive/10" title="Remove activity" aria-label="Remove activity"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  const bounds = monthBounds(row.month);
  const editDateIssue = draft.activity_date ? dateRestriction(draft.activity_date, row.month) : null;
  const editGeneratedTime = row.category !== "attendance" && draft.tsMode === "time"
    ? workingTimeRange(draft.startTime, draft.actual_hours)
    : null;

  return (
    <TableRow className="bg-primary/5 hover:bg-primary/5">
      <TableCell className="pl-7">
        <RowInput type="date" value={draft.activity_date} min={bounds.min} max={bounds.max} onChange={(e) => set({ activity_date: e.target.value })} className={`w-36 ${editDateIssue ? "border-destructive" : ""}`} title={`Working days in ${row.month} only (no UK weekends or bank holidays)`} />
        {editDateIssue ? <span className="mt-1 block max-w-36 text-[10px] leading-tight text-destructive">{editDateIssue}</span> : null}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{row.category}</TableCell>
      <TableCell>
        <RowInput value={draft.title} onChange={(e) => set({ title: e.target.value })} className="w-full min-w-56" maxLength={500} />
        <label className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={draft.accepted} onChange={(e) => set({ accepted: e.target.checked })} />
          Accepted (counts toward claimed hours)
        </label>
      </TableCell>
      <TableCell className="text-center">
        {row.category === "attendance" ? (
          <span className="font-mono text-xs text-muted-foreground" title="Fixed from the attendance register — not editable">{row.timestamp_label || "—"}</span>
        ) : (
          <div className="space-y-1">
            <select value={draft.tsMode} onChange={(e) => set({ tsMode: e.target.value as "input" | "time" })} className="h-8 w-full rounded-md border border-border bg-card px-2 text-xs">
              <option value="input">input</option>
              <option value="time">time (from actual)</option>
            </select>
            {draft.tsMode === "time" ? (
              <>
                <RowInput type="time" min="09:00:00" max="17:00:00" step="1" value={draft.startTime} onChange={(e) => set({ startTime: e.target.value || WORK_DAY_START })} className="w-full text-center" aria-label="Start time including seconds" />
                {editGeneratedTime && "label" in editGeneratedTime ? (
                  <span className="block font-mono text-[10px] text-[#182d48]">{editGeneratedTime.label}</span>
                ) : editGeneratedTime ? (
                  <span className="block max-w-36 text-[10px] leading-tight text-destructive">{editGeneratedTime.error}</span>
                ) : null}
              </>
            ) : null}
          </div>
        )}
      </TableCell>
      <TableCell><DurationInput compact value={draft.planned_hours} onChange={(planned_hours) => set({ planned_hours })} ariaLabel="Planned duration" /></TableCell>
      <TableCell>
        <DurationInput compact value={draft.actual_hours} onChange={(actual_hours) => set({ actual_hours })} ariaLabel="Actual duration" />
        {formatDurationMinutes(row.duration_minutes) ? (
          <button
            type="button"
            onClick={() => set({ actual_hours: durationAsHours(row.duration_minutes)! })}
            className="mt-1 block w-20 rounded-md bg-primary/10 px-1 py-0.5 text-center text-[10px] font-semibold text-primary hover:bg-primary/20"
            title="Source media duration — click to use as the actual hours"
          >
            ≈ {formatDurationMinutes(row.duration_minutes)}
          </button>
        ) : null}
      </TableCell>
      <TableCell className="pr-7 text-right">
        <div className="flex justify-end gap-1">
          <button type="button" onClick={apply} className="rounded-md bg-primary p-1.5 text-primary-foreground" title="Apply to draft (saved with Save all)" aria-label="Apply changes"><Check className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => { setDraft(editDraftFromRow(row)); setEditing(false); }} className="rounded-md border border-border p-1.5 hover:bg-secondary" title="Cancel" aria-label="Cancel editing"><X className="h-3.5 w-3.5" /></button>
        </div>
      </TableCell>
    </TableRow>
  );
}
