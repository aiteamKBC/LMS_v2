import { useMemo, useState } from "react";
import { COACH_SESSIONS } from "@/mocks/sessions";
import { SESSION_STATUSES, SESSION_STATUS_STYLES } from "@/pages/dashboard/constants";
import type { CoachSession, CriterionState, SessionStatus } from "@/pages/dashboard/types";
import { fmtShortDate, initials, nowLabel } from "@/pages/dashboard/utils";
import SessionDrawer from "@/pages/dashboard/components/SessionDrawer";

const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ANCHOR = new Date(2026, 10, 1);
const pad = (value: number) => String(value).padStart(2, "0");
const keyOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const parseISO = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
};

type Props = { onToast: (text: string) => void };

export default function CoachCalendar({ onToast }: Props) {
  const [sessions, setSessions] = useState<CoachSession[]>(COACH_SESSIONS);
  const [cursor, setCursor] = useState<Date>(ANCHOR);
  const [coach, setCoach] = useState("all");
  const [statusFilter, setStatusFilter] = useState<SessionStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const coaches = useMemo(() => Array.from(new Set(COACH_SESSIONS.map((session) => session.coach))).sort(), []);

  const coachSessions = useMemo(() => sessions.filter((session) => coach === "all" || session.coach === coach), [sessions, coach]);

  const visible = useMemo(
    () => coachSessions.filter((session) => statusFilter === "all" || session.status === statusFilter),
    [coachSessions, statusFilter],
  );

  const monthKey = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`;
  const monthSessions = useMemo(() => coachSessions.filter((session) => session.date.startsWith(monthKey)), [coachSessions, monthKey]);

  const byDay = useMemo(() => {
    const map = new Map<string, CoachSession[]>();
    visible.forEach((session) => {
      const list = map.get(session.date) ?? [];
      list.push(session);
      map.set(session.date, list);
    });
    map.forEach((list) => list.sort((a, b) => a.start.localeCompare(b.start)));
    return map;
  }, [visible]);

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(1 - offset);
    const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil((offset + total) / 7);
    return Array.from({ length: weeks * 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [cursor]);

  const stats = [
    { label: "Sessions this month", value: monthSessions.length, icon: "ri-calendar-check-line", tone: "text-foreground-700 bg-background-100" },
    { label: "Awaiting check", value: coachSessions.filter((s) => s.status === "Awaiting check").length, icon: "ri-time-line", tone: "text-amber-700 bg-amber-50" },
    { label: "In review", value: coachSessions.filter((s) => s.status === "In review").length, icon: "ri-loader-4-line", tone: "text-primary-700 bg-primary-50" },
    { label: "Approved", value: coachSessions.filter((s) => s.status === "Approved").length, icon: "ri-check-double-line", tone: "text-emerald-700 bg-emerald-50" },
  ];

  const workload = useMemo(() => {
    const rows = coaches.map((name) => {
      const list = coachSessions.filter((session) => session.coach === name);
      const monthCount = list.filter((session) => session.date.startsWith(monthKey)).length;
      return { name, monthCount, awaiting: list.filter((session) => session.status === "Awaiting check" || session.status === "In review").length };
    });
    const max = Math.max(1, ...rows.map((row) => row.monthCount));
    return rows.sort((a, b) => b.monthCount - a.monthCount).map((row) => ({ ...row, width: Math.round((row.monthCount / max) * 100) }));
  }, [coaches, coachSessions, monthKey]);

  const queue = useMemo(
    () =>
      coachSessions
        .filter((session) => session.status === "Awaiting check" || session.status === "In review")
        .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))
        .slice(0, 6),
    [coachSessions],
  );

  const selected = sessions.find((session) => session.id === selectedId) ?? null;
  const monthLabel = cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const todayKey = keyOf(new Date());

  const shiftMonth = (delta: number) => setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));

  const handleDecision = (status: SessionStatus, criteria: CriterionState[], comment: string) => {
    if (!selected) return;
    const id = selected.id;
    setSessions((prev) => prev.map((session) => (session.id === id ? { ...session, status, criteria, comment, decidedAt: nowLabel() } : session)));
    onToast(`${id} marked ${status.toLowerCase()}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-background-200 bg-background-50">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-background-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-heading text-[15px] font-semibold text-foreground-950">Coach session calendar</h2>
            <p className="mt-0.5 text-[12px] text-foreground-500">Every coaching session and the quality check it still needs. Click a session to open the details.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <i className="ri-user-star-line pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-foreground-400" aria-hidden />
              <select
                value={coach}
                onChange={(event) => setCoach(event.target.value)}
                aria-label="Filter by coach"
                className="h-8 cursor-pointer appearance-none rounded-md border border-background-300 bg-background-50 pl-7 pr-7 text-[11.5px] font-medium text-foreground-800 outline-none hover:border-primary-300 focus:border-primary-400"
              >
                <option value="all">All coaches</option>
                {coaches.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <i className="ri-arrow-down-s-line pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[15px] text-foreground-400" aria-hidden />
            </div>

            <div className="flex items-center gap-1 rounded-md border border-background-300 bg-background-50 px-1 py-0.5">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="grid size-7 cursor-pointer place-items-center rounded text-foreground-600 hover:bg-background-100"
                aria-label="Previous month"
              >
                <i className="ri-arrow-left-s-line text-[16px]" aria-hidden />
              </button>
              <span className="min-w-[104px] text-center text-[11.5px] font-semibold text-foreground-900">{monthLabel}</span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="grid size-7 cursor-pointer place-items-center rounded text-foreground-600 hover:bg-background-100"
                aria-label="Next month"
              >
                <i className="ri-arrow-right-s-line text-[16px]" aria-hidden />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setCursor(new Date(ANCHOR.getFullYear(), ANCHOR.getMonth(), 1))}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-2.5 text-[11.5px] font-semibold text-foreground-700 hover:bg-background-100"
            >
              <i className="ri-focus-3-line text-[13px]" aria-hidden />
              Today
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px bg-background-200 md:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="bg-background-50 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <span className={cn("grid size-6 flex-none place-items-center rounded-md", stat.tone)}>
                  <i className={cn(stat.icon, "text-[13px]")} aria-hidden />
                </span>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-500">{stat.label}</p>
              </div>
              <p className="mt-1 font-heading text-[19px] font-semibold leading-none tabular-nums text-foreground-950">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-background-200 px-4 py-2">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-[10.5px] font-semibold transition-colors",
              statusFilter === "all" ? "bg-foreground-950 text-background-50" : "text-foreground-600 hover:bg-background-100",
            )}
          >
            All sessions
          </button>
          {SESSION_STATUSES.map((status) => {
            const isActive = statusFilter === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(isActive ? "all" : status)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-[10.5px] font-medium transition-colors",
                  isActive ? "bg-background-100 text-foreground-900 ring-1 ring-background-300" : "text-foreground-600 hover:bg-background-100",
                )}
              >
                <span className={cn("size-1.5 rounded-full", SESSION_STATUS_STYLES[status].dot)} aria-hidden />
                {status}
              </button>
            );
          })}
        </div>
      </section>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <section className="min-w-0 flex-1 overflow-hidden rounded-lg border border-background-200 bg-background-50">
          <div className="grid grid-cols-7 gap-px bg-background-200">
            {WEEKDAYS.map((day) => (
              <div key={day} className="bg-background-100 px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-foreground-500">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px bg-background-200">
            {cells.map((date) => {
              const key = keyOf(date);
              const inMonth = date.getMonth() === cursor.getMonth();
              const isToday = key === todayKey;
              const daySessions = byDay.get(key) ?? [];
              return (
                <div key={key} className={cn("min-h-[112px] min-w-0 bg-background-50 p-1.5", !inMonth && "bg-background-100/70")}>
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={cn(
                        "grid size-5 place-items-center rounded-full text-[10.5px] font-semibold tabular-nums",
                        isToday ? "bg-primary-500 text-background-50" : inMonth ? "text-foreground-700" : "text-foreground-400",
                      )}
                    >
                      {date.getDate()}
                    </span>
                    {daySessions.length > 0 ? <span className="text-[9px] font-medium text-foreground-400">{daySessions.length}</span> : null}
                  </div>

                  <div className="flex flex-col gap-1">
                    {daySessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => setSelectedId(session.id)}
                        title={`${session.start} · ${session.coach} · ${session.learner} · ${session.formType}`}
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-1 truncate rounded border px-1 py-0.5 text-left text-[9.5px] font-medium leading-tight transition-colors",
                          SESSION_STATUS_STYLES[session.status].cell,
                        )}
                      >
                        <span className="flex-none font-semibold tabular-nums">{session.start}</span>
                        <span className="truncate">{session.coach.split(" ")[0]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-background-200 bg-background-100/60 px-4 py-2">
            <p className="text-[10.5px] text-foreground-500">
              {visible.length} session{visible.length === 1 ? "" : "s"} shown
              {coach === "all" ? "" : ` · ${coach}`}
              {statusFilter === "all" ? "" : ` · ${statusFilter.toLowerCase()}`}
            </p>
            <p className="inline-flex items-center gap-1 text-[10.5px] text-foreground-500">
              <i className="ri-information-line text-[12px] text-foreground-400" aria-hidden />
              Amber sessions still need a quality check
            </p>
          </div>
        </section>

        <aside className="flex w-full flex-none flex-col gap-3 xl:w-[296px]">
          <section className="rounded-lg border border-background-200 bg-background-50">
            <div className="flex items-center justify-between border-b border-background-200 px-3 py-2.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Coach workload</h3>
              <span className="text-[10px] text-foreground-400">{monthLabel}</span>
            </div>
            <ul className="divide-y divide-background-100">
              {workload.map((row) => (
                <li key={row.name}>
                  <button
                    type="button"
                    onClick={() => setCoach(coach === row.name ? "all" : row.name)}
                    className={cn(
                      "flex w-full cursor-pointer flex-col gap-1 px-3 py-2 text-left transition-colors",
                      coach === row.name ? "bg-primary-50" : "hover:bg-background-100",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="grid size-6 flex-none place-items-center rounded-full bg-background-200 text-[9px] font-semibold text-foreground-700">
                        {initials(row.name)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-foreground-900">{row.name}</span>
                      <span className="whitespace-nowrap text-[10.5px] font-semibold tabular-nums text-foreground-600">{row.monthCount} sessions</span>
                    </div>
                    <div className="flex items-center gap-2 pl-8">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-background-200">
                        <div className="h-full rounded-full bg-primary-400" style={{ width: `${row.width}%` }} aria-hidden />
                      </div>
                      {row.awaiting > 0 ? (
                        <span className="whitespace-nowrap rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800 ring-1 ring-amber-200">
                          {row.awaiting} open
                        </span>
                      ) : (
                        <span className="whitespace-nowrap text-[9px] font-medium text-emerald-600">clear</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border border-background-200 bg-background-50">
            <div className="flex items-center justify-between border-b border-background-200 px-3 py-2.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Awaiting quality check</h3>
              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">{queue.length}</span>
            </div>
            {queue.length > 0 ? (
              <ul className="divide-y divide-background-100">
                {queue.map((session) => (
                  <li key={session.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(session.id)}
                      className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-background-100"
                    >
                      <span className="flex w-9 flex-none flex-col items-center rounded bg-background-100 py-0.5">
                        <span className="text-[9px] font-semibold uppercase text-foreground-500">{fmtShortDate(session.date).split(" ")[1]}</span>
                        <span className="text-[12px] font-semibold leading-none tabular-nums text-foreground-900">{fmtShortDate(session.date).split(" ")[0]}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] font-medium text-foreground-900">{session.learner}</span>
                        <span className="block truncate text-[10px] text-foreground-500">
                          {session.coach} · {session.start}
                        </span>
                      </span>
                      <i className="ri-arrow-right-s-line flex-none text-[14px] text-foreground-400" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-5 text-center text-[11px] text-foreground-500">Every submitted session has a decision. Nothing waiting.</p>
            )}
          </section>

          <section className="rounded-lg border border-background-200 bg-secondary-50 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-secondary-900">
              <i className="ri-lightbulb-line text-[13px]" aria-hidden />
              Calendar tip
            </p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-foreground-600">
              Sessions turn amber the moment a coach submits the form. Open a session, review the evidence, then run the quality check.
            </p>
          </section>
        </aside>
      </div>

      {selected ? (
        <SessionDrawer
          key={selected.id}
          session={selected}
          onClose={() => setSelectedId(null)}
          onDecision={handleDecision}
          onToast={onToast}
        />
      ) : null}
    </div>
  );
}
