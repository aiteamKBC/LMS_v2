import { useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchBooks, type KbBook } from './api';
import { scopeForProgramme, type KnowledgeSourcesMeta } from './sources';

export type { KnowledgeSourcesMeta } from './sources';

/**
 * Ready Knowledge Base books for the Generate Questions dialog. Books linked to
 * the chosen programme are preselected until the author changes the selection.
 */
export function KnowledgeBookPicker({ programme, selected, onChange }: {
  programme: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [books, setBooks] = useState<KbBook[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const touched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchBooks()
      .then(list => { if (!cancelled) { setBooks(list.filter(b => b.processing.status === 'ready' || b.live)); setState('ready'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, []);

  const scope = scopeForProgramme(programme);
  const ordered = useMemo(() => {
    const inScope = books.filter(b => scope && b.scopes.includes(scope));
    return [...inScope, ...books.filter(b => !inScope.includes(b))];
  }, [books, scope]);

  useEffect(() => {
    if (touched.current || !scope || state !== 'ready') return;
    onChange(books.filter(b => b.scopes.includes(scope)).map(b => b.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, state, books]);

  const toggle = (id: string) => {
    touched.current = true;
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  };

  return (
    <div className="rounded-xl border border-foreground-200/60 bg-white p-3" data-testid="knowledge-book-picker">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-[#5b2dbb]">Knowledge Base books</p>
        <a href="/curriculum/knowledge-base" target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-[#5b2dbb] hover:underline">
          <AppIcon className="ri-add-line" /> Add book
        </a>
      </div>
      {state === 'loading' ? <p className="text-xs text-foreground-400">Loading books…</p> : null}
      {state === 'error' ? <p className="text-xs text-foreground-400">Books are unavailable right now. You can still use files or pasted text.</p> : null}
      {state === 'ready' && !books.length ? <p className="text-xs text-foreground-400">No ready books yet.</p> : null}
      <div className="flex flex-col gap-1.5">
        {ordered.map(book => (
          <label key={book.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1 text-xs hover:bg-[#f7f2ff]">
            <input type="checkbox" className="mt-0.5" checked={selected.includes(book.id)} onChange={() => toggle(book.id)} aria-label={book.title} />
            <span>
              <span className="font-semibold text-foreground-800">{book.title}</span>
              <span className="ms-1 text-foreground-400">{book.scopes.join(' · ')}</span>
            </span>
          </label>
        ))}
      </div>
      {selected.length ? (
        <p className="mt-2 text-[11px] text-foreground-400">Relevant chapters are retrieved from the selected books. Add a topic to focus them; leave it empty to cover the book.</p>
      ) : null}
    </div>
  );
}

export function KnowledgeSourcesSummary({ meta }: { meta: KnowledgeSourcesMeta }) {
  const chapters = Array.from(new Set(meta.sections.map(s => `${s.book} — ${s.chapter}`)));
  return (
    <div className="rounded-xl border border-[#e3dbfb] bg-[#f7f2ff] p-3 text-xs text-foreground-700" data-testid="knowledge-sources">
      <p className="font-bold text-[#5b2dbb]">Sent to the generator from the Knowledge Base</p>
      {meta.mode === 'whole_book' && meta.chaptersTotal > meta.chaptersUsed.length ? (
        <p className="mt-1 font-semibold text-amber-800">
          This quiz covers {meta.chaptersUsed.length} of {meta.chaptersTotal} chapters: {meta.chaptersUsed.join(', ')}. Ask for more questions to cover every chapter.
        </p>
      ) : null}
      <ul className="mt-1 list-disc ps-4">
        {chapters.map(chapter => <li key={chapter}>{chapter}</li>)}
      </ul>
      <p className="mt-1 text-foreground-400">{meta.sections.length} passage(s) · {meta.tokens.toLocaleString()} tokens (limit {meta.ceiling.toLocaleString()})</p>
      {meta.warnings.includes('low_content') ? (
        <p className="mt-1 text-amber-800">The selected books have little content on this topic.</p>
      ) : null}
      {typeof meta.imagesAvailable === 'number' ? (
        <p className="mt-1 text-foreground-500">{meta.imagesAvailable} book image(s) supplied</p>
      ) : null}
      {meta.warnings.includes('book_image_unavailable') ? (
        <p className="mt-1 text-amber-800">Some book images could not be loaded and were excluded.</p>
      ) : null}
      {meta.warnings.includes('keyword_search_only') ? (
        <p className="mt-1 text-foreground-500">Passages were matched by keywords because semantic search is not available right now.</p>
      ) : null}
    </div>
  );
}
