const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export type KpiStats = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  correction: number;
  compliance: number;
};

type Card = {
  key: string;
  label: string;
  value: string;
  icon: string;
  tile: string;
  trend: string;
  up: boolean;
  hint: string;
  accentValue?: boolean;
};

export default function KpiCards({ stats, loading }: { stats: KpiStats; loading: boolean }) {
  const cards: Card[] = [
    {
      key: "total",
      label: "Total Reviews",
      value: String(stats.total),
      icon: "ri-file-list-3-line",
      tile: "bg-primary-100 text-primary-700",
      trend: "+8.2%",
      up: true,
      hint: "vs last month",
    },
    {
      key: "pending",
      label: "Pending Checks",
      value: String(stats.pending),
      icon: "ri-time-line",
      tile: "bg-amber-100 text-amber-700",
      trend: "−4 today",
      up: true,
      hint: "awaiting verification",
    },
    {
      key: "approved",
      label: "Approved",
      value: String(stats.approved),
      icon: "ri-checkbox-circle-line",
      tile: "bg-emerald-100 text-emerald-700",
      trend: "+12.4%",
      up: true,
      hint: "passed both checks",
    },
    {
      key: "rejected",
      label: "Rejected",
      value: String(stats.rejected),
      icon: "ri-close-circle-line",
      tile: "bg-red-100 text-red-700",
      trend: "−2.1%",
      up: false,
      hint: "failed quality",
    },
    {
      key: "correction",
      label: "Needs Correction",
      value: String(stats.correction),
      icon: "ri-loop-right-line",
      tile: "bg-orange-100 text-orange-700",
      trend: "+1 today",
      up: false,
      hint: "returned to coach",
    },
    {
      key: "compliance",
      label: "Compliance Rate",
      value: `${stats.compliance}%`,
      icon: "ri-shield-check-line",
      tile: "bg-accent-100 text-accent-700",
      trend: "+3.6 pts",
      up: true,
      hint: "of checked reviews",
      accentValue: true,
    },
  ];

  return (
    <section id="overview" className="scroll-mt-20">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-[15px] font-semibold text-foreground-950">Quality overview</h2>
          <p className="text-[12px] text-foreground-500">Live figures for the reviews currently in view.</p>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full border border-background-200 bg-background-50 px-2.5 py-1 text-[11px] text-foreground-600 sm:inline-flex">
          <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
          Updated just now
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {cards.map((card, index) => (
          <article
            key={card.key}
            className="qa-rise rounded-lg border border-background-200 bg-background-50 p-3.5 transition-colors hover:border-primary-300"
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-foreground-500">{card.label}</p>
              <span className={cn("flex h-7 w-7 flex-none items-center justify-center rounded-md", card.tile)}>
                <i className={cn(card.icon, "text-[15px]")} aria-hidden />
              </span>
            </div>
            {loading ? (
              <div className="mt-2 h-8 w-16 animate-pulse rounded bg-background-200" />
            ) : (
              <p className={cn("mt-1.5 font-heading text-[26px] font-semibold leading-none tabular-nums", card.accentValue ? "text-accent-600" : "text-foreground-950")}>
                {card.value}
              </p>
            )}
            <div className="mt-2 flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold",
                  card.up ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
                )}
              >
                <i className={card.up ? "ri-arrow-up-line text-[11px]" : "ri-arrow-down-line text-[11px]"} aria-hidden />
                {card.trend}
              </span>
              <span className="truncate text-[10px] text-foreground-500">{card.hint}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
