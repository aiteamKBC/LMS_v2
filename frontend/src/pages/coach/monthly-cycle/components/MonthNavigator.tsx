// ============================================================================
// Month navigator — lives in the PageHeader's actions slot.
//
// Same behaviour as before (prev / native month input / next), only moved out
// of the bespoke purple hero and into the header row every other coach page
// uses.
// ============================================================================
import { AppIcon } from '@/components/feature/AppIcon';

export function MonthNavigator({
  value,
  onShift,
  onChange,
}: {
  value: string;
  onShift: (offset: number) => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onShift(-1)}
        aria-label="Previous month"
        className="flex h-8 w-8 items-center justify-center rounded-md text-black transition hover:bg-background-100 hover:text-black"
      >
        <AppIcon className="ri-arrow-left-s-line text-[16px]"></AppIcon>
      </button>
      <input
        type="month"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Select month"
        className="h-8 rounded-md border border-transparent bg-background-100 px-2 text-[13px] font-semibold text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-200"
      />
      <button
        type="button"
        onClick={() => onShift(1)}
        aria-label="Next month"
        className="flex h-8 w-8 items-center justify-center rounded-md text-black transition hover:bg-background-100 hover:text-black"
      >
        <AppIcon className="ri-arrow-right-s-line text-[16px]"></AppIcon>
      </button>
    </div>
  );
}
