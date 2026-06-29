import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const FORMS_DATA = [
  { id: 'f1', name: 'Monthly Coaching Sign-off', type: 'Sign-off', category: 'Coaching', submissions: 124, status: 'active' as const, lastUpdated: '1 Jun 2026', fields: 8 },
  { id: 'f2', name: 'Progress Review Form', type: 'Review', category: 'Reviews', submissions: 86, status: 'active' as const, lastUpdated: '15 May 2026', fields: 12 },
  { id: 'f3', name: 'OTJH Monthly Claim', type: 'Claim', category: 'OTJH', submissions: 210, status: 'active' as const, lastUpdated: '5 Jun 2026', fields: 6 },
  { id: 'f4', name: 'Absence Report', type: 'Report', category: 'Attendance', submissions: 34, status: 'active' as const, lastUpdated: '10 Jun 2026', fields: 5 },
  { id: 'f5', name: 'Evidence Upload', type: 'Upload', category: 'Evidence', submissions: 452, status: 'active' as const, lastUpdated: '8 Jun 2026', fields: 4 },
  { id: 'f6', name: 'KSB Self-Assessment', type: 'Assessment', category: 'KSB', submissions: 67, status: 'active' as const, lastUpdated: '20 May 2026', fields: 10 },
  { id: 'f7', name: 'Employer Confirmation', type: 'Confirmation', category: 'Employer', submissions: 28, status: 'active' as const, lastUpdated: '2 Jun 2026', fields: 7 },
  { id: 'f8', name: 'Gateway Readiness Check', type: 'Checklist', category: 'Gateway', submissions: 12, status: 'draft' as const, lastUpdated: '1 Jun 2026', fields: 15 },
  { id: 'f9', name: 'Enrolment Declaration', type: 'Declaration', category: 'Compliance', submissions: 45, status: 'active' as const, lastUpdated: '1 Apr 2026', fields: 9 },
  { id: 'f10', name: 'Support Ticket', type: 'Ticket', category: 'Support', submissions: 78, status: 'active' as const, lastUpdated: '9 Jun 2026', fields: 4 },
];

export default function AdminFormsPage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedForm, setSelectedForm] = useState<string | null>(null);

  const activeCount = FORMS_DATA.filter(f => f.status === 'active').length;
  const totalSubmissions = FORMS_DATA.reduce((a, b) => a + b.submissions, 0);
  const totalFields = FORMS_DATA.reduce((a, b) => a + b.fields, 0);

  const filtered = FORMS_DATA.filter(f => {
    const matchSearch = f.name.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === 'all' || f.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  const form = selectedForm ? FORMS_DATA.find(f => f.id === selectedForm) : null;

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Forms" pageSubtitle="Form builder, submissions, and field management" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-file-text-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Form Builder</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{FORMS_DATA.length} forms</strong> — {activeCount} active. {totalSubmissions} total submissions. {totalFields} configured fields.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{FORMS_DATA.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Forms</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalSubmissions}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Submissions</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 w-full lg:w-auto">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
            <input type="text" placeholder="Search forms..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
          </div>
          <div className="flex items-center gap-2">
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Categories</option>
              <option value="Coaching">Coaching</option>
              <option value="Reviews">Reviews</option>
              <option value="OTJH">OTJH</option>
              <option value="Attendance">Attendance</option>
              <option value="Evidence">Evidence</option>
              <option value="KSB">KSB</option>
              <option value="Employer">Employer</option>
              <option value="Gateway">Gateway</option>
              <option value="Compliance">Compliance</option>
              <option value="Support">Support</option>
            </select>
            <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-add-line mr-1.5"></i> New Form
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Forms List */}
          <div className="lg:col-span-2 space-y-3">
            {filtered.map(f => {
              const statusColors = {
                active: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
                draft: 'bg-background-100 text-foreground-500 border-foreground-200/60',
              };
              return (
                <div key={f.id} onClick={() => setSelectedForm(f.id)} className={`flex items-center gap-4 bg-background-50 rounded-xl border p-4 cursor-pointer transition-smooth ${selectedForm === f.id ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60 hover:border-background-300/60'}`}>
                  <div className="w-10 h-10 rounded-lg bg-secondary-100 flex items-center justify-center shrink-0">
                    <i className="ri-file-text-line text-secondary-600 text-sm"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{f.name}</p>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700 border border-secondary-200/50">{f.category}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColors[f.status]}`}>{f.status}</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{f.type} · {f.fields} fields · Updated {f.lastUpdated}</p>
                  </div>
                  <div className="text-[12px] text-foreground-500 shrink-0">
                    <span><i className="ri-send-plane-line mr-1"></i>{f.submissions}</span>
                  </div>
                  <i className={`ri-arrow-right-s-line text-foreground-300 ${selectedForm === f.id ? 'text-primary-500' : ''}`}></i>
                </div>
              );
            })}
          </div>

          {/* Form Detail */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 h-fit">
            {form ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{form.name}</h3>
                  <p className="text-[12px] text-foreground-500 mt-1">{form.type} · {form.category} · {form.status}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{form.submissions}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Submissions</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{form.fields}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Fields</p>
                  </div>
                </div>
                <div>
                  <h4 className="text-[12px] font-semibold text-foreground-700 mb-2">Recent Submissions</h4>
                  <div className="space-y-1.5">
                    {[1, 2, 3, 4, 5].map(i => (
                      <div key={i} className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-background-100 text-[11px]">
                        <span className="text-foreground-600">Submission #{1200 + i}</span>
                        <span className="text-foreground-400">{i} Jun 2026</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Edit Form</button>
                  <button className="flex-1 px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">View Data</button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <i className="ri-file-text-line text-foreground-300 text-xl"></i>
                </div>
                <p className="text-sm text-foreground-500">Select a form to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}