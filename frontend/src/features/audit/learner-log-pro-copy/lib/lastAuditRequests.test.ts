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
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/last-audit/cohort/"))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/last-audit/activities/"))).toBe(false);
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

    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("/last-audit/activities/"))).toHaveLength(1);
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
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/last-audit/cohort/"))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/last-audit/activities/"))).toBe(false);
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
    expect(String(fetchMock.mock.calls[0][0])).toContain("/last-audit/activity/?component_id=la%3A10%3A20");
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

    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ aptem_id: 1930 });
  });
});
