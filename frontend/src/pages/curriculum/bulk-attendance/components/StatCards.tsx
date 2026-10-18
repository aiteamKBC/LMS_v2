import type { AttendanceStatus } from "@/types/bulkAttendance";

interface StatCardsProps {
  total: number;
  present: number;
  absent: number;
  unmarked: number;
  selectedStatus: AttendanceStatus | null;
  onLearnersClick: () => void;
  onStatusClick: (status: AttendanceStatus) => void;
}

const CARD_BASE =
  "flex items-center gap-4 rounded-lg border border-background-300 bg-background-50 p-5";

const STATUS_CARDS: Array<{
  status: AttendanceStatus;
  label: string;
  icon: string;
  color: string;
  countColor: string;
}> = [
  {
    status: "present",
    label: "Present",
    icon: "ri-checkbox-circle-line",
    color: "bg-green-100 text-green-700",
    countColor: "text-green-700",
  },
  {
    status: "absent",
    label: "Absent",
    icon: "ri-close-circle-line",
    color: "bg-red-100 text-red-700",
    countColor: "text-red-700",
  },
  {
    status: "unmarked",
    label: "Unmarked",
    icon: "ri-subtract-line",
    color: "bg-background-200 text-foreground-700",
    countColor: "text-foreground-700",
  },
];

export default function StatCards({
  total,
  present,
  absent,
  unmarked,
  selectedStatus,
  onLearnersClick,
  onStatusClick,
}: StatCardsProps) {
  const counts: Record<AttendanceStatus, number> = { present, absent, unmarked };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <button
        type="button"
        onClick={onLearnersClick}
        aria-label={`View all ${total} learners`}
        className={`${CARD_BASE} w-full cursor-pointer text-left transition-colors hover:border-primary-300 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400`}
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-secondary-100 text-secondary-900">
          <i className="ri-group-line text-xl" />
        </span>
        <span>
          <span className="block font-label text-xs uppercase tracking-wide text-foreground-500">
            Learners
          </span>
          <span className="block text-2xl font-semibold text-foreground-950">{total}</span>
        </span>
      </button>

      {STATUS_CARDS.map((card) => {
        const selected = selectedStatus === card.status;
        return (
          <button
            key={card.status}
            type="button"
            onClick={() => onStatusClick(card.status)}
            aria-pressed={selected}
            aria-label={`Show ${counts[card.status]} ${card.label.toLowerCase()} learners`}
            className={`${CARD_BASE} w-full cursor-pointer text-left transition-colors hover:border-primary-300 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${
              selected ? "border-primary-400 bg-primary-50 ring-1 ring-primary-300" : ""
            }`}
          >
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${card.color}`}>
              <i className={`${card.icon} text-xl`} />
            </span>
            <span>
              <span className="block font-label text-xs uppercase tracking-wide text-foreground-500">
                {card.label}
              </span>
              <span className={`block text-2xl font-semibold ${card.countColor}`}>
                {counts[card.status]}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
