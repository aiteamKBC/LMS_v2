import { useEffect, useMemo, useState } from "react";
import type { AttendanceStatus } from "@/types/bulkAttendance";
import { getDateRange } from "@/utils/bulkAttendance";
import { downloadCsv, slugify } from "@/utils/bulkCsv";
import type { AttendanceRow } from "./AttendanceTable";

type BreakdownKey = "group" | "cohort";

interface SummaryReportProps {
  rows: AttendanceRow[];
  defaultStart: string;
  defaultEnd: string;
  loading: boolean;
  getStatus: (learnerId: string, day: string) => AttendanceStatus;
  scopeLabel: string;
}

interface BreakdownEntry {
  name: string;
  learners: number;
  present: number;
  absent: number;
  total: number;
  rate: number;
}

function computeBreakdown(
  key: BreakdownKey,
  rows: AttendanceRow[],
  dayIsos: string[],
  getStatus: (learnerId: string, day: string) => AttendanceStatus
): BreakdownEntry[] {
  const map = new Map<string, BreakdownEntry>();

  rows.forEach(({ learner, groupName, cohortName }) => {
    const name = key === "group" ? groupName : cohortName;
    const entry =
      map.get(name) ??
      { name, learners: 0, present: 0, absent: 0, total: 0, rate: 0 };
    entry.learners += 1;
    dayIsos.forEach((iso) => {
      entry.total += 1;
      const status = getStatus(learner.id, iso);
      if (status === "present") entry.present += 1;
      else if (status === "absent") entry.absent += 1;
    });
    map.set(name, entry);
  });

  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      rate: entry.total ? Math.round((entry.present / entry.total) * 100) : 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function rateTextClass(rate: number): string {
  if (rate >= 80) return "text-green-700";
  if (rate >= 50) return "text-warning-700";
  return "text-red-700";
}

function rateBarClass(rate: number): string {
  if (rate >= 80) return "bg-green-500";
  if (rate >= 50) return "bg-warning-500";
  return "bg-red-500";
}

function ReportSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-3 w-32 animate-pulse rounded bg-background-200" />
          <div className="ml-auto h-3 w-12 animate-pulse rounded bg-background-200" />
          <div className="h-3 w-40 animate-pulse rounded bg-background-100" />
        </div>
      ))}
    </div>
  );
}

export default function SummaryReport({
  rows,
  defaultStart,
  defaultEnd,
  loading,
  getStatus,
  scopeLabel,
}: SummaryReportProps) {
  const [active, setActive] = useState<BreakdownKey>("group");
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);

  useEffect(() => {
    setStart(defaultStart);
    setEnd(defaultEnd);
  }, [defaultStart, defaultEnd]);

  const rangeDays = useMemo(() => getDateRange(start, end), [start, end]);

  const groupRows = useMemo(
    () => computeBreakdown("group", rows, rangeDays, getStatus),
    [rows, rangeDays, getStatus]
  );
  const cohortRows = useMemo(
    () => computeBreakdown("cohort", rows, rangeDays, getStatus),
    [rows, rangeDays, getStatus]
  );

  const activeRows = active === "group" ? groupRows : cohortRows;

  const overall = useMemo(() => {
    const totals = activeRows.reduce(
      (acc, entry) => ({
        learners: acc.learners + entry.learners,
        present: acc.present + entry.present,
        absent: acc.absent + entry.absent,
        total: acc.total + entry.total,
      }),
      { learners: 0, present: 0, absent: 0, total: 0 }
    );
    return {
      ...totals,
      rate: totals.total ? Math.round((totals.present / totals.total) * 100) : 0,
    };
  }, [activeRows]);

  const columnLabel = active === "group" ? "Group" : "Cohort";

  const isWeekDefault = start === defaultStart && end === defaultEnd;

  const handleExport = () => {
    const header = [
      columnLabel,
      "Learners",
      "Present",
      "Absent",
      "Marks counted",
      "Attendance rate",
    ];
    const body = activeRows.map((entry) => [
      entry.name,
      entry.learners,
      entry.present,
      entry.absent,
      entry.total,
      `${entry.rate}%`,
    ]);
    const overallRow = [
      "Overall",
      overall.learners,
      overall.present,
      overall.absent,
      overall.total,
      `${overall.rate}%`,
    ];

    downloadCsv(
      `attendance-summary_by-${active}_${slugify(scopeLabel)}_${start}_to_${end}.csv`,
      [header, ...body, overallRow]
    );
  };

  return (
    <div className="rounded-lg border border-background-300 bg-background-50">
      <div className="flex flex-col gap-4 border-b border-background-200 p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground-950">
              Summary report
            </h3>
            <p className="mt-0.5 text-xs text-foreground-500">
              Attendance rate across the selected period, broken down by{" "}
              {columnLabel.toLowerCase()}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-1 rounded-full border border-background-300 bg-background-100 px-1 py-1">
              <button
                type="button"
                onClick={() => setActive("group")}
                className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active === "group"
                    ? "bg-background-50 text-foreground-950 shadow-sm"
                    : "text-foreground-600 hover:text-foreground-900"
                }`}
              >
                By Group
              </button>
              <button
                type="button"
                onClick={() => setActive("cohort")}
                className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active === "cohort"
                    ? "bg-background-50 text-foreground-950 shadow-sm"
                    : "text-foreground-600 hover:text-foreground-900"
                }`}
              >
                By Cohort
              </button>
            </div>

            <button
              type="button"
              onClick={handleExport}
              disabled={loading || activeRows.length === 0}
              className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md bg-secondary-500 px-3 py-2 text-sm font-medium text-background-50 transition-colors hover:bg-secondary-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <i className="ri-file-download-line" />
              Export report
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-md bg-background-100 p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-foreground-500">
            <i className="ri-calendar-2-line text-base" />
            Report period
          </span>
          <label className="flex h-10 items-center gap-2 rounded-md border border-background-300 bg-background-50 px-3">
            <span className="font-label text-xs uppercase tracking-wide text-foreground-500">
              From
            </span>
            <input
              type="date"
              value={start}
              max={end}
              onChange={(event) => setStart(event.target.value)}
              className="cursor-pointer bg-transparent text-sm text-foreground-950 outline-none"
            />
          </label>
          <label className="flex h-10 items-center gap-2 rounded-md border border-background-300 bg-background-50 px-3">
            <span className="font-label text-xs uppercase tracking-wide text-foreground-500">
              To
            </span>
            <input
              type="date"
              value={end}
              min={start}
              onChange={(event) => setEnd(event.target.value)}
              className="cursor-pointer bg-transparent text-sm text-foreground-950 outline-none"
            />
          </label>
          <span className="text-xs text-foreground-500">
            {rangeDays.length} day{rangeDays.length === 1 ? "" : "s"}
          </span>
          {!isWeekDefault && (
            <button
              type="button"
              onClick={() => {
                setStart(defaultStart);
                setEnd(defaultEnd);
              }}
              className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-3 py-1.5 text-xs font-medium text-foreground-700 transition-colors hover:bg-background-200"
            >
              <i className="ri-refresh-line" />
              Reset to current week
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <ReportSkeleton />
      ) : activeRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-background-200 text-foreground-500">
            <i className="ri-bar-chart-2-line text-2xl" />
          </span>
          <p className="text-sm font-medium text-foreground-950">
            No summary available
          </p>
          <p className="mt-1 max-w-sm text-sm text-foreground-500">
            Adjust the filters, search, or report period to generate a breakdown.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-background-200 bg-background-100">
                <th className="px-5 py-3 text-left font-label text-xs uppercase tracking-wide text-foreground-500">
                  {columnLabel}
                </th>
                <th className="px-5 py-3 text-right font-label text-xs uppercase tracking-wide text-foreground-500">
                  Learners
                </th>
                <th className="px-5 py-3 text-right font-label text-xs uppercase tracking-wide text-foreground-500">
                  Present
                </th>
                <th className="px-5 py-3 text-right font-label text-xs uppercase tracking-wide text-foreground-500">
                  Absent
                </th>
                <th className="w-56 px-5 py-3 text-right font-label text-xs uppercase tracking-wide text-foreground-500">
                  Attendance rate
                </th>
              </tr>
            </thead>
            <tbody>
              {activeRows.map((entry) => (
                <tr
                  key={entry.name}
                  className="border-b border-background-200 last:border-b-0 hover:bg-background-100"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm ${
                          active === "group"
                            ? "bg-secondary-100 text-secondary-900"
                            : "bg-accent-100 text-accent-700"
                        }`}
                      >
                        <i
                          className={
                            active === "group"
                              ? "ri-community-line"
                              : "ri-group-line"
                          }
                        />
                      </span>
                      <span className="font-medium text-foreground-950">
                        {entry.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-foreground-700">
                    {entry.learners}
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-green-700">
                    {entry.present}
                  </td>
                  <td className="px-5 py-3 text-right text-red-700">
                    {entry.absent}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-background-200 sm:block">
                        <span
                          className={`block h-full rounded-full ${rateBarClass(
                            entry.rate
                          )}`}
                          style={{ width: `${entry.rate}%` }}
                        />
                      </span>
                      <span
                        className={`w-10 text-right font-semibold ${rateTextClass(
                          entry.rate
                        )}`}
                      >
                        {entry.rate}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-background-300 bg-background-100">
                <td className="px-5 py-3 font-semibold text-foreground-950">
                  Overall
                </td>
                <td className="px-5 py-3 text-right font-medium text-foreground-950">
                  {overall.learners}
                </td>
                <td className="px-5 py-3 text-right font-medium text-green-700">
                  {overall.present}
                </td>
                <td className="px-5 py-3 text-right font-medium text-red-700">
                  {overall.absent}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center justify-end gap-3">
                    <span
                      className={`w-10 text-right font-semibold ${rateTextClass(
                        overall.rate
                      )}`}
                    >
                      {overall.rate}%
                    </span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

