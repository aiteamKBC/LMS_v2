// ============================================================================
// Monthly Cycle — the key headline tiles inside the purple hero header.
// ============================================================================
import { AppIcon } from '@/components/feature/AppIcon';
import { formatNumber } from '../lib/monthly';

function HeroTile({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white">
        <AppIcon className={icon}></AppIcon>
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-white/70">{label}</p>
        <p className="text-[17px] font-bold leading-none tabular-nums text-white">{formatNumber(value)}</p>
      </div>
    </div>
  );
}

export function MonthHeroTiles({
  learners,
  reviews,
}: {
  learners: number;
  reviews: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3">
      <HeroTile icon="ri-group-line" label="Learners" value={learners} />
      <HeroTile icon="ri-star-line" label="Reviews" value={reviews} />
    </div>
  );
}
