interface SkeletonProps {
  className?: string;
}

export function SkeletonBlock({ className = '' }: SkeletonProps) {
  return <span className={`block rounded bg-background-200 animate-pulse ${className}`} />;
}

export function HeroStatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 animate-pulse">
          <div className="flex items-center gap-2 mb-3">
            <SkeletonBlock className="w-7 h-7 rounded-md" />
            <SkeletonBlock className="h-2.5 w-24" />
          </div>
          <SkeletonBlock className="h-6 w-12" />
        </div>
      ))}
    </div>
  );
}

export function TableRowsSkeleton({ rows = 8, columns = 6, gridClass }: { rows?: number; columns?: number; gridClass: string }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className={`${gridClass} gap-3 px-4 py-3.5 items-center animate-pulse`}>
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <SkeletonBlock
              key={columnIndex}
              className={`${columnIndex === 0 ? 'h-3 w-40 max-w-full' : 'h-3 w-16 mx-auto'} ${columnIndex === columns - 1 ? 'h-6 w-12' : ''}`}
            />
          ))}
        </div>
      ))}
    </>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 animate-pulse">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <SkeletonBlock className="w-10 h-10 rounded-xl" />
              <div className="space-y-2">
                <SkeletonBlock className="h-3 w-36" />
                <SkeletonBlock className="h-2.5 w-24" />
              </div>
            </div>
            <SkeletonBlock className="h-5 w-16 rounded-full" />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {Array.from({ length: 4 }).map((_, metricIndex) => (
              <div key={metricIndex} className="space-y-2">
                <SkeletonBlock className="h-2.5 w-16" />
                <SkeletonBlock className="h-4 w-10" />
              </div>
            ))}
          </div>
          <SkeletonBlock className="h-8 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 animate-pulse">
          <div className="flex items-center gap-4">
            <SkeletonBlock className="w-10 h-10 rounded-lg shrink-0" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-3.5 w-56 max-w-full" />
              <SkeletonBlock className="h-2.5 w-80 max-w-full" />
            </div>
            <SkeletonBlock className="h-6 w-16 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

