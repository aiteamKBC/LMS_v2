// Shared "nothing here yet" placeholder — dashed card with an icon badge, a
// title, and an optional subtitle. Consolidates the near-identical ad-hoc
// empty states that had been redefined per-page across the engagement pages.
export function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-foreground-300 bg-white px-4 py-10 text-center sm:px-6 sm:py-14">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-500">
        <AppIcon className={`${icon} text-xl`}></AppIcon>
      </span>
      <p className="mt-3 text-sm font-semibold text-foreground-700">{title}</p>
      {subtitle && <p className="mt-1 text-[11px] text-foreground-400">{subtitle}</p>}
    </div>
  );
}
