import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { sanitizeCurriculumHtml } from '@/lib/curriculumHtml';
import { narrationFromPdf } from './readingNarration';
import { clearReadingHighlights, highlightReadingSelection, ReadingToolsContext, readStoredJson, type ReadingPreferences } from './readingAccessibility';
import { ReadingSurface } from './ReadingSurface';

type DocumentText = { sourceHtml: string; html: string };

export function PdfReadingText({ pdf, pageNumber, active, storageKey, preferences }: {
  pdf: PDFDocumentProxy; pageNumber: number; active: boolean; storageKey: string; preferences: ReadingPreferences;
}) {
  const tools = useContext(ReadingToolsContext);
  const register = tools?.register;
  const onDirty = tools?.onDirty;
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [documents, setDocuments] = useState<Record<number, DocumentText>>(() => readStoredJson(storageKey, {}));
  const [loaded, setLoaded] = useState<{ page: number; sourceHtml: string } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoaded(null);
    setError('');
    void pdf.getPage(pageNumber).then(page => page.getTextContent()).then(content => {
      if (cancelled) return;
      // Text is escaped before markup is constructed. PDF strings are untrusted.
      const sourceHtml = narrationFromPdf(content.items).map(block => {
        const paragraph = document.createElement('p');
        paragraph.dir = 'auto';
        paragraph.textContent = block.text;
        return paragraph.outerHTML;
      }).join('');
      setLoaded({ page: pageNumber, sourceHtml });
    }).catch(() => {
      if (!cancelled) setError('Could not extract text from this PDF page. Try again or use Original PDF.');
    });
    return () => { cancelled = true; };
  }, [pdf, pageNumber, active, retry]);

  const sourceHtml = loaded?.page === pageNumber ? loaded.sourceHtml : '';
  const saved = documents[pageNumber];
  const html = useMemo(() => sanitizeCurriculumHtml(
    saved?.sourceHtml === sourceHtml ? saved.html : sourceHtml,
  ), [saved, sourceHtml]);
  const innerHtml = useMemo(() => ({ __html: html }), [html]);

  useEffect(() => {
    register?.(id, {
      highlight: () => {
        if (!active || !highlightReadingSelection(root.current)) return false;
        const highlightedHtml = root.current!.innerHTML;
        setDocuments(current => ({ ...current, [pageNumber]: { sourceHtml, html: highlightedHtml } }));
        onDirty?.();
        return true;
      },
      clear: () => {
        const cleared = Object.fromEntries(Object.entries(documents).map(([page, doc]) => [page, { ...doc, html: doc.sourceHtml }]));
        if (root.current) clearReadingHighlights(root.current);
        setDocuments(cleared);
        onDirty?.();
      },
      save: () => window.localStorage.setItem(storageKey, JSON.stringify(documents)),
    });
  }, [register, id, active, pageNumber, sourceHtml, documents, storageKey, onDirty]);
  useEffect(() => () => register?.(id, null), [register, id]);

  if (!active) return null;
  if (error) return <div role="alert" className="p-5 text-sm text-red-700">{error}
    <button type="button" className="ml-2 underline" onClick={() => setRetry(value => value + 1)}>Retry text view</button>
  </div>;
  if (loaded?.page !== pageNumber) return <p role="status" className="p-5 text-sm">Loading page text…</p>;
  if (!sourceHtml) return <p role="status" className="p-5 text-sm">No readable text was found on this page. Scanned pages need a text version. Use Original PDF to view this page.</p>;
  return <ReadingSurface preferences={preferences} label={`PDF text, page ${pageNumber}`} className="max-h-[72vh] overflow-auto p-5">
    <div ref={root} data-reading-text data-pdf-reading-text className="curriculum-html" dangerouslySetInnerHTML={innerHtml} />
  </ReadingSurface>;
}
