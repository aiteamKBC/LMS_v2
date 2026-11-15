import Panel from "@/components/base/Panel";
import RagStackBar from "@/components/qms/RagStackBar";
import {
  assessedTotal,
  countByRag,
  formatNumber,
  formatPct,
  isOpenAction,
  share,
} from "@/lib/qms";
import type { QualityAction, QualityRecord } from "@/types/qms";

interface HealthOverviewProps {
  records: QualityRecord[];
  actions: QualityAction[];
}

export default function HealthOverview({ records, actions }: HealthOverviewProps) {
  const counts = countByRag(records);
  const assessed = assessedTotal(counts);
  const coverage = records.length ? (assessed / records.length) * 100 : 0;
  const unratedForms = Object.entries(
    records
      .filter((record) => record.rag === "unrated" || record.rag === "na")
      .reduce<Record<string, number>>((acc, record) => {
        acc[record.formName] = (acc[record.formName] || 0) + 1;
        return acc;
      }, {}),
  ).sort((a, b) => b[1] - a[1]);

  const critical = records.filter((record) => record.critical && record.rag === "red");
  const criticalActionIds = new Set(critical.map((record) => record.id));
  const linkedActions = actions.filter(
    (action) => criticalActionIds.has(action.recordId) && isOpenAction(action),
  );

  return (
    <Panel
      title="Quality health overview"
      description="Status mix across every registered form in scope. Findings stay separated by form type and policy version."
      className="h-full"
      headingId="health-overview-heading"
    >
      <RagStackBar counts={counts} label="Status mix for filtered quality records" />

      <div className="mt-4 grid grid-cols-1 gap-3 border-t border-background-200 pt-4 sm:grid-cols-3">
        <div>
          <p className="font-label text-[10.5px] font-semibold uppercase tracking-[0.09em] text-foreground-600">
            Assessed coverage
          </p>
          <p className="mt-1 font-heading text-[22px] font-semibold leading-none text-foreground-950">
            {formatPct(coverage)}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-foreground-600">
            {formatNumber(assessed)} of {formatNumber(records.length)} records carry a policy outcome
          </p>
        </div>

        <div className="border-t border-background-200 pt-3 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
          <p className="font-label text-[10.5px] font-semibold uppercase tracking-[0.09em] text-foreground-600">
            Not assessed
          </p>
          <p className="mt-1 font-heading text-[22px] font-semibold leading-none text-foreground-950">
            {formatNumber(counts.unrated + counts.na)}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-foreground-600">
            {unratedForms.length
              ? unratedForms.slice(0, 2).map(([name, total]) => `${name.replace(" — ", " ")} (${total})`).join(" · ")
              : "Every form in scope has an approved policy"}
          </p>
        </div>

        <div className="border-t border-background-200 pt-3 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
          <p className="font-label text-[10.5px] font-semibold uppercase tracking-[0.09em] text-foreground-600">
            Critical risk
          </p>
          <p className="mt-1 font-heading text-[22px] font-semibold leading-none text-[var(--rag-red-fg)]">
            {formatNumber(critical.length)}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-foreground-600">
            {critical.length
              ? `${linkedActions.length} linked open action${linkedActions.length === 1 ? "" : "s"}`
              : "No critical red outcomes in scope"}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg bg-secondary-100/70 px-3 py-2.5">
        <i className="ri-information-line mt-0.5 text-[14px] text-secondary-700" aria-hidden="true" />
        <p className="text-[11.5px] leading-relaxed text-secondary-900">
          No blended organisation-wide percentage is produced. Red{" "}
          {formatPct(share(counts, "red"), 1)} of assessed records; averaging unrelated forms would hide
          critical findings behind satisfactory ones.
        </p>
      </div>
    </Panel>
  );
}

