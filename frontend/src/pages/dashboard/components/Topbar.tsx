import { useState } from "react";
import { REVIEWER_NAME, REVIEWER_ROLE } from "@/pages/dashboard/constants";
import { initials } from "@/pages/dashboard/utils";

const NOTIFICATIONS = [
  { icon: "ri-error-warning-line", tone: "text-orange-600", title: "3 reviews need correction", body: "Returned to coaches this morning." },
  { icon: "ri-time-line", tone: "text-amber-600", title: "2 reviews approaching SLA", body: "Due for a quality decision today." },
  { icon: "ri-check-double-line", tone: "text-emerald-600", title: "7 reviews approved", body: "Feedback checks passed this week." },
];

export default function Topbar({ onMenu, title = "Quality Assurance", section = "Quality Assurance" }: { onMenu: () => void; title?: string; section?: string }) {
  const [open, setOpen] = useState(false);
  const today = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  return (
    <header className="sticky top-0 z-20 border-b border-background-200 bg-background-50/95 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 md:px-6">
        <button type="button" onClick={onMenu} className="grid size-9 place-items-center rounded-lg border border-background-200 text-foreground-700 hover:bg-background-100 lg:hidden" aria-label="Open navigation">
          <i className="ri-menu-2-line text-[18px]" aria-hidden />
        </button>

        <div className="min-w-0 flex-1">
          <nav aria-label="Breadcrumb" className="hidden items-center gap-1.5 text-[11px] text-foreground-500 sm:flex">
            <span>Curriculum Studio</span>
            <i className="ri-arrow-right-s-line text-[13px]" aria-hidden />
            <span className="font-medium text-foreground-700">{section}</span>
          </nav>
          <h1 className="truncate font-heading text-[17px] font-semibold leading-tight text-foreground-950 md:text-[19px]">{title}</h1>
        </div>

        <div className="hidden items-center gap-2 rounded-lg border border-background-200 bg-background-100 px-3 py-1.5 text-[12px] text-foreground-600 xl:flex">
          <i className="ri-calendar-line text-[15px] text-foreground-400" aria-hidden />
          {today}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="relative grid size-9 place-items-center rounded-lg border border-background-200 text-foreground-600 hover:bg-background-100"
            aria-label="Notifications"
            aria-expanded={open}
          >
            <i className="ri-notification-3-line text-[18px]" aria-hidden />
            <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent-500 ring-2 ring-background-50" aria-hidden />
          </button>
          {open ? (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
              <div className="qa-rise absolute right-0 z-30 mt-2 w-[300px] overflow-hidden rounded-lg border border-background-200 bg-background-50 shadow-sm">
                <div className="flex items-center justify-between border-b border-background-200 px-3 py-2.5">
                  <p className="text-[12px] font-semibold text-foreground-900">Notifications</p>
                  <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-semibold text-primary-700">3 new</span>
                </div>
                <ul className="divide-y divide-background-100">
                  {NOTIFICATIONS.map((n) => (
                    <li key={n.title} className="flex gap-2.5 px-3 py-2.5 hover:bg-background-100">
                      <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-background-100">
                        <i className={`${n.icon} text-[14px] ${n.tone}`} aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold leading-tight text-foreground-900">{n.title}</p>
                        <p className="mt-0.5 text-[11px] leading-snug text-foreground-500">{n.body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2 border-l border-background-200 pl-2 md:pl-3">
          <span className="grid size-8 place-items-center rounded-full bg-primary-500 text-[11px] font-semibold text-background-50">{initials(REVIEWER_NAME)}</span>
          <div className="hidden leading-tight md:block">
            <p className="text-[12px] font-semibold text-foreground-900">{REVIEWER_NAME}</p>
            <p className="text-[11px] text-foreground-500">{REVIEWER_ROLE}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
