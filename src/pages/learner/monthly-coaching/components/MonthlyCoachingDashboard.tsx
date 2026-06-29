import { MONTHLY_COACHING_DASHBOARD } from '@/mocks/monthly-coaching';

export default function MonthlyCoachingDashboard() {
  const d = MONTHLY_COACHING_DASHBOARD;

  const statusMap = {
    green: { text: 'text-green-700', bg: 'bg-green-100', dot: 'bg-green-500' },
    amber: { text: 'text-amber-700', bg: 'bg-amber-100', dot: 'bg-amber-500' },
    red: { text: 'text-red-700', bg: 'bg-red-100', dot: 'bg-red-500' },
  };

  return (
    <section className="rounded-2xl border border-background-200/50 bg-background-50 overflow-hidden">
      <div className="p-6 md:p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center">
            <i className="ri-dashboard-line text-accent-700" />
          </div>
          <h2 className="text-lg font-heading font-semibold text-foreground-900">Monthly Coaching Dashboard</h2>
          <span className="ml-auto text-xs text-foreground-400">Auto-generated summary</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {d.map((item) => {
            const s = statusMap[item.status];
            return (
              <div key={item.label} className="rounded-xl border border-background-200/50 bg-background-100/30 p-4 hover:bg-background-100/60 transition-smooth">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.bg}`}>
                    <i className={`${item.icon} ${s.text}`} />
                  </div>
                  <div className={`w-2 h-2 rounded-full ${s.dot}`} />
                </div>
                <p className="text-xs text-foreground-400 mb-1">{item.label}</p>
                <p className="text-lg font-bold font-heading text-foreground-900">{item.value}</p>
                <div className="flex items-center gap-1 mt-2">
                  <span className="text-xs text-foreground-400">Target:</span>
                  <span className="text-xs font-medium text-foreground-600">{item.target}</span>
                </div>
                <p className="text-xs text-foreground-400 mt-2 pt-2 border-t border-background-200/30">{item.detail}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}