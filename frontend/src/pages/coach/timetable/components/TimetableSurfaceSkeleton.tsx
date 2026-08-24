// ============================================================================
// Loading placeholder for the calendar + sidebar while the timetable is being
// fetched, or while a navigation intent (schedule / focus) is resolving.
// Extracted from the page for the same reason as the other detail components.
// ============================================================================
export function TimetableSurfaceSkeleton() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 rounded-2xl bg-background-50/94 backdrop-blur-[1px]">
      <div className="space-y-5">
        <div className="rounded-2xl border border-background-200 bg-white p-3 shadow-sm">
          <div className="grid gap-3 xl:grid-cols-[auto_minmax(260px,360px)] xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="h-11 w-[176px] animate-pulse rounded-lg bg-background-100"></div>
              <div className="h-11 w-[220px] animate-pulse rounded-lg bg-background-100"></div>
            </div>
            <div className="h-10 w-full animate-pulse rounded-lg bg-background-100"></div>
          </div>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <div className="h-20 animate-pulse rounded-lg bg-background-100"></div>
            <div className="h-20 animate-pulse rounded-lg bg-background-100"></div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(380px,1fr)]">
          <div className="space-y-4">
            <div className="h-[520px] animate-pulse rounded-2xl border border-background-200 bg-white shadow-sm"></div>
            <div className="h-[156px] animate-pulse rounded-2xl border border-background-200 bg-white shadow-sm"></div>
          </div>
          <div className="space-y-4">
            <div className="h-[430px] animate-pulse rounded-2xl border border-background-200 bg-white shadow-sm"></div>
            <div className="h-[220px] animate-pulse rounded-2xl border border-background-200 bg-white shadow-sm"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
