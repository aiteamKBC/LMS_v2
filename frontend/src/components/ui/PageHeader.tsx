// Shared compact page header, using the Super Admin surface and typography.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';

export function PageHeader({
  title,
  description,
  icon,
  meta,
  actions,
  backTo,
  decoration,
  className,
}: {
  title: string;
  /** One line on why a coach opens this page. Keep it to a line. */
  description?: string;
  /** Remix icon class, e.g. "ri-group-line". */
  icon?: string;
  /** Contextual facts under the title — counts, totals, "12 need action". */
  meta?: ReactNode;
  /** Primary action(s). Right-aligned from `sm` up. */
  actions?: ReactNode;
  /** Optional decorative artwork rendered behind the header content. */
  decoration?: ReactNode;
  /** Shown as a back link above the title, for detail pages. */
  backTo?: { to: string; label: string };
  variant?: 'default' | 'feature';
  className?: string;
}) {
  return (
    <header
      className={cn(
        'page-header workspace-page-hero relative overflow-hidden rounded-2xl border border-primary-200/60 bg-primary-50/60 px-5 py-5 md:px-6 md:py-6',
        className,
      )}
    >
      {backTo ? (
        <Link
          to={backTo.to}
          className="relative z-10 mb-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary-600 transition hover:text-primary-800"
        >
          <AppIcon className="ri-arrow-left-line text-[14px]"></AppIcon>
          {backTo.label}
        </Link>
      ) : null}

      {decoration ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
          {decoration}
        </div>
      ) : null}

      <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {icon ? (
            <span
              className="workspace-hero-banner__icon flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-100/60 text-primary-600 shadow-sm"
            >
              <AppIcon className={cn(icon, 'text-2xl')}></AppIcon>
            </span>
          ) : null}

          <div className="min-w-0">
            <h1 className="text-xl font-heading font-semibold tracking-tight text-primary-800 md:text-2xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-foreground-500">
                {description}
              </p>
            ) : null}
          </div>
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {/* The facts sit below the title rule rather than beside it, so a long
          title never squeezes them into a column one word wide. */}
      {meta ? (
        <div className="relative z-10 mt-4 flex flex-wrap items-start gap-x-5 gap-y-2 border-t border-primary-200/60 pt-3 text-foreground-500">
          {meta}
        </div>
      ) : null}
    </header>
  );
}
