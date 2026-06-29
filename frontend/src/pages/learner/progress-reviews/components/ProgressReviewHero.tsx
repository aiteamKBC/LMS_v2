import { PROGRESS_REVIEWS_DATA } from '@/mocks/progress-reviews';
import { DonutRing } from '@/pages/learner/monthly-coaching/components/CinematicCharts';
import { statusBadge } from '../utils';

export default function ProgressReviewHero() {
  const d = PROGRESS_REVIEWS_DATA;

  return (
    <>
      {/* ── SECTION 1: HERO ── */}
      <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
        <div className="absolute top-0 left-0 right-0 h-px bg-white/10"></div>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-black/10"></div>
        <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
          <span className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
            <i className="ri-file-chart-line text-white text-2xl" />
          </span>
          <div className="flex-1">
            <h2 className="text-lg font-heading font-bold text-white mb-1">Progress Reviews</h2>
            <p className="text-sm text-white/80 leading-relaxed max-w-2xl">
              Progress Reviews are formal meetings between you, your coach and your line manager. They review your progress, workplace application, KSB development and readiness for progression.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-white">{d.hero.totalPlanned}</p>
              <p className="text-xs text-white/70 font-medium uppercase tracking-wide">Planned</p>
            </div>
            <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-white">{d.hero.completed}</p>
              <p className="text-xs text-white/70 font-medium uppercase tracking-wide">Completed</p>
            </div>
            <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-white">#{d.hero.currentReviewNumber}</p>
              <p className="text-xs text-white/70 font-medium uppercase tracking-wide">Upcoming</p>
            </div>
            <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
              <p className="text-2xl font-bold text-white">{d.hero.daysUntilReview}</p>
              <p className="text-xs text-white/70 font-medium uppercase tracking-wide">Days</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── SECTION 2: READINESS SCORE ── */}
      <section className="bg-background-50 rounded-xl border border-background-200/70 p-6">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <DonutRing value={d.readiness.score} max={100} size={140} strokeWidth={12} label="Readiness" />
            <span className={`text-xs font-bold px-3 py-1 rounded-full ${statusBadge(d.readiness.status)}`}>{d.readiness.status}</span>
          </div>
          <div className="flex-1 w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Progress Review Readiness</h3>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-foreground-600"><span className="font-semibold text-emerald-600">{d.readiness.itemsComplete}</span> Complete</span>
                <span className="text-foreground-600"><span className="font-semibold text-amber-600">{d.readiness.itemsOutstanding}</span> Outstanding</span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {d.readiness.breakdown.map((item) => (
                <div key={item.label} className="bg-background-100 rounded-lg border border-background-200/50 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-foreground-700">{item.label}</span>
                    <span className="text-xs font-bold text-foreground-900">{item.value}{item.max === 100 ? '%' : ''}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-foreground-100 overflow-hidden">
                    <div className="h-full rounded-full bg-primary-500 transition-all duration-700" style={{ width: `${Math.min(100, (item.value / item.max) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}