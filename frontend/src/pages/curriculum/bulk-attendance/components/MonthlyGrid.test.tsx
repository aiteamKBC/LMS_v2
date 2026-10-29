import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import MonthlyGrid from "./MonthlyGrid";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  kbcRead: vi.fn(),
  save: vi.fn(),
  kbcSave: vi.fn(),
}));

vi.mock("@/api/bulkAttendanceLearners", () => ({
  fetchBulkAttendanceLiveMonthRecords: mocks.read,
  fetchBulkAttendanceKbcMonthRecords: mocks.kbcRead,
  createBulkAttendanceLiveDay: mocks.save,
  saveBulkAttendanceChanges: mocks.kbcSave,
}));

const row = {
  learner: {
    id: "kbc:301", kbcId: "301", name: "Alex Example", email: "alex@example.invalid",
    programmeId: "P1", cohortId: "C1", groupId: "G1", endDate: "2099-01-01",
  },
  index: 0,
  groupName: "Group A",
  cohortName: "Autumn",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue({
    occurrences: [
      { id: "occ-1", date: "2026-10-17", sessionNumber: 1, moduleCatalogueId: "MC1", moduleTitle: "Module A" },
      { id: "occ-2", date: "2026-10-17", sessionNumber: 2, moduleCatalogueId: "MC1", moduleTitle: "Module A" },
    ],
    records: [],
  });
  mocks.kbcRead.mockResolvedValue([]);
  mocks.kbcSave.mockResolvedValue([]);
});

it("keeps only unsaved lectures pending after a partial monthly save", async () => {
  mocks.save.mockResolvedValueOnce({ created: 1, updated: 0 })
    .mockRejectedValueOnce(new Error("Second lecture was not saved"))
    .mockResolvedValue({ created: 1, updated: 0 });
  const onSaved = vi.fn();
  render(<MonthlyGrid rows={[row]} lectures={[]} moduleCatalogueId="MC1" date="2026-10-17"
    active loading={false} onSaved={onSaved} />);

  fireEvent.click(await screen.findByRole("button", { name: "Alex Example 2026-10-17 Lecture 1 · Module A unmarked" }));
  fireEvent.click(screen.getByRole("button", { name: "Alex Example 2026-10-17 Lecture 2 · Module A unmarked" }));
  fireEvent.click(within(screen.getByRole("region", { name: "Unsaved monthly attendance" }))
    .getByRole("button", { name: "Save changes" }));

  expect(await screen.findByText("Second lecture was not saved")).toBeVisible();
  expect(within(screen.getByRole("region", { name: "Unsaved monthly attendance" }))
    .getByText("1 monthly attendance changes not saved")).toBeVisible();
  expect(mocks.save).toHaveBeenNthCalledWith(1, {
    learnerIds: ["301"], moduleCatalogueId: "MC1", date: "2026-10-17",
    occurrenceId: "occ-1", attendance: "present",
  });
  expect(onSaved).toHaveBeenCalledTimes(1);

  fireEvent.click(within(screen.getByRole("region", { name: "Unsaved monthly attendance" }))
    .getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Unsaved monthly attendance" })).not.toBeInTheDocument());
  expect(mocks.save).toHaveBeenNthCalledWith(3, {
    learnerIds: ["301"], moduleCatalogueId: "MC1", date: "2026-10-17",
    occurrenceId: "occ-2", attendance: "present",
  });
});

it("shows and saves a KBC attendance lecture in the monthly calendar", async () => {
  mocks.read.mockResolvedValue({ occurrences: [], records: [] });
  mocks.kbcRead.mockResolvedValue([{
    recordKey: "kbc-1", learnerId: "301", sessionDate: "2026-10-12",
    moduleName: "Project Controls", lectureName: "Lecture 1", sessionNumber: 1,
    attendance: "absent", source: "kbc",
  }]);
  mocks.kbcSave.mockResolvedValue(["kbc-1"]);
  render(<MonthlyGrid rows={[row]} lectures={[]} moduleCatalogueId="MC1" date="2026-10-17"
    active loading={false} onSaved={vi.fn()} />);

  const lecture = await screen.findByRole("button", { name: "Alex Example 2026-10-12 Lecture 1 absent" });
  fireEvent.click(lecture);
  fireEvent.click(within(screen.getByRole("region", { name: "Unsaved monthly attendance" }))
    .getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(mocks.kbcSave).toHaveBeenCalledWith([{
    source: "kbc", recordKey: "kbc-1", attendance: "present",
  }]));
  expect(await screen.findByRole("button", { name: "Alex Example 2026-10-12 Lecture 1 present" })).toBeVisible();
});

it("keeps a saved live-register row visible when its old schedule no longer resolves", async () => {
  mocks.read.mockResolvedValue({ occurrences: [], records: [] });
  mocks.kbcRead.mockResolvedValue([{
    recordKey: "live:77", learnerId: "301", sessionDate: "2026-10-16",
    moduleName: "AI in Project Controls", lectureName: "Session 4", sessionNumber: 4,
    attendance: "present", source: "live",
  }]);
  mocks.kbcSave.mockResolvedValue(["live:77"]);
  render(<MonthlyGrid rows={[row]} lectures={[]} moduleCatalogueId="MC1" date="2026-10-17"
    active loading={false} onSaved={vi.fn()} />);

  const lecture = await screen.findByRole("button", { name: "Alex Example 2026-10-16 Session 4 present" });
  fireEvent.click(lecture);
  fireEvent.click(within(screen.getByRole("region", { name: "Unsaved monthly attendance" }))
    .getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(mocks.kbcSave).toHaveBeenCalledWith([{
    source: "live", recordKey: "live:77", attendance: "absent",
  }]));
});

it("limits the monthly days to the selected lecture filter", async () => {
  mocks.read.mockResolvedValue({
    occurrences: [
      { id: "occ-1", date: "2026-10-17", sessionNumber: 1, moduleCatalogueId: "MC1", moduleTitle: "Module A" },
      { id: "occ-2", date: "2026-10-18", sessionNumber: 2, moduleCatalogueId: "MC1", moduleTitle: "Module A" },
    ],
    records: [],
  });
  render(<MonthlyGrid rows={[row]} lectures={[]} moduleCatalogueId="MC1"
    selectedLecture={{ id: "lecture-2", name: "Lecture 2", sessionNumber: 2, moduleId: "MC1", moduleCatalogueId: "MC1", sessionDate: "2026-10-18" }}
    date="2026-10-17" active loading={false} onSaved={vi.fn()} />);

  expect(await screen.findByRole("button", { name: "Alex Example 2026-10-18 Lecture 2 · Module A unmarked" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /2026-10-17/ })).not.toBeInTheDocument();
});

it("shows only the module's weekly pattern, hiding one-off live sessions", async () => {
  mocks.read.mockResolvedValue({
    occurrences: [
      { id: "occ-2", date: "2026-10-06", sessionNumber: 2, moduleCatalogueId: "MC1", moduleTitle: "Module A" },
    ],
    records: [{ recordKey: "live:12", occurrenceId: "occ-2", moduleCatalogueId: "MC1", learnerId: "301", attendance: "present" }],
  });
  mocks.kbcRead.mockResolvedValue([
    {
      recordKey: "live:11", learnerId: "301", sessionDate: "2026-10-02",
      moduleName: "Master Class", lectureName: "Master Class Session 1", sessionNumber: 1,
      attendance: "absent", source: "live",
    },
    {
      recordKey: "live:12", learnerId: "301", sessionDate: "2026-10-06",
      moduleName: "Module A", lectureName: "Module A Session 2", sessionNumber: 2,
      attendance: "present", source: "live",
    },
  ]);
  render(<MonthlyGrid rows={[row]} lectures={[]} moduleCatalogueId="MC1" date="2026-10-17"
    active loading={false} onSaved={vi.fn()} />);

  expect(await screen.findByRole("button", { name: "Alex Example 2026-10-06 Lecture 2 · Module A present" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /2026-10-02/ })).not.toBeInTheDocument();
});

it("shows every lecture day of the month for every learner", async () => {
  const other = {
    ...row,
    index: 1,
    learner: { ...row.learner, id: "kbc:302", kbcId: "302", name: "Sam Sample", email: "sam@example.invalid" },
  };
  mocks.read.mockResolvedValue({ occurrences: [], records: [] });
  mocks.kbcRead.mockResolvedValue([
    { recordKey: "live:1", learnerId: "301", sessionDate: "2026-10-09", moduleName: "Risk", lectureName: "Risk Session 1", sessionNumber: 1, attendance: "present", source: "live" },
    { recordKey: "live:2", learnerId: "302", sessionDate: "2026-10-09", moduleName: "Risk", lectureName: "Risk Session 1", sessionNumber: 1, attendance: "absent", source: "live" },
    { recordKey: "live:3", learnerId: "301", sessionDate: "2026-10-16", moduleName: "Risk", lectureName: "Risk Session 2", sessionNumber: 2, attendance: "absent", source: "live" },
  ]);
  render(<MonthlyGrid rows={[row, other]} lectures={[]} moduleCatalogueId="" groupId="G1" date="2026-10-17"
    active loading={false} onSaved={vi.fn()} />);

  expect(await screen.findByRole("button", { name: "Alex Example 2026-10-09 Risk Session 1 present" })).toBeVisible();
  // One square per learner per day, not one per other learner's record.
  expect(screen.getAllByRole("button", { name: /^Alex Example 2026-10-09/ })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Sam Sample 2026-10-09 Risk Session 1 absent" })).toBeVisible();
  // The 16th is a lecture day for the whole selection: Sam has nothing saved,
  // so the day shows as unmarked (not editable) and counts in Sam's rate.
  expect(screen.queryByRole("button", { name: /^Sam Sample 2026-10-16/ })).not.toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Sam Sample 2026-10-16 no saved attendance unmarked" })).toBeVisible();
  expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Learner", "Fri9", "Fri16", "Month"]);
  const alexRow = screen.getByText("Alex Example").closest("tr")!;
  expect(within(alexRow).getByText("50%")).toBeVisible();
  const samRow = screen.getByText("Sam Sample").closest("tr")!;
  expect(within(samRow).getByText("0%")).toBeVisible();
});
