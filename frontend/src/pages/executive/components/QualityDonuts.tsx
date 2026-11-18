import { memo } from "react";
import DonutChart, { type DonutDatum } from "@/components/qms/DonutChart";
import { countFeedbackClassifications, formatNumber } from "@/lib/qms";
import type { QualityRecord } from "@/types/qms";
import styles from "../ExecutiveOverview.module.css";

const FORM_COLORS = [
  "oklch(var(--primary-600))",
  "oklch(var(--secondary-600))",
  "oklch(var(--accent-600))",
  "oklch(var(--primary-400))",
  "oklch(var(--secondary-400))",
];

const RAG_COLORS = {
  gold: "#b58a1c",
  green: "#2f8f57",
  amber: "#d98a2b",
  red: "#c65353",
  na: "#8d86b6",
} as const;

const RAG_ITEMS = [
  { key: "gold", label: "Gold", color: RAG_COLORS.gold },
  { key: "green", label: "Green", color: RAG_COLORS.green },
  { key: "amber", label: "Amber", color: RAG_COLORS.amber },
  { key: "red", label: "Red", color: RAG_COLORS.red },
  { key: "na", label: "Not applicable", color: RAG_COLORS.na },
] as const;

const FEEDBACK_ITEMS = [
  { key: "positive", label: "Positive", color: RAG_COLORS.green },
  { key: "neutral", label: "Neutral", color: RAG_COLORS.amber },
  { key: "negative", label: "Negative", color: RAG_COLORS.red },
] as const;

function qualityRagItems(records: QualityRecord[]): DonutDatum[] {
  const counts = { gold: 0, green: 0, amber: 0, red: 0, na: 0 };
  records.forEach((record) => {
    counts.gold += record.ratingCounts?.gold ?? 0;
    counts.green += record.ratingCounts?.green ?? 0;
    counts.amber += record.ratingCounts?.amber ?? 0;
    counts.red += record.ratingCounts?.red ?? 0;
    counts.na += record.ratingCounts?.na ?? 0;
  });
  return RAG_ITEMS.map((item) => ({ ...item, value: counts[item.key] }));
}

function feedbackItems(records: QualityRecord[]): DonutDatum[] {
  const counts = countFeedbackClassifications(records);
  return FEEDBACK_ITEMS.map((item) => ({ ...item, value: counts[item.key] }));
}

function formItems(records: QualityRecord[]): DonutDatum[] {
  const counts = new Map<string, number>();
  records.forEach(record => counts.set(record.formName, (counts.get(record.formName) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], index) => ({
      label,
      value,
      color: FORM_COLORS[index % FORM_COLORS.length],
    }));
}

function leadPercentage(items: DonutDatum[]) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return total ? `${Math.round((items[0].value / total) * 100)}%` : "—";
}

function RatingCard({
  title,
  description,
  items,
  centerLabel,
  footer,
  ariaLabel,
  centerValue,
  available = true,
}: {
  title: string;
  description: string;
  items: DonutDatum[];
  centerLabel: string;
  footer: string;
  ariaLabel: string;
  centerValue?: string;
  available?: boolean;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <section className={styles.ratingCard} aria-label={title}>
      <h2 className="font-heading text-[15px] font-semibold text-foreground-950">{title}</h2>
      <p className="mt-0.5 text-[12px] leading-relaxed text-foreground-600">{description}</p>
      {!available ? <p className="mt-4 border-t border-background-200 pt-4 text-[12px] text-foreground-600">Feedback rating data is unavailable.</p> : <>
      <div className="mt-4 border-t border-background-200 pt-4">
        <DonutChart
          data={items}
          centerValue={centerValue ?? leadPercentage(items)}
          centerLabel={centerLabel}
          ariaLabel={ariaLabel}
          showAllItems
        />
      </div>
      <p className="mt-4 border-t border-background-200 pt-3 text-[11px] text-foreground-600">
        {total ? `${formatNumber(total)} ${footer}` : `No ${footer} returned`}
      </p>
      </>}
    </section>
  );
}

function QualityDonuts({
  records,
  selectedCoach,
  selectedTutor,
  feedbackAvailable,
}: {
  records: QualityRecord[];
  selectedCoach: string;
  selectedTutor: string;
  feedbackAvailable: boolean;
}) {
  const qualityRecords = records.filter((record) => record.category === "Quality Audit");
  const qualityItems = qualityRagItems(qualityRecords);
  const feedbackStatusItems = feedbackItems(records);
  const formRecordItems = formItems(records);
  const coachLabel = selectedCoach === "All coaches" ? "All coaches" : selectedCoach;
  const tutorLabel = selectedTutor === "All tutors" ? "All tutors" : selectedTutor;

  return (
    <section aria-label="Quality rating dashboard" className={styles.analyticsGrid}>
        <RatingCard
          title="Criterion ratings"
          description={`Stored criteria · ${coachLabel} · ${tutorLabel}`}
          items={qualityItems}
          centerValue={formatNumber(qualityItems.reduce((sum, item) => sum + item.value, 0))}
          centerLabel="criteria"
          footer="criteria with stored ratings"
          ariaLabel="Stored Gold Green Amber Red and Not applicable criterion ratings"
        />
        <RatingCard
          title="Feedback quality"
          description="Feedback classification from saved responses"
          items={feedbackStatusItems}
          centerLabel="POSITIVE"
          footer="feedback responses rated"
          ariaLabel="Feedback positive neutral negative distribution"
          available={feedbackAvailable}
        />
      <section className={`${styles.ratingCard} ${styles.formDistribution}`} aria-label="Quality form records by type">
        <h2 className="font-heading text-[15px] font-semibold text-foreground-950">Quality records by form type</h2>
        <p className="mt-0.5 text-[12px] leading-relaxed text-foreground-600">
          Actual saved records by form, including Monthly Coaching, Progress Review and every registered Quality Form in scope.
        </p>
        <div className="mt-4 border-t border-background-200 pt-4">
          <DonutChart
            data={formRecordItems}
            centerValue={formatNumber(records.length)}
            centerLabel="records"
            emptyLabel="No saved quality records match the selected filters."
            ariaLabel="Saved quality records by form type"
          />
        </div>
      </section>
    </section>
  );
}

export default memo(QualityDonuts);
