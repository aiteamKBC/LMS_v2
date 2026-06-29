import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const DOCUMENTS_DATA = [
  { id: 'd1', name: 'Learner Handbook 2026', type: 'PDF', size: '2.4 MB', category: 'Policy', downloads: 145, status: 'active' as const, uploaded: '1 Jan 2026', version: '3.0' },
  { id: 'd2', name: 'Safeguarding Policy', type: 'PDF', size: '1.1 MB', category: 'Policy', downloads: 89, status: 'active' as const, uploaded: '15 Mar 2026', version: '2.1' },
  { id: 'd3', name: 'Equality & Diversity Policy', type: 'PDF', size: '890 KB', category: 'Policy', downloads: 67, status: 'active' as const, uploaded: '15 Mar 2026', version: '1.5' },
  { id: 'd4', name: 'Health & Safety Guidelines', type: 'PDF', size: '1.5 MB', category: 'Policy', downloads: 54, status: 'active' as const, uploaded: '1 Feb 2026', version: '1.0' },
  { id: 'd5', name: 'Data Protection Policy', type: 'PDF', size: '1.2 MB', category: 'Policy', downloads: 78, status: 'active' as const, uploaded: '10 Apr 2026', version: '2.0' },
  { id: 'd6', name: 'KBC Brand Guidelines', type: 'PDF', size: '5.6 MB', category: 'Brand', downloads: 23, status: 'active' as const, uploaded: '1 Jan 2026', version: '1.0' },
  { id: 'd7', name: 'Enrolment Pack Template', type: 'DOCX', size: '450 KB', category: 'Template', downloads: 34, status: 'active' as const, uploaded: '1 Mar 2026', version: '1.2' },
  { id: 'd8', name: 'Employer Agreement Template', type: 'DOCX', size: '320 KB', category: 'Template', downloads: 28, status: 'active' as const, uploaded: '1 Mar 2026', version: '1.1' },
  { id: 'd9', name: 'ILR Specification 2026', type: 'PDF', size: '3.2 MB', category: 'Compliance', downloads: 12, status: 'active' as const, uploaded: '1 Apr 2026', version: '2026.1' },
  { id: 'd10', name: 'Ofsted Self-Assessment', type: 'XLSX', size: '1.8 MB', category: 'Compliance', downloads: 8, status: 'draft' as const, uploaded: '1 Jun 2026', version: '0.9' },
];

export default function AdminDocumentsPage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);

  const activeCount = DOCUMENTS_DATA.filter(d => d.status === 'active').length;
  const totalDownloads = DOCUMENTS_DATA.reduce((a, b) => a + b.downloads, 0);
  const totalSize = DOCUMENTS_DATA.reduce((a, b) => a + parseFloat(b.size), 0);

  const filtered = DOCUMENTS_DATA.filter(d => {
    const matchSearch = d.name.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === 'all' || d.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  const doc = selectedDoc ? DOCUMENTS_DATA.find(d => d.id === selectedDoc) : null;

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Documents" pageSubtitle="Document library, policy management, and version control" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-folder-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Document Library</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{DOCUMENTS_DATA.length} documents</strong> — {activeCount} published. {totalDownloads} total downloads. {totalSize.toFixed(1)} MB storage.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{DOCUMENTS_DATA.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Documents</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalDownloads}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Downloads</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 w-full lg:w-auto">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
            <input type="text" placeholder="Search documents..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
          </div>
          <div className="flex items-center gap-2">
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Categories</option>
              <option value="Policy">Policy</option>
              <option value="Brand">Brand</option>
              <option value="Template">Template</option>
              <option value="Compliance">Compliance</option>
            </select>
            <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-upload-line mr-1.5"></i> Upload
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Documents List */}
          <div className="lg:col-span-2 space-y-3">
            {filtered.map(d => {
              const typeColors = { PDF: 'bg-red-50 text-red-600', DOCX: 'bg-blue-50 text-blue-600', XLSX: 'bg-emerald-50 text-emerald-600' };
              const statusColors = {
                active: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
                draft: 'bg-background-100 text-foreground-500 border-foreground-200/60',
              };
              return (
                <div key={d.id} onClick={() => setSelectedDoc(d.id)} className={`flex items-center gap-4 bg-background-50 rounded-xl border p-4 cursor-pointer transition-smooth ${selectedDoc === d.id ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60 hover:border-background-300/60'}`}>
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${typeColors[d.type as keyof typeof typeColors] || 'bg-background-100 text-foreground-500'}`}>
                    <span className="text-[10px] font-bold">{d.type}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{d.name}</p>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700 border border-secondary-200/50">{d.category}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColors[d.status]}`}>{d.status}</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{d.size} · v{d.version} · {d.downloads} downloads · Uploaded {d.uploaded}</p>
                  </div>
                  <i className={`ri-arrow-right-s-line text-foreground-300 ${selectedDoc === d.id ? 'text-primary-500' : ''}`}></i>
                </div>
              );
            })}
          </div>

          {/* Document Detail */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 h-fit">
            {doc ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{doc.name}</h3>
                  <p className="text-[12px] text-foreground-500 mt-1">{doc.type} · {doc.category} · v{doc.version}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{doc.downloads}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Downloads</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{doc.size}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Size</p>
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t border-foreground-200/60">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Status</span>
                    <span className="text-foreground-700 font-medium capitalize">{doc.status}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Uploaded</span>
                    <span className="text-foreground-700 font-medium">{doc.uploaded}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Version</span>
                    <span className="text-foreground-700 font-medium">{doc.version}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Download</button>
                  <button className="flex-1 px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">Edit</button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <i className="ri-folder-line text-foreground-300 text-xl"></i>
                </div>
                <p className="text-sm text-foreground-500">Select a document to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}