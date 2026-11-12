import { useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { StatusDot } from "@/components/ui/StatusBadge";
import { RAG_PERIODS, RAG_TREND } from "@/mocks/dashboard";
import { RAG_COLORS } from "@/pages/dashboard/constants";
import RagDonut from "@/pages/dashboard/components/RagDonut";
import type { RagLevel } from "@/pages/dashboard/types";
import { pct } from "@/pages/dashboard/utils";

const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid oklch(var(--background-300))",
  background: "oklch(var(--background-50))",
  fontSize: 11,
  color: "oklch(var(--foreground-900))",
  padding: "6px 8px",
};

const legend = [
  { key: "green", label: "Green", color: RAG_COLORS.Green },
  { key: "amber", label: "Amber", color: RAG_COLORS.Amber },
  { key: "red", label: "Red", color: RAG_COLORS.Red },
];

type Props = {
  onSelectRag?: (level: RagLevel) => void;
};

export default function GeneralDashboard({ onSelectRag }: Props) {
  const [periodKey, setPeriodKey] = useState("30");
  const period = RAG_PERIODS.find((item) => item.key === periodKey) ?? RAG_PERIODS[1];

  const summary = useMemo(() => {
    const { overall, totalChecks } = period;
    const issues = overall.red + overall.amber;
    return {
      green: pct(overall.green, totalChecks),
      amber: overall.amber,
      red: overall.red,
      total: totalChecks,
      issues,
      issueShare: pct(issues, totalChecks),
    };
  }, [period]);

  const trendTotals = useMemo(
    () => ({
      green: RAG_TREND.reduce((sum, row) => sum + row.green, 0),
      amber: RAG_TREND.reduce((sum, row) => sum + row.amber, 0),
      red: RAG_TREND.reduce((sum, row) => sum + row.red, 0),
    }),
    [],
  );

  const cards = [
    {
      label: "Green rating",
      value: `${summary.green}%`,
      hint: "of all quality checks passed cleanly",
      icon: "ri-checkbox-circle-line",
      tile: "bg-emerald-100 text-emerald-700",
    },
    {
      label: "Amber issues",
      value: String(summary.amber),
      hint: "corrections requested, no escalation",
      icon: "ri-error-warning-line",
      tile: "bg-amber-100 text-amber-800",
    },
    {
      label: "Red issues",
      value: String(summary.red),
      hint: "rejected or escalated to the lead",
      icon: "ri-alarm-warning-line",
      tile: "bg-red-100 text-red-700",
    },
    {
      label: "Checks reviewed",
      value: String(summary.total),
      hint: `${summary.issues} rated amber or red`,
      icon: "ri-file-list-3-line",
      tile: "bg-primary-100 text-primary-700",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground-400">Analytics</p>
          <h2 className="mt-1 font-heading text-[19px] font-semibold leading-tight text-foreground-950">Quality issues at a glance</h2>
          <p className="mt-1 text-[12px] text-foreground-500">Red, amber and green ratings across every quality check in the selected period.</p>
        </div>

        <div className="flex items-center gap-1 rounded-full border border-background-200 bg-background-100 px-1 py-1">
          {RAG_PERIODS.map((item) => {
            const isActive = item.key === periodKey;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setPeriodKey(item.key)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-colors ${
                  isActive ? "bg-background-50 text-foreground-950 ring-1 ring-background-200" : "text-foreground-500 hover:text-foreground-800"
                }`}
                aria-pressed={isActive}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, index) => (
          <article
            key={card.label}
            className="qa-rise rounded-lg border border-background-200 bg-background-50 p-3.5 transition-colors hover:border-primary-300"
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-foreground-500">{card.label}</p>
              <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-md ${card.tile}`}>
                <i className={`${card.icon} text-[15px]`} aria-hidden />
              </span>
            </div>
            <p className="mt-1.5 font-heading text-[26px] font-semibold leading-none tabular-nums text-foreground-950">{card.value}</p>
            <p className="mt-2 truncate text-[10.5px] text-foreground-500">{card.hint}</p>
          </article>
        ))}
      </div>

      <section aria-labelledby="rag-breakdown" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="rag-breakdown" className="font-heading text-[13px] font-semibold text-foreground-950">
            RAG breakdown
          </h3>
          {onSelectRag ? (
            <p className="flex items-center gap-1.5 text-[10.5px] text-foreground-500">
              <i className="ri-cursor-line text-[13px] text-primary-500" aria-hidden />
              Click a segment or colour to open those reviews in the queue
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <RagDonut title="Overall rating" caption="Every check in the period" slices={period.overall} onSelectRag={onSelectRag} />
          <RagDonut title="Forms & compliance" caption="Documentation and evidence quality" slices={period.forms} onSelectRag={onSelectRag} />
          <RagDonut title="Feedback quality" caption="Coach feedback against the standard" slices={period.feedback} onSelectRag={onSelectRag} />
          <RagDonut title="Timeliness & SLA" caption="Review decisions within target" slices={period.timeliness} onSelectRag={onSelectRag} />
        </div>
      </section>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <section className="rounded-lg border border-background-200 bg-background-50 p-4">
          <div className="flex items-end justify-between gap-2">
            <div>
              <h3 className="font-heading text-[13px] font-semibold text-foreground-950">Issues by programme</h3>
              <p className="text-[11px] text-foreground-500">Share of red, amber and green ratings</p>
            </div>
            <span className="hidden rounded-md bg-background-100 px-2 py-1 text-[10px] font-semibold text-foreground-600 sm:inline">RAG mix</span>
          </div>

          <ul className="mt-3 flex flex-col gap-3">
            {period.byProgramme.map((row) => {
              const total = row.red + row.amber + row.green;
              return (
                <li key={row.programme}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[12px] font-medium text-foreground-800">{row.programme}</p>
                    <span className="flex-none text-[10.5px] text-foreground-500">{total} checks</span>
                  </div>
                  <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-background-200">
                    <span style={{ width: `${pct(row.green, total)}%`, backgroundColor: RAG_COLORS.Green }} aria-hidden />
                    <span style={{ width: `${pct(row.amber, total)}%`, backgroundColor: RAG_COLORS.Amber }} aria-hidden />
                    <span style={{ width: `${pct(row.red, total)}%`, backgroundColor: RAG_COLORS.Red }} aria-hidden />
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[10px] text-foreground-500">
                    <span className="flex items-center gap-1">
                      <StatusDot status="Green" className="h-1.5 w-1.5" />
                      {pct(row.green, total)}% green
                    </span>
                    <span className="flex items-center gap-1">
                      <StatusDot status="Amber" className="h-1.5 w-1.5" />
                      {pct(row.amber, total)}% amber
                    </span>
                    <span className="flex items-center gap-1">
                      <StatusDot status="Red" className="h-1.5 w-1.5" />
                      {pct(row.red, total)}% red
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-lg border border-background-200 bg-background-50 p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="font-heading text-[13px] font-semibold text-foreground-950">Weekly RAG trend</h3>
              <p className="text-[11px] text-foreground-500">Volume of rated checks, last 8 weeks</p>
            </div>
            <ul className="flex items-center gap-3">
              {legend.map((item) => (
                <li key={item.key} className="flex items-center gap-1 text-[10px] text-foreground-600">
                  <StatusDot status={item.label} className="h-1.5 w-1.5" />
                  {item.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-3 h-[212px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={RAG_TREND} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: "oklch(var(--foreground-400))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "oklch(var(--foreground-400))" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "oklch(var(--background-100))" }} />
                <Bar dataKey="green" name="Green" stackId="a" fill={RAG_COLORS.Green} radius={[0, 0, 0, 0]} barSize={20} />
                <Bar dataKey="amber" name="Amber" stackId="a" fill={RAG_COLORS.Amber} barSize={20} />
                <Bar dataKey="red" name="Red" stackId="a" fill={RAG_COLORS.Red} radius={[3, 3, 0, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2 border-t border-background-100 pt-2.5">
            {legend.map((item) => {
              const value = trendTotals[item.key as "green" | "amber" | "red"];
              return (
                <div key={item.key}>
                  <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-foreground-400">
                    <StatusDot status={item.label} className="h-1.5 w-1.5" />
                    {item.label}
                  </p>
                  <p className="mt-0.5 font-heading text-[15px] font-semibold tabular-nums text-foreground-900">{value}</p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
