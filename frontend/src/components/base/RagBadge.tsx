import type { RagStatus } from "@/types/qms";
import { RAG_META } from "@/lib/qms";

interface RagBadgeProps {
  status: RagStatus;
  size?: "sm" | "md";
  withMeaning?: boolean;
  className?: string;
}

export default function RagBadge({
  status,
  size = "md",
  withMeaning = false,
  className = "",
}: RagBadgeProps) {
  const meta = RAG_META[status];
  const sizing = size === "sm" ? "text-[11px] px-2 py-0.5 gap-1" : "text-xs px-2.5 py-1 gap-1.5";

  return (
    <span
      className={`inline-flex items-center rounded-full font-label font-medium whitespace-nowrap ${sizing} ${meta.chip} ${className}`}
    >
      <i className={`${meta.icon} ${size === "sm" ? "text-[11px]" : "text-[13px]"} leading-none`} aria-hidden="true" />
      <span>
        {meta.label}
        {withMeaning ? <span className="font-normal"> — {meta.meaning}</span> : null}
      </span>
    </span>
  );
}

