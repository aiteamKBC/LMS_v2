import { SkeletonBlock } from '@/components/feature/Skeletons';

// Skeleton placeholders for the engagement pages, shaped to mirror the real
// cards they stand in for so the swap-in on load isn't jarring. Built on the
// shared SkeletonBlock primitive (bg-background-200 + animate-pulse).

/** Mirrors the reward cards in Rewards Shop (image-topped card grid). */
export function RewardCardSkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <SkeletonBlock className="h-32 w-full rounded-none" />
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <SkeletonBlock className="h-2.5 w-16" />
              <SkeletonBlock className="h-2.5 w-10" />
            </div>
            <SkeletonBlock className="h-3.5 w-32 max-w-full mb-2" />
            <SkeletonBlock className="h-4 w-28 rounded-full mb-3" />
            <SkeletonBlock className="h-2.5 w-full mb-1.5" />
            <SkeletonBlock className="h-2.5 w-3/4 mb-3" />
            <div className="flex items-center justify-between mb-3">
              <SkeletonBlock className="h-2.5 w-14" />
              <SkeletonBlock className="h-2.5 w-16" />
            </div>
            <div className="flex items-center gap-2">
              <SkeletonBlock className="h-7 flex-1 rounded-lg" />
              <SkeletonBlock className="h-7 flex-1 rounded-lg" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Mirrors the points-rule cards (points medallion + name/pills, desc, meta, 3 actions). */
export function RuleCardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
          <div className="flex items-center gap-3 mb-3">
            <SkeletonBlock className="w-10 h-10 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-3 w-32 max-w-full" />
              <div className="flex gap-1.5">
                <SkeletonBlock className="h-3 w-14 rounded-full" />
                <SkeletonBlock className="h-3 w-12 rounded-full" />
              </div>
            </div>
          </div>
          <SkeletonBlock className="h-2.5 w-full mb-1.5" />
          <SkeletonBlock className="h-2.5 w-2/3 mb-3" />
          <SkeletonBlock className="h-2.5 w-48 max-w-full mb-3" />
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-7 flex-1 rounded-lg" />
            <SkeletonBlock className="h-7 flex-1 rounded-lg" />
            <SkeletonBlock className="h-7 flex-1 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Mirrors the club cards (icon + name/location, description, ambassador,
 *  members bar, a meeting or two, and a footer action). */
export function ClubCardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
          <div className="flex items-start gap-3 mb-3">
            <SkeletonBlock className="w-10 h-10 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-3 w-32 max-w-full" />
              <SkeletonBlock className="h-3 w-20 rounded-full" />
            </div>
          </div>
          <SkeletonBlock className="h-2.5 w-full mb-1.5" />
          <SkeletonBlock className="h-2.5 w-2/3 mb-3" />
          <SkeletonBlock className="h-2.5 w-40 max-w-full mb-3" />
          <SkeletonBlock className="h-10 w-full rounded-lg mb-3" />
          <div className="space-y-2 mb-3">
            <SkeletonBlock className="h-11 w-full rounded-lg" />
            <SkeletonBlock className="h-11 w-full rounded-lg" />
          </div>
          <div className="flex justify-end pt-3 border-t border-foreground-200/40">
            <SkeletonBlock className="h-7 w-20 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Mirrors the recognition cards (icon + title/meta + points/actions row). */
export function RecognitionCardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
          <div className="flex items-start gap-3 mb-3">
            <SkeletonBlock className="w-10 h-10 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-3 w-36 max-w-full" />
              <SkeletonBlock className="h-3.5 w-16 rounded-full" />
            </div>
          </div>
          <SkeletonBlock className="h-2.5 w-full mb-1.5" />
          <SkeletonBlock className="h-2.5 w-2/3 mb-3" />
          <div className="space-y-1.5 mb-3">
            <SkeletonBlock className="h-2.5 w-40 max-w-full" />
            <SkeletonBlock className="h-2.5 w-32" />
            <SkeletonBlock className="h-2.5 w-24" />
          </div>
          <div className="flex items-center justify-between">
            <SkeletonBlock className="h-3 w-12" />
            <div className="flex items-center gap-2">
              <SkeletonBlock className="h-7 w-16 rounded-lg" />
              <SkeletonBlock className="h-7 w-14 rounded-lg" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Mirrors the event cards (icon + title, meta lines, status + actions). */
export function EventCardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
          <div className="flex items-start gap-3 mb-3">
            <SkeletonBlock className="w-9 h-9 rounded-lg shrink-0" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-3 w-40 max-w-full" />
              <SkeletonBlock className="h-3 w-16 rounded-full" />
            </div>
          </div>
          <SkeletonBlock className="h-2.5 w-full mb-1.5" />
          <SkeletonBlock className="h-2.5 w-2/3 mb-3" />
          <div className="space-y-1.5 mb-3">
            <SkeletonBlock className="h-2.5 w-28" />
            <SkeletonBlock className="h-2.5 w-24" />
            <SkeletonBlock className="h-2.5 w-36 max-w-full" />
          </div>
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-4 w-16 rounded-full" />
            <div className="flex-1"></div>
            <SkeletonBlock className="h-7 w-14 rounded-lg" />
            <SkeletonBlock className="h-7 w-16 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Mirrors the Flash Card deck table (title+badge, programme/module, week,
 *  cards, status pill, updated date, row of labeled action buttons). */
export function FlashCardDeckSkeletonTable({ count = 5 }: { count?: number }) {
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-foreground-300/50 bg-background-100/60">
              {['Deck', 'Programme / Module', 'Week', 'Cards', 'Status', 'Updated', 'Actions'].map((label, index) => (
                <th key={label} className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-foreground-500 ${index === 6 ? 'text-right' : ''}`}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: count }).map((_, index) => (
              <tr key={index} className="border-b border-foreground-200/40 last:border-0">
                <td className="px-4 py-3">
                  <SkeletonBlock className="h-3.5 w-40 max-w-full mb-1.5" />
                  <SkeletonBlock className="h-2.5 w-12" />
                </td>
                <td className="px-4 py-3">
                  <SkeletonBlock className="h-3 w-28 mb-1.5" />
                  <SkeletonBlock className="h-2.5 w-20" />
                </td>
                <td className="px-4 py-3"><SkeletonBlock className="h-3 w-14" /></td>
                <td className="px-4 py-3"><SkeletonBlock className="h-3 w-6" /></td>
                <td className="px-4 py-3"><SkeletonBlock className="h-4 w-16 rounded-full" /></td>
                <td className="px-4 py-3"><SkeletonBlock className="h-2.5 w-20" /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 justify-end">
                    <SkeletonBlock className="h-8 w-16 rounded-lg" />
                    <SkeletonBlock className="h-8 w-16 rounded-lg" />
                    <SkeletonBlock className="h-8 w-14 rounded-lg" />
                    <SkeletonBlock className="h-8 w-20 rounded-lg" />
                    <SkeletonBlock className="h-8 w-8 rounded-lg" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Mirrors the claim cards in Voucher Claims (avatar + reward box + actions). */
export function ClaimCardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
          <div className="flex items-center gap-3 mb-3">
            <SkeletonBlock className="w-10 h-10 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-3 w-32 max-w-full" />
              <SkeletonBlock className="h-2.5 w-40 max-w-full" />
            </div>
            <SkeletonBlock className="h-4 w-14 rounded-full shrink-0" />
          </div>
          <div className="bg-background-100/50 rounded-lg p-3 mb-3 space-y-2">
            <SkeletonBlock className="h-3 w-36 max-w-full" />
            <SkeletonBlock className="h-2.5 w-28" />
          </div>
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-7 flex-1 rounded-lg" />
            <SkeletonBlock className="h-7 flex-1 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}
