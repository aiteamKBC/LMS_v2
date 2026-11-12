import type { CheckStatus, RagLevel } from "@/pages/dashboard/types";

export const fmtDate = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export const fmtShortDate = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

export const nowLabel = () =>
  new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export const pct = (part: number, total: number) => (total === 0 ? 0 : Math.round((part / total) * 100));

export const toneForScore = (value: number) => {
  if (value >= 85) return "text-emerald-600";
  if (value >= 60) return "text-amber-600";
  return "text-red-600";
};

export const reviewRag = (review: { formCheck: CheckStatus; feedbackCheck: CheckStatus }): RagLevel | null => {
  if (review.formCheck === "Rejected" || review.feedbackCheck === "Rejected") return "Red";
  if (review.formCheck === "Needs Correction" || review.feedbackCheck === "Needs Correction") return "Amber";
  if (review.formCheck === "Approved" && review.feedbackCheck === "Approved") return "Green";
  return null;
};

export const barForScore = (value: number) => {
  if (value >= 85) return "bg-emerald-500";
  if (value >= 60) return "bg-amber-500";
  return "bg-red-500";
};
