import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import type { ProgrammeFocus } from '../useCurriculumHome';
import { type ProgrammeReviewDetail, useProgrammeReview } from '../useCurriculumAttention';
import { ATTENTION_META, matchesQuery, plural, programmeSectionMeta } from './attentionMeta';
import { AttentionRecordRow } from './AttentionModal';
import { HomeModal, ModalState, SearchBox } from './HomeModal';

type Section = ProgrammeReviewDetail['sections'][number];

function ReviewSection({ section, programmeId, query, open, onToggle, onNavigate }: {
  section: Section; programmeId: string; query: string; open: boolean; onToggle: () => void; onNavigate: () => void;
}) {
  const view = programmeSectionMeta(section.key, programmeId);
  const recordMeta = section.key === 'no-modules' || section.key === 'no-delivery' ? null : ATTENTION_META[section.key];
  const listed = recordMeta ? section.records.filter(record => matchesQuery(record, query)) : [];
  const expandable = recordMeta !== null && section.records.length > 0;
  const panelId = `review-${section.key}`;
  return (
    <li className="rounded-xl border border-background-200 bg-background-50">
      <div className="flex min-w-0 items-center gap-3 px-3 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><AppIcon className={`${view.icon} text-sm`} /></span>
        {expandable ? (
          <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId} className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-primary-300">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2"><span className="text-[12px] font-bold text-foreground-900">{view.title}</span><span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">{section.count}</span></span>
              <span className="mt-0.5 block text-[11px] leading-4 text-foreground-500">{view.summary}</span>
            </span>
            <AppIcon className={`ri-arrow-down-s-line shrink-0 text-lg text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <span className="min-w-0 flex-1"><span className="block text-[12px] font-bold text-foreground-900">{view.title}</span><span className="mt-0.5 block text-[11px] leading-4 text-foreground-500">{view.summary}</span></span>
            <Link to={view.href} onClick={onNavigate} className="inline-flex h-8 shrink-0 items-center justify-center gap-1 self-start rounded-lg border border-primary-200 bg-primary-50 px-3 text-[11px] font-bold text-primary-700 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-300 sm:self-auto">{view.action}<AppIcon className="ri-arrow-right-line" /></Link>
          </div>
        )}
      </div>
      {expandable && open && recordMeta && (
        <div id={panelId} className="border-t border-background-200">
          {listed.length
            ? <ul className="divide-y divide-background-200">{listed.map((record, index) => <AttentionRecordRow key={`${record.id}-${index}`} record={record} meta={recordMeta} onNavigate={onNavigate} />)}</ul>
            : <p className="px-3 py-4 text-center text-[11px] text-foreground-400">No {recordMeta.noun}s match this search.</p>}
        </div>
      )}
    </li>
  );
}

export function ProgrammeReviewModal({ item, generation, onClose }: { item: ProgrammeFocus; generation: number; onClose: () => void }) {
  const programmeId = item.programme.id;
  const { data, loading, error, retry } = useProgrammeReview(programmeId, generation);
  const [query, setQuery] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const sections = data?.sections ?? [];
  const recordTotal = sections.reduce((sum, section) => sum + section.records.length, 0);
  // Open the first listable section until the reader chooses one.
  const expanded = openKey ?? sections.find(section => section.records.length)?.key ?? null;

  return (
    <HomeModal onClose={onClose} wide eyebrow="Programme review" title={item.programme.name || 'Unnamed programme'}
      subtitle={`${plural(item.issueCount, 'action')} to resolve · ${item.issues.join(' · ')}`}
      footer={<Link to={`/curriculum/programmes/${encodeURIComponent(programmeId)}`} onClick={onClose} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary-600 px-4 text-[12px] font-bold text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300">Open programme<AppIcon className="ri-arrow-right-line" /></Link>}>
      <ModalState loading={loading} error={error} onRetry={retry} rows={3} />
      {data && (
        <>
          {recordTotal > 5 && <div className="border-b border-background-200 px-4 py-3"><SearchBox value={query} onChange={setQuery} label="Search modules and groups" placeholder="Search modules or groups…" /></div>}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {sections.length ? (
              <ul className="space-y-2">
                {sections.map(section => (
                  <ReviewSection key={section.key} section={section} programmeId={programmeId} query={query.trim()}
                    open={expanded === section.key || Boolean(query.trim())}
                    onToggle={() => setOpenKey(expanded === section.key ? '' : section.key)} onNavigate={onClose} />
                ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-[12px] text-foreground-400">This programme has no open actions any more.</p>
            )}
          </div>
        </>
      )}
    </HomeModal>
  );
}
