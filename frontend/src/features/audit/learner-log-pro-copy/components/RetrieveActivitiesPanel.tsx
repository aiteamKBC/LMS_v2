// "Retrieve LMS activities": a checklist of everything Last_audit holds for
// this learner-month — attendance sessions (live register) plus the learner's
// own video/audio/reading+quiz results — grouped by category with select-all,
// attended/absent and completed/not badges. Already-added items are dimmed and
// pre-excluded. Confirm stages the selection as DRAFT rows (hours always 0/0 —
// the employee decides them); nothing is saved until "Save all activities".
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, DownloadCloud, LoaderCircle, X } from "lucide-react";
import { Button } from "@/features/audit/learner-log-pro-copy/components/ui/button";
import Swal from "sweetalert2";
import {
  createReadingQuizPair,
  deleteReadingQuizPair,
  formatDurationMinutes,
  getImportCandidates,
  type ImportActivityCandidate,
  type ImportAttendanceCandidate,
  type ManualCategory,
} from "@/features/audit/learner-log-pro-copy/lib/manualApi";
import { nextDraftKey, type DraftRow } from "@/features/audit/learner-log-pro-copy/lib/journalDraft";
import { isUkBankHoliday, isUkWeekend } from "@/features/audit/learner-log-pro-copy/lib/ukCalendar";

type Candidate = {
  source_ref: string;
  category: string;
  title: string;
  activity_date: string | null;
  duration_minutes: number | null;
  timestamp_label: string;
  completion_note: string | null;
  badge: { text: string; tone: "success" | "warning" | "muted" };
  group_id?: number;
  activity_id?: number;
  paired?: boolean;
  pair?: ImportActivityCandidate["pair"];
};

const GROUP_ORDER = ["attendance", "video", "audio", "reading+quiz"];

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
    title: item.title,
    activity_date: item.activity_date,
    duration_minutes: null,
    timestamp_label: item.timestamp_label,
    completion_note: null,
    badge: item.attended
      ? { text: "Attended", tone: "success" }
      : { text: "Absent", tone: "warning" },
  };
}

function fromActivity(item: ImportActivityCandidate): Candidate {
  const completed = item.completion.state === "completed";
  return {
    source_ref: item.source_ref,
    category: item.category,
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

export function RetrieveActivitiesPanel({ aptemId, month, monthLabel, existingRefs, onRetrieve, onClose }: {
  aptemId: number;
  month: string;
  monthLabel: string;
  existingRefs: Set<string>;
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
  const [pairSelection, setPairSelection] = useState<Candidate[]>([]);
  const [savingPair, setSavingPair] = useState(false);
  // Reset the selection whenever fresh candidates arrive.
  useEffect(() => setSelected(new Set()), [candidatesQuery.data]);

  const togglePair = (candidate: Candidate) => setPairSelection((current) => {
    if (current.some((item) => item.source_ref === candidate.source_ref)) {
      return current.filter((item) => item.source_ref !== candidate.source_ref);
    }
    if (current.length >= 2) return [current[1], candidate];
    return [...current, candidate];
  });

  async function savePair() {
    if (pairSelection.length !== 2) return;
    const [reading, quiz] = pairSelection;
    if (!reading.group_id || reading.group_id !== quiz.group_id || !reading.activity_id || !quiz.activity_id) {
      return void Swal.fire({ icon: "error", title: "Cannot link these activities", text: "Choose two activities from the same LMS group." });
    }
    setSavingPair(true);
    try {
      await createReadingQuizPair({ group_id: reading.group_id, reading_activity_id: reading.activity_id, quiz_activity_id: quiz.activity_id });
      setPairSelection([]);
      await queryClient.invalidateQueries({ queryKey: ["manual-import-candidates", aptemId, month] });
      await Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Reading and Quiz linked", showConfirmButton: false, timer: 1800 });
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
      title: "Unlink Reading and Quiz?",
      text: "Both activities will appear separately again for every learner in this group.",
      showCancelButton: true,
      confirmButtonText: "Unlink",
      confirmButtonColor: "#b91c1c",
    });
    if (!confirmation.isConfirmed) return;
    try {
      await deleteReadingQuizPair({
        group_id: candidate.group_id,
        reading_activity_id: candidate.pair.reading_activity_id,
        quiz_activity_id: candidate.pair.quiz_activity_id,
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
        // Retrieved rows never bring hours — the employee decides them.
        planned_hours: 0,
        actual_hours: 0,
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
            Tick what belongs on this report. Hours are never retrieved — you set planned and actual yourself. Nothing saves until “Save all activities”.
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
          <div className="grid gap-4 lg:grid-cols-2">
            {GROUP_ORDER.map((category) => {
              const candidates = groups.get(category) ?? [];
              const eligible = candidates.filter(selectable);
              const allPicked = eligible.length > 0 && eligible.every((candidate) => selected.has(candidate.source_ref));
              return (
                <section key={category} className="overflow-hidden rounded-lg border border-border bg-card">
                  <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
                    <label className="flex items-center gap-2 text-xs font-semibold capitalize text-[#182d48]">
                      <input type="checkbox" checked={allPicked} disabled={!eligible.length} onChange={() => toggleGroup(candidates)} />
                      {category}
                    </label>
                    <span className="font-mono text-[11px] text-muted-foreground">{candidates.length} found</span>
                  </header>
                  {category === "reading+quiz" && candidates.length ? (
                    <div className="flex items-center justify-between gap-2 border-b border-border bg-[#f6f8fb] px-4 py-2">
                      <span className="text-[11px] text-muted-foreground">Select exactly two unlinked items using “Pair”, then save the relationship.</span>
                      <Button type="button" size="sm" variant="outline" disabled={pairSelection.length !== 2 || savingPair} onClick={savePair}>
                        {savingPair ? "Linking..." : `Link pair${pairSelection.length ? ` (${pairSelection.length}/2)` : ""}`}
                      </Button>
                    </div>
                  ) : null}
                  <ul className="max-h-64 overflow-y-auto">
                    {candidates.length === 0 ? (
                      <li className="px-4 py-3 text-xs text-muted-foreground">Nothing recorded this month.</li>
                    ) : candidates.map((candidate) => {
                      const taken = takenRefs.has(candidate.source_ref);
                      const flag = dateFlag(candidate.activity_date);
                      return (
                        <li key={candidate.source_ref} className={`border-b border-border/60 last:border-b-0 ${taken ? "opacity-45" : ""}`}>
                          <label className="flex cursor-pointer items-start gap-2.5 px-4 py-2.5 hover:bg-secondary/50">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              disabled={taken}
                              checked={selected.has(candidate.source_ref)}
                              onChange={() => toggle(candidate.source_ref)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-foreground" title={candidate.title}>{candidate.title}</span>
                              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                                {candidate.activity_date ? <span className="font-mono text-[11px] text-muted-foreground">{candidate.activity_date}</span> : null}
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClasses(candidate.badge.tone)}`}>{candidate.badge.text}</span>
                                {formatDurationMinutes(candidate.duration_minutes) ? (
                                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{formatDurationMinutes(candidate.duration_minutes)}</span>
                                ) : null}
                                {flag ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                                    <AlertTriangle className="h-2.5 w-2.5" /> {flag}
                                  </span>
                                ) : null}
                                {taken ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Already added</span> : null}
                                {category === "reading+quiz" ? candidate.paired ? (
                                  <button type="button" onClick={(event) => { event.preventDefault(); void unlinkPair(candidate); }} className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success hover:bg-destructive/15 hover:text-destructive" title="Separate the Reading and Quiz again">Linked bundle · Unlink</button>
                                ) : (
                                  <button type="button" onClick={(event) => { event.preventDefault(); togglePair(candidate); }} className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${pairSelection.some((item) => item.source_ref === candidate.source_ref) ? "border-primary bg-primary text-primary-foreground" : "border-border text-primary"}`}>
                                    Pair
                                  </button>
                                ) : null}
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
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
