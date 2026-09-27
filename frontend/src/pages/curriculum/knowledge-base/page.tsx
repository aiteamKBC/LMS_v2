import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { AppIcon } from '@/components/feature/AppIcon';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import {
  acceptBuild,
  fetchBook,
  fetchBooks,
  fetchScopes,
  fetchWorkerStatus,
  isProcessing,
  MAX_UPLOAD_BYTES,
  retryBuild,
  uploadBook,
  type KbBook,
  type KbBookDetail,
  type KbScope,
} from '@/features/knowledge-base/api';

const curriculumNav = roleNavMap.curriculum;
const POLL_MS = 5000;

const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  queued: { label: 'Queued', tone: 'bg-slate-100 text-slate-700' },
  extracting: { label: 'Extracting', tone: 'bg-sky-50 text-sky-700' },
  chunking: { label: 'Chunking', tone: 'bg-sky-50 text-sky-700' },
  embedding: { label: 'Embedding', tone: 'bg-sky-50 text-sky-700' },
  verifying: { label: 'Verifying', tone: 'bg-sky-50 text-sky-700' },
  processing: { label: 'Processing', tone: 'bg-sky-50 text-sky-700' },
  retrying: { label: 'Retrying', tone: 'bg-amber-50 text-amber-700' },
  ready: { label: 'Ready', tone: 'bg-emerald-50 text-emerald-700' },
  needs_review: { label: 'Needs review', tone: 'bg-amber-50 text-amber-800' },
  failed: { label: 'Failed', tone: 'bg-rose-50 text-rose-700' },
};

function statusCopy(status: string) {
  return STATUS_COPY[status] || { label: status || 'Processing', tone: 'bg-slate-100 text-slate-700' };
}

function progressText(book: KbBook) {
  const p = book.processing.progress || {};
  if (p.pages_total) return `${p.pages_done ?? 0}/${p.pages_total} pages`;
  if (p.chunks_embedded) return `${p.chunks_embedded} chunks embedded`;
  if (p.chunks) return `${p.chunks} chunks`;
  return '';
}

function formatSize(bytes: number | null) {
  if (!bytes) return '—';
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function StatusBadge({ book }: { book: KbBook }) {
  const copy = statusCopy(book.processing.status);
  const busy = isProcessing(book);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${copy.tone}`}>
      {busy ? <AppIcon className="ri-loader-4-line animate-spin" /> : null}
      {copy.label}
    </span>
  );
}

function UploadDialog({ scopes, onClose, onUploaded }: {
  scopes: KbScope[];
  onClose: () => void;
  onUploaded: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [edition, setEdition] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const chooseFile = (next: File | null) => {
    setError('');
    if (!next) return;
    if (!next.name.toLowerCase().endsWith('.pdf')) { setError('Only PDF books can be uploaded.'); return; }
    if (next.size > MAX_UPLOAD_BYTES) { setError('The file is larger than 200 MB.'); return; }
    setFile(next);
    if (!title) setTitle(next.name.replace(/\.pdf$/i, ''));
  };

  const submit = async () => {
    if (!file) { setError('Choose a PDF book.'); return; }
    if (!selected.length) { setError('Choose at least one programme.'); return; }
    setError('');
    setProgress(0);
    try {
      const result = await uploadBook({ file, title: title.trim(), scopes: selected, edition: edition.trim() }, setProgress);
      onUploaded(result.duplicate
        ? 'This book is already in the Knowledge Base. The selected programmes were added to it.'
        : 'Book uploaded. Processing has started and will update below.');
    } catch (err) {
      setProgress(null);
      setError(err instanceof Error ? err.message : 'The upload failed.');
    }
  };

  const uploading = progress !== null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="kb-upload-title">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="kb-upload-title" className="text-lg font-bold text-slate-900">Upload book</h2>
            <p className="text-sm text-slate-500">PDF up to 200 MB. It is stored once and processed in the background.</p>
          </div>
          <button type="button" onClick={onClose} disabled={uploading} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <AppIcon className="ri-close-line text-xl" />
          </button>
        </div>
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-700 hover:border-violet-400 hover:bg-violet-50"
          >
            <AppIcon className="ri-book-2-line text-2xl text-violet-600" />
            {file ? `${file.name} · ${formatSize(file.size)}` : 'Choose a PDF book'}
          </button>
          <input ref={inputRef} id="kb-file" type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => chooseFile(e.target.files?.[0] ?? null)} />
          <label className="block text-sm font-semibold text-slate-700" htmlFor="kb-title">Title
            <input id="kb-title" value={title} onChange={e => setTitle(e.target.value)} disabled={uploading} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal" />
          </label>
          <label className="block text-sm font-semibold text-slate-700" htmlFor="kb-edition">Edition (optional)
            <input id="kb-edition" value={edition} onChange={e => setEdition(e.target.value)} disabled={uploading} placeholder="e.g. 2nd edition" className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal" />
          </label>
          <fieldset>
            <legend className="text-sm font-semibold text-slate-700">Programmes</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {scopes.map(scope => {
                const on = selected.includes(scope.code);
                return (
                  <button key={scope.code} type="button" disabled={uploading} aria-pressed={on}
                    onClick={() => setSelected(on ? selected.filter(code => code !== scope.code) : [...selected, scope.code])}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${on ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-violet-300'}`}>
                    {scope.code} · {scope.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">A shared book (for example ME and MM) is stored once and linked to both.</p>
          </fieldset>
          {uploading ? (
            <div aria-live="polite">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-violet-600 transition-all" style={{ width: `${progress}%` }} /></div>
              <p className="mt-1 text-xs text-slate-500">Uploading… {progress}%</p>
            </div>
          ) : null}
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={uploading} className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700">Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={uploading} className="h-10 rounded-lg bg-violet-700 px-4 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-60">
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BookDetails({ bookId }: { bookId: string }) {
  const [detail, setDetail] = useState<KbBookDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    fetchBook(bookId).then(d => { if (!cancelled) setDetail(d); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the book.'); });
    return () => { cancelled = true; };
  }, [bookId]);
  if (error) return <p className="text-sm text-rose-700">{error}</p>;
  if (!detail) return <p className="text-sm text-slate-500">Loading…</p>;
  const c = detail.build.completeness as Record<string, number | Record<string, number>>;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <div className="space-y-2 text-sm">
        <h3 className="font-semibold text-slate-800">Completeness</h3>
        {c && c.pages_total ? (
          <ul className="space-y-1 text-slate-600">
            <li>Pages: {String(c.pages_total)}</li>
            <li>Text coverage: {typeof c.text_coverage === 'number' ? `${(c.text_coverage * 100).toFixed(1)}%` : '—'}</li>
            <li>Chunks: {String(c.chunks ?? '—')} · without vector: {String(c.chunks_without_vector ?? '—')}</li>
          </ul>
        ) : <p className="text-slate-500">Not verified yet.</p>}
        {detail.issues.length ? (
          <div className="rounded-lg bg-amber-50 p-3">
            <p className="font-semibold text-amber-800">{detail.issues.length} gap(s) found</p>
            <ul className="mt-1 list-disc ps-5 text-amber-900">
              {detail.issues.slice(0, 20).map(issue => (
                <li key={issue.id}>{issue.pdf_page ? `Page ${issue.pdf_page}: ` : ''}{issue.reason}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="text-sm">
        <h3 className="mb-2 font-semibold text-slate-800">Chapters and sections</h3>
        {detail.outline.length ? (
          <ol className="max-h-72 space-y-1 overflow-y-auto pe-2">
            {detail.outline.map(section => (
              <li key={section.id} className="flex items-baseline justify-between gap-3" style={{ paddingInlineStart: `${(section.level - 1) * 16}px` }}>
                <span className={section.level === 1 ? 'font-semibold text-slate-800' : 'text-slate-600'}>{section.title}</span>
                <span className="shrink-0 text-xs text-slate-400">p. {section.pdf_page_start}{section.assets ? ` · ${section.assets} figure(s)` : ''}</span>
              </li>
            ))}
          </ol>
        ) : <p className="text-slate-500">Available after processing.</p>}
      </div>
    </div>
  );
}

export default function KnowledgeBasePage() {
  const { success, error: toastError } = useToast();
  const [scopes, setScopes] = useState<KbScope[]>([]);
  const [books, setBooks] = useState<KbBook[]>([]);
  const [scopeFilter, setScopeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyBuild, setBusyBuild] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [bookList, worker] = await Promise.all([fetchBooks(scopeFilter || undefined), fetchWorkerStatus()]);
      setBooks(bookList);
      setWorkerOnline(worker.online);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the Knowledge Base.');
    } finally {
      setLoading(false);
    }
  }, [scopeFilter]);

  useEffect(() => { fetchScopes().then(setScopes).catch(() => setScopes([])); }, []);
  useEffect(() => { setLoading(true); void load(); }, [load]);

  const anyProcessing = books.some(isProcessing);
  useEffect(() => {
    if (!anyProcessing) return undefined;
    const timer = window.setInterval(() => { void load(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [anyProcessing, load]);

  const stats = useMemo(() => ({
    total: books.length,
    ready: books.filter(b => b.processing.status === 'ready').length,
    attention: books.filter(b => ['needs_review', 'failed'].includes(b.processing.status)).length,
  }), [books]);

  const act = async (buildId: string, action: 'retry' | 'accept') => {
    setBusyBuild(buildId);
    try {
      if (action === 'retry') { await retryBuild(buildId); success('Queued again', 'Processing resumes from where it stopped.'); }
      else { await acceptBuild(buildId); success('Book accepted', 'It is now available with its recorded gaps.'); }
      await load();
    } catch (err) {
      toastError('Action failed', err instanceof Error ? err.message : undefined);
    } finally {
      setBusyBuild(null);
    }
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Knowledge Base" pageSubtitle="Programme books for AI question generation" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="curriculum-library-page min-h-full bg-[#f7f6f4] p-4 sm:p-5 lg:p-6 space-y-4">
        <WorkspaceHeroBanner
          className="curriculum-library-hero"
          decorative
          eyebrow="Learning resources"
          title="Knowledge Base"
          description="Upload each programme book once. It is processed in the background and used to generate questions from the right chapters."
          icon="ri-book-2-line"
          statIconPosition="leading"
          stats={[
            { label: 'Books', value: String(stats.total), icon: 'ri-book-2-line' },
            { label: 'Ready', value: String(stats.ready), icon: 'ri-checkbox-circle-line', variant: 'success' },
            { label: 'Needs attention', value: String(stats.attention), icon: 'ri-error-warning-line', variant: stats.attention ? 'warning' : 'default' },
          ]}
          actions={(
            <button type="button" onClick={() => setUploadOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#b27715] px-4 text-sm font-semibold text-white hover:bg-[#986511]">
              <AppIcon className="ri-upload-cloud-2-line" /> Upload book
            </button>
          )}
        />

        {workerOnline === false && books.some(isProcessing) ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            <strong>Processing is paused:</strong> the background worker is not running. Books stay queued and continue automatically when it starts.
          </div>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">Programme:</span>
            {[{ code: '', name: 'All' }, ...scopes].map(scope => (
              <button key={scope.code || 'all'} type="button" aria-pressed={scopeFilter === scope.code} onClick={() => setScopeFilter(scope.code)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${scopeFilter === scope.code ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-200 text-slate-700 hover:border-violet-300'}`}>
                {scope.code || 'All'}
              </button>
            ))}
          </div>

          {loadError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{loadError}</p> : null}
          {loading && !books.length ? <p className="py-10 text-center text-sm text-slate-500">Loading books…</p> : null}
          {!loading && !books.length && !loadError ? (
            <div className="py-12 text-center">
              <AppIcon className="ri-book-2-line text-3xl text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-700">No books yet</p>
              <p className="text-sm text-slate-500">Upload a programme book to start building the Knowledge Base.</p>
            </div>
          ) : null}

          {books.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-100">
                    <th className="py-2 pe-3 font-semibold">Book</th>
                    <th className="py-2 pe-3 font-semibold">Programmes</th>
                    <th className="py-2 pe-3 font-semibold">Pages</th>
                    <th className="py-2 pe-3 font-semibold">Status</th>
                    <th className="py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {books.map(book => {
                    const buildId = book.build.id;
                    const status = book.processing.status;
                    const open = expanded === book.id;
                    return (
                      <Fragment key={book.id}>
                        <tr className="border-b border-slate-100 align-top">
                          <td className="py-3 pe-3">
                            <p className="font-semibold text-slate-900">{book.title}</p>
                            <p className="text-xs text-slate-500">{book.version.fileName} · {formatSize(book.version.sizeBytes)}{book.version.edition ? ` · ${book.version.edition}` : ''}</p>
                          </td>
                          <td className="py-3 pe-3">
                            <div className="flex flex-wrap gap-1">{book.scopes.map(code => <span key={code} className="rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">{code}</span>)}</div>
                          </td>
                          <td className="py-3 pe-3 tabular-nums text-slate-700">{book.version.pageCount ?? '—'}</td>
                          <td className="py-3 pe-3">
                            <StatusBadge book={book} />
                            {progressText(book) && isProcessing(book) ? <p className="mt-1 text-xs text-slate-500">{progressText(book)}</p> : null}
                            {status === 'retrying' && book.processing.lastError ? <p className="mt-1 max-w-xs text-xs text-amber-700">Will retry automatically.</p> : null}
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex flex-wrap justify-end gap-1.5">
                              {buildId && ['needs_review', 'failed', 'retrying'].includes(status) ? (
                                <button type="button" disabled={busyBuild === buildId} onClick={() => void act(buildId, 'retry')} className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">Retry</button>
                              ) : null}
                              {buildId && status === 'needs_review' ? (
                                <button type="button" disabled={busyBuild === buildId} onClick={() => void act(buildId, 'accept')} className="h-8 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100">Accept with gaps</button>
                              ) : null}
                              <button type="button" aria-expanded={open} onClick={() => setExpanded(open ? null : book.id)} className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-violet-700 hover:bg-violet-50">
                                {open ? 'Hide' : 'Details'}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {open ? (
                          <tr className="border-b border-slate-100 bg-slate-50/60">
                            <td colSpan={5} className="p-4"><BookDetails bookId={book.id} /></td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>

      {uploadOpen ? (
        <UploadDialog
          scopes={scopes}
          onClose={() => setUploadOpen(false)}
          onUploaded={message => { setUploadOpen(false); success('Knowledge Base', message); void load(); }}
        />
      ) : null}
    </WorkspaceShell>
  );
}

