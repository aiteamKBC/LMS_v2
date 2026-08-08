import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const enrolmentNav = roleNavMap.compliance;

interface Document {
  learner: string;
  programme: string;
  employer: string;
  docType: string;
  status: 'Complete' | 'Missing' | 'Pending Review';
  lastUpdated: string;
  required: boolean;
}

const DOCUMENTS: Document[] = [
  { learner: 'Joshua Bennett', programme: 'Business Admin L3', employer: 'Canterbury City Council', docType: 'Training Plan', status: 'Complete', lastUpdated: '10 Jun 2026', required: true },
  { learner: 'Joshua Bennett', programme: 'Business Admin L3', employer: 'Canterbury City Council', docType: 'Apprenticeship Agreement', status: 'Complete', lastUpdated: '9 Jun 2026', required: true },
  { learner: 'Joshua Bennett', programme: 'Business Admin L3', employer: 'Canterbury City Council', docType: 'Learner Declaration', status: 'Complete', lastUpdated: '8 Jun 2026', required: true },
  { learner: 'Joshua Bennett', programme: 'Business Admin L3', employer: 'Canterbury City Council', docType: 'Employer Declaration', status: 'Missing', lastUpdated: '—', required: true },
  { learner: 'Joshua Bennett', programme: 'Business Admin L3', employer: 'Canterbury City Council', docType: 'Initial Assessment Summary', status: 'Pending Review', lastUpdated: '7 Jun 2026', required: true },
  { learner: 'Daniel Walsh', programme: 'Business Admin L3', employer: 'Kent County Council', docType: 'Training Plan', status: 'Missing', lastUpdated: '—', required: true },
  { learner: 'Daniel Walsh', programme: 'Business Admin L3', employer: 'Kent County Council', docType: 'OTJH Plan', status: 'Missing', lastUpdated: '—', required: true },
  { learner: 'Daniel Walsh', programme: 'Business Admin L3', employer: 'Kent County Council', docType: 'Learner Declaration', status: 'Complete', lastUpdated: '5 Jun 2026', required: true },
  { learner: 'Sophie Martin', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', docType: 'Training Plan', status: 'Complete', lastUpdated: '8 Jun 2026', required: true },
  { learner: 'Sophie Martin', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', docType: 'Apprenticeship Agreement', status: 'Complete', lastUpdated: '8 Jun 2026', required: true },
  { learner: 'Sophie Martin', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', docType: 'RPL Summary', status: 'Pending Review', lastUpdated: '6 Jun 2026', required: false },
  { learner: 'Amina Hussein', programme: 'Data Technician L3', employer: 'Medway NHS Trust', docType: 'Training Plan', status: 'Missing', lastUpdated: '—', required: true },
  { learner: 'Amina Hussein', programme: 'Data Technician L3', employer: 'Medway NHS Trust', docType: 'Policy Acknowledgements', status: 'Missing', lastUpdated: '—', required: true },
  { learner: 'Ryan Fletcher', programme: 'Software Developer L4', employer: 'Kent Fire & Rescue', docType: 'Apprenticeship Agreement', status: 'Pending Review', lastUpdated: '2 Jun 2026', required: true },
  { learner: 'Ryan Fletcher', programme: 'Software Developer L4', employer: 'Kent Fire & Rescue', docType: 'Employer Declaration', status: 'Missing', lastUpdated: '—', required: true },
  { learner: 'Mia Okonkwo', programme: 'Digital Marketer L3', employer: 'Canterbury Creative', docType: 'Learner Declaration', status: 'Missing', lastUpdated: '—', required: true },
  { learner: 'Oliver Grant', programme: 'Customer Service L3', employer: 'Southend Council', docType: 'Support Documents', status: 'Complete', lastUpdated: '9 Jun 2026', required: false },
  { learner: 'Chloe Parkinson', programme: 'Early Years Educator L3', employer: 'Ashford Nursery', docType: 'Training Plan', status: 'Complete', lastUpdated: '10 Jun 2026', required: true },
  { learner: 'Chloe Parkinson', programme: 'Early Years Educator L3', employer: 'Ashford Nursery', docType: 'Learner Declaration', status: 'Complete', lastUpdated: '10 Jun 2026', required: true },
  { learner: 'Chloe Parkinson', programme: 'Early Years Educator L3', employer: 'Ashford Nursery', docType: 'Initial Assessment Summary', status: 'Complete', lastUpdated: '9 Jun 2026', required: true },
];

const missing = DOCUMENTS.filter(d => d.status === 'Missing').length;
const pendingReview = DOCUMENTS.filter(d => d.status === 'Pending Review').length;
const complete = DOCUMENTS.filter(d => d.status === 'Complete').length;
const learnersWithMissing = [...new Set(DOCUMENTS.filter(d => d.status === 'Missing').map(d => d.learner))].length;

export default function DocumentsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = DOCUMENTS.filter(d => {
    if (searchQuery && !d.learner.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (statusFilter !== 'all' && d.status !== statusFilter) return false;
    return true;
  });

  return (
    <WorkspaceShell role="compliance" roleLabel={enrolmentNav.label} navItems={enrolmentNav.items} workspaceLabel={enrolmentNav.workspaceLabel} pageTitle="Documents" pageSubtitle="Training plans, agreements, declarations and supporting enrolment documents" userName="Rachel Okonkwo" userRole="Enrolment Officer">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Documents" description={`${DOCUMENTS.length} documents across all learners — ${missing} missing, ${pendingReview} pending review, ${learnersWithMissing} learners with gaps.`} icon="ri-folder-line" imageUrl="https://readdy.ai/api/search-image?query=organised%20professional%20document%20management%20workspace%20filing%20folders%20clean%20modern%20office%20desk%20warm%20lighting%20editorial%20aesthetic&width=400&height=160&seq=documents-hero-01&orientation=landscape" imageAlt="Document management" stats={[{ label: 'Total Docs', value: String(DOCUMENTS.length) }, { label: 'Missing', value: String(missing), variant: 'danger' }, { label: 'Complete', value: String(complete), variant: 'success' }]} />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Training Plan', icon: 'ri-file-text-line', count: DOCUMENTS.filter(d => d.docType === 'Training Plan').length, missing: DOCUMENTS.filter(d => d.docType === 'Training Plan' && d.status === 'Missing').length },
            { label: 'Apprenticeship Agreement', icon: 'ri-bill-line', count: DOCUMENTS.filter(d => d.docType === 'Apprenticeship Agreement').length, missing: DOCUMENTS.filter(d => d.docType === 'Apprenticeship Agreement' && d.status === 'Missing').length },
            { label: 'Declarations', icon: 'ri-file-check-line', count: DOCUMENTS.filter(d => d.docType.includes('Declaration')).length, missing: DOCUMENTS.filter(d => d.docType.includes('Declaration') && d.status === 'Missing').length },
            { label: 'Supporting Docs', icon: 'ri-folder-upload-line', count: DOCUMENTS.filter(d => ['OTJH Plan', 'RPL Summary', 'Initial Assessment Summary', 'Support Documents', 'Policy Acknowledgements'].includes(d.docType)).length, missing: DOCUMENTS.filter(d => ['OTJH Plan', 'RPL Summary', 'Initial Assessment Summary', 'Support Documents', 'Policy Acknowledgements'].includes(d.docType) && d.status === 'Missing').length },
          ].map(c => (
            <div key={c.label} className="bg-background-50 rounded-xl border border-background-200/50 p-4">
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${c.missing > 0 ? 'bg-red-100 text-red-600' : 'bg-primary-100 text-primary-600'}`}><AppIcon className={`${c.icon} text-xs`}></AppIcon></span>
              <p className="text-[11px] text-foreground-400">{c.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{c.count}</p>
              {c.missing > 0 && <p className="text-[10px] text-red-600 font-medium mt-0.5">{c.missing} missing</p>}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
            <input type="text" placeholder="Search learner..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-9 pr-3 py-2 rounded-lg border border-background-200 bg-background-50 text-[12px] text-foreground-900 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300 transition-smooth" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1">
            {['all', 'Complete', 'Missing', 'Pending Review'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === s ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{s === 'all' ? 'All' : s}</button>
            ))}
          </div>
        </div>

        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-background-200">
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Learner</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Document Type</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Required</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Last Updated</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider sr-only">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/30">
                {filtered.map((d, i) => (
                  <tr key={i} className={`hover:bg-background-100/50 transition-smooth ${d.status === 'Missing' ? 'bg-red-50/20' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          d.status === 'Missing' ? 'bg-red-100 text-red-700' : d.status === 'Pending Review' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>{d.learner.charAt(0)}</span>
                        <div>
                          <span className="text-[13px] font-medium text-foreground-900 whitespace-nowrap">{d.learner}</span>
                          <p className="text-[10px] text-foreground-400">{d.programme} · {d.employer}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-foreground-600 whitespace-nowrap">{d.docType}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        d.status === 'Complete' ? 'bg-emerald-50 text-emerald-700' : d.status === 'Pending Review' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'
                      }`}>{d.status}</span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-foreground-400">{d.required ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-3 text-[12px] text-foreground-400 whitespace-nowrap">{d.lastUpdated}</td>
                    <td className="px-4 py-3">
                      <button className="text-foreground-300 hover:text-primary-600 transition-smooth cursor-pointer"><AppIcon className="ri-more-2-fill"></AppIcon></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}