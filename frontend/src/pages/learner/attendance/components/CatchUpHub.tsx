import { useState } from 'react';
import { CATCH_UP_QUEUE } from '@/mocks/attendance';

type TabKey = 'outstanding' | 'completed';

type SortKey = 'deadline' | 'progress' | 'session';

interface CatchUpHubProps {
  onStartCatchUp?: () => void;
}

export default function CatchUpHub({ onStartCatchUp }: CatchUpHubProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('outstanding');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('deadline');

  const tabs = [
    { key: 'outstanding' as TabKey, label: 'Outstanding', count: CATCH_UP_QUEUE.outstanding.length, icon: 'ri-timer-line', activeBg: 'bg-red-50 text-red-700', badge: 'bg-red-100 text-red-700' },
    { key: 'completed' as TabKey, label: 'Completed', count: CATCH_UP_QUEUE.completed.length, icon: 'ri-check-double-line', activeBg: 'bg-emerald-50 text-emerald-700', badge: 'bg-emerald-100 text-emerald-700' },
  ];

  const items = activeTab === 'outstanding' ? CATCH_UP_QUEUE.outstanding : CATCH_UP_QUEUE.completed;

  const sortedItems = [...items].sort((a, b) => {
    if (sortBy === 'deadline') return a.deadline.localeCompare(b.deadline);
    if (sortBy === 'progress') return a.progress - b.progress;
    return a.originalSession.localeCompare(b.originalSession);
  });

  const activeTabConfig = tabs.find(t => t.key === activeTab)!;

  return (
    <section className="bg-background-50 rounded-2xl border border-background-200/50 overflow-hidden">
      {/* Header + Tabs */}
      <div className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-heading font-semibold text-foreground-900 mb-0.5">Your Catch-Ups</h3>
            <p className="text-xs text-foreground-400">
              {activeTab === 'outstanding'
                ? `${CATCH_UP_QUEUE.outstanding.length} session${CATCH_UP_QUEUE.outstanding.length !== 1 ? 's' : ''} need${CATCH_UP_QUEUE.outstanding.length === 1 ? 's' : ''} your attention`
                : `${CATCH_UP_QUEUE.completed.length} session${CATCH_UP_QUEUE.completed.length !== 1 ? 's' : ''} completed and approved`
              }
            </p>
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-full p-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setExpandedId(null); }}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 whitespace-nowrap cursor-pointer ${
                  activeTab === tab.key
                    ? 'bg-white text-foreground-900 shadow-sm'
                    : 'text-foreground-400 hover:text-foreground-600'
                }`}
              >
                <AppIcon className={`${tab.icon} text-[11px]`}></AppIcon>
                {tab.label}
                {tab.count > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab.badge}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Sort bar */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] text-foreground-300 uppercase tracking-wide">Sort by</span>
          {(['deadline', 'progress', 'session'] as SortKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-md transition-smooth cursor-pointer whitespace-nowrap ${
                sortBy === key ? 'bg-primary-100 text-primary-700' : 'text-foreground-400 hover:text-foreground-600 hover:bg-background-100'
              }`}
            >
              {key === 'deadline' ? 'Deadline' : key === 'progress' ? 'Progress' : 'Session'}
            </button>
          ))}
        </div>
      </div>

      {/* Items List */}
      <div className="px-5 pb-5">
        {sortedItems.length === 0 ? (
          <div className="text-center py-10">
            <span className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
              <AppIcon className="ri-check-double-line text-foreground-300 text-lg"></AppIcon>
            </span>
            <p className="text-sm text-foreground-500">No catch-up items here</p>
            <p className="text-xs text-foreground-400 mt-0.5">
              {activeTab === 'outstanding' ? 'All caught up! Your attendance is in good standing.' : 'Complete outstanding catch-ups to see them here.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedItems.map((item) => {
              const isExpanded = expandedId === item.id;
              const isOverdue = item.status === 'Overdue';
              const isApproved = item.status === 'Approved';

              return (
                <div
                  key={item.id}
                  className={`bg-background-50 rounded-xl border transition-all duration-200 ${
                    isOverdue ? 'border-red-200/60 hover:border-red-300/60' :
                    isApproved ? 'border-emerald-200/40 hover:border-emerald-300/40' :
                    'border-background-200/60 hover:border-background-300/60'
                  }`}
                >
                  {/* Main row */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    className="w-full p-4 flex items-center gap-4 text-left cursor-pointer"
                  >
                    {/* Status indicator */}
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      isOverdue ? 'bg-red-100' : isApproved ? 'bg-emerald-100' : 'bg-amber-100'
                    }`}>
                      <AppIcon className={`${
                        isOverdue ? 'ri-error-warning-line text-red-600' :
                        isApproved ? 'ri-check-double-line text-emerald-600' :
                        'ri-timer-line text-amber-600'
                      } text-sm`}></AppIcon>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className="text-sm font-semibold text-foreground-900 truncate">{item.originalSession}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                          isOverdue ? 'bg-red-100 text-red-700' :
                          isApproved ? 'bg-emerald-100 text-emerald-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>{item.status}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-foreground-400 flex-wrap">
                        <span className="whitespace-nowrap">{item.date}</span>
                        <span className="hidden sm:inline">&middot;</span>
                        <span className="whitespace-nowrap">{item.reason}</span>
                        <span className="hidden sm:inline">&middot;</span>
                        <span className="whitespace-nowrap">{item.catchUpRoute}</span>
                      </div>
                    </div>

                    {/* Progress ring */}
                    <div className="shrink-0 flex items-center gap-3">
                      <div className="relative w-10 h-10 flex items-center justify-center">
                        <svg width="40" height="40" viewBox="0 0 40 40" className="-rotate-90">
                          <circle cx="20" cy="20" r="16" fill="none" stroke="oklch(var(--background-200))" strokeWidth="3" />
                          <circle cx="20" cy="20" r="16" fill="none"
                            stroke={item.progress === 100 ? 'oklch(var(--accent-400))' : item.progress >= 50 ? '#f59e0b' : '#ef4444'}
                            strokeWidth="3" strokeLinecap="round"
                            strokeDasharray={2 * Math.PI * 16}
                            strokeDashoffset={(2 * Math.PI * 16) - (item.progress / 100) * (2 * Math.PI * 16)}
                            style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
                          />
                        </svg>
                        <span className="absolute text-[9px] font-bold text-foreground-700">{item.progress}%</span>
                      </div>
                      <span className={`text-xs font-semibold whitespace-nowrap ${
                        isOverdue ? 'text-red-600' : isApproved ? 'text-emerald-600' : 'text-amber-600'
                      }`}>
                        {isOverdue ? 'Overdue' : isApproved ? 'Done' : `${item.progress}%`}
                      </span>
                    </div>

                    {/* Expand chevron */}
                    <AppIcon className={`ri-arrow-down-s-line text-foreground-300 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}></AppIcon>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0 border-t border-background-200/40 mx-4">
                      <div className="pt-3 space-y-2">
                        {/* Checklist */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <CheckItem label="Recording Watched" done={(item as any).recordingWatched ?? false} />
                          <CheckItem label="Reflection Done" done={(item as any).reflectionDone ?? false} />
                          <CheckItem label="Workplace Application" done={(item as any).workplaceDone ?? false} />
                          <CheckItem label="KSB Linked" done={(item as any).ksbLinked ?? false} />
                        </div>

                        {/* Details row */}
                        <div className="flex flex-wrap items-center gap-3 text-xs text-foreground-500 pt-1">
                          <span>Deadline: <strong className="text-foreground-700">{item.deadline}</strong></span>
                          <span>Coach: <strong className="text-foreground-700">{item.coach}</strong></span>
                        </div>

                        {isApproved && (item as any).approvedDate && (
                          <p className="text-xs text-emerald-600 font-medium">Approved on {(item as any).approvedDate}</p>
                        )}

                        {isOverdue && (
                          <button
                            onClick={onStartCatchUp}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-500 text-background-50 text-xs font-semibold hover:bg-primary-600 transition-smooth whitespace-nowrap cursor-pointer"
                          >
                            <AppIcon className="ri-play-circle-line"></AppIcon> Start Catch-Up
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function CheckItem({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
        done ? 'bg-emerald-100 text-emerald-600' : 'bg-background-100 text-foreground-300'
      }`}>
        <AppIcon className={done ? 'ri-check-line' : 'ri-subtract-line'}></AppIcon>
      </span>
      <span className={`text-xs ${done ? 'text-foreground-600' : 'text-foreground-400'}`}>{label}</span>
    </div>
  );
}