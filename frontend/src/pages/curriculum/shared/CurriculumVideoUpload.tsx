import { useEffect, useRef, useState } from 'react';
import { coachFetch } from '@/lib/coachFetch';
import { assertComponentUploadAllowed, COMPONENT_UPLOAD_TIMEOUT_MS } from './componentUploadPolicy';

type ImportState = { id: string; status: string; error: string; bunnyUrl?: string };
type VideoSettingsPatch = Record<string, string | number | boolean>;
type ResponseData = { enabled?: boolean; import?: ImportState | null; error?: string; scope?: Record<string, string>; savedSettings?: VideoSettingsPatch };

export function CurriculumVideoUpload({ targetKind = 'module', targetId, componentId, title, source, onUploaded }: {
  targetKind?: 'module' | 'template'; targetId?: string; componentId: string;
  title: string; source: string; onUploaded?: (settings: VideoSettingsPatch) => void;
}) {
  const [state, setState] = useState<ImportState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(true);
  const scope = useRef<Record<string, string>>({});
  const uploadController = useRef<AbortController | null>(null);
  const editor = useRef({ source, onUploaded });
  editor.current = { source, onUploaded };
  const url = targetId ? `/curriculum_api/curriculum/videos/${targetKind}/${encodeURIComponent(targetId)}/${encodeURIComponent(componentId)}/` : '';
  const accept = (data: ResponseData) => {
    if (data.scope) scope.current = data.scope;
    setState(data.import || null);
  };
  const acceptRef = useRef(accept);
  acceptRef.current = accept;
  useEffect(() => {
    if (!url) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await coachFetch(url, { signal: controller.signal });
        const data = await response.json() as ResponseData;
        if (disposed) return;
        if (!response.ok) {
          setAvailable(data.enabled !== false);
          setError(data.error || 'Video import status could not be loaded.');
        } else {
          setAvailable(true);
          setError('');
          acceptRef.current(data);
        }
      } catch {
        if (!disposed) setError('Video import status could not be loaded.');
      }
      if (!disposed) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => { disposed = true; controller.abort(); uploadController.current?.abort(); clearTimeout(timer); };
  }, [url]);
  const upload = async (file?: File) => {
    if (!url) return;
    setBusy(true); setError('');
    const controller = new AbortController();
    uploadController.current = controller;
    const originalSource = source;
    const timer = setTimeout(() => controller.abort(), COMPONENT_UPLOAD_TIMEOUT_MS);
    try {
      if (file) assertComponentUploadAllowed(file);
      const body = new FormData();
      body.set('title', title);
      for (const key of ['programme_id', 'cohort_id', 'group_id']) if (key in scope.current) body.set(key, scope.current[key]);
      if (file) body.set('file', file);
      const response = await coachFetch(url, { method: 'POST', body, signal: controller.signal });
      const data = await response.json() as ResponseData;
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(data.error || 'The video could not be imported.');
      acceptRef.current(data);
      if (file && data.savedSettings) {
        if (editor.current.source === originalSource) editor.current.onUploaded?.(data.savedSettings);
        else setError('The MP4 was saved, but you changed the video source during upload. Your current draft was kept.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The video could not be imported.');
    } finally { clearTimeout(timer); setBusy(false); }
  };
  return <div className="mt-4 space-y-2 rounded-lg border border-background-200 p-3">
    <p className="text-sm font-semibold">Bunny video storage</p>
    <p className="text-xs text-foreground-500">Save the component first. MP4 uploads are saved for LMS playback and copied to Bunny. Saved video links, including YouTube, are also copied; the LMS keeps the original link.</p>
    <label className="block text-sm">Upload MP4 (up to 300 MB)
      <input aria-label="Upload MP4 to LMS and Bunny" type="file" accept=".mp4,video/mp4" disabled={busy || !url || !available} className="mt-1 block w-full text-xs" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
    </label>
    <button type="button" disabled={busy || !url || !available || !source} className="rounded border border-background-300 px-3 py-1.5 text-xs disabled:opacity-50" onClick={() => void upload()}>{busy ? 'Uploading…' : state?.status === 'failed' ? 'Retry saved video import' : 'Import saved video link'}</button>
    {state && <p role="status" className="text-xs">{({ queued: 'Waiting to upload', uploading: 'Uploading to Bunny', processing: 'Bunny is processing the video', ready: 'Stored on Bunny', superseded: 'Source changed; the previous copy is retained on Bunny', failed: 'Import failed' } as Record<string, string>)[state.status] || state.status}</p>}
    {(error || state?.error) && <p role="alert" className="text-xs text-red-600">{error || state?.error}</p>}
  </div>;
}
