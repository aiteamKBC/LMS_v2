// The journal's client-side draft: nothing the employee does — retrieving,
// adding, editing, deleting, staging uploads — touches the server until the
// floating "Save all activities" button flushes the whole draft through
// /audit_api/last-audit/manual/rows/bulk.
import type { ManualCategory, ManualDocument, ManualRow, ManualRowPatch } from "./manualApi";

export type DraftState = "clean" | "new" | "edited" | "deleted";

export type DraftRow = {
  key: string;               // stable local identity (rows without a server id yet)
  serverId: number | null;
  state: DraftState;
  retrieved: boolean;        // came from "Retrieve LMS activities"
  aptem_id: number;
  month: string;
  category: ManualCategory;
  source_ref: string | null;
  title: string;
  // Display-only: the LMS course (group) / register module the row came from,
  // so overlapping-course rows are recognisable and deletable at a glance.
  source_course?: string | null;
  module?: string | null;
  activity_date: string | null;
  // The date this activity's own title names, when it contradicts activity_date.
  title_date?: string | null;
  // Assignments only: the submission clock time Aptem recorded (HH:MM).
  activity_time?: string | null;
  planned_hours: number;
  actual_hours: number;
  timestamp_label: string;
  completion_note: string | null;
  accepted: boolean;
  documents: ManualDocument[];
  stagedFiles: File[];       // uploaded only on save-all
  deletedDocIds: number[];   // existing documents removed on save-all
  // Display-only hint: the source media duration, kept on retrieved/added
  // rows so the employee still sees it when deciding the actual hours.
  duration_minutes?: number | null;
};

let draftCounter = 0;
export function nextDraftKey(): string {
  draftCounter += 1;
  return `draft-${draftCounter}`;
}

export function draftFromServer(row: ManualRow): DraftRow {
  return {
    key: `row-${row.id}`,
    serverId: row.id,
    state: "clean",
    retrieved: false,
    aptem_id: row.aptem_id,
    month: row.month,
    category: row.category,
    source_ref: row.source_ref,
    title: row.title,
    source_course: row.source_course ?? null,
    module: row.module ?? null,
    activity_date: row.activity_date,
    title_date: row.title_date ?? null,
    activity_time: row.activity_time ?? null,
    planned_hours: row.planned_hours,
    actual_hours: row.actual_hours,
    timestamp_label: row.timestamp_label,
    completion_note: row.completion_note,
    accepted: row.accepted,
    documents: row.documents ?? [],
    stagedFiles: [],
    deletedDocIds: [],
    duration_minutes: row.duration_minutes ?? null,
  };
}

// completion_note rides along for the badge only — the server derives the
// stored value from the hours, so rowPatchOf() never sends it.
export type DraftPatch = Partial<Pick<DraftRow,
  "title" | "activity_date" | "month" | "planned_hours" | "actual_hours"
  | "timestamp_label" | "accepted" | "completion_note"
>>;

export function patchDraftRow(rows: DraftRow[], key: string, patch: DraftPatch): DraftRow[] {
  return rows.map((row) => {
    if (row.key !== key) return row;
    const next = { ...row, ...patch };
    if (next.state === "clean") next.state = "edited";
    return next;
  });
}

/** Apply a parent lecture edit and keep all of its displayed components on the
 * same date/month. Other fields in the patch belong only to the parent. */
export function patchDraftRowWithLinkedDates(
  rows: DraftRow[],
  key: string,
  patch: DraftPatch,
  linkedKeys: readonly string[],
): DraftRow[] {
  let next = patchDraftRow(rows, key, patch);
  if (!Object.prototype.hasOwnProperty.call(patch, "activity_date")) return next;
  const parent = rows.find((row) => row.key === key);
  if (!parent) return next;
  const activityDate = patch.activity_date ?? null;
  const month = activityDate ? activityDate.slice(0, 7) : (patch.month ?? parent.month);
  for (const linkedKey of linkedKeys) {
    next = patchDraftRow(next, linkedKey, { activity_date: activityDate, month });
  }
  return next;
}

export function deleteDraftRow(rows: DraftRow[], key: string): DraftRow[] {
  return rows.flatMap((row) => {
    if (row.key !== key) return [row];
    // A row that never reached the server just vanishes from the draft.
    if (row.serverId == null) return [];
    return [{ ...row, state: "deleted" as DraftState }];
  });
}

export function stageFiles(rows: DraftRow[], key: string, files: File[]): DraftRow[] {
  return rows.map((row) => row.key === key ? { ...row, stagedFiles: [...row.stagedFiles, ...files] } : row);
}

export function unstageFile(rows: DraftRow[], key: string, index: number): DraftRow[] {
  return rows.map((row) => row.key === key
    ? { ...row, stagedFiles: row.stagedFiles.filter((_, i) => i !== index) }
    : row);
}

export function stageDocumentDelete(rows: DraftRow[], key: string, docId: number): DraftRow[] {
  return rows.map((row) => row.key === key && !row.deletedDocIds.includes(docId)
    ? { ...row, deletedDocIds: [...row.deletedDocIds, docId] }
    : row);
}

export function visibleDraftRows(rows: DraftRow[]): DraftRow[] {
  return rows.filter((row) => row.state !== "deleted");
}

export function isDraftDirty(rows: DraftRow[]): boolean {
  return rows.some((row) =>
    row.state !== "clean" || row.stagedFiles.length > 0 || row.deletedDocIds.length > 0,
  );
}

export function pendingChangeCount(rows: DraftRow[]): number {
  return rows.reduce((count, row) => {
    let changes = row.state === "clean" ? 0 : 1;
    changes += row.stagedFiles.length + row.deletedDocIds.length;
    return count + changes;
  }, 0);
}

export function rowPatchOf(row: DraftRow): ManualRowPatch {
  return {
    title: row.title,
    activity_date: row.activity_date,
    // A date edited onto another month moves the row there (the pair always
    // stays consistent — apply() derives month from the date).
    month: row.month,
    planned_hours: row.planned_hours,
    actual_hours: row.actual_hours,
    timestamp_label: row.timestamp_label,
    accepted: row.accepted,
  };
}

// --- Draft persistence -------------------------------------------------------
// The draft survives leaving the page or reloading: the journal mirrors every
// change into localStorage per (learner, month) and restores it over the fresh
// server rows when the employee comes back. Staged File objects cannot be
// serialised — their names are kept so the restore can ask for a re-attach.

const DRAFT_STORE_PREFIX = "llp-copy:journal-draft:v1";

type StoredDraftRow = Omit<DraftRow, "stagedFiles"> & { stagedFileNames: string[] };
type StoredDraft = { savedAt: string; rows: StoredDraftRow[] };

export function draftStorageKey(aptemId: number, month: string): string {
  return `${DRAFT_STORE_PREFIX}:${aptemId}:${month}`;
}

export function saveDraftToStorage(aptemId: number, month: string, rows: DraftRow[]): void {
  try {
    const payload: StoredDraft = {
      savedAt: new Date().toISOString(),
      rows: rows.map(({ stagedFiles, ...row }) => ({
        ...row,
        stagedFileNames: stagedFiles.map((file) => file.name),
      })),
    };
    window.localStorage.setItem(draftStorageKey(aptemId, month), JSON.stringify(payload));
  } catch {
    // Best-effort: a quota/privacy failure only loses the reload safety-net.
  }
}

export function clearStoredDraft(aptemId: number, month: string): void {
  try {
    window.localStorage.removeItem(draftStorageKey(aptemId, month));
  } catch {
    // Same best-effort contract as saveDraftToStorage.
  }
}

export type RestoredDraft = {
  rows: DraftRow[];
  savedAt: string;
  /** Staged uploads cannot survive a reload — these files need re-attaching. */
  lostFileNames: string[];
};

/**
 * Re-apply a stored draft on top of the fresh server rows. Server rows are the
 * base (new rows may have landed from the auto-import meanwhile); the stored
 * edits/deletes are laid over rows that still exist, and stored "new" rows are
 * appended. Returns null when nothing dirty survives — callers then seed the
 * plain server state.
 */
export function restoreDraftFromStorage(
  aptemId: number,
  month: string,
  serverRows: ManualRow[],
): RestoredDraft | null {
  let stored: StoredDraft | null = null;
  try {
    const raw = window.localStorage.getItem(draftStorageKey(aptemId, month));
    stored = raw ? (JSON.parse(raw) as StoredDraft) : null;
  } catch {
    stored = null;
  }
  if (!stored?.rows?.length) return null;

  const base = serverRows.map(draftFromServer);
  const byServerId = new Map(base.map((row) => [row.serverId, row]));
  const lostFileNames: string[] = [];
  let dirty = false;

  for (const storedRow of stored.rows) {
    const { stagedFileNames = [], ...restored } = storedRow;
    lostFileNames.push(...stagedFileNames);
    if (restored.serverId == null) {
      // A row that never reached the server — keep it, under a fresh local key
      // so it cannot collide with keys handed out after the reload.
      if (restored.state === "new") {
        base.push({ ...restored, key: nextDraftKey(), stagedFiles: [] });
        dirty = true;
      }
      continue;
    }
    const current = byServerId.get(restored.serverId);
    if (!current) continue; // the row is gone server-side — nothing to restore onto
    if (restored.state === "deleted") {
      current.state = "deleted";
      dirty = true;
      continue;
    }
    // Keep the server's documents (evidence may have been attached meanwhile);
    // only re-apply the employee's own edits and staged document removals.
    const docIds = new Set(current.documents.map((doc) => doc.id));
    current.deletedDocIds = restored.deletedDocIds.filter((id) => docIds.has(id));
    if (current.deletedDocIds.length) dirty = true;
    if (restored.state === "edited") {
      current.state = "edited";
      current.title = restored.title;
      current.month = restored.month;
      current.activity_date = restored.activity_date;
      current.planned_hours = restored.planned_hours;
      current.actual_hours = restored.actual_hours;
      current.timestamp_label = restored.timestamp_label;
      current.accepted = restored.accepted;
      dirty = true;
    }
  }
  if (!dirty) return null;
  return { rows: base, savedAt: stored.savedAt, lostFileNames };
}
