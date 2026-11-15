import { FORM_POLICIES, FORM_REGISTRY } from "@/mocks/formRegistry";
import type { CoachSession, CriterionState, FormRegistryEntry, QualityStatus, RagPolicy, RagResult } from "@/pages/dashboard/types";

/**
 * RAG evaluation engine.
 *
 * Rule of the engine: it never decides a rating on its own. It only applies the
 * policy that has been approved for that specific form type. If no policy is
 * approved, the record stays "Not assessed" — it is never assumed Green.
 */

export const QUALITY_STATUS_LABEL: Record<QualityStatus, string> = {
  Green: "Green — meets standard",
  Amber: "Amber — improvement required",
  Red: "Red — critical concern",
  "Not assessed": "Grey — not assessed",
  "Not applicable": "Grey — not applicable",
};

/** Fallback used when a form type has no approved policy at all. */
const UNRATED_POLICY: RagPolicy = {
  id: "pol-unrated",
  version: "—",
  method: "unrated",
  summary: "No evaluation policy has been approved for this form type.",
  criticalCriteria: [],
  redAtFails: 99,
  amberAtIssues: 99,
  requireFullReview: true,
};

export const getPolicy = (policyId: string): RagPolicy => FORM_POLICIES.find((policy) => policy.id === policyId) ?? UNRATED_POLICY;

export const formForName = (name: string): FormRegistryEntry | null => FORM_REGISTRY.find((form) => form.name === name) ?? null;

export const policyForForm = (form: FormRegistryEntry | null): RagPolicy => (form ? getPolicy(form.policyId) : UNRATED_POLICY);

export const hasApprovedPolicy = (policy: RagPolicy): boolean => policy.method !== "unrated";

/** Plain-English description of what a policy does, ready to be shown to staff. */
export const describePolicy = (policy: RagPolicy): string[] => {
  if (policy.method === "unrated") {
    return ["No approved scoring policy. Records stay Not assessed until a policy is approved and published."];
  }

  const lines: string[] = [];
  if (policy.requireFullReview) {
    lines.push("Every criterion must be reviewed before a rating is calculated.");
  }
  lines.push(`Red when ${policy.redAtFails} or more criteria fail.`);
  lines.push(`Amber when ${policy.amberAtIssues} or more criteria fail or need improvement.`);
  if (policy.criticalCriteria.length > 0) {
    lines.push(`Red immediately if criterion ${policy.criticalCriteria.join(" or ")} fails. A critical failure is never offset by other satisfactory answers.`);
  }
  return lines;
};

export const evaluateCriteria = (criteria: CriterionState[], policy: RagPolicy): RagResult => {
  const base = { policyId: policy.id, policyVersion: policy.version };

  if (policy.method === "unrated") {
    return {
      ...base,
      status: "Not assessed",
      label: QUALITY_STATUS_LABEL["Not assessed"],
      reason: "No approved evaluation policy exists for this form type, so no rating is calculated.",
    };
  }

  if (criteria.length === 0) {
    return {
      ...base,
      status: "Not assessed",
      label: QUALITY_STATUS_LABEL["Not assessed"],
      reason: "No criteria have been recorded against this record, so there is not enough evidence to rate it.",
    };
  }

  const reviewed = criteria.filter((state) => state !== "Not Checked").length;

  if (policy.requireFullReview && reviewed < criteria.length) {
    return {
      ...base,
      status: "Not assessed",
      label: QUALITY_STATUS_LABEL["Not assessed"],
      reason: `${reviewed} of ${criteria.length} criteria reviewed. A complete review is required before a rating is calculated.`,
    };
  }

  const fails = criteria.filter((state) => state === "Fail").length;
  const issues = criteria.filter((state) => state === "Fail" || state === "Needs Improvement").length;
  const criticalFailed = policy.criticalCriteria.filter((position) => criteria[position - 1] === "Fail");

  if (criticalFailed.length > 0) {
    return {
      ...base,
      status: "Red",
      label: QUALITY_STATUS_LABEL.Red,
      reason: `Critical criterion ${criticalFailed.join(", ")} failed. Critical failures are never averaged out by satisfactory answers elsewhere.`,
    };
  }

  if (fails >= policy.redAtFails) {
    return {
      ...base,
      status: "Red",
      label: QUALITY_STATUS_LABEL.Red,
      reason: `${fails} criteria failed, which is at or above the Red threshold for this form type (${policy.redAtFails}).`,
    };
  }

  if (issues >= policy.amberAtIssues) {
    return {
      ...base,
      status: "Amber",
      label: QUALITY_STATUS_LABEL.Amber,
      reason: `${issues} criteria failed or need improvement, which meets the Amber threshold for this form type (${policy.amberAtIssues}).`,
    };
  }

  return {
    ...base,
    status: "Green",
    label: QUALITY_STATUS_LABEL.Green,
    reason: `All ${reviewed} reviewed criteria meet the standard for this form type.`,
  };
};

/**
 * Quality outcome for a coaching session.
 * A recorded official decision is always preserved. The policy only fills the gap
 * where no decision exists yet.
 */
export const qualityForSession = (session: CoachSession): RagResult => {
  const policy = policyForForm(formForName(session.formType));
  const base = { policyId: policy.id, policyVersion: policy.version };

  if (session.status === "Scheduled") {
    return {
      ...base,
      status: "Not applicable",
      label: QUALITY_STATUS_LABEL["Not applicable"],
      reason: "This session is scheduled. No form has been submitted, so there is nothing to assess.",
    };
  }

  if (session.status === "Approved") {
    return { ...base, status: "Green", label: QUALITY_STATUS_LABEL.Green, reason: "Official quality decision recorded by the quality team: approved." };
  }

  if (session.status === "Needs correction") {
    return { ...base, status: "Amber", label: QUALITY_STATUS_LABEL.Amber, reason: "Official quality decision recorded by the quality team: needs correction." };
  }

  if (session.status === "Rejected") {
    return { ...base, status: "Red", label: QUALITY_STATUS_LABEL.Red, reason: "Official quality decision recorded by the quality team: rejected." };
  }

  return evaluateCriteria(session.criteria, policy);
};

/** Counts of each outcome, always including the two "no rating" states. */
export const emptyStatusCount = (): Record<QualityStatus, number> => ({
  Green: 0,
  Amber: 0,
  Red: 0,
  "Not assessed": 0,
  "Not applicable": 0,
});
