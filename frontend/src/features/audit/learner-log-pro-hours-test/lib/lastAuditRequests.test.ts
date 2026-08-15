import { beforeEach, describe, expect, it, vi } from "vitest";

const cohort = {
  source: "Last_audit",
  programmes: ["Programme KSBs"],
  learners: [{
    aptem_id: 1930,
    learner_name: "Abigail Rooney",
    learner_email: "abigail@aptem.example",
    coach_name: "Femi Falodun",
    coach_email: "femi@college.example",
    lms_id: 901,
    declared_lms_id: 901,
    lms_matched: true,
    programme: "Programme KSBs",
    programmes: ["Programme KSBs"],
    withdrawn: false,
    programme_status: "—",
    planned_total: 839,
    planned_hours_available: true,
    actual_total: 0,
    not_accepted_total: 0,
    hours_mapped: false,
    activity_count: 1,
    completed_count: 1,
    flags: ["hours_not_mapped"],
    months: [],
  }],
};

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Last_audit request scoping", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("does not fan out activity requests when no learner is selected", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(cohort));
    vi.stubGlobal("fetch", fetchMock);
    const { getLearnerActivities } = await import("./api");

    const result = await getLearnerActivities({ search: "", limit: 20, offset: 0 });

    expect(result.items).toEqual([]);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/hours_test_api/last-audit/cohort/"))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/hours_test_api/last-audit/activities/"))).toBe(false);
  });

  it("keeps Aptem identity and exposes the verified LMS match", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(cohort));
    vi.stubGlobal("fetch", fetchMock);
    const { getLearners } = await import("./api");

    const result = await getLearners();

    expect(result.learners[0]).toMatchObject({
      id: "1930",
      name: "Abigail Rooney",
      email: "abigail@aptem.example",
      lms_id: 901,
      declared_lms_id: 901,
      lms_matched: true,
      coach: { name: "Femi Falodun", email: "femi@college.example" },
      planned_hours: 839,
      planned_hours_available: true,
    });
  });

  it("removes excluded learners returned by the remote cohort service", async () => {
    const excluded = {
      ...cohort.learners[0],
      aptem_id: 9115,
      learner_name: "Celine Ababio",
      learner_email: "celine.ababio@newlon.org.uk",
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({ ...cohort, learners: [...cohort.learners, excluded] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getLearners } = await import("./api");

    const result = await getLearners();

    expect(result.learners.map((learner) => learner.name)).toEqual(["Abigail Rooney"]);
  });

  it("normalizes a quoted route learner and requests only that learner", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/cohort/")) return jsonResponse(cohort);
      return jsonResponse({
        source: "Last_audit",
        aptem_id: 1930,
        learner_name: "Abigail Rooney",
        count: 0,
        activities: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getLearnerActivities } = await import("./api");

    await getLearnerActivities({
      learner: '"1930"',
      period: "undated",
      search: "",
      limit: 20,
      offset: 0,
    });

    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("/hours_test_api/last-audit/activities/"))).toHaveLength(1);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("aptem_id=1930"))).toBe(true);
  });

  it("uses cohort aggregates without requesting every learner for a period", async () => {
    const datedCohort = {
      ...cohort,
      learners: cohort.learners.map((learner) => ({
        ...learner,
        months: [{
          month: "2026-08",
          label: "August 2026",
          planned: 0,
          actual: 0,
          not_accepted: 0,
          att_actual: 0,
          asg_actual: 0,
          media_actual: 0,
          bundle_actual: 0,
          unallocated_actual: 0,
        }],
      })),
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(datedCohort));
    vi.stubGlobal("fetch", fetchMock);
    const { getLearners } = await import("./api");

    const result = await getLearners({ period: "2026-08" });

    expect(result.learners[0].entries).toBe(1);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/hours_test_api/last-audit/cohort/"))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/hours_test_api/last-audit/activities/"))).toBe(false);
  });

  it("quarantines impossible source years as undated without changing their hours", async () => {
    const malformedCohort = {
      ...cohort,
      learners: cohort.learners.map((learner) => ({
        ...learner,
        months: [{
          month: "8202-08",
          label: "August 8202",
          planned: 0,
          actual: 1.3327,
          not_accepted: 0,
          att_actual: 0,
          asg_actual: 0,
          media_actual: 1.3327,
          bundle_actual: 0,
          unallocated_actual: 0,
        }],
      })),
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("activity-overrides")) return jsonResponse({ items: [] });
      return jsonResponse(malformedCohort);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getLearners } = await import("./api");

    const result = await getLearners({ learner: "1930", period: "undated" });

    expect(result.periods).toContainEqual({ value: "undated", label: "Undated LMS activities" });
    expect(result.periods.some((period) => period.value === "8202-08")).toBe(false);
    expect(result.learners[0]).toMatchObject({
      planned_hours: 0,
      actual_hours: 1.33,
      planned_hours_available: true,
    });
    expect(result.learners[0].flags).toContain("invalid_activity_date");
  });

  it("hides post-cutoff planned-only months but keeps pre-cutoff and active ones", async () => {
    const mixedCohort = {
      ...cohort,
      learners: cohort.learners.map((learner) => ({
        ...learner,
        months: [
          // pre-cutoff planned-only: kept (real past plan)
          { month: "2026-05", label: "May 2026", planned: 20, actual: 0, not_accepted: 0,
            att_actual: 0, asg_actual: 0, media_actual: 0, bundle_actual: 0, unallocated_actual: 0 },
          // post-cutoff WITH fetched actual: kept
          { month: "2026-09", label: "September 2026", planned: 24, actual: 12, not_accepted: 0,
            att_actual: 12, asg_actual: 0, media_actual: 0, bundle_actual: 0, unallocated_actual: 0 },
          // post-cutoff planned-only (preserved future Aptem plan): hidden
          { month: "2027-07", label: "July 2027", planned: 4, actual: 0, not_accepted: 0,
            att_actual: 0, asg_actual: 0, media_actual: 0, bundle_actual: 0, unallocated_actual: 0 },
        ],
      })),
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("activity-overrides")) return jsonResponse({ items: [] });
      return jsonResponse(mixedCohort);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getLearners } = await import("./api");

    const result = await getLearners({ learner: "1930" });
    const periodValues = result.learners[0].periods.map((period) => period.value);

    expect(periodValues).toContain("2026-05");
    expect(periodValues).toContain("2026-09");
    expect(periodValues).not.toContain("2027-07");
    // The cohort-wide period list drops the phantom future month too.
    expect(result.periods.some((period) => period.value === "2027-07")).toBe(false);
  });

  it("labels OTJH provenance as fetched after the cutoff and engineered before", async () => {
    const datedCohort = {
      ...cohort,
      learners: cohort.learners.map((learner) => ({
        ...learner,
        months: [
          { month: "2026-05", label: "May 2026", planned: 20, actual: 18, not_accepted: 0,
            att_actual: 18, asg_actual: 0, media_actual: 0, bundle_actual: 0, unallocated_actual: 0 },
          { month: "2026-09", label: "September 2026", planned: 24, actual: 21.26, not_accepted: 0,
            att_actual: 21.26, asg_actual: 0, media_actual: 0, bundle_actual: 0, unallocated_actual: 0 },
        ],
      })),
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("activity-overrides")) return jsonResponse({ items: [] });
      return jsonResponse(datedCohort);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getLearners } = await import("./api");

    const pre = await getLearners({ learner: "1930", period: "2026-05" });
    expect(pre.learners[0].otjh.month?.provenance).toBe("engineered");

    const post = await getLearners({ learner: "1930", period: "2026-09" });
    expect(post.learners[0].otjh.month?.provenance).toBe("fetched");
  });

  it("treats reading, quiz and reading+quiz as one filter family", async () => {
    const datedCohort = {
      ...cohort,
      learners: cohort.learners.map((learner) => ({
        ...learner,
        months: [{
          month: "2026-08", label: "August 2026", planned: 3, actual: 3,
          not_accepted: 0, att_actual: 0, asg_actual: 0,
          media_actual: 0, bundle_actual: 3, unallocated_actual: 0,
        }],
      })),
    };
    const activities = ["reading", "quiz", "reading+quiz", "video"].map((category, index) => ({
      activity_id: `la:10:${index}`,
      learner_id: 1930,
      learner_name: "Abigail Rooney",
      date: "2026-08-12",
      month: "2026-08",
      month_label: "August 2026",
      category,
      activity: `${category} activity`,
      planned: 1,
      actual: 1,
      timestamp_from: null,
      timestamp_to: null,
      timestamp_display: "Input",
      completed: true,
      ksbs: null,
      iframe_url: null,
      source: "Last_audit",
      hours_mapped: true,
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("activity-overrides")) return jsonResponse({ items: [] });
      if (url.includes("/activities/")) return jsonResponse({
        source: "Last_audit", aptem_id: 1930, learner_name: "Abigail Rooney",
        month: "2026-08", count: activities.length, activities,
      });
      return jsonResponse(datedCohort);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getLearnerActivities } = await import("./api");

    const result = await getLearnerActivities({
      learner: "1930",
      period: "2026-08",
      category: "reading+quiz",
      search: "",
      limit: 20,
      offset: 0,
    });

    expect(result.items.map((item) => item.activity_category)).toEqual([
      "reading", "quiz", "reading+quiz",
    ]);
  });

  it("loads an activity's participants with one set-based request", async () => {
    const detail = {
      source: "Last_audit",
      component_id: "la:10:20",
      activity: "Example activity",
      category: "video",
      participant_count: 1,
      completed_count: 1,
      items: [],
      item_count: 0,
      participants: [{
        learner_id: 99,
        learner_name: "Abigail Rooney",
        found_as: "video",
        activity: "Example activity",
        completed: true,
        actual: null,
        planned: null,
        month: null,
        date: null,
        timestamp_from: null,
        timestamp_to: null,
        timestamp_display: "",
        item_title: null,
      }],
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(detail));
    vi.stubGlobal("fetch", fetchMock);
    const { getActivityLearners } = await import("./api");

    const result = await getActivityLearners({ component: "la:10:20" });

    expect(result.total).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/hours_test_api/last-audit/activity/?activity_id=la%3A10%3A20");
  });

  it("loads the rich learner profile for every programme", async () => {
    const profile = {
      id: "1930",
      aptem_id: "1930",
      name: "Abigail Rooney",
      email: "abigail@aptem.example",
      programme: "Programme KSBs",
      programme_status: "Active",
      coach: { name: "Femi Falodun", email: "femi@college.example" },
      planned_hours: 300,
      learning_delivery: { planned_hours: 300 },
      contracts: [{ id: "1", document_name: "Training Plan", status: "Signed" }],
      training_plan: { total_modules: 2, completed_modules: 1, months: [] },
      skills_radar: [{ skill: "Communication", maximum: 8 }],
      certifications: [],
      employment: { employer_name: "Example Ltd" },
      programme_understanding: { understanding_programme: "Training" },
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(profile));
    vi.stubGlobal("fetch", fetchMock);
    const { getLearnerProfile } = await import("./api");

    const result = await getLearnerProfile('"1930"');

    expect(result.contracts).toHaveLength(1);
    expect(result.skills_radar).toHaveLength(1);
    expect(result.employment?.employer_name).toBe("Example Ltd");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/match-ledger/learner-profile?learner=1930");
  });

  it("stores Last_audit edits as reversible replacement overlays", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => jsonResponse({
      ok: true,
      activity_id: "la:10:20",
      payload: {},
      method: init?.method,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { updateActivityRow } = await import("./api");
    const row = {
      learner_id: 1930,
      learner: "Abigail Rooney",
      plan_id: "la:10:20",
      source: "Last_audit",
      activity_date: "2026-08-12",
      learner_activity_date: "2026-08-12",
      activity_category: "reading+quiz",
      activity_unit: "Governance",
      activity_description: null,
      planned_hours: 2,
      actual_lms_hours: 1.5,
      time_from: null,
      time_to: null,
      time_from_to: "input",
      completed: true,
      week: "Week 2",
    } as never;

    await updateActivityRow(row, {
      date: "2026-08-12",
      category: "reading+quiz",
      activity: "Governance updated",
      planned: 2,
      actual: 1.5,
      timestamp_display: "input",
      completed: true,
      reporting_week_label: "Week 2",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PUT");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      aptem_id: 1930,
      activity_id: "la:10:20",
    });
  });

  it("adds a monthly activity through the audit overlay", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, activity_id: "audit:new", payload: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const { createActivity } = await import("./api");

    await createActivity(1930, {
      date: "2026-08-13",
      category: "assignment",
      activity: "Added by auditor",
      planned: 1,
      actual: 0.5,
    });

    const request = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(request[1]?.method).toBe("POST");
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({ aptem_id: 1930 });
  });
});
