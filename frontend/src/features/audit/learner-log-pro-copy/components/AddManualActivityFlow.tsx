// The add-activity flow for the employee-arranged journal.
//
// Category first. Attendance options come from the learner's own register rows
// (attended AND absent, with the register's verdict shown). Video / audio /
// reading+quiz come from the WHOLE selected group's catalogue — deliberately
// not limited to the learner's own activity_results — with a badge showing
// whether this learner completed each item. Items already on the draft report
// are flagged "Already added" and cannot be selected again. Everything lands
// in the LOCAL draft — nothing persists until "Save all activities".
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FileText, LoaderCircle, Paperclip, Plus, Search, X } from "lucide-react";
import Swal from "sweetalert2";
import { DurationInput } from "@/features/audit/learner-log-pro-copy/components/DurationInput";
import { Button } from "@/features/audit/learner-log-pro-copy/components/ui/button";
import {
  durationAsHours,
  formatDurationMinutes,
  getAttendanceOptions,
  getGroupActivityOptions,
  getManualGroups,
  MANUAL_CATEGORIES,
  type AttendanceOption,
  type GroupActivityOption,
  type ManualCategory,
} from "@/features/audit/learner-log-pro-copy/lib/manualApi";
import { nextDraftKey, type DraftRow } from "@/features/audit/learner-log-pro-copy/lib/journalDraft";
import {
  dateRestriction,
  monthBounds,
  WORK_DAY_START,
  workingTimeRange,
} from "@/features/audit/learner-log-pro-copy/lib/ukCalendar";

const ATTENDANCE_DEFAULT_PLANNED = 2.5;

type SourceCategory = Exclude<ManualCategory, "attendance" | "assignment">;

type ComboOption = {
  value: string;
  label: string;
  sublabel?: string | null;
  badge?: { text: string; tone: "success" | "warning" | "muted" } | null;
  disabled?: boolean;
  disabledBadge?: string;
};

function badgeClasses(tone: "success" | "warning" | "muted") {
  switch (tone) {
    case "success": return "bg-success/15 text-success";
    case "warning": return "bg-amber-500/15 text-amber-700";
    default: return "bg-muted text-muted-foreground";
  }
}

/** A small searchable dropdown: type to filter, click to pick. */
function SearchableSelect({ options, value, onSelect, placeholder, disabled, loading }: {
  options: ComboOption[];
  value: string;
  onSelect: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    function onOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, []);

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      option.label.toLowerCase().includes(needle) || (option.sublabel ?? "").toLowerCase().includes(needle),
    );
  }, [options, term]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => setOpen((state) => !state)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-card px-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={`truncate ${selected ? "text-foreground" : "text-muted-foreground"}`}>
          {loading ? "Loading…" : selected?.label ?? placeholder}
        </span>
        {loading ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {open && !disabled && !loading ? (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Type to search…"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">No matches.</li>
            ) : filtered.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => {
                    if (option.disabled) {
                      void Swal.fire({ toast: true, position: "top-end", icon: "info", title: option.disabledBadge ?? "Already on this report", showConfirmButton: false, timer: 1800 });
                      return;
                    }
                    onSelect(option.value); setOpen(false); setTerm("");
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${option.disabled ? "cursor-not-allowed opacity-45" : "hover:bg-secondary"} ${option.value === value ? "bg-primary/5" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.sublabel ? <span className="block truncate text-xs text-muted-foreground">{option.sublabel}</span> : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {option.badge ? (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClasses(option.badge.tone)}`}>{option.badge.text}</span>
                    ) : null}
                    {option.disabled ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{option.disabledBadge ?? "Already added"}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function attendanceCombo(option: AttendanceOption, existingRefs: Set<string>): ComboOption {
  return {
    value: option.source_ref,
    label: option.lecture_name || option.module || option.source_key,
    sublabel: [option.attendance_date, option.module].filter(Boolean).join(" · ") || null,
    badge: option.attended
      ? { text: "Attended", tone: "success" }
      : { text: "Absent", tone: "warning" },
    disabled: existingRefs.has(option.source_ref),
  };
}

function activityCombo(option: GroupActivityOption, existingRefs: Set<string>): ComboOption {
  const badge = option.completion.state === "completed"
    ? { text: "Completed", tone: "success" as const }
    : option.completion.state === "not_completed"
      ? { text: "Not completed", tone: "warning" as const }
      : { text: "No record", tone: "muted" as const };
  const duration = formatDurationMinutes(option.duration_minutes);
  return {
    value: option.source_ref,
    label: option.title,
    sublabel: [option.activity_date, duration ? `duration ${duration}` : null].filter(Boolean).join(" · ") || null,
    badge,
    disabled: existingRefs.has(option.source_ref),
  };
}

type Draft = {
  title: string;
  activity_date: string;
  planned_hours: string;
  actual_hours: string;
  timestamp_label: string;
  completion_note: string | null;
  accepted: boolean;
};

const emptyDraft: Draft = {
  title: "",
  activity_date: "",
  planned_hours: "",
  actual_hours: "",
  timestamp_label: "",
  completion_note: null,
  accepted: true,
};

export function AddManualActivityFlow({ aptemId, month, monthLabel, existingRefs, onAdd, onClose }: {
  aptemId: number;
  month: string;
  monthLabel: string;
  existingRefs: Set<string>;
  onAdd: (row: DraftRow) => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<ManualCategory>("attendance");
  const [groupId, setGroupId] = useState<number | null>(null);
  const [sourceRef, setSourceRef] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  // Non-attendance timestamp: "input" saves the literal label; "time" is
  // system-generated inside legal job hours from the claimed actual hours.
  const [tsMode, setTsMode] = useState<"input" | "time">("input");
  const [startTime, setStartTime] = useState(WORK_DAY_START);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const set = (patch: Partial<Draft>) => setDraft((value) => ({ ...value, ...patch }));
  const isSourceCategory = category !== "attendance" && category !== "assignment";
  const bounds = monthBounds(month);

  const groups = useQuery({
    queryKey: ["manual-groups", aptemId],
    queryFn: () => getManualGroups(aptemId),
    enabled: isSourceCategory,
  });
  const attendance = useQuery({
    queryKey: ["manual-attendance-options", aptemId],
    queryFn: () => getAttendanceOptions(aptemId),
    enabled: category === "attendance",
  });
  const groupActivities = useQuery({
    queryKey: ["manual-group-activities", aptemId, groupId, category],
    queryFn: () => getGroupActivityOptions({ aptemId, groupId: groupId!, category: category as SourceCategory }),
    enabled: isSourceCategory && groupId != null,
  });

  function resetSelection() {
    setSourceRef("");
    setDraft(emptyDraft);
    setTsMode("input");
    setStartTime(WORK_DAY_START);
    setFiles([]);
  }

  function pickCategory(next: ManualCategory) {
    setCategory(next);
    setGroupId(null);
    resetSelection();
  }

  function pickAttendance(ref: string) {
    const option = attendance.data?.options.find((item) => item.source_ref === ref);
    if (!option) return;
    setSourceRef(ref);
    setDraft({
      title: option.lecture_name || option.module || "Attendance session",
      activity_date: option.attendance_date ?? "",
      planned_hours: String(ATTENDANCE_DEFAULT_PLANNED),
      actual_hours: option.attended ? String(ATTENDANCE_DEFAULT_PLANNED) : "0",
      timestamp_label: option.attended ? "attended" : "not attended",
      completion_note: null,
      accepted: true,
    });
  }

  function pickActivity(ref: string) {
    const option = groupActivities.data?.activities.find((item) => item.source_ref === ref);
    if (!option) return;
    setSourceRef(ref);
    setDraft({
      title: option.title,
      activity_date: option.activity_date ?? "",
      planned_hours: "",
      actual_hours: "",
      timestamp_label: "",
      completion_note: option.completion.state,
      accepted: true,
    });
  }

  const selectedAttendance = attendance.data?.options.find((item) => item.source_ref === sourceRef);
  const selectedActivity = groupActivities.data?.activities.find((item) => item.source_ref === sourceRef);
  const needsSelection = category !== "assignment" && !sourceRef;

  // Live validation: the date must sit inside the report month, on a UK
  // working day; a generated timestamp must fit inside 09:00–17:00.
  const dateIssue = needsSelection
    ? null
    : !draft.activity_date
      ? `Choose a date inside ${monthLabel}.`
      : dateRestriction(draft.activity_date, month);
  const generatedTime = category !== "attendance" && tsMode === "time"
    ? workingTimeRange(startTime, Number(draft.actual_hours || 0))
    : null;
  const timeIssue = generatedTime && "error" in generatedTime ? generatedTime.error : null;

  function save() {
    const planned = Number(draft.planned_hours || 0);
    const actual = Number(draft.actual_hours || 0);
    if (!draft.title.trim()) return void Swal.fire({ icon: "error", title: "Check the activity", text: "Enter an activity name." });
    if (![planned, actual].every((value) => Number.isFinite(value) && value >= 0 && value <= 50)) {
      return void Swal.fire({ icon: "error", title: "Check the hours", text: "Planned and actual hours must be between 0 and 50." });
    }
    if (dateIssue) return void Swal.fire({ icon: "error", title: "Check the date", text: dateIssue });
    if (timeIssue) return void Swal.fire({ icon: "error", title: "Check the timestamp", text: timeIssue });
    const ref = category === "assignment" ? null : sourceRef;
    if (ref && existingRefs.has(ref)) {
      return void Swal.fire({ icon: "warning", title: "Already on this report", text: "This activity is already on the learner's draft for this month." });
    }
    const timestampLabel = category === "attendance"
      ? draft.timestamp_label
      : tsMode === "time" && generatedTime && "label" in generatedTime
        ? generatedTime.label
        : "input";
    // Stage in the local draft only — the floating Save persists everything.
    onAdd({
      key: nextDraftKey(),
      serverId: null,
      state: "new",
      retrieved: false,
      aptem_id: aptemId,
      month,
      category,
      source_ref: ref,
      title: draft.title.trim(),
      activity_date: draft.activity_date || null,
      planned_hours: planned,
      actual_hours: actual,
      timestamp_label: timestampLabel,
      completion_note: draft.completion_note,
      accepted: draft.accepted,
      documents: [],
      stagedFiles: files,
      deletedDocIds: [],
      duration_minutes: selectedActivity?.duration_minutes ?? null,
    });
    resetSelection();
    void Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Added to draft — Save all activities to persist", showConfirmButton: false, timer: 2200 });
    if (category === "assignment") onClose();
  }

  return (
    <div className="border-b border-border bg-[#fafbfc] px-7 py-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#182d48]">Add activity to {monthLabel}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Pick a category, choose the source item, then confirm the editable details.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md border border-border p-1.5 hover:bg-secondary" title="Close" aria-label="Close add-activity panel"><X className="h-4 w-4" /></button>
      </div>

      <div className="flex flex-wrap gap-2">
        {MANUAL_CATEGORIES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => pickCategory(item)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize transition-colors ${category === item ? "bg-[#182d48] text-white" : "border border-border bg-card text-muted-foreground hover:bg-secondary"}`}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {category === "attendance" ? (
          <label className="block">
            <span className="label-caps">Attendance session</span>
            <div className="mt-1.5">
              <SearchableSelect
                options={(attendance.data?.options ?? []).map((option) => attendanceCombo(option, existingRefs))}
                value={sourceRef}
                onSelect={pickAttendance}
                placeholder="Search the learner's attendance register…"
                loading={attendance.isLoading}
              />
            </div>
            {selectedAttendance ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Register verdict:{" "}
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${selectedAttendance.attended ? badgeClasses("success") : badgeClasses("warning")}`}>
                  {selectedAttendance.attended ? "Attended" : "Absent"}
                </span>{" "}
                — you decide the final hours below.
              </p>
            ) : null}
          </label>
        ) : null}

        {isSourceCategory ? (
          <>
            <label className="block">
              <span className="label-caps">Group (module)</span>
              <div className="mt-1.5">
                <SearchableSelect
                  options={(groups.data?.groups ?? []).map((group) => ({
                    value: String(group.group_id),
                    label: group.group_name,
                    sublabel: `${group.counts[category] ?? 0} ${category} activities`,
                  }))}
                  value={groupId == null ? "" : String(groupId)}
                  onSelect={(value) => { setGroupId(Number(value)); resetSelection(); }}
                  placeholder={groups.data?.lms_matched === false ? "Learner has no LMS match" : "Choose the learner's group…"}
                  disabled={groups.data?.lms_matched === false}
                  loading={groups.isLoading}
                />
              </div>
            </label>
            <label className="block">
              <span className="label-caps">Activity</span>
              <div className="mt-1.5">
                <SearchableSelect
                  options={(groupActivities.data?.activities ?? []).map((option) => activityCombo(option, existingRefs))}
                  value={sourceRef}
                  onSelect={pickActivity}
                  placeholder={groupId == null ? "Choose a group first" : "Search the group's activities…"}
                  disabled={groupId == null}
                  loading={groupActivities.isLoading}
                />
              </div>
              {selectedActivity ? (
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  Learner status:{" "}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${selectedActivity.completion.state === "completed" ? badgeClasses("success") : selectedActivity.completion.state === "not_completed" ? badgeClasses("warning") : badgeClasses("muted")}`}>
                    {selectedActivity.completion.state === "completed" ? "Completed" : selectedActivity.completion.state === "not_completed" ? "Not completed" : "No record"}
                  </span>
                  {formatDurationMinutes(selectedActivity.duration_minutes) ? (
                    <>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        Duration {formatDurationMinutes(selectedActivity.duration_minutes)} (≈ {durationAsHours(selectedActivity.duration_minutes)} h)
                      </span>
                      <button
                        type="button"
                        onClick={() => set({ actual_hours: String(durationAsHours(selectedActivity.duration_minutes)) })}
                        className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold text-primary hover:bg-secondary"
                        title="Fill the actual hours with the media duration"
                      >
                        Use as actual
                      </button>
                    </>
                  ) : null}
                </p>
              ) : null}
            </label>
          </>
        ) : null}

        {category === "assignment" ? (
          <p className="self-end text-xs text-muted-foreground lg:col-span-2">
            Assignments are entered by hand — type the details below and attach the evidence files before saving.
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block lg:col-span-2">
          <span className="label-caps">Activity name</span>
          <input value={draft.title} disabled={needsSelection} onChange={(event) => set({ title: event.target.value })} maxLength={500} placeholder={category === "assignment" ? "Assignment title" : "Select an item above"} className="mt-1.5 h-9 w-full rounded-md border border-border bg-card px-3 text-sm disabled:opacity-60" />
        </label>
        <label className="block">
          <span className="label-caps">Date</span>
          <input type="date" value={draft.activity_date} min={bounds.min} max={bounds.max} disabled={needsSelection} onChange={(event) => set({ activity_date: event.target.value })} className={`mt-1.5 h-9 w-full rounded-md border bg-card px-3 text-sm disabled:opacity-60 ${dateIssue && draft.activity_date ? "border-destructive" : "border-border"}`} />
          {dateIssue && draft.activity_date ? <span className="mt-1 block text-[11px] text-destructive">{dateIssue}</span> : <span className="mt-1 block text-[11px] text-muted-foreground">Working days in {monthLabel} only.</span>}
        </label>
        <label className="block">
          <span className="label-caps">Planned duration</span>
          <div className="mt-1.5"><DurationInput value={Number(draft.planned_hours || 0)} disabled={needsSelection} onChange={(value) => set({ planned_hours: String(value) })} ariaLabel="Planned duration" /></div>
        </label>
        <label className="block">
          <span className="label-caps">Actual duration</span>
          <div className="mt-1.5"><DurationInput value={Number(draft.actual_hours || 0)} disabled={needsSelection} onChange={(value) => set({ actual_hours: String(value) })} ariaLabel="Actual duration" /></div>
        </label>

        {category === "attendance" ? (
          <div className="block">
            <span className="label-caps">Timestamp</span>
            <p className="mt-1.5 flex h-9 items-center rounded-md border border-border bg-[#f6f8fb] px-3 font-mono text-sm text-muted-foreground" title="Fixed from the attendance register">
              {draft.timestamp_label || "—"}
            </p>
            <span className="mt-1 block text-[11px] text-muted-foreground">Fixed by the register — not editable.</span>
          </div>
        ) : (
          <div className="block lg:col-span-2">
            <span className="label-caps">Timestamp</span>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <select value={tsMode} disabled={needsSelection} onChange={(event) => setTsMode(event.target.value as "input" | "time")} className="h-9 rounded-md border border-border bg-card px-3 text-sm disabled:opacity-60">
                <option value="input">Input</option>
                <option value="time">Time (system-generated)</option>
              </select>
              {tsMode === "time" ? (
                <>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Start
                    <input type="time" min="09:00:00" max="17:00:00" step="1" value={startTime} disabled={needsSelection} onChange={(event) => setStartTime(event.target.value || WORK_DAY_START)} className="h-9 rounded-md border border-border bg-card px-2 font-mono text-sm disabled:opacity-60" aria-label="Start time including seconds" />
                  </label>
                  {generatedTime && "label" in generatedTime ? (
                    <span className="rounded-md bg-[#f6f8fb] px-2.5 py-1.5 font-mono text-xs text-[#182d48]">{generatedTime.label}</span>
                  ) : null}
                </>
              ) : null}
            </div>
            {timeIssue ? (
              <span className="mt-1 block text-[11px] text-destructive">{timeIssue}</span>
            ) : (
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {tsMode === "time" ? "Generated from the claimed hours, inside legal job hours (09:00–17:00)." : "Saved as “input”."}
              </span>
            )}
          </div>
        )}

        {category === "assignment" ? (
          <div className="block lg:col-span-3">
            <span className="label-caps">Evidence files</span>
            <div className="mt-1.5 space-y-1">
              {files.map((file, index) => (
                <div key={`${file.name}-${index}`} className="flex items-center gap-1.5 text-xs">
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate" title={file.name}>{file.name}</span>
                  <button type="button" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} className="text-muted-foreground hover:text-destructive" title="Remove file" aria-label={`Remove ${file.name}`}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => {
                const picked = Array.from(event.target.files ?? []);
                if (picked.length) setFiles((current) => [...current, ...picked]);
                event.target.value = "";
              }} />
              <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary">
                <Paperclip className="h-3 w-3" /> Attach evidence
              </button>
              <span className="block text-[11px] text-muted-foreground">Staged with the activity — uploaded when you click Save all activities.</span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={draft.accepted} disabled={needsSelection} onChange={(event) => set({ accepted: event.target.checked })} />
          Accepted (counts toward claimed hours)
        </label>
        <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" className="gap-1.5 bg-[#182d48] hover:bg-[#243f61]" disabled={needsSelection || !draft.title.trim() || Boolean(dateIssue) || Boolean(timeIssue)} onClick={save}>
          <Plus className="h-3.5 w-3.5" />
          Add to draft
        </Button>
        </div>
      </div>
    </div>
  );
}
