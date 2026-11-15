import { addDays, TIME_ZONE_LABEL, todayIso } from "@/pages/curriculum/recordings/utils";
import type {
  DashboardFilters,
  PeriodKey,
  QualityAction,
  QualityRecord,
  RagCounts,
  RagStatus,
} from "@/types/qms";

export const RAG_META: Record<
  RagStatus,
  { label: string; meaning: string; chip: string; dot: string; ink: string; icon: string }
> = {
  green: {
    label: "Green",
    meaning: "Meets standard",
    chip: "bg-[var(--rag-green-bg)] text-[var(--rag-green-fg)]",
    dot: "bg-[var(--rag-green-ink)]",
    ink: "var(--rag-green-ink)",
    icon: "ri-checkbox-circle-fill",
  },
  amber: {
    label: "Amber",
    meaning: "Improvement required",
    chip: "bg-[var(--rag-amber-bg)] text-[var(--rag-amber-fg)]",
    dot: "bg-[var(--rag-amber-ink)]",
    ink: "var(--rag-amber-ink)",
    icon: "ri-error-warning-fill",
  },
  red: {
    label: "Red",
    meaning: "Critical concern",
    chip: "bg-[var(--rag-red-bg)] text-[var(--rag-red-fg)]",
    dot: "bg-[var(--rag-red-ink)]",
    ink: "var(--rag-red-ink)",
    icon: "ri-close-circle-fill",
  },
  unrated: {
    label: "Not assessed",
    meaning: "No approved evaluation policy",
    chip: "bg-[var(--rag-grey-bg)] text-[var(--rag-grey-fg)]",
    dot: "bg-[var(--rag-grey-ink)]",
    ink: "var(--rag-grey-ink)",
    icon: "ri-question-fill",
  },
  na: {
    label: "Not applicable",
    meaning: "Criterion excluded",
    chip: "bg-[var(--rag-grey-bg)] text-[var(--rag-grey-fg)]",
    dot: "bg-[var(--rag-grey-ink)]",
    ink: "var(--rag-grey-ink)",
    icon: "ri-subtract-line",
  },
};

export const RAG_ORDER: RagStatus[] = ["green", "amber", "red", "unrated", "na"];

export const PERIODS: PeriodKey[] = [
  "Last 30 days",
  "Last 90 days",
  "Academic year 2026/27",
  "Last 12 months",
  "All records",
];

function periodStart(period: PeriodKey) {
  const today = todayIso(TIME_ZONE_LABEL);
  if (period === "Last 30 days") return addDays(today, -30);
  if (period === "Last 90 days") return addDays(today, -90);
  if (period === "Last 12 months") return addDays(today, -365);
  if (period === "Academic year 2026/27") {
    const year = Number(today.slice(0, 4)) - (today.slice(5, 7) < "09" ? 1 : 0);
    return `${year}-09-01`;
  }
  return null;
}

export const numberFormat = new Intl.NumberFormat("en-GB");

export function formatNumber(value: number) {
  return numberFormat.format(value);
}

export function formatPct(value: number, digits = 0) {
  return `${value.toFixed(digits)}%`;
}

export function formatDate(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatDateShort(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

export function daysBetween(fromIso: string, toIso: string) {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86400000);
}

export function countByRag(records: QualityRecord[]): RagCounts {
  const counts: RagCounts = { green: 0, amber: 0, red: 0, unrated: 0, na: 0, total: 0 };
  records.forEach((record) => {
    counts[record.rag] += 1;
    counts.total += 1;
  });
  return counts;
}

export function assessedTotal(counts: RagCounts) {
  return counts.green + counts.amber + counts.red;
}

export function share(counts: RagCounts, status: RagStatus) {
  const base = assessedTotal(counts);
  if (!base) return 0;
  return (counts[status] / base) * 100;
}

export function applyFilters(records: QualityRecord[], filters: DashboardFilters) {
  const start = periodStart(filters.period);
  const query = filters.query.trim().toLowerCase();

  return records.filter((record) => {
    if (start && record.assessedOn < start) return false;
    if (filters.department !== "All departments" && record.department !== filters.department) return false;
    if (filters.programme !== "All programmes" && record.programme !== filters.programme) return false;
    if (filters.category !== "All form categories" && record.category !== filters.category) return false;
    if (filters.formType !== "All form types" && record.formId !== filters.formType) return false;
    if (filters.feedbackType !== "All feedback types" && record.feedbackType !== filters.feedbackType) return false;
    if (filters.respondentType !== "All feedback types" && record.respondentType !== filters.respondentType) return false;
    if (filters.coach !== "All coaches" && record.coachName !== filters.coach) return false;
    if (filters.tutor !== "All tutors" && record.tutorName !== filters.tutor) return false;
    if (filters.rag !== "All statuses") {
      const requested = RAG_ORDER.find(status => RAG_META[status].label === filters.rag);
      if (requested === "unrated") {
        if (record.ratingCounts || record.rag !== "unrated") return false;
      } else if (requested === "na") {
        if (!record.ratingCounts?.na && record.rag !== "na") return false;
      } else if (requested) {
        const storedRating = record.ratingCounts?.[requested] ?? 0;
        if (storedRating === 0 && record.rag !== requested) return false;
      }
    }
    if (query) {
      const haystack = `${record.subjectName} ${record.formName} ${record.programme} ${record.respondentName} ${record.id}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function isOpenAction(action: QualityAction) {
  return !["Closed", "Resolved"].includes(action.status);
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface MonthlyPoint {
  key: string;
  label: string;
  green: number;
  amber: number;
  red: number;
  unrated: number;
  total: number;
}

export function buildMonthlySeries(records: QualityRecord[], months = 12): MonthlyPoint[] {
  const points: MonthlyPoint[] = [];
  const end = new Date(`${todayIso(TIME_ZONE_LABEL)}T00:00:00Z`);

  for (let i = months - 1; i >= 0; i -= 1) {
    const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    const scoped = records.filter((record) => record.assessedOn.startsWith(key));
    const counts = countByRag(scoped);
    points.push({
      key,
      label: `${MONTH_LABELS[month]} ${String(year).slice(2)}`,
      green: counts.green,
      amber: counts.amber,
      red: counts.red,
      unrated: counts.unrated + counts.na,
      total: counts.total,
    });
  }
  return points;
}

export function groupRagByCategory(records: QualityRecord[]) {
  const map = new Map<string, RagCounts>();
  records.forEach((record) => {
    if (!map.has(record.category)) {
      map.set(record.category, { green: 0, amber: 0, red: 0, unrated: 0, na: 0, total: 0 });
    }
    const counts = map.get(record.category)!;
    counts[record.rag] += 1;
    counts.total += 1;
  });
  return Array.from(map.entries())
    .map(([category, counts]) => ({ category, counts }))
    .sort((a, b) => b.counts.total - a.counts.total);
}

export function exportRecordsCsv(records: QualityRecord[], filename = "kbc-quality-records.csv") {
  const header = [
    "Record",
    "Form",
    "Category",
    "Version policy",
    "Subject type",
    "Subject",
    "Department",
    "Programme",
    "Respondent",
    "Assessor",
    "Date",
    "RAG",
    "Critical",
  ];
  const rows = records.map((record) => [
    record.id,
    record.formName,
    record.category,
    record.policyVersion ?? "No policy",
    record.subjectType,
    record.subjectName,
    record.department,
    record.programme,
    record.respondentName,
    record.auditor,
    record.assessedOn,
    RAG_META[record.rag].label,
    record.critical ? "Yes" : "No",
  ]);

  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

