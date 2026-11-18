import type { CheckStatus, Criterion, CriterionState, Filters, FormCategoryId, QualityStatus, RagLevel, SessionStatus } from "@/pages/dashboard/types";

export const FORM_TYPES = [
  "1–1 Progress Review Feedback Form",
  "Commitment Session Feedback Form",
  "First Session Feedback Form",
  "Gateway Review Feedback Form",
  "Information Session Feedback Form",
  "Monthly Coaching Meeting Feedback Form",
  "Teaching Session Feedback Form",
  "Barriers to Learning Feedback Form",
  "British Values Feedback Form",
  "CIAG Feedback Form",
  "EPA Feedback Form",
  "Marking and Feedback Feedback Form",
  "Safeguarding Feedback Form",
  "Target Setting Feedback Form",
];

export const PREVIOUS_PORTFOLIO_FORMS = ["MCM – Previous Form", "PR – Previous Form"];

export const ALL_FORM_TYPES = [...FORM_TYPES, ...PREVIOUS_PORTFOLIO_FORMS];

export const PROGRAMMES = [
  "Digital Marketing L3",
  "Business Administration L3",
  "Health & Social Care L2",
  "Engineering Technician L4",
  "Customer Service L2",
];

export const COHORTS = ["DM-2409", "BA-2405", "HSC-2501", "ENG-2403", "CS-2506"];

export const DATE_RANGES = [
  { value: "all", label: "All time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

export const CHECK_STATUSES: CheckStatus[] = ["Pending", "In Review", "Approved", "Needs Correction", "Rejected"];

export const CRITERION_STATES: CriterionState[] = ["Pass", "Fail", "Needs Improvement"];

export const FORMS_CRITERIA: Criterion[] = [
  { id: "f1", label: "Required fields completed" },
  { id: "f2", label: "Correct learner information" },
  { id: "f3", label: "Correct coach information" },
  { id: "f4", label: "Correct meeting information" },
  { id: "f5", label: "Form content complete" },
  { id: "f6", label: "Required evidence attached" },
];

export const FEEDBACK_CRITERIA: Criterion[] = [
  { id: "b1", label: "Feedback completeness" },
  { id: "b2", label: "Feedback clarity" },
  { id: "b3", label: "Relevance to learner progress" },
  { id: "b4", label: "Constructive and actionable feedback" },
  { id: "b5", label: "Evidence provided" },
  { id: "b6", label: "Follow-up actions documented" },
  { id: "b7", label: "Overall feedback quality" },
];

export const EMPTY_FILTERS: Filters = {
  learner: "",
  coach: "",
  formType: "",
  programme: "",
  cohort: "",
  dateRange: "all",
  formStatus: "",
  formCheck: "",
  feedbackCheck: "",
  rag: "",
};

/** Semantic status styling — status colours stay separate from the brand palette. */
export const STATUS_STYLES: Record<CheckStatus, { badge: string; dot: string; ring: string }> = {
  Approved: {
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
    ring: "ring-emerald-200",
  },
  Pending: {
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
    ring: "ring-amber-200",
  },
  Rejected: {
    badge: "bg-red-50 text-red-700 ring-red-200",
    dot: "bg-red-500",
    ring: "ring-red-200",
  },
  "Needs Correction": {
    badge: "bg-orange-50 text-orange-700 ring-orange-200",
    dot: "bg-orange-500",
    ring: "ring-orange-200",
  },
  "In Review": {
    badge: "bg-primary-50 text-primary-700 ring-primary-200",
    dot: "bg-primary-500",
    ring: "ring-primary-200",
  },
};

export const STATUS_CHART_COLORS: Record<CheckStatus, string> = {
  Approved: "oklch(0.70 0.15 155)",
  Pending: "oklch(0.80 0.14 80)",
  Rejected: "oklch(0.63 0.20 25)",
  "Needs Correction": "oklch(0.72 0.17 52)",
  "In Review": "oklch(var(--primary-500))",
};

export const REVIEWER_NAME = "Aisha Rahman";
export const REVIEWER_ROLE = "Quality Assurance Lead";

/**
 * RAG (issues) palette — used for CHART SEGMENTS only (donuts, bars, trend).
 * Mid-tone set: sitting halfway between the deep forest/golden set and the light airy set,
 * so the charts carry weight without looking dark or washed out.
 */
export const RAG_COLORS: Record<RagLevel, string> = {
  Green: "rgb(16 185 129)",
  Amber: "oklch(var(--accent-500))",
  Red: "rgb(239 68 68)",
};

export const RAG_LEVELS: RagLevel[] = ["Green", "Amber", "Red"];

/** Session quality states used by the coach calendar and the quality check form. */
export const SESSION_STATUS_STYLES: Record<SessionStatus, { chip: string; dot: string; cell: string; ring: string }> = {
  Scheduled: {
    chip: "bg-secondary-100 text-secondary-900 ring-secondary-200",
    dot: "bg-secondary-400",
    cell: "border-secondary-200 bg-secondary-50 text-secondary-900 hover:bg-secondary-100",
    ring: "ring-secondary-200",
  },
  "Awaiting check": {
    chip: "bg-amber-50 text-amber-800 ring-amber-200",
    dot: "bg-amber-500",
    cell: "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100",
    ring: "ring-amber-200",
  },
  "In review": {
    chip: "bg-primary-50 text-primary-700 ring-primary-200",
    dot: "bg-primary-500",
    cell: "border-primary-200 bg-primary-50 text-primary-900 hover:bg-primary-100",
    ring: "ring-primary-200",
  },
  Approved: {
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
    cell: "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
    ring: "ring-emerald-200",
  },
  "Needs correction": {
    chip: "bg-orange-50 text-orange-700 ring-orange-200",
    dot: "bg-orange-500",
    cell: "border-orange-200 bg-orange-50 text-orange-900 hover:bg-orange-100",
    ring: "ring-orange-200",
  },
  Rejected: {
    chip: "bg-red-50 text-red-700 ring-red-200",
    dot: "bg-red-500",
    cell: "border-red-200 bg-red-50 text-red-900 hover:bg-red-100",
    ring: "ring-red-200",
  },
};

export const SESSION_STATUSES: SessionStatus[] = ["Scheduled", "Awaiting check", "In review", "Approved", "Needs correction", "Rejected"];

/**
 * Quality outcomes. Every chip carries a written label as well as a colour, so status
 * is never communicated by colour alone.
 */
export const QUALITY_STATUS_STYLES: Record<QualityStatus, { chip: string; dot: string; bar: string; label: string }> = {
  Green: { chip: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-500", bar: "oklch(0.57 0.12 152)", label: "Meets standard" },
  Amber: { chip: "bg-amber-50 text-amber-900 ring-amber-200", dot: "bg-amber-500", bar: "oklch(var(--accent-500))", label: "Improvement required" },
  Red: { chip: "bg-red-50 text-red-800 ring-red-200", dot: "bg-red-500", bar: "oklch(0.58 0.14 22)", label: "Critical concern" },
  "Not assessed": { chip: "bg-background-200 text-foreground-700 ring-background-300", dot: "bg-foreground-400", bar: "oklch(var(--background-400))", label: "Not assessed" },
  "Not applicable": { chip: "bg-secondary-100 text-secondary-900 ring-secondary-200", dot: "bg-secondary-400", bar: "oklch(var(--secondary-300))", label: "Not applicable" },
};

export const QUALITY_STATUSES: QualityStatus[] = ["Green", "Amber", "Red", "Not assessed", "Not applicable"];

export const CATEGORY_STYLES: Record<FormCategoryId, string> = {
  coaching: "bg-secondary-100 text-secondary-900 ring-secondary-200",
  onboarding: "bg-primary-100 text-primary-800 ring-primary-200",
  teaching: "bg-accent-100 text-accent-900 ring-accent-200",
  compliance: "bg-background-200 text-foreground-800 ring-background-300",
  progression: "bg-primary-50 text-primary-700 ring-primary-200",
  legacy: "bg-background-100 text-foreground-600 ring-background-200",
};
