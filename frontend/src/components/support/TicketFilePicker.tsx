import { useId, useState } from 'react';

const EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'log', 'csv', 'zip'];
const MB = 1024 * 1024;

export default function TicketFilePicker({ files, onChange, disabled = false }: {
  files: File[]; onChange: (files: File[]) => void; disabled?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState('');
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
        className="block w-full rounded-lg border border-dashed border-background-200 p-3 text-xs text-foreground-700 file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-primary-700 disabled:opacity-50"
        onChange={event => { addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
      <p id={`${id}-help`} className="text-[11px] text-foreground-400">Images (PNG, JPG, GIF, WebP), PDF, Word, Excel, PowerPoint, TXT, LOG, CSV or ZIP. Up to 5 files, 10 MB each, 25 MB total.</p>
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-red-600">{error}</p>}
      {files.length > 0 && <ul className="space-y-1">
        {files.map((file, index) => <li key={`${index}-${file.name}`} className="flex items-center gap-2 rounded-lg bg-background-100 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1 break-all text-foreground-700">{file.name} <span className="text-foreground-400">({Math.max(1, Math.ceil(file.size / 1024))} KB)</span></span>
          <button type="button" disabled={disabled} aria-label={`Remove ${file.name}`} className="rounded px-2 py-1 text-primary-600 hover:bg-primary-50 disabled:opacity-50"
            onClick={() => { onChange(files.filter((_, i) => i !== index)); setError(''); }}>Remove</button>
        </li>)}
      </ul>}
    </div>
  );
}
