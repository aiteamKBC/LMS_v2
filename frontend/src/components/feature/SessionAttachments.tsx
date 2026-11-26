import { useEffect, useRef, useState } from 'react';
import { sessionFileUrl, uploadSessionAttachment, type SessionAttachmentSettings, type SessionFile, type SessionLearner } from '@/api/sessionResults';

const extensions = '.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.gif,.webp,.odt,.odp,.ods';
export function SessionAttachments({ seriesId, sessionNumber, files, learner, preview, settings, onSaved }: {
  seriesId: string; sessionNumber: number; files: SessionFile[]; learner?: SessionLearner; preview?: boolean;
  settings?: SessionAttachmentSettings; onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const context = `${seriesId}:${sessionNumber}:${learner?.kind || ''}:${learner?.id || ''}`;
  const current = useRef(context); current.current = context;
  useEffect(() => { setBusy(false); setError(''); setNotice(''); }, [context]);
  const staff = !learner && !preview;
  const maxBytes = settings?.maxBytes || 50 * 1024 * 1024;
  const upload = async (file?: File) => {
    if (!file || busy) return;
    setError(''); setNotice('');
    if (file.size === 0 || file.size > maxBytes) { setError('Choose a non-empty file of 50 MB or smaller.'); return; }
    const before = context;
    setBusy(true);
    try {
      await uploadSessionAttachment(seriesId, sessionNumber, file);
      if (current.current !== before) return;
      setNotice('Attachment saved for this session.'); onSaved();
    } catch (reason) {
      if (current.current === before) setError(reason instanceof Error ? reason.message : 'The attachment could not be saved.');
    } finally { if (current.current === before) setBusy(false); }
  };
  if (!staff && files.length === 0) return null;
  return <section aria-label="Session attachments" className="mt-6 rounded-xl border bg-background-50 p-4">
    <h3 className="text-sm font-bold">Session attachments</h3>
    <p className="mt-1 text-sm text-foreground-500">Slides, PDFs and resources for this session.</p>
    {files.length > 0 && <ul className="mt-3 space-y-2">{files.map(file => <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-3 text-sm">
      <span className="min-w-0 break-words">{file.fileName || 'Session file'}{file.sizeBytes != null && <span className="ml-2 text-xs text-foreground-500">{(file.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>}</span>
      {file.state === 'ready' ? <a className="font-semibold text-primary-700 underline" href={sessionFileUrl(seriesId, file, learner)}>Download <span className="sr-only">{file.fileName || 'session file'}</span></a>
        : <span role="status">{file.state === 'failed' ? 'Saving needs retry' : 'Saving attachment…'}</span>}
    </li>)}</ul>}
    {staff && <div className="mt-3 space-y-2">
      {settings?.automaticImport === false && <p className="text-xs text-foreground-500">Automatic collection from Teams chat is not enabled. You can add session files here.</p>}
      <label className="block text-sm font-semibold">Add session attachment
        <input type="file" aria-label="Add session attachment" accept={extensions} disabled={busy || settings?.storageProvider === 'unavailable'}
          className="mt-2 block w-full text-sm disabled:opacity-50" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }} />
      </label>
      <p className="text-xs text-foreground-500">Up to 50 MB per file. Adding a file does not add learning hours or completion requirements.</p>
      {busy && <p role="status" className="text-sm">Saving attachment…</p>}
      {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {settings?.storageProvider === 'unavailable' && <p role="alert" className="text-sm text-red-700">Attachment storage needs configuration.</p>}
    </div>}
  </section>;
}
