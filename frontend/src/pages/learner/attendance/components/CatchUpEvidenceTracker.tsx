import { CATCH_UP_EVIDENCE } from '@/mocks/attendance';

type EvidenceStatusTab = 'outstanding' | 'submitted' | 'approved' | 'rejected';

const statusConfig: Record<EvidenceStatusTab, { label: string; color: string; bg: string; icon: string }> = {
  outstanding: { label: 'Outstanding', color: 'red', bg: 'bg-red-100 text-red-700', icon: 'ri-timer-line' },
  submitted: { label: 'Submitted', color: 'amber', bg: 'bg-amber-100 text-amber-700', icon: 'ri-upload-cloud-2-line' },
  approved: { label: 'Approved', color: 'emerald', bg: 'bg-emerald-100 text-emerald-700', icon: 'ri-check-double-line' },
  rejected: { label: 'Rejected', color: 'red', bg: 'bg-red-100 text-red-700', icon: 'ri-close-circle-line' },
};

export default function CatchUpEvidenceTracker() {
  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
      <div className="p-5 border-b border-background-200/50 flex items-center gap-3">
        <span className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
          <AppIcon className="ri-folder-check-line text-primary-600 text-sm"></AppIcon>
        </span>
        <h3 className="text-base font-heading font-semibold text-foreground-900">Catch-Up Evidence Tracker</h3>
      </div>
      <div className="p-5">
        {(['outstanding', 'submitted', 'approved', 'rejected'] as EvidenceStatusTab[]).map((status) => {
          const items = CATCH_UP_EVIDENCE[status];
          const config = statusConfig[status];

          return (
            <div key={status} className="mb-4 last:mb-0">
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${config.bg}`}>{config.label}</span>
                <span className="text-xs text-foreground-400">{items.length} item{items.length !== 1 ? 's' : ''}</span>
              </div>
              {items.length === 0 ? (
                <div className="bg-background-50 rounded-lg border border-dashed border-background-200/70 p-3 text-center">
                  <p className="text-xs text-foreground-400">No evidence in this category</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item) => (
                    <div key={item.id} className="bg-background-50 rounded-lg border border-background-200/70 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground-900">{item.session}</p>
                          <p className="text-xs text-foreground-400">{item.date} &middot; {item.evidenceType}</p>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${config.bg}`}>
                          {item.status}
                        </span>
                      </div>
                      {item.feedback && (
                        <div className="mt-2 pt-2 border-t border-background-200/50">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] font-medium text-foreground-400">{item.feedback.from}</span>
                            <span className="text-[10px] text-foreground-300">{item.feedback.date}</span>
                          </div>
                          <p className="text-xs text-foreground-500 leading-relaxed">{item.feedback.text}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}