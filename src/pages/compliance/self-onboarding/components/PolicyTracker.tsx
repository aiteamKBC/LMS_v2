import type { PolicyAcknowledgement } from '@/mocks/self-onboarding';

interface PolicyTrackerProps {
  policies: PolicyAcknowledgement[];
  learnerName: string;
}

export function PolicyTracker({ policies, learnerName }: PolicyTrackerProps) {
  const acknowledgedCount = policies.filter(p => p.acknowledgedDate).length;
  const pct = Math.round((acknowledgedCount / policies.length) * 100);

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">Policy Acknowledgements</h3>
          <p className="text-[11px] text-foreground-400 mt-0.5">{acknowledgedCount} of {policies.length} policies acknowledged</p>
        </div>
        <span className={`text-[12px] font-semibold px-2.5 py-1 rounded-full ${
          acknowledgedCount === policies.length ? 'bg-emerald-50 text-emerald-600' : acknowledgedCount > 0 ? 'bg-primary-50 text-primary-600' : 'bg-background-200 text-foreground-400'
        }`}>
          {acknowledgedCount === policies.length ? 'All Complete' : `${pct}%`}
        </span>
      </div>

      <div className="w-full h-1.5 bg-background-200 rounded-full overflow-hidden mb-4">
        <div className="h-full bg-primary-500 rounded-full transition-smooth" style={{ width: `${pct}%` }}></div>
      </div>

      <div className="space-y-3">
        {policies.map((policy, idx) => (
          <div
            key={idx}
            className={`flex items-center justify-between p-3 rounded-lg border transition-smooth ${
              policy.acknowledgedDate
                ? 'border-emerald-200/50 bg-emerald-50/30'
                : 'border-background-200/40 bg-background-50'
            }`}
          >
            <div className="flex items-start gap-3 min-w-0">
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                policy.acknowledgedDate ? 'bg-emerald-100 text-emerald-600' : 'bg-background-100 text-foreground-300'
              }`}>
                <i className={`${policy.acknowledgedDate ? 'ri-check-line' : 'ri-time-line'} text-sm`}></i>
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground-800 truncate">{policy.policyName}</p>
                <p className="text-[10px] text-foreground-400">Version {policy.policyVersion}</p>
                {policy.acknowledgedDate && (
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="text-[10px] text-emerald-600 font-medium">Acknowledged {policy.acknowledgedDate}</span>
                    <span className="text-[10px] text-foreground-400">by {policy.learnerSignature}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                policy.read
                  ? 'bg-background-200 text-foreground-500'
                  : 'bg-red-50 text-red-500'
              }`}>
                {policy.read ? 'Read' : 'Unread'}
              </span>
              <a
                href={policy.documentLink}
                className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center hover:bg-primary-50 hover:text-primary-600 transition-smooth cursor-pointer"
                title="View document"
              >
                <i className="ri-file-text-line text-xs"></i>
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}