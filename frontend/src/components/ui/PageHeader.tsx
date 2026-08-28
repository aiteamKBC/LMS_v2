// ============================================================================
// Page header.
//
// This is the shared deep-purple page hero used across queue, report, and
// detail screens. Keeping it here makes the visual treatment consistent with
// the platform accounts page without duplicating markup in every route.
//
// `variant="feature"` keeps a tinted surface for the two or three screens that
// genuinely open a session rather than continue one. It is a tint, not a hero —
// if it starts appearing on every page again, the point has been lost.
// ============================================================================
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
        'page-header relative overflow-hidden rounded-2xl border-0 px-5 py-5 shadow-sm md:px-7 md:py-7',
        className,
      )}
      style={{ background: 'linear-gradient(108deg, oklch(var(--primary-700)) 0%, oklch(var(--primary-500)) 30%, oklch(var(--primary-100)) 66%, oklch(var(--background-50)) 100%)' }}
    >
      {backTo ? (
        <Link
          to={backTo.to}
          className="relative z-10 mb-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-white/75 transition hover:text-white"
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
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-white backdrop-blur-sm"
            >
              <AppIcon className={cn(icon, 'text-2xl')}></AppIcon>
            </span>
          ) : null}

          <div className="min-w-0">
            <h1 className="text-xl font-heading font-bold tracking-tight text-white md:text-2xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-white/80">
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
        <div className="relative z-10 mt-4 flex flex-wrap items-start gap-x-5 gap-y-2 border-t border-white/20 pt-3 text-white/80">
          {meta}
        </div>
      ) : null}
    </header>
  );
}
