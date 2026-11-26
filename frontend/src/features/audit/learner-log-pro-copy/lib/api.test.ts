import { describe, expect, it } from "vitest";
import { applyCohortOverlay, normalizeActivityItem } from "./api";

const baseMonth = {
  month: "2026-07", label: "July 2026", planned: 10, actual: 8,
  not_accepted: 0, att_actual: 2, asg_actual: 2, media_actual: 2, bundle_actual: 2,
};
const cohort = {
  learners: [{
    aptem_id: 92, learner_name: "Test Learner", programme: "PCP", withdrawn: false,
    planned_total: 10, actual_total: 8, not_accepted_total: 0, flags: [], months: [baseMonth],
  }],
};

function activity(overrides: Record<string, unknown> = {}) {
  return {
    activity_id: "source:1", learner_id: 92, learner_name: "Test Learner",
    date: "2026-07-10", month: "2026-07", month_label: "July 2026",
    category: "assignment", activity: "Review", planned: 1, actual: 1.5,
    timestamp_from: null, timestamp_to: null, timestamp_display: "input",
    completed: true, ksbs: null, iframe_url: null, ...overrides,
  };
}

describe("audit-copy cohort overlay accounting", () => {
  it("adds an audit-created activity once", () => {
    const result = applyCohortOverlay(cohort as never, [{
      aptem_id: 92, activity_id: "audit:1", operation: "created",
      payload: activity({ activity_id: "audit:1" }), source_payload: null,
      updated_by: null, updated_at: null,
    }] as never);
    expect(result.learners[0].planned_total).toBe(11);
    expect(result.learners[0].actual_total).toBe(9.5);
    expect(result.learners[0].months[0].asg_actual).toBe(3.5);
  });

  it("does not subtract a deleted audit-created row from live totals", () => {
    const result = applyCohortOverlay(cohort as never, [{
      aptem_id: 92, activity_id: "audit:1", operation: "deleted",
      payload: activity({ activity_id: "audit:1" }), source_payload: null,
      updated_by: null, updated_at: null,
    }] as never);
    expect(result.learners[0].planned_total).toBe(10);
    expect(result.learners[0].actual_total).toBe(8);
  });

  it("moves replaced activity hours from the old date's month to the new month", () => {
    const source = activity();
    const replacement = activity({ date: "2026-08-10", month: "2026-08", month_label: "August 2026" });
    const result = applyCohortOverlay(cohort as never, [{
      aptem_id: 92, activity_id: "source:1", operation: "replaced",
      payload: replacement, source_payload: source, updated_by: null, updated_at: null,
    }] as never);
    expect(result.learners[0].planned_total).toBe(10);
    expect(result.learners[0].actual_total).toBe(8);
    expect(result.learners[0].months.find((month) => month.month === "2026-07")?.actual).toBe(6.5);
    expect(result.learners[0].months.find((month) => month.month === "2026-08")?.actual).toBe(1.5);
  });
});

describe("activity detail response normalization", () => {
  it("turns the live activity metadata object into a renderable label", () => {
    const item = normalizeActivityItem({
      component_id: 50560,
      title: "Project Framework Management",
      front_end_name: "Lecture 3: Business Environment (Quiz)",
      material_type: "quiz",
      iframe_url: "https://example.test/quiz",
      activity: {
        otjh: { hours: 0, credited: false },
        status: "passed",
        completed: true,
        content_type: "quiz",
        time_spent_seconds: 4968,
      },
    });

    expect(item.activity).toBe("Lecture 3: Business Environment (Quiz)");
    expect(item.material_type).toBe("quiz");
    expect(typeof item.activity).toBe("string");
  });
});
