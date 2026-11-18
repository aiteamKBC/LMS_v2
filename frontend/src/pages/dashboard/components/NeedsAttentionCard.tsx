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
  return (
    <Panel
      title="Needs Attention"
      description="Quality alerts from your notifications. Select an alert to review the details."
      headingId="needs-attention-heading"
      bodyClassName="p-0"
      action={
        <div className="flex items-center gap-2">
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
        <ul className="max-h-80 overflow-y-auto divide-y divide-background-200">
          {notifications.map((notification) => (
            <li key={notification.id}>
              <button
                type="button"
                onClick={() => onNotificationClick(notification)}
                className="flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-background-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 sm:px-5"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
                  <i className="ri-alarm-warning-line text-[17px]" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-foreground-950">{notification.title}</span>
                  <span className="mt-1 block break-words text-[12px] leading-relaxed text-foreground-700">{notification.description}</span>
                  {notification.meta ? <span className="mt-1.5 block text-[11px] text-foreground-500">{notification.meta}</span> : null}
                </span>
                <i className="ri-arrow-right-s-line mt-1 shrink-0 text-[18px] text-foreground-400" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
