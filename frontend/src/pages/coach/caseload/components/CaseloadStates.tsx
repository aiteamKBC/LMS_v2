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
import type { ViewMode } from '../types';

function CardSkeleton() {
  return (
    <div className="rounded-lg border border-foreground-200/70 bg-white p-3.5">
      <div className="flex items-start gap-2.5">
        <SkeletonBlock className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <SkeletonBlock className="h-3 w-32" />
          <SkeletonBlock className="h-2.5 w-44" />
          <SkeletonBlock className="h-2.5 w-24" />
        </div>
        <SkeletonBlock className="h-4 w-16 rounded" />
      </div>
      <SkeletonBlock className="mt-4 h-1.5 w-full rounded-full" />
      <div className="mt-4 grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-1.5">
            <SkeletonBlock className="h-2 w-12" />
            <SkeletonBlock className="h-3 w-14" />
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2 border-t border-foreground-100 pt-3">
        <SkeletonBlock className="h-2.5 w-40" />
        <SkeletonBlock className="h-2.5 w-32" />
      </div>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-foreground-100 px-3.5 py-3">
      <SkeletonBlock className="h-7 w-7 rounded-full" />
      <SkeletonBlock className="h-3 w-40" />
      <SkeletonBlock className="h-3 w-36" />
      <SkeletonBlock className="ml-auto h-3 w-16" />
      <SkeletonBlock className="h-3 w-16" />
      <SkeletonBlock className="h-3 w-16" />
      <SkeletonBlock className="h-4 w-20 rounded" />
    </div>
  );
}

export function CaseloadLoading({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === 'table') {
    return (
      <div aria-busy="true" aria-live="polite">
        {Array.from({ length: 8 }).map((_, index) => <RowSkeleton key={index} />)}
      </div>
    );
  }

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="grid grid-cols-1 gap-3 p-3.5 md:grid-cols-2 xl:grid-cols-3 min-[1600px]:grid-cols-4"
    >
      {Array.from({ length: 6 }).map((_, index) => <CardSkeleton key={index} />)}
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

export function CaseloadError({ message, onRetry }: { message: string; onRetry: () => void }) {
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
