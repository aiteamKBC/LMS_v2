import { formatCompactDate } from "@/pages/curriculum/recordings/utils";

interface SummaryChipsProps {
  dayIso: string;
  periodLabel?: string;
  isToday: boolean;
  lecturesToday: number;
  readyCount: number;
  attentionCount: number;
}

export default function SummaryChips({
  dayIso,
  periodLabel,
  isToday,
  lecturesToday,
  readyCount,
  attentionCount,
}: SummaryChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-2 rounded-full border border-background-200 bg-background-50 px-3 py-1.5 text-sm">
        <i className="ri-calendar-event-line text-primary-600" aria-hidden="true"></i>
        <span className="font-heading font-bold text-foreground-950">{lecturesToday}</span>
        <span className="text-foreground-600">
          {periodLabel || (isToday ? "Lectures today" : `Lectures on ${formatCompactDate(dayIso)}`)}
        </span>
      </span>

      <span className="inline-flex items-center gap-2 rounded-full border border-accent-200 bg-accent-50 px-3 py-1.5 text-sm">
        <i className="ri-download-2-line text-accent-700" aria-hidden="true"></i>
        <span className="font-heading font-bold text-accent-900">{readyCount}</span>
        <span className="text-accent-800">Ready to download</span>
      </span>

      <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm">
        <i className="ri-error-warning-line text-amber-700" aria-hidden="true"></i>
        <span className="font-heading font-bold text-amber-900">{attentionCount}</span>
        <span className="text-amber-800">Need attention</span>
      </span>
    </div>
  );
}