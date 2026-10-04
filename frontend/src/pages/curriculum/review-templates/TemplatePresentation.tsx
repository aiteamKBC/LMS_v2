import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { getMigratedTemplate, type MigratedTemplate } from '@/api/migratedReviewTemplates';
import { definitionCounts, updatedLabel } from './templateDisplay';

export const menuItemClass = 'w-full rounded-lg px-3 py-2 text-left text-sm text-foreground-700 hover:bg-background-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 disabled:opacity-50';

export function TemplateStatistics({ template }: { template: MigratedTemplate }) {
  const [counts, setCounts] = useState<ReturnType<typeof definitionCounts> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setCounts(null); setFailed(false);
    void getMigratedTemplate(template.id).then(detail => {
      if (!cancelled) setCounts(definitionCounts(detail.definition));
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [template.id, template.updated_at]);
  return <div className="mt-4 space-y-1 text-xs text-foreground-500">
    {counts ? <p className="flex flex-wrap gap-x-4 gap-y-1" title="Includes conditional questions. Headings are not counted as questions.">
      <span><strong className="text-foreground-800">{counts.questions}</strong> {counts.questions === 1 ? 'question' : 'questions'}</span>
      <span><strong className="text-foreground-800">{counts.sections}</strong> {counts.sections === 1 ? 'section' : 'sections'}</span>
    </p> : <p>{failed ? 'Question and section counts unavailable.' : 'Loading form details…'}</p>}
    <p>Updated {updatedLabel(template) || 'date unavailable'}</p>
  </div>;
}

/** Native disclosure keeps the less common actions keyboard accessible. */
export function MoreActions({ label, disabled, children }: { label: string; disabled: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return <details ref={ref} className="relative" onKeyDown={event => {
    if (event.key === 'Escape' && ref.current?.open) {
      event.stopPropagation(); ref.current.open = false;
      ref.current.querySelector('summary')?.focus();
    }
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false;
  }}>
    <summary aria-label={label} aria-disabled={disabled} onClick={event => { if (disabled) event.preventDefault(); }}
      className={`flex cursor-pointer list-none items-center gap-1 rounded-lg border border-background-200 px-3 py-2 text-xs font-semibold text-foreground-600 hover:bg-background-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 [&::-webkit-details-marker]:hidden ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      More <AppIcon className="ri-more-2-fill" />
    </summary>
    <div className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-background-200 bg-background-50 p-1.5 shadow-lg" onClick={event => {
      if ((event.target as HTMLElement).closest('button:not(:disabled)') && ref.current) ref.current.open = false;
    }}>{children}</div>
  </details>;
}

export function TemplateMetadata({ template }: { template: MigratedTemplate }) {
  return <dl className="grid gap-3 text-sm sm:grid-cols-2">
    <div><dt className="text-foreground-500">Template name</dt><dd className="break-words">{template.name}</dd></div>
    <div><dt className="text-foreground-500">Template ID</dt><dd>#{template.id}</dd></div>
    {template.source_metadata.sourceReviewId && <div><dt className="text-foreground-500">Source review ID</dt><dd>#{template.source_metadata.sourceReviewId}</dd></div>}
    {template.source_metadata.aptemReviewId && <div><dt className="text-foreground-500">Aptem review ID</dt><dd>{template.source_metadata.aptemReviewId}</dd></div>}
    {template.source_metadata.programme && <div><dt className="text-foreground-500">Source programme</dt><dd>{template.source_metadata.programme}</dd></div>}
    {template.source_metadata.copiedFromTemplateId && <div><dt className="text-foreground-500">Copied from Standard Template</dt><dd>#{template.source_metadata.copiedFromTemplateId}</dd></div>}
    <div><dt className="text-foreground-500">Updated</dt><dd>{updatedLabel(template)}</dd></div>
    <div className="sm:col-span-2"><dt className="text-foreground-500">Definition fingerprint</dt><dd className="break-all font-mono text-xs">{template.fingerprint}</dd></div>
  </dl>;
}
