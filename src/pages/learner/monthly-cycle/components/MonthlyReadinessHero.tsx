import { MAY_READINESS, JUNE_READINESS, JULY_READINESS } from '@/mocks/monthly-cycle';

interface MonthlyReadinessHeroProps {
  month: string;
}

const statusConfig: Record<string, { color: string; bg: string; border: string; label: string }> = {
  'On Track': { color: 'text-accent-400', bg: 'bg-accent-400/10', border: 'border-accent-400/20', label: 'On Track' },
  'At Risk': { color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20', label: 'At Risk' },
  'Completed': { color: 'text-accent-400', bg: 'bg-accent-400/15', border: 'border-accent-400/25', label: 'Completed' },
};

const monthDataMap: Record<string, typeof JUNE_READINESS> = {
  may: MAY_READINESS,
  jun: JUNE_READINESS,
  jul: JULY_READINESS,
};

export default function MonthlyReadinessHero({ month }: MonthlyReadinessHeroProps) {
  const d = monthDataMap[month] || JUNE_READINESS;
  const sc = statusConfig[d.status];
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (d.progress / 100) * circumference;

  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800">
      {/* Liquid blob overlays */}
      <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full bg-accent-400/8 blur-3xl animate-spin-slow"></div>
      <div className="absolute -bottom-16 right-0 w-64 h-64 rounded-full bg-primary-400/10 blur-3xl animate-spin-slower"></div>
      <div className="absolute top-1/2 left-1/3 w-48 h-48 rounded-full bg-primary-300/6 blur-3xl animate-float"></div>

      <div className="relative p-6 flex flex-col sm:flex-row items-center gap-6">
        {/* Circular Progress Ring */}
        <div className="relative w-40 h-40 flex items-center justify-center shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r={radius} fill="none" stroke="oklch(var(--primary-800))" strokeWidth="10" />
            <circle
              cx="70" cy="70" r={radius} fill="none"
              stroke="oklch(var(--accent-400))" strokeWidth="10" strokeLinecap="round"
              strokeDasharray={circumference} strokeDashoffset={offset}
              className="transition-all duration-700 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-white font-heading">{d.progress}%</span>
            <span className="text-[11px] text-white/50 font-medium mt-0.5">Readiness</span>
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 text-center sm:text-left">
          <div className="flex items-center gap-2 mb-1 justify-center sm:justify-start">
            <span className="text-[10px] font-bold text-accent-400/80 bg-accent-400/10 px-2 py-0.5 rounded-full border border-accent-400/15 uppercase tracking-wider">
              Monthly Readiness Score
            </span>
          </div>
          <h2 className="text-2xl font-heading font-bold text-white mt-1">{d.monthLabel}</h2>
          <div className="flex items-center gap-3 mt-2 justify-center sm:justify-start">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${sc.bg} ${sc.color} ${sc.border}`}>
              {sc.label}
            </span>
            <span className="text-sm text-white/60">{d.summary}</span>
          </div>

          {/* Week progress bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-white/50 font-medium">Week Progress</span>
              <span className="text-xs text-white/40">Week {d.week} of {d.totalWeeks}</span>
            </div>
            <div className="w-full h-2.5 bg-primary-800/60 rounded-full overflow-hidden flex gap-0.5">
              {Array.from({ length: d.totalWeeks }).map((_, i) => (
                <div
                  key={i}
                  className={`h-full rounded-full transition-all duration-500 ${i < d.week ? 'bg-accent-400' : 'bg-primary-800'}`}
                  style={{ flex: 1 }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="flex flex-col gap-2.5 shrink-0 bg-primary-800/30 rounded-lg p-4 border border-primary-700/30">
          <div className="flex items-center gap-2 text-sm">
            <span className={`w-2 h-2 rounded-full ${d.progress > 0 ? 'bg-accent-400' : 'bg-primary-600'}`}></span>
            <span className="text-white/70">{d.progress > 0 ? `Week ${d.week} in progress` : 'Week 1 upcoming'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-primary-600"></span>
            <span className="text-white/50">Assignment due 20 {month === 'may' ? 'May' : month === 'jul' ? 'Jul' : 'Jun'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-primary-600"></span>
            <span className="text-white/50">Coaching {month === 'may' ? '21–31' : month === 'jul' ? '21–31' : '21–30'} {month === 'may' ? 'May' : month === 'jul' ? 'Jul' : 'Jun'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}