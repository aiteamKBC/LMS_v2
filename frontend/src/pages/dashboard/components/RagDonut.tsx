import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { StatusDot } from "@/components/ui/StatusBadge";
import { RAG_COLORS } from "@/pages/dashboard/constants";
import type { RagLevel, RagSlice } from "@/pages/dashboard/types";
import { pct } from "@/pages/dashboard/utils";

const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid oklch(var(--background-300))",
  background: "oklch(var(--background-50))",
  fontSize: 11,
  color: "oklch(var(--foreground-900))",
  padding: "6px 8px",
};

const ROWS: { label: RagLevel; key: keyof RagSlice }[] = [
  { label: "Green", key: "green" },
  { label: "Amber", key: "amber" },
  { label: "Red", key: "red" },
];

type Props = {
  title: string;
  caption: string;
  slices: RagSlice;
  centerLabel?: string;
  onSelectRag?: (level: RagLevel) => void;
};

export default function RagDonut({ title, caption, slices, centerLabel = "checks", onSelectRag }: Props) {
  const total = slices.green + slices.amber + slices.red;
  const segments = ROWS.map((row) => ({ name: row.label, value: slices[row.key], color: RAG_COLORS[row.label] })).filter((item) => item.value > 0);
  const greenShare = pct(slices.green, total);

  return (
    <article className="flex flex-col rounded-lg border border-background-200 bg-background-50 p-4">
      <div>
        <h3 className="font-heading text-[13px] font-semibold text-foreground-950">{title}</h3>
        <p className="mt-0.5 text-[11px] leading-snug text-foreground-500">{caption}</p>
      </div>

      {total === 0 ? (
        <div className="flex h-[210px] flex-col items-center justify-center gap-1 text-center">
          <i className="ri-pie-chart-2-line text-[24px] text-foreground-300" aria-hidden />
          <p className="text-[11.5px] font-medium text-foreground-600">No issues recorded</p>
        </div>
      ) : (
        <>
          <div className="relative mt-1 h-[164px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={segments} dataKey="value" nameKey="name" innerRadius={50} outerRadius={74} paddingAngle={2} stroke="none" startAngle={90} endAngle={-270}>
                  {segments.map((item) => (
                    <Cell
                      key={item.name}
                      fill={item.color}
                      onClick={onSelectRag ? () => onSelectRag(item.name as RagLevel) : undefined}
                      style={{ cursor: onSelectRag ? "pointer" : "default", outline: "none" }}
                    />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [`${value} (${pct(Number(value), total)}%)`, String(name)]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-heading text-[23px] font-semibold leading-none tabular-nums text-foreground-950">{greenShare}%</span>
              <span className="mt-1 text-[9.5px] uppercase tracking-[0.12em] text-foreground-400">{centerLabel === "checks" ? "green" : centerLabel}</span>
            </div>
          </div>

          <ul className="mt-1 flex flex-col gap-0.5">
            {ROWS.map((row) => {
              const value = slices[row.key];
              const body = (
                <>
                  <StatusDot status={row.label} className="h-2 w-2" />
                  <span className="flex-1 text-left text-foreground-600">{row.label}</span>
                  <span className="tabular-nums text-foreground-500">{value}</span>
                  <span className="w-9 text-right font-semibold tabular-nums text-foreground-900">{pct(value, total)}%</span>
                  {onSelectRag ? <i className="ri-arrow-right-s-line text-[12px] text-foreground-300" aria-hidden /> : null}
                </>
              );
              return (
                <li key={row.label}>
                  {onSelectRag ? (
                    <button
                      type="button"
                      onClick={() => onSelectRag(row.label)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[11.5px] transition-colors hover:bg-background-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200"
                      title={`Open ${row.label.toLowerCase()} reviews in the queue`}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 px-1.5 py-1 text-[11.5px]">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-2.5 border-t border-background-100 pt-2 text-[10.5px] text-foreground-500">
            {total} {centerLabel === "checks" ? "checks rated" : `${centerLabel} recorded`}
          </p>
        </>
      )}
    </article>
  );
}
