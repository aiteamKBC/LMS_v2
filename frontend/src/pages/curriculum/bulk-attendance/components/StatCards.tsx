interface StatCardsProps {
  total: number;
  present: number;
  absent: number;
  unmarked: number;
  rate: number;
  onLearnersClick: () => void;
}

const CARD_BASE =
  "flex items-center gap-4 rounded-lg border border-background-300 bg-background-50 p-5";

export default function StatCards({
  total,
  present,
  absent,
  unmarked,
  rate,
  onLearnersClick,
}: StatCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <button
        type="button"
        onClick={onLearnersClick}
        aria-label={`View all ${total} learners`}
        className={`${CARD_BASE} w-full cursor-pointer text-left transition-colors hover:border-primary-300 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400`}
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-secondary-100 text-secondary-900">
          <i className="ri-group-line text-xl" />
        </span>
        <div>
          <p className="font-label text-xs uppercase tracking-wide text-foreground-500">
            Learners
          </p>
          <p className="text-2xl font-semibold text-foreground-950">{total}</p>
        </div>
      </button>

      <div className={CARD_BASE}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-green-100 text-green-700">
          <i className="ri-checkbox-circle-line text-xl" />
        </span>
        <div>
          <p className="font-label text-xs uppercase tracking-wide text-foreground-500">
            Present
          </p>
          <p className="text-2xl font-semibold text-green-700">{present}</p>
        </div>
      </div>

      <div className={CARD_BASE}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-700">
          <i className="ri-close-circle-line text-xl" />
        </span>
        <div>
          <p className="font-label text-xs uppercase tracking-wide text-foreground-500">
            Absent
          </p>
          <p className="text-2xl font-semibold text-red-700">{absent}</p>
        </div>
      </div>

      <div className={CARD_BASE}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-background-200 text-foreground-700">
          <i className="ri-subtract-line text-xl" />
        </span>
        <div>
          <p className="font-label text-xs uppercase tracking-wide text-foreground-500">
            Unmarked
          </p>
          <p className="text-2xl font-semibold text-foreground-700">
            {unmarked}
          </p>
        </div>
      </div>

      <div className={CARD_BASE}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-accent-700">
          <i className="ri-pie-chart-2-line text-xl" />
        </span>
        <div>
          <p className="font-label text-xs uppercase tracking-wide text-foreground-500">
            Attendance rate
          </p>
          <p className="text-2xl font-semibold text-foreground-950">{rate}%</p>
        </div>
      </div>
    </div>
  );
}
