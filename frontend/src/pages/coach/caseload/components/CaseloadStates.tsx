// ============================================================================
// Coach caseload — loading, empty and error states.
//
// Four distinct situations that used to share one line of grey text. They are
// separated because the right next action differs in each: wait, clear a filter,
// retry, or ask an administrator for an allocation.
//
// The loading state is a skeleton of the layout that is coming rather than a
// spinner, so the page does not visibly rearrange itself once data lands.
// ============================================================================
import { AppIcon } from '@/components/feature/AppIcon';
import { SkeletonBlock } from '@/components/feature/Skeletons';
import styles from '../caseload.module.css';

function SummarySkeleton() {
  return (
    <div className={styles.summaryCard}>
      <SkeletonBlock className="h-9 w-9 rounded-full" />
      <div>
        <SkeletonBlock className="h-2.5 w-24" />
        <SkeletonBlock className="mt-2 h-5 w-12" />
        <SkeletonBlock className="mt-2 h-2 w-28" />
      </div>
    </div>
  );
}

export function CaseloadSummaryLoading() {
  return (
    <section className={styles.summary} aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <SummarySkeleton key={index} />
      ))}
    </section>
  );
}

function ProgressSkeleton() {
  return (
    <div className={styles.miniProgress}>
      <SkeletonBlock className="h-2.5 w-7" />
      <SkeletonBlock className="mt-1 h-[7px] w-full rounded-full" />
      <SkeletonBlock className="mt-1 h-2 w-14" />
    </div>
  );
}

function LearnerRowSkeleton() {
  return (
    <tr>
      <td>
        <div className={styles.learner}>
          <SkeletonBlock className="h-[38px] w-[38px] shrink-0 rounded-full" />
          <span className="space-y-2">
            <SkeletonBlock className="h-2.5 w-24" />
            <SkeletonBlock className="h-2 w-32" />
          </span>
        </div>
      </td>
      {Array.from({ length: 4 }).map((_, index) => <td key={index} className={styles.progressCell}><ProgressSkeleton /></td>)}
      <td>
        <div className="space-y-2">
          <SkeletonBlock className="h-2.5 w-20" />
          <SkeletonBlock className="h-2 w-14" />
        </div>
      </td>
      <td>
        <div className="space-y-2">
          <SkeletonBlock className="h-2.5 w-20" />
          <SkeletonBlock className="h-2 w-24" />
        </div>
      </td>
      <td>
        <div className="space-y-2">
          <SkeletonBlock className="h-2.5 w-20" />
          <SkeletonBlock className="h-2 w-24" />
        </div>
      </td>
      <td>
        <div className="flex justify-end gap-2">
          <SkeletonBlock className="h-8 w-20 rounded-md" />
          <SkeletonBlock className="h-8 w-8 rounded-md" />
        </div>
      </td>
    </tr>
  );
}

function ToolbarSkeleton() {
  return (
    <div className={styles.toolbar} aria-hidden="true">
      <div className="flex flex-wrap items-center gap-2">
        <SkeletonBlock className="h-9 min-w-[200px] flex-1 rounded-md lg:max-w-[340px]" />
        <SkeletonBlock className="h-9 w-[150px] rounded-md" />
        <SkeletonBlock className="h-9 w-[140px] rounded-md" />
        <SkeletonBlock className="h-9 w-[145px] rounded-md" />
        <SkeletonBlock className="h-9 w-28 rounded-md" />
        <div className="ml-auto flex gap-2">
          <SkeletonBlock className="h-9 w-[210px] rounded-md" />
          <SkeletonBlock className="h-9 w-9 rounded-md" />
        </div>
      </div>
    </div>
  );
}

export function CaseloadLoading({ rows = 12 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading learners</span>
      <ToolbarSkeleton />
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <caption className="sr-only">Learners are loading</caption>
          <thead>
            <tr className={styles.primaryHead}>
              <th rowSpan={2}>Learner</th><th colSpan={4}>Progress</th><th rowSpan={2}>Last Activity</th>
              <th rowSpan={2}>Last PR</th><th rowSpan={2}>Last MCM</th><th rowSpan={2}>Actions</th>
            </tr>
            <tr className={styles.progressHead}><th>OTJH</th><th>KSBs</th><th>Activities</th><th>Attendance</th></tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, index) => (
              <LearnerRowSkeleton key={index} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground-100 px-3 py-2.5" aria-hidden="true">
        <SkeletonBlock className="h-3 w-40" />
        <div className="flex items-center gap-2">
          <SkeletonBlock className="h-8 w-24 rounded-md" />
          <SkeletonBlock className="h-8 w-28 rounded-md" />
        </div>
      </div>
    </div>
  );
}

function StateShell({
  icon,
  iconClass,
  title,
  body,
  children,
}: {
  icon: string;
  iconClass: string;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className={`mb-3 flex h-11 w-11 items-center justify-center rounded-full ${iconClass}`}>
        <AppIcon className={`${icon} text-[18px]`}></AppIcon>
      </span>
      <p className="text-[13.5px] font-semibold text-foreground-900">{title}</p>
      <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-foreground-500">{body}</p>
      {children ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{children}</div> : null}
    </div>
  );
}

export function CaseloadError({
  message,
  onRetry,
  action,
}: {
  message: string;
  onRetry: () => void;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <StateShell
      icon="ri-error-warning-line"
      iconClass="bg-red-50 text-red-600"
      title="We could not load your learners"
      body={message}
    >
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary-600 px-3.5 text-[12px] font-semibold text-white transition hover:bg-primary-700"
      >
        <AppIcon className="ri-refresh-line"></AppIcon>
        Try again
      </button>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-primary-200 bg-white px-3.5 text-[12px] font-semibold text-primary-700 transition hover:bg-primary-50"
        >
          <AppIcon className="ri-login-box-line"></AppIcon>
          {action.label}
        </button>
      ) : null}
    </StateShell>
  );
}

export function CaseloadEmpty() {
  return (
    <StateShell
      icon="ri-group-line"
      iconClass="bg-primary-50 text-primary-600"
      title="No learners assigned to you yet"
      body="Once learners are allocated to your caseload they will appear here with their progress, attendance and risk status."
    />
  );
}

export function CaseloadNoMatches({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <StateShell
      icon="ri-filter-off-line"
      iconClass="bg-background-100 text-foreground-400"
      title="No learners match these filters"
      body="Try changing or clearing your filters to widen the search."
    >
      <button
        type="button"
        onClick={onClearFilters}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-foreground-200 bg-white px-3.5 text-[12px] font-semibold text-foreground-700 transition hover:border-foreground-300"
      >
        <AppIcon className="ri-close-circle-line"></AppIcon>
        Clear filters
      </button>
    </StateShell>
  );
}
