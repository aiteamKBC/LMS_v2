import { useId, useState } from 'react';

const EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'log', 'csv', 'zip'];
const MB = 1024 * 1024;

export default function TicketFilePicker({ files, onChange, disabled = false }: {
  files: File[]; onChange: (files: File[]) => void; disabled?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState('');
  const openFile = (file: File) => {
    const url = URL.createObjectURL(file);
    const preview = window.open(url, '_blank', 'noopener,noreferrer');
    if (!preview) {
      URL.revokeObjectURL(url);
      return;
    }
    // Keep the object URL alive long enough for the new tab to load it.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const addFiles = (added: File[]) => {
    const next = [...files, ...added];
    const message = next.length > 5 ? 'Attach up to 5 files.'
      : added.some(file => !EXTENSIONS.includes(file.name.split('.').pop()?.toLowerCase() || '')) ? 'Choose one of the supported file types below.'
      : added.some(file => !file.size || file.size > 10 * MB) ? 'Each file must be non-empty and no larger than 10 MB.'
      : added.some(file => file.name.length > 200) ? 'File names must be at most 200 characters.'
      : next.reduce((total, file) => total + file.size, 0) > 25 * MB ? 'Attachments must total no more than 25 MB.' : '';
    setError(message);
    if (!message) onChange(next);
  };
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-medium text-foreground-500">Attachments (optional)</label>
      <input id={id} type="file" multiple disabled={disabled} accept={EXTENSIONS.map(ext => `.${ext}`).join(',')}
        aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`} aria-invalid={!!error}
        className="sr-only"
        onChange={event => { addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
      <div className="flex min-h-12 items-center gap-3 rounded-lg border border-dashed border-background-200 px-3 py-2">
        <label htmlFor={id} className={`shrink-0 rounded-md bg-primary-50 px-3 py-2 text-xs text-primary-700 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-primary-100'}`}>
          Choose files
        </label>
        <span aria-live="polite" className="min-w-0 truncate text-xs text-foreground-600">
          {files.length === 0 ? 'No file chosen' : files.length === 1 ? files[0].name : `${files.length} files attached`}
        </span>
      </div>
      <p id={`${id}-help`} className="text-[11px] text-foreground-400">Images (PNG, JPG, GIF, WebP), PDF, Word, Excel, PowerPoint, TXT, LOG, CSV or ZIP. Up to 5 files, 10 MB each, 25 MB total.</p>
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-red-600">{error}</p>}
      {files.length > 0 && <ul className="space-y-1">
        {files.map((file, index) => <li key={`${index}-${file.name}`} className="flex items-center gap-2 rounded-lg bg-background-100 px-3 py-2 text-xs">
          <button type="button" disabled={disabled} className="min-w-0 flex-1 break-all text-left text-primary-700 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-foreground-700"
            onClick={() => openFile(file)} title={`Open ${file.name}`}>
            {file.name} <span className="text-foreground-400 no-underline">({Math.max(1, Math.ceil(file.size / 1024))} KB)</span>
          </button>
          <button type="button" disabled={disabled} aria-label={`Remove ${file.name}`} className="rounded px-2 py-1 text-primary-600 hover:bg-primary-50 disabled:opacity-50"
            onClick={() => { onChange(files.filter((_, i) => i !== index)); setError(''); }}>Remove</button>
        </li>)}
      </ul>}
    </div>
  );
}
