import { useState } from 'react';
import { resolveRecordingUrl } from '@/api/sessionResults';

interface Props {
  seriesId: string;
  artifactId: string;
  className?: string;
}

/** Sign a single saved recording on demand; never navigate to an API JSON error. */
export default function RecordingDownloadButton({ seriesId, artifactId, className }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const download = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const url = await resolveRecordingUrl(seriesId, artifactId, true);
      const link = document.createElement('a');
      link.href = url;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The recording could not be downloaded.');
    } finally {
      setBusy(false);
    }
  };

  return <span className="inline-flex flex-col items-start gap-1">
    <button type="button" disabled={busy} onClick={() => void download()} className={className}>
      <i className="ri-download-2-line" aria-hidden="true" />
      {busy ? 'Preparing download…' : 'Download'}
    </button>
    {error && <span role="alert" className="text-xs text-rose-700">{error}</span>}
  </span>;
}
