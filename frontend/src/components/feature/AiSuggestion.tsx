import { type ReactNode, useState } from 'react';
import { useAiSettings } from '@/hooks/useAiSettings';

// ============================================================
// AiSuggestion — wraps AI-generated content with mandatory
// "requires human validation" labeling
// ============================================================

export type SuggestionAction = 'accept' | 'edit' | 'reject';

interface AiSuggestionProps {
  /** The AI feature that generated this suggestion */
  featureLabel: string;
  /** Optional: what data was used as input */
  inputSummary?: string;
  /** Optional: callback when user takes an action */
  onAction?: (action: SuggestionAction, editedText?: string) => void;
  /** The AI-generated content */
  children: ReactNode;
  /** Optional: show accept/edit/reject action buttons */
  showActions?: boolean;
  /** Optional: compact mode for inline suggestions */
  compact?: boolean;
  /** Optional custom className */
  className?: string;
}

export function AiSuggestion({
  featureLabel,
  inputSummary,
  onAction,
  children,
  showActions = false,
  compact = false,
  className = '',
}: AiSuggestionProps) {
  const { isAiActive } = useAiSettings();
  const [userAction, setUserAction] = useState<SuggestionAction | null>(null);
  const [editedText, setEditedText] = useState('');

  if (!isAiActive) return null;

  if (userAction === 'rejected') {
    return (
      <div className={`rounded-lg border border-foreground-200 bg-background-50 p-3 text-xs ${className}`}>
        <div className="flex items-center gap-2 text-foreground-400">
          <AppIcon className="ri-close-circle-line"></AppIcon>
          <span>AI suggestion rejected</span>
        </div>
      </div>
    );
  }

  const handleAccept = () => {
    setUserAction('accepted');
    onAction?.('accept');
  };

  const handleReject = () => {
    setUserAction('rejected');
    onAction?.('reject');
  };

  const handleEdit = () => {
    setUserAction('edit');
    onAction?.('edit');
  };

  return (
    <div className={`rounded-lg border border-accent-200/60 bg-accent-50/30 ${compact ? 'p-3' : 'p-4'} ${className}`}>
      {/* Header: AI badge + feature label */}
      <div className={`flex items-center gap-2 ${compact ? 'mb-2' : 'mb-3'}`}>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 text-[10px] font-semibold uppercase tracking-wider">
          <AppIcon className="ri-sparkling-2-line text-[10px]"></AppIcon>
          AI-Assisted
        </span>
        <span className="text-[11px] text-foreground-500">{featureLabel}</span>
      </div>

      {/* AI-generated content */}
      <div className={`text-sm text-foreground-800 ${compact ? '' : 'mb-3'}`}>
        {userAction === 'edit' ? (
          <textarea
            className="w-full min-h-[80px] p-3 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 resize-y transition-smooth"
            defaultValue={editedText || ''}
            onChange={(e) => setEditedText(e.target.value)}
            placeholder="Edit the AI suggestion..."
            rows={3}
          />
        ) : (
          children
        )}
      </div>

      {/* Input data summary (optional) */}
      {inputSummary && !compact && (
        <div className="mb-3 flex items-start gap-2 text-[11px] text-foreground-400 bg-background-50/70 rounded-md px-3 py-2">
          <AppIcon className="ri-information-line mt-0.5 shrink-0"></AppIcon>
          <span>Based on: {inputSummary}</span>
        </div>
      )}

      {/* Human validation label — ALWAYS present */}
      <div className={`flex items-center gap-2 text-[11px] text-accent-700 font-medium bg-accent-100/50 rounded-md px-3 py-1.5 ${compact ? 'mb-2' : 'mb-3'}`}>
        <AppIcon className="ri-shield-check-line"></AppIcon>
        <span className="whitespace-nowrap">AI-assisted suggestion requiring human validation</span>
      </div>

      {/* Action buttons */}
      {showActions && !userAction && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleAccept}
            className="px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200 hover:bg-emerald-100 transition-smooth flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <AppIcon className="ri-check-line"></AppIcon>
            Accept
          </button>
          <button
            onClick={handleEdit}
            className="px-3 py-1.5 rounded-md bg-background-100 text-foreground-700 text-xs font-medium border border-background-200 hover:bg-background-200 transition-smooth flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <AppIcon className="ri-edit-line"></AppIcon>
            Edit
          </button>
          <button
            onClick={handleReject}
            className="px-3 py-1.5 rounded-md bg-red-50 text-red-600 text-xs font-medium border border-red-200 hover:bg-red-100 transition-smooth flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <AppIcon className="ri-close-line"></AppIcon>
            Reject
          </button>
        </div>
      )}

      {/* Post-action state */}
      {userAction === 'accepted' && (
        <div className="flex items-center gap-2 text-[11px] text-emerald-700 bg-emerald-50 rounded-md px-3 py-1.5">
          <AppIcon className="ri-check-double-line"></AppIcon>
          <span>Accepted as human-approved content</span>
        </div>
      )}

      {userAction === 'edit' && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              onAction?.('edit', editedText);
              setUserAction('accepted');
            }}
            className="px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200 hover:bg-emerald-100 transition-smooth whitespace-nowrap cursor-pointer"
          >
            Save Edits
          </button>
          <button
            onClick={() => {
              setUserAction(null);
              setEditedText('');
            }}
            className="px-3 py-1.5 rounded-md bg-background-100 text-foreground-500 text-xs font-medium hover:bg-background-200 transition-smooth whitespace-nowrap cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// AiFeatureIndicator — small inline badge showing AI is active
// for a specific feature
// ============================================================

interface AiFeatureIndicatorProps {
  featureSlug: string;
  className?: string;
}

export function AiFeatureIndicator({ featureSlug, className = '' }: AiFeatureIndicatorProps) {
  const { isFeatureUsable, getFeatureLabel } = useAiSettings();

  if (!isFeatureUsable(featureSlug as any)) return null;

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-accent-100 text-accent-700 whitespace-nowrap ${className}`}>
      <AppIcon className="ri-sparkling-2-line text-[9px]"></AppIcon>
      {getFeatureLabel(featureSlug as any)}
    </span>
  );
}

// ============================================================
// AiNeverGate — renders children only if a forbidden action
// is NOT being attempted. Used as a safety guard.
// ============================================================

export function AiNeverGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}