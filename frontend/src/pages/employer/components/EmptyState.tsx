import type { ReactNode } from "react";

export default function EmptyState({
  icon = "ri-inbox-line",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-background-300 bg-background-50 px-6 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-background-200 text-foreground-500">
        <i className={`${icon} text-2xl`} aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-base font-semibold text-foreground-950">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-foreground-600">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
