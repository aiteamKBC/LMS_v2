import { statusKey } from "../learnerStatus";

function toneFor(status: string | undefined): string {
  const key = statusKey(status);
  if (key === "active" || key === "delivery") return "bg-green-100 text-green-800";
  if (key === "withdrawn") return "bg-red-100 text-red-700";
  if (key === "completed" || key === "enteredepa") return "bg-secondary-100 text-secondary-900";
  if (key === "onbreak" || key === "underreview") return "bg-warning-100 text-warning-800";
  return "bg-background-200 text-foreground-700";
}

export default function LearnerStatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-xs text-foreground-400">—</span>;
  return (
    <span className={`inline-flex max-w-full truncate rounded-full px-2.5 py-1 font-label text-xs ${toneFor(status)}`}>
      {status}
    </span>
  );
}
