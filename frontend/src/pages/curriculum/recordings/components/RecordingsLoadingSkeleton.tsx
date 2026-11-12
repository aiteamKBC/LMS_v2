import { SkeletonBlock } from '@/components/feature/Skeletons';

export default function RecordingsLoadingSkeleton() {
  return <div role="status" aria-busy="true" className="mt-5">
    <span className="sr-only">Loading sessions and recordings…</span>
    <div aria-hidden="true" className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <SkeletonBlock className="h-9 w-28 rounded-full" />
        <SkeletonBlock className="h-9 w-44 rounded-full" />
      </div>
      <div className="flex flex-wrap gap-3 rounded-2xl border border-background-200 bg-background-50 p-3">
        <SkeletonBlock className="h-10 min-w-0 basis-full rounded-xl lg:flex-1 lg:basis-0" />
        <SkeletonBlock className="h-10 min-w-0 flex-1 rounded-xl lg:max-w-60" />
        <SkeletonBlock className="h-10 min-w-0 flex-1 rounded-xl lg:max-w-48" />
        <SkeletonBlock className="h-10 w-24 rounded-xl" />
      </div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[252px_minmax(0,1fr)]">
        <div className="hidden self-start rounded-2xl border border-background-200 bg-background-50 p-4 lg:block">
          <div className="mb-5 flex items-center justify-between gap-3">
            <SkeletonBlock className="h-4 w-28" />
            <SkeletonBlock className="h-7 w-16 rounded-full" />
          </div>
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 42 }, (_, index) => <SkeletonBlock key={index} className="aspect-square w-full rounded-md" />)}
          </div>
          <SkeletonBlock className="mt-5 h-8 w-full rounded-full" />
        </div>
        <div className="min-w-0 overflow-hidden rounded-2xl border border-background-200 bg-background-50">
          <div className="flex flex-wrap items-center gap-3 border-b border-background-200 p-4">
            <SkeletonBlock className="h-8 w-40 rounded-full" />
            <SkeletonBlock className="h-4 w-36" />
            <SkeletonBlock className="ml-auto h-8 w-24 rounded-full" />
          </div>
          <div className="divide-y divide-background-200 px-4">
            {Array.from({ length: 5 }, (_, index) => <div key={index} className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-4 py-5">
              <SkeletonBlock className="mt-2 h-3 w-8" />
              <div className="min-w-0 space-y-3 rounded-xl border border-background-200 p-3">
                <SkeletonBlock className={`h-3 ${index % 2 ? 'w-2/3' : 'w-1/2'}`} />
                <SkeletonBlock className="h-2.5 w-1/3" />
                <SkeletonBlock className="h-5 w-24 rounded-full" />
              </div>
            </div>)}
          </div>
        </div>
      </div>
    </div>
  </div>;
}
