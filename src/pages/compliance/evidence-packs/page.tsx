import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const enrolmentNav = roleNavMap.compliance;

interface EvidencePack {
  learner: string;
  programme: string;
  employer: string;
  onboardingDocs: number;
  fundingDocs: number;
  totalDocs: number;
  completeness: number;
  status: 'Complete' | 'Partial' | 'At Risk';
  lastUpdated: string;
}

const PACKS: EvidencePack[] = [
  { learner: 'Chloe Parkinson', programme: 'Early Years Educator L3', employer: 'Ashford Nursery', onboardingDocs: 8, fundingDocs: 3, totalDocs: 11, completeness: 100, status: 'Complete', lastUpdated: '10 Jun 2026' },
  { learner: 'Sophie Martin', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', onboardingDocs: 7, fundingDocs: 2, totalDocs: 9, completeness: 82, status: 'Partial', lastUpdated: '9 Jun 2026' },
  { learner: 'Oliver Grant', programme: 'Customer Service L3', employer: 'Southend Council', onboardingDocs: 6, fundingDocs: 2, totalDocs: 8, completeness: 73, status: 'Partial', lastUpdated: '8 Jun 2026' },
  { learner: 'Joshua Bennett', programme: 'Business Admin L3', employer: 'Canterbury City Council', onboardingDocs: 5, fundingDocs: 1, totalDocs: 6, completeness: 55, status: 'Partial', lastUpdated: '7 Jun 2026' },
  { learner: 'Daniel Walsh', programme: 'Business Admin L3', employer: 'Kent County Council', onboardingDocs: 3, fundingDocs: 0, totalDocs: 3, completeness: 27, status: 'At Risk', lastUpdated: '5 Jun 2026' },
  { learner: 'Amina Hussein', programme: 'Data Technician L3', employer: 'Medway NHS Trust', onboardingDocs: 4, fundingDocs: 0, totalDocs: 4, completeness: 36, status: 'At Risk', lastUpdated: '4 Jun 2026' },
  { learner: 'Ryan Fletcher', programme: 'Software Developer L4', employer: 'Kent Fire & Rescue', onboardingDocs: 4, fundingDocs: 1, totalDocs: 5, completeness: 45, status: 'At Risk', lastUpdated: '3 Jun 2026' },
  { learner: 'Mia Okonkwo', programme: 'Digital Marketer L3', employer: 'Canterbury Creative', onboardingDocs: 5, fundingDocs: 2, totalDocs: 7, completeness: 64, status: 'Partial', lastUpdated: '6 Jun 2026' },
  { learner: 'Priya Sharma', programme: 'Business Admin L3', employer: 'NatWest', onboardingDocs: 8, fundingDocs: 3, totalDocs: 11, completeness: 100, status: 'Complete', lastUpdated: '10 Jun 2026' },
  { learner: 'Emily Chen', programme: 'Business Admin L3', employer: 'Boots UK', onboardingDocs: 8, fundingDocs: 2, totalDocs: 10, completeness: 91, status: 'Complete', lastUpdated: '9 Jun 2026' },
  { learner: 'Fatima Hassan', programme: 'Healthcare Support L2', employer: 'Medway NHS Trust', onboardingDocs: 5, fundingDocs: 1, totalDocs: 6, completeness: 55, status: 'Partial', lastUpdated: '7 Jun 2026' },
  { learner: 'Marcus Webb', programme: 'Team Leader L3', employer: 'Maidstone Borough Council', onboardingDocs: 1, fundingDocs: 0, totalDocs: 1, completeness: 9, status: 'At Risk', lastUpdated: '1 Jun 2026' },
];

const complete = PACKS.filter(p => p.status === 'Complete').length;
const partial = PACKS.filter(p => p.status === 'Partial').length;
const atRisk = PACKS.filter(p => p.status === 'At Risk').length;

export default function EvidencePacksPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = PACKS.filter(p => statusFilter === 'all' || p.status === statusFilter);

  return (
    <WorkspaceShell role="compliance" roleLabel={enrolmentNav.label} navItems={enrolmentNav.items} workspaceLabel={enrolmentNav.workspaceLabel} pageTitle="Evidence Packs" pageSubtitle="Onboarding and funding evidence completeness per learner" userName="Rachel Okonkwo" userRole="Enrolment Officer">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Evidence Packs" description={`${PACKS.length} learner evidence packs — ${complete} complete, ${partial} partial, ${atRisk} at risk.`} icon="ri-folder-upload-line" imageUrl="https://readdy.ai/api/search-image?query=evidence%20document%20folder%20organised%20compliance%20audit%20files%20clean%20professional%20office%20warm%20lighting%20editorial%20photography&width=400&height=160&seq=evidence-packs-hero-01&orientation=landscape" imageAlt="Evidence packs" stats={[{ label: 'Total Packs', value: String(PACKS.length) }, { label: 'At Risk', value: String(atRisk), variant: 'danger' }, { label: 'Complete', value: String(complete), variant: 'success' }]} />

        <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
          {['all', 'Complete', 'Partial', 'At Risk'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === s ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{s === 'all' ? 'All' : s}</button>
          ))}
        </div>

        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-background-200">
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Learner</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Programme / Employer</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Onboarding Docs</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Funding Docs</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Completeness</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Last Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/30">
                {filtered.map((p, i) => (
                  <tr key={i} className={`hover:bg-background-100/50 transition-smooth ${p.status === 'At Risk' ? 'bg-red-50/20' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          p.status === 'Complete' ? 'bg-emerald-100 text-emerald-700' : p.status === 'At Risk' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                        }`}>{p.learner.charAt(0)}</span>
                        <span className="text-[13px] font-medium text-foreground-900 whitespace-nowrap">{p.learner}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-foreground-600">{p.programme}<br /><span className="text-[10px] text-foreground-400">{p.employer}</span></td>
                    <td className="px-4 py-3 text-[12px] text-foreground-600">{p.onboardingDocs} / 8</td>
                    <td className="px-4 py-3 text-[12px] text-foreground-600">{p.fundingDocs} / 3</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-background-200 rounded-full h-1.5">
                          <div className={`h-1.5 rounded-full ${p.completeness >= 80 ? 'bg-emerald-500' : p.completeness >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${p.completeness}%` }}></div>
                        </div>
                        <span className="text-[11px] font-semibold text-foreground-700">{p.completeness}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        p.status === 'Complete' ? 'bg-emerald-50 text-emerald-700' : p.status === 'At Risk' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
                      }`}>{p.status}</span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-foreground-400 whitespace-nowrap">{p.lastUpdated}</td>
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