// ============================================================================
// Pagination.
//
// Seven implementations existed across the coach workspace. This is the caseload
// one, generalised — the noun was hard-coded to "learners", which is why nobody
// reused it.
//
// Page size is a control rather than a constant. Twelve cards is right for
// browsing; a coach reconciling a hundred learners in the table wants fifty or a
// hundred rows, and forcing them through thirteen pages of eight is the kind of
// friction that makes people export to a spreadsheet instead.
//
// The window of page numbers is centred on the current page, so page 9 of 14 is
// reachable without walking there.
// ============================================================================
import { memo } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';
import { FilterSelect } from './FilterToolbar';

const PAGE_SIZE_OPTIONS = [
  { value: '12', label: '12 per page' },
  { value: '24', label: '24 per page' },
  { value: '50', label: '50 per page' },
  { value: '100', label: '100 per page' },
];

const WINDOW = 5;

function pageWindow(page: number, totalPages: number): number[] {
  if (totalPages <= WINDOW) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const half = Math.floor(WINDOW / 2);
  const start = Math.min(Math.max(1, page - half), totalPages - WINDOW + 1);
  return Array.from({ length: WINDOW }, (_, index) => start + index);
}

export const Pagination = memo(function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  noun = 'results',
  className,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** Omit to hide the page-size control. */
  onPageSizeChange?: (size: number) => void;
  /** Plural noun for the count line — "learners", "reports", "reviews". */
  noun?: string;
  className?: string;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-between gap-3 border-t border-foreground-100 px-3.5 py-2.5 sm:flex-row',
        className,
      )}
    >
      <p className="text-[12px] text-foreground-500">
        Showing{' '}
        <strong className="font-semibold tabular-nums text-foreground-800">{first}–{last}</strong> of{' '}
        <strong className="font-semibold tabular-nums text-foreground-800">{total}</strong> {noun}
      </p>

      <div className="flex items-center gap-3">
        {onPageSizeChange ? (
          <FilterSelect
            value={String(pageSize)}
            onChange={(value) => onPageSizeChange(Number(value))}
            options={PAGE_SIZE_OPTIONS}
            align="right"
            widthClass="w-[136px]"
          />
        ) : null}

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
            className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-500 transition hover:bg-background-100 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <AppIcon className="ri-arrow-left-s-line"></AppIcon>
          </button>

          {pageWindow(page, totalPages).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              aria-current={item === page ? 'page' : undefined}
              className={cn(
                'h-8 min-w-[32px] rounded-md px-2 text-[12px] font-semibold tabular-nums transition',
                item === page
                  ? 'bg-primary-600 text-white'
                  : 'text-foreground-600 hover:bg-background-100',
              )}
            >
              {item}
            </button>
          ))}

          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
            className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-500 transition hover:bg-background-100 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <AppIcon className="ri-arrow-right-s-line"></AppIcon>
          </button>
        </div>
      </div>
    </div>
  );
});
