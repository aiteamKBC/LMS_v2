import type { FundingEligibilityCheck } from '@/mocks/eligibility-review';

interface FundingPanelProps {
  checks: FundingEligibilityCheck[];
}

export function FundingPanel({ checks }: FundingPanelProps) {
  const passed = checks.filter(c => c.status === 'pass').length;
  const total = checks.length;
  const pct = Math.round((passed / total) * 100);

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-foreground-400/50 flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-heading font-semibold text-foreground-900">Funding Eligibility</h3>
          <p className="text-[12px] text-foreground-400 mt-0.5">Levy status, PAYE, DAS account, and funding route checks</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-24 h-2.5 bg-background-200 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-smooth ${pct === 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }}></div>
          </div>
          <span className="text-[12px] font-semibold text-foreground-700">{passed}/{total}</span>
        </div>
      </div>
      <div className="p-4 space-y-2">
        {checks.map(check => {
          const config = getCheckStatusConfig(check.status);
          return (
            <div key={check.id} className="flex items-start gap-3 px-4 py-3 rounded-lg border border-foreground-200/60">
              <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${config.iconBg}`}>
                <i className={`${config.icon} ${config.iconColor} text-xs`}></i>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-[13px] font-medium text-foreground-800">{check.check}</p>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${config.badgeBg} ${config.badgeText}`}>
                    {config.badgeLabel}
                  </span>
                </div>
                <p className="text-[12px] text-foreground-500">{check.detail}</p>
                {check.note && (
                  <p className="text-[11px] text-foreground-400 mt-1.5 pt-1.5 border-t border-background-100">{check.note}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function getCheckStatusConfig(status: string): { icon: string; iconBg: string; iconColor: string; badgeBg: string; badgeText: string; badgeLabel: string } {
  const map: Record<string, { icon: string; iconBg: string; iconColor: string; badgeBg: string; badgeText: string; badgeLabel: string }> = {
    'pass': { icon: 'ri-check-line', iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', badgeBg: 'bg-emerald-50', badgeText: 'text-emerald-700', badgeLabel: 'Pass' },
    'fail': { icon: 'ri-close-line', iconBg: 'bg-red-50', iconColor: 'text-red-600', badgeBg: 'bg-red-50', badgeText: 'text-red-700', badgeLabel: 'Fail' },
    'not-applicable': { icon: 'ri-forbid-line', iconBg: 'bg-background-100', iconColor: 'text-foreground-400', badgeBg: 'bg-background-100', badgeText: 'text-foreground-500', badgeLabel: 'N/A' },
    'not-reviewed': { icon: 'ri-time-line', iconBg: 'bg-background-100', iconColor: 'text-foreground-400', badgeBg: 'bg-background-100', badgeText: 'text-foreground-500', badgeLabel: 'Not Reviewed' },
  };
  return map[status] || map['not-reviewed'];
}