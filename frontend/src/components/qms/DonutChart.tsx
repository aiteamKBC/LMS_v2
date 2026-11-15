import { formatNumber, formatPct } from "@/lib/qms";

export interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  data: DonutDatum[];
  centerLabel: string;
  centerValue?: string;
  emptyLabel?: string;
  ariaLabel: string;
  showAllItems?: boolean;
  showValues?: boolean;
}

function gradientFor(data: DonutDatum[]) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total) return "oklch(var(--background-300))";

  let cursor = 0;
  const stops = data
    .filter((item) => item.value > 0)
    .map((item) => {
      const start = (cursor / total) * 100;
      cursor += item.value;
      const end = (cursor / total) * 100;
      return `${item.color} ${start}% ${end}%`;
    })
    .join(", ");
  return `conic-gradient(${stops})`;
}

export default function DonutChart({
  data,
  centerLabel,
  centerValue,
  emptyLabel = "No records in scope",
  ariaLabel,
  showAllItems = false,
  showValues = true,
}: DonutChartProps) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const visible = showAllItems ? data : data.filter((item) => item.value > 0);

  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-4">
      <div
        className="relative h-36 w-36 shrink-0 rounded-full"
        style={{ background: gradientFor(data) }}
        role="img"
        aria-label={ariaLabel}
      >
        <div className="absolute inset-3 flex flex-col items-center justify-center rounded-full bg-background-50 text-center">
          <span className="font-heading text-[24px] font-semibold leading-none text-foreground-950">
            {centerValue ?? formatNumber(total)}
          </span>
          <span className="mt-1 max-w-[5rem] text-[10.5px] leading-tight text-foreground-500">
            {centerLabel}
          </span>
        </div>
      </div>

      <div className="min-w-0">
        {visible.length ? (
          <ul className="space-y-2">
            {visible.map((item) => (
              <li key={item.label} className="flex items-center justify-between gap-3 text-[12px]">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />
                  <span className="truncate text-foreground-700">{item.label}</span>
                </span>
                <span className="shrink-0 font-label font-semibold text-foreground-900">
                  {showValues ? formatNumber(item.value) : null}
                  <span className={showValues ? "ml-1 font-normal text-foreground-500" : "font-normal text-foreground-500"}>
                    {total ? formatPct((item.value / total) * 100) : "—"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] leading-relaxed text-foreground-600">{emptyLabel}</p>
        )}
      </div>
    </div>
  );
}
