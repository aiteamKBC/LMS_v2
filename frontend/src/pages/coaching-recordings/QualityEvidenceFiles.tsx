import { Download, Paperclip, X } from 'lucide-react';
import { qualityEvidenceFileUrl, type QualityEvidenceFile } from '@/api/coachingQualityReviews';

export default function QualityEvidenceFiles({ section = 'evidence', reviewId, files, ids, busy, onUpload, onRemove }: {
  section?: string; reviewId?: string; files: QualityEvidenceFile[]; ids: string[]; busy: boolean;
  onUpload: (file: File, section: string) => Promise<boolean>; onRemove: (id: string, section: string) => void;
}) {
  return <section aria-label={section === 'evidence' ? 'Evidence files' : `Files for ${section}`} className="space-y-3 rounded-xl border border-dashed border-primary-200 bg-primary-50/40 p-4">
    <h3 className="text-sm font-bold">Supporting evidence</h3><p className="text-xs leading-5 text-foreground-600">Images, PDF, Office, audio, video and other files · up to 25 MB each.</p>
    <details className="text-xs leading-5 text-foreground-600"><summary className="cursor-pointer font-semibold text-primary-700">File limits and PDF appearance</summary><p className="mt-2">Up to 30 files / 100 MB per review. Original files stay available for download. Images appear in the PDF; other files are listed as attachments.</p></details>
    <label className={`inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-white px-3 py-2 text-xs font-semibold text-primary-700 ${busy ? 'opacity-50' : 'cursor-pointer'}`}><Paperclip size={15} />{busy ? 'Saving evidence…' : 'Attach evidence files'}<input aria-label={`Attach evidence files: ${section}`} type="file" multiple className="sr-only" disabled={busy} onChange={event => { const chosen = Array.from(event.target.files ?? []); event.target.value = ''; void (async () => { for (const file of chosen) if (!await onUpload(file, section)) break; })(); }} /></label>
    <ul className="grid gap-3 sm:grid-cols-2">{ids.map(id => {
      const file = files.find(row => row.id === id);
      return <li key={id} className="min-w-0 rounded-lg border border-background-200 bg-white p-3">
        {reviewId && file?.hasPreview && <img loading="lazy" src={qualityEvidenceFileUrl(reviewId, id, true)} alt={file.filename} className="mb-3 h-32 w-full rounded object-contain" />}
        <p className="break-words text-xs font-semibold">{file?.filename || 'Saved evidence file'}</p>{file && <p className="mt-1 text-[11px] text-foreground-500">{(file.size / 1024).toFixed(1)} KB</p>}
        <div className="mt-3 flex flex-wrap gap-3">{reviewId && <a href={qualityEvidenceFileUrl(reviewId, id)} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700"><Download size={12} />Download original</a>}<button type="button" disabled={busy} onClick={() => onRemove(id, section)} className="inline-flex items-center gap-1 text-xs text-rose-700"><X size={12} />Remove from this version</button></div>
      </li>;
    })}</ul>
  </section>;
}
