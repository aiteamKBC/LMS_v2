import { useState } from 'react';
import type { ResidencyTest } from '@/mocks/eligibility-review';

interface ResidencyTestsProps {
  tests: ResidencyTest[];
}

export function ResidencyTests({ tests }: ResidencyTestsProps) {
  const [expanded, setExpanded] = useState<string | null>(tests[0]?.id || null);

  const passed = tests.filter(t => t.status === 'pass').length;
  const pct = Math.round((passed / tests.length) * 100);

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-foreground-400/50 flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-heading font-semibold text-foreground-900">3-Residency Test</h3>
          <p className="text-[12px] text-foreground-400 mt-0.5">Evidence of UK/EEA residence and right to study</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-24 h-2.5 bg-background-200 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-smooth ${pct === 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }}></div>
          </div>
          <span className="text-[12px] font-semibold text-foreground-700">{passed}/{tests.length}</span>
        </div>
      </div>
      <div className="p-4 space-y-3">
        {tests.map(test => {
          const isExpanded = expanded === test.id;
          const config = getTestStatusConfig(test.status);
          return (
            <div key={test.id} className="border border-background-200/50 rounded-lg overflow-hidden">
              <button
                onClick={() => setExpanded(isExpanded ? null : test.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer hover:bg-background-100 transition-smooth"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${config.iconBg}`}>
                    <AppIcon className={`${config.icon} ${config.iconColor} text-sm`}></AppIcon>
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground-800">{test.label}</p>
                    <p className="text-[11px] text-foreground-400 truncate">{test.description.substring(0, 80)}...</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${config.badgeBg} ${config.badgeText}`}>
                    {config.badgeLabel}
                  </span>
                  <AppIcon className={isExpanded ? 'ri-arrow-up-s-line text-foreground-300' : 'ri-arrow-down-s-line text-foreground-300'}></AppIcon>
                </div>
              </button>
              {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-background-200/50 pt-3">
                  <div>
                    <p className="text-[11px] text-foreground-400 uppercase tracking-wider font-medium">Description</p>
                    <p className="text-[13px] text-foreground-700 mt-1">{test.description}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <p className="text-[11px] text-foreground-400 uppercase tracking-wider font-medium">Evidence</p>
                      <p className="text-[13px] text-foreground-700 mt-1">{test.evidence}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-foreground-400 uppercase tracking-wider font-medium">Reviewer Note</p>
                      <p className="text-[13px] text-foreground-700 mt-1">{test.reviewerNote}</p>
                    </div>
                  </div>
                  {test.reviewedBy && (
                    <div className="flex items-center gap-2 text-[11px] text-foreground-400">
                      <AppIcon className="ri-user-line text-xs"></AppIcon>
                      <span>Reviewed by <span className="font-medium text-foreground-600">{test.reviewedBy}</span></span>
                      <span className="text-foreground-300">on</span>
                      <span>{formatDate(test.reviewedAt)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function getTestStatusConfig(status: string): { icon: string; iconBg: string; iconColor: string; badgeBg: string; badgeText: string; badgeLabel: string } {
  const map: Record<string, { icon: string; iconBg: string; iconColor: string; badgeBg: string; badgeText: string; badgeLabel: string }> = {
    'pass': { icon: 'ri-check-line', iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', badgeBg: 'bg-emerald-50', badgeText: 'text-emerald-700', badgeLabel: 'Passed' },
    'fail': { icon: 'ri-close-line', iconBg: 'bg-red-50', iconColor: 'text-red-600', badgeBg: 'bg-red-50', badgeText: 'text-red-700', badgeLabel: 'Failed' },
    'evidence-required': { icon: 'ri-file-search-line', iconBg: 'bg-amber-50', iconColor: 'text-amber-600', badgeBg: 'bg-amber-50', badgeText: 'text-amber-700', badgeLabel: 'Evidence Required' },
    'not-reviewed': { icon: 'ri-question-line', iconBg: 'bg-background-100', iconColor: 'text-foreground-400', badgeBg: 'bg-background-100', badgeText: 'text-foreground-500', badgeLabel: 'Not Reviewed' },
  };
  return map[status] || map['not-reviewed'];
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}