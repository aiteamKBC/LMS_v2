// ============================================================================
// Page header.
//
// This replaces eight different full-bleed purple gradient heroes. They were
// costing 200-odd pixels above the fold on screens whose whole job is a queue,
// and every one of them re-printed a title the shell's topbar had already drawn
// two rows above.
//
// So the default is compact and horizontal: what this page is, one line on why
// you would open it, the facts that decide whether you act, and the action. The
// brand stays in the accent rule and the icon well rather than in a slab of
// purple.
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
  variant = 'default',
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
  /** Shown as a back link above the title, for detail pages. */
  backTo?: { to: string; label: string };
  variant?: 'default' | 'feature';
  className?: string;
}) {
  const feature = variant === 'feature';

  return (
    <header
      className={cn(
        'rounded-2xl border px-4 py-4 md:px-5',
        feature
          ? 'border-primary-200/70 bg-primary-50/50'
          : 'border-foreground-200/70 bg-background-50 shadow-sm',
        className,
      )}
    >
      {backTo ? (
        <Link
          to={backTo.to}
          className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-foreground-500 transition hover:text-primary-700"
        >
          <AppIcon className="ri-arrow-left-line text-[14px]"></AppIcon>
          {backTo.label}
        </Link>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <span
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                feature ? 'bg-primary-100 text-primary-700' : 'bg-primary-50 text-primary-600',
              )}
            >
              <AppIcon className={cn(icon, 'text-[19px]')}></AppIcon>
            </span>
          ) : null}

          <div className="min-w-0">
            <h1 className="truncate text-[20px] font-semibold tracking-tight text-foreground-950">
              {title}
            </h1>
            {description ? (
              <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-foreground-500">
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
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-foreground-100 pt-3">
          {meta}
        </div>
      ) : null}
    </header>
  );
}
