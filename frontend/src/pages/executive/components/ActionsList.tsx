import { Link } from "react-router-dom";
import Panel from "@/components/base/Panel";
import RagBadge from "@/components/base/RagBadge";
import { TIME_ZONE_LABEL, todayIso } from "@/pages/curriculum/recordings/utils";
import { daysBetween, formatDateShort, isOpenAction } from "@/lib/qms";
import type { ActionStatus, QualityAction } from "@/types/qms";

const STATUS_STYLE: Record<ActionStatus, string> = {
  Overdue: "bg-[var(--rag-red-bg)] text-[var(--rag-red-fg)]",
  "In Progress": "bg-primary-100 text-primary-800",
  Assigned: "bg-secondary-200 text-secondary-900",
  Open: "bg-background-200 text-foreground-800",
  "Awaiting Verification": "bg-accent-100 text-accent-800",
  Resolved: "bg-[var(--rag-green-bg)] text-[var(--rag-green-fg)]",
  Closed: "bg-background-200 text-foreground-600",
};

const STATUS_ICON: Record<ActionStatus, string> = {
  Overdue: "ri-alarm-warning-line",
  "In Progress": "ri-loader-4-line",
  Assigned: "ri-user-received-line",
  Open: "ri-circle-line",
  "Awaiting Verification": "ri-eye-line",
  Resolved: "ri-check-double-line",
  Closed: "ri-lock-line",
};

interface ActionsListProps {
  actions: QualityAction[];
  limit?: number;
}

export default function ActionsList({ actions, limit = 7 }: ActionsListProps) {
  const today = todayIso(TIME_ZONE_LABEL);
  const open = actions.filter(isOpenAction);
  const priorityWeight = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const sorted = [...open]
    .sort((a, b) => {
      if (priorityWeight[a.priority] !== priorityWeight[b.priority]) {
        return priorityWeight[a.priority] - priorityWeight[b.priority];
      }
      return a.dueOn.localeCompare(b.dueOn);
    })
    .slice(0, limit);

  return (
    <Panel
      title="Open improvement actions"
      description="Actions linked to the exact quality record that raised the concern."
      headingId="actions-heading"
      bodyClassName="px-0 pb-1 pt-0"
      action={
        <Link
          to="/qa/findings"
          className="inline-flex items-center gap-1 font-label text-[12px] font-semibold text-primary-700 hover:text-primary-800"
        >
          Action tracker
          <i className="ri-arrow-right-line text-[13px]" aria-hidden="true" />
        </Link>
      }
    >
      {sorted.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <i className="ri-checkbox-circle-line text-[22px] text-[var(--rag-green-fg)]" aria-hidden="true" />
          <p className="mt-2 text-[13px] font-medium text-foreground-900">No open actions in scope</p>
          <p className="mt-1 text-[12px] text-foreground-600">
            All improvement actions for these filters are resolved or closed.
          </p>
        </div>
      ) : (
        <div className="kbc-scroll overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <caption className="sr-only">Open improvement actions with owner, target date and status</caption>
            <thead>
              <tr className="border-b border-background-200">
                {["Action", "Linked record", "Owner", "Target date", "Priority", "Status"].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="px-3 py-2 font-label text-[10.5px] font-semibold uppercase tracking-[0.08em] text-foreground-600 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((action) => {
                const isLate = action.dueOn < today;
                const ageing = daysBetween(action.openedOn, today);
                return (
                  <tr key={action.id} className="border-b border-background-100 align-top last:border-0">
                    <td className="max-w-[280px] px-3 py-3 first:pl-4 sm:first:pl-5">
                      <p className="font-label text-[11px] font-semibold tracking-[0.04em] text-foreground-500">
                        {action.ref}
                      </p>
                      <p className="mt-0.5 text-[12.5px] font-medium leading-snug text-foreground-950">
                        {action.title}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-[11.5px] text-foreground-800">{action.recordId}</p>
                      <p className="text-[11px] text-foreground-500">{action.formName}</p>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-[11.5px] text-foreground-800">
                      {action.owner}
                      <p className="text-[11px] text-foreground-500">{action.department}</p>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <p className={`text-[11.5px] ${isLate ? "font-semibold text-[var(--rag-red-fg)]" : "text-foreground-800"}`}>
                        {formatDateShort(action.dueOn)}
                      </p>
                      <p className="text-[11px] text-foreground-500">
                        {isLate ? `${daysBetween(action.dueOn, today)}d overdue` : `open ${ageing}d`}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-label text-[11.5px] text-foreground-800">{action.priority}</span>
                      <div className="mt-1">
                        <RagBadge status={action.rag} size="sm" />
                      </div>
                    </td>
                    <td className="px-3 py-3 pr-4 sm:pr-5">
                      <span
                        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-label text-[11px] font-medium ${STATUS_STYLE[action.status]}`}
                      >
                        <i className={`${STATUS_ICON[action.status]} text-[11px]`} aria-hidden="true" />
                        {action.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

