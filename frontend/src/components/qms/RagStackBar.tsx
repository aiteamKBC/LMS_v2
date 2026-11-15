import type { RagCounts, RagStatus } from "@/types/qms";
import { RAG_META, RAG_ORDER, assessedTotal, formatNumber, formatPct } from "@/lib/qms";

interface RagStackBarProps {
  counts: RagCounts;
  showLegend?: boolean;
  compact?: boolean;
  label?: string;
}

const BAR_COLOR: Record<RagStatus, string> = {
  green: "bg-[var(--rag-green-ink)]",
  amber: "bg-[var(--rag-amber-ink)]",
  red: "bg-[var(--rag-red-ink)]",
  unrated: "bg-[var(--rag-grey-ink)]",
  na: "bg-[var(--rag-grey-ink)]",
};

export default function RagStackBar({
  counts,
  showLegend = true,
  compact = false,
  label = "Quality status distribution",
}: RagStackBarProps) {
  const visible = RAG_ORDER.filter((status) => counts[status] > 0);
  const total = counts.total || 1;
  const assessed = assessedTotal(counts);

  return (
    <div>
      <div
        className={`flex w-full overflow-hidden rounded-full bg-background-200 ${
          compact ? "h-1.5" : "h-2.5"
        }`}
        role="img"
        aria-label={`${label}: ${visible
          .map((status) => `${RAG_META[status].label} ${counts[status]}`)
          .join(", ")}`}
      >
        {visible.map((status) => (
          <span
            key={status}
            className={`${BAR_COLOR[status]} h-full`}
            style={{ width: `${(counts[status] / total) * 100}%` }}
          />
        ))}
      </div>

      {showLegend ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 lg:grid-cols-4">
          {(["green", "amber", "red"] as RagStatus[]).map((status) => (
            <div key={status} className="flex items-start gap-2">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${BAR_COLOR[status]}`}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <dt className="font-label text-[11px] font-medium uppercase tracking-[0.06em] text-foreground-600">
                  {RAG_META[status].label}
                </dt>
                <dd className="font-heading text-[17px] font-semibold leading-tight text-foreground-950">
                  {formatNumber(counts[status])}
                  <span className="ml-1 font-label text-[11px] font-medium text-foreground-500">
                    {assessed ? formatPct((counts[status] / assessed) * 100) : "—"}
                  </span>
                </dd>
              </div>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

