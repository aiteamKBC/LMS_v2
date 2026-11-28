import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AttendanceTable from "./AttendanceTable";
import HighlightsTab from "./HighlightsTab";
import { HIGHLIGHTS_STORAGE_KEY, useLearnerHighlights } from "./highlights";

const row = (kbcId: string, name: string, index: number) => ({
  learner: {
    id: "kbc:" + kbcId, kbcId, name, email: name.split(" ")[0].toLowerCase() + "@example.invalid",
    programmeId: "P1", cohortId: "C1", groupId: "G1", endDate: "2099-01-01",
  },
  index,
  groupName: "Group A",
  cohortName: "Autumn",
});

const rows = [row("301", "Alex Example", 0), row("302", "Sam Sample", 1)];

function Tab() {
  const { highlights, setHighlight } = useLearnerHighlights();
  return <HighlightsTab rows={rows} loading={false} highlights={highlights} onHighlightChange={setHighlight} />;
}

function Daily() {
  const { highlights, setHighlight } = useLearnerHighlights();
  return (
    <AttendanceTable
      rows={rows} loading={false} selectedIds={[]} lectureInfo={{}}
      onToggleSelect={vi.fn()} onToggleSelectAll={vi.fn()} onOpenHistory={vi.fn()}
      highlights={highlights} onHighlightChange={setHighlight}
    />
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

it("highlights a learner with a colour and reason and keeps it in this browser", () => {
  const { unmount } = render(<Tab />);

  const reason = screen.getByRole("textbox", { name: "Highlight reason for Sam Sample" });
  expect(reason).toBeDisabled();
  fireEvent.click(within(screen.getByRole("group", { name: "Highlight colour for Sam Sample" }))
    .getByRole("button", { name: "Recorded Sessions" }));
  fireEvent.change(reason, { target: { value: "Low attendance - chase" } });

  expect(screen.getByText("1 of 2 learners highlighted · Saved automatically in this browser only")).toBeVisible();
  expect(within(screen.getByRole("group", { name: "Highlight colours" })).getByText("Pink – Recorded Sessions (1)")).toBeVisible();
  const stored = JSON.parse(window.localStorage.getItem(HIGHLIGHTS_STORAGE_KEY) || "{}");
  expect(stored["302"]).toMatchObject({ color: "pink", note: "Low attendance - chase" });
  unmount();

  render(<Tab />);
  expect(screen.getByRole("textbox", { name: "Highlight reason for Sam Sample" })).toHaveValue("Low attendance - chase");
});

it("filters by highlight category and removes a highlight", () => {
  window.localStorage.setItem(HIGHLIGHTS_STORAGE_KEY, JSON.stringify({
    "301": { color: "green", note: "Back in January", updatedAt: "2026-10-26T00:00:00.000Z" },
    "302": { color: "blue", note: "", updatedAt: "2026-10-26T00:00:00.000Z" },
  }));
  render(<Tab />);
  const show = screen.getByRole("combobox", { name: "Show" });

  fireEvent.change(show, { target: { value: "green" } });
  expect(screen.getByText("Alex Example")).toBeVisible();
  expect(screen.queryByText("Sam Sample")).not.toBeInTheDocument();
  fireEvent.change(show, { target: { value: "blue" } });
  expect(screen.getByText("Sam Sample")).toBeVisible();
  expect(screen.queryByText("Alex Example")).not.toBeInTheDocument();

  fireEvent.change(show, { target: { value: "green" } });

  fireEvent.click(screen.getByRole("button", { name: "Remove highlight for Alex Example" }));
  expect(screen.getByText("No highlighted learners match these filters.")).toBeVisible();
  expect(Object.keys(JSON.parse(window.localStorage.getItem(HIGHLIGHTS_STORAGE_KEY) || "{}"))).toEqual(["302"]);
});

it("drops highlights saved with a colour that is no longer a category", () => {
  window.localStorage.setItem(HIGHLIGHTS_STORAGE_KEY, JSON.stringify({
    "301": { color: "red", note: "Old", updatedAt: "2026-10-26T00:00:00.000Z" },
  }));
  render(<Tab />);
  expect(screen.getByText("0 of 2 learners highlighted · Saved automatically in this browser only")).toBeVisible();
});

it("ignores unreadable stored highlights", () => {
  window.localStorage.setItem(HIGHLIGHTS_STORAGE_KEY, "not json");
  render(<Tab />);
  expect(screen.getByText("0 of 2 learners highlighted · Saved automatically in this browser only")).toBeVisible();
});

it("highlights from the Daily row action and shares the saved highlight", () => {
  const { unmount } = render(<Daily />);

  const action = screen.getByRole("button", { name: "Highlight Alex Example" });
  expect(action).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(action);
  fireEvent.click(within(screen.getByRole("group", { name: "Highlight colour for Alex Example" }))
    .getByRole("button", { name: "On Break" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Highlight reason for Alex Example" }),
    { target: { value: "Needs catch-up" } });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));

  expect(screen.queryByRole("group", { name: "Highlight colour for Alex Example" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Highlight Alex Example" })).toHaveAttribute("title", "Needs catch-up");
  unmount();

  render(<Tab />);
  expect(screen.getByRole("textbox", { name: "Highlight reason for Alex Example" })).toHaveValue("Needs catch-up");
});
