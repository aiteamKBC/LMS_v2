import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideActualHours,
  formatRate,
  formatSeconds,
  getActualHoursSummary,
  proposeActualHours,
  runActualHoursValidation,
} from "./actualHoursApi";

type FetchInit = { headers?: Record<string, string>; body?: string };

const originalFetch = globalThis.fetch;

function mockJson(payload: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(payload),
  } as unknown as Response);
}

describe("actual hours api client", () => {
  beforeEach(() => {
    globalThis.fetch = mockJson({ ok: true }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("talks to the HOURS-TEST mount only, never /audit_api", async () => {
    const fetchMock = mockJson({ rows: [] });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await getActualHoursSummary(16456, "2026-01");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.startsWith("/hours_test_api/last-audit/actual-hours/")).toBe(true);
    expect(url).not.toContain("/audit_api/");
  });

  it("always sends both scope values", async () => {
    const fetchMock = mockJson({ rows: [] });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await getActualHoursSummary(16456, "2026-01");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("aptem_id=16456");
    expect(url).toContain("month=2026-01");
  });

  it("names the acting auditor in a header, never in the body", async () => {
    const fetchMock = mockJson({ ok: true, summary: {} });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await runActualHoursValidation(16456, "2026-01", "Auditor A");
    const init = fetchMock.mock.calls[0][1] as FetchInit;
    expect(init.headers?.["X-Audit-Actor"]).toBe("Auditor A");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ aptem_id: 16456, month: "2026-01" });
    expect(Object.keys(body)).not.toContain("actor");
  });

  it("sends proposals in canonical seconds with their scope", async () => {
    const fetchMock = mockJson({ ok: true, proposed_actual_hours: "0.4833" });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await proposeActualHours({
      aptemId: 16456, month: "2026-01", learnerId: 42, kind: "reading_quiz",
      ref: "9001", seconds: 1740, actor: "Auditor A",
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as FetchInit).body));
    expect(body).toMatchObject({
      aptem_id: 16456, month: "2026-01", learner_id: 42,
      kind: "reading_quiz", ref: "9001", proposed_seconds: 1740,
    });
  });

  it("surfaces the server's refusal instead of swallowing it", async () => {
    globalThis.fetch = mockJson(
      { error: "A proposal must be reviewed by a different auditor.", code: "self_approval" },
      false, 403,
    ) as unknown as typeof fetch;
    await expect(decideActualHours("approve", { revisionId: 5, actor: "Auditor A" }))
      .rejects.toThrow("A proposal must be reviewed by a different auditor.");
  });

  it("formats durations and rates for the panel", () => {
    expect(formatSeconds(1642)).toBe("00:27:22");
    expect(formatSeconds(60)).toBe("00:01:00");
    expect(formatSeconds(3480)).toBe("00:58:00");
    expect(formatSeconds(null)).toBe("—");
    expect(formatRate("0.122352")).toBe("12.24%");
    expect(formatRate(null)).toBe("—");
  });
});
