import { useEffect, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import Swal from "sweetalert2";
import { TableCell, TableRow } from "@/features/audit/learner-log-pro-hours-test/components/ui/table";
import {
  createActivity,
  deleteActivityRow,
  type ActivityRowInput,
  type LearnerActivity,
  updateActivityRow,
} from "@/features/audit/learner-log-pro-hours-test/lib/api";

const activityCategories = ["attendance", "assignment", "video", "audio", "reading+quiz"];

export function ActivityTableHeader({ dark = false }: { dark?: boolean }) {
  const color = dark ? "text-white" : undefined;
  return (
    <TableRow className={dark ? "border-0 bg-[#182d48] hover:bg-[#182d48]" : "hover:bg-transparent"}>
      <th className={`h-12 px-4 pl-7 text-left align-middle label-caps ${color ?? ""}`}>Activity ID</th>
      <th className={`h-12 px-4 text-left align-middle label-caps ${color ?? ""}`}>Date</th>
      <th className={`h-12 px-4 text-left align-middle label-caps ${color ?? ""}`}>Learner</th>
      <th className={`h-12 px-4 text-left align-middle label-caps ${color ?? ""}`}>Month</th>
      <th className={`h-12 px-4 text-left align-middle label-caps ${color ?? ""}`}>Category</th>
      <th className={`h-12 px-4 text-left align-middle label-caps ${color ?? ""}`}>Activity</th>
      <th className={`h-12 px-4 text-center align-middle label-caps ${color ?? ""}`}>Timestamp</th>
      <th className={`h-12 px-4 text-right align-middle label-caps ${color ?? ""}`}>Planned</th>
      <th className={`h-12 px-4 text-right align-middle label-caps ${color ?? ""}`}>Actual</th>
      <th className={`h-12 px-4 pr-7 text-right align-middle label-caps ${color ?? ""}`}>Actions</th>
    </TableRow>
  );
}

function hours(value: number | null | undefined) {
  return value == null ? "—" : String(Math.round(value * 100) / 100);
}

function localDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isoOrNull(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function timestampOnActivityDate(value: string | null | undefined, activityDate: string) {
  const local = localDateTime(value);
  return local && activityDate ? `${activityDate}${local.slice(10)}` : local;
}

function inputFromRow(row: LearnerActivity): ActivityRowInput {
  const date = row.activity_date ?? row.learner_activity_date ?? "";
  const timestampDisplay = row.time_from_to ?? "";
  const isUserInput = timestampDisplay.trim().toLowerCase() === "input";
  return {
    date,
    category: row.activity_category,
    activity: row.activity_unit,
    activity_subtitle: row.activity_description,
    planned: row.planned_hours ?? 0,
    actual: row.actual_lms_hours ?? 0,
    timestamp_from: isUserInput ? null : timestampOnActivityDate(row.time_from, date),
    timestamp_to: isUserInput ? null : timestampOnActivityDate(row.time_to, date),
    timestamp_display: isUserInput ? "input" : timestampDisplay,
    completed: Boolean(row.completed),
    not_accepted: Boolean(row.not_accepted),
    reporting_week_label: row.week,
  };
}

function validate(input: ActivityRowInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Choose a valid activity date.";
  if (!input.activity.trim()) return "Enter an activity name.";
  for (const [label, value] of [["Planned", input.planned], ["Actual", input.actual]] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 50) return `${label} hours must be between 0 and 50.`;
  }
  if (input.timestamp_from && input.timestamp_to && new Date(input.timestamp_to) < new Date(input.timestamp_from)) {
    return "The end timestamp must be after the start timestamp.";
  }
  return null;
}

function RowInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`h-8 min-w-20 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-primary ${className}`} />;
}

async function refresh(queryClient: ReturnType<typeof useQueryClient>) {
  await queryClient.invalidateQueries();
}

export function InlineActivityRow({ row, className = "" }: { row: LearnerActivity; className?: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => inputFromRow(row));
  const isAuditCreated = row.plan_id.startsWith("audit:");

  useEffect(() => setDraft(inputFromRow(row)), [row]);
  const set = (patch: Partial<ActivityRowInput>) => setDraft((value) => ({ ...value, ...patch }));

  async function save() {
    const isUserInput = draft.timestamp_display?.trim().toLowerCase() === "input";
    const normalized = {
      ...draft,
      activity: draft.activity.trim(),
      timestamp_from: isUserInput ? null : isoOrNull(String(draft.timestamp_from ?? "")),
      timestamp_to: isUserInput ? null : isoOrNull(String(draft.timestamp_to ?? "")),
      // The backend derives the visible range from edited timestamps. User-input
      // records deliberately retain their source reporting method verbatim.
      timestamp_display: isUserInput ? "input" : "",
      completed: draft.actual > 0,
    };
    const error = validate(normalized);
    if (error) return void Swal.fire({ icon: "error", title: "Check the row", text: error });
    setSaving(true);
    try {
      await updateActivityRow(row, normalized);
      await refresh(queryClient);
      setEditing(false);
      await Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Activity updated", showConfirmButton: false, timer: 1800 });
    } catch (cause) {
      await Swal.fire({ icon: "error", title: "Update failed", text: cause instanceof Error ? cause.message : "Could not update the activity." });
    } finally {
      setSaving(false);
    }
  }

  const isUserInput = draft.timestamp_display?.trim().toLowerCase() === "input";

  async function remove() {
    const confirmation = await Swal.fire({
      icon: "warning",
      title: "Delete this activity?",
      text: "It will disappear from every audit-copy page. Source evidence is retained as a recoverable soft deletion.",
      showCancelButton: true,
      confirmButtonText: "Delete activity",
      confirmButtonColor: "#dc2626",
    });
    if (!confirmation.isConfirmed) return;
    setSaving(true);
    try {
      await deleteActivityRow(row);
      await refresh(queryClient);
      await Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Activity deleted", showConfirmButton: false, timer: 1800 });
    } catch (cause) {
      await Swal.fire({ icon: "error", title: "Delete failed", text: cause instanceof Error ? cause.message : "Could not delete the activity." });
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <TableRow className={className}>
        <TableCell className="max-w-48 truncate pl-7 font-mono text-xs" title={row.plan_id}>{row.plan_id}</TableCell>
        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{row.learner_activity_date ?? "—"}</TableCell>
        <TableCell className="whitespace-nowrap text-sm font-medium">{row.learner}</TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{row.month_unit}</TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{row.activity_category}</TableCell>
        <TableCell className="min-w-64 max-w-[38rem] text-sm">
          <Link to="/activity" search={{ learner: row.learner.toLowerCase(), activity: row.plan_id } as never} className="font-medium text-foreground hover:text-primary hover:underline">{row.activity_unit}</Link>
          {row.activity_description ? <p className="mt-1 text-xs text-muted-foreground">{row.activity_description}</p> : null}
          {(row.reading_completed || row.quiz_attempted || row.completed) ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {row.reading_completed ? <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">Reading viewed</span> : null}
              {row.quiz_attempted ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Quiz attempted</span> : null}
              {row.completed ? <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">Activity complete</span> : null}
            </div>
          ) : null}
        </TableCell>
        <TableCell className="whitespace-nowrap text-center font-mono text-xs text-muted-foreground">{row.time_from_to || "—"}</TableCell>
        <TableCell className="text-right font-mono text-sm">{hours(row.planned_hours)}</TableCell>
        <TableCell className="text-right font-mono text-sm text-success">{row.hours_mapped === false ? "—" : hours(row.actual_lms_hours)}</TableCell>
        <TableCell className="pr-7 text-right">
          <div className="flex justify-end gap-1">
            <button type="button" onClick={() => setEditing(true)} className="rounded-md border border-border p-1.5 hover:bg-secondary" title="Edit in this row" aria-label="Edit activity"><Pencil className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={remove} disabled={saving} className="rounded-md border border-destructive/30 p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-50" title="Delete activity" aria-label="Delete activity"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow className="bg-primary/5 hover:bg-primary/5">
      <TableCell className="max-w-48 truncate pl-7 font-mono text-xs" title={row.plan_id}>{row.plan_id}</TableCell>
      <TableCell><RowInput type="date" value={draft.date} onChange={(e) => {
        const date = e.target.value;
        setDraft((value) => ({
          ...value,
          date,
          timestamp_from: isUserInput ? null : timestampOnActivityDate(value.timestamp_from, date),
          timestamp_to: isUserInput ? null : timestampOnActivityDate(value.timestamp_to, date),
        }));
      }} className="w-36" title={!isAuditCreated ? "Changing a source date keeps the original evidence and records a reversible audit replacement." : undefined} /></TableCell>
      <TableCell className="whitespace-nowrap text-sm font-medium">{row.learner}</TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{draft.date ? new Date(`${draft.date}T12:00:00`).toLocaleString("en-GB", { month: "long", year: "numeric" }) : "—"}</TableCell>
      <TableCell>
        <select value={draft.category} disabled={!isAuditCreated} onChange={(e) => set({ category: e.target.value })} className="h-8 rounded-md border border-border bg-card px-2 text-xs disabled:opacity-60">
          {activityCategories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
      </TableCell>
      <TableCell><RowInput value={draft.activity} onChange={(e) => set({ activity: e.target.value })} className="w-full min-w-56" maxLength={500} /></TableCell>
      <TableCell className="min-w-44 space-y-1">
        {isUserInput ? (
          <span className="block text-center font-mono text-xs text-muted-foreground">input</span>
        ) : (
          <>
            <RowInput type="datetime-local" value={localDateTime(draft.timestamp_from)} onChange={(e) => set({ timestamp_from: e.target.value })} className="w-full" aria-label="Started at" />
            <RowInput type="datetime-local" value={localDateTime(draft.timestamp_to)} onChange={(e) => set({ timestamp_to: e.target.value })} className="w-full" aria-label="Completed at" />
          </>
        )}
      </TableCell>
      <TableCell><RowInput type="number" min="0" max="50" step="0.01" value={draft.planned} onChange={(e) => set({ planned: Number(e.target.value) })} className="w-20 text-right" /></TableCell>
      <TableCell><RowInput type="number" min="0" max="50" step="0.01" value={draft.actual} onChange={(e) => set({ actual: Number(e.target.value) })} className="w-20 text-right" /></TableCell>
      <TableCell className="pr-7 text-right">
        <div className="flex justify-end gap-1">
          <button type="button" onClick={save} disabled={saving} className="rounded-md bg-primary p-1.5 text-primary-foreground disabled:opacity-50" title="Save row" aria-label="Save activity"><Check className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => { setDraft(inputFromRow(row)); setEditing(false); }} disabled={saving} className="rounded-md border border-border p-1.5 hover:bg-secondary disabled:opacity-50" title="Cancel" aria-label="Cancel editing"><X className="h-3.5 w-3.5" /></button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function InlineActivityCreateRow({ learnerId, learnerName, onCancel }: { learnerId: number; learnerName: string; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const today = new Date();
  const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const [draft, setDraft] = useState<ActivityRowInput>({ date: localToday, category: "assignment", activity: "", planned: 0, actual: 0 });
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ActivityRowInput>) => setDraft((value) => ({ ...value, ...patch }));

  async function save() {
    const normalized = { ...draft, activity: draft.activity.trim(), completed: draft.actual > 0 };
    const error = validate(normalized);
    if (error) return void Swal.fire({ icon: "error", title: "Check the new row", text: error });
    setSaving(true);
    try {
      await createActivity(learnerId, normalized);
      await refresh(queryClient);
      onCancel();
      await Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Activity added", showConfirmButton: false, timer: 1800 });
    } catch (cause) {
      await Swal.fire({ icon: "error", title: "Create failed", text: cause instanceof Error ? cause.message : "Could not create the activity." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow className="bg-success/5 hover:bg-success/5">
      <TableCell className="pl-7 text-xs font-semibold text-success"><span className="inline-flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> New</span></TableCell>
      <TableCell><RowInput type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} className="w-36" /></TableCell>
      <TableCell className="whitespace-nowrap text-sm font-medium">{learnerName}</TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(`${draft.date}T12:00:00`).toLocaleString("en-GB", { month: "long", year: "numeric" })}</TableCell>
      <TableCell><select value={draft.category} onChange={(e) => set({ category: e.target.value })} className="h-8 rounded-md border border-border bg-card px-2 text-xs">{activityCategories.map((category) => <option key={category}>{category}</option>)}</select></TableCell>
      <TableCell><RowInput autoFocus value={draft.activity} onChange={(e) => set({ activity: e.target.value })} placeholder="Activity name" className="w-full min-w-56" maxLength={500} /></TableCell>
      <TableCell className="text-center text-xs text-muted-foreground">User input</TableCell>
      <TableCell><RowInput type="number" min="0" max="50" step="0.01" value={draft.planned} onChange={(e) => set({ planned: Number(e.target.value) })} className="w-20 text-right" /></TableCell>
      <TableCell><RowInput type="number" min="0" max="50" step="0.01" value={draft.actual} onChange={(e) => set({ actual: Number(e.target.value) })} className="w-20 text-right" /></TableCell>
      <TableCell className="pr-7 text-right"><div className="flex justify-end gap-1"><button type="button" onClick={save} disabled={saving} className="rounded-md bg-success p-1.5 text-white disabled:opacity-50" title="Add activity"><Check className="h-3.5 w-3.5" /></button><button type="button" onClick={onCancel} disabled={saving} className="rounded-md border border-border p-1.5 hover:bg-secondary"><X className="h-3.5 w-3.5" /></button></div></TableCell>
    </TableRow>
  );
}
