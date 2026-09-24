import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import { fetchEmployerDocuments, type EmployerDocuments, type EmployerOwnedItem } from '@/api/employerPortal';
import { Hero, StatCard, btnSecondary } from '@/pages/users/components/ui';
import { DocumentRow, SignModal } from './EmployerDocumentRows';
import { compareSignable, targetKey, useEmployerSigning, type SigningTarget } from './useEmployerSigning';
import { useEmployerPortalChrome } from './employerPortalNav';

// ============================================================================
// All documents: every signable item across the employer's learners.
//
// The same rows as a learner's Documents tab, tagged with whose they are, so an
// employer with several learners can clear their paperwork in one place. Signing
// and opening go through the same hook and dialog as the learner page.
// ============================================================================

type Filter = 'to-sign' | 'waiting' | 'signed' | 'all';

/** What the employer can do about an item right now. */
function stateOf(item: EmployerOwnedItem): Exclude<Filter, 'all'> {
  if (item.signed) return 'signed';
  return item.signable ? 'to-sign' : 'waiting';
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'to-sign', label: 'To sign' },
  { key: 'waiting', label: 'Waiting on others' },
  { key: 'signed', label: 'Signed' },
  { key: 'all', label: 'All' },
];

export default function EmployerDocumentsPage() {
  const { employerId = '' } = useParams();
  const [data, setData] = useState<EmployerDocuments | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    setError(null);
    fetchEmployerDocuments(employerId)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [employerId]);

  const signingActions = useEmployerSigning(employerId, load);
  const { shell } = useEmployerPortalChrome(employerId, data?.employer.name);

  const items = data?.items ?? [];
  const counts = { 'to-sign': 0, waiting: 0, signed: 0, all: items.length };
  for (const item of items) counts[stateOf(item)] += 1;

  const query = search.trim().toLowerCase();
  const visible = items
    .filter((item) => filter === 'all' || stateOf(item) === filter)
    .filter((item) => !query
      || item.label.toLowerCase().includes(query)
      || item.learner.name.toLowerCase().includes(query))
    .sort((a, b) => compareSignable(a, b) || a.learner.name.localeCompare(b.learner.name));
  const target = (item: EmployerOwnedItem): SigningTarget => ({ item, kind: item.learner.kind, learnerId: item.learner.id });

  return (
    <WorkspaceShell {...shell} pageTitle="All documents" pageSubtitle={data?.employer.name ?? 'Employer'}>
      <PageContainer>
        <div className="animate-fade-in-up">
          <Hero
            icon="ri-draft-line"
            title="All documents"
            subtitle="Reviews and agreements for every one of your learners, with who has signed."
          />
        </div>

        {loading && !data && (
          <p className="py-16 text-center text-[13px] text-foreground-400">
            <i className="ri-loader-4-line animate-spin mr-2" />Loading documents…
          </p>
        )}

        {!loading && error && (
          <div className="py-16 text-center">
            <p className="text-red-600 text-[13px] mb-3"><i className="ri-error-warning-line mr-1.5" />{error}</p>
            <button className={btnSecondary} onClick={load}><i className="ri-refresh-line" />Retry</button>
          </div>
        )}

        {data && !error && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
              <StatCard icon="ri-pen-nib-line" label="Awaiting your signature" value={counts['to-sign']} tint="amber" />
              <StatCard icon="ri-time-line" label="Waiting on others" value={counts.waiting} tint="primary" />
              <StatCard icon="ri-check-double-line" label="Signed by you" value={counts.signed} tint="emerald" />
              <StatCard icon="ri-file-list-3-line" label="All documents" value={counts.all} tint="secondary" />
            </div>

            <section className="rounded-2xl border border-foreground-200/60 bg-background-50 card-premium" aria-label="Documents">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground-100 px-4 py-3">
                <nav className="flex flex-wrap items-center gap-1.5" aria-label="Filter documents">
                  {FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFilter(f.key)}
                      aria-pressed={filter === f.key}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-smooth cursor-pointer ${
                        filter === f.key
                          ? 'bg-primary-600 text-white'
                          : 'text-foreground-500 hover:bg-background-100 hover:text-foreground-700'
                      }`}
                    >
                      {f.label}
                      <span className={`rounded-full px-1.5 text-[10px] leading-[16px] ${
                        filter === f.key ? 'bg-white/25 text-white' : 'bg-background-100 text-foreground-500'
                      }`}>{counts[f.key]}</span>
                    </button>
                  ))}
                </nav>
                <label className="relative w-full sm:w-64">
                  <span className="sr-only">Search documents</span>
                  <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" aria-hidden="true" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search learner or document"
                    className="w-full rounded-lg border border-foreground-200 bg-background-50 py-1.5 pl-9 pr-3 text-[13px] text-foreground-800 placeholder:text-foreground-400"
                  />
                </label>
              </div>

              {visible.length === 0 ? (
                <p className="px-4 py-10 text-center text-[13px] text-foreground-400">
                  {items.length === 0
                    ? 'No documents yet. They appear here once the provider has prepared them for your learners.'
                    : 'No documents match this filter.'}
                </p>
              ) : (
                <div className="divide-y divide-foreground-100">
                  {visible.map((item) => (
                    <DocumentRow
                      key={targetKey(target(item))}
                      item={item}
                      owner={{ name: item.learner.name || 'Learner', href: `/employers/${employerId}/learner/${item.learner.kind}/${item.learner.id}` }}
                      onSign={() => signingActions.startSigning(target(item))}
                      onShow={() => signingActions.openDocument(target(item))}
                      opening={signingActions.opening === targetKey(target(item))}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </PageContainer>

      {signingActions.signing && data && (
        <SignModal
          item={signingActions.signing.item}
          employerName={data.employer.name}
          reviewDefinition={signingActions.reviewDefinition}
          onClose={signingActions.closeSigning}
          onSign={signingActions.sign}
          onSaveReviewAnswers={signingActions.saveReviewAnswers}
        />
      )}
    </WorkspaceShell>
  );
}
