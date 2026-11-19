import { SkeletonBlock } from '@/components/feature/Skeletons';

export default function CoachingCalendarSkeleton({ className = '' }: { className?: string }) {
  return <section aria-label="Loading calendar preview" aria-busy="true"
    className={`mt-4 grid min-w-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)] ${className}`}>
    <div aria-hidden="true" className="hidden self-start rounded-xl border border-background-200 bg-background-50 p-4 lg:block">
      <div className="mb-5 flex items-center justify-between gap-3">
        <SkeletonBlock className="h-4 w-28" />
        <SkeletonBlock className="h-7 w-14 rounded-lg" />
      </div>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 42 }, (_, index) => <SkeletonBlock key={index} className="aspect-square w-full rounded-md" />)}
      </div>
      <SkeletonBlock className="mt-4 h-8 w-full rounded-lg" />
      <div className="mt-4 space-y-3 border-t border-background-200 pt-4">
        {Array.from({ length: 4 }, (_, index) => <SkeletonBlock key={index} className="h-3 w-3/4" />)}
      </div>
    </div>
    <div aria-hidden="true" className="min-w-0 overflow-hidden rounded-xl border border-background-200 bg-background-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SkeletonBlock className="h-5 w-44" />
        <SkeletonBlock className="h-3 w-32" />
      </div>
      <SkeletonBlock className="mt-3 h-3 w-2/3" />
      <div className="mt-5 divide-y divide-background-200">
        {Array.from({ length: 5 }, (_, index) => <div key={index} className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-4 py-4">
          <SkeletonBlock className="mt-2 h-3 w-8" />
          <div className="min-w-0 space-y-3 rounded-xl border border-background-200 p-3">
            <SkeletonBlock className={`h-3 ${index % 2 ? 'w-2/3' : 'w-1/2'}`} />
            <SkeletonBlock className="h-2.5 w-1/3" />
            <SkeletonBlock className="h-5 w-24 rounded-full" />
          </div>
        </div>)}
      </div>
    </div>
  </section>;
}
