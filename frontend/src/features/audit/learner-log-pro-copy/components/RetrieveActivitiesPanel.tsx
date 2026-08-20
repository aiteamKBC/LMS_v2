// "Retrieve LMS activities": a checklist of everything Last_audit holds for
// this learner-month — attendance sessions (live register) plus the learner's
// own video/audio/reading+quiz results — grouped by category with select-all,
// attended/absent and completed/not badges. Already-added items are dimmed and
// pre-excluded. Confirm stages the selection as DRAFT rows. Attendance uses a
// fixed 2.5-hour plan and gives attended sessions 2.5 actual hours; other LMS
// activities start at 0/0. Nothing is saved until "Save all activities".
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, BookOpenText, CalendarDays, DownloadCloud, LoaderCircle, Search, X } from "lucide-react";
import { Button } from "@/features/audit/learner-log-pro-copy/components/ui/button";
import Swal from "sweetalert2";
import {
  createReadingQuizPair,
  deleteReadingQuizPair,
  formatDurationMinutes,
  getImportCandidates,
  type ImportActivityCandidate,
  type ImportAssignmentCandidate,
  type ImportAttendanceCandidate,
  type ManualCategory,
} from "@/features/audit/learner-log-pro-copy/lib/manualApi";
import { nextDraftKey, type DraftRow } from "@/features/audit/learner-log-pro-copy/lib/journalDraft";
import { isUkBankHoliday, isUkWeekend } from "@/features/audit/learner-log-pro-copy/lib/ukCalendar";

type Candidate = {
  source_ref: string;
  category: string;
  group_name: string;
  title: string;
  activity_date: string | null;
  duration_minutes: number | null;
  timestamp_label: string;
  completion_note: string | null;
  attended?: boolean;
  badge: { text: string; tone: "success" | "warning" | "muted" };
  group_id?: number;
  activity_id?: number;
  paired?: boolean;
  pair?: ImportActivityCandidate["pair"];
  // Aptem assignments carry the source's own hours into the staged row.
  planned_hours?: number;
  actual_hours?: number;
};

const GROUP_ORDER = ["attendance", "video", "audio", "reading+quiz", "assignment"];
const ATTENDANCE_SESSION_HOURS = 2.5;

function weekLabelOf(dateIso: string | null) {
  if (!dateIso) return "Undated";
  const date = new Date(`${dateIso}T00:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return `Week of ${date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
}

function badgeClasses(tone: "success" | "warning" | "muted") {
  switch (tone) {
    case "success": return "bg-success/15 text-success";
    case "warning": return "bg-amber-500/15 text-amber-700";
    default: return "bg-muted text-muted-foreground";
  }
}

function dateFlag(date: string | null): string | null {
  if (!date) return null;
  if (isUkWeekend(date)) return "Weekend";
  if (isUkBankHoliday(date)) return "Bank holiday";
  return null;
}

function fromAttendance(item: ImportAttendanceCandidate): Candidate {
  return {
    source_ref: item.source_ref,
    category: "attendance",
    group_name: item.group_name,
    title: item.title,
    activity_date: item.activity_date,
    duration_minutes: null,
    timestamp_label: item.timestamp_label,
    completion_note: null,
    attended: item.attended,
    badge: item.attended
      ? { text: "Attended", tone: "success" }
      : { text: "Absent", tone: "warning" },
  };
}

function fromAssignment(item: ImportAssignmentCandidate): Candidate {
  const completed = item.completion.state === "completed";
  return {
    source_ref: item.source_ref,
    category: "assignment",
    group_name: item.group_name || "Assignments",
    title: item.title,
    activity_date: item.activity_date,
    duration_minutes: null,
    timestamp_label: "input",
    completion_note: item.completion.state,
    planned_hours: item.planned_hours,
    actual_hours: item.actual_hours,
    badge: completed
      ? { text: "Completed", tone: "success" }
      : { text: item.status || "Not completed", tone: "warning" },
  };
}

function fromActivity(item: ImportActivityCandidate): Candidate {
  const completed = item.completion.state === "completed";
  return {
    source_ref: item.source_ref,
    category: item.category,
    group_name: item.group_name,
    title: item.title,
    activity_date: item.activity_date,
    duration_minutes: item.duration_minutes,
    timestamp_label: "input",
    completion_note: item.completion.state,
    badge: completed
      ? { text: "Completed", tone: "success" }
      : { text: "Not completed", tone: "warning" },
    group_id: item.group_id,
    activity_id: item.activity_id,
    paired: Boolean(item.pair),
    pair: item.pair,
  };
}

export function RetrieveActivitiesPanel({ aptemId, month, monthLabel, existingRefs, initialCategory = "all", onRetrieve, onClose }: {
  aptemId: number;
  month: string;
  monthLabel: string;
  existingRefs: Set<string>;
  initialCategory?: "attendance" | "video" | "reading+quiz" | "audio" | "assignment" | "all";
  onRetrieve: (rows: DraftRow[]) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const candidatesQuery = useQuery({
    queryKey: ["manual-import-candidates", aptemId, month],
    queryFn: () => getImportCandidates(aptemId, month),
  });

  const groups = useMemo(() => {
    const data = candidatesQuery.data;
    if (!data) return new Map<string, Candidate[]>();
    const all = [
      ...data.attendance.map(fromAttendance),
      ...data.activities.map(fromActivity),
      ...(data.assignments ?? []).map(fromAssignment),
    ];
    const grouped = new Map<string, Candidate[]>();
    for (const category of GROUP_ORDER) grouped.set(category, []);
    for (const candidate of all) {
      if (!grouped.has(candidate.category)) grouped.set(candidate.category, []);
      grouped.get(candidate.category)!.push(candidate);
    }
    for (const candidates of grouped.values()) {
      candidates.sort((left, right) => {
        const leftDate = left.activity_date || "9999-12-31";
        const rightDate = right.activity_date || "9999-12-31";
        return leftDate.localeCompare(rightDate) || left.title.localeCompare(right.title);
      });
    }
    return grouped;
  }, [candidatesQuery.data]);

  const takenRefs = useMemo(() => {
    const taken = new Set(existingRefs);
    for (const ref of candidatesQuery.data?.already_added ?? []) taken.add(ref);
    return taken;
  }, [existingRefs, candidatesQuery.data]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedCourse, setSelectedCourse] = useState<number | "attendance" | "assignments" | null>(
    initialCategory === "attendance" ? "attendance" : initialCategory === "assignment" ? "assignments" : null,
  );
  const [typeFilter, setTypeFilter] = useState(initialCategory === "attendance" || initialCategory === "assignment" ? "all" : initialCategory);
  const [search, setSearch] = useState("");
  const [pairSelection, setPairSelection] = useState<Candidate[]>([]);
  const [savingPair, setSavingPair] = useState(false);
  // Reset the selection whenever fresh candidates arrive.
  useEffect(() => {
    setSelected(new Set());
    setPairSelection([]);
    setSelectedCourse(initialCategory === "attendance" ? "attendance" : initialCategory === "assignment" ? "assignments" : null);
    setTypeFilter(initialCategory === "attendance" || initialCategory === "assignment" ? "all" : initialCategory);
  }, [candidatesQuery.data, initialCategory]);

  const courses = useMemo(() => {
    const byId = new Map<number, { group_id: number; group_name: string; count: number }>();
    for (const item of candidatesQuery.data?.activities ?? []) {
      const current = byId.get(item.group_id);
      if (current) current.count += 1;
      else byId.set(item.group_id, { group_id: item.group_id, group_name: item.group_name, count: 1 });
    }
    return [...byId.values()].sort((left, right) => right.count - left.count || left.group_name.localeCompare(right.group_name));
  }, [candidatesQuery.data]);

  const courseCandidates = useMemo(() => {
    if (selectedCourse === "attendance") return candidatesQuery.data?.attendance.map(fromAttendance) ?? [];
    if (selectedCourse === "assignments") {
      const needle = search.trim().toLowerCase();
      return (candidatesQuery.data?.assignments ?? [])
        .map(fromAssignment)
        .filter((item) => !needle || item.title.toLowerCase().includes(needle) || (item.activity_date ?? "").includes(needle))
        .sort((left, right) => (left.activity_date || "9999-12-31").localeCompare(right.activity_date || "9999-12-31") || left.title.localeCompare(right.title));
    }
    if (typeof selectedCourse !== "number") return [];
    const needle = search.trim().toLowerCase();
    return (candidatesQuery.data?.activities ?? [])
      .filter((item) => item.group_id === selectedCourse)
      .map(fromActivity)
      .filter((item) => (typeFilter === "all" || item.category === typeFilter) && (!needle || item.title.toLowerCase().includes(needle) || (item.activity_date ?? "").includes(needle)))
      .sort((left, right) => (left.activity_date || "9999-12-31").localeCompare(right.activity_date || "9999-12-31") || left.title.localeCompare(right.title));
  }, [candidatesQuery.data, search, selectedCourse, typeFilter]);

  const weeks = useMemo(() => {
    const result = new Map<string, Candidate[]>();
    for (const candidate of courseCandidates) {
      const label = weekLabelOf(candidate.activity_date);
      if (!result.has(label)) result.set(label, []);
      result.get(label)!.push(candidate);
    }
    return [...result.entries()];
  }, [courseCandidates]);

  const togglePair = (candidate: Candidate) => setPairSelection((current) => {
    if (current.some((item) => item.source_ref === candidate.source_ref)) {
      return current.filter((item) => item.source_ref !== candidate.source_ref);
    }
    return [...current, candidate];
  });

  async function savePair() {
    if (pairSelection.length < 2) return;
    const groupId = pairSelection[0]?.group_id;
    const activityIds = pairSelection.map((item) => item.activity_id);
    if (!groupId || activityIds.some((id) => !id) || pairSelection.some((item) => item.group_id !== groupId)) {
      return void Swal.fire({ icon: "error", title: "Cannot merge these activities", text: "Choose at least two activities from the same LMS group." });
    }
    setSavingPair(true);
    try {
      await createReadingQuizPair({ group_id: groupId, activity_ids: activityIds as number[] });
      setPairSelection([]);
      await queryClient.invalidateQueries({ queryKey: ["manual-import-candidates", aptemId, month] });
      await Swal.fire({ toast: true, position: "top-end", icon: "success", title: `${activityIds.length} activities merged`, showConfirmButton: false, timer: 1800 });
    } catch (error) {
      await Swal.fire({ icon: "error", title: "Could not save the link", text: error instanceof Error ? error.message : "Could not link these activities." });
    } finally {
      setSavingPair(false);
    }
  }

  async function unlinkPair(candidate: Candidate) {
    if (!candidate.group_id || !candidate.pair) return;
    const confirmation = await Swal.fire({
      icon: "warning",
      title: "Unlink this bundle?",
      text: "All bundled activities will appear separately again for every learner in this group.",
      showCancelButton: true,
      confirmButtonText: "Unlink",
      confirmButtonColor: "#b91c1c",
    });
    if (!confirmation.isConfirmed) return;
    try {
      await deleteReadingQuizPair({
        group_id: candidate.group_id,
        activity_ids: candidate.pair.activity_ids,
      });
      await queryClient.invalidateQueries({ queryKey: ["manual-import-candidates", aptemId, month] });
    } catch (error) {
      await Swal.fire({ icon: "error", title: "Could not unlink the bundle", text: error instanceof Error ? error.message : "Could not unlink these activities." });
    }
  }

  const selectable = (candidate: Candidate) => !takenRefs.has(candidate.source_ref);
  const toggle = (ref: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(ref)) next.delete(ref);
    else next.add(ref);
    return next;
  });
  const toggleGroup = (candidates: Candidate[]) => {
    const eligible = candidates.filter(selectable).map((candidate) => candidate.source_ref);
    const allPicked = eligible.length > 0 && eligible.every((ref) => selected.has(ref));
    setSelected((current) => {
      const next = new Set(current);
      for (const ref of eligible) {
        if (allPicked) next.delete(ref);
        else next.add(ref);
      }
      return next;
    });
  };

  function confirm() {
    const all = [...groups.values()].flat();
    const rows: DraftRow[] = all
      .filter((candidate) => selected.has(candidate.source_ref) && selectable(candidate))
      .map((candidate) => ({
        key: nextDraftKey(),
        serverId: null,
        state: "new",
        retrieved: true,
        aptem_id: aptemId,
        month,
        category: candidate.category as ManualCategory,
        source_ref: candidate.source_ref,
        title: candidate.title,
        activity_date: candidate.activity_date,
        // Attendance sessions have a fixed duration (an absence keeps the plan
        // but contributes no actual time); Aptem assignments arrive with the
        // source's own planned hours and evidenced OTJH time.
        planned_hours: candidate.category === "attendance"
          ? ATTENDANCE_SESSION_HOURS
          : candidate.planned_hours ?? 0,
        actual_hours: candidate.category === "attendance"
          ? (candidate.attended ? ATTENDANCE_SESSION_HOURS : 0)
          : candidate.actual_hours ?? 0,
        timestamp_label: candidate.timestamp_label,
        completion_note: candidate.completion_note,
        accepted: true,
        documents: [],
        stagedFiles: [],
        deletedDocIds: [],
        duration_minutes: candidate.duration_minutes,
      }));
    onRetrieve(rows);
    onClose();
  }

  return (
    <div className="border-b border-border bg-[#fafbfc] px-7 py-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#182d48]">Retrieve LMS activities — {monthLabel}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tick what belongs on this report. Attendance uses 2h 30m planned, and 2h 30m actual only when attended; other activity hours start at zero. Nothing saves until “Save all activities”.
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md border border-border p-1.5 hover:bg-secondary" title="Close" aria-label="Close retrieve panel"><X className="h-4 w-4" /></button>
      </div>

      {candidatesQuery.isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />Loading the learner's LMS records…</p>
      ) : candidatesQuery.isError ? (
        <p className="py-8 text-center text-sm text-destructive">{candidatesQuery.error instanceof Error ? candidatesQuery.error.message : "Could not load the LMS records."}</p>
      ) : (
        <>
          {selectedCourse == null ? (
            <section className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="border-b border-border bg-[#eef3f8] px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-[#182d48]">Enrolled courses</div>
              <ul className="divide-y divide-border">
                {(candidatesQuery.data?.attendance.length ?? 0) > 0 ? (
                  <li><button type="button" onClick={() => { setSelectedCourse("attendance"); setTypeFilter("all"); setSearch(""); }} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/60">
                    <CalendarDays className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Attendance register</span><span className="text-xs text-muted-foreground">{candidatesQuery.data?.attendance.length ?? 0} sessions in {monthLabel}</span></span>
                    <span className="text-xs font-semibold text-muted-foreground">Open →</span>
                  </button></li>
                ) : null}
                {(candidatesQuery.data?.assignments?.length ?? 0) > 0 ? (
                  <li><button type="button" onClick={() => { setSelectedCourse("assignments"); setTypeFilter("all"); setSearch(""); }} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/60">
                    <DownloadCloud className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Aptem assignments</span><span className="text-xs text-muted-foreground">{candidatesQuery.data?.assignments?.length ?? 0} assignments in {monthLabel} — with their planned and evidenced hours</span></span>
                    <span className="text-xs font-semibold text-muted-foreground">Open →</span>
                  </button></li>
                ) : null}
                {courses.map((course) => (
                  <li key={course.group_id}><button type="button" onClick={() => { setSelectedCourse(course.group_id); setTypeFilter(initialCategory === "attendance" || initialCategory === "assignment" ? "all" : initialCategory); setSearch(""); }} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/60">
                    <BookOpenText className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium" title={course.group_name}>{course.group_name}</span><span className="text-xs text-muted-foreground">{course.count} activities</span></span>
                    <span className="text-xs font-semibold text-muted-foreground">Open →</span>
                  </button></li>
                ))}
                {!courses.length && !(candidatesQuery.data?.attendance.length ?? 0) ? <li className="px-4 py-8 text-center text-sm text-muted-foreground">This learner is not enrolled in any LMS course.</li> : null}
              </ul>
            </section>
          ) : (
            <section>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => { setSelectedCourse(null); setPairSelection([]); }}><ArrowLeft className="mr-1 h-3.5 w-3.5" /> Courses</Button>
                {selectedCourse === "assignments" ? (
                  <>
                    <label className="relative min-w-48 flex-1 max-w-64"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assignment / date…" className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-3 text-xs outline-none focus:border-primary" /></label>
                    <span className="text-xs font-semibold text-[#182d48]">Aptem assignments — {monthLabel}</span>
                  </>
                ) : selectedCourse !== "attendance" ? (
                  <>
                    <div className="flex rounded-md border border-border">
                      {([["video", "Videos"], ["reading+quiz", "Reading+Quiz"], ["audio", "Audio"], ["all", "All"]] as const).map(([value, label]) => (
                        <button key={value} type="button" onClick={() => setTypeFilter(value)} className={`px-3 py-1.5 text-xs font-semibold ${typeFilter === value ? "bg-[#182d48] text-white" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
                      ))}
                    </div>
                    <label className="relative min-w-48 flex-1 max-w-64"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search activity / date…" className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-3 text-xs outline-none focus:border-primary" /></label>
                    <span className="text-xs font-semibold text-[#182d48]">{courses.find((course) => course.group_id === selectedCourse)?.group_name}</span>
                  </>
                ) : <span className="text-xs font-semibold text-[#182d48]">Attendance register — {monthLabel}</span>}
                <span className="flex-1" />
                {typeof selectedCourse === "number" && (typeFilter === "reading+quiz" || typeFilter === "all") ? (
                  <Button type="button" size="sm" variant="outline" disabled={pairSelection.length < 2 || savingPair} onClick={savePair}>{savingPair ? "Merging..." : `Merge selected${pairSelection.length ? ` (${pairSelection.length})` : ""}`}</Button>
                ) : null}
              </div>
              {!courseCandidates.length ? <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">Nothing matches this course and filter.</p> : (
                <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                  {weeks.map(([weekLabel, weekCandidates]) => {
                    const eligible = weekCandidates.filter(selectable);
                    const allPicked = eligible.length > 0 && eligible.every((candidate) => selected.has(candidate.source_ref));
                    return (
                      <section key={weekLabel} className="overflow-hidden rounded-lg border border-border bg-card">
                        <label className="flex items-center gap-2 border-b border-border bg-[#eef3f8] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#182d48]"><input type="checkbox" checked={allPicked} disabled={!eligible.length} onChange={() => toggleGroup(weekCandidates)} />{weekLabel}<span className="font-normal normal-case text-muted-foreground">({weekCandidates.length})</span></label>
                        <ul className="divide-y divide-border">
                          {weekCandidates.map((candidate) => {
                            const taken = takenRefs.has(candidate.source_ref);
                            const flag = dateFlag(candidate.activity_date);
                            return <li key={candidate.source_ref} className={taken ? "opacity-45" : ""}><label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-secondary/50">
                              <input type="checkbox" className="mt-0.5" disabled={taken} checked={selected.has(candidate.source_ref)} onChange={() => toggle(candidate.source_ref)} />
                              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium" title={candidate.title}>{candidate.title}</span><span className="mt-1 flex flex-wrap items-center gap-1.5">
                                {candidate.activity_date ? <span className="font-mono text-[11px] text-muted-foreground">{candidate.activity_date}</span> : null}
                                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{candidate.category}</span>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClasses(candidate.badge.tone)}`}>{candidate.badge.text}</span>
                                {formatDurationMinutes(candidate.duration_minutes) ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{formatDurationMinutes(candidate.duration_minutes)}</span> : null}
                                {candidate.category === "assignment" ? <span className="rounded-full bg-[#182d48]/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#182d48]">plan {candidate.planned_hours ?? 0}h · actual {candidate.actual_hours ?? 0}h</span> : null}
                                {flag ? <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive"><AlertTriangle className="h-2.5 w-2.5" /> {flag}</span> : null}
                                {taken ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Already added</span> : null}
                                {candidate.category === "reading+quiz" ? candidate.paired ? <button type="button" onClick={(event) => { event.preventDefault(); void unlinkPair(candidate); }} className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success hover:text-destructive">Linked bundle · Unlink</button> : <button type="button" onClick={(event) => { event.preventDefault(); togglePair(candidate); }} className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${pairSelection.some((item) => item.source_ref === candidate.source_ref) ? "border-primary bg-primary text-primary-foreground" : "border-border text-primary"}`}>Merge</button> : null}
                              </span></span>
                            </label></li>;
                          })}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              )}
            </section>
          )}
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {candidatesQuery.data?.attendance_source === "Last_audit-mirror"
                ? "Attendance served from the mirror (live register unreachable)."
                : "Attendance served live from the KBC register."}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" className="gap-1.5 bg-[#182d48] hover:bg-[#243f61]" disabled={!selected.size} onClick={confirm}>
                <DownloadCloud className="h-3.5 w-3.5" /> Add {selected.size || ""} to draft
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
