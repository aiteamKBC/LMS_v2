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
  activity_date: string | null;
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
    activity_date: row.activity_date,
    planned_hours: row.planned_hours,
    actual_hours: row.actual_hours,
    timestamp_label: row.timestamp_label,
    completion_note: row.completion_note,
    accepted: row.accepted,
    documents: row.documents ?? [],
    stagedFiles: [],
    deletedDocIds: [],
    duration_minutes: null,
  };
}

export type DraftPatch = Partial<Pick<DraftRow,
  "title" | "activity_date" | "planned_hours" | "actual_hours" | "timestamp_label" | "accepted"
>>;

export function patchDraftRow(rows: DraftRow[], key: string, patch: DraftPatch): DraftRow[] {
  return rows.map((row) => {
    if (row.key !== key) return row;
    const next = { ...row, ...patch };
    if (next.state === "clean") next.state = "edited";
    return next;
  });
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
    planned_hours: row.planned_hours,
    actual_hours: row.actual_hours,
    timestamp_label: row.timestamp_label,
    accepted: row.accepted,
  };
}
