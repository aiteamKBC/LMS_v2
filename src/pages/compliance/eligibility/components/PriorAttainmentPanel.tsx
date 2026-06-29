import type { PriorAttainmentRecord } from '@/mocks/eligibility-review';

interface PriorAttainmentProps {
  records: PriorAttainmentRecord[];
}

export function PriorAttainmentPanel({ records }: PriorAttainmentProps) {
  const verified = records.filter(r => r.verified).length;
  const pct = records.length > 0 ? Math.round((verified / records.length) * 100) : 0;

  // Check for overqualification risk
  const highestLevel = records.reduce((max, r) => {
    const num = parseInt(r.level.replace(/\D/g, ''));
    return num > max ? num : max;
  }, 0);
  const overqualificationRisk = highestLevel >= 5;

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-foreground-400/50 flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-heading font-semibold text-foreground-900">Prior Attainment</h3>
          <p className="text-[12px] text-foreground-400 mt-0.5">Qualification verification and relevance assessment</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-24 h-2.5 bg-background-200 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-smooth ${pct === 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }}></div>
          </div>
          <span className="text-[12px] font-semibold text-foreground-700">{verified}/{records.length}</span>
        </div>
      </div>

      {overqualificationRisk && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg border bg-red-50 border-red-200/50 flex items-start gap-2">
          <i className="ri-error-warning-line text-red-500"></i>
          <p className="text-[12px] text-red-700">Level {highestLevel} qualification detected — potential overqualification risk. Review required to ensure programme provides substantial new learning.</p>
        </div>
      )}

      <div className="p-4 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-foreground-400/50">
              <th className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium pb-2 pr-3">Qualification</th>
              <th className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium pb-2 pr-3">Level</th>
              <th className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium pb-2 pr-3">Year</th>
              <th className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium pb-2 pr-3">Grade</th>
              <th className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium pb-2 pr-3">Verified</th>
              <th className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium pb-2 pr-3">Relevance</th>
              <th className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium pb-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {records.map(r => (
              <tr key={r.id} className="border-b border-background-100/70">
                <td className="py-2.5 pr-3">
                  <p className="text-[13px] text-foreground-800 font-medium">{r.qualification}</p>
                  <p className="text-[10px] text-foreground-400">{r.awardingBody}</p>
                </td>
                <td className="py-2.5 pr-3">
                  <span className="text-[12px] text-foreground-600">{r.level}</span>
                </td>
                <td className="py-2.5 pr-3">
                  <span className="text-[12px] text-foreground-600">{r.year}</span>
                </td>
                <td className="py-2.5 pr-3">
                  <span className="text-[12px] text-foreground-600">{r.grade}</span>
                </td>
                <td className="py-2.5 pr-3">
                  {r.verified ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                      <i className="ri-check-line text-xs"></i>
                      Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-red-500 font-medium">
                      <i className="ri-close-line text-xs"></i>
                      Not Verified
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-3">
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
                    r.relevance === 'relevant' ? 'bg-emerald-50 text-emerald-700'
                    : r.relevance === 'partial' ? 'bg-amber-50 text-amber-700'
                    : 'bg-red-50 text-red-700'
                  }`}>
                    {r.relevance === 'relevant' ? 'Relevant' : r.relevance === 'partial' ? 'Partial' : 'Not Relevant'}
                  </span>
                </td>
                <td className="py-2.5">
                  <p className="text-[12px] text-foreground-500 max-w-[200px] truncate" title={r.note}>{r.note}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}