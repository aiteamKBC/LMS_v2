import { describe, expect, it } from "vitest";

import { patchDraftRowWithLinkedDates, type DraftRow } from "./journalDraft";

function draft(key: string, category: DraftRow["category"]): DraftRow {
  return {
    key,
    serverId: Number(key.replace(/\D/g, "")) || null,
    state: "clean",
    retrieved: false,
    aptem_id: 1698,
    month: "2025-07",
    category,
    source_ref: null,
    title: key,
    activity_date: "2025-07-07",
    planned_hours: 0,
    actual_hours: 0,
    timestamp_label: "input",
    completion_note: "completed",
    accepted: true,
    documents: [],
    stagedFiles: [],
    deletedDocIds: [],
  };
}

describe("linked lecture date edits", () => {
  it("moves the parent and every linked audio/Q/R component together", () => {
    const rows = [
      draft("video1", "video"),
      draft("audio1", "audio"),
      draft("reading1", "reading+quiz"),
      draft("other2", "video"),
    ];

    const changed = patchDraftRowWithLinkedDates(
      rows,
      "video1",
      { activity_date: "2025-08-04", month: "2025-08", title: "Edited lecture" },
      ["audio1", "reading1"],
    );

    for (const key of ["video1", "audio1", "reading1"]) {
      expect(changed.find((row) => row.key === key)).toMatchObject({
        activity_date: "2025-08-04",
        month: "2025-08",
        state: "edited",
      });
    }
    expect(changed.find((row) => row.key === "video1")?.title).toBe("Edited lecture");
    expect(changed.find((row) => row.key === "audio1")?.title).toBe("audio1");
    expect(changed.find((row) => row.key === "other2")).toMatchObject({
      activity_date: "2025-07-07",
      month: "2025-07",
      state: "clean",
    });
  });

  it("does not cascade a parent edit that leaves the date untouched", () => {
    const rows = [draft("video1", "video"), draft("audio1", "audio")];
    const changed = patchDraftRowWithLinkedDates(rows, "video1", { title: "Renamed" }, ["audio1"]);

    expect(changed.find((row) => row.key === "video1")?.state).toBe("edited");
    expect(changed.find((row) => row.key === "audio1")?.state).toBe("clean");
  });
});
