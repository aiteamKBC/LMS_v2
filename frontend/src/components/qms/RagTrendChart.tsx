import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthlyPoint } from "@/lib/qms";

interface RagTrendChartProps {
  data: MonthlyPoint[];
}

const SERIES = [
  { key: "green", label: "Green — meets standard", color: "#2f8f57" },
  { key: "amber", label: "Amber — improvement required", color: "#d98a2b" },
  { key: "red", label: "Red — critical concern", color: "#c65353" },
  { key: "unrated", label: "Not assessed", color: "#8c86b8" },
] as const;

function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  const total = payload.reduce((sum: number, item: any) => sum + (item.value || 0), 0);

  return (
    <div className="rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[12px]">
      <p className="font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-600">
        {label}
      </p>
      <ul className="mt-1.5 space-y-1">
        {payload.map((item: any) => (
          <li key={item.dataKey} className="flex items-center gap-2 text-foreground-800">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: item.color }}
              aria-hidden="true"
            />
            <span className="min-w-[104px]">{item.name}</span>
            <span className="ml-auto font-semibold">{item.value}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 border-t border-background-200 pt-1.5 text-foreground-600">
        Total records: <span className="font-semibold text-foreground-900">{total}</span>
      </p>
    </div>
  );
}

export default function RagTrendChart({ data }: RagTrendChartProps) {
  return (
    <div>
      <ul className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {SERIES.map((series) => (
          <li
            key={series.key}
            className="flex items-center gap-1.5 font-label text-[11.5px] text-foreground-700"
          >
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: series.color }}
              aria-hidden="true"
            />
            {series.label}
          </li>
        ))}
      </ul>

      <div
        className="w-full"
        role="img"
        aria-label={`Monthly quality record volume by status, ${data.length} months. ${data
          .map((point) => `${point.label}: ${point.total} records`)
          .join(", ")}.`}
      >
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 42, left: -18 }}>
            <CartesianGrid stroke="oklch(var(--background-200))" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "oklch(var(--foreground-600))", fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: "oklch(var(--background-300))" }}
              interval={0}
              angle={-35}
              textAnchor="end"
              height={58}
            />
            <YAxis
              tick={{ fill: "oklch(var(--foreground-600))", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={44}
            />
            <Tooltip content={<TrendTooltip />} cursor={{ stroke: "oklch(var(--background-300))", strokeDasharray: "4 4" }} />
            {SERIES.map((series) => (
              <Line
                key={series.key}
                dataKey={series.key}
                name={series.label}
                type="monotone"
                stroke={series.color}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "oklch(var(--background-50))" }}
                connectNulls
              />
            ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

