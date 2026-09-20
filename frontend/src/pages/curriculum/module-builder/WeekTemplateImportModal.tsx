import { useEffect, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchWeekTemplates, fetchWeekTemplateDetail, filterWeekTemplatesForScope, type WeekTemplate } from '../week-builder/weekTemplateData';

export function WeekTemplateImportModal({ scope, onClose, onImport }: {
  scope: { programmeId: string; programmeName: string };
  onClose: () => void;
  onImport: (template: WeekTemplate, count: number) => void | Promise<void>;
}) {
  const [templates, setTemplates] = useState<WeekTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importingId, setImportingId] = useState<string | null>(null);
  const [weekCount, setWeekCount] = useState('1');
  const [search, setSearch] = useState('');
  const importing = useRef(false);
  const active = useRef(true);
  const count = Number(weekCount);
  const validCount = Number.isSafeInteger(count) && count >= 1;

  useEffect(() => {
    let current = true;
    active.current = true;
    fetchWeekTemplates({})
      .then(rows => { if (current) { setTemplates(rows); setLoading(false); } })
      .catch(err => { if (current) { setError(err instanceof Error ? err.message : 'Unable to load week templates.'); setLoading(false); } });
    return () => { current = false; active.current = false; };
  }, []);

  const list = filterWeekTemplatesForScope(templates, scope);
  const searchTerm = search.trim().toLocaleLowerCase();
  const filteredTemplates = searchTerm
    ? list.filter(template => [
      template.title,
      template.componentCount || template.components.length,
    ].some(value => String(value || '').toLocaleLowerCase().includes(searchTerm)))
    : list;
  const pick = async (template: WeekTemplate) => {
    if (importing.current || !validCount) return;
    importing.current = true;
    setImportingId(template.id);
    setError('');
    try {
      const detail = await fetchWeekTemplateDetail(template.id);
      if (active.current) await onImport(detail, count);
    } catch (err) {
      if (active.current) setError(err instanceof Error ? err.message : 'Unable to add weeks from that template.');
    } finally {
      importing.current = false;
      if (active.current) setImportingId(null);
    }
  };
  const close = () => { if (!importing.current) onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground-950/50 backdrop-blur-sm" onClick={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="week-template-import-title" className="w-full max-w-lg overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 border-b border-background-200 px-5 py-4">
          <div>
            <h3 id="week-template-import-title" className="font-heading text-[15px] font-bold text-foreground-950">Add weeks from a template</h3>
            <p className="mt-0.5 text-[11px] text-foreground-500">Choose how many weeks to add, then select a template.</p>
          </div>
          <button type="button" onClick={close} disabled={Boolean(importingId)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg bg-background-100 text-foreground-500 hover:bg-background-200 disabled:opacity-50"><AppIcon className="ri-close-line text-lg"/></button>
        </div>
        <div className="border-b border-background-200 px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="template-week-count" className="text-[12px] font-semibold text-foreground-900">Number of weeks</label>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Decrease number of weeks" disabled={Boolean(importingId) || !validCount || count <= 1} onClick={() => setWeekCount(String(count - 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-background-300 text-primary-700 hover:bg-primary-50 disabled:opacity-40"><AppIcon className="ri-subtract-line"/></button>
              <input id="template-week-count" type="number" min={1} step={1} value={weekCount} disabled={Boolean(importingId)} onChange={event => setWeekCount(event.target.value)} aria-invalid={!validCount} aria-describedby="template-week-count-help" className="h-9 w-20 rounded-lg border border-background-300 bg-background-50 px-2 text-center text-sm font-bold text-foreground-900 focus:border-primary-400 focus:outline-none"/>
              <button type="button" aria-label="Increase number of weeks" disabled={Boolean(importingId) || !validCount || !Number.isSafeInteger(count + 1)} onClick={() => setWeekCount(String(count + 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-background-300 text-primary-700 hover:bg-primary-50 disabled:opacity-40"><AppIcon className="ri-add-line"/></button>
            </div>
          </div>
          <p id="template-week-count-help" className={`mt-2 text-[11px] ${validCount ? 'text-foreground-500' : 'text-red-700'}`}>
            {validCount ? `${count} new week${count === 1 ? '' : 's'} will be added with the selected template's components.` : 'Enter a whole number of weeks, starting from 1.'}
          </p>
        </div>
        <div className="border-b border-background-200 px-5 py-3">
          <label htmlFor="week-template-search" className="sr-only">Search week templates</label>
          <div className="relative">
            <AppIcon className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400"/>
            <input
              id="week-template-search"
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              disabled={loading || Boolean(importingId)}
              placeholder="Search by week number, title or components..."
              className="h-9 w-full rounded-lg border border-background-300 bg-background-50 py-2 pl-9 pr-3 text-[12px] text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none disabled:opacity-60"
            />
          </div>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-4">
          {loading ? <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-foreground-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-background-300 border-t-primary-500"/>Loading templates...</div>
            : filteredTemplates.length ? <div className="space-y-2">{filteredTemplates.map(template => (
              <button key={template.id} type="button" disabled={Boolean(importingId) || !validCount} onClick={() => void pick(template)} className="flex w-full items-center gap-3 rounded-xl border border-background-200 bg-background-50 p-3 text-left transition-smooth hover:border-primary-300 hover:bg-primary-50 disabled:opacity-60">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-500 text-white"><AppIcon className="ri-calendar-todo-line"/></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-foreground-900">{template.title || 'Untitled week'}</span>
                  <span className="block text-[11px] text-foreground-500">{template.componentCount || template.components.length} components{template.programmeName ? ` · ${template.programmeName}` : ''}</span>
                </span>
                {importingId === template.id ? <AppIcon className="ri-loader-4-line animate-spin text-foreground-400"/> : <span className="text-[12px] font-bold text-primary-600">+{validCount ? count : ''}</span>}
              </button>
            ))}</div> : <p className="py-10 text-center text-[12px] text-foreground-400">{searchTerm ? 'No week templates match that search.' : 'No week templates found. Create one in the Week Builder first.'}</p>}
          {error && <p role="alert" className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}
