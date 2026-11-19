import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface KpiCardProps {
  label: string;
  value: string;
  unit?: string;
  definition: string;
  hint?: string;
  icon: string;
  to?: string;
  linkLabel?: string;
  onLinkClick?: () => void;
  accent?: "primary" | "accent" | "secondary" | "critical";
  children?: ReactNode;
  className?: string;
}

const ACCENT_STYLES: Record<string, string> = {
  primary: "bg-primary-50 text-primary-700 border-primary-100",
  accent: "bg-accent-50 text-accent-700 border-accent-100",
  secondary: "bg-secondary-100 text-secondary-900 border-secondary-200",
  critical: "bg-[var(--rag-red-bg)] text-[var(--rag-red-fg)] border-transparent",
};

export default function KpiCard({
  label,
  value,
  unit,
  definition,
  hint,
  icon,
  to,
  linkLabel = "View records",
  onLinkClick,
  accent = "secondary",
  children,
  className = "",
}: KpiCardProps) {
  return (
    <div className={`group flex h-full flex-col rounded-xl border border-background-200 bg-background-50 p-4 transition-colors hover:border-background-300 sm:p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-label text-[11px] font-semibold uppercase tracking-[0.09em] text-foreground-600">
          {label}
        </p>
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${ACCENT_STYLES[accent]}`}
          aria-hidden="true"
        >
          <i className={`${icon} text-[15px]`} />
        </span>
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-heading text-[30px] font-semibold leading-none tracking-[-0.02em] text-foreground-950">
          {value}
        </span>
        {unit ? (
          <span className="font-label text-[12px] font-medium text-foreground-500">{unit}</span>
        ) : null}
      </div>

      {children ? <div className="mt-3">{children}</div> : null}

      <p className="mt-3 text-[12px] leading-relaxed text-foreground-600">{definition}</p>

      {hint ? (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-foreground-500">{hint}</p>
      ) : null}

      {to || onLinkClick ? (
        <div className="mt-auto pt-3">
          {onLinkClick ? (
            <button
              type="button"
              onClick={onLinkClick}
              className="inline-flex items-center gap-1 font-label text-[12px] font-semibold text-primary-700 hover:text-primary-800"
            >
              {linkLabel}
              <i className="ri-arrow-right-line text-[13px]" aria-hidden="true" />
            </button>
          ) : (
            <Link
              to={to!}
              className="inline-flex items-center gap-1 font-label text-[12px] font-semibold text-primary-700 hover:text-primary-800"
            >
              {linkLabel}
              <i className="ri-arrow-right-line text-[13px]" aria-hidden="true" />
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}

