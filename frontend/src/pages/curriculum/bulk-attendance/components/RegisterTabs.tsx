export type RegisterTab = "daily" | "weekly" | "report";

interface RegisterTabsProps {
  active: RegisterTab;
  onChange: (tab: RegisterTab) => void;
}

const TABS: { key: RegisterTab; label: string; icon: string }[] = [
  { key: "daily", label: "Daily", icon: "ri-list-check-2" },
  { key: "weekly", label: "Weekly", icon: "ri-calendar-2-line" },
  { key: "report", label: "Report", icon: "ri-bar-chart-2-line" },
];

export default function RegisterTabs({ active, onChange }: RegisterTabsProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-background-300 bg-background-100 px-1 py-1">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-background-50 text-foreground-950 ring-1 ring-background-300"
                : "text-foreground-600 hover:text-foreground-900"
            }`}
          >
            <i className={`${tab.icon} text-base`} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

