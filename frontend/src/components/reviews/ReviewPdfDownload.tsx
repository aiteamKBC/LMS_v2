import { useRef, useState } from 'react';
import { Download } from 'lucide-react';

export function ReviewPdfDownload({ availability, onDownload }: {
  availability?: { available: boolean; reason: string } | null;
  onDownload?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  if (!availability || !onDownload) return null;

  async function download() {
    if (!availability?.available || !onDownload || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try { await onDownload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not download the signed PDF.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <div className="space-y-2">
    <button type="button" onClick={() => { void download(); }} disabled={busy || !availability.available}
      className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-3 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
      <Download size={17}/>{busy ? 'Preparing PDF...' : 'Download signed PDF'}
    </button>
    {!availability.available && <p className="text-sm text-foreground-600">{availability.reason}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}
