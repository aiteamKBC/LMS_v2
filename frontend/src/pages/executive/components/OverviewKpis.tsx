import { memo, type ReactNode } from "react";
import KpiCard from "@/components/base/KpiCard";
import criticalStyles from "./CriticalCard.module.css";
import followUpStyles from "./FollowUpCards.module.css";
import {
  countFeedbackClassifications,
  formatNumber,
  formatPct,
} from "@/lib/qms";
import type { FormDefinition, QualityAction, QualityRecord } from "@/types/qms";
import styles from "../ExecutiveOverview.module.css";

interface OverviewKpisProps {
  records: QualityRecord[];
  actions: QualityAction[];
  forms: FormDefinition[];
  availability: { actions: boolean; criticalIssues: boolean; feedback: boolean; feedbackScores: boolean };
  onOpenAuditTypes?: () => void;
  attentionPanel?: ReactNode;
}

function OverviewKpis({ records, forms, availability, onOpenAuditTypes, attentionPanel }: OverviewKpisProps) {
  const audits = records.filter(
    (record) => record.category === "Quality Audit" && record.reviewStatus === "completed",
  );
  const feedback = records.filter(
    (record) => record.category === "Learner Feedback" || record.category === "Employer Feedback",
  );
  const feedbackClasses = countFeedbackClassifications(feedback);
  const feedbackToReview = feedbackClasses.neutral + feedbackClasses.negative;
  const criticalFeedback = feedbackClasses.negative;

  const auditForms = forms.filter((form) => form.category === "Quality Audit" && form.completionRate);
  const scheduledTotal = auditForms.reduce((sum, form) => sum + form.scheduled, 0);
  const auditCoverage =
    scheduledTotal > 0
      ? (auditForms.reduce((sum, form) => sum + form.scheduled * (form.completionRate || 0), 0) /
          scheduledTotal) *
        100
      : 0;
  const auditCoverageHint =
    scheduledTotal > 0
      ? `Audit coverage ${formatPct(auditCoverage)} of scheduled visits`
      : "Schedule totals are not returned by the current quality API";

  return (
    <section aria-label="Key quality indicators">
      <div className={`${styles.kpiGrid} ${attentionPanel ? styles.withAttention : ""}`}>
        <KpiCard
          label="Completed audits"
          value={formatNumber(audits.length)}
          definition="Quality audits with a completed saved review in the period."
          hint={auditCoverageHint}
          icon="ri-file-shield-2-line"
          accent="primary"
          onLinkClick={onOpenAuditTypes}
          linkLabel="Open audit records"
        />

        <KpiCard
          label="Feedback responses"
          value={availability.feedback ? formatNumber(feedback.length) : '—'}
          definition="Learner and employer form submissions received in the period."
          hint={availability.feedback ? 'Free-text comments never change a RAG status' : 'Feedback response data is unavailable'}
          icon="ri-chat-3-line"
          accent="secondary"
          to="/curriculum/quality-demo?view=feedbacks"
          linkLabel="View feedback"
        />

        <KpiCard
          label="Feedback to review"
          value={availability.feedbackScores ? formatNumber(feedbackToReview) : '—'}
          definition="Negative and Neutral feedback awaiting a quality review; Positive feedback needs no follow-up."
          hint={availability.feedbackScores
            ? feedbackToReview ? "Review the original responses and decide whether follow-up is required" : "No Negative or Neutral feedback in scope"
            : "Feedback classification data is unavailable"}
          icon="ri-alert-line"
          accent={feedbackToReview ? "accent" : "secondary"}
          to="/curriculum/quality-demo?view=feedbacks&classification=review"
          linkLabel="Review feedback"
        />

        <KpiCard
          label="Critical feedback"
          className={`${criticalStyles.card} ${followUpStyles.card} ${followUpStyles.critical}`}
          value={availability.feedbackScores ? formatNumber(criticalFeedback) : '—'}
          definition="Negative scored feedback needing immediate review. This is a feedback classification, not an Assessed policy outcome."
          hint={!availability.feedbackScores ? 'Feedback classification data is unavailable' : criticalFeedback ? "Open the original responses to review" : "No Negative feedback in scope"}
          icon="ri-alert-line"
          accent={criticalFeedback ? 'critical' : 'secondary'}
          to="/curriculum/quality-demo?view=feedbacks&classification=negative"
          linkLabel="Review critical feedback"
        />

        {attentionPanel ? <aside className={`${styles.attentionPanel} ${followUpStyles.attention}`}>{attentionPanel}</aside> : null}
      </div>
    </section>
  );
}

export default memo(OverviewKpis);
