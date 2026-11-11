import type { ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';

/** A readable message with a clear next step; technical detail can stay secondary. */
export function Notice({ title, children, tone = 'info', details, detailsLabel = 'View details', actions, className = '', role }: {
  title: ReactNode;
  children?: ReactNode;
  tone?: 'info' | 'attention' | 'error';
  details?: ReactNode;
  detailsLabel?: string;
  actions?: ReactNode;
  className?: string;
  role?: 'alert' | 'status' | 'note';
}) {
  const icon = tone === 'info' ? 'ri-information-line' : 'ri-error-warning-line';
  const colour = tone === 'info' ? 'bg-primary-50 text-primary-700' : tone === 'attention' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700';
  return (
    <div role={role || (tone === 'error' ? 'alert' : 'note')} className={`rounded-xl border border-background-200 bg-background-50 p-4 text-foreground-700 ${className}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${colour}`}><AppIcon className={`${icon} text-lg`} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-6 text-foreground-900">{title}</p>
          {children && <div className="mt-1 text-sm leading-6 [overflow-wrap:anywhere]">{children}</div>}
          {details && <details className="mt-2">
            <summary className="min-h-9 cursor-pointer rounded py-1.5 text-[13px] font-semibold text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">{detailsLabel}</summary>
            <div className="mt-2 text-[13px] leading-6 [overflow-wrap:anywhere]">{details}</div>
          </details>}
          {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
