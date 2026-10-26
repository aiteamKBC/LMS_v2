import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createBulkAttendanceLiveDay,
  fetchBulkAttendanceKbcMonthRecords,
  fetchBulkAttendanceLiveMonthRecords,
  saveBulkAttendanceChanges,
  type BulkAttendanceKbcHistoryRecord,
  type BulkAttendanceMonthOccurrence,
  type BulkAttendanceMonthRecord,
} from "@/api/bulkAttendanceLearners";
import type { AttendanceStatus, Lecture } from "@/types/bulkAttendance";
import { systemDateParts } from "@/lib/format";
import { avatarClass, getInitials, getWeekDays } from "@/utils/bulkAttendance";
import type { AttendanceRow } from "./AttendanceTable";

interface MonthlySession {
  key: string;
  date: string;
  title: string;
  source: "live" | "kbc";
  occurrence?: BulkAttendanceMonthOccurrence;
  kbcRecordByLearner: Record<string, BulkAttendanceKbcHistoryRecord>;
}

interface PendingMark {
  key: string;
  learnerId: string;
  source: "live" | "kbc";
  date: string;
  status: "present" | "absent";
  occurrenceId?: string;
  moduleCatalogueId?: string;
  recordKey?: string;
}

interface MonthlyPayload {
  occurrences: BulkAttendanceMonthOccurrence[];
  records: BulkAttendanceMonthRecord[];
  kbcRecords: BulkAttendanceKbcHistoryRecord[];
}

interface MonthlyGridProps {
  rows: AttendanceRow[];
  lectures: Lecture[];
  selectedLecture?: Lecture | null;
  moduleCatalogueId: string;
  groupId?: string;
  moduleCatalogueIds?: string[];
  date: string;
  active: boolean;
  loading: boolean;
  onSaved: () => void;
}

function shiftMonth(month: string, offset: number): string {
  const [year, number] = month.split("-").map(Number);
  const next = new Date(year, number - 1 + offset, 1);
  return String(next.getFullYear()) + "-" + String(next.getMonth() + 1).padStart(2, "0");
}

function monthLabel(month: string): string {
  return new Date(month + "-01T12:00:00").toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function markKey(sessionKey: string, learnerId: string): string {
  return sessionKey + ":" + learnerId;
}

function currentBusinessMonth(): string {
  const parts = systemDateParts(new Date());
  if (!parts) return new Date().toISOString().slice(0, 7);
  return String(parts.year) + "-" + String(parts.month).padStart(2, "0");
}

function normalizeEventPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function kbcEventKey(record: BulkAttendanceKbcHistoryRecord): string {
  return [
    "kbc",
    record.sessionDate,
    normalizeEventPart(record.moduleName),
    normalizeEventPart(record.lectureName),
    record.sessionNumber === null ? "" : String(record.sessionNumber),
  ].join("|");
}

function liveSessionTitle(
  occurrence: BulkAttendanceMonthOccurrence,
  lecture?: Lecture,
): string {
  const sessionLabel = `Lecture ${occurrence.sessionNumber}`;
  const moduleTitle = (occurrence.moduleTitle || "Live session").trim();
  const lectureName = lecture?.name?.trim() || "";
  // Curriculum rows often use the module title as the lecture title. Keep
  // the module context, but always expose the occurrence number so multiple
  // lectures on one day are distinguishable in the monthly cell.
  if (!lectureName || normalizeEventPart(lectureName) === normalizeEventPart(moduleTitle)) {
    return `${sessionLabel} · ${moduleTitle}`;
  }
  return `${sessionLabel} · ${lectureName}`;
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export default function MonthlyGrid({
  rows,
  lectures,
  selectedLecture = null,
  moduleCatalogueId,
  groupId = "",
  moduleCatalogueIds = [],
  date,
  active,
  loading,
  onSaved,
}: MonthlyGridProps) {
  const [month, setMonth] = useState(() => date.slice(0, 7) || currentBusinessMonth());
  const [result, setResult] = useState<{ scope: string; payload: MonthlyPayload } | null>(null);
  const [saved, setSaved] = useState<Record<string, AttendanceStatus>>({});
  const [pending, setPending] = useState<Record<string, PendingMark>>({});
  const [readLoading, setReadLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const moduleCatalogueIdsKey = moduleCatalogueIds.join(",");
  const learnerIdsKey = rows.map(({ learner }) => learner.kbcId || "").filter(Boolean).join(",");
  const scope = month + ":" + moduleCatalogueId + ":" + groupId + ":" + moduleCatalogueIdsKey + ":" + learnerIdsKey;
  const currentResult = result?.scope === scope ? result.payload : null;

  useEffect(() => {
    if (date) setMonth(date.slice(0, 7));
  }, [date]);

  useEffect(() => {
    if (!active || (!moduleCatalogueId && !groupId)) return undefined;
    const controller = new AbortController();
    setReadLoading(true);
    setError(null);
    setResult(null);
    const requestedModuleCatalogueIds = moduleCatalogueIdsKey ? moduleCatalogueIdsKey.split(",") : [];
    const learnerIds = learnerIdsKey ? learnerIdsKey.split(",") : [];
    const kbcRequest = learnerIds.length
      ? fetchBulkAttendanceKbcMonthRecords(month, learnerIds, controller.signal)
      : Promise.resolve([] as BulkAttendanceKbcHistoryRecord[]);
    void Promise.allSettled([
      fetchBulkAttendanceLiveMonthRecords(
        month, moduleCatalogueId, controller.signal, groupId, requestedModuleCatalogueIds,
      ),
      kbcRequest,
    ]).then(([liveResult, kbcResult]) => {
      if (controller.signal.aborted) return;
      if (liveResult.status === "rejected") throw liveResult.reason;
      const kbcRecords = kbcResult.status === "fulfilled" ? kbcResult.value : [];
      if (kbcResult.status === "rejected") {
        setError(errorMessage(kbcResult.reason, "Unable to load monthly KBC attendance."));
      }
      const payload: MonthlyPayload = { ...liveResult.value, kbcRecords };
      setResult({ scope, payload });
      const loadedStatuses = {
        ...Object.fromEntries(liveResult.value.records.map((record) => [
          markKey("live:" + record.occurrenceId, record.learnerId), record.attendance,
        ])),
        ...Object.fromEntries(kbcRecords
          .filter((record) => record.attendance !== null)
          .map((record) => [
            markKey(record.source === "live" ? record.recordKey : "kbc:" + record.recordKey, record.learnerId),
            record.attendance as AttendanceStatus,
          ])),
      };
      // Keep a locally confirmed status visible if a parent refresh races the
      // register read and the mocked/partial response does not include it yet.
      setSaved((current) => ({ ...current, ...loadedStatuses }));
      setPending({});
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(reason, "Monthly attendance could not be loaded."));
    }).finally(() => {
      if (!controller.signal.aborted) setReadLoading(false);
    });
    return () => controller.abort();
  }, [active, groupId, learnerIdsKey, month, moduleCatalogueId, moduleCatalogueIdsKey, retry, scope]);

  const occurrences = useMemo(() => {
    const all = currentResult?.occurrences ?? [];
    if (!selectedLecture) return all;
    return all.filter((occurrence) => occurrence.date === selectedLecture.sessionDate
      && occurrence.sessionNumber === selectedLecture.sessionNumber
      && occurrence.moduleCatalogueId === selectedLecture.moduleCatalogueId);
  }, [currentResult, selectedLecture]);
  const sessions = useMemo<MonthlySession[]>(() => {
    const savedLiveRecordKeys = new Set((currentResult?.records ?? []).map((record) => record.recordKey));
    const savedLiveRecords = new Map(
      (currentResult?.kbcRecords ?? [])
        .filter((record) => record.source === "live")
        .map((record) => [record.recordKey, record]),
    );
    const liveSessions: MonthlySession[] = occurrences.map((occurrence) => {
      const lecture = lectures.find((item) =>
        item.moduleCatalogueId === occurrence.moduleCatalogueId
        && item.sessionNumber === occurrence.sessionNumber
        && item.sessionDate === occurrence.date);
      return {
        key: "live:" + occurrence.id,
        date: occurrence.date,
        title: liveSessionTitle(occurrence, lecture),
        source: "live",
        occurrence,
        kbcRecordByLearner: {},
      };
    });
    const patternTitles = new Set((currentResult?.occurrences ?? [])
      .map((occurrence) => normalizeEventPart(occurrence.moduleTitle || ""))
      .filter(Boolean));
    const kbcByKey = new Map<string, MonthlySession>();
    (currentResult?.kbcRecords ?? [])
      .filter((record) => !selectedLecture || (
        record.sessionDate === selectedLecture.sessionDate
        && (record.sessionNumber === null || record.sessionNumber === selectedLecture.sessionNumber)
      ))
      .forEach((record) => {
      if (record.source === "live") {
        // A live record already represented by the scheduled occurrence is
        // used for its saved status; only create a standalone session when
        // the schedule could not resolve that old occurrence/module.
        if (savedLiveRecordKeys.has(record.recordKey)) return;
        // A module view follows the module's weekly pattern only; live rows
        // from another session (one-off additions, other modules) belong to
        // group view. Without pattern occurrences the old-schedule case stays.
        if (moduleCatalogueId && patternTitles.size
          && !patternTitles.has(normalizeEventPart(record.moduleName))) return;
        kbcByKey.set("live-record:" + record.recordKey, {
          key: "live-record:" + record.recordKey,
          date: record.sessionDate,
          title: record.lectureName || record.moduleName || "Live attendance",
          source: "live",
          kbcRecordByLearner: { [record.learnerId]: record },
        });
        return;
      }
      const key = kbcEventKey(record);
      const existing = kbcByKey.get(key);
      if (existing) {
        existing.kbcRecordByLearner[record.learnerId] = record;
        return;
      }
      kbcByKey.set(key, {
        key,
        date: record.sessionDate,
        title: record.lectureName || record.moduleName || "KBC attendance",
        source: "kbc",
        kbcRecordByLearner: { [record.learnerId]: record },
      });
    });
    liveSessions.forEach((session) => {
      const occurrenceId = session.occurrence?.id;
      if (!occurrenceId) return;
      (currentResult?.records ?? [])
        .filter((record) => record.occurrenceId === occurrenceId)
        .forEach((record) => {
          const saved = savedLiveRecords.get(record.recordKey);
          if (saved) session.kbcRecordByLearner[record.learnerId] = saved;
        });
    });
    return [...liveSessions, ...kbcByKey.values()].sort((left, right) =>
      left.date.localeCompare(right.date) || left.source.localeCompare(right.source) || left.key.localeCompare(right.key));
  }, [currentResult, lectures, moduleCatalogueId, occurrences, selectedLecture]);

  const weeks = useMemo(() => {
    const map = new Map<string, Map<string, MonthlySession[]>>();
    sessions.forEach((session) => {
      const week = getWeekDays(session.date)[0].iso;
      const days = map.get(week) ?? new Map<string, MonthlySession[]>();
      days.set(session.date, [...(days.get(session.date) ?? []), session]);
      map.set(week, days);
    });
    return [...map].sort(([a], [b]) => a.localeCompare(b)).map(([start, days]) => ({
      start,
      days: [...days].sort(([a], [b]) => a.localeCompare(b)),
    }));
  }, [sessions]);

  const getSavedRecord = (session: MonthlySession, learnerId: string) =>
    session.kbcRecordByLearner[learnerId];

  const liveDatesByLearner = useMemo(() => {
    const occurrenceDates = new Map(occurrences.map((occurrence) => [occurrence.id, occurrence.date]));
    const dates = new Map<string, Set<string>>();
    (currentResult?.records ?? []).forEach((record) => {
      const sessionDate = occurrenceDates.get(record.occurrenceId);
      if (!sessionDate) return;
      const learnerDates = dates.get(record.learnerId) ?? new Set<string>();
      learnerDates.add(sessionDate);
      dates.set(record.learnerId, learnerDates);
    });
    (currentResult?.kbcRecords ?? [])
      .filter((record) => record.source === "live")
      .forEach((record) => {
        const learnerDates = dates.get(record.learnerId) ?? new Set<string>();
        learnerDates.add(record.sessionDate);
        dates.set(record.learnerId, learnerDates);
      });
    return dates;
  }, [currentResult, occurrences]);

  const isCoveredByLive = useCallback((session: MonthlySession, learnerId: string) =>
    session.source === "kbc" && Boolean(liveDatesByLearner.get(learnerId)?.has(session.date)),
  [liveDatesByLearner]);

  const getStatus = useCallback((session: MonthlySession, learnerId: string): AttendanceStatus => {
    const savedRecord = getSavedRecord(session, learnerId);
    const statusKey = session.source === "kbc" && savedRecord
      ? markKey("kbc:" + savedRecord.recordKey, learnerId)
      : session.source === "live" && savedRecord && !session.occurrence
      ? markKey(savedRecord.recordKey, learnerId)
      : markKey(session.key, learnerId);
    return pending[statusKey]?.status ?? saved[statusKey] ?? "unmarked";
  }, [pending, saved]);

  const rates = useMemo(() => Object.fromEntries(rows.map(({ learner }) => {
    const learnerId = learner.kbcId || "";
    const visibleSessions = sessions.filter((session) => !isCoveredByLive(session, learnerId));
    const present = visibleSessions.filter((session) => getStatus(session, learnerId) === "present").length;
    return [learner.id, visibleSessions.length ? Math.round(present / visibleSessions.length * 100) : 0];
  })), [getStatus, isCoveredByLive, rows, sessions]);

  const toggle = (session: MonthlySession, learnerId: string) => {
    const savedRecord = getSavedRecord(session, learnerId);
    if (!learnerId || (session.source === "kbc" && !savedRecord)
      || (session.source === "live" && !session.occurrence && !savedRecord)) return;
    const recordKey = savedRecord?.recordKey;
    const key = session.source === "kbc" && recordKey
      ? markKey("kbc:" + recordKey, learnerId)
      : session.source === "live" && !session.occurrence && recordKey
      ? markKey(recordKey, learnerId)
      : markKey(session.key, learnerId);
    const next = getStatus(session, learnerId) === "present" ? "absent" : "present";
    setError(null);
    setPending((current) => {
      const updated = { ...current };
      if (next === saved[key]) delete updated[key];
      else updated[key] = {
        key, learnerId, source: session.source, date: session.date, status: next,
        occurrenceId: session.occurrence?.id, moduleCatalogueId: session.occurrence?.moduleCatalogueId, recordKey,
      };
      return updated;
    });
  };

  const markSaved = (marks: PendingMark[]) => {
    const completed = new Set(marks.map((mark) => mark.key));
    setSaved((current) => ({ ...current, ...Object.fromEntries(marks.map((mark) => [mark.key, mark.status])) }));
    setPending((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !completed.has(key))));
  };

  const saveChanges = async () => {
    const liveGroups = new Map<string, PendingMark[]>();
    const savedLiveChanges: PendingMark[] = [];
    const kbcChanges: PendingMark[] = [];
    Object.values(pending).forEach((mark) => {
      if (mark.source === "kbc") kbcChanges.push(mark);
      else if (!mark.occurrenceId || !mark.moduleCatalogueId) savedLiveChanges.push(mark);
      else {
        const key = [mark.occurrenceId, mark.moduleCatalogueId, mark.date, mark.status].join(":");
        liveGroups.set(key, [...(liveGroups.get(key) ?? []), mark]);
      }
    });
    setSaving(true);
    setError(null);
    let savedAny = false;
    try {
      for (const marks of liveGroups.values()) {
        const first = marks[0];
        if (!first.occurrenceId || !first.moduleCatalogueId) continue;
        await createBulkAttendanceLiveDay({
          learnerIds: marks.map((mark) => mark.learnerId),
          moduleCatalogueId: first.moduleCatalogueId,
          date: first.date,
          occurrenceId: first.occurrenceId,
          attendance: first.status,
        });
        markSaved(marks);
        savedAny = true;
      }
      for (let offset = 0; offset < kbcChanges.length; offset += 200) {
        const batch = kbcChanges.slice(offset, offset + 200);
        await saveBulkAttendanceChanges(batch.map((mark) => ({
          source: "kbc" as const, recordKey: mark.recordKey!, attendance: mark.status,
        })));
        markSaved(batch);
        savedAny = true;
      }
      for (let offset = 0; offset < savedLiveChanges.length; offset += 200) {
        const batch = savedLiveChanges.slice(offset, offset + 200);
        await saveBulkAttendanceChanges(batch.map((mark) => ({
          source: "live" as const, recordKey: mark.recordKey!, attendance: mark.status,
        })));
        markSaved(batch);
        savedAny = true;
      }
    } catch (reason) {
      setError(errorMessage(reason, "Monthly attendance could not be saved."));
    } finally {
      setSaving(false);
      if (savedAny) onSaved();
    }
  };

  const pendingCount = Object.keys(pending).length;

  return (
    <>
      {active && (
        <section className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground-950">Monthly overview</h3>
              <p className="mt-0.5 text-xs text-foreground-500">
                {monthLabel(month)} · Days with saved attendance or live sessions are shown
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}
                className="rounded-md border border-background-300 px-2 py-1 text-foreground-700"><i className="ri-arrow-left-s-line" /></button>
              <input type="month" aria-label="Attendance month" value={month}
                onChange={(event) => { if (event.target.value) setMonth(event.target.value); }}
                className="rounded-md border border-background-300 bg-background-50 px-2 py-1 text-sm" />
              <button type="button" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}
                className="rounded-md border border-background-300 px-2 py-1 text-foreground-700"><i className="ri-arrow-right-s-line" /></button>
            </div>
          </div>

          {!moduleCatalogueId && !groupId ? (
            <p className="rounded-lg border border-background-300 bg-background-50 p-6 text-sm text-foreground-600">Choose a Module or Group to view monthly attendance.</p>
          ) : loading || readLoading ? (
            <p role="status" className="rounded-lg border border-background-300 bg-background-50 p-6 text-sm text-foreground-600">Loading monthly attendance…</p>
          ) : error && !currentResult ? (
            <div role="alert" className="rounded-lg border border-danger-200 bg-background-50 p-6 text-sm text-danger-700">{error} <button type="button" onClick={() => setRetry((value) => value + 1)} className="underline">Retry</button></div>
          ) : weeks.length === 0 ? (
            <div className="rounded-lg border border-background-300 bg-background-50 p-6 text-sm text-foreground-600">
              <p>No attendance or live sessions are recorded for this selection in {monthLabel(month)}.</p>
              {error && <p className="mt-2 text-danger-700" role="alert">{error} <button type="button" onClick={() => setRetry((value) => value + 1)} className="underline">Retry</button></p>}
            </div>
          ) : weeks.map(({ start, days }) => (
            <div key={start}>
              <h4 className="mb-2 text-sm font-medium text-foreground-800">Week of {new Date(start + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</h4>
              <div className="overflow-x-auto rounded-lg border border-background-300 bg-background-50">
                <table className="w-full min-w-[880px] border-collapse text-sm">
                  <thead><tr className="bg-background-100 text-xs uppercase text-foreground-500">
                    <th className="sticky left-0 z-10 bg-background-100 px-4 py-3 text-left">Learner</th>
                    {days.map(([day]) => <th key={day} className="min-w-36 px-3 py-3 text-center">{new Date(day + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })} {day.slice(8)}</th>)}
                    <th className="px-4 py-3 text-right">Month</th>
                  </tr></thead>
                  <tbody>{rows.map(({ learner, index, groupName }) => {
                    const learnerId = learner.kbcId || "";
                    return <tr key={learner.id} className="border-t border-background-200 hover:bg-background-100">
                      <td className="sticky left-0 z-10 bg-background-50 px-4 py-3"><div className="flex items-center gap-3">
                        <span className={"flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold " + avatarClass(index)}>{getInitials(learner.name)}</span>
                        <span><span className="block font-medium text-foreground-950">{learner.name}</span><span className="block text-xs text-foreground-500">{groupName}</span></span>
                      </div></td>
                      {days.map(([day, daySessions]) => <td key={day} className="px-2 py-2 align-top"><div className="flex flex-col gap-1.5">
                        {daySessions.filter((session) => !isCoveredByLive(session, learnerId)).map((session) => {
                          const record = getSavedRecord(session, learnerId);
                          const status = getStatus(session, learnerId);
                          const editable = session.source === "live" || Boolean(record);
                          return <button key={session.key} type="button" disabled={!editable || saving} onClick={() => toggle(session, learnerId)}
                            aria-label={learner.name + " " + day + " " + session.title + " " + status}
                            className={"flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-left text-xs " +
                              (status === "present" ? "border-green-200 bg-green-100 text-green-700" : status === "absent" ? "border-red-200 bg-red-100 text-red-700" : "border-background-300 bg-background-100 text-foreground-600") + (!editable ? " cursor-not-allowed opacity-60" : "")}>
                            <span className="max-w-32 truncate" title={session.title}>{session.title}</span><span aria-hidden="true">{status === "present" ? "✓" : status === "absent" ? "×" : "—"}</span>
                          </button>;
                        })}
                      </div></td>)}
                      <td className="px-4 py-3 text-right font-semibold text-foreground-950">{rates[learner.id]}%</td>
                    </tr>;
                  })}</tbody>
                </table>
                {rows.length === 0 && <p className="p-6 text-center text-sm text-foreground-500">No learners match these filters.</p>}
              </div>
            </div>
          ))}
          {error && currentResult && <p role="alert" className="text-sm text-danger-700">{error}</p>}
        </section>
      )}
      {pendingCount > 0 && <div className={"fixed inset-x-0 z-40 mx-auto flex w-fit max-w-[95vw] flex-wrap items-center justify-center gap-3 rounded-lg border border-primary-200 bg-background-50 p-3 shadow-lg " + (active ? "bottom-3" : "bottom-20")} role="region" aria-label="Unsaved monthly attendance">
        <span className="text-sm">{pendingCount} monthly attendance changes not saved</span>
        {!active && error && <span role="alert" className="text-sm text-danger-700">{error}</span>}
        <button type="button" disabled={saving} onClick={() => setPending({})} className="text-sm underline">Undo</button>
        <button type="button" disabled={saving} onClick={() => void saveChanges()} className="rounded-md bg-primary-500 px-3 py-1.5 text-sm text-background-50 disabled:opacity-50">{saving ? "Saving…" : "Save changes"}</button>
      </div>}
    </>
  );
}
