import { memo } from "react";
import Panel from "@/components/base/Panel";
import { countFeedbackClassifications, formatNumber } from "@/lib/qms";
import type { QualityRecord } from "@/types/qms";

interface HealthOverviewProps {
  records: QualityRecord[];
  availability: { feedbackScores?: boolean };
}

function HealthOverview({ records, availability }: HealthOverviewProps) {
  const feedback = countFeedbackClassifications(records);
  const scoredFeedback = feedback.positive + feedback.neutral + feedback.negative;
  const feedbackCards = [
    { label: "Positive", value: feedback.positive, tone: "border-emerald-100 bg-emerald-50 text-emerald-800" },
    { label: "Neutral", value: feedback.neutral, tone: "border-amber-100 bg-amber-50 text-amber-800" },
    { label: "Negative", value: feedback.negative, tone: "border-rose-100 bg-rose-50 text-rose-800" },
  ];

  return (
    <Panel
      title="Quality health overview"
      description="Feedback response classifications for the current filters."
      className="h-full"
      headingId="health-overview-heading"
    >
      <section aria-label="Feedback response health" className="rounded-xl border border-background-200 bg-background-50 p-4">
        <h3 className="text-[13px] font-semibold text-foreground-950">Feedback from ordinary forms</h3>
        <p className="mt-1 text-[11.5px] text-foreground-600">Completed responses, classified from their saved answers.</p>
        {availability.feedbackScores ? <>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {feedbackCards.map(card => <div key={card.label} className={`rounded-lg border p-3 ${card.tone}`}>
              <p className="text-[11px] font-semibold">{card.label}</p>
              <p className="mt-1 text-xl font-semibold">{formatNumber(card.value)}</p>
            </div>)}
          </div>
          <p className="mt-2 text-[11px] text-foreground-600">
            {scoredFeedback ? `${formatNumber(scoredFeedback)} scored responses in scope` : "No scored feedback responses in scope"}
            {feedback.unscored ? ` · ${formatNumber(feedback.unscored)} unscored` : ""}
            {feedback.unclassified ? ` · ${formatNumber(feedback.unclassified)} without a classification` : ""}
          </p>
        </> : <p className="mt-3 text-[12px] text-foreground-600">Feedback classification data is unavailable.</p>}
      </section>
    </Panel>
  );
}

export default memo(HealthOverview);
