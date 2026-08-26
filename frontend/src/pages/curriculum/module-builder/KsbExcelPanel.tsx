import { useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';

// The KSB-via-Excel round trip, tucked into the KSB side panel: export every
// component to a sheet, copy the ChatGPT prompt (pinned to the KSB profile) that
// fills it, then import the returned file back onto the components. Shared by the
// Module Builder and Week Builder so the flow reads identically in both.
export function KsbExcelPanel({ prompt, profileCount, onExport, onImport }: {
  prompt: string;
  profileCount: number;
  onExport: () => void;
  onImport: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard is blocked (insecure context / permissions) — open the prompt
      // so it can be selected and copied by hand instead of failing silently.
      setShowPrompt(true);
    }
  };

  return (
    <div className="rounded-xl border border-primary-100 bg-primary-50/40 p-3">
      <div className="flex items-center gap-1.5">
        <AppIcon className="ri-sparkling-2-line text-[13px] text-primary-600"></AppIcon>
        <p className="text-[10px] font-bold uppercase tracking-wide text-primary-700">Map KSBs with ChatGPT</p>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-foreground-500">
        Export the components, fill the KSBs in ChatGPT with the prompt below, then import the file back.
      </p>
      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        <button onClick={onExport} className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-background-200 bg-background-50 px-2 text-[10px] font-bold text-foreground-700 transition-smooth hover:bg-background-100">
          <AppIcon className="ri-file-excel-2-line text-[12px]"></AppIcon>Export
        </button>
        <button onClick={onImport} className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-background-200 bg-background-50 px-2 text-[10px] font-bold text-foreground-700 transition-smooth hover:bg-background-100">
          <AppIcon className="ri-file-upload-line text-[12px]"></AppIcon>Import
        </button>
      </div>
      <button onClick={() => void copyPrompt()} className={`mt-1.5 inline-flex h-8 w-full items-center justify-center gap-1 rounded-md px-2 text-[10px] font-bold text-white transition-smooth ${copied ? 'bg-emerald-500' : 'bg-primary-500 hover:bg-primary-600'}`}>
        <AppIcon className={copied ? 'ri-check-line text-[12px]' : 'ri-clipboard-line text-[12px]'}></AppIcon>
        {copied ? 'Prompt copied' : 'Copy ChatGPT prompt'}
      </button>
      {profileCount === 0 && (
        <p className="mt-1.5 flex items-start gap-1 text-[9px] font-semibold leading-3 text-amber-600">
          <AppIcon className="ri-error-warning-line text-[11px]"></AppIcon>
          No KSB source is set, so the prompt lists no profile. Attach a KSB source for a stricter mapping.
        </p>
      )}
      <button onClick={() => setShowPrompt(value => !value)} className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-foreground-500 transition-smooth hover:text-foreground-800">
        <AppIcon className={showPrompt ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}></AppIcon>
        {showPrompt ? 'Hide prompt' : 'Preview prompt'}
      </button>
      {showPrompt && (
        <pre className="mt-1.5 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-background-200 bg-background-50 p-2 text-[9px] leading-3 text-foreground-600">{prompt}</pre>
      )}
    </div>
  );
}
