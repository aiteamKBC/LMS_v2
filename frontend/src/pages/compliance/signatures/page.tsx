import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const enrolmentNav = roleNavMap.compliance;

interface SignatureRecord {
  learner: string;
  programme: string;
  employer: string;
  document: string;
  signatoryType: 'Learner' | 'Employer' | 'Provider';
  status: 'Signed' | 'Awaiting' | 'Rejected' | 'Expired' | 'Regenerated';
  date: string;
  signatory: string;
}

const SIGNATURES: SignatureRecord[] = [
  { learner: 'Ryan Fletcher', programme: 'Software Developer L4', employer: 'Kent Fire & Rescue', document: 'Apprenticeship Agreement', signatoryType: 'Employer', status: 'Rejected', date: '8 Jun 2026', signatory: 'Sarah Kent' },
  { learner: 'Ryan Fletcher', programme: 'Software Developer L4', employer: 'Kent Fire & Rescue', document: 'Apprenticeship Agreement', signatoryType: 'Employer', status: 'Regenerated', date: '9 Jun 2026', signatory: 'Sarah Kent' },
  { learner: 'Ryan Fletcher', programme: 'Software Developer L4', employer: 'Kent Fire & Rescue', document: 'Apprenticeship Agreement', signatoryType: 'Learner', status: 'Awaiting', date: '—', signatory: 'Ryan Fletcher' },
  { learner: 'Joshua Bennett', programme: 'Business Admin L3', employer: 'Canterbury City Council', document: 'Employer Declaration', signatoryType: 'Employer', status: 'Awaiting', date: '—', signatory: 'David Thompson' },
  { learner: 'Joshua Bennett', programme: 'Business Admin L3', employer: 'Canterbury City Council', document: 'Training Plan', signatoryType: 'Provider', status: 'Signed', date: '10 Jun 2026', signatory: 'Rachel Okonkwo' },
  { learner: 'Sophie Martin', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', document: 'Apprenticeship Agreement', signatoryType: 'Learner', status: 'Signed', date: '8 Jun 2026', signatory: 'Sophie Martin' },
  { learner: 'Sophie Martin', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', document: 'Apprenticeship Agreement', signatoryType: 'Employer', status: 'Signed', date: '9 Jun 2026', signatory: 'James Porter' },
  { learner: 'Daniel Walsh', programme: 'Business Admin L3', employer: 'Kent County Council', document: 'Learner Declaration', signatoryType: 'Learner', status: 'Expired', date: '1 May 2026', signatory: 'Daniel Walsh' },
  { learner: 'Daniel Walsh', programme: 'Business Admin L3', employer: 'Kent County Council', document: 'Learner Declaration', signatoryType: 'Learner', status: 'Regenerated', date: '10 Jun 2026', signatory: 'Daniel Walsh' },
  { learner: 'Mia Okonkwo', programme: 'Digital Marketer L3', employer: 'Canterbury Creative', document: 'Learner Declaration', signatoryType: 'Learner', status: 'Awaiting', date: '—', signatory: 'Mia Okonkwo' },
  { learner: 'Amina Hussein', programme: 'Data Technician L3', employer: 'Medway NHS Trust', document: 'Apprenticeship Agreement', signatoryType: 'Employer', status: 'Awaiting', date: '—', signatory: 'Mark Ellis' },
  { learner: 'Oliver Grant', programme: 'Customer Service L3', employer: 'Southend Council', document: 'Training Plan', signatoryType: 'Employer', status: 'Signed', date: '7 Jun 2026', signatory: 'Lisa Wong' },
];

const awaiting = SIGNATURES.filter(s => s.status === 'Awaiting').length;
const rejected = SIGNATURES.filter(s => s.status === 'Rejected').length;
const expired = SIGNATURES.filter(s => s.status === 'Expired').length;
const signed = SIGNATURES.filter(s => s.status === 'Signed').length;

export default function SignaturesPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = SIGNATURES.filter(s => statusFilter === 'all' || s.status === statusFilter);

  return (
    <WorkspaceShell role="compliance" roleLabel={enrolmentNav.label} navItems={enrolmentNav.items} workspaceLabel={enrolmentNav.workspaceLabel} pageTitle="Digital Signatures" pageSubtitle="Track document signatures across learners, employers and providers" userName="Rachel Okonkwo" userRole="Enrolment Officer">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Digital Signatures" description={`${SIGNATURES.length} signature records — ${awaiting} awaiting, ${rejected} rejected, ${expired} expired, ${signed} signed.`} icon="ri-pen-nib-line" imageUrl="https://readdy.ai/api/search-image?query=digital%20document%20signing%20contract%20signature%20e-signature%20professional%20clean%20modern%20office%20desk%20tablet%20stylus%20warm%20lighting&width=400&height=160&seq=signatures-hero-01&orientation=landscape" imageAlt="Digital signatures" stats={[{ label: 'Total', value: String(SIGNATURES.length) }, { label: 'Awaiting', value: String(awaiting), variant: 'warning' }, { label: 'Signed', value: String(signed), variant: 'success' }]} />

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Awaiting Learner', count: SIGNATURES.filter(s => s.status === 'Awaiting' && s.signatoryType === 'Learner').length, icon: 'ri-user-line', color: 'bg-amber-100 text-amber-700' },
            { label: 'Awaiting Employer', count: SIGNATURES.filter(s => s.status === 'Awaiting' && s.signatoryType === 'Employer').length, icon: 'ri-building-line', color: 'bg-amber-100 text-amber-700' },
            { label: 'Rejected', count: rejected, icon: 'ri-close-circle-line', color: 'bg-red-100 text-red-600' },
            { label: 'Expired', count: expired, icon: 'ri-time-line', color: 'bg-foreground-100 text-foreground-600' },
            { label: 'Regenerated', count: SIGNATURES.filter(s => s.status === 'Regenerated').length, icon: 'ri-refresh-line', color: 'bg-primary-100 text-primary-600' },
          ].map(c => (
            <div key={c.label} className="bg-background-50 rounded-xl border border-background-200/50 p-4">
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${c.color}`}><AppIcon className={`${c.icon} text-xs`}></AppIcon></span>
              <p className="text-[11px] text-foreground-400">{c.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{c.count}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
          {['all', 'Awaiting', 'Signed', 'Rejected', 'Expired', 'Regenerated'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === s ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{s === 'all' ? 'All' : s}</button>
          ))}
        </div>

        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-background-200">
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Learner</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Document</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Signatory Type</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Signatory</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/30">
                {filtered.map((r, i) => (
                  <tr key={i} className={`hover:bg-background-100/50 transition-smooth ${r.status === 'Rejected' || r.status === 'Expired' ? 'bg-red-50/20' : r.status === 'Awaiting' ? 'bg-amber-50/15' : ''}`}>
                    <td className="px-4 py-3">
                      <span className="text-[13px] font-medium text-foreground-900 whitespace-nowrap">{r.learner}</span>
                      <p className="text-[10px] text-foreground-400">{r.programme} · {r.employer}</p>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-foreground-600 whitespace-nowrap">{r.document}</td>
                    <td className="px-4 py-3 text-[12px] text-foreground-500">{r.signatoryType}</td>
                    <td className="px-4 py-3 text-[12px] text-foreground-600 whitespace-nowrap">{r.signatory}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        r.status === 'Signed' ? 'bg-emerald-50 text-emerald-700' : r.status === 'Awaiting' ? 'bg-amber-50 text-amber-700' : r.status === 'Rejected' ? 'bg-red-50 text-red-600' : r.status === 'Expired' ? 'bg-foreground-100 text-foreground-500' : 'bg-primary-50 text-primary-600'
                      }`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-foreground-400 whitespace-nowrap">{r.date}</td>
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