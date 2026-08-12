import { useEffect, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, ChevronDown, Paperclip, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import Swal from "sweetalert2";
import { TableCell, TableRow } from "@/features/audit/learner-log-pro-manual/components/ui/table";
import {
  createActivity,
  deleteActivityRow,
  evidenceFileUrl,
  type ActivityRowInput,
  type ActivitySort,
  type LearnerActivity,
  updateActivityRow,
  uploadEvidence,
} from "@/features/audit/learner-log-pro-manual/lib/api";
import {
  learnerLmsGroups,
  pickAttendanceLectures,
  pickAttendanceModules,
  pickGroupActivities,
  pickLmsGroups,
} from "@/features/audit/learner-log-pro-manual/lib/plan-api";

const activityCategories = ["attendance", "assignment", "video", "audio", "reading+quiz"];

export function ActivityTableHeader({ dark = false, sort, onSort }: {
  dark?: boolean;
  sort?: ActivitySort;
  onSort?: (key: ActivitySort["key"]) => void;
}) {
  const color = dark ? "text-white" : undefined;
  const sortable = (label: string, key: ActivitySort["key"]) => {
    if (!onSort) return label;
    const active = sort?.key === key;
    return (
      <button
        type="button"
        onClick={() => onSort(key)}
        className="label-caps inline-flex items-center gap-1 hover:underline"
        title={active && sort?.dir === "asc" ? `Sort by ${label} (descending)` : `Sort by ${label}`}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span aria-hidden className={active ? "" : "opacity-40"}>{active ? (sort?.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    );
  };
  return (
    <TableRow className={dark ? "border-0 bg-[#182d48] hover:bg-[#182d48]" : "hover:bg-transparent"}>
      <th className={`h-12 px-4 pl-7 text-left align-middle label-caps ${color ?? ""}`}>Activity ID</th>
      <th className={`h-12 px-4 text-left align-middle label-caps ${color ?? ""}`}>{sortable("Date", "date")}</th>
      <th className={`h-12 px-4 text-left align-middle label-caps ${color ?? ""}`}>Learner</th>
      <th className={`h-12 px-4 text-left align-middle label-caps ${color ?? ""}`}>Month</th>
      <th className={`h-12 px-4 text-left align-middle label-caps ${color ?? ""}`}>{sortable("Category", "category")}</th>
      <th className={`h-12 px-4 text-left align-middle label-caps ${color ?? ""}`}>{sortable("Activity", "activity")}</th>
      <th className={`h-12 px-4 text-center align-middle label-caps ${color ?? ""}`}>Timestamp</th>
      <th className={`h-12 px-4 text-right align-middle label-caps ${color ?? ""}`}>{sortable("Planned", "planned")}</th>
      <th className={`h-12 px-4 text-right align-middle label-caps ${color ?? ""}`}>{sortable("Actual", "actual")}</th>
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
    evidence_id: row.evidence_id ?? null,
    evidence_name: row.evidence_name ?? null,
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

// Shown while a row's category is "assignment": pick a file that is uploaded
// to Azure (as manual-audit evidence) when the row is saved.
function AssignmentUploadControl({ pendingFile, onPick, existingId, existingName, disabled }: {
  pendingFile: File | null;
  onPick: (file: File | null) => void;
  existingId?: string | null;
  existingName?: string | null;
  disabled?: boolean;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <label
        className={`inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-secondary"}`}
        title="The file is uploaded to Azure when you save the row."
      >
        <Upload className="h-3 w-3" />
        {pendingFile ? "Change file" : existingId ? "Replace file" : "Upload file"}
        <input
          type="file"
          className="sr-only"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.png,.jpg,.jpeg"
          disabled={disabled}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            event.currentTarget.value = "";
            if (file) onPick(file);
          }}
        />
      </label>
      {pendingFile ? (
        <span className="inline-flex max-w-52 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary" title={pendingFile.name}>
          <Paperclip className="h-3 w-3 shrink-0" />
          <span className="truncate">{pendingFile.name}</span>
          <button type="button" onClick={() => onPick(null)} disabled={disabled} aria-label="Remove chosen file" className="shrink-0 hover:text-destructive"><X className="h-3 w-3" /></button>
        </span>
      ) : existingId ? (
        <a
          href={evidenceFileUrl(existingId)}
          target="_blank"
          rel="noreferrer"
          title={existingName ?? "Open attached file"}
          className="inline-flex max-w-52 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/20"
        >
          <Paperclip className="h-3 w-3 shrink-0" />
          <span className="truncate">{existingName ?? "Attachment"}</span>
        </a>
      ) : null}
    </div>
  );
}

async function refresh(queryClient: ReturnType<typeof useQueryClient>) {
  await queryClient.invalidateQueries();
}

type ComboOption = { value: string; label: string; hint?: string | null };

// Searchable dropdown for the name pickers: type to filter, click to choose,
// Enter takes the first match. The menu is portalled to <body> (same trick as
// EvidenceFilesButton) so the tables' overflow containers can't clip it.
function SearchCombobox({ options, value, onSelect, placeholder, disabled, ariaLabel, className = "" }: {
  options: ComboOption[];
  value: string;
  onSelect: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [menuRect, setMenuRect] = useState({ left: 0, top: 0, width: 240 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) return undefined;
    const positionMenu = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 240);
      setMenuRect({
        left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8)),
        top: rect.bottom + 4,
        width,
      });
    };
    positionMenu();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open]);

  const query = search.trim().toLowerCase();
  const filtered = query ? options.filter((option) => option.label.toLowerCase().includes(query)) : options;

  const choose = (option: ComboOption) => {
    onSelect(option.value);
    setSearch("");
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input
        value={open ? search : selectedLabel}
        placeholder={open && selectedLabel ? selectedLabel : placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        onFocus={() => { setSearch(""); setOpen(true); }}
        onChange={(event) => { setSearch(event.target.value); if (!open) setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (open && filtered.length) choose(filtered[0]);
          }
        }}
        className="h-8 w-full rounded-md border border-border bg-card px-2 pr-6 text-xs outline-none focus:border-primary disabled:opacity-60"
      />
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
      {open && createPortal(
        // Portalled outside the feature's DOM scope, so the surface uses
        // explicit colors — token classes (bg-card etc.) may not resolve on
        // document.body and would leave the menu transparent.
        <div
          ref={menuRef}
          className="fixed z-[120] overflow-hidden rounded-md border border-[#d8d5cd] bg-[#ffffff] text-[#1f2937] shadow-lg"
          style={{ left: menuRect.left, top: menuRect.top, width: menuRect.width }}
        >
          <ul className="max-h-56 overflow-y-auto" role="listbox" aria-label={ariaLabel}>
            {filtered.length === 0 ? (
              <li className="px-2 py-2 text-xs text-[#94a3b8]">No matches</li>
            ) : filtered.map((option, index) => (
              <li key={`${option.value}-${index}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => choose(option)}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-[#f1f5f9] ${option.value === value ? "bg-[#eef3f8] font-semibold" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate" title={option.label}>{option.label}</span>
                  {option.hint ? <span className="shrink-0 text-[10px] text-[#94a3b8]">{option.hint}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}

const MEDIA_CATEGORIES = new Set(["video", "audio", "reading+quiz"]);

// Shown while a row's category is attendance/video/audio/reading+quiz: two
// cascading selects that FILL the activity-name input from Last_audit source
// data. The input stays editable — a pick is a starting point, not a lock.
function ActivityNamePicker({ category, value, onPick, onGroupPick, disabled }: {
  category: string;
  value: string;
  onPick: (name: string) => void;
  // Reports the LMS group chosen in the media cascade so the create row can
  // reuse it for "add this activity to the learner's group".
  onGroupPick?: (groupId: string) => void;
  disabled?: boolean;
}) {
  const isAttendance = category === "attendance";
  const isMedia = MEDIA_CATEGORIES.has(category);
  // Level 1: the module name (attendance) or LMS group id string (media).
  const [parent, setParent] = useState("");

  const modules = useQuery({
    queryKey: ["picker-attendance-modules"],
    queryFn: pickAttendanceModules,
    enabled: isAttendance,
  });
  const lectures = useQuery({
    queryKey: ["picker-attendance-lectures", parent],
    queryFn: () => pickAttendanceLectures(parent),
    enabled: isAttendance && Boolean(parent),
  });
  const groups = useQuery({
    queryKey: ["plan-lms-groups"],
    queryFn: pickLmsGroups,
    enabled: isMedia,
  });
  const titles = useQuery({
    queryKey: ["picker-group-activities", parent, category],
    queryFn: () => pickGroupActivities(Number(parent), category as "video" | "audio" | "reading+quiz"),
    enabled: isMedia && Boolean(parent),
  });

  if (!isAttendance && !isMedia) return null;

  const level1: ComboOption[] = isAttendance
    ? (modules.data?.items ?? []).map((item) => ({ value: item.module, label: item.module }))
    : (groups.data?.items ?? []).map((item) => ({ value: String(item.group_id), label: `${item.name} (${item.learner_count})` }));
  const level2: ComboOption[] = isAttendance
    ? (lectures.data?.items ?? []).map((item) => ({ value: item.lecture, label: item.lecture, hint: item.last_date?.slice(0, 10) ?? null }))
    : (titles.data?.items ?? []).map((item) => ({ value: item.title, label: item.title, hint: item.activity_date?.slice(0, 10) ?? null }));
  const level1Query = isAttendance ? modules : groups;
  const level2Query = isAttendance ? lectures : titles;
  // Derived selection: shows the current name when it exists in the options,
  // auto-clears when the user hand-edits the text input.
  const selected = level2.some((option) => option.value === value) ? value : "";
  const error = (level1Query.error ?? level2Query.error) as Error | null;

  const level1Placeholder = level1Query.isLoading
    ? "Loading…"
    : !level1.length
      ? (isAttendance ? "No modules" : "No LMS groups")
      : (isAttendance ? "Module…" : "LMS group…");
  const level2Placeholder = !parent
    ? (isAttendance ? "Pick a module first" : "Pick a group first")
    : level2Query.isLoading
      ? "Loading…"
      : !level2.length
        ? (isAttendance ? "No lectures for this module" : `No ${category} activities`)
        : (isAttendance ? "Lecture…" : "Activity…");

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <SearchCombobox
        options={level1}
        value={parent}
        onSelect={(value) => {
          setParent(value);
          if (isMedia) onGroupPick?.(value);
        }}
        placeholder={level1Placeholder}
        disabled={disabled || !level1.length}
        ariaLabel={isAttendance ? "Module" : "LMS group"}
        className="w-44"
      />
      <SearchCombobox
        options={level2}
        value={selected}
        onSelect={onPick}
        placeholder={level2Placeholder}
        disabled={disabled || !parent || !level2.length}
        ariaLabel={isAttendance ? "Lecture" : "Activity title"}
        className="w-56"
      />
      {error ? (
        <p className="w-full text-[10px] text-destructive">
          {error instanceof Error ? error.message : "Could not load options."}
        </p>
      ) : null}
    </div>
  );
}

export function InlineActivityRow({ row, className = "" }: { row: LearnerActivity; className?: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => inputFromRow(row));
  const [assignmentFile, setAssignmentFile] = useState<File | null>(null);
  const isAuditCreated = row.plan_id.startsWith("audit:");
  // Plan-projected rows persist through the plan progress endpoint, which has
  // no attachment field — the upload control is overlay-only.
  const canAttachAssignment = draft.category === "assignment" && !row.plan_id.startsWith("plan:");
  // Plan rows also reject activity-name changes client-side (api.ts), so the
  // name picker follows the same gate.
  const canPickName = draft.category !== "assignment" && !row.plan_id.startsWith("plan:");

  useEffect(() => {
    setDraft(inputFromRow(row));
    setAssignmentFile(null);
  }, [row]);
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
      let payload = normalized;
      if (canAttachAssignment && assignmentFile) {
        if (!row.learner_id) throw new Error("This row has no learner id, so the file cannot be uploaded.");
        const uploaded = await uploadEvidence(row.learner_id, assignmentFile, normalized.date, normalized.activity || "Assignment");
        payload = { ...normalized, evidence_id: uploaded.evidence_id, evidence_name: uploaded.document_name ?? assignmentFile.name };
      }
      const result = await updateActivityRow(row, payload);
      await refresh(queryClient);
      setEditing(false);
      setAssignmentFile(null);
      // A date edit can move the row into another month; the month view being
      // filtered means it vanishes from THIS page — say so instead of letting
      // it look like a deletion.
      const movedTo = payload.date.slice(0, 7);
      if (row.activity_period && row.activity_period !== "undated" && movedTo !== row.activity_period) {
        await Swal.fire({
          icon: "info",
          title: "Activity moved",
          text: `This activity is now dated ${payload.date}, so it appears under ${new Date(`${movedTo}-02T12:00:00`).toLocaleString("en-GB", { month: "long", year: "numeric" })} instead of the month you are viewing.`,
        });
      }
      const warnings = (result as { signed_warnings?: Array<unknown> })?.signed_warnings;
      if (warnings?.length) {
        await Swal.fire({
          icon: "warning",
          title: "Signed month affected",
          text: "This month carries a sign-off for this learner — review the signature after this change.",
        });
      }
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
          {(row.reading_completed || row.quiz_attempted || row.completed || row.plan || row.evidence_id) ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {/* Source chip: this row is projected from a group plan — its
                  structure is edited in the plan builder, not here. */}
              {row.plan ? <span className="rounded-full bg-[#eef3f8] px-2 py-0.5 text-[10px] font-semibold text-[#182d48] ring-1 ring-[#cbd5e1]">Plan: {row.plan.group_name ?? "group"}</span> : null}
              {row.reading_completed ? <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">Reading viewed</span> : null}
              {row.quiz_attempted ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Quiz attempted</span> : null}
              {row.completed ? <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">Activity complete</span> : null}
              {row.evidence_id ? (
                <a
                  href={evidenceFileUrl(row.evidence_id)}
                  target="_blank"
                  rel="noreferrer"
                  title={row.evidence_name ?? "Open attached file"}
                  className="inline-flex max-w-52 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/20"
                >
                  <Paperclip className="h-3 w-3 shrink-0" />
                  <span className="truncate">{row.evidence_name ?? "Attachment"}</span>
                </a>
              ) : null}
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
        {/* Mirror rows carry source category spellings outside the canonical
            five (e.g. "Reading+Quiz", bare "reading"). Without its own option
            the native select would silently DISPLAY the first option
            ("attendance") — the row's real category must stay visible. */}
        <select value={draft.category} disabled={!isAuditCreated} onChange={(e) => set({ category: e.target.value })} className="h-8 rounded-md border border-border bg-card px-2 text-xs disabled:opacity-60">
          {!activityCategories.includes(draft.category) ? <option value={draft.category}>{draft.category}</option> : null}
          {activityCategories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
      </TableCell>
      <TableCell>
        <RowInput value={draft.activity} onChange={(e) => set({ activity: e.target.value })} className="w-full min-w-56" maxLength={500} />
        {canAttachAssignment ? (
          <AssignmentUploadControl pendingFile={assignmentFile} onPick={setAssignmentFile} existingId={draft.evidence_id} existingName={draft.evidence_name} disabled={saving} />
        ) : canPickName ? (
          <ActivityNamePicker key={draft.category} category={draft.category} value={draft.activity} onPick={(name) => set({ activity: name })} disabled={saving} />
        ) : null}
      </TableCell>
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
          <button type="button" onClick={() => { setDraft(inputFromRow(row)); setAssignmentFile(null); setEditing(false); }} disabled={saving} className="rounded-md border border-border p-1.5 hover:bg-secondary disabled:opacity-50" title="Cancel" aria-label="Cancel editing"><X className="h-3.5 w-3.5" /></button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function InlineActivityCreateRow({ learnerId, learnerName, onCancel, defaultDate }: { learnerId: number; learnerName: string; onCancel: () => void; defaultDate?: string }) {
  const queryClient = useQueryClient();
  const today = new Date();
  const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  // Default the date INTO the month the page is viewing — a row dated outside
  // it is filtered straight out of the view it was created in.
  const [draft, setDraft] = useState<ActivityRowInput>({ date: defaultDate || localToday, category: "assignment", activity: "", planned: 0, actual: 0 });
  const [assignmentFile, setAssignmentFile] = useState<File | null>(null);
  const [shareChoice, setShareChoice] = useState<"no" | "yes">("no");
  const [shareGroupId, setShareGroupId] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ActivityRowInput>) => setDraft((value) => ({ ...value, ...patch }));

  const learnerGroups = useQuery({ queryKey: ["learner-lms-groups", learnerId], queryFn: () => learnerLmsGroups(learnerId) });
  const lmsGroups = useQuery({ queryKey: ["plan-lms-groups"], queryFn: pickLmsGroups });
  // Groups offered for sharing: the learner's own groups, plus whatever group
  // the media name-picker chose (it may not be recorded against the learner).
  const shareCandidates = (() => {
    const own = learnerGroups.data ?? [];
    if (!shareGroupId || own.some((group) => String(group.group_id) === shareGroupId)) return own;
    const picked = (lmsGroups.data?.items ?? []).find((group) => String(group.group_id) === shareGroupId);
    return picked ? [picked, ...own] : own;
  })();
  const effectiveGroupId = shareGroupId || (shareCandidates[0] ? String(shareCandidates[0].group_id) : "");

  async function save() {
    const normalized = { ...draft, activity: draft.activity.trim(), completed: draft.actual > 0 };
    const error = validate(normalized);
    if (error) return void Swal.fire({ icon: "error", title: "Check the new row", text: error });
    if (shareChoice === "yes" && !effectiveGroupId) {
      return void Swal.fire({ icon: "error", title: "Pick a group", text: "Choose which LMS group should receive this activity." });
    }
    setSaving(true);
    try {
      let payload = normalized;
      if (draft.category === "assignment" && assignmentFile) {
        const uploaded = await uploadEvidence(learnerId, assignmentFile, normalized.date, normalized.activity || "Assignment");
        payload = { ...normalized, evidence_id: uploaded.evidence_id, evidence_name: uploaded.document_name ?? assignmentFile.name };
      }
      const result = await createActivity(learnerId, payload, undefined, shareChoice === "yes" ? Number(effectiveGroupId) : undefined);
      await refresh(queryClient);
      onCancel();
      const sharedCount = result?.created_for ?? 1;
      await Swal.fire({
        toast: true, position: "top-end", icon: "success",
        title: sharedCount > 1 ? `Activity added for ${sharedCount} learners in the group` : "Activity added",
        showConfirmButton: false, timer: 2200,
      });
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
      <TableCell>
        <RowInput autoFocus value={draft.activity} onChange={(e) => set({ activity: e.target.value })} placeholder="Activity name" className="w-full min-w-56" maxLength={500} />
        {draft.category === "assignment" ? (
          <AssignmentUploadControl pendingFile={assignmentFile} onPick={setAssignmentFile} disabled={saving} />
        ) : (
          <ActivityNamePicker key={draft.category} category={draft.category} value={draft.activity} onPick={(name) => set({ activity: name })} onGroupPick={setShareGroupId} disabled={saving} />
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>Add this activity to the learner's group?</span>
          <label className="inline-flex cursor-pointer items-center gap-1">
            <input type="radio" checked={shareChoice === "no"} onChange={() => setShareChoice("no")} disabled={saving} /> No
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1">
            <input type="radio" checked={shareChoice === "yes"} onChange={() => setShareChoice("yes")} disabled={saving} /> Yes
          </label>
          {shareChoice === "yes" ? (
            shareCandidates.length ? (
              <select
                value={effectiveGroupId}
                onChange={(e) => setShareGroupId(e.target.value)}
                disabled={saving}
                aria-label="Group to share with"
                className="h-7 rounded-md border border-border bg-card px-1.5 text-[11px]"
              >
                {shareCandidates.map((group) => (
                  <option key={group.group_id} value={String(group.group_id)}>{group.name}</option>
                ))}
              </select>
            ) : (
              <span className="text-destructive">{learnerGroups.isLoading ? "Loading groups…" : "No LMS group found for this learner"}</span>
            )
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-center text-xs text-muted-foreground">User input</TableCell>
      <TableCell><RowInput type="number" min="0" max="50" step="0.01" value={draft.planned} onChange={(e) => set({ planned: Number(e.target.value) })} className="w-20 text-right" /></TableCell>
      <TableCell><RowInput type="number" min="0" max="50" step="0.01" value={draft.actual} onChange={(e) => set({ actual: Number(e.target.value) })} className="w-20 text-right" /></TableCell>
      <TableCell className="pr-7 text-right"><div className="flex justify-end gap-1"><button type="button" onClick={save} disabled={saving} className="rounded-md bg-success p-1.5 text-white disabled:opacity-50" title="Add activity"><Check className="h-3.5 w-3.5" /></button><button type="button" onClick={onCancel} disabled={saving} className="rounded-md border border-border p-1.5 hover:bg-secondary"><X className="h-3.5 w-3.5" /></button></div></TableCell>
    </TableRow>
  );
}
