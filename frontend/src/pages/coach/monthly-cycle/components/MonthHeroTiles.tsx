// ============================================================================
// Monthly Cycle — the six icon tiles inside the purple hero header, one per
// headline count for the selected month.
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
  completions,
  reviews,
  evidence,
  ksbs,
  otjhHours,
}: {
  learners: number;
  completions: number;
  reviews: number;
  evidence: number;
  ksbs: number;
  otjhHours: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
      <HeroTile icon="ri-group-line" label="Learners" value={learners} />
      <HeroTile icon="ri-checkbox-circle-line" label="Completions" value={completions} />
      <HeroTile icon="ri-star-line" label="Reviews" value={reviews} />
      <HeroTile icon="ri-file-text-line" label="Evidence Logged" value={evidence} />
      <HeroTile icon="ri-book-open-line" label="KSBs Logged" value={ksbs} />
      <HeroTile icon="ri-time-line" label="OTJH Logged" value={Math.round(otjhHours)} />
    </div>
  );
}
