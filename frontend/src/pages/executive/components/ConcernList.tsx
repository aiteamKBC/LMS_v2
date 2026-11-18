import { memo } from "react";
import Panel from "@/components/base/Panel";
import type { ConcernTheme } from "@/types/qms";

const TREND_META = {
  up: { icon: "ri-arrow-right-up-line", label: "Increasing", cls: "text-[var(--rag-red-fg)]" },
  down: { icon: "ri-arrow-right-down-line", label: "Decreasing", cls: "text-[var(--rag-green-fg)]" },
  flat: { icon: "ri-arrow-right-line", label: "Stable", cls: "text-foreground-500" },
};

function ConcernList({ themes, available }: { themes: ConcernTheme[]; available: boolean }) {
  return (
    <Panel
      title="Recurring concerns"
      description="Themes appearing across multiple form types this period."
      className="h-full"
      headingId="concerns-heading"
    >
      {!available ? <p className="py-6 text-[12px] text-foreground-600">Recurring concern data is unavailable. No trend is inferred.</p> : <>
      <ul className="space-y-3">
        {themes.map((theme) => {
          const trend = TREND_META[theme.trend];
          return (
            <li key={theme.theme} className="border-b border-background-200 pb-3 last:border-0 last:pb-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[12.5px] font-medium leading-snug text-foreground-950">{theme.theme}</p>
                <span className="shrink-0 font-label text-[11px] font-semibold text-foreground-700">
                  {theme.occurrences}×
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="rounded bg-secondary-100 px-1.5 py-0.5 font-label text-[10px] font-medium text-secondary-900">
                  {theme.category}
                </span>
                <span className={`inline-flex items-center gap-0.5 font-label text-[10.5px] ${trend.cls}`}>
                  <i className={`${trend.icon} text-[12px]`} aria-hidden="true" />
                  {trend.label}
                </span>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-foreground-600">{theme.example}</p>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 rounded-lg bg-background-100 px-3 py-2 text-[11px] leading-relaxed text-foreground-600">
        Themes are extracted from linked records only. Free-text comments are cited as evidence and never
        converted into an official status.
      </p>
      </>}
    </Panel>
  );
}

export default memo(ConcernList);
