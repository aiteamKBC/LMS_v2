import { AppIcon } from '@/components/feature/AppIcon';
import styles from '../bulkAttendance.module.css';

export type RegisterTab = "daily" | "weekly" | "report";

interface RegisterTabsProps {
  active: RegisterTab;
  onChange: (tab: RegisterTab) => void;
}

const TABS: { key: RegisterTab; label: string; icon: string }[] = [
  { key: "daily", label: "Daily register", icon: "ri-list-check-2" },
  { key: "weekly", label: "Week", icon: "ri-calendar-2-line" },
  { key: "report", label: "Report", icon: "ri-bar-chart-2-line" },
];

export default function RegisterTabs({ active, onChange }: RegisterTabsProps) {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Attendance views">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-background-50 text-foreground-950 ring-1 ring-background-300"
                : "text-foreground-600 hover:text-foreground-900"
            }`}
          >
            <AppIcon className={tab.icon} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

