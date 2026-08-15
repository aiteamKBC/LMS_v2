import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateJournalHours,
  decideJournalHours,
  formatJournalHours,
  getJournalHours,
  offsetLabel,
  runOffsetLabel,
} from "./journalHoursApi";

type FetchInit = { headers?: Record<string, string>; body?: string };

const originalFetch = globalThis.fetch;

function mockJson(payload: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(payload),
  } as unknown as Response);
}

describe("journal hours api client", () => {
  beforeEach(() => {
    globalThis.fetch = mockJson({ ok: true }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("talks to the HOURS-TEST mount only", async () => {
    const fetchMock = mockJson({ pending: [], history: [] });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await getJournalHours(92, "2025-08");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.startsWith("/hours_test_api/last-audit/journal-hours/")).toBe(true);
    expect(url).not.toContain("/audit_api/");
    expect(url).toContain("aptem_id=92");
    expect(url).toContain("month=2025-08");
  });

  it("always calculates with varied offsets, for one learner and month", async () => {
    const fetchMock = mockJson({ ok: true, summary: {} });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await calculateJournalHours(92, "2025-08");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as FetchInit).body))).toEqual({
      aptem_id: 92, month: "2025-08", offset_mode: "spread", fields: "both",
    });
  });

  it("asks for one column at a time when a single button is pressed", async () => {
    for (const field of ["actual", "planned"] as const) {
      const fetchMock = mockJson({ ok: true, summary: {} });
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      await calculateJournalHours(92, "2025-08", field);
      expect(JSON.parse(String((fetchMock.mock.calls[0][1] as FetchInit).body)).fields).toBe(field);
    }
  });

  it("sends no auditor identity from the page", async () => {
    const fetchMock = mockJson({ ok: true, summary: {} });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await calculateJournalHours(92, "2025-08");
    const headers = (fetchMock.mock.calls[0][1] as FetchInit).headers ?? {};
    expect(Object.keys(headers)).toEqual(["Content-Type"]);
    expect(headers["X-Audit-Actor"]).toBeUndefined();
  });

  it("scopes an approval to the learner and month", async () => {
    const fetchMock = mockJson({ ok: true, decided: 3, status: "approved" });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await decideJournalHours("approve", { aptemId: 92, month: "2025-08" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/journal-hours/approve");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as FetchInit).body))).toMatchObject({
      aptem_id: 92, month: "2025-08",
    });
  });

  it("surfaces a server refusal instead of swallowing it", async () => {
    globalThis.fetch = mockJson(
      { error: "There is nothing pending for this learner and month." },
      false, 409,
    ) as unknown as typeof fetch;
    await expect(decideJournalHours("approve", { aptemId: 92, month: "2025-08" }))
      .rejects.toThrow(/nothing pending/);
  });

  it("formats hours the way the Activity log does", () => {
    expect(formatJournalHours("0.5000")).toBe("0h 30m 00s");   // 29 min snapped to 30
    expect(formatJournalHours("0.2500")).toBe("0h 15m 00s");   // -15 offset
    expect(formatJournalHours(2.5)).toBe("2h 30m 00s");        // attendance row
    expect(formatJournalHours(null)).toBe("—");
  });

  it("labels a row's offset and the run", () => {
    expect(offsetLabel(0)).toBe("no offset");
    expect(offsetLabel(-10)).toBe("-10 min");
    expect(offsetLabel(15)).toBe("+15 min");
    expect(runOffsetLabel("spread", null)).toContain("varied");
  });
});
