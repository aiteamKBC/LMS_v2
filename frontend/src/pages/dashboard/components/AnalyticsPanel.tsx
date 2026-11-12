import { useMemo } from "react";
import { Bar, BarChart, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHECK_STATUSES, STATUS_CHART_COLORS } from "@/pages/dashboard/constants";
import type { CheckStatus, Review } from "@/pages/dashboard/types";
import { pct } from "@/pages/dashboard/utils";

const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid oklch(var(--background-300))",
  background: "oklch(var(--background-50))",
  fontSize: 11,
  color: "oklch(var(--foreground-900))",
  padding: "6px 8px",
};

const shortName = (type: string) => {
  const cleaned = type.replace(" Feedback Form", "").replace(" – Previous Form", " (prev)");
  return cleaned.length > 26 ? `${cleaned.slice(0, 25)}…` : cleaned;
};

export default function AnalyticsPanel({ reviews }: { reviews: Review[] }) {
  const statusData = useMemo(
    () =>
      CHECK_STATUSES.map((status: CheckStatus) => ({
        name: status,
        value: reviews.filter((review) => review.formCheck === status).length,
        color: STATUS_CHART_COLORS[status],
      })).filter((item) => item.value > 0),
    [reviews],
  );

  const barData = useMemo(() => {
    const map = new Map<string, { total: number; approved: number }>();
    reviews.forEach((review) => {
      const current = map.get(review.formType) ?? { total: 0, approved: 0 };
      current.total += 1;
      if (review.formCheck === "Approved" && review.feedbackCheck === "Approved") current.approved += 1;
      map.set(review.formType, current);
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name: shortName(name), full: name, rate: pct(value.approved, value.total), total: value.total }))
      .sort((a, b) => b.rate - a.rate || b.total - a.total);
  }, [reviews]);

  const total = statusData.reduce((sum, item) => sum + item.value, 0);

  return (
    <section id="analytics" className="scroll-mt-20">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-[15px] font-semibold text-foreground-950">Analytics</h2>
          <p className="text-[12px] text-foreground-500">Both charts follow the active filters.</p>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full border border-background-200 bg-background-50 px-2.5 py-1 text-[11px] text-foreground-600 sm:inline-flex">
          <i className="ri-filter-3-line text-[12px]" aria-hidden />
          {reviews.length} reviews in scope
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="rounded-lg border border-background-200 bg-background-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-heading text-[13px] font-semibold text-foreground-950">Quality check status</h3>
              <p className="text-[11px] text-foreground-500">Distribution across the current view</p>
            </div>
            <span className="hidden rounded-md bg-background-100 px-2 py-1 text-[10px] font-semibold text-foreground-600 md:inline">Forms check</span>
          </div>

          {total === 0 ? (
            <div className="flex h-[220px] flex-col items-center justify-center gap-1 text-center">
              <i className="ri-pie-chart-2-line text-[26px] text-foreground-300" aria-hidden />
              <p className="text-[12px] font-medium text-foreground-600">No reviews to chart</p>
              <p className="text-[11px] text-foreground-400">Adjust the filters to see a distribution.</p>
            </div>
          ) : (
            <div className="mt-2 grid items-center gap-2 sm:grid-cols-[1fr_auto]">
              <div className="relative h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={54} outerRadius={80} paddingAngle={2} stroke="none">
                      {statusData.map((item) => (
                        <Cell key={item.name} fill={item.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-heading text-[22px] font-semibold leading-none text-foreground-950 tabular-nums">{total}</span>
                  <span className="mt-0.5 text-[10px] uppercase tracking-wide text-foreground-400">reviews</span>
                </div>
              </div>
              <ul className="flex flex-col gap-1.5 sm:w-[128px]">
                {statusData.map((item) => (
                  <li key={item.name} className="flex items-center gap-1.5 text-[11px]">
                    <span className="size-2 flex-none rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
                    <span className="flex-1 truncate text-foreground-600">{item.name}</span>
                    <span className="font-semibold tabular-nums text-foreground-900">{item.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-background-200 bg-background-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-heading text-[13px] font-semibold text-foreground-950">Approval rate by form type</h3>
              <p className="text-[11px] text-foreground-500">Share of reviews approved on both checks</p>
            </div>
            <span className="hidden rounded-md bg-background-100 px-2 py-1 text-[10px] font-semibold text-foreground-600 md:inline">0–100%</span>
          </div>

          {barData.length === 0 ? (
            <div className="flex h-[220px] flex-col items-center justify-center gap-1 text-center">
              <i className="ri-bar-chart-horizontal-line text-[26px] text-foreground-300" aria-hidden />
              <p className="text-[12px] font-medium text-foreground-600">Nothing to compare yet</p>
              <p className="text-[11px] text-foreground-400">Approval rates appear once reviews are in scope.</p>
            </div>
          ) : (
            <div className="mt-2 w-full" style={{ height: Math.max(210, barData.length * 36) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 34, left: 0, bottom: 0 }}>
                  <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 10, fill: "oklch(var(--foreground-400))" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={168} tick={{ fontSize: 10, fill: "oklch(var(--foreground-600))" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "oklch(var(--background-100))" }} />
                  <Bar dataKey="rate" name="Approval rate" fill="oklch(var(--primary-500))" radius={[0, 4, 4, 0]} barSize={12}>
                    <LabelList dataKey="rate" position="right" formatter={(value) => `${value}%`} style={{ fontSize: 10, fill: "oklch(var(--foreground-500))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
