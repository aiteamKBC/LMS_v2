import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Learner } from "@/types/bulkAttendance";
import LearnerHistoryModal, { type LearnerHistoryRecord } from "./LearnerHistoryModal";

const learner = { id: "learner-1", name: "Example Learner", email: "example@example.invalid" } as Learner;
const history: LearnerHistoryRecord[] = [
  {
    id: "original", source: "live", recordKey: "live:1", occurrenceId: "six",
    sessionDate: "2026-10-06", moduleName: "Marketing", lectureName: "Session 1",
    attendance: "absent", effectiveAttendance: "present", recoveryOccurrenceId: "nine",
  },
  {
    id: "guest", source: "live", recordKey: "live:2", occurrenceId: "nine",
    sessionDate: "2026-10-09", moduleName: "Marketing", lectureName: "Session 1",
    attendance: "present", makeupForOccurrenceId: "six", makeupForDate: "2026-10-06",
    countsAsSession: false,
  },
];

function show(pendingStatus?: (source: "live" | "kbc", recordKey: string) => "present" | "absent" | undefined) {
  render(<LearnerHistoryModal learner={learner} index={0} moduleLabel="Marketing" cohortName="Example"
    history={history} loading={false} error={null} pendingStatus={pendingStatus}
    onToggleRecord={vi.fn()} onClose={vi.fn()} />);
}

it("shows the original date attended and counts a parallel-group make-up once", () => {
  show();
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("1 session")).toBeVisible();
  expect(within(dialog).getByText("Present", { selector: "p" }).parentElement).toHaveTextContent("1");
  expect(within(dialog).getByText("Absent", { selector: "p" }).parentElement).toHaveTextContent("0");
  expect(within(dialog).getByText("Rate").parentElement).toHaveTextContent("100%");
  expect(within(dialog).getByText(/Make-up evidence for/)).toBeVisible();
  expect(within(dialog).getByText("Attended through a parallel group session")).toBeVisible();
});

it("removes the projected credit while the guest attendance is changed to absent", () => {
  show((_source, key) => key === "live:2" ? "absent" : undefined);
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Present", { selector: "p" }).parentElement).toHaveTextContent("0");
  expect(within(dialog).getByText("Absent", { selector: "p" }).parentElement).toHaveTextContent("1");
  expect(within(dialog).getByText("Rate").parentElement).toHaveTextContent("0%");
  expect(within(dialog).getByText(/Parallel-group record for/)).toBeVisible();
});
