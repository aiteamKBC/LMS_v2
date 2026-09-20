import { useCallback, useEffect, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { COMPONENT_UPLOAD_MAX_LABEL } from '@/pages/curriculum/shared/componentUploadPolicy';
import {
  AI_MATERIAL_ACCEPT,
  loadAiMaterial,
  removeAiMaterial,
  uploadAiMaterial,
  type AiMaterialRecord,
} from './moduleAuthoringData';
import { aiMaterialPreviewUrl, formatMaterialSize } from './aiMaterialPreview';

/**
 * The module's AI Material book: upload one, replace it, or read it here.
 *
 * The bytes live in the curriculum Azure container like every other authoring
 * upload, and the preview embeds the same `/curriculum_api/curriculum/uploads/...`
 * route, which streams byte ranges so the PDF viewer can page through a book
 * rather than pull the whole file first.
 */
export function AiMaterialModal({ moduleCatalogueId, moduleTitle, onClose }: {
  moduleCatalogueId: string;
  moduleTitle: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [material, setMaterial] = useState<AiMaterialRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'' | 'upload' | 'remove'>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadAiMaterial(moduleCatalogueId, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setMaterial(result.material); setError(''); } })
      .catch(reason => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'The AI material could not be loaded.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [moduleCatalogueId]);

  const choose = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setBusy('upload');
    setError('');
    setNotice('');
    try {
      const result = await uploadAiMaterial(moduleCatalogueId, file);
      setMaterial(result.material);
      // The viewer holds the previous file's URL. Every upload gets its own
      // timestamped path, so dropping the frame is what makes the new book
      // appear rather than the cached old one.
      setPreviewing(false);
      setNotice(result.replaced ? `Replaced with ${result.material?.fileName || file.name}.` : `Uploaded ${result.material?.fileName || file.name}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The book could not be uploaded.');
    } finally {
      setBusy('');
      if (fileInput.current) fileInput.current.value = '';
    }
  }, [moduleCatalogueId]);

  const remove = useCallback(async () => {
    setBusy('remove');
    setError('');
    setNotice('');
    try {
      const result = await removeAiMaterial(moduleCatalogueId);
      setMaterial(result.material);
      setPreviewing(false);
      setNotice('The book was removed.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The book could not be removed.');
    } finally {
      setBusy('');
    }
  }, [moduleCatalogueId]);

  const previewUrl = aiMaterialPreviewUrl(material);
  const uploading = busy === 'upload';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="AI Material"
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
        onKeyDown={event => { if (event.key === 'Escape') onClose(); }}
        className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b bg-white p-5">
          <div>
            <p className="text-xs font-bold uppercase text-primary-600">AI Material</p>
            <h2 className="mt-1 text-lg font-bold">{moduleTitle}</h2>
            <p className="mt-1 text-xs text-foreground-500">
              One book per module, stored with the module&apos;s other uploads. Up to {COMPONENT_UPLOAD_MAX_LABEL}.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close AI Material" className="rounded-lg border px-3 py-2 text-sm font-semibold">Close</button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
          {error && <p role="alert" className="rounded-xl border border-danger-200 bg-danger-50 p-4 text-sm font-semibold text-danger-700">{error}</p>}
          {notice && !error && <p role="status" className="rounded-xl border border-success-200 bg-success-50 p-4 text-sm font-semibold text-success-700">{notice}</p>}

          <input
            ref={fileInput}
            type="file"
            accept={AI_MATERIAL_ACCEPT}
            className="sr-only"
            onChange={event => { void choose(event.target.files?.[0]); }}
          />

          {loading ? (
            <p role="status" className="rounded-xl border bg-white p-6 text-sm">Loading the AI material…</p>
          ) : !material ? (
            <div className="rounded-xl border border-dashed bg-white p-8 text-center">
              <AppIcon name="ri-book-2-line" size={28} className="text-primary-600" />
              <h3 className="mt-3 font-bold">No book uploaded yet</h3>
              <p className="mt-1 text-sm text-foreground-500">
                Upload a PDF, EPUB or Word document. PDFs and Word documents can be read here; other formats download.
              </p>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                aria-busy={uploading}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:bg-primary-400"
              >
                <AppIcon name={uploading ? 'ri-loader-4-line' : 'ri-upload-2-line'} size={16} className={uploading ? 'animate-spin' : ''} />
                {uploading ? 'Uploading…' : 'Upload book'}
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold" title={material.fileName}>{material.fileName}</p>
                  <p className="mt-1 text-xs text-foreground-500">
                    {formatMaterialSize(material.size)}
                    {material.uploadedAt ? ` · uploaded ${material.uploadedAt.replace('T', ' ').replace('Z', ' UTC')}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {previewUrl ? (
                    <button
                      type="button"
                      onClick={() => setPreviewing(current => !current)}
                      className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-white px-3 py-2 text-sm font-semibold text-primary-700"
                    >
                      <AppIcon name="ri-eye-line" size={16} />
                      {previewing ? 'Hide preview' : 'Preview book'}
                    </button>
                  ) : (
                    <a
                      href={material.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-white px-3 py-2 text-sm font-semibold text-primary-700"
                    >
                      <AppIcon name="ri-download-2-line" size={16} />
                      Download book
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    disabled={!!busy}
                    aria-busy={uploading}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:bg-primary-400"
                  >
                    <AppIcon name={uploading ? 'ri-loader-4-line' : 'ri-refresh-line'} size={16} className={uploading ? 'animate-spin' : ''} />
                    {uploading ? 'Uploading…' : 'Replace book'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { void remove(); }}
                    disabled={!!busy}
                    className="inline-flex items-center gap-2 rounded-lg border border-danger-200 bg-white px-3 py-2 text-sm font-semibold text-danger-700 disabled:cursor-wait"
                  >
                    <AppIcon name="ri-delete-bin-line" size={16} />
                    {busy === 'remove' ? 'Removing…' : 'Remove book'}
                  </button>
                </div>
              </div>

              {!previewUrl && (
                <p className="rounded-xl border bg-white p-4 text-sm text-foreground-500">
                  This format has no in-browser reader. Download it to read the book.
                </p>
              )}
              {previewing && previewUrl && (
                <iframe
                  key={material.storedPath}
                  title={`${material.fileName} preview`}
                  src={previewUrl}
                  className="min-h-[55vh] w-full flex-1 rounded-xl border bg-white"
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
