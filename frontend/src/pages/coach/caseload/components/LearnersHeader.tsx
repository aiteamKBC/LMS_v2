// ============================================================================
// Coach caseload — header meta and actions.
//
// These slot into the shared PageHeader (`meta` / `actions`) rather than
// rendering a header shell of their own. The caseload shape is still stated as
// one line of counts (`LearnersHeaderMeta`) rather than a row of KPI cards: it
// reads faster, and it leaves the vertical space for the learners, which is
// what the page is for. `LearnersHeaderActions` is the export menu, the
// selection-mode controls and the card/table toggle — real interactive state
// (the export menu's open/close and outside-click handling), so it stays a
// component rather than being inlined into the page.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import type { CaseloadCounts } from '../lib/attention';
import type { ViewMode } from '../types';

function CountPart({ value, label, dot }: { value: number; label: string; dot: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`}></span>
      <span className="font-semibold text-foreground-800 tabular-nums">{value}</span>
      <span className="text-foreground-500">{label}</span>
    </span>
  );
}

export function LearnersHeaderMeta({ counts }: { counts: CaseloadCounts }) {
  return (
    <>
      <span className="font-semibold text-foreground-900 tabular-nums">{counts.total} learners</span>
      <span className="text-foreground-300">·</span>
      <CountPart value={counts.onTrack} label="On Track" dot="bg-emerald-500" />
      <CountPart value={counts.attention} label="Need Attention" dot="bg-amber-500" />
      <CountPart value={counts.critical} label="At Risk" dot="bg-red-500" />
      {counts.onBreak > 0 ? <CountPart value={counts.onBreak} label="On Break" dot="bg-foreground-300" /> : null}
    </>
  );
}

export function LearnersHeaderActions({
  viewMode,
  onViewModeChange,
  selectionMode,
  selectedCount,
  isExporting,
  exportDisabled,
  onExportCurrentView,
  onStartSelection,
  onExportSelected,
  onCancelSelection,
}: {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  selectionMode: boolean;
  selectedCount: number;
  isExporting: boolean;
  exportDisabled: boolean;
  onExportCurrentView: () => void;
  onStartSelection: () => void;
  onExportSelected: () => void;
  onCancelSelection: () => void;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!exportRef.current?.contains(event.target as Node)) setExportOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExportOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [exportOpen]);

  return (
    <>
      {selectionMode ? (
        <>
          <button
            type="button"
            onClick={onExportSelected}
            disabled={selectedCount === 0 || isExporting}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary-600 px-3 text-[12px] font-semibold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon className={isExporting ? 'ri-loader-4-line animate-spin' : 'ri-download-2-line'}></AppIcon>
            {selectedCount > 0 ? `Export ${selectedCount} selected` : 'Select learners'}
          </button>
          <button
            type="button"
            onClick={onCancelSelection}
            disabled={isExporting}
            className="inline-flex h-9 items-center rounded-md bg-white px-3 text-[12px] font-semibold text-foreground-600 transition hover:bg-background-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 disabled:opacity-50"
          >
            Cancel
          </button>
        </>
      ) : (
        <div ref={exportRef} className="relative">
          <button
            type="button"
            onClick={() => setExportOpen((current) => !current)}
            disabled={isExporting}
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            className="relative inline-flex h-9 min-w-[104px] items-center justify-center rounded-md bg-white px-9 text-[12px] font-semibold text-foreground-700 transition hover:bg-background-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 disabled:opacity-50"
          >
            <AppIcon className={`${isExporting ? 'ri-loader-4-line animate-spin' : 'ri-download-2-line'} absolute left-3`}></AppIcon>
            <span>Export</span>
            <AppIcon className={`ri-arrow-down-s-line absolute right-3 text-[14px] text-foreground-400 transition-transform ${exportOpen ? 'rotate-180' : ''}`}></AppIcon>
          </button>

          {exportOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+4px)] z-50 w-60 rounded-md border border-foreground-200 bg-white p-1 shadow-panel"
            >
              <button
                type="button"
                role="menuitem"
                disabled={exportDisabled}
                onClick={() => {
                  setExportOpen(false);
                  onExportCurrentView();
                }}
                className="flex w-full items-start gap-2 rounded px-2.5 py-2 text-left transition hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon className="ri-file-pdf-2-line mt-0.5 text-[14px] text-primary-600"></AppIcon>
                <span>
                  <span className="block text-[12px] font-semibold text-foreground-900">Current view as PDF</span>
                  <span className="block text-[12px] text-foreground-400">Everything matching your filters</span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={exportDisabled}
                onClick={() => {
                  setExportOpen(false);
                  onStartSelection();
                }}
                className="flex w-full items-start gap-2 rounded px-2.5 py-2 text-left transition hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon className="ri-checkbox-multiple-line mt-0.5 text-[14px] text-primary-600"></AppIcon>
                <span>
                  <span className="block text-[12px] font-semibold text-foreground-900">Choose learners…</span>
                  <span className="block text-[12px] text-foreground-400">Pick specific learners to export</span>
                </span>
              </button>
            </div>
          ) : null}
        </div>
      )}

      <div className="inline-flex h-9 items-center rounded-md bg-white p-0.5">
        {(['cards', 'table'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onViewModeChange(mode)}
            aria-pressed={viewMode === mode}
            title={mode === 'cards' ? 'Card view' : 'Table view'}
              className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-[12px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 ${
                viewMode === mode
                  ? 'bg-primary-600 !text-white'
                  : 'text-foreground-950 hover:text-foreground-950'
              }`}
          >
            <AppIcon className={mode === 'cards' ? 'ri-layout-grid-line' : 'ri-table-line'}></AppIcon>
            <span className="hidden sm:inline">{mode === 'cards' ? 'Cards' : 'Table'}</span>
          </button>
        ))}
      </div>
    </>
  );
}
