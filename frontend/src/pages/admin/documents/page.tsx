// ============================================================================
// Documents — enrolment."Enrolment_Documents"
//
// The platform-wide view of generated compliance documents (the per-learner
// view lives on the learner record). Signature state is the reason this screen
// is worth having: an unsigned agreement is a compliance gap, and the only way
// to see them all at once is to look across learners.
// ============================================================================
import { useCallback, useState } from 'react';
import { AdminPage, DataPanel, Pager, SourceNote, StatusBadge } from '../_shared/AdminPage';
import { useAdminData } from '../_shared/useAdminData';
import { fetchAdminDocuments } from '@/api/platformAdmin';

const PAGE_SIZE = 25;

/** Doc-type slugs are stored machine-readable; show them as words. */
function docTypeLabel(slug: string): string {
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bIlr\b/g, 'ILR')
    .replace(/\bRpl\b/g, 'RPL');
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function AdminDocumentsPage() {
  const [docType, setDocType] = useState('');
  const [signed, setSigned] = useState('');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);

  const { data, loading, error, reload } = useAdminData(
    useCallback(
      () => fetchAdminDocuments({ docType, signed, q: term, page, pageSize: PAGE_SIZE }),
      [docType, signed, term, page],
    ),
    [docType, signed, term, page],
  );

  const rows = data?.results ?? [];
  const count = data?.count ?? 0;
  const unsigned = rows.filter(r => !r.signed).length;

  return (
    <AdminPage
      title="Documents"
      subtitle="Generated compliance documents across every learner"
      icon="ri-folder-line"
      heroTitle="Compliance documents"
      heroBlurb={
        <>Indexed in <strong>enrolment.Enrolment_Documents</strong>, stored in Azure Blob Storage. Filter by signature state to find outstanding agreements.</>
      }
      stats={[
        { label: 'Documents', value: loading && !data ? '—' : count },
        { label: 'Doc types', value: loading && !data ? '—' : (data?.docTypes.length ?? 0) },
      ]}
    >
      <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative flex-1 min-w-0">
          <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setTerm(search); setPage(1); } }}
            onBlur={() => { setTerm(search); setPage(1); }}
            placeholder="Search learner or document name, then press Enter"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
        <select
          value={docType}
          onChange={e => { setDocType(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          <option value="">All types</option>
          {(data?.docTypes ?? []).map(t => <option key={t} value={t}>{docTypeLabel(t)}</option>)}
        </select>
        <select
          value={signed}
          onChange={e => { setSigned(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          <option value="">Any signature state</option>
          <option value="yes">Signed</option>
          <option value="no">Unsigned</option>
        </select>
      </div>

      {!loading && unsigned > 0 && (
        <div className="bg-amber-50 border border-amber-200/60 rounded-xl p-3.5 flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
            <AppIcon className="ri-draft-line text-amber-600 text-sm"></AppIcon>
          </span>
          <p className="text-[13px] text-amber-900">
            {unsigned} document{unsigned === 1 ? '' : 's'} on this page {unsigned === 1 ? 'is' : 'are'} not fully signed.
          </p>
        </div>
      )}

      <DataPanel
        loading={loading && !data}
        error={error}
        empty={rows.length === 0}
        emptyMessage={data && !data.available
          ? 'The document index is not provisioned on this deployment.'
          : term || docType || signed ? 'No documents match these filters.' : 'No documents have been generated yet.'}
        onRetry={reload}
      >
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-foreground-400/50">
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Document</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Learner</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Signatures</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Size</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Generated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(doc => (
                  <tr key={doc.id} className="border-b border-background-100/50 hover:bg-background-100/40 transition-smooth">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center shrink-0">
                          <AppIcon className="ri-file-text-line text-sm"></AppIcon>
                        </span>
                        <span className="font-medium text-foreground-800 truncate max-w-[220px]">{doc.docName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <a href={`/users/${doc.learnerKind}/${doc.learnerId}`} className="text-[12px] text-primary-600 hover:text-primary-700 cursor-pointer">
                        {doc.learnerName || `Learner ${doc.learnerId}`}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-foreground-600">{docTypeLabel(doc.docType)}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={doc.signed ? 'signed' : 'unsigned'} tone={doc.signed ? 'ok' : 'warn'} />
                      {(doc.learnerSignedAt || doc.employerSignedAt) && (
                        <p className="text-[10px] text-foreground-400 mt-0.5">
                          {doc.learnerSignedAt ? 'learner ✓' : ''}{doc.learnerSignedAt && doc.employerSignedAt ? ' · ' : ''}{doc.employerSignedAt ? 'employer ✓' : ''}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-foreground-500 whitespace-nowrap">{fmtSize(doc.sizeBytes)}</td>
                    <td className="px-4 py-2.5 text-[11px] text-foreground-500 whitespace-nowrap">{fmtDate(doc.generatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} count={count} onPage={setPage} />
        </div>
      </DataPanel>

      <SourceNote>
        Documents are generated during enrolment and stored in Azure Blob Storage; this table is the index.
        Open a learner&apos;s record to download or re-issue their copies.
      </SourceNote>
    </AdminPage>
  );
}
