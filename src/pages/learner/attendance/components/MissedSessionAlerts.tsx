import { MISSED_SESSION_ALERTS } from '@/mocks/attendance';
import { useState } from 'react';

export default function MissedSessionAlerts() {
  const [showDetails, setShowDetails] = useState<string | null>(null);

  if (MISSED_SESSION_ALERTS.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <span className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center">
          <i className="ri-error-warning-line text-red-600 text-base"></i>
        </span>
        <h3 className="text-sm font-heading font-semibold text-foreground-900">Action Required</h3>
      </div>
      <div className="space-y-3">
        {MISSED_SESSION_ALERTS.map((alert) => {
          const isOpen = showDetails === alert.id;
          return (
            <div key={alert.id} className="bg-red-50/50 rounded-2xl border border-red-200/40 p-5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                      {alert.catchUpStatus}
                    </span>
                    <span className="text-[11px] text-red-500">Deadline: {alert.deadline}</span>
                  </div>
                  <p className="text-sm font-semibold text-foreground-900 mb-1">{alert.session}</p>
                  <div className="flex items-center gap-3 text-[11px] text-foreground-400 flex-wrap">
                    <span>{alert.module}</span>
                    <span className="text-foreground-200">·</span>
                    <span>{alert.date}</span>
                    <span className="text-foreground-200">·</span>
                    <span>Route: {alert.route}</span>
                    <span className="text-foreground-200">·</span>
                    <span>Coach: {alert.coach}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <button className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-all whitespace-nowrap cursor-pointer">
                    <i className="ri-play-circle-line"></i> Complete Catch-Up
                  </button>
                  <button
                    onClick={() => setShowDetails(isOpen ? null : alert.id)}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-background-50 border border-background-200/50 text-xs font-medium text-foreground-500 hover:bg-background-100 transition-all whitespace-nowrap cursor-pointer"
                  >
                    <i className={`${isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`}></i>
                    {isOpen ? 'Hide' : 'Details'}
                  </button>
                </div>
              </div>
              {isOpen && (
                <div className="mt-4 pt-4 border-t border-red-200/30">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px] text-foreground-500">
                    <div className="bg-background-50 rounded-xl border border-background-200/50 p-3">
                      <p className="text-[11px] text-foreground-400 mb-0.5">Catch-up Route</p>
                      <p className="text-xs font-medium text-foreground-900">{alert.route}</p>
                    </div>
                    <div className="bg-background-50 rounded-xl border border-background-200/50 p-3">
                      <p className="text-[11px] text-foreground-400 mb-0.5">Coach</p>
                      <p className="text-xs font-medium text-foreground-900">{alert.coach}</p>
                    </div>
                    <div className="bg-background-50 rounded-xl border border-background-200/50 p-3">
                      <p className="text-[11px] text-foreground-400 mb-0.5">Deadline</p>
                      <p className="text-xs font-medium text-foreground-900">{alert.deadline}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}