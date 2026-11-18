import KpiCard from "@/components/base/KpiCard";
import { TIME_ZONE_LABEL, todayIso } from "@/pages/curriculum/recordings/utils";
import {
  assessedTotal,
  countByRag,
  formatNumber,
  formatPct,
  isOpenAction,
} from "@/lib/qms";
import type { FormDefinition, QualityAction, QualityRecord } from "@/types/qms";
import styles from "../ExecutiveOverview.module.css";

interface OverviewKpisProps {
  records: QualityRecord[];
  actions: QualityAction[];
  forms: FormDefinition[];
  availability: { actions: boolean; criticalIssues: boolean; feedback: boolean; feedbackScores: boolean };
  onOpenAuditTypes?: () => void;
}

export default function OverviewKpis({ records, actions, forms, availability, onOpenAuditTypes }: OverviewKpisProps) {
  const today = todayIso(TIME_ZONE_LABEL);
  const audits = records.filter(
    (record) => record.category === "Quality Audit" && record.reviewStatus === "completed",
  );
  const feedback = records.filter(
    (record) => record.respondentType === "Learner" || record.respondentType === "Employer",
  );
  const feedbackToReview = feedback.filter(
    (record) => record.feedbackClassification === "neutral" || record.feedbackClassification === "negative",
  ).length;
  const criticalFeedback = feedback.filter((record) => record.feedbackClassification === "negative").length;
  const counts = countByRag(records);
  const assessed = assessedTotal(counts);
  const completedNotAssessed = records.filter(
    (record) => record.reviewStatus === "completed" && ["unrated", "na"].includes(record.rag),
  ).length;
  const openActions = actions.filter(isOpenAction);
  const overdueActions = openActions.filter(
    (action) => action.status === "Overdue" || action.dueOn < today,
  );

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
      <div className={styles.kpiGrid}>
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
          label="Assessed records"
          value={formatNumber(assessed)}
          definition="Records with an approved policy outcome: Green, Amber or Red."
          hint={records.length ? `${formatPct((assessed / records.length) * 100)} of in-scope records` : "No records in scope"}
          icon="ri-shield-check-line"
          accent="primary"
          to="/curriculum/quality-demo?view=checks"
          linkLabel="View quality checks"
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
          to="/curriculum/quality-demo?view=feedbacks"
          linkLabel="Review feedback"
        />

        <KpiCard
          label="Critical feedback"
          value={availability.feedbackScores ? formatNumber(criticalFeedback) : '—'}
          definition="Negative scored feedback needing immediate review. This is a feedback classification, not an Assessed policy outcome."
          hint={!availability.feedbackScores ? 'Feedback classification data is unavailable' : criticalFeedback ? "Open the original responses to review" : "No Negative feedback in scope"}
          icon="ri-alert-line"
          accent={criticalFeedback ? 'critical' : 'secondary'}
          to="/curriculum/quality-demo?view=feedbacks&classification=negative"
          linkLabel="Review critical feedback"
        />

        <KpiCard
          label="Open actions"
          value={availability.actions ? formatNumber(openActions.length) : '—'}
          definition="Improvement actions not yet resolved or closed."
          hint={availability.actions ? `${overdueActions.length} past target date` : 'Action status data is unavailable'}
          icon="ri-task-line"
          accent={overdueActions.length ? "accent" : "secondary"}
          to="/qa/findings"
          linkLabel="Open action tracker"
        />

        <KpiCard
          label="Not assessed"
          value={formatNumber(counts.unrated + counts.na)}
          definition="Records without a Green, Amber or Red policy outcome."
          hint={completedNotAssessed
            ? `${formatNumber(completedNotAssessed)} completed record${completedNotAssessed === 1 ? "" : "s"} still has no policy outcome`
            : "Includes drafts and records without an approved policy"}
          icon="ri-question-line"
          accent="secondary"
          to="/curriculum/quality-demo?view=checks"
          linkLabel="See quality checks"
        />

      </div>
    </section>
  );
}

