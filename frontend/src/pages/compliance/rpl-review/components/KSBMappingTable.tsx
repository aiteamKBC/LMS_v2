import type { KSBCategory } from '@/mocks/rpl-review';

interface KSBMappingProps {
  ksbCategories: KSBCategory[];
  rplPercentage: number;
}

export function KSBMappingTable({ ksbCategories, rplPercentage }: KSBMappingProps) {
  if (ksbCategories.length === 0) {
    return (
      <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 text-center">
        <i className="ri-file-search-line text-3xl text-foreground-300 mb-3 block"></i>
        <p className="text-[13px] text-foreground-500 font-medium">KSB mapping not yet started</p>
        <p className="text-[12px] text-foreground-400 mt-1">KSB categories will appear here once evidence collection is complete and mapping begins.</p>
      </section>
    );
  }

  const fullyMet = ksbCategories.filter(k => k.rplStatus === 'fully-met').length;
  const partiallyMet = ksbCategories.filter(k => k.rplStatus === 'partially-met').length;
  const notMet = ksbCategories.filter(k => k.rplStatus === 'not-met').length;

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-foreground-400/50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-heading font-semibold text-foreground-900">KSB Mapping</h3>
            <p className="text-[12px] text-foreground-400 mt-0.5">Knowledge, Skills & Behaviours — recognition of prior learning against standard</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span><span className="text-[10px] text-foreground-400">{fullyMet} met</span></div>
              <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"></span><span className="text-[10px] text-foreground-400">{partiallyMet} partial</span></div>
              <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400"></span><span className="text-[10px] text-foreground-400">{notMet} not met</span></div>
            </div>
            <div className="w-24 h-2.5 bg-background-200 rounded-full overflow-hidden">
              <div className="h-full bg-primary-500 rounded-full transition-smooth" style={{ width: `${rplPercentage}%` }}></div>
            </div>
            <span className="text-[12px] font-semibold text-foreground-700">{rplPercentage}%</span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-foreground-400/50">
              <th className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium px-4 py-2.5">Type</th>
              <th className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium px-4 py-2.5">Ref</th>
              <th className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium px-4 py-2.5">Description</th>
              <th className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium px-4 py-2.5">RPL %</th>
              <th className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium px-4 py-2.5">Decision</th>
              <th className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium px-4 py-2.5">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {ksbCategories.map(ksb => {
              const typeStyle = ksb.type === 'Knowledge' ? 'bg-primary-50 text-primary-700'
                : ksb.type === 'Skill' ? 'bg-accent-50 text-accent-700'
                : 'bg-secondary-50 text-secondary-700';
              const rplBarColor = ksb.rplPercentage >= 80 ? 'bg-emerald-500'
                : ksb.rplPercentage >= 40 ? 'bg-amber-500'
                : ksb.rplPercentage > 0 ? 'bg-red-500'
                : 'bg-background-300';
              const decisionConfig = ksb.assessorDecision === 'accept' ? { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Accept' }
                : ksb.assessorDecision === 'partial-accept' ? { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Partial Accept' }
                : ksb.assessorDecision === 'reject' ? { bg: 'bg-red-50', text: 'text-red-700', label: 'Reject' }
                : { bg: 'bg-background-100', text: 'text-foreground-500', label: 'Pending' };

              return (
                <tr key={ksb.id} className="border-b border-background-100/70 hover:bg-background-50 transition-smooth">
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${typeStyle}`}>{ksb.type}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[12px] font-mono font-semibold text-foreground-700">{ksb.ref}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="max-w-[280px]">
                      <p className="text-[13px] text-foreground-700">{ksb.description}</p>
                      {ksb.assessorNote && (
                        <p className="text-[11px] text-foreground-400 mt-1 italic">{ksb.assessorNote}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-12 h-1.5 bg-background-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${rplBarColor}`} style={{ width: `${ksb.rplPercentage}%` }}></div>
                      </div>
                      <span className="text-[11px] font-medium text-foreground-600">{ksb.rplPercentage}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${decisionConfig.bg} ${decisionConfig.text}`}>
                      {decisionConfig.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-[11px] text-foreground-500 max-w-[180px] truncate" title={ksb.evidence}>{ksb.evidence || '—'}</p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}