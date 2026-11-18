import { memo } from "react";
import Panel from "@/components/base/Panel";
import RagStackBar from "@/components/qms/RagStackBar";
import { assessedTotal, formatNumber, formatPct, groupRagByCategory } from "@/lib/qms";
import type { QualityRecord } from "@/types/qms";

function CategoryRag({ records }: { records: QualityRecord[] }) {
  const groups = groupRagByCategory(records);
  const max = groups.reduce((top, group) => Math.max(top, group.counts.total), 1);

  return (
    <Panel
      title="Status by form category"
      description="Each category keeps its own policy and thresholds."
      className="h-full"
      headingId="category-rag-heading"
    >
      {groups.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-foreground-600">
          No records match the selected filters.
        </p>
      ) : (
        <ul className="space-y-4">
          {groups.map((group) => {
            const assessed = assessedTotal(group.counts);
            const redShare = assessed ? (group.counts.red / assessed) * 100 : 0;
            return (
              <li key={group.category}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate font-label text-[12.5px] font-medium text-foreground-900">
                    {group.category}
                  </p>
                  <p className="shrink-0 font-label text-[11px] text-foreground-500">
                    {formatNumber(group.counts.total)} records
                  </p>
                </div>
                <div className="mt-1.5" style={{ width: `${Math.max(58, (group.counts.total / max) * 100)}%` }}>
                  <RagStackBar
                    counts={group.counts}
                    showLegend={false}
                    compact
                    label={`${group.category} status distribution`}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-foreground-600">
                  {assessed ? (
                    <>
                      <span className="font-semibold text-foreground-900">
                        {formatNumber(group.counts.red)} red
                      </span>{" "}
                      · {formatPct(redShare)} of {formatNumber(assessed)} assessed
                      {group.counts.unrated + group.counts.na > 0 ? (
                        <> · {formatNumber(group.counts.unrated + group.counts.na)} not assessed</>
                      ) : null}
                    </>
                  ) : (
                    <>Not assessed — no approved policy for this category</>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export default memo(CategoryRag);
