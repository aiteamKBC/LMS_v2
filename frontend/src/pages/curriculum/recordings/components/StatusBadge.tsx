import type { RecordingStatus } from "@/pages/curriculum/recordings/types";
import { STATUS_META } from "@/pages/curriculum/recordings/utils";

interface StatusBadgeProps {
  status: RecordingStatus;
  className?: string;
  showIcon?: boolean;
}

export default function StatusBadge({ status, className = "", showIcon = true }: StatusBadgeProps) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.badgeClass} ${className}`}
    >
      {showIcon ? <i className={meta.icon} aria-hidden="true"></i> : null}
      {meta.label}
    </span>
  );
}