import { useState } from 'react';
import type { EnrolmentReviewRecord, ReviewCheckItem } from '@/mocks/enrolment-review';

interface ReviewChecklistProps {
  record: EnrolmentReviewRecord;
}

export function ReviewChecklist({ record }: ReviewChecklistProps) {
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [showMissingInfo, setShowMissingInfo] = useState(true);

  return (
    <div className="space-y-5">
      {/* Checklist */}
      <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Enrolment Review Checklist</h3>
            <p className="text-[11px] text-foreground-400 mt-0.5">15 checks across personal details, employment, documents, and compliance</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setExpandedItem(expandedItem ? null : 'all')}
              className="text-[11px] text-primary-600 hover:text-primary-700 font-medium cursor-pointer whitespace-nowrap"
            >
              {expandedItem ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
        </div>

        <div className="space-y-1">
          {record.checkItems.map((item, idx) => (
            <CheckItemRow
              key={item.id}
              item={item}
              index={idx + 1}
              isExpanded={expandedItem === item.id || expandedItem === 'all'}
              onToggle={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
            />
          ))}
        </div>
      </div>

      {/* Missing Information Panel */}
      {record.missingInformation.length > 0 && (
        <div className={`rounded-xl border p-5 ${showMissingInfo ? 'bg-red-50/50 border-red-200/50' : 'bg-background-50 border-background-200/50'}`}>
          <button
            onClick={() => setShowMissingInfo(!showMissingInfo)}
            className="flex items-center justify-between w-full cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <AppIcon className="ri-error-warning-line text-red-500"></AppIcon>
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Missing Information</h3>
              <span className="text-[10px] font-medium text-red-600 bg-red-100 px-2 py-0.5 rounded-full">{record.missingInformation.length} item{record.missingInformation.length !== 1 ? 's' : ''}</span>
            </div>
            <AppIcon className={`ri-arrow-down-s-line text-foreground-400 transition-transform ${showMissingInfo ? 'rotate-180' : ''}`}></AppIcon>
          </button>

          {showMissingInfo && (
            <ul className="mt-3 space-y-1.5">
              {record.missingInformation.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2 text-[12px] text-red-700">
                  <span className="w-1 h-1 rounded-full bg-red-400 mt-1.5 shrink-0"></span>
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Internal Notes */}
      {record.internalNotes.length > 0 && (
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
          <div className="flex items-center gap-2 mb-3">
            <AppIcon className="ri-sticky-note-line text-foreground-400"></AppIcon>
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Internal Notes</h3>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{record.internalNotes.length}</span>
          </div>
          <div className="space-y-3">
            {record.internalNotes.map(note => (
              <div key={note.id} className="border border-background-200/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-foreground-800">{note.author}</span>
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${note.visibility === 'internal' ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
                      {note.visibility === 'internal' ? 'Internal' : 'Shared'}
                    </span>
                  </div>
                  <span className="text-[10px] text-foreground-400">{formatTimestamp(note.timestamp)}</span>
                </div>
                <p className="text-[12px] text-foreground-600 leading-relaxed">{note.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action History */}
      {record.actionHistory.length > 0 && (
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
          <div className="flex items-center gap-2 mb-3">
            <AppIcon className="ri-history-line text-foreground-400"></AppIcon>
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Action History</h3>
          </div>
          <div className="space-y-2">
            {record.actionHistory.map(action => (
              <div key={action.id} className="flex items-start gap-3">
                <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${getActionDotColor(action.action)}`}></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[12px] font-medium text-foreground-700">{getActionLabel(action.action)}</span>
                    <span className="text-[10px] text-foreground-400">&middot; {action.performedBy}</span>
                    <span className="text-[10px] text-foreground-400">&middot; {formatTimestamp(action.timestamp)}</span>
                  </div>
                  <p className="text-[11px] text-foreground-500 mt-0.5">{action.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CheckItemRow({ item, index, isExpanded, onToggle }: {
  item: ReviewCheckItem;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const resultConfig = getResultConfig(item.result);

  return (
    <div className={`rounded-lg border transition-smooth ${
      isExpanded ? 'border-primary-200/50 bg-primary-50/20' : 'border-transparent hover:border-background-200/50 hover:bg-background-50'
    }`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer"
      >
        <span className="text-[10px] text-foreground-400 font-mono w-5 shrink-0">{String(index).padStart(2, '0')}</span>
        <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${resultConfig.bg}`}>
          <AppIcon className={`${resultConfig.icon} ${resultConfig.iconColor} text-sm`}></AppIcon>
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-foreground-800 truncate">{item.label}</p>
          {!isExpanded && item.reviewerNote && (
            <p className="text-[11px] text-foreground-400 truncate mt-0.5">{item.reviewerNote}</p>
          )}
        </div>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${resultConfig.badgeBg} ${resultConfig.badgeText}`}>
          {resultConfig.label}
        </span>
        <AppIcon className={`ri-arrow-down-s-line text-foreground-300 transition-transform ${isExpanded ? 'rotate-180' : ''}`}></AppIcon>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 pt-0">
          <p className="text-[12px] text-foreground-500 leading-relaxed mb-2">{item.description}</p>
          {item.reviewerNote && (
            <div className="bg-background-50 rounded-lg border border-foreground-200/60 p-2.5 mb-2">
              <p className="text-[10px] text-foreground-400 uppercase tracking-wider font-medium mb-0.5">Reviewer Note</p>
              <p className="text-[12px] text-foreground-600">{item.reviewerNote}</p>
            </div>
          )}
          <div className="flex items-center gap-3 text-[10px] text-foreground-400">
            {item.reviewedAt && <span>Reviewed: {formatTimestamp(item.reviewedAt)}</span>}
            {item.reviewedBy && <span>&middot; by {item.reviewedBy}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function getResultConfig(result: ReviewCheckItem['result']): {
  icon: string;
  iconColor: string;
  bg: string;
  badgeBg: string;
  badgeText: string;
  label: string;
} {
  switch (result) {
    case 'pass':
      return { icon: 'ri-check-line', iconColor: 'text-emerald-600', bg: 'bg-emerald-50', badgeBg: 'bg-emerald-50', badgeText: 'text-emerald-600', label: 'Pass' };
    case 'fail':
      return { icon: 'ri-close-line', iconColor: 'text-red-600', bg: 'bg-red-50', badgeBg: 'bg-red-50', badgeText: 'text-red-600', label: 'Fail' };
    case 'not-reviewed':
      return { icon: 'ri-time-line', iconColor: 'text-foreground-400', bg: 'bg-background-100', badgeBg: 'bg-background-200', badgeText: 'text-foreground-500', label: 'Pending' };
    case 'not-applicable':
      return { icon: 'ri-subtract-line', iconColor: 'text-foreground-400', bg: 'bg-background-100', badgeBg: 'bg-background-200', badgeText: 'text-foreground-400', label: 'N/A' };
  }
}

function getActionDotColor(action: string): string {
  switch (action) {
    case 'approved': return 'bg-emerald-500';
    case 'returned': return 'bg-amber-500';
    case 'evidence-requested': return 'bg-primary-500';
    case 'note-added': return 'bg-foreground-400';
    case 'escalated': return 'bg-red-500';
    case 'rejected': return 'bg-red-600';
    default: return 'bg-foreground-300';
  }
}

function getActionLabel(action: string): string {
  switch (action) {
    case 'approved': return 'Approved for Eligibility';
    case 'returned': return 'Returned to Learner';
    case 'evidence-requested': return 'Evidence Requested';
    case 'note-added': return 'Internal Note Added';
    case 'escalated': return 'Escalated';
    case 'rejected': return 'Rejected at Enrolment';
    default: return action;
  }
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}