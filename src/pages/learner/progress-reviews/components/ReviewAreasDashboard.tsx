import { PROGRESS_REVIEWS_DATA } from '@/mocks/progress-reviews';
import { statusBadge, riskColor } from '../utils';

export default function ReviewAreasDashboard() {
  const d = PROGRESS_REVIEWS_DATA;

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/70 p-5">
      <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Review Areas Dashboard</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {d.reviewAreas.map((area) => {
          const r = riskColor(area.risk);
          return (
            <div key={area.label} className={`rounded-xl border ${r.border} bg-background-100 p-4 transition-all hover:bg-background-200`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${r.dot}`} />
                <span className="text-xs font-medium text-foreground-500 uppercase tracking-wider">{area.label}</span>
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-xl font-bold text-foreground-950">{area.value}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadge(area.status)}`}>{area.status}</span>
              </div>
              <p className="text-xs text-foreground-500">{area.detail}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}