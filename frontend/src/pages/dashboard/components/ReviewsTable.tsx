import type { CheckStatus, Review, SortKey, SortState } from "@/pages/dashboard/types";
import { fmtDate, initials } from "@/pages/dashboard/utils";
import StatusBadge, { FormStatusPill } from "@/pages/dashboard/components/StatusBadge";

const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

type Props = {
  rows: Review[];
  total: number;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  selected: string[];
  onToggleRow: (id: string) => void;
  onTogglePage: (checked: boolean) => void;
  sort: SortState;
  onSort: (key: SortKey) => void;
  page: number;
  pages: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  onView: (review: Review) => void;
  onPreview: (review: Review) => void;
  onDownload: (review: Review) => void;
  onBulk: (status: CheckStatus) => void;
  onReset: () => void;
  focusId?: string | null;
};

const COLUMNS: { key: SortKey | null; label: string; className?: string }[] = [
  { key: "learner", label: "Learner" },
  { key: "coach", label: "Coach" },
  { key: "formType", label: "Form type" },
  { key: "meetingDate", label: "Meeting date" },
  { key: null, label: "Form status" },
  { key: "formCheck", label: "Forms check" },
  { key: "feedbackCheck", label: "Feedback check" },
  { key: "version", label: "Version" },
  { key: "followUps", label: "Follow-ups" },
  { key: null, label: "Actions", className: "text-right" },
];

const needsAttention = (review: Review) => review.formCheck === "Rejected" || review.feedbackCheck === "Rejected" || review.formCheck === "Needs Correction" || review.feedbackCheck === "Needs Correction";

export default function ReviewsTable(props: Props) {
  const { rows, total, loading, error, selected, sort, page, pages, pageSize, focusId } = props;
  const allOnPageSelected = rows.length > 0 && rows.every((row) => selected.includes(row.id));

  const sortIcon = (key: SortKey | null) => {
    if (!key) return null;
    if (sort.key !== key) return <i className="ri-arrow-up-down-line text-[11px] text-foreground-300" aria-hidden />;
    return <i className={cn("text-[11px] text-primary-600", sort.dir === "asc" ? "ri-arrow-up-line" : "ri-arrow-down-line")} aria-hidden />;
  };

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <section id="reviews" className="scroll-mt-20 rounded-lg border border-background-200 bg-background-50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-background-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="font-heading text-[14px] font-semibold text-foreground-950">Quality reviews</h3>
          <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-semibold text-foreground-600">{total} records</span>
        </div>
        {selected.length > 0 ? (
          <div className="qa-fade flex flex-wrap items-center gap-2 rounded-md bg-primary-50 px-2 py-1.5 ring-1 ring-inset ring-primary-200">
            <span className="text-[11px] font-semibold text-primary-800">{selected.length} selected</span>
            <button
              type="button"
              onClick={() => props.onBulk("Approved")}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700"
            >
              <i className="ri-check-double-line text-[12px]" aria-hidden />
              Approve
            </button>
            <button
              type="button"
              onClick={() => props.onBulk("Needs Correction")}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-orange-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-orange-700"
            >
              <i className="ri-loop-right-line text-[12px]" aria-hidden />
              Request correction
            </button>
            <button
              type="button"
              onClick={() => props.onBulk("Rejected")}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-red-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-red-700"
            >
              <i className="ri-close-line text-[12px]" aria-hidden />
              Reject
            </button>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-[11px] text-foreground-500">
            <i className="ri-information-line text-[13px]" aria-hidden />
            Rows highlighted in orange need attention
          </p>
        )}
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600">
            <i className="ri-error-warning-line text-[20px]" aria-hidden />
          </span>
          <p className="text-[13px] font-semibold text-foreground-900">We could not load the review queue</p>
          <p className="max-w-sm text-[12px] text-foreground-500">The connection to the quality service was interrupted. Your filters are preserved.</p>
          <button type="button" onClick={props.onRetry} className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary-500 px-3 text-[11px] font-semibold text-background-50 hover:bg-primary-600">
            <i className="ri-refresh-line text-[13px]" aria-hidden />
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="scroll-slim max-h-[620px] overflow-auto">
            <table className="w-full min-w-[1120px] border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-background-100">
                <tr>
                  <th scope="col" className="w-9 border-b border-background-200 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={(e) => props.onTogglePage(e.target.checked)}
                      aria-label="Select all reviews on this page"
                      className="size-3.5 cursor-pointer rounded border-background-300 accent-primary-600"
                    />
                  </th>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.label}
                      scope="col"
                      className={cn("whitespace-nowrap border-b border-background-200 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-foreground-500", column.className)}
                    >
                      {column.key ? (
                        <button type="button" onClick={() => props.onSort(column.key as SortKey)} className="inline-flex items-center gap-1 hover:text-foreground-900">
                          {column.label}
                          {sortIcon(column.key)}
                        </button>
                      ) : (
                        column.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <tr key={index} className="border-b border-background-100">
                        <td className="px-3 py-3">
                          <div className="h-3.5 w-3.5 animate-pulse rounded bg-background-200" />
                        </td>
                        {Array.from({ length: 10 }).map((__, cell) => (
                          <td key={cell} className="px-3 py-3">
                            <div className={cn("h-3 animate-pulse rounded bg-background-200", cell === 0 ? "w-28" : cell === 2 ? "w-40" : "w-16")} />
                          </td>
                        ))}
                      </tr>
                    ))
                  : rows.map((review) => {
                      const checked = selected.includes(review.id);
                      return (
                        <tr
                          key={review.id}
                          className={cn(
                            "border-b border-background-100 transition-colors last:border-0",
                            checked ? "bg-primary-50/60" : needsAttention(review) ? "bg-orange-50/40" : "bg-background-50",
                            focusId === review.id ? "ring-1 ring-inset ring-primary-400" : "",
                            "hover:bg-primary-50/40",
                          )}
                        >
                          <td className="px-3 py-2.5 align-middle">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => props.onToggleRow(review.id)}
                              aria-label={`Select ${review.learner}`}
                              className="size-3.5 cursor-pointer rounded border-background-300 accent-primary-600"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-primary-100 text-[10px] font-semibold text-primary-700">
                                {initials(review.learner)}
                              </span>
                              <div className="min-w-0">
                                <button type="button" onClick={() => props.onView(review)} className="block max-w-[150px] truncate text-[12px] font-semibold text-foreground-950 hover:text-primary-700 hover:underline">
                                  {review.learner}
                                </button>
                                <span className="block text-[10px] text-foreground-400">
                                  {review.learnerId} · {review.id}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-[12px] text-foreground-700">{review.coach}</td>
                          <td className="px-3 py-2.5">
                            <p className="max-w-[210px] truncate text-[12px] font-medium text-foreground-800" title={review.formType}>
                              {review.formType}
                            </p>
                            <p className="text-[10px] text-foreground-400">
                              {review.programme} · {review.cohort}
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-[12px] tabular-nums text-foreground-700">{fmtDate(review.meetingDate)}</td>
                          <td className="px-3 py-2.5">
                            <FormStatusPill status={review.formStatus} />
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge status={review.formCheck} />
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge status={review.feedbackCheck} />
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex items-center gap-1 rounded border border-background-200 bg-background-50 px-1.5 py-0.5 text-[10px] font-semibold text-foreground-700">
                              <i className="ri-file-pdf-2-line text-[11px] text-foreground-400" aria-hidden />
                              {review.version}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={cn("inline-flex items-center gap-1 text-[12px] font-semibold tabular-nums", review.followUps > 0 ? "text-foreground-800" : "text-foreground-400")}>
                              <i className="ri-list-check-2 text-[12px]" aria-hidden />
                              {review.followUps}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => props.onView(review)}
                                title="View review"
                                className="flex h-7 w-7 items-center justify-center rounded border border-background-200 text-foreground-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
                              >
                                <i className="ri-eye-line text-[14px]" aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={() => props.onPreview(review)}
                                title="Preview PDF"
                                className="flex h-7 w-7 items-center justify-center rounded border border-background-200 text-foreground-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
                              >
                                <i className="ri-file-pdf-2-line text-[14px]" aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={() => props.onDownload(review)}
                                title="Download / print PDF"
                                className="flex h-7 w-7 items-center justify-center rounded border border-background-200 text-foreground-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
                              >
                                <i className="ri-download-line text-[14px]" aria-hidden />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>

            {!loading && rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-background-100 text-foreground-400">
                  <i className="ri-inbox-line text-[22px]" aria-hidden />
                </span>
                <p className="text-[13px] font-semibold text-foreground-900">No reviews match these filters</p>
                <p className="max-w-sm text-[12px] text-foreground-500">Try a different learner, coach, form type or status combination.</p>
                <button type="button" onClick={props.onReset} className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-md border border-background-300 px-3 text-[11px] font-semibold text-foreground-700 hover:bg-background-100">
                  <i className="ri-refresh-line text-[13px]" aria-hidden />
                  Reset filters
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-background-200 px-4 py-2.5">
            <div className="flex items-center gap-2 text-[11px] text-foreground-500">
              <span>
                Showing <span className="font-semibold text-foreground-800">{from}</span>–<span className="font-semibold text-foreground-800">{to}</span> of{" "}
                <span className="font-semibold text-foreground-800">{total}</span>
              </span>
              <span className="hidden sm:inline">·</span>
              <label className="hidden items-center gap-1.5 sm:flex">
                Rows
                <select
                  value={pageSize}
                  onChange={(e) => props.onPageSize(Number(e.target.value))}
                  className="h-7 rounded border border-background-300 bg-background-50 px-1.5 text-[11px] text-foreground-800 outline-none focus:border-primary-400"
                >
                  {[8, 10, 25].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => props.onPage(page - 1)}
                disabled={page <= 1}
                className="flex h-7 items-center gap-1 rounded border border-background-300 px-2 text-[11px] font-medium text-foreground-700 hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <i className="ri-arrow-left-s-line text-[13px]" aria-hidden />
                Prev
              </button>
              {Array.from({ length: pages }).map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => props.onPage(index + 1)}
                  aria-current={page === index + 1 ? "page" : undefined}
                  className={cn(
                    "h-7 min-w-7 rounded border px-1.5 text-[11px] font-semibold tabular-nums",
                    page === index + 1 ? "border-primary-500 bg-primary-500 text-background-50" : "border-background-300 text-foreground-700 hover:bg-background-100",
                  )}
                >
                  {index + 1}
                </button>
              ))}
              <button
                type="button"
                onClick={() => props.onPage(page + 1)}
                disabled={page >= pages}
                className="flex h-7 items-center gap-1 rounded border border-background-300 px-2 text-[11px] font-medium text-foreground-700 hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
                <i className="ri-arrow-right-s-line text-[13px]" aria-hidden />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
