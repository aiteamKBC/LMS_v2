import { STATUS_STYLES } from "@/pages/dashboard/constants";
import type { CheckStatus, FormStatus } from "@/pages/dashboard/types";

const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export default function StatusBadge({ status, className }: { status: CheckStatus; className?: string }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        style.badge,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden />
      {status}
    </span>
  );
}

export function FormStatusPill({ status }: { status: FormStatus }) {
  const done = status === "Completed";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        done ? "bg-secondary-100 text-secondary-900 ring-secondary-200" : "bg-background-200 text-foreground-600 ring-background-300",
      )}
    >
      <i className={done ? "ri-checkbox-circle-fill text-[13px] text-secondary-600" : "ri-draft-line text-[13px]"} aria-hidden />
      {status}
    </span>
  );
}
