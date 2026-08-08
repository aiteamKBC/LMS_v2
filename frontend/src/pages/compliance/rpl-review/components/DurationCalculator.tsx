import type { DurationReduction, ExperienceCrosswalk } from '@/mocks/rpl-review';

interface DurationCalculatorProps {
  reduction: DurationReduction;
  crosswalk: ExperienceCrosswalk[];
}

export function DurationCalculator({ reduction, crosswalk }: DurationCalculatorProps) {
  const reductionApplied = reduction.rplReduction > 0;

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-foreground-400/50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-heading font-semibold text-foreground-900">Duration Reduction Calculator</h3>
            <p className="text-[12px] text-foreground-400 mt-0.5">Standard duration adjusted by recognised prior learning</p>
          </div>
          {reductionApplied && (
            <span className={`text-[11px] font-semibold px-3 py-1 rounded-full whitespace-nowrap ${
              reduction.decisionStatus === 'approved' ? 'bg-emerald-50 text-emerald-700'
              : reduction.decisionStatus === 'rejected' ? 'bg-red-50 text-red-700'
              : 'bg-amber-50 text-amber-700'
            }`}>
              {reduction.decisionStatus === 'approved' ? 'Approved' : reduction.decisionStatus === 'rejected' ? 'Rejected' : 'Proposed'}
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Duration comparison */}
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="flex-1 px-5 py-4 rounded-xl border border-background-200/50 text-center">
            <p className="text-[10px] text-foreground-400 uppercase tracking-wider mb-1">Standard Duration</p>
            <p className="text-3xl font-heading font-bold text-foreground-600">{reduction.standardDuration} <span className="text-sm font-normal text-foreground-400">months</span></p>
          </div>

          {reductionApplied && (
            <>
              <div className="flex flex-col items-center">
                <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full whitespace-nowrap">
                  -{reduction.rplReduction} months
                </span>
                <span className="text-[9px] text-foreground-400 mt-0.5">{reduction.reductionPercentage}% reduction</span>
              </div>
              <div className="flex-1 px-5 py-4 rounded-xl border-2 border-primary-400/50 bg-primary-50/30 text-center">
                <p className="text-[10px] text-foreground-400 uppercase tracking-wider mb-1">Adjusted Duration</p>
                <p className="text-3xl font-heading font-bold text-primary-700">{reduction.adjustedDuration} <span className="text-sm font-normal text-primary-500">months</span></p>
              </div>
            </>
          )}
        </div>

        {/* Reduction breakdown */}
        {reduction.breakdown.length > 0 && (
          <div>
            <p className="text-[11px] text-foreground-400 uppercase tracking-wider font-medium mb-2">Reduction Breakdown</p>
            <div className="space-y-2">
              {reduction.breakdown.map((item, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-lg border border-background-200/50">
                  <span className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                    <span className="text-emerald-700 font-semibold text-[13px]">{item.months}m</span>
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground-800">{item.category}</p>
                    <p className="text-[12px] text-foreground-500 mt-0.5">{item.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {reductionApplied && reduction.approvedBy && (
          <div className="flex items-center gap-2 text-[11px] text-foreground-400">
            <AppIcon className="ri-check-line text-emerald-500"></AppIcon>
            <span>Approved by <span className="font-medium text-foreground-600">{reduction.approvedBy}</span></span>
            <span className="text-foreground-300">on</span>
            <span>{formatDate(reduction.approvedAt)}</span>
          </div>
        )}

        {/* Experience Crosswalk */}
        {crosswalk.length > 0 && crosswalk[0].relevanceScore > 0 && (
          <div className="pt-4 border-t border-background-200/50">
            <p className="text-[11px] text-foreground-400 uppercase tracking-wider font-medium mb-3">Experience-to-Standards Crosswalk</p>
            <div className="space-y-3">
              {crosswalk.map(exp => (
                <div key={exp.id} className="px-4 py-3 rounded-lg border border-background-200/50">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="text-[13px] font-semibold text-foreground-800">{exp.role}</p>
                      <p className="text-[11px] text-foreground-400">{exp.employer} &middot; {exp.duration}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
                        exp.evidenceStrength === 'strong' ? 'bg-emerald-50 text-emerald-700'
                        : exp.evidenceStrength === 'moderate' ? 'bg-amber-50 text-amber-700'
                        : 'bg-red-50 text-red-700'
                      }`}>{exp.evidenceStrength} evidence</span>
                      <span className="text-[11px] font-semibold text-foreground-600">{exp.relevanceScore}% match</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-foreground-400">Mapped KSBs:</span>
                    {exp.mappedKSBs.map(ksb => (
                      <span key={ksb} className="text-[10px] font-mono font-medium text-primary-700 bg-primary-50 px-1.5 py-0.5 rounded">{ksb}</span>
                    ))}
                  </div>
                  {exp.responsibilities.length > 0 && (
                    <div className="mt-2 space-y-0.5">
                      {exp.responsibilities.map((resp, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-[11px] text-foreground-500">
                          <AppIcon className="ri-check-line text-emerald-500 text-xs mt-0.5 shrink-0"></AppIcon>
                          {resp}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}