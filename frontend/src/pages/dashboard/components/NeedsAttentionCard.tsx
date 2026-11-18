import { useId, useState } from "react";
import Panel from "@/components/base/Panel";
import type { HeaderNotification } from "@/components/feature/Header";

interface NeedsAttentionCardProps {
  notifications: HeaderNotification[];
  onNotificationClick: (notification: HeaderNotification) => void;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
}

export default function NeedsAttentionCard({ notifications, onNotificationClick, loading = false, error = '', onRefresh }: NeedsAttentionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const headingId = useId();
  return (
    <div className="flex w-full min-w-0 flex-col items-end gap-3">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => {
          if (!expanded && !loading) onRefresh?.();
          setExpanded(value => !value);
        }}
        className="inline-flex items-center gap-2 rounded-lg border border-primary-300 bg-primary-50 px-4 py-2.5 text-[13px] font-semibold text-primary-800 transition-colors hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <i className="ri-notification-3-line text-[16px]" aria-hidden="true" />
        Needs Attention
        <i className={expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} aria-hidden="true" />
      </button>
      <div id={contentId} hidden={!expanded} className="w-full min-w-0">
        {expanded ? (
          <Panel
            title="Needs Attention"
            description="Quality alerts from your notifications. Select an alert to review the details."
            headingId={headingId}
            className="w-full min-w-0 [&>div:first-child]:flex-wrap [&>div:first-child]:px-4 [&>div:first-child]:py-3 [&_h2]:text-[14px] [&_h2+p]:text-[12px]"
            bodyClassName="p-0"
            action={
              <div className="flex flex-wrap items-center gap-2">
                {onRefresh ? <button type="button" disabled={loading} onClick={onRefresh} className="rounded-md border border-background-300 px-2.5 py-1 text-[12px] font-semibold text-foreground-700 disabled:opacity-50">Refresh alerts</button> : null}
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-[12px] font-semibold text-red-700">
                  <i className="ri-notification-3-line text-[14px]" aria-hidden="true" />
                  {loading ? 'Loading…' : error ? 'Unavailable' : `${notifications.length} ${notifications.length === 1 ? 'alert' : 'alerts'}`}
                </span>
              </div>
            }
          >
            {loading ? <p role="status" className="px-4 py-6 text-[13px] text-foreground-600 sm:px-5">Loading quality alerts…</p> : error ? <p role="alert" className="px-4 py-6 text-[13px] text-red-700 sm:px-5">{error}</p> : notifications.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-foreground-600 sm:px-5">No quality alerts need your attention.</p>
            ) : (
              <ul className="max-h-60 overflow-y-auto overscroll-contain divide-y divide-background-200">
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => onNotificationClick(notification)}
                      className="flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-background-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
                        <i className="ri-alarm-warning-line text-[16px]" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[12px] font-semibold text-foreground-950">{notification.title}</span>
                        <span className="mt-0.5 block break-words text-[12px] leading-relaxed text-foreground-700">{notification.description}</span>
                        {notification.meta ? <span className="mt-1 block break-words text-[11px] text-foreground-500">{notification.meta}</span> : null}
                      </span>
                      <i className="ri-arrow-right-s-line mt-1 shrink-0 text-[18px] text-foreground-400" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
