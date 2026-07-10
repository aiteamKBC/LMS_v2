import type { ProgrammeReadiness } from '@/mocks/initial-assessment';

interface ReadinessScoreProps {
  readiness: ProgrammeReadiness;
}

export function ReadinessScore({ readiness }: ReadinessScoreProps) {
  if (readiness.overallScore === 0) {
    return (
      <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 text-center">
        <p className="text-[13px] text-foreground-400 py-8">Programme readiness assessment not yet completed</p>
      </section>
    );
  }

  const bandConfig = getBandConfig(readiness.band);
  const ringCircumference = 2 * Math.PI * 54;
  const ringOffset = ringCircumference - (readiness.percentage / 100) * ringCircumference;

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-foreground-400/50">
        <h3 className="text-[15px] font-heading font-semibold text-foreground-900">Programme Readiness Score</h3>
        <p className="text-[12px] text-foreground-400 mt-0.5">Multi-dimensional readiness assessment across 5 domains</p>
      </div>

      <div className="p-5">
        <div className="flex flex-col sm:flex-row items-center gap-6 mb-6">
          {/* Donut ring */}
          <div className="relative w-36 h-36 shrink-0">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" className="text-background-200" strokeWidth="10" />
              <circle
                cx="60" cy="60" r="54" fill="none" stroke="currentColor"
                className={bandConfig.ringColor}
                strokeWidth="10" strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
                style={{ transition: 'stroke-dashoffset 1s ease-in-out' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-3xl font-heading font-bold ${bandConfig.textColor}`}>{readiness.percentage}%</span>
              <span className={`text-[10px] font-medium ${bandConfig.textColor} uppercase tracking-wider`}>{readiness.band}</span>
            </div>
          </div>

          {/* Band description */}
          <div className={`px-5 py-4 rounded-xl border flex-1 ${bandConfig.bg} ${bandConfig.border}`}>
            <p className={`text-[14px] font-heading font-semibold ${bandConfig.textColor} mb-1`}>
              {readiness.band}
            </p>
            <p className="text-[12px] text-foreground-600 leading-relaxed">
              {readiness.band === 'Ready' && 'Learner demonstrates strong readiness across all domains. Proceed to programme with standard support.'}
              {readiness.band === 'Ready with Support' && 'Learner is ready but requires targeted support in specific areas. Proceed with structured support plan.'}
              {readiness.band === 'Requires Development' && 'Learner requires significant development in one or more domains. Structured intervention needed before programme start.'}
              {readiness.band === 'Not Ready' && 'Learner is not yet ready for programme. Significant gaps across multiple domains. Functional skills or pre-programme development required.'}
            </p>
          </div>
        </div>

        {/* Category breakdown */}
        <div>
          <p className="text-[11px] text-foreground-400 uppercase tracking-wider font-medium mb-3">Domain Breakdown</p>
          <div className="space-y-3">
            {readiness.categories.map(cat => {
              const barColor = cat.percentage >= 80 ? 'bg-emerald-500'
                : cat.percentage >= 60 ? 'bg-primary-500'
                : cat.percentage >= 40 ? 'bg-amber-500'
                : 'bg-red-500';
              return (
                <div key={cat.name}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] text-foreground-700 font-medium">{cat.name}</span>
                    <span className="text-[11px] text-foreground-500">{cat.score}/{cat.maxScore}</span>
                  </div>
                  <div className="w-full h-2.5 bg-background-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-smooth ${barColor}`} style={{ width: `${cat.percentage}%` }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Assessor note */}
        {readiness.assessorNote && (
          <div className="mt-4 px-4 py-3 rounded-lg bg-background-50 border border-background-200/50">
            <p className="text-[11px] text-foreground-400 uppercase tracking-wider font-medium mb-1.5">Assessor Notes</p>
            <p className="text-[12px] text-foreground-600 leading-relaxed">{readiness.assessorNote}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function getBandConfig(band: string): { bg: string; border: string; textColor: string; ringColor: string } {
  const map: Record<string, { bg: string; border: string; textColor: string; ringColor: string }> = {
    'Ready': { bg: 'bg-emerald-50/60', border: 'border-emerald-200/50', textColor: 'text-emerald-700', ringColor: 'text-emerald-500' },
    'Ready with Support': { bg: 'bg-amber-50/60', border: 'border-amber-200/50', textColor: 'text-amber-700', ringColor: 'text-amber-500' },
    'Requires Development': { bg: 'bg-amber-50/60', border: 'border-amber-200/50', textColor: 'text-amber-700', ringColor: 'text-amber-500' },
    'Not Ready': { bg: 'bg-red-50/60', border: 'border-red-200/50', textColor: 'text-red-700', ringColor: 'text-red-500' },
  };
  return map[band] || { bg: 'bg-background-100', border: 'border-background-200/50', textColor: 'text-foreground-500', ringColor: 'text-foreground-300' };
}