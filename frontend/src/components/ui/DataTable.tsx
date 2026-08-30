// ============================================================================
// The one table.
//
// Replaces a mix of real <table>s and hand-written CSS grids whose column
// templates were pasted three times per page (header, rows, skeleton) and drifted
// apart. Header cells were `px-3 py-3` on one page and `px-4 py-4` on the next;
// two pages had sticky headers and four did not.
//
// Design rules it keeps, carried over from the caseload table that proved them:
//
//  - The header is sticky. A coach scrolling a hundred rows should not have to
//    remember column order.
//  - The first column can be sticky too, so scrolling right never loses whose
//    row you are reading.
//  - Numbers are tabular and right-aligned, so a column can be scanned
//    vertically for outliers without reading any of it.
//  - Wide tables scroll inside their own wrapper. The page body never scrolls
//    sideways.
//  - No minimum height. A table holding two rows should be two rows tall — the
//    stretched-to-fill version was most of why these screens looked unfinished.
// ============================================================================
import type { ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';

export interface DataColumn<T> {
  key: string;
  /** Header text. Empty string for an action column. */
  label: string;
  align?: 'left' | 'right' | 'center';
  /** e.g. 'w-[190px] min-w-[160px]'. Widths beat table-layout guessing. */
  widthClass?: string;
  /** Set to make the header a sort control. The key echoed back to `onSort`. */
  sortKey?: string;
  render: (row: T) => ReactNode;
}

const ALIGN_CLASS = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sortKey,
  sortDir = 'asc',
  onSort,
  onRowClick,
  stickyFirstColumn = false,
  minWidthClass,
  empty,
  loading,
  caption,
  className,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  stickyFirstColumn?: boolean;
  /** e.g. 'min-w-[1100px]' when the columns genuinely need the room. */
  minWidthClass?: string;
  /** Shown in place of the rows when there are none. Use <EmptyState size="sm">. */
  empty?: ReactNode;
  /** Shown in place of the rows while loading. Use a skeleton, not a spinner. */
  loading?: ReactNode;
  /** Accessible description of the table. */
  caption?: string;
  className?: string;
}) {
  const showPlaceholder = Boolean(loading) || rows.length === 0;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-foreground-100/70 bg-background-50 shadow-sm',
        className,
      )}
    >
      <div className="overflow-x-auto">
        <table className={cn('w-full text-left', minWidthClass)}>
          {caption ? <caption className="sr-only">{caption}</caption> : null}

          <thead className="sticky top-0 z-10 bg-background-100/95 backdrop-blur">
            <tr>
              {columns.map((column, index) => (
                <HeaderCell
                  key={column.key}
                  column={column}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  sticky={stickyFirstColumn && index === 0}
                />
              ))}
            </tr>
          </thead>

          <tbody>
            {showPlaceholder ? (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  {loading || empty}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-t border-foreground-100 transition-colors',
                    onRowClick ? 'cursor-pointer hover:bg-primary-50/40' : 'hover:bg-background-100/60',
                  )}
                >
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={cn(
                        'px-3 py-3 text-[13px] text-foreground-800 align-middle',
                        ALIGN_CLASS[column.align || 'left'],
                        column.align === 'right' && 'tabular-nums',
                        stickyFirstColumn && index === 0 && 'sticky left-0 z-[1] bg-background-50 pl-3.5',
                      )}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HeaderCell<T>({
  column,
  sortKey,
  sortDir,
  onSort,
  sticky,
}: {
  column: DataColumn<T>;
  sortKey?: string;
  sortDir: 'asc' | 'desc';
  onSort?: (key: string) => void;
  sticky?: boolean;
}) {
  const align = ALIGN_CLASS[column.align || 'left'];
  const sortable = Boolean(column.sortKey && onSort);
  const isSorted = Boolean(column.sortKey) && column.sortKey === sortKey;

  const base = cn(
    'whitespace-nowrap px-3 py-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-foreground-500',
    align,
    column.widthClass,
    sticky && 'sticky left-0 z-[2] bg-background-100/95 pl-3.5',
  );

  if (!sortable) {
    return <th scope="col" className={base}>{column.label}</th>;
  }

  const key = column.sortKey as string;

  return (
    <th
      scope="col"
      className={base}
      aria-sort={isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort?.(key)}
        className={cn(
          'inline-flex items-center gap-1 transition hover:text-foreground-800',
          column.align === 'right' && 'flex-row-reverse',
          isSorted && 'text-primary-700',
        )}
      >
        {column.label}
        <AppIcon
          className={cn(
            'text-[12px]',
            isSorted
              ? sortDir === 'asc'
                ? 'ri-arrow-up-line text-primary-600'
                : 'ri-arrow-down-line text-primary-600'
              : 'ri-arrow-up-down-line text-foreground-300',
          )}
        ></AppIcon>
      </button>
    </th>
  );
}
