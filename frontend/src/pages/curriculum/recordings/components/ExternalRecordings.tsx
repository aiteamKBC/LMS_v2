import { useEffect, useState } from 'react';
import { learningFetch } from '@/lib/personalLearning';

interface File { id: string; startsAt: string; endsAt: string }
export default function ExternalRecordings({ reference }: { reference: string }) {
  const [files, setFiles] = useState<File[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const path = `/curriculum_api/curriculum/session-recordings/external-recordings/?${new URLSearchParams({ reference })}`;
  useEffect(() => {
    setFiles(null); setError('');
    if (!revision) return;
    const controller = new AbortController();
    setBusy(true);
    void learningFetch(path, { credentials: 'include', cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Teams recordings are unavailable. Refresh and retry.');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Teams recordings could not be checked.');
      if (!Array.isArray(data.recordings)) throw new Error('Teams returned an incomplete recording list.');
      if (!controller.signal.aborted) setFiles(data.recordings);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Teams recordings could not be checked.');
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [path, revision]);
  return <div className="mt-2 space-y-2">
    <p className="text-xs font-medium text-amber-800">Not matched to LMS. Available Teams recordings can still be downloaded.</p>
    <button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)} className="text-xs font-semibold text-primary-700 underline">
      {busy ? 'Checking recordings…' : files ? 'Refresh recordings' : 'Check recordings'}
    </button>
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    {files?.length === 0 && <p role="status" className="text-xs">No recording is available in Teams for this meeting time.</p>}
    {Boolean(files?.length) && <ul className="space-y-2">{files!.map((file, index) => <li key={file.id}>
      <a href={`${path}&${new URLSearchParams({ recording: file.id })}`} target="_blank" rel="noopener noreferrer"
        className="inline-flex rounded-md border border-primary-300 px-3 py-2 text-xs font-semibold text-primary-700">Download Teams recording {index + 1}</a>
    </li>)}</ul>}
  </div>;
}
