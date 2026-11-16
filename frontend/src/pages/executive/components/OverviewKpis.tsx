import KpiCard from "@/components/base/KpiCard";
import { TIME_ZONE_LABEL, todayIso } from "@/pages/curriculum/recordings/utils";
import {
  countByRag,
  formatNumber,
  formatPct,
  isOpenAction,
} from "@/lib/qms";
import type { FormDefinition, QualityAction, QualityRecord } from "@/types/qms";

interface OverviewKpisProps {
  records: QualityRecord[];
  actions: QualityAction[];
  forms: FormDefinition[];
  availability: { actions: boolean; criticalIssues: boolean; feedback: boolean };
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
  const counts = countByRag(records);
  const critical = records.filter((record) => record.critical && record.rag === "red");
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard
          label="Completed audits"
          value={formatNumber(audits.length)}
          definition="Quality audits with a recorded submission date in the period."
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
          to="/engagement/feedbacks"
          linkLabel="View feedback"
        />

        <KpiCard
          label="Critical issues"
          value={availability.criticalIssues ? formatNumber(critical.length) : '—'}
          definition="Red outcomes with a critical compliance concern flagged."
          hint={!availability.criticalIssues ? 'Critical issue data is unavailable' : critical.length ? "Immediate review or escalation required" : "No critical concerns in scope"}
          icon="ri-alert-line"
          accent={availability.criticalIssues ? 'critical' : 'secondary'}
          to="/qa/escalations"
          linkLabel="Review critical actions"
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
          definition="Records without an approved evaluation policy."
          hint="Reported descriptively only — never banded"
          icon="ri-question-line"
          accent="secondary"
          to="/curriculum/coaching-recordings/reviews"
          linkLabel="See quality checks"
        />
      </div>
    </section>
  );
}
