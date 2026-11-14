import { formatCompactDate } from "@/pages/curriculum/recordings/utils";
import { CalendarDays, CircleCheck, CircleAlert } from 'lucide-react';

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
        <i className="text-primary-600" aria-hidden="true"><CalendarDays size={18} /></i>
        <span className="font-heading font-bold text-foreground-950">{lecturesToday}</span>
        <span className="text-foreground-600">
          {periodLabel || (isToday ? "Lectures today" : `Lectures on ${formatCompactDate(dayIso)}`)}
        </span>
      </span>

      <span className="inline-flex items-center gap-2 rounded-full border border-accent-200 bg-accent-50 px-3 py-1.5 text-sm">
        <i className="text-accent-700" aria-hidden="true"><CircleCheck size={18} /></i>
        <span className="font-heading font-bold text-accent-900">{readyCount}</span>
        <span className="text-accent-800">Ready to download</span>
      </span>

      <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm">
        <i className="text-amber-700" aria-hidden="true"><CircleAlert size={18} /></i>
        <span className="font-heading font-bold text-amber-900">{attentionCount}</span>
        <span className="text-amber-800">Need attention</span>
      </span>
    </div>
  );
}
