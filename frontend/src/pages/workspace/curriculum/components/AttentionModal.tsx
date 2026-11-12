import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import type { AttentionKey } from '../useCurriculumHome';
import { type AttentionRecord, useAttentionRecords } from '../useCurriculumAttention';
import { ATTENTION_META, type AttentionMeta, matchesQuery, plural, recordContext, recordLabel } from './attentionMeta';
import { HomeModal, ModalState, SearchBox } from './HomeModal';

export function AttentionRecordRow({ record, meta, onNavigate }: { record: AttentionRecord; meta: AttentionMeta; onNavigate: () => void }) {
  const context = recordContext(record);
  return (
    <li className="flex min-w-0 flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <p className="break-words text-[12px] font-bold text-foreground-900">{recordLabel(record, meta.noun)}</p>
        {context.length > 0 && <p className="mt-0.5 break-words text-[11px] text-foreground-500">{context.join(' · ')}</p>}
        <p className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700"><AppIcon className="ri-error-warning-line" />{meta.requirement}</p>
      </div>
      {meta.edit && (
        <Link to={meta.edit.href(record)} onClick={onNavigate} className="inline-flex h-8 shrink-0 items-center justify-center gap-1 self-start rounded-lg border border-primary-200 bg-primary-50 px-3 text-[11px] font-bold text-primary-700 transition-colors hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-300 sm:self-auto">
          {meta.edit.label}<AppIcon className="ri-arrow-right-line" />
        </Link>
      )}
    </li>
  );
}

export function AttentionModal({ issue, count, generation, onClose }: { issue: AttentionKey; count: number; generation: number; onClose: () => void }) {
  const meta = ATTENTION_META[issue];
  const { data, loading, error, retry } = useAttentionRecords(issue, generation);
  const [query, setQuery] = useState('');
  const [programme, setProgramme] = useState('');
  const records = useMemo(() => data?.records ?? [], [data]);
  const programmes = useMemo(() => Array.from(new Set(records.map(record => record.programme).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [records]);
  const filtered = records.filter(record => (!programme || record.programme === programme) && matchesQuery(record, query.trim()));
  const total = data ? data.count : count;

  return (
    <HomeModal onClose={onClose} wide eyebrow="Needs attention" title={meta.title} subtitle={`${plural(total, meta.noun)} · ${meta.detail}`}
      footer={<Link to={meta.href} onClick={onClose} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary-600 px-4 text-[12px] font-bold text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300">{meta.action}<AppIcon className="ri-arrow-right-line" /></Link>}>
      <ModalState loading={loading} error={error} onRetry={retry} />
      {data && (
        <>
          {records.length > 1 && (
            <div className="flex flex-col gap-2 border-b border-background-200 px-4 py-3 sm:flex-row">
              <SearchBox value={query} onChange={setQuery} label={`Search ${meta.noun}s`} placeholder={`Search ${meta.noun}, programme, cohort or group…`} />
              {programmes.length > 1 && (
                <label className="min-w-0 sm:w-56">
                  <span className="sr-only">Filter by programme</span>
                  <select value={programme} onChange={event => setProgramme(event.target.value)} className="h-9 w-full min-w-0 rounded-xl border border-background-200 bg-background-100/60 px-2 text-[12px] focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-300">
                    <option value="">All programmes</option>
                    {programmes.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {filtered.length ? (
              <ul className="divide-y divide-background-200 rounded-xl border border-background-200 bg-background-50">
                {filtered.map((record, index) => <AttentionRecordRow key={`${record.id}-${index}`} record={record} meta={meta} onNavigate={onClose} />)}
              </ul>
            ) : (
              <p className="py-8 text-center text-[12px] text-foreground-400">{records.length ? 'No records match this search.' : 'Nothing needs attention here any more.'}</p>
            )}
          </div>
          {records.length > 1 && <p aria-live="polite" className="px-5 pb-2 text-[11px] text-foreground-400">{filtered.length === records.length ? `Showing all ${plural(records.length, meta.noun)}` : `Showing ${filtered.length} of ${plural(records.length, meta.noun)}`}</p>}
        </>
      )}
    </HomeModal>
  );
}
