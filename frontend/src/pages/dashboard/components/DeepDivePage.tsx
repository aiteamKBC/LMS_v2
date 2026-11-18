import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { SelectMenu } from '@/components/feature/SelectField';
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchEnrolmentBoard, fetchEnrolmentUsers } from "@/api/enrolmentUsers";
import { fetchDeepDiveIlrContact, fetchDeepDiveRecord, fetchDeepDiveSummaries, importDeepDiveWorkbook, markDeepDiveRecordReviewed, sha256File, syncDeepDiveFromCreatedUsers, updateDeepDiveRecord, workbookToDeepDiveRows, type DeepDiveOperationalDetails, type DeepDiveRecord, type DeepDiveReviewItem } from "@/api/deepDive";
import type { EnrolmentBoard, UserListRow } from "@/pages/users/types";
import { BarChart3, CalendarCheck2, CheckCircle2, ChevronDown, ChevronRight, Clock3, HandHeart, LayoutDashboard, Pencil, ShieldCheck, X } from "lucide-react";
import styles from "./DeepDivePage.module.css";

type ReviewStatusFilter = "all" | "reviewed" | "awaiting";
type ReviewListKind = "reviewed" | "awaiting";
type JourneyRow = { key: string; learner: UserListRow; record: DeepDiveRecord | null; lmsId: string | null };
type DeepDiveEditValues = Pick<DeepDiveRecord, "firstName" | "surname" | "fullName" | "dateOfBirth" | "uln" | "qualification" | "level" | "startDate" | "practicalEndDate" | "apprenticeshipEndDate" | "plannedGatewayDate" | "plannedEpaDate" | "reviewedBy" | "notes">;

function displayDate(value?: string | null) {
  if (!value) return "Not available";
  const match = value.match(/^\d{4}-\d{2}-\d{2}$/);
  if (!match) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function programmeLabel(learner: UserListRow) {
  return [learner.programme, learner.cohort].filter(Boolean).join(" · ") || "Programme not recorded";
}

function recordText(record: DeepDiveRecord, key: string) {
  const value = record.raw?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function IlrContactFields({ recordId }: { recordId: string }) {
  const [contact, setContact] = useState<{ uln: string | null; postcode: string | null } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setContact(null);
    setError(false);
    void fetchDeepDiveIlrContact(recordId)
      .then((value) => { if (!cancelled) setContact(value); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [recordId]);

  const display = (value: string | null | undefined) => error ? "Unavailable" : contact ? value || "Not recorded" : "Loading…";
  return <>
    <div className="flex justify-between gap-3 border-b border-background-100 pb-2"><dt className="text-foreground-500">ULN</dt><dd className="text-right text-foreground-800">{display(contact?.uln)}</dd></div>
    <div className="flex justify-between gap-3 border-b border-background-100 pb-2"><dt className="text-foreground-500">Learner postcode</dt><dd className="text-right text-foreground-800">{display(contact?.postcode)}</dd></div>
  </>;
}

function operationalText(value?: string | null) {
  return value || "Not recorded";
}

function operationalStatusClass(status?: string) {
  const normalized = (status || "").toLowerCase();
  if (normalized.includes("completed") || normalized === "green" || normalized === "on track") return "bg-emerald-50 text-emerald-700";
  if (normalized.includes("scheduled") && !normalized.includes("not")) return "bg-sky-50 text-sky-700";
  if (normalized.includes("not scheduled") || normalized === "amber") return "bg-amber-50 text-amber-800";
  if (normalized === "red") return "bg-red-50 text-red-700";
  return "bg-background-100 text-foreground-600";
}

function SnapshotMetric({ label, value, emphasize = false }: { label: string; value?: string | null; emphasize?: boolean }) {
  return <div className={styles.snapshotMetric}><dt>{label}</dt><dd>{emphasize && value ? <span className={`${styles.statusBadge} ${operationalStatusClass(value)}`}>{value}</span> : operationalText(value)}</dd></div>;
}

function ReviewScheduleCard({ title, review }: { title: string; review?: DeepDiveOperationalDetails["mcm"] }) {
  return <article className={styles.snapshotCard}>
    <div className={styles.cardHeading}><h4><CalendarCheck2 size={17} aria-hidden="true" />{title}</h4><span className={styles.countBadge}>{review?.dates?.length || 0} dates</span></div>
    <dl className={styles.scheduleSummary}><SnapshotMetric label="Last" value={review?.last} /><SnapshotMetric label="Next" value={review?.next} /></dl>
    <div className={styles.scheduleList} role="region" aria-label={`${title} dates`} tabIndex={0}>
      {review?.dates?.length ? review.dates.map((item) => <div key={`${title}-${item.number}`} className={styles.scheduleRow}><span className={styles.scheduleNumber}>{String(item.number).padStart(2, "0")}</span><span className={styles.scheduleDate}>{item.date || "No date"}</span><span className={`${styles.statusBadge} ${operationalStatusClass(item.status)}`}>{item.status || "No status"}</span></div>) : <p className={styles.emptyText}>No dates recorded.</p>}
    </div>
  </article>;
}

function OperationalSnapshot({ operational, open, onToggle, onEdit, editing }: { operational?: DeepDiveOperationalDetails; open: boolean; onToggle: () => void; onEdit: () => void; editing: boolean }) {
  return <section className={styles.operationalSection}>
    <div className={styles.operationalHeading}>
      <button type="button" aria-expanded={open} aria-controls="deep-dive-operational-content" className={styles.operationalToggle} onClick={onToggle}><span className={styles.sectionIcon}><LayoutDashboard size={18} aria-hidden="true" /></span><span><span className={styles.sectionTitle}>Operational snapshot</span><span className={styles.sectionDescription}>Meetings, progression and learner support</span></span>{open ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}</button>
      <button type="button" className={styles.secondaryButton} onClick={onEdit}><Pencil size={13} aria-hidden="true" />{editing ? "Editing operational details" : "Edit operational details"}</button>
    </div>
    {open ? <div id="deep-dive-operational-content" className={styles.snapshotGrid}>
      <ReviewScheduleCard title="Monthly Coaching Meetings" review={operational?.mcm} />
      <ReviewScheduleCard title="Progress Reviews" review={operational?.pr} />
      <article className={styles.snapshotCard}><div className={styles.cardHeading}><h4><BarChart3 size={17} aria-hidden="true" />OTJH & progression</h4></div><dl className={styles.metricGrid}><SnapshotMetric label="OTJH planned" value={operational?.progress?.otjhPlanned} /><SnapshotMetric label="OTJH expected" value={operational?.progress?.otjhExpected} /><SnapshotMetric label="OTJH actual" value={operational?.progress?.otjhActual} /><SnapshotMetric label="Expected progression" value={operational?.progress?.expectedProgression} /><SnapshotMetric label="Actual progression" value={operational?.progress?.actualProgression} /><SnapshotMetric label="Progress variance" value={operational?.progress?.progressVariance} /><SnapshotMetric label="Risk rating" value={operational?.progress?.riskRating} emphasize /><SnapshotMetric label="KSB progress" value={operational?.progress ? `${operational.progress.ksbCompleted || "Not recorded"} / ${operational.progress.ksbTarget || "Not recorded"}` : null} /></dl></article>
      <article className={styles.snapshotCard}><div className={styles.cardHeading}><h4><HandHeart size={17} aria-hidden="true" />Inclusion support</h4></div><dl className={styles.metricGrid}><SnapshotMetric label="LLDD" value={operational?.inclusion?.lldd} /><SnapshotMetric label="Support categories" value={operational?.inclusion?.llddCategories?.length ? operational.inclusion.llddCategories.join(", ") : null} /><SnapshotMetric label="Demographics matched" value={operational?.inclusion?.demographicsMatched == null ? null : operational.inclusion.demographicsMatched ? "Yes" : "No"} /><SnapshotMetric label="Inclusion OTJH" value={operational?.inclusion?.otjStatus} /><SnapshotMetric label="Latest review" value={operational?.inclusion?.latestReview} /><SnapshotMetric label="PLR records" value={operational?.plr?.records == null ? null : String(operational.plr.records)} /></dl></article>
    </div> : null}
  </section>;
}

function operationalDraft(value?: DeepDiveOperationalDetails): DeepDiveOperationalDetails {
  return {
    mcm: { last: "", next: "", lastCompleted: "", ...value?.mcm, dates: [...(value?.mcm?.dates || [])] },
    pr: { last: "", next: "", lastCompleted: "", ...value?.pr, dates: [...(value?.pr?.dates || [])] },
    progress: {
      otjhPlanned: "", otjhExpected: "", otjhActual: "", expectedProgression: "", actualProgression: "", progressVariance: "",
      progressHours: "", riskRating: "", otjhStatus: "", ksbTarget: "", ksbCompleted: "", ksbStatus: "", disability: "", ...value?.progress,
    },
    inclusion: {
      lldd: "", demographicsMatched: null, otjStatus: "", otjCompleted: "", otjExpected: "", ksbCompleted: "",
      ksbTarget: "", latestMonthly: "", latestReview: "", ...value?.inclusion, llddCategories: [...(value?.inclusion?.llddCategories || [])],
    },
    ...(value?.plr ? { plr: { records: value.plr.records } } : {}),
  };
}

function OperationalInput({ label, value, onChange, type = "text" }: { label: string; value?: string | number | null; onChange: (value: string) => void; type?: "text" | "number" }) {
  return <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-500">{label}<input type={type} value={value ?? ""} onChange={(event) => onChange(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-background-300 bg-background-50 px-2.5 text-[12px] font-normal normal-case tracking-normal text-foreground-900 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" /></label>;
}

function OperationalEditor({ value, onChange, onCancel, onSave, saving }: { value: DeepDiveOperationalDetails; onChange: (value: DeepDiveOperationalDetails) => void; onCancel: () => void; onSave: () => void; saving: boolean }) {
  const updateSection = (section: "mcm" | "pr" | "progress" | "inclusion", key: string, next: string) => onChange({ ...value, [section]: { ...(value[section] as Record<string, unknown>), [key]: next } } as DeepDiveOperationalDetails);
  const updateDate = (section: "mcm" | "pr", index: number, key: "date" | "status", next: string) => {
    const dates = [...(value[section]?.dates || [])];
    dates[index] = { ...dates[index], [key]: next };
    onChange({ ...value, [section]: { ...value[section], dates } } as DeepDiveOperationalDetails);
  };
  const addDate = (section: "mcm" | "pr") => {
    const dates = [...(value[section]?.dates || []), { number: (value[section]?.dates?.length || 0) + 1, date: "", status: "" }];
    onChange({ ...value, [section]: { ...value[section], dates } } as DeepDiveOperationalDetails);
  };
  const removeDate = (section: "mcm" | "pr", index: number) => {
    const dates = (value[section]?.dates || []).filter((_, itemIndex) => itemIndex !== index).map((item, itemIndex) => ({ ...item, number: itemIndex + 1 }));
    onChange({ ...value, [section]: { ...value[section], dates } } as DeepDiveOperationalDetails);
  };
  const scheduleEditor = (section: "mcm" | "pr", title: string) => <article className="rounded-xl border border-background-200 bg-background-50 p-4"><h4 className="font-heading text-[13px] font-semibold text-foreground-900">{title}</h4><div className="mt-3 grid gap-3 sm:grid-cols-3"><OperationalInput label="Last" value={value[section]?.last} onChange={(next) => updateSection(section, "last", next)} /><OperationalInput label="Next" value={value[section]?.next} onChange={(next) => updateSection(section, "next", next)} /><OperationalInput label="Last completed" value={value[section]?.lastCompleted} onChange={(next) => updateSection(section, "lastCompleted", next)} /></div><div className="mt-4 space-y-2">{(value[section]?.dates || []).map((item, index) => <div key={`${section}-${item.number}-${index}`} className="grid gap-2 sm:grid-cols-[64px_1fr_1fr_auto] sm:items-end"><span className="pb-2 text-[11px] font-semibold text-foreground-600">#{item.number}</span><OperationalInput label="Date" value={item.date} onChange={(next) => updateDate(section, index, "date", next)} /><OperationalInput label="Status" value={item.status} onChange={(next) => updateDate(section, index, "status", next)} /><button type="button" className="h-9 rounded-md border border-red-200 px-2 text-[11px] font-semibold text-red-700 hover:bg-red-50" onClick={() => removeDate(section, index)}>Remove</button></div>)}<button type="button" className="rounded-md border border-primary-200 px-2.5 py-1.5 text-[11px] font-semibold text-primary-700 hover:bg-primary-50" onClick={() => addDate(section)}>+ Add date</button></div></article>;
  const progress = value.progress || operationalDraft().progress;
  const inclusion = value.inclusion || operationalDraft().inclusion;
  return <section className="rounded-xl border border-primary-200 bg-primary-50/30 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-heading text-[14px] font-semibold text-foreground-900">Edit operational snapshot</h3><p className="mt-1 text-[11px] text-foreground-600">These edits are saved as QMS overrides and do not overwrite the connected LMS reporting tables.</p></div><span className="rounded-full bg-background-50 px-2 py-1 text-[10px] font-semibold text-primary-700">Editable</span></div><div className="mt-4 grid gap-4 lg:grid-cols-2">{scheduleEditor("mcm", "Monthly Coaching Meetings")}{scheduleEditor("pr", "Progress Reviews")}</div><div className="mt-4 grid gap-4 lg:grid-cols-2"><article className="rounded-xl border border-background-200 bg-background-50 p-4"><h4 className="font-heading text-[13px] font-semibold text-foreground-900">OTJH & progression</h4><div className="mt-3 grid gap-3 sm:grid-cols-2"><OperationalInput label="OTJH planned" value={progress.otjhPlanned} onChange={(next) => updateSection("progress", "otjhPlanned", next)} /><OperationalInput label="OTJH expected" value={progress.otjhExpected} onChange={(next) => updateSection("progress", "otjhExpected", next)} /><OperationalInput label="OTJH actual" value={progress.otjhActual} onChange={(next) => updateSection("progress", "otjhActual", next)} /><OperationalInput label="Expected progression" value={progress.expectedProgression} onChange={(next) => updateSection("progress", "expectedProgression", next)} /><OperationalInput label="Actual progression" value={progress.actualProgression} onChange={(next) => updateSection("progress", "actualProgression", next)} /><OperationalInput label="Progress variance" value={progress.progressVariance} onChange={(next) => updateSection("progress", "progressVariance", next)} /><OperationalInput label="Risk rating" value={progress.riskRating} onChange={(next) => updateSection("progress", "riskRating", next)} /><OperationalInput label="Progress hours" value={progress.progressHours} onChange={(next) => updateSection("progress", "progressHours", next)} /><OperationalInput label="OTJH status" value={progress.otjhStatus} onChange={(next) => updateSection("progress", "otjhStatus", next)} /><OperationalInput label="KSB progress" value={progress.ksbCompleted && progress.ksbTarget ? `${progress.ksbCompleted} / ${progress.ksbTarget}` : ""} onChange={(next) => { const [completed, target] = next.split("/").map((item) => item.trim()); onChange({ ...value, progress: { ...progress, ksbCompleted: completed || "", ksbTarget: target || "" } }); }} /><OperationalInput label="KSB status" value={progress.ksbStatus} onChange={(next) => updateSection("progress", "ksbStatus", next)} /><OperationalInput label="Disability" value={progress.disability} onChange={(next) => updateSection("progress", "disability", next)} /></div></article><article className="rounded-xl border border-background-200 bg-background-50 p-4"><h4 className="font-heading text-[13px] font-semibold text-foreground-900">Inclusion support</h4><div className="mt-3 grid gap-3 sm:grid-cols-2"><OperationalInput label="LLDD" value={inclusion.lldd} onChange={(next) => updateSection("inclusion", "lldd", next)} /><OperationalInput label="Support categories" value={inclusion.llddCategories.join(", ")} onChange={(next) => onChange({ ...value, inclusion: { ...inclusion, llddCategories: next.split(",").map((item) => item.trim()).filter(Boolean) } })} /><label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-500">Demographics matched<select value={inclusion.demographicsMatched == null ? "" : inclusion.demographicsMatched ? "yes" : "no"} onChange={(event) => onChange({ ...value, inclusion: { ...inclusion, demographicsMatched: event.target.value === "" ? null : event.target.value === "yes" } })} className="mt-1 h-9 w-full rounded-md border border-background-300 bg-background-50 px-2.5 text-[12px] font-normal normal-case tracking-normal text-foreground-900"><option value="">Not recorded</option><option value="yes">Yes</option><option value="no">No</option></select></label><OperationalInput label="Inclusion OTJH" value={inclusion.otjStatus} onChange={(next) => updateSection("inclusion", "otjStatus", next)} /><OperationalInput label="OTJH completed" value={inclusion.otjCompleted} onChange={(next) => updateSection("inclusion", "otjCompleted", next)} /><OperationalInput label="OTJH expected" value={inclusion.otjExpected} onChange={(next) => updateSection("inclusion", "otjExpected", next)} /><OperationalInput label="Latest review" value={inclusion.latestReview} onChange={(next) => updateSection("inclusion", "latestReview", next)} /><OperationalInput label="Latest monthly" value={inclusion.latestMonthly} onChange={(next) => updateSection("inclusion", "latestMonthly", next)} /></div><div className="mt-3"><OperationalInput label="PLR records" type="number" value={value.plr?.records ?? ""} onChange={(next) => onChange({ ...value, plr: { records: Number(next) || 0 } })} /></div></article></div><div className="mt-4 flex justify-end gap-2"><button type="button" className="rounded-md border border-background-300 px-3 py-2 text-[11px] font-semibold text-foreground-700 hover:bg-background-100" onClick={onCancel}>Cancel</button><button type="button" disabled={saving} className="rounded-md bg-primary-600 px-3 py-2 text-[11px] font-semibold text-background-50 hover:bg-primary-700 disabled:opacity-60" onClick={onSave}>{saving ? "Saving…" : "Save operational details"}</button></div></section>;
}

function EditableOperationalSnapshot({ operational, open, onToggle, onSave }: { operational?: DeepDiveOperationalDetails; open: boolean; onToggle: () => void; onSave: (value: DeepDiveOperationalDetails) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DeepDiveOperationalDetails>(() => operationalDraft(operational));
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!editing) setDraft(operationalDraft(operational)); }, [editing, operational]);
  const startEditing = () => { setDraft(operationalDraft(operational)); setEditing(true); if (!open) onToggle(); };
  const save = async () => { setSaving(true); try { await onSave(draft); setEditing(false); } finally { setSaving(false); } };
  return <div className="space-y-3"><OperationalSnapshot operational={operational} open={open} onToggle={onToggle} onEdit={startEditing} editing={editing} />{editing ? <OperationalEditor value={draft} onChange={setDraft} onCancel={() => setEditing(false)} onSave={() => void save()} saving={saving} /> : null}</div>;
}

function statusClass(status?: string) {
  switch (status) {
    case "Active":
    case "Delivery":
      return "bg-emerald-50 text-emerald-700";
    case "Completed":
      return "bg-sky-50 text-sky-700";
    case "Withdrawn":
    case "On break":
      return "bg-amber-50 text-amber-800";
    default:
      return "bg-background-100 text-foreground-600";
  }
}

export default function DeepDivePage() {
  const [learners, setLearners] = useState<UserListRow[]>([]);
  const [deepDiveRecords, setDeepDiveRecords] = useState<DeepDiveRecord[]>([]);
  const [query, setQuery] = useState("");
  const [programme, setProgramme] = useState("All programmes");
  const [status, setStatus] = useState("All statuses");
  const [reviewStatus, setReviewStatus] = useState<ReviewStatusFilter>("all");
  const [reviewListKind, setReviewListKind] = useState<ReviewListKind | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBoard, setSelectedBoard] = useState<EnrolmentBoard | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [loadedRecordId, setLoadedRecordId] = useState<string | null>(null);
  const [recordDetailLoading, setRecordDetailLoading] = useState(false);
  const [recordDetailError, setRecordDetailError] = useState("");
  const [recordRetry, setRecordRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deepDiveError, setDeepDiveError] = useState("");
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [markingReviewed, setMarkingReviewed] = useState(false);
  const [editError, setEditError] = useState("");
  const [operationalOpen, setOperationalOpen] = useState(true);
  const [notesEditing, setNotesEditing] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [editValues, setEditValues] = useState<DeepDiveEditValues>({ firstName: "", surname: "", fullName: "", dateOfBirth: "", uln: "", qualification: "", level: "", startDate: "", practicalEndDate: "", apprenticeshipEndDate: "", plannedGatewayDate: "", plannedEpaDate: "", reviewedBy: "", notes: "" });
  const learnerDialog = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setDeepDiveError("");
    setImportMessage("");

    void fetchDeepDiveSummaries()
      .then((result) => { if (!cancelled) setDeepDiveRecords(result.records); })
      .catch((reason) => { if (!cancelled) setDeepDiveError(reason instanceof Error ? reason.message : "Deep Dive records could not be loaded."); })
      .finally(() => { if (!cancelled) setLoading(false); });

    // Directory details can enrich the rows later without delaying the table.
    void fetchEnrolmentUsers()
      .then((result) => { if (!cancelled) setLearners(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Learner data could not be loaded."); });

    return () => { cancelled = true; };
  }, [retry]);

  const mergedRows = useMemo<JourneyRow[]>(() => {
    const byLmsId = new Map(learners.map((learner) => [learner.id, learner]));
    const byName = new Map(learners.map((learner) => [learner.name.trim().toLowerCase(), learner]));
    return deepDiveRecords.map((record) => {
      const matchedLearner = (record.lmsLearnerId ? byLmsId.get(record.lmsLearnerId) : undefined)
        ?? byName.get(record.fullName.trim().toLowerCase());
      const learner = matchedLearner ?? {
        id: `deep-dive:${record.id}`, uuid: null, name: record.fullName, type: "User", email: recordText(record, "email"), group: recordText(record, "group"),
        subscriptionStatus: "", subscriptionVerified: false, learningPlan: false,
        programme: recordText(record, "programme") || record.qualification || "Deep Dive record",
        cohort: recordText(record, "cohort"), programmeStatus: recordText(record, "programmeStatus") || "Status not recorded",
        source: recordText(record, "learnerType") === "commercial" ? "commercial" : "apprenticeship",
        referenceNumber: record.uln || recordText(record, "reference"),
      } satisfies UserListRow;
      return { key: `deep-dive:${record.id}`, learner, record, lmsId: matchedLearner?.id ?? record.lmsLearnerId };
    });
  }, [deepDiveRecords, learners]);

  const programmes = useMemo(
    () => Array.from(new Set(mergedRows.map(({ learner }) => learner.programme).filter(Boolean))).sort(),
    [mergedRows],
  );
  const statuses = useMemo(
    () => Array.from(new Set(mergedRows.map(({ learner }) => learner.programmeStatus).filter(Boolean))).sort(),
    [mergedRows],
  );

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return mergedRows.filter((row) => {
      const { learner, record } = row;
      if (needle && ![learner.name, learner.email, learner.referenceNumber, learner.coachName, record?.uln, record?.qualification, record?.level].some((value) => value?.toLowerCase().includes(needle))) return false;
      if (programme !== "All programmes" && learner.programme !== programme) return false;
      if (status !== "All statuses" && learner.programmeStatus !== status) return false;
      if (reviewStatus === "reviewed" && !record?.reviewedBy) return false;
      if (reviewStatus === "awaiting" && record?.reviewedBy) return false;
      return true;
    });
  }, [mergedRows, programme, query, reviewStatus, status]);

  const selectedRow = selectedId ? mergedRows.find((row) => row.key === selectedId) ?? null : null;
  const selected = selectedRow?.learner ?? null;
  const selectedRecordSummary = selectedRow?.record ?? null;
  const selectedRecord = loadedRecordId === selectedRecordSummary?.id ? selectedRecordSummary : null;
  const selectedLmsId = selectedRow?.lmsId ?? null;
  const operational = selectedRecord?.operational;
  const deepDiveReviewedCount = mergedRows.filter(({ record }) => Boolean(record?.reviewedBy)).length;
  const deepDiveAwaitingReviewCount = Math.max(0, mergedRows.length - deepDiveReviewedCount);
  const reviewListRows = mergedRows.filter(({ record }) => reviewListKind === "reviewed" ? Boolean(record?.reviewedBy) : reviewListKind === "awaiting" ? !record?.reviewedBy : false);
  const summaryCards = [
    { label: "Learners in scope", value: mergedRows.length, caption: deepDiveRecords.length ? "Monthly sync + workbook records" : "No Deep Dive sync yet", kind: null },
    { label: "Learners reviewed", value: deepDiveReviewedCount, caption: "Deep Dive records marked reviewed", kind: "reviewed" as const },
    { label: "Awaiting review", value: deepDiveAwaitingReviewCount, caption: "Deep Dive records not yet reviewed", kind: "awaiting" as const },
  ];

  useEffect(() => {
    const id = selectedRecordSummary?.id;
    if (!id) {
      setLoadedRecordId(null);
      setRecordDetailLoading(false);
      setRecordDetailError("");
      return;
    }
    let cancelled = false;
    setLoadedRecordId(null);
    setRecordDetailLoading(true);
    setRecordDetailError("");
    void fetchDeepDiveRecord(id)
      .then((detail) => {
        if (cancelled) return;
        setDeepDiveRecords((current) => current.map((record) => record.id === id && detail.version >= record.version ? detail : record));
        setLoadedRecordId(id);
      })
      .catch((reason) => { if (!cancelled) setRecordDetailError(reason instanceof Error ? reason.message : "Deep Dive details could not be loaded."); })
      .finally(() => { if (!cancelled) setRecordDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedRecordSummary?.id, recordRetry]);

  useEffect(() => {
    if (!selectedLmsId) {
      setSelectedBoard(null);
      setDetailError("");
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setSelectedBoard(null);
    setDetailError("");
    setDetailLoading(true);
    void fetchEnrolmentBoard(selectedLmsId)
      .then((board) => { if (!cancelled) setSelectedBoard(board); })
      .catch((reason) => { if (!cancelled) setDetailError(reason instanceof Error ? reason.message : "Learner details could not be loaded."); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedLmsId]);

  useEffect(() => {
    if (!selectedRecord) return;
    const { firstName, surname, fullName, dateOfBirth, uln, qualification, level, startDate, practicalEndDate, apprenticeshipEndDate, plannedGatewayDate, plannedEpaDate, reviewedBy, notes } = selectedRecord;
    setEditValues({ firstName, surname, fullName, dateOfBirth, uln, qualification, level, startDate, practicalEndDate, apprenticeshipEndDate, plannedGatewayDate, plannedEpaDate, reviewedBy, notes });
    setNotesDraft(notes);
    setNotesEditing(false);
    setOperationalOpen(true);
    setEditing(false);
    setEditError("");
  }, [selectedRecord]);

  useEffect(() => {
    if (!selectedId) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    learnerDialog.current?.querySelector<HTMLButtonElement>('[aria-label="Close learner details"]')?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setSelectedId(null); }
      if (event.key !== "Tab") return;
      const focusable = Array.from(learnerDialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [selectedId]);

  const handleWorkbookImport = async (file: File) => {
    setImporting(true);
    setImportMessage("");
    setDeepDiveError("");
    try {
      const [rows, hash] = await Promise.all([workbookToDeepDiveRows(file), sha256File(file)]);
      const result = await importDeepDiveWorkbook(file.name, hash, rows);
      setDeepDiveRecords((current) => {
        const byId = new Map(current.map((record) => [record.id, record]));
        result.records.forEach((record) => byId.set(record.id, record));
        return Array.from(byId.values());
      });
      setImportMessage(`${result.count} workbook learners imported · ${result.matched} matched to LMS`);
    } catch (reason) {
      setDeepDiveError(reason instanceof Error ? reason.message : "The Deep Dive workbook could not be imported.");
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const handleCreatedUsersSync = async () => {
    setSyncing(true);
    setImportMessage("");
    setDeepDiveError("");
    try {
      const result = await syncDeepDiveFromCreatedUsers();
      setDeepDiveRecords((current) => {
        const byId = new Map(current.map((record) => [record.id, record]));
        result.records.forEach((record) => byId.set(record.id, record));
        return Array.from(byId.values());
      });
      setImportMessage(`${result.added} new learners synced for ${result.month} · ${result.remaining} remaining`);
    } catch (reason) {
      setDeepDiveError(reason instanceof Error ? reason.message : "Learner sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const saveDeepDiveEdit = async () => {
    if (!selectedRecord) return;
    setSavingEdit(true);
    setEditError("");
    try {
      const updated = await updateDeepDiveRecord(selectedRecord.id, selectedRecord.version, editValues);
      setDeepDiveRecords((current) => current.map((record) => record.id === updated.id ? updated : record));
      setEditing(false);
      setImportMessage("Deep Dive learner details saved.");
    } catch (reason) {
      setEditError(reason instanceof Error ? reason.message : "The Deep Dive learner details could not be saved.");
    } finally {
      setSavingEdit(false);
    }
  };

  const saveNotes = async () => {
    if (!selectedRecord) return;
    setSavingNotes(true);
    setEditError("");
    try {
      const updated = await updateDeepDiveRecord(selectedRecord.id, selectedRecord.version, { notes: notesDraft });
      setDeepDiveRecords((current) => current.map((record) => record.id === updated.id ? updated : record));
      setNotesEditing(false);
      setImportMessage("Learner notes saved.");
    } catch (reason) {
      setEditError(reason instanceof Error ? reason.message : "The learner notes could not be saved.");
    } finally {
      setSavingNotes(false);
    }
  };

  const saveOperational = async (operationalDetails: DeepDiveOperationalDetails) => {
    if (!selectedRecord) return;
    setEditError("");
    try {
      const updated = await updateDeepDiveRecord(selectedRecord.id, selectedRecord.version, { operational: operationalDetails });
      setDeepDiveRecords((current) => current.map((record) => record.id === updated.id ? updated : record));
      setImportMessage("Operational details saved.");
    } catch (reason) {
      setEditError(reason instanceof Error ? reason.message : "The operational details could not be saved.");
      throw reason;
    }
  };

  const markSelectedReviewed = async () => {
    if (!selectedRecord || markingReviewed || selectedRecord.reviewedBy) return;
    setMarkingReviewed(true);
    setEditError("");
    try {
      const updated = await markDeepDiveRecordReviewed(selectedRecord.id, selectedRecord.version);
      setDeepDiveRecords((current) => current.map((record) => record.id === updated.id ? updated : record));
      setImportMessage("Learner marked as reviewed.");
    } catch (reason) {
      setEditError(reason instanceof Error ? reason.message : "The learner could not be marked as reviewed.");
    } finally {
      setMarkingReviewed(false);
    }
  };

  if (loading) {
    return <div  className="rounded-xl border border-background-200 bg-background-50 p-8 text-sm text-foreground-600"><LoadingSkeleton label={"Loading Deep Dive learner journey…"} /></div>;
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-label text-[10.5px] font-semibold uppercase tracking-[0.14em] text-primary-700">Quality Assurance · learner journey</p>
          <h1 className="mt-1 font-heading text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground-950">Deep Dive</h1>
          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-foreground-600">A monthly review workspace for planned learner milestones, programme progress and review ownership.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2"><input ref={fileInput} type="file" accept=".ods,.xlsx,.xls" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleWorkbookImport(file); }} /><button type="button" disabled={importing || syncing} onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-2 font-label text-[12px] font-semibold text-background-50 transition hover:bg-primary-700 disabled:cursor-wait disabled:opacity-60"><i className={importing ? "ri-loader-4-line animate-spin" : "ri-upload-2-line"} aria-hidden="true" />{importing ? "Importing…" : "Import Deep Dive workbook"}</button><button type="button" disabled={importing || syncing} onClick={() => void handleCreatedUsersSync()} className="inline-flex items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 px-3 py-2 font-label text-[12px] font-semibold text-primary-800 transition hover:bg-primary-100 disabled:cursor-wait disabled:opacity-60"><i className={syncing ? "ri-loader-4-line animate-spin" : "ri-refresh-line"} aria-hidden="true" />{syncing ? "Syncing…" : "Sync 30 learners"}</button><span className="rounded-full border border-background-200 bg-background-50 px-3 py-1.5 text-[11px] text-foreground-600">Default period: last 12 months</span></div>
      </header>

      <div className="rounded-xl border border-primary-100 bg-primary-50/50 px-4 py-3 text-[12px] leading-relaxed text-foreground-700">
        <span className="font-semibold text-foreground-900">Source:</span> Imported Deep Dive workbook rows and matched LMS learner records. The monthly sync adds the next 30 learners grouped by ILR postcode area; learners without an ILR postcode remain eligible. It does not create accounts or overwrite authoritative LMS fields.
      </div>

      {deepDiveError ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-950">{deepDiveError}<button type="button" className="ml-3 font-semibold underline" onClick={() => setRetry((value) => value + 1)}>Retry</button></div> : null}
      {error ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-950">Learner directory: {error}<button type="button" className="ml-3 font-semibold underline" onClick={() => setRetry((value) => value + 1)}>Retry</button></div> : null}
      {importMessage ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-900">{importMessage}</div> : null}

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Deep Dive summary">
        {summaryCards.map((card) => {
          const content = <><p className="font-label text-[10.5px] font-semibold uppercase tracking-[0.1em] text-foreground-500">{card.label}</p><p className="mt-2 font-heading text-[28px] font-semibold text-foreground-950">{card.value}</p><p className="mt-1 text-[11px] text-foreground-500">{card.caption}</p></>;
          return card.kind ? <button key={card.label} type="button" className={`${styles.summaryCard} rounded-xl border border-background-200 bg-background-50 p-4 text-left transition hover:border-primary-300 hover:bg-primary-50/30 focus:outline-none focus:ring-2 focus:ring-primary-200`} onClick={() => setReviewListKind(card.kind)}>{content}</button> : <article key={card.label} className={`${styles.summaryCard} rounded-xl border border-background-200 bg-background-50 p-4`}>{content}</article>;
        })}
      </section>

      {reviewListKind ? <div className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground-950/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewListKind(null); }}>
        <section className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-background-200 bg-background-50 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="deep-dive-review-list-title">
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-background-200 bg-background-50 px-5 py-4"><div><p className="font-label text-[10.5px] font-semibold uppercase tracking-[0.1em] text-primary-700">Deep Dive review status</p><h2 id="deep-dive-review-list-title" className="mt-1 font-heading text-[20px] font-semibold text-foreground-950">{reviewListKind === "reviewed" ? "Learners reviewed" : "Awaiting review"}</h2><p className="mt-1 text-[12px] text-foreground-600">{reviewListRows.length} learner{reviewListRows.length === 1 ? "" : "s"}</p></div><button type="button" aria-label="Close review status list" className="flex size-8 items-center justify-center rounded-md border border-background-300 text-foreground-600 hover:bg-background-100" onClick={() => setReviewListKind(null)}><i className="ri-close-line text-[17px]" aria-hidden="true" /></button></div>
          <div className="space-y-2 p-5">{reviewListRows.length ? reviewListRows.map(({ key, learner, record }) => <button key={key} type="button" className="flex w-full flex-col gap-2 rounded-lg border border-background-200 px-3 py-3 text-left transition hover:border-primary-300 hover:bg-primary-50/30 sm:flex-row sm:items-center sm:justify-between" onClick={() => { setReviewListKind(null); setSelectedId(key); }}><div><p className="text-[13px] font-semibold text-primary-700">{learner.name || record?.fullName || "Unnamed learner"}</p><p className="mt-0.5 text-[11px] text-foreground-500">{programmeLabel(learner)}</p></div><div className="text-[11px] text-foreground-600 sm:text-right">{record?.reviewedBy ? <><p><span className="font-semibold text-foreground-800">Reviewed by:</span> {record.reviewedBy}</p><p className="mt-0.5">{displayDate(record.reviewedAt?.slice(0, 10))}</p></> : <p className="font-semibold text-amber-700">Not reviewed yet</p>}</div></button>) : <p className="rounded-lg bg-background-100 px-4 py-6 text-center text-[12px] text-foreground-500">No learners in this list.</p>}</div>
        </section>
      </div> : null}

      <section className="rounded-xl border border-background-200 bg-background-50 p-4" aria-label="Deep Dive filters">
        <div className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="min-w-0 text-[11px] font-medium text-foreground-600">Search learner, email, reference or coach<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search…" className="mt-1.5 h-11 w-full rounded-[10px] border border-background-200 bg-background-50 px-3.5 text-[14px] text-foreground-900 outline-none transition hover:border-primary-200 focus:border-primary-400 focus:ring-2 focus:ring-primary-100" /></label>
          <div className="min-w-0">
            <label htmlFor="deep-dive-programme" className="mb-1.5 block text-[11px] font-medium text-foreground-600">Programme</label>
            <SelectMenu id="deep-dive-programme" value={programme} onChange={setProgramme} size="sm" searchable searchPlaceholder="Search programmes…" options={[{ value: "All programmes", label: "All programmes" }, ...programmes.map((item) => ({ value: item, label: item }))]} />
          </div>
          <div className="min-w-0">
            <label htmlFor="deep-dive-programme-status" className="mb-1.5 block text-[11px] font-medium text-foreground-600">Programme status</label>
            <SelectMenu id="deep-dive-programme-status" value={status} onChange={setStatus} size="sm" options={[{ value: "All statuses", label: "All statuses" }, ...statuses.map((item) => ({ value: item, label: item }))]} />
          </div>
          <div className="min-w-0">
            <label htmlFor="deep-dive-review-status" className="mb-1.5 block text-[11px] font-medium text-foreground-600">Review status</label>
            <SelectMenu id="deep-dive-review-status" value={reviewStatus} onChange={(value) => setReviewStatus(value as ReviewStatusFilter)} size="sm" options={[{ value: "all", label: "All learners" }, { value: "reviewed", label: "Reviewed" }, { value: "awaiting", label: "Awaiting review" }]} />
          </div>
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-xl border border-background-200 bg-background-50 shadow-sm" aria-label="Learner Deep Dive table">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-background-200 px-4 py-3"><div><h2 id="deep-dive-journey-title" className="font-heading text-[15px] font-semibold text-foreground-950">Learner journey</h2><p className="mt-0.5 text-[11px] text-foreground-500">{filteredRows.length} of {mergedRows.length} learners shown</p></div><span className="text-[11px] text-foreground-500">Click a row for details</span></div>
        <div
          role="region"
          aria-labelledby="deep-dive-journey-title"
          tabIndex={0}
          className="max-h-[min(65dvh,640px)] overflow-auto overscroll-contain [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400"
        >
          <table aria-labelledby="deep-dive-journey-title" className={`${styles.journeyTable} w-full min-w-[1100px] !overflow-visible text-left text-[12px] [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:whitespace-nowrap [&_th]:shadow-[inset_0_-1px_0_var(--kbc-border)]`}>
            <thead className="bg-background-100 text-[10.5px] uppercase tracking-[0.08em] text-foreground-500"><tr><th scope="col" className="w-[23%] px-4 py-3 font-semibold">Learner</th><th scope="col" className="w-[25%] px-4 py-3 font-semibold">Programme / cohort</th><th scope="col" className="px-4 py-3 font-semibold">Status</th><th scope="col" className="px-4 py-3 font-semibold">Planned dates</th><th scope="col" className="px-4 py-3 font-semibold">Reviewed date</th><th scope="col" className="px-4 py-3 font-semibold">Review status</th><th scope="col" className="px-4 py-3 font-semibold">Details</th></tr></thead>
            <tbody className="divide-y divide-background-100">
              {filteredRows.map((row) => {
                const { learner, record } = row;
                const isSelected = selectedId === row.key;
                return <tr key={row.key} className={`cursor-pointer align-top transition-colors hover:bg-primary-50/40 ${isSelected ? "bg-primary-50/60" : ""}`} onClick={() => setSelectedId(isSelected ? null : row.key)}>
                  <td className="break-words px-4 py-3"><button type="button" className="text-left" onClick={() => setSelectedId(isSelected ? null : row.key)}><p className="font-semibold text-primary-700 hover:text-primary-900">{learner.name || "Unnamed learner"}</p><p className="mt-0.5 break-all text-[11px] text-foreground-500">{learner.email || learner.referenceNumber || "No reference recorded"}</p></button></td>
                  <td className="break-words px-4 py-3 text-foreground-700">{programmeLabel(learner)}</td>
                  <td className="whitespace-nowrap px-4 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-[10.5px] font-semibold ${statusClass(learner.programmeStatus)}`}>{learner.programmeStatus || "Not recorded"}</span></td>
                  <td className="whitespace-nowrap px-4 py-3 text-foreground-700"><p>{displayDate(record?.startDate || learner.learnerStartDate || learner.startDate)}</p><p className="mt-0.5 text-[11px] text-foreground-500">to {displayDate(record?.practicalEndDate || learner.learnerEndDate || learner.endDate)}</p></td>
                  <td className="whitespace-nowrap px-4 py-3 text-foreground-700">{record?.reviewedAt ? displayDate(record.reviewedAt.slice(0, 10)) : "Not reviewed"}</td>
                  <td className="whitespace-nowrap px-4 py-3"><span className={record?.reviewedBy ? "font-semibold text-emerald-700" : "font-semibold text-foreground-800"}>{record?.reviewedBy ? "Reviewed" : "Awaiting review"}</span></td>
                  <td className="whitespace-nowrap px-4 py-3"><button type="button" className="font-semibold text-primary-700 hover:text-primary-900" onClick={(event) => { event.stopPropagation(); setSelectedId(row.key); }}>View details →</button></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        {filteredRows.length === 0 ? <p className="px-4 py-8 text-center text-[12px] text-foreground-500">No learners match the selected filters.</p> : null}
      </section>

      {selected ? <div className={styles.learnerOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}>
        <section ref={learnerDialog} className={styles.learnerDialog} role="dialog" aria-modal="true" aria-labelledby="deep-dive-learner-title">
          <header className={styles.dialogHeader}>
            <div className={styles.learnerIdentity}><div className={styles.learnerAvatar} aria-hidden="true">{selected.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("")}</div><div><p className={styles.eyebrow}>Learner details</p><h2 id="deep-dive-learner-title">{selected.name}</h2><p className={styles.programmeName}>{programmeLabel(selected)}</p></div></div>
            <div className={styles.headerActions}><span className={`${styles.reviewBadge} ${selectedRecordSummary?.reviewedBy ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{selectedRecordSummary?.reviewedBy ? <CheckCircle2 size={14} aria-hidden="true" /> : <Clock3 size={14} aria-hidden="true" />}{selectedRecordSummary?.reviewedBy ? "Reviewed" : "Awaiting review"}</span><button type="button" aria-label="Close learner details" className={styles.closeButton} onClick={() => setSelectedId(null)}><X size={18} aria-hidden="true" /></button></div>
          </header>
          <div className={styles.dialogBody}>
            <div className={styles.learnerOverview}><div className="rounded-lg bg-background-100 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-500">Status</p><p className="mt-1 text-[12px] font-semibold text-foreground-900">{selected.programmeStatus || "Not recorded"}</p></div><div className="rounded-lg bg-background-100 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-500">Coach</p><p className="mt-1 text-[12px] text-foreground-800">{selectedBoard?.user.owner || selected.coachName || "Not recorded"}</p></div><div className="rounded-lg bg-background-100 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-500">Start</p><p className="mt-1 text-[12px] text-foreground-800">{displayDate(selectedRecord?.startDate || selectedBoard?.programme.learnerStartDate || selected.learnerStartDate || selected.startDate)}</p></div><div className="rounded-lg bg-background-100 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-500">Practical end</p><p className="mt-1 text-[12px] text-foreground-800">{displayDate(selectedRecord?.practicalEndDate || selectedBoard?.programme.learnerEndDate || selected.learnerEndDate || selected.endDate)}</p></div></div>
            {selectedRecord && (operational?.plr || operational?.declarations) ? <section className={styles.complianceCard}><h3 className="font-heading text-[14px] font-semibold text-foreground-900">Compliance checks</h3><dl className="mt-2 grid gap-2 text-[12px] sm:grid-cols-2"><div className="flex justify-between gap-3"><dt className="text-foreground-500">PLR records</dt><dd className="text-right text-foreground-800">{operational?.plr?.records ?? "Not recorded"}</dd></div><div className="flex justify-between gap-3"><dt className="text-foreground-500">Declaration / exemptions</dt><dd className="text-right text-foreground-800">{operational?.declarations ? "Recorded" : "Not recorded"}</dd></div></dl></section> : null}
            {selectedRecord ? <EditableOperationalSnapshot operational={operational} open={operationalOpen} onToggle={() => setOperationalOpen((value) => !value)} onSave={saveOperational} /> : null}
            {selectedRecord && !editing ? <section className={styles.notesCard}><div className="flex items-center justify-between gap-3"><h3 className="font-heading text-[14px] font-semibold text-foreground-900">Notes</h3>{!notesEditing ? <button type="button" className="rounded-md border border-primary-200 bg-background-50 px-2.5 py-1.5 text-[11px] font-semibold text-primary-700 hover:bg-primary-50" onClick={() => setNotesEditing(true)}>Edit notes</button> : null}</div>{notesEditing ? <div className="mt-3"><textarea value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} rows={6} placeholder="Write notes for this learner…" className="w-full resize-y rounded-lg border border-background-300 bg-background-50 px-3 py-2.5 text-[12px] leading-relaxed text-foreground-900 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />{editError ? <p role="alert" className="mt-2 text-[11px] text-red-700">{editError}</p> : null}<div className="mt-3 flex justify-end gap-2"><button type="button" className="rounded-md border border-background-300 px-3 py-1.5 text-[11px] font-semibold text-foreground-700 hover:bg-background-100" onClick={() => { setNotesDraft(selectedRecord.notes); setNotesEditing(false); setEditError(""); }}>Cancel</button><button type="button" disabled={savingNotes} className="rounded-md bg-primary-600 px-3 py-1.5 text-[11px] font-semibold text-background-50 hover:bg-primary-700 disabled:opacity-60" onClick={() => void saveNotes()}>{savingNotes ? "Saving…" : "Save notes"}</button></div></div> : <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-foreground-700">{selectedRecord.notes || "No notes recorded."}</p>}</section> : null}
            {editing && selectedRecord ? <section className="rounded-xl border border-primary-100 bg-primary-50/40 p-4"><label className="text-[11px] font-medium text-foreground-700">Notes<textarea value={editValues.notes} onChange={(event) => setEditValues((current) => ({ ...current, notes: event.target.value }))} rows={5} placeholder="Add operational notes for this learner…" className="mt-1.5 w-full resize-y rounded-md border border-background-300 bg-background-50 px-3 py-2 text-[12px] text-foreground-900 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" /></label></section> : null}
            {detailLoading ? <div  className="rounded-lg bg-background-100 px-4 py-5 text-[12px] text-foreground-600"><LoadingSkeleton label={"Loading learner details…"} /></div> : null}
            {detailError ? <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-950">{detailError}</div> : null}
            {recordDetailLoading ? <div role="status" className="rounded-lg bg-background-100 px-4 py-5 text-[12px] text-foreground-600">Loading Deep Dive details…</div> : null}
            {recordDetailError ? <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-950">{recordDetailError}<button type="button" className="ml-3 font-semibold underline" onClick={() => setRecordRetry((value) => value + 1)}>Retry</button></div> : null}

            <div className={styles.detailsGrid}><div><h3 className="font-heading text-[14px] font-semibold text-foreground-900">Contact & ownership</h3><dl className="mt-2 space-y-2 text-[12px]"><div className="flex justify-between gap-3 border-b border-background-100 pb-2"><dt className="text-foreground-500">Email</dt><dd className="text-right text-foreground-800">{selectedBoard?.contact.email || selected.email || "Not recorded"}</dd></div>{selectedRecordSummary ? <IlrContactFields key={selectedRecordSummary.id} recordId={selectedRecordSummary.id} /> : null}<div className="flex justify-between gap-3 border-b border-background-100 pb-2"><dt className="text-foreground-500">Qualification / level</dt><dd className="text-right text-foreground-800">{[selectedRecord?.qualification, selectedRecord?.level].filter(Boolean).join(" · ") || "Not recorded"}</dd></div></dl></div><div><h3 className="font-heading text-[14px] font-semibold text-foreground-900">Gateway / EPA</h3><dl className="mt-2 space-y-2 text-[12px]"><div className="flex justify-between gap-3 border-b border-background-100 pb-2"><dt className="text-foreground-500">Apprenticeship end</dt><dd className="text-right text-foreground-800">{displayDate(selectedRecord?.apprenticeshipEndDate)}</dd></div><div className="flex justify-between gap-3 border-b border-background-100 pb-2"><dt className="text-foreground-500">Planned Gateway</dt><dd className="text-right text-foreground-800">{displayDate(selectedRecord?.plannedGatewayDate)}</dd></div><div className="flex justify-between gap-3 border-b border-background-100 pb-2"><dt className="text-foreground-500">Planned EPA</dt><dd className="text-right text-foreground-800">{displayDate(selectedRecord?.plannedEpaDate)}</dd></div></dl></div><div><h3 className="font-heading text-[14px] font-semibold text-foreground-900">Review ownership</h3><dl className="mt-2 text-[12px]"><div className="flex justify-between gap-3 border-b border-background-100 pb-2"><dt className="text-foreground-500">Reviewed by</dt><dd className="text-right text-foreground-800">{selectedRecord?.reviewedBy || "Not recorded"}</dd></div><div className="flex justify-between gap-3 border-b border-background-100 pb-2"><dt className="text-foreground-500">Reviewed at</dt><dd className="text-right text-foreground-800">{displayDate(selectedRecord?.reviewedAt?.slice(0, 10))}</dd></div></dl></div></div>
            {editing && selectedRecord ? <div className="rounded-xl border border-primary-100 bg-primary-50/40 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-heading text-[14px] font-semibold text-foreground-900">Edit Deep Dive details</h3><p className="mt-1 text-[11px] text-foreground-600">These values are saved to the imported Deep Dive record and do not overwrite the LMS learner profile.</p></div><span className="text-[10px] text-foreground-500">v{selectedRecord.version}</span></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-[11px] font-medium text-foreground-700">Full name<input value={editValues.fullName} onChange={(event) => setEditValues((current) => ({ ...current, fullName: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-background-300 bg-background-50 px-2.5 text-[12px]" /></label><label className="text-[11px] font-medium text-foreground-700">ULN<input value={editValues.uln} onChange={(event) => setEditValues((current) => ({ ...current, uln: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-background-300 bg-background-50 px-2.5 text-[12px]" /></label><label className="text-[11px] font-medium text-foreground-700">Qualification<input value={editValues.qualification} onChange={(event) => setEditValues((current) => ({ ...current, qualification: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-background-300 bg-background-50 px-2.5 text-[12px]" /></label><label className="text-[11px] font-medium text-foreground-700">Level<input value={editValues.level} onChange={(event) => setEditValues((current) => ({ ...current, level: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-background-300 bg-background-50 px-2.5 text-[12px]" /></label><label className="text-[11px] font-medium text-foreground-700">Start date<input type="date" value={editValues.startDate} onChange={(event) => setEditValues((current) => ({ ...current, startDate: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-background-300 bg-background-50 px-2.5 text-[12px]" /></label><label className="text-[11px] font-medium text-foreground-700">Practical end date<input type="date" value={editValues.practicalEndDate} onChange={(event) => setEditValues((current) => ({ ...current, practicalEndDate: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-background-300 bg-background-50 px-2.5 text-[12px]" /></label><label className="text-[11px] font-medium text-foreground-700">Planned Gateway<input type="date" value={editValues.plannedGatewayDate} onChange={(event) => setEditValues((current) => ({ ...current, plannedGatewayDate: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-background-300 bg-background-50 px-2.5 text-[12px]" /></label><label className="text-[11px] font-medium text-foreground-700">Planned EPA<input type="date" value={editValues.plannedEpaDate} onChange={(event) => setEditValues((current) => ({ ...current, plannedEpaDate: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-background-300 bg-background-50 px-2.5 text-[12px]" /></label><label className="text-[11px] font-medium text-foreground-700">Reviewed by<input value={editValues.reviewedBy} onChange={(event) => setEditValues((current) => ({ ...current, reviewedBy: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-background-300 bg-background-50 px-2.5 text-[12px]" /></label></div>{editError ? <p role="alert" className="mt-3 text-[11px] text-red-700">{editError}</p> : null}<div className="mt-3 flex justify-end"><button type="button" disabled={savingEdit} onClick={() => void saveDeepDiveEdit()} className="rounded-md bg-primary-600 px-3 py-2 text-[11px] font-semibold text-background-50 disabled:opacity-60">{savingEdit ? "Saving…" : "Save changes"}</button></div></div> : null}
            <div className={styles.milestonesCard}><h3 className="font-heading text-[14px] font-semibold text-foreground-900">Programme milestones</h3>{selectedBoard?.milestones?.length ? <div className="mt-2 space-y-2">{selectedBoard.milestones.slice(0, 8).map((milestone) => <div key={milestone.id} className="flex flex-col gap-1 rounded-lg border border-background-200 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[12px] font-semibold text-foreground-800">{milestone.description || "Milestone"}</p><p className="text-[11px] text-foreground-500">{milestone.programme || programmeLabel(selected)}</p></div><span className="text-[11px] text-foreground-600">{displayDate(milestone.date)} · {milestone.status || "Not recorded"}</span></div>)}</div> : <p className="mt-2 text-[12px] text-foreground-500">No milestones are recorded on this learner board.</p>}</div>
          </div>
          {selectedRecord ? <footer className={styles.dialogFooter}><span className={styles.footerHint}><ShieldCheck size={16} aria-hidden="true" />Learner review</span><div className={styles.footerButtons}><button type="button" className={styles.secondaryButton} onClick={() => setEditing((value) => !value)}>{editing ? "Cancel edit" : "Edit details"}</button><button type="button" disabled={Boolean(selectedRecord.reviewedBy) || markingReviewed} className={`${styles.primaryButton} ${selectedRecord.reviewedBy ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "bg-primary-600 text-background-50 hover:bg-primary-700 disabled:opacity-60"}`} onClick={() => void markSelectedReviewed()}>{selectedRecord.reviewedBy ? "Reviewed" : markingReviewed ? "Marking…" : "Mark reviewed"}</button></div></footer> : null}
        </section>
      </div> : null}
    </div>
  );
}
